import type { ImportMap } from './esm-sh.ts';
import type { FileContent } from './fs.ts';
import type { Oxc } from './oxc.ts';
import type { Path } from './types.ts';

export type PluginContext = {
    oxc: Oxc;
    /** merged across plugins; empty during `setup`. */
    importMap: ImportMap;
    read(path: Path): Promise<FileContent | null>;
};

/** externals are imported natively by the preview, bypassing the runner. */
export type ResolvedId = string | { id: string; external?: boolean };

export type SourceMap = {
    version: number;
    mappings: string;
    sources: string[];
    names: string[];
    sourcesContent?: (string | null)[];
    file?: string | null;
};

/** `map` points back to the hook's input, not the original source. */
export type TransformResult = string | { code: string; map?: SourceMap | null };

type MaybePromise<T> = T | Promise<T>;

/**
 * hooks run in plugin order: the first non-nullish `resolveId`/`load` wins, every `transform` runs.
 * the dev server's own relative resolution, fs reads and module-runner rewrite run after.
 * ids may carry a query (`/a.svg?raw`); `cleanId` strips it.
 */
export type Plugin = {
    name: string;
    setup?(ctx: PluginContext): MaybePromise<void>;
    resolveId?(specifier: string, importer: Path | undefined, ctx: PluginContext): MaybePromise<ResolvedId | null | undefined>;
    load?(id: Path, ctx: PluginContext): MaybePromise<string | null | undefined>;
    /** the final output must be plain esm javascript; return a map to keep source maps. */
    transform?(code: string, id: Path, ctx: PluginContext): MaybePromise<TransformResult | null | undefined>;
    /** merged across plugins, later wins. */
    importMap?(): MaybePromise<ImportMap | null | undefined>;
    /** module source run in the preview before the entry. */
    preamble?(): string | null | undefined;
    close?(): void;
};

export const cleanId = (id: string): string => id.replace(/[?#].*$/, '');

export const queryOf = (id: string): string => /\?([^#]*)/.exec(id)?.[1] ?? '';

export function extname(id: string): string {
    if (queryOf(id)) return '';
    const dot = id.lastIndexOf('.');
    return dot > id.lastIndexOf('/') ? id.slice(dot) : '';
}
