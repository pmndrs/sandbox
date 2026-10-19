import type { Dependencies } from './types.ts';

export const DEFAULT_CDN = 'https://esm.sh';

export const DEFAULT_SHARED = ['react', 'react-dom'];

export type ImportMap = { imports: Record<string, string> };

export type EsmShOptions = {
    cdn?: string;
    /** singletons every consumer externalizes, so one instance is shared. */
    shared?: string[];
    /** pinned so urls are ua-independent and reproducible. */
    target?: string;
    /** `?dev` builds, needed for react hook diagnostics and fast refresh. */
    dev?: boolean;
};

export function isBareSpecifier(spec: string): boolean {
    return !spec.startsWith('.') && !spec.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(spec);
}

export function packageOf(spec: string): { name: string; subpath: string } {
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    return { name, subpath: spec.slice(name.length) };
}

export function inImportMap(spec: string, map: ImportMap): boolean {
    if (spec in map.imports) return true;
    for (const key in map.imports) if (key.endsWith('/') && spec.startsWith(key)) return true;
    return false;
}

function params(name: string, dependencies: Dependencies, options: EsmShOptions): string {
    const shared = (options.shared ?? DEFAULT_SHARED).filter((s) => s !== name && s in dependencies);
    const out = [`target=${options.target ?? 'es2022'}`];
    if (shared.length > 0) out.unshift(`external=${shared.join(',')}`);
    if (options.dev) out.push('dev');
    return out.join('&');
}

/**
 * every path to a shared dep (react) must terminate at one url → one instance.
 * - consumers get `?external=<others>`: esm.sh emits the bare specifier (also in transitive deps), which this map resolves.
 * - trailing-slash entries use esm.sh's `&`-after-version form for subpath imports.
 * TODO: resolve ranges to exact versions (never ship floating urls).
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

// undeclared imports get latest (unversioned) urls, with shared deps still external.
export function esmShUrl(spec: string, dependencies: Dependencies, options: EsmShOptions = {}): string {
    const { name, subpath } = packageOf(spec);
    return `${options.cdn ?? DEFAULT_CDN}/${name}${subpath}?${params(name, dependencies, options)}`;
}
