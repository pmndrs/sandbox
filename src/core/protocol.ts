/** tags our postMessages so unrelated messages on the channel are ignored. */
export const SBX = '@pmndrs/sandbox';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** 1-based, in the user's original source. */
export type ErrorLoc = { file: string; line: number; column: number };

export type ErrorInfo = { message: string; stack?: string; loc?: ErrorLoc };

/** opaque: host and client only route it. */
export type HotPayload = { type: string; [key: string]: unknown };

export type HostMessage =
    | { src: typeof SBX; type: 'invoke-result'; id: number; result?: unknown; error?: ErrorInfo }
    | { src: typeof SBX; type: 'hot'; payload: HotPayload };

export type ClientMessage =
    | { src: typeof SBX; type: 'ready' }
    | { src: typeof SBX; type: 'invoke'; id: number; payload: HotPayload }
    | { src: typeof SBX; type: 'hot'; payload: HotPayload }
    | { src: typeof SBX; type: 'console'; level: ConsoleLevel; args: string[] }
    | ({ src: typeof SBX; type: 'runtime-error' } & ErrorInfo);

export type HmrUpdate =
    | { type: 'update'; boundaries: string[] }
    | { type: 'full-reload' }
    /** modules nothing imports any more; their dispose/prune handlers ran. */
    | { type: 'prune'; paths: string[] };

export type MountEvent =
    | { type: 'ready' }
    | { type: 'console'; level: ConsoleLevel; args: string[] }
    | ({ type: 'runtime-error' } & ErrorInfo)
    | { type: 'hmr'; update: HmrUpdate };

export type ClientConfig = { entry: string; env: Record<string, unknown> };

export const isClientMessage = (d: unknown): d is ClientMessage =>
    typeof d === 'object' && d !== null && (d as { src?: unknown }).src === SBX;

export const isHostMessage = (d: unknown): d is HostMessage =>
    typeof d === 'object' && d !== null && (d as { src?: unknown }).src === SBX;
