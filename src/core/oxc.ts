import type { createInstance } from '@oxc-transform/binding-wasm32-wasip1/workerd';
import type { ErrorLoc } from './protocol.ts';

/** the oxc binding surface we use (sync transforms; one wasm instance per page). */
export type Oxc = Awaited<ReturnType<typeof createInstance>>['exports'];

/** pinned to the installed binding; the default wasm comes from a CDN so consumers need no bundler config. */
export const OXC_VERSION = '0.154.0';
export const OXC_WASM_URL = `https://cdn.jsdelivr.net/npm/@oxc-transform/binding-wasm32-wasip1@${OXC_VERSION}/transform.wasm32-wasip1.wasm`;

/** where the oxc wasm comes from: a url, or an already-compiled module. */
export type OxcWasm = string | URL | WebAssembly.Module | PromiseLike<WebAssembly.Module>;

const cache = new Map<unknown, Promise<Oxc>>();

/**
 * load (once per wasm source) the non-threaded wasip1 oxc binding. no
 * SharedArrayBuffer, so no cross-origin isolation is needed on the host page.
 */
export function loadOxc(wasm: OxcWasm = OXC_WASM_URL): Promise<Oxc> {
    const key = wasm instanceof URL ? wasm.href : wasm;
    let pending = cache.get(key);
    if (!pending) {
        pending = (async () => {
            const { createInstance } = await import('@oxc-transform/binding-wasm32-wasip1/workerd');
            const module = typeof wasm === 'string' || wasm instanceof URL ? WebAssembly.compileStreaming(fetch(wasm)) : wasm;
            return (await createInstance(module)).exports;
        })();
        cache.set(key, pending);
        pending.catch(() => cache.delete(key));
    }
    return pending;
}

type OxcError = Oxc['transformSync'] extends (...args: never[]) => { errors: (infer E)[] } ? E : never;

/** 1-based line + column of `offset` in `code`. */
export function locate(code: string, offset: number): { line: number; column: number } {
    const before = code.slice(0, offset);
    const line = before.split('\n').length;
    return { line, column: offset - before.lastIndexOf('\n') };
}

/** an error located at the first occurrence of `needle` in `source` (when found). */
export function errorAt(message: string, id: string, source: string, needle: string): Error & { loc?: ErrorLoc } {
    const error: Error & { loc?: ErrorLoc } = new Error(message);
    const at = source.indexOf(needle);
    if (at >= 0) error.loc = { file: id, ...locate(source, at) };
    return error;
}

/**
 * throw oxc's error-severity diagnostics (with codeframes) as one error. `loc`
 * points into `code` — the dev server drops it if `code` wasn't the original source.
 */
export function assertNoErrors(id: string, code: string, errors: OxcError[]): void {
    const fatal = errors.filter((e) => String(e.severity) === 'Error');
    if (fatal.length === 0) return;
    const error = new Error(`${id}\n${fatal.map((e) => e.codeframe ?? e.message).join('\n')}`) as Error & { loc?: ErrorLoc };
    const start = fatal[0].labels[0]?.start;
    if (start !== undefined) error.loc = { file: id, ...locate(code, start) };
    throw error;
}
