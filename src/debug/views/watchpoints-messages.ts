import { WatchpointAddRequest, WatchpointEntry } from '../../emulator/protocol/debug-models';

export type WatchpointCandidate = Omit<WatchpointAddRequest, 'globalAddr'> & { globalAddr: string | number };
export type WatchpointEditCandidate = WatchpointCandidate & { id: number };
export type WatchpointViewEntry = Omit<WatchpointEntry, 'globalAddr'> & { globalAddr: string };

export type WatchpointsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; candidate: WatchpointCandidate }
    | { type: 'edit'; generation: number; candidate: WatchpointEditCandidate }
    | { type: 'delete'; generation: number; id: number }
    | { type: 'disableAll'; generation: number }
    | { type: 'deleteAll'; generation: number }
    | { type: 'preview'; generation: number; id: number }
    | { type: 'reveal'; generation: number; id: number };

export type WatchpointsHostMessage =
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error'; message: string; canMutate: boolean }
    | { type: 'snapshot'; generation: number; entries: readonly WatchpointViewEntry[] }
    | { type: 'stop'; ids: readonly number[] }
    | { type: 'operation'; operation: string; ok: boolean; message: string; field?: string }
    | { type: 'preview'; id: number; text: string };