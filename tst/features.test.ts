import { beforeAll, describe, expect, it } from 'vitest';
import { createDevServer } from '../src/core/dev-server.ts';
import { memoryFs } from '../src/core/fs.ts';
import type { Oxc } from '../src/core/oxc.ts';
import type { Plugin } from '../src/core/plugin.ts';
import type { Client } from '../src/core/session.ts';
import type { Files } from '../src/core/types.ts';
import { assets } from '../src/plugins/assets.ts';
import { css } from '../src/plugins/css.ts';
import { dependencies, importMap } from '../src/plugins/dependencies.ts';
import { react } from '../src/plugins/react.ts';
import { typescript } from '../src/plugins/typescript.ts';
import { createTestRunner, oxc } from './harness.ts';

let binding: Oxc;
/** `<style>` tags css() appended to the fake document. */
const head: { text: string; attrs: Record<string, string> }[] = [];
beforeAll(async () => {
    binding = await oxc();
    // css() touches the dom; just enough of one to run it in node.
    Object.assign(globalThis, {
        CSS: { escape: (s: string) => s },
        document: {
            head: { appendChild: (el: (typeof head)[number]) => head.push(el) },
            querySelector: () => null,
            createElement: () => {
                const el = { text: '', attrs: {} as Record<string, string>, setAttribute: (k: string, v: string) => (el.attrs[k] = v) };
                return Object.defineProperty(el, 'textContent', { set: (v: string) => (el.text = v) });
            },
        },
    });
});

const open = async (files: Files, plugins: Plugin[]) =>
    (await createDevServer({ fs: memoryFs(files), plugins, oxc: binding }).open()).core;

const bareClient = (): Client => ({ loaded: new Set(), stale: new Set(), failed: false, hot() {} });

describe('source maps', () => {
    it('maps a runtime stack frame back through typescript to the original line', async () => {
        const core = await open(
            {
                '/main.ts': `type Big = {
  a: number;
  b: string;
};

export function boom(x: Big): never {
  throw new Error('boom ' + x.a);
}
`,
            },
            [typescript()],
        );
        const t = createTestRunner(core);
        const mod = await t.runner.import('/main.ts');
        let stack = '';
        try {
            mod.boom({ a: 1, b: '' });
        } catch (err) {
            stack = (err as Error).stack ?? '';
        }
        expect(stack).toContain('sandbox:///main.ts:');
        const mapped = core.mapStack(stack, t.startOffset);
        expect(mapped.loc).toEqual({ file: '/main.ts', line: 7, column: 9 });
        expect(mapped.stack).toContain('/main.ts:7:9');
    });

    it('maps through jsx + the refresh wrapper', async () => {
        const core = await open(
            {
                '/App.tsx': `import { helper } from './helper.ts';

export function App(props: { n: number }) {
  if (props.n > 1) throw new Error('too big');
  return <div>{helper(props.n)}</div>;
}
`,
                '/helper.ts': 'export const helper = (n: number) => n;',
            },
            [typescript(), react(), importMap({ imports: { 'react-refresh/runtime': '#', 'react/jsx-dev-runtime': '#' } })],
        );
        const refresh = {
            register() {},
            createSignatureFunctionForTransform: () => () => {},
            isLikelyComponentType: () => true,
            getFamilyByType: () => undefined,
            performReactRefresh() {},
        };
        const t = createTestRunner(core, { 'react-refresh/runtime': refresh, 'react/jsx-dev-runtime': { jsxDEV: () => null } });
        const { App } = await t.runner.import('/App.tsx');
        expect(() => App({ n: 1 })).not.toThrow();
        let stack = '';
        try {
            App({ n: 2 });
        } catch (err) {
            stack = (err as Error).stack ?? '';
        }
        expect(core.mapStack(stack, t.startOffset).loc).toEqual({ file: '/App.tsx', line: 4, column: 26 });
    });

    it('inlines a map and names the module for devtools', async () => {
        const core = await open({ '/a.ts': 'export const a: number = 1;\n' }, [typescript()]);
        const result = await core.fetchModule(bareClient(), '/a.ts', undefined, { startOffset: 2 });
        if (!('code' in result)) throw new Error('expected code');
        expect(result.code).toContain('//# sourceURL=sandbox:///a.ts');
        const b64 = /sourceMappingURL=data:application\/json;base64,(.+)/.exec(result.code)?.[1] ?? '';
        const map = JSON.parse(Buffer.from(b64, 'base64').toString());
        expect(map.sources).toEqual(['/a.ts']);
        expect(map.sourcesContent).toEqual(['export const a: number = 1;\n']);
        expect(map.mappings.startsWith(';;')).toBe(true);
    });
});

