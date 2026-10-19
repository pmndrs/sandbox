import type { ImportMap } from './esm-sh.ts';
import type { FileContent } from './fs.ts';
import type { Oxc } from './oxc.ts';
import type { Path } from './types.ts';

/** what a plugin hook can ask of the dev server. */
export type PluginContext = {
    /** the loaded oxc binding (`transformSync`, ...). */
    oxc: Oxc;
    /** the preview's import map, merged across plugins (empty during `setup`). */
    importMap: ImportMap;
    /** read a file (text or bytes) from the fs; null if missing. */
    read(path: Path): Promise<FileContent | null>;
};

/** `resolveId` result: a module id, or an external the preview imports natively. */
export type ResolvedId = string | { id: string; external?: boolean };

/** a v3 source map (what oxc emits). */
export type SourceMap = {
    version: number;
    mappings: string;
    sources: string[];
    names: string[];
    sourcesContent?: (string | null)[];
    file?: string | null;
};

/** `transform` output: code, optionally with a map back to the hook's input. */
export type TransformResult = string | { code: string; map?: SourceMap | null };

type MaybePromise<T> = T | Promise<T>;

/**
 * rollup-shaped, but small. hooks run in plugin order; the first non-nullish
 * `resolveId`/`load` wins, every `transform` runs. the dev server's own steps
 * (relative resolution, fs reads, the module-runner rewrite) happen after.
 *
 * ids may carry a query (`/a.svg?raw`); `cleanId` strips it.
 */
export type Plugin = {
    name: string;
    /** one-time async setup, awaited by `devServer.open()`. */
    setup?(ctx: PluginContext): MaybePromise<void>;
    resolveId?(specifier: string, importer: Path | undefined, ctx: PluginContext): MaybePromise<ResolvedId | null | undefined>;
    load?(id: Path, ctx: PluginContext): MaybePromise<string | null | undefined>;
    /** turn a module's source into plain esm javascript (or leave it alone). return a map to keep source maps. */
    transform?(code: string, id: Path, ctx: PluginContext): MaybePromise<TransformResult | null | undefined>;
    /** entries for the preview's import map. merged across plugins, later wins. */
    importMap?(): MaybePromise<ImportMap | null | undefined>;
    /** module source run in the preview before the entry (runtime preambles). */
    preamble?(): string | null | undefined;
    /** the session closed: release anything held (blob urls, ...). */
    close?(): void;
};

/** an id without its `?query` / `#hash`. */
export const cleanId = (id: string): string => id.replace(/[?#].*$/, '');

/** the `?query` of an id (`/a.svg?raw` → `raw`), or ''. */
export const queryOf = (id: string): string => /\?([^#]*)/.exec(id)?.[1] ?? '';

/** extension of a query-less id (`/a/b.module.css` → `.css`), '' for ids with a query. */
export function extname(id: string): string {
    if (queryOf(id)) return '';
    const dot = id.lastIndexOf('.');
    return dot > id.lastIndexOf('/') ? id.slice(dot) : '';
}
