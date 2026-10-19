import { createGraph, lexAccepts, type Propagation } from './graph.ts';
import { errorAt } from './oxc.ts';
import { cleanId, type Plugin, type PluginContext, type SourceMap } from './plugin.ts';
import type { ErrorLoc, HmrUpdate } from './protocol.ts';
import { createResolver, type Resolved } from './resolve.ts';
import { runnerTransform } from './runner-transform.ts';
import { composeMaps, createStackMapper, inlineMap } from './sourcemap.ts';
import type { Path } from './types.ts';

/** what `fetchModule` hands vite's module runner. */
export type FetchResult =
    | { externalize: string; type: 'module' }
    | { cache: true }
    | { code: string; file: Path; id: Path; url: Path; invalidate: boolean };

/** the runner's `fetchModule` options. `startOffset`: lines its evaluator wraps around the code. */
export type FetchOptions = { cached?: boolean; startOffset?: number };

/** one consumer of the session's modules — a mounted iframe (or a test runner). */
export type Client = {
    /** ids this client has fetched; only these get hot updates. */
    readonly loaded: Set<Path>;
    /** ids whose next fetch must re-evaluate (marked by propagation). */
    readonly stale: Set<Path>;
    /** a module failed on first load: the runner's graph is half-built, so any change reloads. */
    failed: boolean;
    /** deliver an hmr outcome (an `update` payload, or a reload). */
    hot(update: HmrUpdate, payload: unknown): void;
};

export type SessionCore = {
    fetchModule(client: Client, specifier: string, importer?: Path, options?: FetchOptions): Promise<FetchResult>;
    /** a file changed: re-transform on demand and hot-update every client. */
    update(path: Path): void;
    /** `import.meta.hot.invalidate()` from a client: propagate past `path`. */
    invalidate(client: Client, path: Path): void;
    /** rewrite a stack's `sandbox://` frames to original source positions. */
    mapStack(stack: string, startOffset?: number): { stack: string; loc?: ErrorLoc };
    preambles(): string[];
    addClient(client: Client): () => void;
};

/** a transformed module, cached until its file changes. */
type Transformed = { code: string; map: SourceMap | null };

