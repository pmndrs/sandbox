import remapping from '@jridgewell/remapping';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import type { SourceMap } from './plugin.ts';
import type { ErrorLoc } from './protocol.ts';
import type { Path } from './types.ts';

/** evaluated modules are named `sandbox:///App.tsx` in devtools + stack traces. */
export const SOURCE_URL = 'sandbox://';

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** utf-8 safe base64 (btoa only takes latin1). */
function base64(text: string): string {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/** chain `steps` (first transform first) under `last`, pointing at `original` as `id`. */
export function composeMaps(last: SourceMap, steps: SourceMap[], id: Path, original: string): SourceMap {
    const composed = remapping([last, ...[...steps].reverse()] as never, () => null);
    return { ...composed, sources: [id], sourcesContent: [original], file: id } as SourceMap;
}

/**
 * the module as the runner evaluates it (vite's recipe): named for devtools, with
 * an inline map shifted down past the `startOffset` lines its evaluator wraps around it.
 */
export function inlineMap(code: string, id: Path, map: SourceMap | null, startOffset: number): string {
    let out = `${code.trimEnd()}\n//# sourceURL=${SOURCE_URL}${id}`;
    if (map) {
        const shifted = { ...map, mappings: ';'.repeat(startOffset) + map.mappings };
        out += `\n//# sourceMappingURL=data:application/json;base64,${base64(JSON.stringify(shifted))}`;
    }
    return `${out}\n`;
}

/** maps for finished transforms, to rewrite `sandbox://` stack frames to original positions. */
export function createStackMapper() {
    const traces = new Map<Path, TraceMap>();
    const frame = new RegExp(`${escapeRe(SOURCE_URL)}(/[^\\s)]*?):(\\d+):(\\d+)`, 'g');
    return {
        set(id: Path, map: SourceMap | null) {
            if (map) traces.set(id, new TraceMap(map as never));
            else traces.delete(id);
        },
        /** the mapped stack, plus the first frame that mapped (the error's location). */
        map(stack: string, startOffset = 0): { stack: string; loc?: ErrorLoc } {
            let loc: ErrorLoc | undefined;
            const mapped = stack.replace(frame, (whole, id: string, line: string, column: string) => {
                const trace = traces.get(id);
                if (!trace) return whole;
                const pos = originalPositionFor(trace, { line: Number(line) - startOffset, column: Number(column) - 1 });
                if (pos.line == null) return whole;
                loc ??= { file: id, line: pos.line, column: pos.column + 1 };
                return `${id}:${pos.line}:${pos.column + 1}`;
            });
            return { stack: mapped, loc };
        },
    };
}
