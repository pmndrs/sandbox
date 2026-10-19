import { buildImportMap, type EsmShOptions, esmShUrl, type ImportMap, inImportMap, isBareSpecifier } from '../core/esm-sh.ts';
import type { Plugin } from '../core/plugin.ts';
import type { Dependencies } from '../core/types.ts';

export type DependenciesOptions = EsmShOptions & {
    /** undeclared bare imports: fetch latest from esm.sh (default), or fail. */
    undeclared?: 'esm.sh' | 'error';
};

/** declared deps go in the import map (so one shared react); undeclared bare imports resolve straight to esm.sh. */
export function dependencies(deps: Dependencies, options: DependenciesOptions = {}): Plugin {
    const esm = { dev: true, ...options };
    return {
        name: 'dependencies',
        importMap: () => buildImportMap(deps, esm),
        resolveId(specifier, _importer, { importMap }) {
            if (esm.undeclared === 'error' || !isBareSpecifier(specifier) || inImportMap(specifier, importMap)) return;
            return { id: esmShUrl(specifier, deps, esm), external: true };
        },
    };
}

export function importMap(map: ImportMap): Plugin {
    return { name: 'import-map', importMap: () => map };
}
