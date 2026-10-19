import { cleanId, type Plugin, queryOf } from '../core/plugin.ts';

const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    hdr: 'image/vnd.radiance',
    ktx2: 'image/ktx2',
    bin: 'application/octet-stream',
};

const extOf = (path: string): string => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** known binary extensions and `?url` → blob url, `?raw` → text. works because the preview is a same-origin srcdoc. */
export function assets(): Plugin {
    const urls = new Map<string, string>();
    const revoke = (id: string): void => {
        const url = urls.get(id);
        if (url) URL.revokeObjectURL(url);
        urls.delete(id);
    };
    return {
        name: 'assets',
        async load(id, { read }) {
            const query = queryOf(id);
            const path = cleanId(id);
            if (query !== 'raw' && query !== 'url' && !(query === '' && extOf(path) in MIME)) return;
            const content = await read(path);
            if (content === null) return; // the dev server reports the missing file
            if (query === 'raw') {
                const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
                return `export default ${JSON.stringify(text)};\n`;
            }
            // a load only re-runs after a change. revoking doesn't unload what's displayed; importers re-run with the new url.
            revoke(id);
            const blob = new Blob([content as BlobPart], { type: MIME[extOf(path)] ?? 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            urls.set(id, url);
            return `export default ${JSON.stringify(url)};\n`;
        },
        close() {
            for (const id of [...urls.keys()]) revoke(id);
        },
    };
}
