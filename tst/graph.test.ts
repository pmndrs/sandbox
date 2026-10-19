import { describe, expect, it } from 'vitest';
import { createGraph, lexAccepts } from '../src/core/graph.ts';

const node = (imports: string[] = [], selfAccepting = false, acceptedDeps: string[] = []) => ({ imports, selfAccepting, acceptedDeps });

describe('graph.propagate', () => {
    it('stops at an importer that accepts the dep, without re-evaluating it', () => {
        const g = createGraph();
        g.set('/main.js', node(['/a.js'], false, ['/a.js']));
        g.set('/a.js', node(['/b.js']));
        g.set('/b.js', node());
        expect(g.propagate('/b.js')).toEqual({
            boundaries: [{ boundary: '/main.js', acceptedVia: '/a.js' }],
            stale: new Set(['/b.js', '/a.js']),
        });
    });

    it('needs every importer path to reach a boundary', () => {
        const g = createGraph();
        g.set('/main.js', node(['/x.js', '/y.js']));
        g.set('/x.js', node(['/shared.js'], true));
        g.set('/y.js', node(['/shared.js']));
        g.set('/shared.js', node());
        expect(g.propagate('/shared.js')).toBeNull();
    });

    it('handles import cycles', () => {
        const g = createGraph();
        g.set('/a.js', node(['/b.js'], true));
        g.set('/b.js', node(['/a.js']));
        expect(g.propagate('/b.js')?.boundaries).toEqual([{ boundary: '/a.js', acceptedVia: '/a.js' }]);
    });

    it('invalidate propagates from importers, not the module itself', () => {
        const g = createGraph();
        g.set('/main.js', node(['/App.jsx'], true));
        g.set('/App.jsx', node([], true));
        expect(g.propagate('/App.jsx', true)).toEqual({
            boundaries: [{ boundary: '/main.js', acceptedVia: '/main.js' }],
            stale: new Set(['/main.js']),
        });
    });
});

describe('lexAccepts', () => {
    it('reads self-accepts and accepted deps', () => {
        expect(lexAccepts('import.meta.hot.accept()')).toEqual({ selfAccepting: true, deps: [] });
        expect(lexAccepts('import.meta.hot.accept((m) => {})')).toEqual({ selfAccepting: true, deps: [] });
        expect(lexAccepts(`import.meta.hot.accept('./a.js', cb)`)).toEqual({ selfAccepting: false, deps: ['./a.js'] });
        expect(lexAccepts(`import.meta.hot.accept(["./a.js", './b.js'], cb)`)).toEqual({
            selfAccepting: false,
            deps: ['./a.js', './b.js'],
        });
    });
});