export function createSessionCore(plugins: Plugin[], ctx: PluginContext): SessionCore {
    const graph = createGraph();
    const cache = new Map<Path, Promise<Transformed>>();
    const stacks = createStackMapper();
    /** fs path → module ids reading it (`/a.svg` → `/a.svg`, `/a.svg?raw`). */
    const idsByPath = new Map<Path, Set<Path>>();
    const clients = new Set<Client>();

    const resolve = createResolver(plugins, ctx);

    async function load(id: Path): Promise<string> {
        for (const plugin of plugins) {
            const code = await plugin.load?.(id, ctx);
            if (code != null) return code;
        }
        const content = await ctx.read(cleanId(id));
        if (content === null) throw new Error(`cannot find module '${id}'`);
        if (typeof content !== 'string') throw new Error(`'${id}' is a binary file — add assets() to load it`);
        return content;
    }

    async function transform(id: Path): Promise<Transformed> {
        const original = await load(id);

        // plugin transforms, collecting each step's map (one missing map breaks the chain).
        let code = original;
        let maps: SourceMap[] | null = [];
        for (const plugin of plugins) {
            const input = code;
            let out: Awaited<ReturnType<NonNullable<Plugin['transform']>>>;
            try {
                out = await plugin.transform?.(input, id, ctx);
            } catch (err) {
                // a location into an intermediate step's code would point at the wrong text.
                if (input !== original) delete (err as { loc?: unknown }).loc;
                throw err;
            }
            if (out == null) continue;
            code = typeof out === 'string' ? out : out.code;
            const map = typeof out === 'string' ? null : out.map;
            maps = map && maps ? [...maps, map] : null;
        }

        const accepts = lexAccepts(code);

        // rewrite every import specifier to its resolved id, so the runner (which
        // caches by url) sees one url per module regardless of who imports it.
        const imports = new Set<Path>();
        const result = await runnerTransform(code, id, async (spec) => {
            let resolved: Resolved;
            try {
                resolved = await resolve(spec, id);
            } catch (err) {
                throw errorAt(`${id}: ${(err as Error).message}`, id, original, JSON.stringify(spec).slice(1, -1));
            }
            if (!resolved.external) imports.add(resolved.id);
            return resolved.id;
        }).catch((err: unknown) => {
            // a syntax error's location is into `code`: only meaningful if no plugin changed it.
            if (code !== original && err instanceof SyntaxError) delete (err as { loc?: unknown }).loc;
            throw err;
        });
        const acceptedDeps = await Promise.all(accepts.deps.map(async (dep) => (await resolve(dep, id)).id));
        const orphans = graph.set(id, { imports: [...imports], selfAccepting: accepts.selfAccepting, acceptedDeps });
        if (orphans.length > 0) prune(orphans);

        const map = maps ? composeMaps(result.map, maps, id, original) : null;
        stacks.set(id, map);
        return { code: result.code, map };
    }

    function transformCached(id: Path): Promise<Transformed> {
        let pending = cache.get(id);
        if (!pending) {
            pending = transform(id);
            cache.set(id, pending);
            const path = cleanId(id);
            idsByPath.set(path, (idsByPath.get(path) ?? new Set()).add(id));
            pending.catch(() => cache.get(id) === pending && cache.delete(id));
        }
        return pending;
    }

    /** tell clients about modules nothing imports any more; a later re-import re-evaluates them. */
    function prune(orphans: Path[]): void {
        // the graph forgot them; drop the transforms too, so a re-import re-registers edges.
        for (const id of orphans) cache.delete(id);
        for (const client of clients) {
            const paths = orphans.filter((id) => client.loaded.delete(id));
            for (const id of paths) client.stale.add(id);
            if (paths.length > 0) client.hot({ type: 'prune', paths }, { type: 'prune', paths });
        }
    }

    /** turn a propagation into what one client should do. */
    function deliver(client: Client, propagation: Propagation): void {
        if (propagation === null) {
            client.hot({ type: 'full-reload' }, { type: 'full-reload' });
            return;
        }
        const boundaries = propagation.boundaries.filter((b) => client.loaded.has(b.boundary));
        if (boundaries.length === 0) return;
        for (const id of propagation.stale) client.stale.add(id);
        const timestamp = Date.now();
        client.hot(
            { type: 'update', boundaries: boundaries.map((b) => b.boundary) },
            {
                type: 'update',
                updates: boundaries.map((b) => ({ type: 'js-update', path: b.boundary, acceptedPath: b.acceptedVia, timestamp })),
            },
        );
    }

    return {
        async fetchModule(client, specifier, importer, options = {}) {
            const { id, external } = await resolve(specifier, importer);
            if (external) return { externalize: id, type: 'module' };
            const stale = client.stale.has(id);
            if (options.cached && !stale && client.loaded.has(id)) return { cache: true };
            const transformed = await transformCached(id).catch((err: unknown) => {
                // a broken edit to a loaded module just stays stale until the next edit.
                if (!client.loaded.has(id)) client.failed = true;
                throw err;
            });
            client.stale.delete(id);
            client.loaded.add(id);
            const code = inlineMap(transformed.code, id, transformed.map, options.startOffset ?? 0);
            return { code, file: id, id, url: id, invalidate: stale };
        },
        update(path) {
            const ids = idsByPath.get(path) ?? new Set([path]);
            for (const id of ids) cache.delete(id);
            for (const client of clients) {
                if (client.failed) {
                    client.hot({ type: 'full-reload' }, { type: 'full-reload' });
                    continue;
                }
                for (const id of ids) if (client.loaded.has(id)) deliver(client, graph.propagate(id));
            }
        },
        invalidate(client, path) {
            deliver(client, graph.propagate(path, true));
        },
        mapStack: stacks.map,
        preambles: () => plugins.map((p) => p.preamble?.()).filter((s): s is string => !!s),
        addClient(client) {
            clients.add(client);
            return () => clients.delete(client);
        },
    };
}
