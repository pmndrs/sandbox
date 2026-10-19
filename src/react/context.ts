import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { MountEvent } from '../core/protocol.ts';
import type { Sandbox } from '../core/sandbox.ts';
import type { Theme } from './theme.ts';

export type SandboxContextValue = {
    sandbox: Sandbox;
    files: string[];
    activeFile: string;
    setActiveFile: (path: string) => void;
    theme: Theme;
};

export const SandboxContext = createContext<SandboxContextValue | null>(null);

export function useSandbox(): SandboxContextValue {
    const ctx = useContext(SandboxContext);
    if (!ctx) throw new Error('useSandbox must be used inside <SandboxProvider>');
    return ctx;
}

const textOf = (content: unknown): string => (typeof content === 'string' ? content : '');

/** `setCode` writes through to the fs, so it triggers hmr. */
export function useActiveFile(): { path: string; code: string; setCode: (next: string) => void } {
    const { sandbox, activeFile } = useSandbox();
    const [code, setCode] = useState(() => textOf(sandbox.fs.read(activeFile)));

    useEffect(() => {
        setCode(textOf(sandbox.fs.read(activeFile)));
    }, [sandbox, activeFile]);

    const write = useCallback(
        (next: string) => {
            setCode(next);
            sandbox.update(activeFile, next);
        },
        [sandbox, activeFile],
    );

    return { path: activeFile, code, setCode: write };
}

export function useSandboxMessages(onMessage: (message: MountEvent) => void): void {
    const { sandbox } = useSandbox();
    useEffect(() => sandbox.messages.subscribe(onMessage), [sandbox, onMessage]);
}
