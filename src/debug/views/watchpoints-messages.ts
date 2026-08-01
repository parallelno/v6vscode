import { WatchpointAddRequest, WatchpointEntry } from '../../emulator/protocol/debug-models';

export type WatchpointsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; candidate: WatchpointAddRequest }
    | { type: 'edit'; generation: number; candidate: WatchpointEntry }
    | { type: 'delete'; generation: number; id: number }
    | { type: 'disableAll'; generation: number }
    | { type: 'deleteAll'; generation: number }
    | { type: 'preview'; generation: number; id: number }
    | { type: 'reveal'; generation: number; id: number };

export type WatchpointsHostMessage =
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error'; message: string; canMutate: boolean }
    | { type: 'snapshot'; generation: number; entries: readonly WatchpointEntry[] }
    | { type: 'operation'; operation: string; ok: boolean; message: string }
    | { type: 'preview'; id: number; text: string };