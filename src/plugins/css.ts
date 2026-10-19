import type { Plugin } from '../core/plugin.ts';

function hash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(36).slice(0, 6);
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** a scanner, not a css parser: text before `{` is a selector (or an at-rule prelude, left alone). */
function scopeClasses(css: string, id: string, classes: Record<string, string>): string {
    const suffix = hash(id);
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return source.replace(/([^{};]*)\{/g, (_, prelude: string) => {
        if (prelude.trim().startsWith('@')) return `${prelude}{`;
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
 * plain css self-accepts (edits swap the text in place); `*.module.css` doesn't,
 * so edits reach importers holding its class names. relative `url()`s become imports for `assets()`.
 */
export function css(): Plugin {
    return {
        name: 'css',
        transform(code, id) {
            if (!id.endsWith('.css')) return;
            const isModule = id.endsWith('.module.css');
            const classes: Record<string, string> = {};
            const source = isModule ? scopeClasses(code, id, classes) : code;

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
