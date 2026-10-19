import type { ImportMap } from './esm-sh.ts';
import { CLIENT_SOURCE } from './generated/client.ts';
import type { ClientConfig } from './protocol.ts';

// the same-origin `srcdoc` iframe can load a host-origin blob url; one shared url keeps
// each `srcdoc` tiny and lets the browser reuse the parse.
let clientBlobUrl: string | undefined;
function clientUrl(): string {
    if (clientBlobUrl === undefined) {
        clientBlobUrl = URL.createObjectURL(new Blob([CLIENT_SOURCE], { type: 'text/javascript' }));
    }
    return clientBlobUrl;
}

export type PreviewHtmlOptions = {
    importMap: ImportMap;
    /** run before the client, in order. */
    preambles: string[];
    config: ClientConfig;
    bodyHtml?: string;
};

/** json inside a `<script>` must not be able to close it. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

// module scripts run in document order, so every preamble finishes before the client imports the entry.
export function buildPreviewHtml(options: PreviewHtmlOptions): string {
    const preambles = options.preambles.map((code) => `<script type="module">${code}</script>\n`).join('');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script type="importmap">${scriptJson(options.importMap)}</script>
<script type="application/json" id="sbx-config">${scriptJson(options.config)}</script>
<style>html,body,#root{height:100%;margin:0}#root{display:flow-root}</style>
${preambles}</head>
<body>
${options.bodyHtml ?? '<div id="root"></div>'}
<script type="module" src="${clientUrl()}"></script>
</body>
</html>`;
}
