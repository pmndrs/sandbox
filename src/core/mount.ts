import { createEmitter, type Emitter } from './emitter.ts';
import type { ImportMap } from './esm-sh.ts';
import { buildPreviewHtml } from './html.ts';
import { type ErrorInfo, type HostMessage, isClientMessage, type MountEvent, SBX } from './protocol.ts';
import type { Client, FetchOptions, SessionCore } from './session.ts';
import type { Path } from './types.ts';

export type MountOptions = {
    into: HTMLIFrameElement;
    /** custom body html; defaults to `<div id="root"></div>`. */
    bodyHtml?: string;
};

export type Mount = {
    readonly entry: Path;
    readonly events: Emitter<MountEvent>;
    /** fresh realm, fresh module graph. */
    reload(): void;
    dispose(): void;
};

type MountContext = MountOptions & { env: Record<string, unknown>; importMap: ImportMap; onDispose(): void };

type InvokeData = { name: string; data: unknown[] };

export function createMount(core: SessionCore, entry: Path, options: MountContext): Mount {
    const iframe = options.into;
    const events = createEmitter<MountEvent>();
    // lines the runner's evaluator wraps around module code; reported on every fetch.
    let startOffset = 0;
    let disposed = false;

    const send = (msg: HostMessage): void => iframe.contentWindow?.postMessage(msg, '*');

    const mapError = (error: ErrorInfo): ErrorInfo => {
        if (!error.stack) return error;
        const { stack, loc } = core.mapStack(error.stack, startOffset);
        return { ...error, stack, loc: error.loc ?? loc };
    };

    const client: Client = {
        loaded: new Set(),
        stale: new Set(),
        failed: false,
        hot(update, payload) {
            events.emit({ type: 'hmr', update });
            if (update.type === 'full-reload') void reload();
            else send({ src: SBX, type: 'hot', payload: payload as never });
        },
    };
    const removeClient = core.addClient(client);

    async function invoke(id: number, { name, data }: InvokeData): Promise<void> {
        try {
            let result: unknown;
            if (name === 'getBuiltins') result = [];
            else if (name === 'fetchModule') {
                const [url, importer, opts] = data as [string, string | undefined, FetchOptions | undefined];
                startOffset = opts?.startOffset ?? startOffset;
                result = await core.fetchModule(client, url, importer, opts);
            } else throw new Error(`unknown invoke '${name}'`);
            send({ src: SBX, type: 'invoke-result', id, result });
        } catch (err) {
            const e = err as Partial<ErrorInfo>;
            send({
                src: SBX,
                type: 'invoke-result',
                id,
                error: { message: e.message ?? String(err), stack: e.stack, loc: e.loc },
            });
        }
    }

    const onMessage = (e: MessageEvent): void => {
        if (e.source !== iframe.contentWindow || !isClientMessage(e.data)) return;
        const { src: _, ...msg } = e.data;
        if (msg.type === 'invoke') void invoke(msg.id, msg.payload.data as InvokeData);
        else if (msg.type === 'hot') {
            const data = msg.payload.data as { path?: string } | undefined;
            if (msg.payload.event === 'vite:invalidate' && data?.path) core.invalidate(client, data.path);
        } else if (msg.type === 'runtime-error') events.emit({ type: 'runtime-error', ...mapError(msg) });
        else events.emit(msg);
    };
    window.addEventListener('message', onMessage);

    async function reload(): Promise<void> {
        client.loaded.clear();
        client.stale.clear();
        client.failed = false;
        if (disposed) return;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.srcdoc = buildPreviewHtml({
            importMap: options.importMap,
            preambles: core.preambles(),
            config: { entry, env: options.env },
            bodyHtml: options.bodyHtml,
        });
    }
    void reload();

    return {
        entry,
        events,
        reload: () => void reload(),
        dispose() {
            if (disposed) return;
            disposed = true;
            removeClient();
            window.removeEventListener('message', onMessage);
            events.clear();
            options.onDispose();
        },
    };
}
