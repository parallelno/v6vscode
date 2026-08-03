import { CodePerfInput, CodePerfSnapshot } from '../../emulator/protocol/debug-models';

export type PerformanceWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; input: CodePerfInput }
    | { type: 'edit'; generation: number; id: number; input: CodePerfInput }
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
    | { type: 'snapshot'; generation: number; entries: readonly CodePerfSnapshot[] }
    | { type: 'operation'; operation: string; ok: boolean; message: string }
    | { type: 'beginAdd' }
    | { type: 'dismissMenus' }
    | { type: 'restoredQuery'; value: string };