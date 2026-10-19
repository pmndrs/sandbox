import type { Fs } from './fs.ts';
import { createMount, type Mount, type MountOptions } from './mount.ts';
import { loadOxc, type Oxc, type OxcWasm } from './oxc.ts';
import type { Plugin, PluginContext } from './plugin.ts';
import { createSessionCore, type SessionCore } from './session.ts';
import type { Path } from './types.ts';

export type DevServerOptions = {
    fs: Fs;
    /** applied in order, e.g. `[css(), json(), assets(), typescript(), react()]`. */
    plugins?: Plugin[];
    /** `import.meta.env`, merged over vite-style defaults. */
    env?: Record<string, unknown>;
    /** defaults to a pinned CDN url. */
    oxc?: OxcWasm | Oxc;
};

export type Session = {
    mount(entry: Path, options: MountOptions): Mount;
    /** only needed when `fs` has no `watch`. */
    update(path: Path): void;
    /** for custom clients (tests, workers). */
    readonly core: SessionCore;
    close(): void;
};

export type DevServer = {
    open(): Promise<Session>;
};

const DEFAULT_ENV = { BASE_URL: '/', MODE: 'development', DEV: true, PROD: false, SSR: false };

const isOxc = (value: unknown): value is Oxc => typeof value === 'object' && value !== null && 'transformSync' in value;

export function createDevServer(options: DevServerOptions): DevServer {
    const { fs } = options;
    const plugins = options.plugins ?? [];
    const env = { ...DEFAULT_ENV, ...options.env };

    return {
        async open() {
            const ctx: PluginContext = {
                oxc: isOxc(options.oxc) ? options.oxc : await loadOxc(options.oxc),
                importMap: { imports: {} },
                read: async (path) => (await fs.read(path)) ?? null,
            };
            for (const plugin of plugins) await plugin.setup?.(ctx);
            for (const plugin of plugins) Object.assign(ctx.importMap.imports, (await plugin.importMap?.())?.imports);

            const core = createSessionCore(plugins, ctx);
            const mounts = new Set<Mount>();
            const unwatch = fs.watch?.((path) => core.update(path));

            return {
                core,
                mount(entry, mountOptions) {
                    const mount = createMount(core, entry, {
                        ...mountOptions,
                        env,
                        importMap: ctx.importMap,
                        onDispose: () => mounts.delete(mount),
                    });
                    mounts.add(mount);
                    return mount;
                },
                update: (path) => core.update(path),
                close() {
                    unwatch?.();
                    for (const mount of [...mounts]) mount.dispose();
                    for (const plugin of plugins) plugin.close?.();
                },
            };
        },
    };
}
