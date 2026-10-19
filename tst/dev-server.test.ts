import { beforeAll, describe, expect, it } from 'vitest';
import { memoryFs } from '../src/core/fs.ts';
import type { Oxc } from '../src/core/oxc.ts';
import type { Plugin } from '../src/core/plugin.ts';
import type { Files } from '../src/core/types.ts';
import { createDevServer } from '../src/core/dev-server.ts';
import { css } from '../src/plugins/css.ts';
import { importMap } from '../src/plugins/dependencies.ts';
import { json } from '../src/plugins/json.ts';
import { react } from '../src/plugins/react.ts';
import { typescript } from '../src/plugins/typescript.ts';
import { createTestRunner, oxc } from './harness.ts';

let binding: Oxc;
beforeAll(async () => {
    binding = await oxc();
});

const open = async (files: Files, plugins: Plugin[] = [css(), json(), typescript()]) => {
    const fs = memoryFs(files);
    const session = await createDevServer({ fs, plugins, oxc: binding }).open();
    return { fs, session };
};

// css() touches the dom; a few lines of fake document are enough to run it in node.
function fakeDocument() {
    const styles: { text: string; attrs: Record<string, string> }[] = [];
    const g = globalThis as Record<string, unknown>;
    g.CSS = { escape: (s: string) => s };
    g.document = {
        head: { appendChild: (el: { text: string; attrs: Record<string, string> }) => styles.push(el) },
        querySelector: (sel: string) => styles.find((s) => sel.includes(s.attrs['data-sbx-css'])) ?? null,
        createElement: () => {
            const el = {
                attrs: {} as Record<string, string>,
                text: '',
                setAttribute: (k: string, v: string) => {
                    el.attrs[k] = v;
                },
                set textContent(v: string) {
                    el.text = v;
                },
                remove() {},
            };
            return el;
        },
    };
    return styles;
}

describe('transform pipeline', () => {
    it('runs ts, json and css through plugins, resolving extensionless + index imports', async () => {
        const styles = fakeDocument();
        const { session } = await open({
            '/main.ts': `import { add } from './lib';
import data from './data.json';
import './style.css';
type N = number;
const n: N = add(data.a, 2);
export default n;`,
            '/lib/index.ts': `export const add = (a: number, b: number): number => a + b;`,
            '/data.json': `{ "a": 40 }`,
            '/style.css': `body { color: red }`,
        });
        const { runner } = createTestRunner(session.core);
        const mod = await runner.import('/main.ts');
        expect(mod.default).toBe(42);
        expect(styles.map((s) => s.text)).toEqual(['body { color: red }']);
    });

    it('reports a syntax error with a codeframe', async () => {
        const { session } = await open({ '/main.ts': 'const x: = 1;' });
        const { runner } = createTestRunner(session.core);
        await expect(runner.import('/main.ts')).rejects.toMatchObject({ loc: { file: '/main.ts', line: 1, column: 10 } });
    });

    it('reports a missing module', async () => {
        const { session } = await open({ '/main.js': `import './nope.js';` });
        const { runner } = createTestRunner(session.core);
        await expect(runner.import('/main.js')).rejects.toThrow(/cannot find module '\/nope\.js'/);
    });
});

