import fs from 'node:fs';
import { defineConfig } from 'vite';

// Multi-page: every `*.html` at the root is a rollup input (the gallery `index.html`
// + one page per example). Mirrors the math examples setup.
const input: Record<string, string> = {};
for (const file of fs.readdirSync('./')) {
    if (file.endsWith('.html')) input[file.replace('.html', '')] = `./${file}`;
}

export default defineConfig({
    base: './',
    root: './',
    build: { outDir: './dist', rollupOptions: { input }, target: 'esnext' },
    server: { open: '/index.html' },
});
