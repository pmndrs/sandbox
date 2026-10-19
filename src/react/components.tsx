import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createSandbox } from '../core/sandbox.ts';
import type { SandboxOptions } from '../core/types.ts';
import { SandboxContext, useSandbox, useSandboxMessages } from './context.ts';
import { MonacoEditor } from './monaco.tsx';
import { injectStyles, resolveTheme, type ThemeProp, themeToVars } from './theme.ts';

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export type SandboxProviderProps = SandboxOptions & {
    theme?: ThemeProp;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
};

/** Creates + holds one core Sandbox, injects the theme, provides context. */
export function SandboxProvider({ theme, className, style, children, ...options }: SandboxProviderProps) {
    const [sandbox] = useState(() => createSandbox(options));
    // binary files (images, fonts) run in the preview but have no editor tab.
    const files = useMemo(() => sandbox.fs.list().filter((p) => typeof sandbox.fs.read(p) === 'string'), [sandbox]);
    const [activeFile, setActiveFile] = useState(() => files.find((f) => /\/App\.[tj]sx?$/.test(f)) ?? sandbox.entry);

    useEffect(() => injectStyles(), []);
    useEffect(() => () => sandbox.dispose(), [sandbox]);

    const resolvedTheme = resolveTheme(theme);
    const vars = themeToVars(resolvedTheme);
    return (
        <SandboxContext.Provider value={{ sandbox, files, activeFile, setActiveFile, theme: resolvedTheme }}>
            <div className={`sbx-root${className ? ` ${className}` : ''}`} style={{ ...vars, ...style }}>
                {children}
            </div>
        </SandboxContext.Provider>
    );
}

export function SandboxLayout({ children }: { children?: ReactNode }) {
    return <div className="sbx-layout">{children}</div>;
}

export function FileTabs() {
    const { files, activeFile, setActiveFile } = useSandbox();
    if (files.length <= 1) return null;
    return (
        <div className="sbx-tabs">
            {files.map((path) => (
                <button
                    key={path}
                    type="button"
                    className={`sbx-tab${path === activeFile ? ' sbx-tab--active' : ''}`}
                    onClick={() => setActiveFile(path)}
                >
                    {basename(path)}
                </button>
            ))}
        </div>
    );
}

export type SandboxCodeEditorProps = { showTabs?: boolean };

/** Basic controlled editor (a styled textarea) — Monaco/highlighting slot in later. */
export function SandboxCodeEditor({ showTabs = true }: SandboxCodeEditorProps) {
    return (
        <div className="sbx-editor">
            {showTabs && <FileTabs />}
            <div className="sbx-monaco">
                <MonacoEditor />
            </div>
        </div>
    );
}

export function SandboxPreview() {
    const { sandbox } = useSandbox();
    const ref = useRef<HTMLIFrameElement>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        sandbox.attach(el);
        return sandbox.messages.subscribe((m) => {
            if (m.type === 'runtime-error')
                setError(m.loc ? `${m.loc.file}:${m.loc.line}:${m.loc.column}\n${m.message}` : m.message);
            // A clean compile/HMR apply (or a fresh load) clears a prior error — so
            // editing back to valid recovers the preview instead of staying stuck.
            else if (m.type === 'ready' || m.type === 'hmr') setError(null);
        });
    }, [sandbox]);

    return (
        <div className="sbx-preview">
            <iframe ref={ref} title="preview" />
            {error && <pre className="sbx-error-overlay">{error}</pre>}
        </div>
    );
}

type Log = { level: string; text: string };

export function SandboxConsole() {
    const [logs, setLogs] = useState<Log[]>([]);
    useSandboxMessages((m) => {
        if (m.type === 'console') setLogs((l) => [...l, { level: m.level, text: m.args.join(' ') }]);
        else if (m.type === 'runtime-error') setLogs((l) => [...l, { level: 'error', text: m.message }]);
    });
    return (
        <div className="sbx-console">
            {logs.map((log, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
                <div key={i} className={`sbx-log sbx-log--${log.level}`}>
                    {log.text}
                </div>
            ))}
        </div>
    );
}

export type SandboxProps = SandboxProviderProps & { showTabs?: boolean; showConsole?: boolean };

/** The opinionated preset: provider + editor | (preview + console). */
export function Sandbox({ showTabs, showConsole = false, ...providerProps }: SandboxProps) {
    return (
        <SandboxProvider {...providerProps}>
            <SandboxLayout>
                <SandboxCodeEditor showTabs={showTabs} />
                <div className="sbx-stack">
                    <SandboxPreview />
                    {showConsole && <SandboxConsole />}
                </div>
            </SandboxLayout>
        </SandboxProvider>
    );
}
