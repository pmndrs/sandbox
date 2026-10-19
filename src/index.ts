// @pmndrs/sandbox — core entry (framework-agnostic).
// oxc transforms on the host page; vite's module runner (alone) in the iframe.

export { createDevServer, type DevServer, type DevServerOptions, type Session } from './core/dev-server.ts';
export type { Mount, MountOptions } from './core/mount.ts';
export {
    cleanId,
    type Plugin,
    type PluginContext,
    queryOf,
    type ResolvedId,
    type SourceMap,
    type TransformResult,
} from './core/plugin.ts';
export { type FileContent, type Fs, type MemoryFs, memoryFs } from './core/fs.ts';
export { loadOxc, type Oxc, OXC_WASM_URL, type OxcWasm } from './core/oxc.ts';
export type { Client, FetchOptions, FetchResult, SessionCore } from './core/session.ts';

// plugins
export { typescript } from './plugins/typescript.ts';
export { jsx, type JsxOptions } from './plugins/jsx.ts';
export { react, REACT_REFRESH_ID, type ReactOptions } from './plugins/react.ts';
export { css } from './plugins/css.ts';
export { json } from './plugins/json.ts';
export { assets } from './plugins/assets.ts';
export { dependencies, type DependenciesOptions, importMap } from './plugins/dependencies.ts';

// the batteries-included preset (what the react layer drives)
export { createSandbox, type Sandbox } from './core/sandbox.ts';
export {
    inferEntry,
    inferTemplate,
    TEMPLATE_DEPENDENCIES,
    TEMPLATE_FILES,
    TEMPLATE_PLUGINS,
    withTemplate,
} from './core/templates.ts';

// dependencies (esm.sh)
export {
    buildImportMap,
    DEFAULT_CDN,
    DEFAULT_SHARED,
    type EsmShOptions,
    esmShUrl,
    type ImportMap,
    inImportMap,
    isBareSpecifier,
    packageOf,
} from './core/esm-sh.ts';
export { acquireTypes, type TypeAcquisition, type TypeFile } from './core/ata.ts';

export { createEmitter, type Emitter } from './core/emitter.ts';
export type { ConsoleLevel, ErrorInfo, ErrorLoc, HmrUpdate, MountEvent } from './core/protocol.ts';
export type { Dependencies, Files, Path, SandboxOptions, TemplateName } from './core/types.ts';
