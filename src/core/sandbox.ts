import { dependencies as dependenciesPlugin } from '../plugins/dependencies.ts';
import { acquireTypes, type TypeAcquisition } from './ata.ts';
import { createDevServer, type Session } from './dev-server.ts';
import { createEmitter, type Emitter } from './emitter.ts';
import { type MemoryFs, memoryFs } from './fs.ts';
import type { Mount } from './mount.ts';
import type { MountEvent } from './protocol.ts';
import { inferEntry, inferTemplate, TEMPLATE_DEPENDENCIES, TEMPLATE_PLUGINS, withTemplate } from './templates.ts';
import type { Dependencies, Path, SandboxOptions, TemplateName } from './types.ts';

/**
 * the batteries-included preset over `createDevServer`: a memory fs, template
 * files + plugins, esm.sh deps, and one preview iframe.
 */
export type Sandbox = {
    readonly fs: MemoryFs;
    readonly template: TemplateName;
    readonly entry: Path;
    /** resolved deps (template + user), all versioned. */
    readonly dependencies: Dependencies;
    /** preview events (ready / console / errors / hmr) for the host ui. */
    readonly messages: Emitter<MountEvent>;
    /** the deps' `.d.ts` files, for an editor (fetched from esm.sh). */
    types(): Promise<TypeAcquisition>;
    /** mount into an iframe and run. */
    attach(iframe: HTMLIFrameElement): void;
    /** write a file; the preview hot-updates. */
    update(path: Path, source: string): void;
    dispose(): void;
};

export function createSandbox(options: SandboxOptions): Sandbox {
    // infer the template from the user's files, then merge template defaults (incl a
    // real `/index.*` that mounts) under them. the entry is that real index file.
    const template = inferTemplate(options.files, options.template);
    const files = withTemplate(options.files, template);
    const fs = memoryFs(files);
    const entry = options.entry ?? inferEntry(files, template);
    const deps: Dependencies = { ...TEMPLATE_DEPENDENCIES[template], ...options.dependencies };
    const messages = createEmitter<MountEvent>();

    const opening = createDevServer({
        fs,
        // fast refresh is a no-op against production react, so react gets `?dev` builds.
        plugins: [
            ...(options.plugins ?? TEMPLATE_PLUGINS[template]()),
            dependenciesPlugin(deps, { cdn: options.cdn, dev: template === 'react' }),
        ],
        oxc: options.oxc,
    }).open();
    opening.catch((err: unknown) => messages.emit({ type: 'runtime-error', message: String(err) }));

    let session: Session | undefined;
    let mount: Mount | undefined;
    let disposed = false;
    void opening.then((s) => {
        session = s;
        if (disposed) s.close();
    });

    return {
        fs,
        template,
        entry,
        dependencies: deps,
        messages,
        types: () => acquireTypes(deps, options.cdn),
        attach(iframe) {
            void opening.then((s) => {
                if (disposed) return;
                mount?.dispose();
                mount = s.mount(entry, { into: iframe });
                mount.events.subscribe((e) => messages.emit(e));
            });
        },
        update: (path, source) => fs.write(path, source),
        dispose() {
            disposed = true;
            session?.close();
            messages.clear();
        },
    };
}
