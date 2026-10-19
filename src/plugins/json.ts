import type { Plugin } from '../core/plugin.ts';

export function json(): Plugin {
    return {
        name: 'json',
        transform(code, id) {
            if (!id.endsWith('.json')) return;
            try {
                JSON.parse(code);
            } catch (err) {
                throw new Error(`[sandbox] ${id}: invalid json (${(err as Error).message})`);
            }
            return `export default ${code};\n`;
        },
    };
}
