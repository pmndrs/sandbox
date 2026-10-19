/** posix absolute, e.g. `/App.tsx`. */
export type Path = string;

export type Files = Record<Path, import('./fs.ts').FileContent>;

/** package name → semver range. */
export type Dependencies = Record<string, string>;

export type TemplateName = 'js' | 'react';

export type SandboxOptions = {
    files: Files;
    /** defaults to the template's `/index.*`. */
    entry?: Path;
    dependencies?: Dependencies;
    /** defaults to `react` if any `.tsx/.jsx`, else `js`. */
    template?: TemplateName;
    /** replaces the template's plugins (deps are still added). */
    plugins?: import('./plugin.ts').Plugin[];
    /** defaults to `https://esm.sh`. */
    cdn?: string;
    oxc?: import('./oxc.ts').OxcWasm | import('./oxc.ts').Oxc;
};
