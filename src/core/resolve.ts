import { inImportMap, isBareSpecifier } from './esm-sh.ts';
import { cleanId, extname, type Plugin, type PluginContext } from './plugin.ts';
import type { Path } from './types.ts';

export type Resolved = { id: Path; external: boolean };

/** probed, in order, for extensionless relative imports. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];

const isUrl = (spec: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(spec);

const dirname = (id: Path): Path => id.slice(0, id.lastIndexOf('/') + 1) || '/';

/** posix-join + normalize `.`/`..` segments. */
function join(base: Path, rel: string): Path {
    const out: string[] = [];
    for (const part of `${base}/${rel}`.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return `/${out.join('/')}`;
}

/**
 * specifier → module id. plugins first; then bare specifiers must be in the
 * import map (external: the preview imports them natively), urls are external,
 * and local paths are probed against the fs (keeping any `?query`).
 */
export function createResolver(plugins: Plugin[], ctx: PluginContext) {
    return async function resolve(specifier: string, importer: Path | undefined): Promise<Resolved> {
        for (const plugin of plugins) {
            const r = await plugin.resolveId?.(specifier, importer, ctx);
            if (r == null) continue;
            return typeof r === 'string' ? { id: r, external: false } : { id: r.id, external: r.external ?? false };
        }
        if (isBareSpecifier(specifier)) {
            if (inImportMap(specifier, ctx.importMap)) return { id: specifier, external: true };
            throw new Error(
                `'${specifier}' is not a dependency — add it to dependencies (imported by ${importer ?? 'the entry'})`,
            );
        }
        if (isUrl(specifier)) return { id: specifier, external: true };

        const path = cleanId(specifier);
        const query = specifier.slice(path.length);
        const base = path.startsWith('/') ? path : join(dirname(importer ?? '/'), path);
        const candidates = extname(base)
            ? [base]
            : [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => `${base}/index${ext}`)];
        for (const candidate of candidates) {
            if ((await ctx.read(candidate)) !== null) return { id: candidate + query, external: false };
        }
        return { id: base + query, external: false }; // load reports the miss
    };
}
