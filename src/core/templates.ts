import { assets } from '../plugins/assets.ts';
import { css } from '../plugins/css.ts';
import { json } from '../plugins/json.ts';
import { react } from '../plugins/react.ts';
import { typescript } from '../plugins/typescript.ts';
import type { Plugin } from './plugin.ts';
import type { Dependencies, Files, Path, TemplateName } from './types.ts';

/**
 * A template provides default FILES (merged UNDER the user's), including a real,
 * visible `index` that does the `react-dom` mount — no synthetic/hidden mount
 * module. The user can see + edit the entry like a normal app, and override any
 * template file by supplying one at the same path.
 */
export const TEMPLATE_FILES: Record<TemplateName, Files> = {
    js: {
        '/index.js': "console.log('hello, sandbox');\n",
    },
    react: {
        '/index.jsx': `import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
`,
        '/App.jsx': `export default function App() {
  return <h1>Hello, sandbox</h1>;
}
`,
    },
};

const ENTRY_CANDIDATES: Record<TemplateName, string[]> = {
    react: ['/index.tsx', '/index.jsx', '/index.ts', '/index.js', '/main.tsx', '/main.jsx'],
    js: ['/index.ts', '/index.js', '/main.ts', '/main.js'],
};

/**
 * versioned runtime deps each template needs even when the user doesn't list
 * them (the react-refresh preamble + mount pull these). user deps override.
 */
export const TEMPLATE_DEPENDENCIES: Record<TemplateName, Dependencies> = {
    js: {},
    react: { react: '^19', 'react-dom': '^19', 'react-refresh': '^0.14' },
};

/** each template's plugins (dependencies are added by the sandbox). */
export const TEMPLATE_PLUGINS: Record<TemplateName, () => Plugin[]> = {
    js: () => [css(), json(), assets(), typescript()],
    react: () => [css(), json(), assets(), typescript(), react()],
};

/** merge template defaults under the user's files. */
export function withTemplate(files: Files, template: TemplateName): Files {
    return { ...TEMPLATE_FILES[template], ...files };
}

export function inferTemplate(files: Files, explicit?: TemplateName): TemplateName {
    if (explicit) return explicit;
    return Object.keys(files).some((p) => p.endsWith('.tsx') || p.endsWith('.jsx')) ? 'react' : 'js';
}

/** The module the runner imports first — the mount entry (`/index.*`). */
export function inferEntry(files: Files, template: TemplateName): Path {
    const paths = Object.keys(files);
    return ENTRY_CANDIDATES[template].find((p) => paths.includes(p)) ?? paths[0];
}
