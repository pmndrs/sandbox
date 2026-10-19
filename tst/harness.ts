import { readFile } from 'node:fs/promises';
import { ESModulesEvaluator, ModuleRunner } from 'vite/module-runner';
import { loadOxc } from '../src/core/oxc.ts';
import type { Client, FetchOptions, SessionCore } from '../src/core/session.ts';
import type { HmrUpdate } from '../src/core/protocol.ts';

/** the same wasm binding the browser loads, compiled from node_modules. */
export const oxc = () =>
    loadOxc(
        readFile(new URL('../node_modules/@oxc-transform/binding-wasm32-wasip1/transform.wasm32-wasip1.wasm', import.meta.url)).then(
            (buf) => WebAssembly.compile(buf),
        ),
    );

export type TestRunner = {
    runner: ModuleRunner;
    client: Client;
    /** lines the evaluator wraps around module code (for `core.mapStack`). */
    startOffset: number;
    /** hmr outcomes delivered to this client, in order. */
    updates: HmrUpdate[];
    /** resolves once the runner has applied every queued update. */
    settle(): Promise<void>;
};

/**
 * what `mount.ts` does over postMessage, in-process: a `Client` registered on
 * the session core + vite's module runner wired to it. bare imports resolve
 * from `externals` instead of an import map.
 */
export function createTestRunner(core: SessionCore, externals: Record<string, unknown> = {}): TestRunner {
    const updates: HmrUpdate[] = [];
    let onHot: ((payload: unknown) => Promise<void> | void) | undefined;
    let inflight: Promise<unknown> = Promise.resolve();

    const client: Client = {
        loaded: new Set(),
        stale: new Set(),
        failed: false,
        hot(update, payload) {
            updates.push(update);
            if (update.type !== 'full-reload') inflight = Promise.resolve(onHot?.(payload));
        },
    };
    core.addClient(client);

    const base = new ESModulesEvaluator();
    const runner = new ModuleRunner(
        {
            transport: {
                connect(handlers) {
                    onHot = handlers.onMessage as typeof onHot;
                },
                send(payload) {
                    const p = payload as { event?: string; data?: { path: string } };
                    if (p.event === 'vite:invalidate' && p.data) core.invalidate(client, p.data.path);
                },
                async invoke(payload) {
                    const { name, data } = (payload as { data: { name: string; data: unknown[] } }).data;
                    try {
                        if (name === 'getBuiltins') return { result: [] };
                        const [url, importer, opts] = data as [string, string | undefined, FetchOptions];
                        return { result: await core.fetchModule(client, url, importer, opts) };
                    } catch (err) {
                        const e = err as Error & { loc?: unknown };
                        return { error: { message: e.message, loc: e.loc } };
                    }
                },
            },
            sourcemapInterceptor: false,
            hmr: { logger: false },
        },
        {
            startOffset: base.startOffset,
            runInlinedModule: (context, code, mod) => base.runInlinedModule(context, code, mod),
            async runExternalModule(url) {
                if (!(url in externals)) throw new Error(`no external stub for '${url}'`);
                return externals[url];
            },
        },
    );

    return {
        runner,
        client,
        startOffset: base.startOffset ?? 0,
        updates,
        async settle() {
            // updates queue through promises + microtasks (react's refresh callbacks too).
            for (let i = 0; i < 5; i++) {
                await inflight;
                await new Promise((r) => setTimeout(r, 0));
            }
        },
    };
}
