// runs inside the preview iframe; bundled into a string by scripts/build-client.mjs.
// bare imports bypass the runner and go native through the page's import map.

import { createDefaultImportMeta, ESModulesEvaluator, ModuleRunner } from 'vite/module-runner';
import { type ClientConfig, type ClientMessage, type ErrorLoc, type HotPayload, isHostMessage, SBX } from '../protocol.ts';

const post = (msg: ClientMessage): void => parent.postMessage(msg, '*');

const serialize = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ?? a.message;
    try {
        return JSON.stringify(a);
    } catch {
        return String(a);
    }
};

const format = (args: unknown[]): unknown[] => {
    if (typeof args[0] !== 'string' || !args[0].includes('%')) return args;
    const rest = args.slice(1);
    const head = args[0].replace(/%([sdifoOc%])/g, (whole, d: string) => {
        if (d === '%') return '%';
        if (rest.length === 0) return whole;
        const value = rest.shift();
        if (d === 'c') return '';
        if (d === 'd' || d === 'i') return String(Number.parseInt(String(value), 10));
        if (d === 'f') return String(Number(value));
        return serialize(value);
    });
    return [head, ...rest];
};

const reportError = (err: unknown): void => {
    const e = (err ?? {}) as { message?: string; stack?: string; loc?: ErrorLoc };
    post({ src: SBX, type: 'runtime-error', message: e.message ?? String(err), stack: e.stack, loc: e.loc });
};

for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
        post({ src: SBX, type: 'console', level, args: format(args).map(serialize) });
        original(...args);
    };
}
addEventListener('error', (e) => reportError(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => reportError(e.reason));

const config = JSON.parse(document.getElementById('sbx-config')?.textContent ?? '{}') as ClientConfig;

let nextId = 0;
const pending = new Map<number, { resolve: (v: { result: unknown } | { error: unknown }) => void }>();
let onHot: ((payload: HotPayload) => void) | undefined;

addEventListener('message', (e) => {
    if (e.source !== parent || !isHostMessage(e.data)) return;
    const msg = e.data;
    if (msg.type === 'invoke-result') {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p?.resolve(msg.error ? { error: msg.error } : { result: msg.result });
    } else if (msg.type === 'hot') {
        onHot?.(msg.payload);
    }
});

const runner = new ModuleRunner(
    {
        transport: {
            connect(handlers) {
                onHot = handlers.onMessage as (payload: HotPayload) => void;
            },
            send(payload) {
                post({ src: SBX, type: 'hot', payload: payload as HotPayload });
            },
            invoke(payload) {
                const id = nextId++;
                return new Promise((resolve) => {
                    pending.set(id, { resolve });
                    post({ src: SBX, type: 'invoke', id, payload: payload as HotPayload });
                });
            },
        },
        sourcemapInterceptor: false,
        // the hmr client logs the error itself, then a 'failed to reload' string: surface only the error.
        hmr: { logger: { debug() {}, error: (e) => (typeof e === 'string' ? console.warn(e) : reportError(e)) } },
        createImportMeta: (id) => ({
            ...createDefaultImportMeta(id),
            env: config.env as ReturnType<typeof createDefaultImportMeta>['env'],
        }),
    },
    new ESModulesEvaluator(),
);

post({ src: SBX, type: 'ready' });
runner.import(config.entry).catch(reportError);