describe('bare imports', () => {
    it('fails clearly, pointing at the import, when nothing provides the package', async () => {
        const core = await open({ '/main.js': `\nimport { x } from 'lodash-es';\n` }, []);
        await expect(core.fetchModule(bareClient(), '/main.js')).rejects.toMatchObject({
            message: expect.stringContaining(`'lodash-es' is not a dependency`),
            loc: { file: '/main.js', line: 2, column: 20 },
        });
    });

    it('declared deps stay bare (import map); undeclared ones go straight to esm.sh', async () => {
        const core = await open({ '/main.js': `import 'react';\nimport 'react-dom/client';\nimport 'lodash-es/debounce';\n` }, [
            dependencies({ react: '19.0.0', 'react-dom': '19.0.0' }, { dev: false }),
        ]);
        const result = await core.fetchModule(bareClient(), '/main.js');
        if (!('code' in result)) throw new Error('expected code');
        expect(result.code).toContain('__vite_ssr_import__("react"');
        expect(result.code).toContain('__vite_ssr_import__("react-dom/client"');
        expect(result.code).toContain(
            '__vite_ssr_import__("https://esm.sh/lodash-es/debounce?external=react,react-dom&target=es2022"',
        );
    });

    it('error mode refuses undeclared packages', async () => {
        const core = await open({ '/main.js': `import 'lodash-es';` }, [dependencies({}, { undeclared: 'error' })]);
        await expect(core.fetchModule(bareClient(), '/main.js')).rejects.toThrow(/not a dependency/);
    });
});

describe('assets', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    it('serves binary files as blob urls, ?raw as text, ?url for anything', async () => {
        const core = await open(
            {
                '/main.ts': `import logo from './logo.png';
import shader from './a.glsl?raw';
import src from './main.ts?raw';
import url from './a.glsl?url';
export { logo, shader, src, url };`,
                '/logo.png': png,
                '/a.glsl': 'void main() {}',
            },
            [assets(), typescript()],
        );
        const t = createTestRunner(core);
        const mod = await t.runner.import('/main.ts');
        expect(mod.logo).toMatch(/^blob:/);
        expect(new Uint8Array(await (await fetch(mod.logo)).arrayBuffer())).toEqual(png);
        expect(mod.shader).toBe('void main() {}');
        expect(mod.src).toContain(`import logo from './logo.png';`); // raw, so typescript left it alone
        expect(mod.url).toMatch(/^blob:/);
    });

    it('says which plugin is missing for a binary file', async () => {
        const core = await open({ '/main.js': `import './logo.png';`, '/logo.png': png }, []);
        const t = createTestRunner(core);
        await expect(t.runner.import('/main.js')).rejects.toThrow(/binary file — add assets\(\)/);
    });
});

describe('css', () => {
    it('scopes css modules, leaves :global and declarations alone', async () => {
        const core = await open(
            {
                '/main.js': `import styles, { title } from './a.module.css';\nexport { styles, title };`,
                '/a.module.css': `/* .comment {} */
.title, .title-big:hover { color: red; margin: .5em; }
:global(.app) .title { background: url(data:image/png;base64,AA==); }
@media (min-width: 1px) { .wide { width: 1.5px; } }`,
            },
            [css()],
        );
        const t = createTestRunner(core);
        const mod = await t.runner.import('/main.js');
        const { styles, title } = mod;
        expect(Object.keys(styles)).toEqual(['title', 'title-big', 'wide']);
        expect(title).toBe(styles.title);
        expect(title).toMatch(/^title_[0-9a-z]+$/);
        const text = head.find((el) => el.attrs['data-sbx-css'] === '/a.module.css')?.text ?? '';
        const h = title.slice('title_'.length);
        expect(text).not.toContain('comment');
        expect(text).toContain(`.title_${h}, .title-big_${h}:hover { color: red; margin: .5em; }`);
        expect(text).toContain(`.app .title_${h} { background: url(data:image/png;base64,AA==); }`);
        expect(text).toContain(`@media (min-width: 1px) { .wide_${h} { width: 1.5px; } }`);
    });

    it('rewrites relative url()s through assets', async () => {
        const core = await open(
            {
                '/main.js': `import css from './a.css';\nexport default css;`,
                '/a.css': `body { background: url(./bg.png) } .x { background: url("https://x.test/a.png") }`,
                '/bg.png': new Uint8Array([1, 2, 3]),
            },
            [css(), assets()],
        );
        const t = createTestRunner(core);
        const text: string = (await t.runner.import('/main.js')).default;
        expect(text).toMatch(/^body \{ background: url\("blob:[^"]+"\) \}/);
        expect(text).toContain('url("https://x.test/a.png")');
    });
});
