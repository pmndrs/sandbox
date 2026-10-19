import { assertNoErrors } from '../core/oxc.ts';
import { extname, type Plugin } from '../core/plugin.ts';

export type JsxOptions = {
    importSource?: string;
    refresh?: boolean;
};

const JSX = new Set(['.jsx', '.tsx']);

/** put after `typescript()`. */
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
