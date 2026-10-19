// Theme — modeled on sandpack-react's token system (surfaces / base / accent /
// syntax / font), expressed as `--sbx-*` CSS variables + one injected stylesheet.
// Values ported verbatim from sandpack's defaultLight / defaultDark.

import type { CSSProperties } from 'react';

export type SyntaxStyle = string | { color?: string; fontStyle?: string; fontWeight?: string; textDecoration?: string };

export type Theme = {
    colors: {
        surface1: string;
        surface2: string;
        surface3: string;
        disabled: string;
        base: string;
        clickable: string;
        hover: string;
        accent: string;
        error: string;
        errorSurface: string;
        warning: string;
        warningSurface: string;
    };
    syntax: {
        plain: SyntaxStyle;
        comment: SyntaxStyle;
        keyword: SyntaxStyle;
        tag: SyntaxStyle;
        punctuation: SyntaxStyle;
        definition: SyntaxStyle;
        property: SyntaxStyle;
        static: SyntaxStyle;
        string: SyntaxStyle;
    };
    font: { body: string; mono: string; size: string; lineHeight: string };
};

const FONT = {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: '"Fira Mono", "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", Monaco, monospace',
    size: '13px',
    lineHeight: '20px',
};

export const dark: Theme = {
    colors: {
        surface1: '#151515',
        surface2: '#252525',
        surface3: '#2F2F2F',
        disabled: '#4D4D4D',
        base: '#808080',
        clickable: '#999999',
        hover: '#C5C5C5',
        accent: '#6CAEDD',
        error: '#FFB4A6',
        errorSurface: '#690000',
        warning: '#E7C400',
        warningSurface: '#3A3000',
    },
    syntax: {
        plain: '#FFFFFF',
        comment: { color: '#757575', fontStyle: 'italic' },
        keyword: '#77B7D7',
        tag: '#DFAB5C',
        punctuation: '#FFFFFF',
        definition: '#86D9CA',
        property: '#77B7D7',
        static: '#C64640',
        string: '#977CDC',
    },
    font: FONT,
};

export const light: Theme = {
    colors: {
        surface1: '#FFFFFF',
        surface2: '#EFEFEF',
        surface3: '#F3F3F3',
        disabled: '#C5C5C5',
        base: '#323232',
        clickable: '#808080',
        hover: '#4D4D4D',
        accent: '#3973E0',
        error: '#EA3323',
        errorSurface: '#FCF1F0',
        warning: '#6A4516',
        warningSurface: '#FEF2C0',
    },
    syntax: {
        plain: '#151515',
        comment: { color: '#999999', fontStyle: 'italic' },
        keyword: '#7C5AE3',
        tag: '#0971F1',
        punctuation: '#3B3B3B',
        definition: '#85A600',
        property: '#3B3B3B',
        static: '#3B3B3B',
        string: '#2E6BD0',
    },
    font: FONT,
};

export type ThemeName = 'dark' | 'light' | 'auto';
export type ThemeProp = ThemeName | Theme;

const colorOf = (s: SyntaxStyle): string => (typeof s === 'string' ? s : (s.color ?? 'inherit'));

export function resolveTheme(theme: ThemeProp = 'dark'): Theme {
    if (typeof theme !== 'string') return theme;
    if (theme === 'light') return light;
    if (theme === 'auto') {
        const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        return prefersDark ? dark : light;
    }
    return dark;
}

