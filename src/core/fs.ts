import { createEmitter } from './emitter.ts';
import type { Files, Path } from './types.ts';

export type FileContent = string | Uint8Array;

/** without `watch`, call `session.update(path)` to hot-update. */
export type Fs = {
    read(path: Path): FileContent | null | undefined | Promise<FileContent | null | undefined>;
    watch?(fn: (path: Path) => void): () => void;
};

export type MemoryFs = {
    read(path: Path): FileContent | null;
    write(path: Path, content: FileContent): void;
    delete(path: Path): void;
    list(): Path[];
    watch(fn: (path: Path) => void): () => void;
};

export function memoryFs(initial: Files = {}): MemoryFs {
    const files = new Map<Path, FileContent>();
    const changes = createEmitter<Path>();
    for (const [path, source] of Object.entries(initial)) files.set(normalize(path), source);

    return {
        read: (path) => files.get(normalize(path)) ?? null,
        write(path, content) {
            const key = normalize(path);
            files.set(key, content);
            changes.emit(key);
        },
        delete(path) {
            const key = normalize(path);
            if (files.delete(key)) changes.emit(key);
        },
        list: () => [...files.keys()].sort(),
        watch: (fn) => changes.subscribe(fn),
    };
}

export function normalize(path: Path): Path {
    return path.startsWith('/') ? path : `/${path}`;
}
