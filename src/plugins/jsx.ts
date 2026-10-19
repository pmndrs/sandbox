import { assertNoErrors } from '../core/oxc.ts';
import { extname, type Plugin } from '../core/plugin.ts';

export type JsxOptions = {
    /** automatic-runtime import source (default `react`). e.g. `preact`. */
    importSource?: string;
    /** emit react fast refresh registrations (`$RefreshReg$`/`$RefreshSig$`). used by `react()`. */
    refresh?: boolean;
};

const JSX = new Set(['.jsx', '.tsx']);

/** lower jsx in `.jsx`/`.tsx` with oxc (automatic runtime, dev mode). put after `typescript()`. */
export function jsx(options: JsxOptions = {}): Plugin {
    return {
        name: 'jsx',
        transform(code, id, { oxc }) {
            if (!JSX.has(extname(id))) return;
            const result = oxc.transformSync(id, code, {
                lang: 'jsx',
                sourceType: 'module',
                jsx: {
                    runtime: 'automatic',
                    development: true,
                    importSource: options.importSource,
                    refresh: options.refresh ? {} : undefined,
                },
                sourcemap: true,
            });
            assertNoErrors(id, code, result.errors);
            return { code: result.code, map: result.map };
        },
    };
}