/** Theme → `--sbx-*` custom properties for the root element's inline style. */
export function themeToVars(theme: Theme): CSSProperties {
    const c = theme.colors;
    const s = theme.syntax;
    return {
        '--sbx-surface-1': c.surface1,
        '--sbx-surface-2': c.surface2,
        '--sbx-surface-3': c.surface3,
        '--sbx-disabled': c.disabled,
        '--sbx-base': c.base,
        '--sbx-clickable': c.clickable,
        '--sbx-hover': c.hover,
        '--sbx-accent': c.accent,
        '--sbx-error': c.error,
        '--sbx-error-surface': c.errorSurface,
        '--sbx-warning': c.warning,
        '--sbx-warning-surface': c.warningSurface,
        '--sbx-syntax-plain': colorOf(s.plain),
        '--sbx-syntax-comment': colorOf(s.comment),
        '--sbx-syntax-keyword': colorOf(s.keyword),
        '--sbx-syntax-tag': colorOf(s.tag),
        '--sbx-syntax-punctuation': colorOf(s.punctuation),
        '--sbx-syntax-definition': colorOf(s.definition),
        '--sbx-syntax-property': colorOf(s.property),
        '--sbx-syntax-string': colorOf(s.string),
        '--sbx-font-body': theme.font.body,
        '--sbx-font-mono': theme.font.mono,
        '--sbx-font-size': theme.font.size,
        '--sbx-line-height': theme.font.lineHeight,
    } as CSSProperties;
}

/** Component stylesheet — sandpack-flavored: surfaces, thin borders, accent tab bar. */
export const STYLES = `
.sbx-root { --sbx-height: 340px; display:block; border:1px solid var(--sbx-surface-2); border-radius:8px;
  overflow:hidden; background:var(--sbx-surface-1); color:var(--sbx-base);
  font-family:var(--sbx-font-body); font-size:var(--sbx-font-size); box-sizing:border-box; }
.sbx-root *, .sbx-root *::before, .sbx-root *::after { box-sizing:border-box; }
.sbx-layout { display:flex; flex-wrap:wrap; align-items:stretch; }
.sbx-editor { display:flex; flex-direction:column; flex:1 1 340px; min-width:200px; height:var(--sbx-height);
  background:var(--sbx-surface-1); border-right:1px solid var(--sbx-surface-2); }
.sbx-tabs { display:flex; flex:0 0 auto; overflow-x:auto; background:var(--sbx-surface-1);
  border-bottom:1px solid var(--sbx-surface-2); }
.sbx-tab { flex:0 0 auto; padding:0 14px; height:40px; line-height:40px; border:none; background:transparent;
  color:var(--sbx-base); font:inherit; font-size:12px; cursor:pointer; border-bottom:2px solid transparent;
  transition:color .12s ease; }
.sbx-tab:hover { color:var(--sbx-hover); }
.sbx-tab--active { color:var(--sbx-hover); border-bottom-color:var(--sbx-accent); }
.sbx-code { flex:1 1 auto; width:100%; resize:none; border:none; outline:none; padding:12px 16px; margin:0;
  background:var(--sbx-surface-1); color:var(--sbx-syntax-plain); caret-color:var(--sbx-accent);
  font-family:var(--sbx-font-mono); font-size:var(--sbx-font-size); line-height:var(--sbx-line-height); tab-size:2; }
.sbx-monaco { flex:1 1 auto; min-height:0; overflow:hidden; }
.sbx-stack { display:flex; flex-direction:column; flex:1 1 340px; min-width:200px; height:var(--sbx-height);
  background:var(--sbx-surface-1); }
.sbx-preview { position:relative; flex:1 1 auto; min-height:0; background:#fff; }
.sbx-preview iframe { display:block; width:100%; height:100%; border:none; background:#fff; }
.sbx-error-overlay { position:absolute; inset:0; overflow:auto; padding:16px; margin:0;
  background:var(--sbx-error-surface); color:var(--sbx-error);
  font-family:var(--sbx-font-mono); font-size:12px; line-height:1.5; white-space:pre-wrap; }
.sbx-console { flex:0 0 auto; max-height:160px; overflow:auto; background:var(--sbx-surface-1);
  border-top:1px solid var(--sbx-surface-2); font-family:var(--sbx-font-mono); font-size:12px; }
.sbx-console:empty { display:none; }
.sbx-log { padding:4px 14px; border-bottom:1px solid var(--sbx-surface-2); color:var(--sbx-clickable);
  white-space:pre-wrap; word-break:break-word; }
.sbx-log--error { color:var(--sbx-error); }
.sbx-log--warn { color:var(--sbx-warning); }
`;

const STYLE_ID = 'sbx-styles';

/** Inject the component stylesheet once. Safe to call repeatedly + on SSR. */
export function injectStyles(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLES;
    doc.head.appendChild(el);
}
