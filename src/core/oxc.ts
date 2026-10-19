import type { createInstance } from '@oxc-transform/binding-wasm32-wasip1/workerd';
import type { ErrorLoc } from './protocol.ts';

export type Oxc = Awaited<ReturnType<typeof createInstance>>['exports'];

// pinned to the installed binding; the default wasm comes from a cdn so consumers need no bundler config.
export const OXC_VERSION = '0.154.0';
export const OXC_WASM_URL = `https://cdn.jsdelivr.net/npm/@oxc-transform/binding-wasm32-wasip1@${OXC_VERSION}/transform.wasm32-wasip1.wasm`;

export type OxcWasm = string | URL | WebAssembly.Module | PromiseLike<WebAssembly.Module>;

const cache = new Map<unknown, Promise<Oxc>>();

// the non-threaded wasip1 build needs no SharedArrayBuffer, so the host page needs no cross-origin isolation.
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

/** 1-based line and column. */
export function locate(code: string, offset: number): { line: number; column: number } {
    const before = code.slice(0, offset);
    const line = before.split('\n').length;
    return { line, column: offset - before.lastIndexOf('\n') };
}

export function errorAt(message: string, id: string, source: string, needle: string): Error & { loc?: ErrorLoc } {
    const error: Error & { loc?: ErrorLoc } = new Error(message);
    const at = source.indexOf(needle);
    if (at >= 0) error.loc = { file: id, ...locate(source, at) };
    return error;
}

// `loc` points into `code`; the dev server drops it if `code` wasn't the original source.
export function assertNoErrors(id: string, code: string, errors: OxcError[]): void {
    const fatal = errors.filter((e) => String(e.severity) === 'Error');
    if (fatal.length === 0) return;
    const error = new Error(`${id}\n${fatal.map((e) => e.codeframe ?? e.message).join('\n')}`) as Error & { loc?: ErrorLoc };
    const start = fatal[0].labels[0]?.start;
    if (start !== undefined) error.loc = { file: id, ...locate(code, start) };
    throw error;
}
