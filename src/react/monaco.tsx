import Editor, { type Monaco } from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import { useActiveFile, useSandbox } from './context.ts';
import type { SyntaxStyle, Theme } from './theme.ts';

function useTypeAcquisition(monaco: Monaco | null): void {
    const { sandbox } = useSandbox();
    useEffect(() => {
        if (!monaco) return;
        let cancelled = false;
        const disposers: { dispose(): void }[] = [];
        sandbox
            .types()
            .then(({ files }) => {
                if (cancelled) return;
                const ts = monaco.languages.typescript;
                for (const f of files) {
                    disposers.push(ts.typescriptDefaults.addExtraLib(f.content, f.path));
                    disposers.push(ts.javascriptDefaults.addExtraLib(f.content, f.path));
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
            for (const d of disposers) d.dispose();
        };
    }, [monaco, sandbox]);
}

const MONO = '"Fira Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
const THEME_NAME = 'sbx';

function langOf(path: string): string {
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
    if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs')) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'plaintext';
}

const hex = (s: SyntaxStyle): string => (typeof s === 'string' ? s : (s.color ?? '#000000')).replace('#', '');
const italic = (s: SyntaxStyle): boolean => typeof s !== 'string' && s.fontStyle === 'italic';
const isDark = (theme: Theme): boolean => {
    const c = theme.colors.surface1.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
};

function defineTheme(monaco: Monaco, theme: Theme): void {
    const s = theme.syntax;
    monaco.editor.defineTheme(THEME_NAME, {
        base: isDark(theme) ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
            { token: '', foreground: hex(s.plain) },
            { token: 'comment', foreground: hex(s.comment), fontStyle: italic(s.comment) ? 'italic' : '' },
            { token: 'keyword', foreground: hex(s.keyword) },
            { token: 'string', foreground: hex(s.string) },
            { token: 'number', foreground: hex(s.static) },
            { token: 'type', foreground: hex(s.definition) },
            { token: 'type.identifier', foreground: hex(s.definition) },
            { token: 'delimiter', foreground: hex(s.punctuation) },
            { token: 'tag', foreground: hex(s.tag) },
            { token: 'attribute.name', foreground: hex(s.property) },
            { token: 'attribute.value', foreground: hex(s.string) },
        ],
        colors: {
            'editor.background': theme.colors.surface1,
            'editor.foreground': hex(s.plain) ? `#${hex(s.plain)}` : theme.colors.base,
            'editorLineNumber.foreground': theme.colors.disabled,
            'editorLineNumber.activeForeground': theme.colors.clickable,
            'editorCursor.foreground': theme.colors.accent,
            'editor.selectionBackground': `${theme.colors.accent}33`,
            'editor.lineHighlightBackground': theme.colors.surface2,
            'editorIndentGuide.background1': theme.colors.surface2,
            'scrollbarSlider.background': `${theme.colors.disabled}66`,
        },
    });
}

function configureTs(monaco: Monaco): void {
    const ts = monaco.languages.typescript;
    const options = {
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: 'react',
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        allowJs: true,
        esModuleInterop: true,
    };
    ts.typescriptDefaults.setCompilerOptions(options);
    ts.javascriptDefaults.setCompilerOptions(options);
    // bare-import "cannot find module": noise until type acquisition loads the .d.ts.
    const diag = { diagnosticCodesToIgnore: [2307, 2792] };
    ts.typescriptDefaults.setDiagnosticsOptions(diag);
    ts.javascriptDefaults.setDiagnosticsOptions(diag);
}

export function MonacoEditor() {
    const { theme } = useSandbox();
    const { path, code, setCode } = useActiveFile();
    const [monaco, setMonaco] = useState<Monaco | null>(null);
    useTypeAcquisition(monaco);
    return (
        <Editor
            // `file://` uri so node_modules resolution reaches the acquired `.d.ts`.
            path={`file://${path}`}
            language={langOf(path)}
            value={code}
            theme={THEME_NAME}
            onChange={(value) => setCode(value ?? '')}
            beforeMount={(m) => {
                configureTs(m);
                defineTheme(m, theme);
            }}
            onMount={(_editor, m) => setMonaco(m)}
            loading={<div style={{ padding: 12, color: theme.colors.base, fontFamily: MONO }}>Loading editor…</div>}
            options={{
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                tabSize: 2,
                padding: { top: 12, bottom: 12 },
                lineNumbersMinChars: 3,
                renderLineHighlight: 'line',
                overviewRulerLanes: 0,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            }}
        />
    );
}
