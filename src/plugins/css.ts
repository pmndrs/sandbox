import type { Plugin } from '../core/plugin.ts';

/** short, stable hash of a string (fnv-1a → base36). */
function hash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36).slice(0, 6);
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * css modules: scope every class in selectors to `name_hash`, except inside
 * `:global(...)`. a small scanner, not a css parser: text before `{` is a
 * selector (or an at-rule prelude, left alone); declarations are never touched.
 */
function scopeClasses(css: string, id: string, classes: Record<string, string>): string {
    const suffix = hash(id);
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return source.replace(/([^{};]*)\{/g, (_, prelude: string) => {
        if (prelude.trim().startsWith('@')) return `${prelude}{`;
        // mask strings + :global(...) so their contents are never scoped.
        const masked: string[] = [];
        const mask = (s: string) => `\0${masked.push(s) - 1}\0`;
        let selector = prelude
            .replace(/(["'])(?:\\.|(?!\1).)*\1/g, mask)
            .replace(/:global\(([^)]*)\)/g, (__, inner: string) => mask(inner));
        selector = selector.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (__, name: string) => {
            classes[name] ??= `${name}_${suffix}`;
            return `.${classes[name]}`;
        });
        return `${selector.replace(/\0(\d+)\0/g, (__, i: string) => masked[Number(i)])}{`;
    });
}

/**
 * `import './a.css'` → a module that owns one `<style>` tag. plain css
 * self-accepts, so an edit swaps the text in place. `*.module.css` exports its
 * scoped class names and lets the edit reach its importers instead. relative
 * `url(...)`s become imports, so `assets()` serves them.
 */
export function css(): Plugin {
    return {
        name: 'css',
        transform(code, id) {
            if (!id.endsWith('.css')) return;
            const isModule = id.endsWith('.module.css');
            const classes: Record<string, string> = {};
            const source = isModule ? scopeClasses(code, id, classes) : code;

            // split around local url()s: the css string is rebuilt at runtime around imported urls.
            const imports: string[] = [];
            const parts: string[] = [];
            let last = 0;
            for (const m of source.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
                const url = m[2].trim();
                if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
                const spec = url.startsWith('.') || url.startsWith('/') ? url : `./${url}`;
                imports.push(`import __url${imports.length} from ${JSON.stringify(spec)};`);
                parts.push(JSON.stringify(source.slice(last, m.index)), `'url("' + __url${imports.length - 1} + '")'`);
                last = m.index + m[0].length;
            }
            parts.push(JSON.stringify(source.slice(last)));

            const key = JSON.stringify(id);
            const named = Object.entries(classes)
                .filter(([name]) => IDENT.test(name) && name !== 'default')
                .map(([name, scoped]) => `export const ${name} = ${JSON.stringify(scoped)};`);
            return `${imports.join('\n')}
const css = ${parts.join(' + ')};
let style = document.querySelector(\`style[data-sbx-css=\${CSS.escape(${key})}]\`);
if (!style) {
  style = document.createElement('style');
  style.setAttribute('data-sbx-css', ${key});
  document.head.appendChild(style);
}
style.textContent = css;
if (import.meta.hot) {
  ${isModule ? '' : 'import.meta.hot.accept();\n  '}import.meta.hot.prune(() => style.remove());
}
${named.join('\n')}
export default ${isModule ? JSON.stringify(classes) : 'css'};
`;
        },
    };
}