describe('hmr', () => {
    it('re-evaluates the changed dep under a self-accepting boundary', async () => {
        const { fs, session } = await open({
            '/a.js': `import { b } from './b.js';
export const value = () => b;
globalThis.__aRuns = (globalThis.__aRuns ?? 0) + 1;
import.meta.hot.accept();`,
            '/b.js': 'export const b = 1;',
        });
        const t = createTestRunner(session.core);
        await t.runner.import('/a.js');

        fs.write('/b.js', 'export const b = 2;');
        await t.settle();

        expect(t.updates).toEqual([{ type: 'update', boundaries: ['/a.js'] }]);
        expect(t.runner.evaluatedModules.getModuleById('/a.js')?.exports.value()).toBe(2);
        expect((globalThis as { __aRuns?: number }).__aRuns).toBe(2);
    });

    it('full-reloads when nothing accepts the change', async () => {
        const { fs, session } = await open({ '/a.js': `import './b.js';`, '/b.js': 'export const b = 1;' });
        const t = createTestRunner(session.core);
        await t.runner.import('/a.js');
        fs.write('/b.js', 'export const b = 2;');
        expect(t.updates).toEqual([{ type: 'full-reload' }]);
    });

    it('ignores changes to files the client never loaded', async () => {
        const { fs, session } = await open({ '/a.js': 'import.meta.hot.accept();', '/other.js': '' });
        const t = createTestRunner(session.core);
        await t.runner.import('/a.js');
        fs.write('/other.js', 'export {}');
        expect(t.updates).toEqual([]);
    });

    it('survives a broken edit and recovers on the next one', async () => {
        const { fs, session } = await open({ '/a.ts': 'export const v: number = 1;\nimport.meta.hot.accept();' });
        const t = createTestRunner(session.core);
        await t.runner.import('/a.ts');

        fs.write('/a.ts', 'export const v: = ;\nimport.meta.hot.accept();');
        await t.settle();
        fs.write('/a.ts', 'export const v: number = 3;\nimport.meta.hot.accept();');
        await t.settle();

        expect(t.updates.map((u) => u.type)).toEqual(['update', 'update']);
        expect(t.runner.evaluatedModules.getModuleById('/a.ts')?.exports.v).toBe(3);
    });

    it('reloads after an initial load failed, once the missing file appears', async () => {
        const { fs, session } = await open({ '/a.js': `import './b.js';` });
        const t = createTestRunner(session.core);
        await expect(t.runner.import('/a.js')).rejects.toThrow();
        fs.write('/b.js', 'export {}');
        expect(t.updates).toEqual([{ type: 'full-reload' }]);
    });
});

describe('graph edges', () => {
    it('prunes a dropped import (running its prune handler) and re-evaluates it if re-added', async () => {
        const { fs, session } = await open({
            '/main.js': `import './side.js';\nimport.meta.hot.accept();`,
            '/side.js': `globalThis.__side = (globalThis.__side ?? 0) + 1;\nimport.meta.hot.prune(() => { globalThis.__pruned = true; });`,
        });
        const g = globalThis as { __side?: number; __pruned?: boolean };
        const t = createTestRunner(session.core);
        await t.runner.import('/main.js');
        expect(g.__side).toBe(1);

        fs.write('/main.js', 'import.meta.hot.accept();');
        await t.settle();
        expect(t.updates.map((u) => u.type)).toEqual(['update', 'prune']);
        expect(g.__pruned).toBe(true);

        fs.write('/main.js', `import './side.js';\nimport.meta.hot.accept();`);
        await t.settle();
        expect(g.__side).toBe(2);
    });

    it('hot-updates every client of a session', async () => {
        const { fs, session } = await open({ '/a.js': 'export const v = 1;\nimport.meta.hot.accept();' });
        const one = createTestRunner(session.core);
        const two = createTestRunner(session.core);
        await one.runner.import('/a.js');
        await two.runner.import('/a.js');
        fs.write('/a.js', 'export const v = 2;\nimport.meta.hot.accept();');
        await one.settle();
        await two.settle();
        for (const t of [one, two]) expect(t.runner.evaluatedModules.getModuleById('/a.js')?.exports.v).toBe(2);
    });

    it('resolves dynamic imports and hot-updates through them', async () => {
        const { fs, session } = await open({
            '/main.js': `export const load = () => import('./lazy.js');\nimport.meta.hot.accept();`,
            '/lazy.js': 'export const v = 1;',
        });
        const t = createTestRunner(session.core);
        const main = await t.runner.import('/main.js');
        expect((await main.load()).v).toBe(1);
        fs.write('/lazy.js', 'export const v = 2;');
        await t.settle();
        expect(t.updates).toEqual([{ type: 'update', boundaries: ['/main.js'] }]);
        const next = t.runner.evaluatedModules.getModuleById('/main.js')?.exports;
        expect((await next.load()).v).toBe(2);
    });

    it('a deleted file errors, and restoring it recovers', async () => {
        const { fs, session } = await open({
            '/main.js': `import { v } from './dep.js';\nexport const out = v;\nimport.meta.hot.accept();`,
            '/dep.js': 'export const v = 1;',
        });
        const t = createTestRunner(session.core);
        await t.runner.import('/main.js');
        fs.delete('/dep.js');
        await t.settle();
        fs.write('/dep.js', 'export const v = 3;');
        await t.settle();
        expect(t.runner.evaluatedModules.getModuleById('/main.js')?.exports.out).toBe(3);
    });

    it('updates through an import cycle', async () => {
        const { fs, session } = await open({
            '/a.js': `import { b } from './b.js';\nexport const a = () => 'a' + b();\nimport.meta.hot.accept();`,
            '/b.js': `import { a } from './a.js';\nexport const b = () => 'b1';\nexport const useA = () => a;`,
        });
        const t = createTestRunner(session.core);
        await t.runner.import('/a.js');
        fs.write('/b.js', `import { a } from './a.js';\nexport const b = () => 'b2';\nexport const useA = () => a;`);
        await t.settle();
        expect(t.updates).toEqual([{ type: 'update', boundaries: ['/a.js'] }]);
        expect(t.runner.evaluatedModules.getModuleById('/a.js')?.exports.a()).toBe('ab2');
    });
});

