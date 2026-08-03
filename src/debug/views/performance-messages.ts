import { CodePerfInput, CodePerfSnapshot } from '../../emulator/protocol/debug-models';

export type PerformanceCandidate = Omit<CodePerfInput, 'addrStart' | 'addrEnd'> & {
    addrStart: string | number;
    addrEnd: string | number;
};
export type PerformanceViewEntry = Omit<CodePerfSnapshot, 'addrStart' | 'addrEnd'> & {
    addrStart: string;
    addrEnd: string;
};

export type PerformanceWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; input: PerformanceCandidate }
    | { type: 'edit'; generation: number; id: number; input: PerformanceCandidate }
    | { type: 'setActivity'; generation: number; id: number; active: boolean }
    | { type: 'disable'; generation: number; id: number }
    | { type: 'disableAll'; generation: number }
    | { type: 'delete'; generation: number; id: number }
    | { type: 'deleteAll'; generation: number }
    | { type: 'reveal'; generation: number; id: number }
    | { type: 'persistQuery'; value: string };

export type PerformanceHostMessage =
    | {
        type: 'state';
        state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error';
        message: string;
        canMutate: boolean;
    }
    | { type: 'snapshot'; generation: number; entries: readonly PerformanceViewEntry[] }
    | { type: 'operation'; operation: string; ok: boolean; message: string; field?: 'addrStart' | 'addrEnd' }
    | { type: 'beginAdd' }
    | { type: 'dismissMenus' }
    | { type: 'restoredQuery'; value: string };