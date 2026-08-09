import { ScriptInput, ScriptSnapshot } from '../../emulator/protocol/debug-models';

export type ScriptField = 'compilation' | 'activity' | 'name' | 'path';

export type ScriptsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; input: ScriptInput }
    | { type: 'edit'; generation: number; scriptId: number; input: ScriptInput }
    | { type: 'setActivity'; generation: number; scriptId: number; active: boolean }
    | { type: 'compile'; generation: number; scriptId: number }
    | { type: 'runOnce'; generation: number; scriptId: number }
    | { type: 'disable'; generation: number; scriptId: number }
    | { type: 'disableAll'; generation: number }
    | { type: 'delete'; generation: number; scriptId: number }
    | { type: 'deleteAll'; generation: number }
    | { type: 'copy'; generation: number; scriptId: number; field: ScriptField }
    | { type: 'persistQuery'; value: string };

export type ScriptsHostMessage =
    | {
        type: 'state';
        state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error';
        message: string;
        canMutate: boolean;
        canRunOnce: boolean;
    }
    | { type: 'snapshot'; generation: number; entries: readonly ScriptSnapshot[]; maxNameBytes: number; maxPathBytes: number }
    | { type: 'operation'; operation: string; ok: boolean; message: string; field?: 'name' | 'path' }
    | { type: 'beginAdd' }
    | { type: 'dismissMenus' }
    | { type: 'restoredQuery'; value: string };
