import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

const input: Record<string, string> = {};
for (const file of fs.readdirSync('./')) {
    if (file.endsWith('.html')) input[file.replace('.html', '')] = `./${file}`;
}

export default defineConfig({
    base: './',
    root: './',
    // the library's source, not its dist: edits show up without a rebuild.
    resolve: {
        alias: [
            { find: /^@pmndrs\/sandbox$/, replacement: src('index.ts') },
            { find: /^@pmndrs\/sandbox\/react$/, replacement: src('react/index.ts') },
        ],
    },
    build: { outDir: './dist', rollupOptions: { input }, target: 'esnext' },
    server: { open: '/index.html' },
});
