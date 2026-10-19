export type Emitter<T> = {
    subscribe(fn: (value: T) => void): () => void;
    emit(value: T): void;
    clear(): void;
};

export function createEmitter<T>(): Emitter<T> {
    const listeners = new Set<(value: T) => void>();
    return {
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        emit(value) {
            for (const fn of listeners) fn(value);
        },
        clear() {
            listeners.clear();
        },
    };
}
