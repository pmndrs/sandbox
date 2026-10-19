import type { Dependencies } from './types.ts';

export const DEFAULT_CDN = 'https://esm.sh';

/** deps that must resolve to a SINGLE shared instance across the graph. */
export const DEFAULT_SHARED = ['react', 'react-dom'];

export type ImportMap = { imports: Record<string, string> };

export type EsmShOptions = {
    cdn?: string;
    /** singletons every consumer externalizes so one instance is shared. */
    shared?: string[];
    /** pin the build target so urls are ua-independent + reproducible. */
    target?: string;
    /** `?dev` builds (react hook diagnostics, fast refresh). */
    dev?: boolean;
};

/** true for a bare (npm) specifier — not relative, not absolute, not a url. */
export function isBareSpecifier(spec: string): boolean {
    return !spec.startsWith('.') && !spec.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(spec);
}

/** split a bare specifier into package name + subpath: `react-dom/client` → `react-dom`, `/client`. */
export function packageOf(spec: string): { name: string; subpath: string } {
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    return { name, subpath: spec.slice(name.length) };
}

/** whether the import map resolves `spec` (an exact entry, or a trailing-slash prefix). */
export function inImportMap(spec: string, map: ImportMap): boolean {
    if (spec in map.imports) return true;
    for (const key in map.imports) if (key.endsWith('/') && spec.startsWith(key)) return true;
    return false;
}

/** esm.sh query params for one package: externalize the other shared singletons. */
function params(name: string, dependencies: Dependencies, options: EsmShOptions): string {
    const shared = (options.shared ?? DEFAULT_SHARED).filter((s) => s !== name && s in dependencies);
    const out = [`target=${options.target ?? 'es2022'}`];
    if (shared.length > 0) out.unshift(`external=${shared.join(',')}`);
    if (options.dev) out.push('dev');
    return out.join('&');
}

/**
 * a native import map for the declared deps, so every path to a shared dep
 * (react) terminates at one url → one instance.
 *
 * recipe (llm/notes/esm-sh.md, verified against esm.sh 2026-08-16):
 * - each consumer of a shared singleton gets `?external=<others>` → esm.sh emits
 *   the bare specifier, which this map resolves back to the single entry;
 *   esm.sh propagates the flag to transitive deps.
 * - trailing-slash entries use the `&`-after-version form for subpath imports.
 *
 * TODO(esm-sh.md): resolve ranges to EXACT versions (never ship floating urls).
 */
export function buildImportMap(dependencies: Dependencies, options: EsmShOptions = {}): ImportMap {
    const cdn = options.cdn ?? DEFAULT_CDN;
    const imports: Record<string, string> = {};
    for (const [name, version] of Object.entries(dependencies)) {
        const q = params(name, dependencies, options);
        imports[name] = `${cdn}/${name}@${version}?${q}`;
        imports[`${name}/`] = `${cdn}/${name}@${version}&${q}/`;
    }
    return { imports };
}

/** a direct esm.sh url for an UNDECLARED bare import (latest version, shared deps still external). */
export function esmShUrl(spec: string, dependencies: Dependencies, options: EsmShOptions = {}): string {
    const { name, subpath } = packageOf(spec);
    return `${options.cdn ?? DEFAULT_CDN}/${name}${subpath}?${params(name, dependencies, options)}`;
}
