import { beforeAll, describe, expect, it } from 'vitest';
import { createDevServer } from '../src/core/dev-server.ts';
import { memoryFs } from '../src/core/fs.ts';
import type { Oxc } from '../src/core/oxc.ts';
import type { Files } from '../src/core/types.ts';
import { importMap } from '../src/plugins/dependencies.ts';
import { createTestRunner, oxc } from './harness.ts';

let binding: Oxc;
beforeAll(async () => {
    binding = await oxc();
});

/** evaluate `/main.js` (plain js: the runner transform is the only step). */
async function run(files: Files) {
    const core = (await createDevServer({ fs: memoryFs(files), plugins: [importMap({ imports: { ext: 'ext' } })], oxc: binding }).open()).core;
    return createTestRunner(core, { ext: { x: 'external' } }).runner.import('/main.js');
}

describe('runner transform', () => {
    it('rewrites references, not shadowing locals', async () => {
        const mod = await run({
            '/a.js': `export const a = 'module'; export const f = () => 'f';`,
            '/main.js': `import { a, f } from './a.js';
function shadowParam(a) { return a; }
function shadowLocal() { const a = 'local'; return a; }
function shadowLater() { return g(); function g() { return typeof f; } }
const caught = (() => { try { throw 'caught'; } catch (a) { return a; } })();
const obj = { a, f: f(), nested: { a: 1 }.a };
label: for (const x of [1]) { break label; }
export const out = [shadowParam('param'), shadowLocal(), shadowLater(), caught, obj.a, obj.f, obj.nested];`,
        });
        expect(mod.out).toEqual(['param', 'local', 'function', 'caught', 'module', 'f', 1]);
    });

    it('keeps imports live', async () => {
        const mod = await run({
            '/counter.js': `export let count = 0; export function inc() { count++; }`,
            '/main.js': `import { count, inc } from './counter.js';
export function read() { return count; }
inc(); inc();`,
        });
        expect(mod.read()).toBe(2);
    });

    it('handles every export form', async () => {
        const mod = await run({
            '/lib.js': `export const x = 1; export default 'lib';`,
            '/main.js': `export * from './lib.js';
export * as ns from './lib.js';
export { default as libDefault, x as y } from './lib.js';
export const { p, q: [r] } = { p: 'p', q: ['r'] };
export function fn() {}
export class C {}
const local = 'local';
export { local as renamed, local as 'string name' };
export default (1 + 1);`,
        });
        expect(mod.x).toBe(1);
        expect(mod.ns.default).toBe('lib');
        expect([mod.libDefault, mod.y, mod.p, mod.r, mod.renamed, mod['string name'], mod.default]).toEqual([
            'lib',
            1,
            'p',
            'r',
            'local',
            'local',
            2,
        ]);
        expect(typeof mod.fn).toBe('function');
        expect(typeof mod.C).toBe('function');
    });

    it('hoists function declarations and default class exports', async () => {
        const mod = await run({
            '/base.js': `export class Base { kind() { return 'base'; } }`,
            '/main.js': `export const early = hoisted();
function hoisted() { return 'hoisted'; }
import { Base } from './base.js';
export default class extends Base {}
export class Child extends Base {}`,
        });
        expect(mod.early).toBe('hoisted');
        expect(new mod.default().kind()).toBe('base');
        expect(new mod.Child().kind()).toBe('base');
    });

    it('supports cycles', async () => {
        const mod = await run({
            '/a.js': `import { b } from './b.js'; export const a = () => 'a' + b();`,
            '/b.js': `import { a } from './a.js'; export const b = () => 'b'; export const viaA = () => a();`,
            '/main.js': `import { a } from './a.js'; import { viaA } from './b.js'; export const out = [a(), viaA()];`,
        });
        expect(mod.out).toEqual(['ab', 'ab']);
    });

    it('rewrites import.meta, dynamic imports, and externals', async () => {
        const mod = await run({
            '/lazy.js': `export const lazy = 'lazy';`,
            '/main.js': `import { x } from 'ext';
export const env = typeof import.meta.hot;
export const lazy = (await import('./lazy.js')).lazy;
export const external = x;`,
        });
        expect([mod.env, mod.lazy, mod.external]).toEqual(['object', 'lazy', 'external']);
    });

    it('reports syntax errors in plain js with a location', async () => {
        await expect(run({ '/main.js': `const a = 1;\nconst = 2;` })).rejects.toMatchObject({
            loc: { file: '/main.js', line: 2, column: 7 },
        });
    });
});
