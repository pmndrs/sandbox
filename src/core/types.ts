// public core types.

/** a posix absolute path, e.g. `/App.tsx`. */
export type Path = string;

/** file inputs: posix-path → text or bytes (the "js object map"). */
export type Files = Record<Path, import('./fs.ts').FileContent>;

/** declared npm deps: package name → semver range (resolved via esm.sh). */
export type Dependencies = Record<string, string>;

/** which default files + plugins a sandbox starts with. */
export type TemplateName = 'js' | 'react';

/** options to create a sandbox. */
export type SandboxOptions = {
    /** initial files; keys are posix absolute paths. */
    files: Files;
    /** module the preview runs; defaults to a template guess. */
    entry?: Path;
    /** npm deps → semver range; resolved to esm.sh urls in the import map. */
    dependencies?: Dependencies;
    /** defaults to `react` if any `.tsx/.jsx`, else `js`. */
    template?: TemplateName;
    /** replaces the template's plugins (deps are still added). */
    plugins?: import('./plugin.ts').Plugin[];
    /** base url for the esm cdn; defaults to `https://esm.sh`. */
    cdn?: string;
    /** where the oxc wasm comes from (see `createDevServer`). */
    oxc?: import('./oxc.ts').OxcWasm | import('./oxc.ts').Oxc;
};