// react-refresh/runtime + the jsx runtime are stubbed: what's proven here is the
// wiring (registration, boundary validation, invalidate → reload). whether react
// then preserves state is react's half, exercised in the browser examples.
describe('react fast refresh', () => {
    const stubs = () => {
        const sink = { registered: [] as string[], refreshes: 0 };
        const families = new Map<unknown, unknown>();
        const familyForId = new Map<string, unknown>();
        const runtime = {
            register(type: unknown, id: string) {
                sink.registered.push(id);
                if (type === null || (typeof type !== 'object' && typeof type !== 'function')) return;
                let family = familyForId.get(id);
                if (family === undefined) {
                    family = { id };
                    familyForId.set(id, family);
                }
                families.set(type, family);
            },
            performReactRefresh: () => {
                sink.refreshes++;
            },
            createSignatureFunctionForTransform: () => (t: unknown) => t,
            isLikelyComponentType: (t: unknown) => typeof t === 'function' && /^[A-Z]/.test((t as { name: string }).name),
            getFamilyByType: (t: unknown) => families.get(t),
        };
        const jsxRuntime = { Fragment: 'Fragment', jsxDEV: (type: unknown, props: unknown) => ({ type, props }) };
        const externals = { 'react-refresh/runtime': runtime, 'react/jsx-dev-runtime': jsxRuntime };
        return { sink, externals, map: importMap({ imports: { 'react-refresh/runtime': '#', 'react/jsx-dev-runtime': '#' } }) };
    };

    const counter = (label: string, extra = '') =>
        `export function Counter() {\n  return <div>${label}</div>;\n}\n${extra}`;

    it('registers components and refreshes on an edit', async () => {
        const { sink, externals, map } = stubs();
        const { fs, session } = await open(
            { '/main.jsx': `import { Counter } from './Counter.tsx';\nexport default Counter;`, '/Counter.tsx': counter('v1') },
            [typescript(), react(), map],
        );
        const t = createTestRunner(session.core, externals);
        await t.runner.import('/main.jsx');
        await t.settle();
        expect(sink.registered).toContain('/Counter.tsx Counter');

        fs.write('/Counter.tsx', counter('v2'));
        await t.settle();
        expect(t.updates).toEqual([{ type: 'update', boundaries: ['/Counter.tsx'] }]);
        expect(sink.refreshes).toBe(1);
    });

    it('invalidates to a full reload when a module stops being a refresh boundary', async () => {
        const { sink, externals, map } = stubs();
        const { fs, session } = await open(
            { '/main.jsx': `import { Counter } from './Counter.jsx';\nexport default Counter;`, '/Counter.jsx': counter('v1') },
            [react(), map],
        );
        const t = createTestRunner(session.core, externals);
        await t.runner.import('/main.jsx');
        await t.settle();

        fs.write('/Counter.jsx', counter('v2', 'export const VERSION = 2;\n'));
        await t.settle();
        expect(sink.refreshes).toBe(0);
        expect(t.updates).toEqual([{ type: 'update', boundaries: ['/Counter.jsx'] }, { type: 'full-reload' }]);
    });
});
