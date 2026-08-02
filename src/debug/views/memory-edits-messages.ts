import { MemoryEditSnapshot } from '../../emulator/protocol/debug-models';

export type MemoryEditValueField = 'originalValue' | 'enteredValue' | 'currentValue';

export type MemoryEditsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'add'; generation: number; globalAddr: number; value: number }
    | { type: 'disable'; generation: number; globalAddr: number }
    | { type: 'disableAll'; generation: number }
    | { type: 'deleteAll'; generation: number }
    | { type: 'deleteAndRestoreAll'; generation: number }
    | { type: 'setEntered'; generation: number; globalAddr: number; value: number }
    | { type: 'setActivity'; generation: number; globalAddr: number; enabled: boolean }
    | { type: 'setAutoUpdate'; generation: number; globalAddr: number; enabled: boolean }
    | { type: 'copy'; generation: number; globalAddr: number; field: MemoryEditValueField }
    | { type: 'reveal'; generation: number; globalAddr: number }
    | { type: 'restore'; generation: number; globalAddr: number }
    | { type: 'delete'; generation: number; globalAddr: number }
    | { type: 'deleteAndRestore'; generation: number; globalAddr: number }
    | { type: 'persistQuery'; value: string };

export type MemoryEditsHostMessage =
    | {
        type: 'state';
        state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error';
        message: string;
        canMutate: boolean;
        canRestore: boolean;
    }
    | { type: 'snapshot'; generation: number; entries: readonly MemoryEditSnapshot[] }
    | { type: 'operation'; operation: string; ok: boolean; message: string }
    | { type: 'beginAdd' }
    | { type: 'restoredQuery'; value: string };