/** tag on every sandbox postMessage, so we ignore unrelated messages on the channel. */
export const SBX = '@pmndrs/sandbox';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** where an error happened in the user's source (1-based line + column). */
export type ErrorLoc = { file: string; line: number; column: number };

/** an error as it crosses postMessage. */
export type ErrorInfo = { message: string; stack?: string; loc?: ErrorLoc };

/** vite's hot payload, kept opaque — host and client only route it. */
export type HotPayload = { type: string; [key: string]: unknown };

/** host (page) → iframe client. */
export type HostMessage =
    | { src: typeof SBX; type: 'invoke-result'; id: number; result?: unknown; error?: ErrorInfo }
    | { src: typeof SBX; type: 'hot'; payload: HotPayload };

/** iframe client → host (page). */
export type ClientMessage =
    | { src: typeof SBX; type: 'ready' }
    | { src: typeof SBX; type: 'invoke'; id: number; payload: HotPayload }
    | { src: typeof SBX; type: 'hot'; payload: HotPayload }
    | { src: typeof SBX; type: 'console'; level: ConsoleLevel; args: string[] }
    | ({ src: typeof SBX; type: 'runtime-error' } & ErrorInfo);

/** the outcome of a file change, per mount. */
export type HmrUpdate =
    | { type: 'update'; boundaries: string[] }
    | { type: 'full-reload' }
    /** modules nothing imports any more; their dispose/prune handlers ran. */
    | { type: 'prune'; paths: string[] };

/** what a mount reports to the host page. */
export type MountEvent =
    | { type: 'ready' }
    | { type: 'console'; level: ConsoleLevel; args: string[] }
    | ({ type: 'runtime-error' } & ErrorInfo)
    | { type: 'hmr'; update: HmrUpdate };

/** config the host bakes into the preview document for the client. */
export type ClientConfig = { entry: string; env: Record<string, unknown> };

export const isClientMessage = (d: unknown): d is ClientMessage =>
    typeof d === 'object' && d !== null && (d as { src?: unknown }).src === SBX;

export const isHostMessage = (d: unknown): d is HostMessage =>
    typeof d === 'object' && d !== null && (d as { src?: unknown }).src === SBX;
