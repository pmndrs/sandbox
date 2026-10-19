import type { Path } from './types.ts';

/** what the dev server knows about one module after transforming it. */
export type ModuleNode = {
    id: Path;
    importers: Set<Path>;
    imports: Set<Path>;
    /** `import.meta.hot.accept()` / `accept(cb)`. */
    selfAccepting: boolean;
    /** ids passed to `import.meta.hot.accept(deps, cb)`. */
    acceptedDeps: Set<Path>;
};

/** an hmr boundary: `boundary` re-imports `acceptedVia`. */
export type Boundary = { boundary: Path; acceptedVia: Path };

/** boundaries to hot-update, plus every module that must re-evaluate (null → full reload). */
export type Propagation = { boundaries: Boundary[]; stale: Set<Path> } | null;

export type Graph = {
    get(id: Path): ModuleNode | undefined;
    /**
     * record a freshly transformed module's edges + accept info. returns the
     * modules nothing imports any more (dropped imports, transitively) — to prune.
     */
    set(id: Path, info: { imports: Iterable<Path>; selfAccepting: boolean; acceptedDeps: Iterable<Path> }): Path[];
    /**
     * walk importers from `id` up to accepting modules (vite's `propagateUpdate`).
     * `fromImporters` skips `id` itself — for `import.meta.hot.invalidate()`.
     */
    propagate(id: Path, fromImporters?: boolean): Propagation;
};

export function createGraph(): Graph {
    const nodes = new Map<Path, ModuleNode>();

    const ensure = (id: Path): ModuleNode => {
        let node = nodes.get(id);
        if (!node) {
            node = { id, importers: new Set(), imports: new Set(), selfAccepting: false, acceptedDeps: new Set() };
            nodes.set(id, node);
        }
        return node;
    };

    /** false = reached a module nothing accepts (dead end → full reload). */
    const walk = (node: ModuleNode, boundaries: Boundary[], stale: Set<Path>, chain: Path[]): boolean => {
        if (stale.has(node.id)) return true;
        stale.add(node.id);
        if (node.selfAccepting) {
            boundaries.push({ boundary: node.id, acceptedVia: node.id });
            return true;
        }
        if (node.importers.size === 0) return false;
        for (const importerId of node.importers) {
            const importer = ensure(importerId);
            if (importer.acceptedDeps.has(node.id)) {
                boundaries.push({ boundary: importer.id, acceptedVia: node.id });
                continue;
            }
            if (chain.includes(importer.id)) continue;
            if (!walk(importer, boundaries, stale, [...chain, importer.id])) return false;
        }
        return true;
    };

    return {
        get: (id) => nodes.get(id),
        set(id, info) {
            const node = ensure(id);
            const previous = node.imports;
            node.imports = new Set([...info.imports].filter((dep) => dep !== id));
            for (const dep of node.imports) ensure(dep).importers.add(id);
            node.selfAccepting = info.selfAccepting;
            node.acceptedDeps = new Set(info.acceptedDeps);

            const orphans: Path[] = [];
            const drop = (from: Path, deps: Iterable<Path>): void => {
                for (const depId of deps) {
                    const dep = nodes.get(depId);
                    if (!dep?.importers.delete(from) || dep.importers.size > 0) continue;
                    orphans.push(depId);
                    nodes.delete(depId);
                    drop(depId, dep.imports);
                }
            };
            drop(
                id,
                [...previous].filter((dep) => !node.imports.has(dep)),
            );
            return orphans;
        },
        propagate(id, fromImporters = false) {
            const node = nodes.get(id);
            if (!node) return null;
            const boundaries: Boundary[] = [];
            const stale = new Set<Path>();
            if (!fromImporters) return walk(node, boundaries, stale, [id]) ? { boundaries, stale } : null;
            if (node.importers.size === 0) return null;
            stale.add(id); // already re-evaluated; marks it visited so the walk doesn't re-enter it
            for (const importerId of node.importers) {
                if (!walk(ensure(importerId), boundaries, stale, [id, importerId])) return null;
            }
            stale.delete(id);
            return { boundaries, stale };
        },
    };
}

const ACCEPT = /import\.meta\.hot\.accept\(\s*(?:(["'`])([^"'`]+)\1|\[([^\]]*)\])?/g;

/**
 * lex `import.meta.hot.accept(...)` calls (a cut-down vite `lexAcceptedHmrDeps`):
 * no arg or a callback → self-accepting; a string or string array → accepted deps.
 */
export function lexAccepts(code: string): { selfAccepting: boolean; deps: string[] } {
    let selfAccepting = false;
    const deps: string[] = [];
    for (const m of code.matchAll(ACCEPT)) {
        if (m[2] !== undefined) deps.push(m[2]);
        else if (m[3] !== undefined) for (const s of m[3].matchAll(/(["'`])([^"'`]+)\1/g)) deps.push(s[2]);
        else selfAccepting = true;
    }
    return { selfAccepting, deps };
}
