import { assertNoErrors } from '../core/oxc.ts';
import { extname, type Plugin } from '../core/plugin.ts';

const TS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** strip typescript with oxc. jsx is preserved for `jsx()` / `react()` to lower. */
export function typescript(): Plugin {
    return {
        name: 'typescript',
        transform(code, id, { oxc }) {
            const ext = extname(id);
            if (!TS.has(ext)) return;
            const result = oxc.transformSync(id, code, {
                lang: ext === '.tsx' ? 'tsx' : 'ts',
                sourceType: 'module',
                jsx: 'preserve',
                sourcemap: true,
            });
            assertNoErrors(id, code, result.errors);
            return { code: result.code, map: result.map };
        },
    };
}
