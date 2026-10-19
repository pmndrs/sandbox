import type { Plugin } from '../core/plugin.ts';
import { jsx } from './jsx.ts';

export type ReactOptions = {
    /** react fast refresh (default true). needs dev builds of react in the import map. */
    refresh?: boolean;
    /** automatic-runtime import source (default `react`). */
    importSource?: string;
};

/** the refresh helpers, served as a virtual module through the runner. */
export const REACT_REFRESH_ID = '/@react-refresh';

/**
 * vite-plugin-react's refresh helpers over `react-refresh/runtime` (adapted from
 * parcel's `helpers.js`, itself from metro). `react-refresh/runtime` stays a bare
 * import → the import map, so this and the preamble share one instance.
 */
const RUNTIME = `import * as Refresh from 'react-refresh/runtime';

// a single edit refreshes at once; a burst is coalesced.
function debounce(fn, delay) {
  let timeout;
  let lastTime = 0;
  return () => {
    const now = Date.now();
    if (now - lastTime > delay) {
      lastTime = now;
      fn();
      return;
    }
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = undefined;
      lastTime = Date.now();
      fn();
    }, delay);
  };
}

const enqueueUpdate = debounce(() => Refresh.performReactRefresh(), 30);

export const register = Refresh.register;
export const createSignatureFunctionForTransform = Refresh.createSignatureFunctionForTransform;

// a real esm namespace has live getters and no __esModule; Symbol.toStringTag says it's one.
const isESM = (exports) => '__esModule' in exports || exports[Symbol.toStringTag] === 'Module';

// a module is a boundary iff it exports components and nothing else.
function isReactRefreshBoundary(exports) {
  if (Refresh.isLikelyComponentType(exports)) return true;
  if (exports === null || typeof exports !== 'object') return false;
  let hasExports = false;
  let areAllExportsComponents = true;
  for (const key in exports) {
    hasExports = true;
    if (key === '__esModule') continue;
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (desc && desc.get && !isESM(exports)) return false;
    if (!Refresh.isLikelyComponentType(exports[key])) areAllExportsComponents = false;
  }
  return hasExports && areAllExportsComponents;
}

function getRefreshBoundarySignature(exports) {
  const signature = [Refresh.getFamilyByType(exports)];
  if (exports === null || typeof exports !== 'object') return signature;
  for (const key in exports) {
    if (key === '__esModule') continue;
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (desc && desc.get && !isESM(exports)) continue;
    signature.push(key);
    signature.push(Refresh.getFamilyByType(exports[key]));
  }
  return signature;
}

export function registerExportsForReactRefresh(id, exports) {
  Refresh.register(exports, id + ' %exports%');
  if (exports === null || typeof exports !== 'object') return;
  for (const key in exports) {
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (desc && desc.get && !isESM(exports)) continue;
    Refresh.register(exports[key], id + ' %exports% ' + key);
  }
}

// a reason to invalidate (→ propagate to importers), or nothing to accept.
export function validateRefreshBoundaryAndEnqueueUpdate(id, prevExports, nextExports) {
  if (!isReactRefreshBoundary(nextExports)) return 'Could not Fast Refresh (export removed or no longer a component)';
  const prev = getRefreshBoundarySignature(prevExports);
  const next = getRefreshBoundarySignature(nextExports);
  if (prev.length !== next.length) return 'Could not Fast Refresh (exports changed)';
  for (let i = 0; i < next.length; i++) {
    if (prev[i] !== next[i]) return 'Could not Fast Refresh (' + String(next[i - 1]) + ' changed)';
  }
  enqueueUpdate();
}
`;

/** runs before any app module: patch react's devtools hook, install no-op globals. */
const PREAMBLE = `import { injectIntoGlobalHook } from 'react-refresh/runtime';
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
`;

/**
 * wrap a refresh-instrumented module (vite-plugin-react / rolldown's wrapper):
 * module-local `$RefreshReg$`/`$RefreshSig$` keyed by the module id, plus a
 * self-accept that re-validates the boundary on every update. `__vite_ssr_exports__`
 * is the module runner's exports object for this evaluation.
 */
function wrap(code: string, id: string): string {
    const key = JSON.stringify(id);
    return `${header(id)}${code}
if (import.meta.hot) {
  const currentExports = __vite_ssr_exports__;
  queueMicrotask(() => {
    RefreshRuntime.registerExportsForReactRefresh(${key}, currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const reason = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(${key}, currentExports, nextExports);
      if (reason) import.meta.hot.invalidate(reason);
    });
  });
}
`;
}

const header = (id: string): string => `import * as RefreshRuntime from ${JSON.stringify(REACT_REFRESH_ID)};
const $RefreshReg$ = (type, name) => RefreshRuntime.register(type, ${JSON.stringify(id)} + ' ' + name);
const $RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
`;

/** the header adds whole lines, so the map just shifts down by that many. */
const HEADER_LINES = ';'.repeat(header('').split('\n').length - 1);

/** react: jsx lowering + fast refresh. put after `typescript()`. */
export function react(options: ReactOptions = {}): Plugin {
    const refresh = options.refresh ?? true;
    const lower = jsx({ importSource: options.importSource, refresh });
    return {
        name: 'react',
        resolveId: (specifier) => (refresh && specifier === REACT_REFRESH_ID ? REACT_REFRESH_ID : null),
        load: (id) => (refresh && id === REACT_REFRESH_ID ? RUNTIME : null),
        async transform(code, id, ctx) {
            if (id === REACT_REFRESH_ID) return;
            const lowered = await lower.transform?.(code, id, ctx);
            if (!refresh || lowered == null || typeof lowered === 'string' || !lowered.code.includes('$RefreshReg$('))
                return lowered;
            return {
                code: wrap(lowered.code, id),
                map: lowered.map && { ...lowered.map, mappings: HEADER_LINES + lowered.map.mappings },
            };
        },
        preamble: () => (refresh ? PREAMBLE : null),
    };
}
