import { PerformanceWebviewMessage } from './performance-messages';
import { MemoryEditsWebviewMessage } from './memory-edits-messages';

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function integer(value: unknown, max: number): boolean { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max; }
function envelope(value: unknown): value is Record<string, unknown> {
    return record(value) && typeof value.type === 'string'
        && (value.type === 'ready' || value.type === 'persistQuery' || integer(value.generation, Number.MAX_SAFE_INTEGER));
}

export function decodePerformanceMessage(value: unknown): PerformanceWebviewMessage | undefined {
    if (!envelope(value)) { return undefined; }
    const type = value.type;
    if (type === 'ready') { return { type }; }
    if (type === 'persistQuery') { return typeof value.value === 'string' && value.value.length <= 4096 ? { type, value: value.value } : undefined; }
    if (['refresh', 'disableAll', 'deleteAll'].includes(String(type))) { return value as unknown as PerformanceWebviewMessage; }
    if (!['add', 'edit', 'setActivity', 'disable', 'delete', 'reveal'].includes(String(type))) { return undefined; }
    if (type !== 'add' && !integer(value.id, 0x7FFFFFFF)) { return undefined; }
    if (type === 'setActivity' && typeof value.active !== 'boolean') { return undefined; }
    if (type === 'add' || type === 'edit') {
        const input = value.input;
        if (!record(input) || typeof input.name !== 'string' || input.name.length > 4096 || typeof input.active !== 'boolean'
            || !['addrStart', 'addrEnd'].every(field => typeof input[field] === 'string' && (input[field] as string).length <= 4096
                || integer(input[field], 0xFFFF))) { return undefined; }
    }
    return value as unknown as PerformanceWebviewMessage;
}

export function decodeMemoryEditsMessage(value: unknown): MemoryEditsWebviewMessage | undefined {
    if (!envelope(value)) { return undefined; }
    const type = value.type;
    if (type === 'ready') { return { type }; }
    if (type === 'persistQuery') { return typeof value.value === 'string' && value.value.length <= 4096 ? { type, value: value.value } : undefined; }
    if (['refresh', 'disableAll', 'deleteAll', 'deleteAndRestoreAll'].includes(String(type))) { return value as unknown as MemoryEditsWebviewMessage; }
    if (!['add', 'disable', 'setEntered', 'setActivity', 'setAutoUpdate', 'copy', 'reveal', 'restore', 'delete', 'deleteAndRestore'].includes(String(type))
        || !integer(value.globalAddr, 0x20FFFF)) { return undefined; }
    if ((type === 'add' || type === 'setEntered') && !integer(value.value, 255)) { return undefined; }
    if ((type === 'setActivity' || type === 'setAutoUpdate') && typeof value.enabled !== 'boolean') { return undefined; }
    if (type === 'copy' && !['originalValue', 'enteredValue', 'currentValue'].includes(String(value.field))) { return undefined; }
    return value as unknown as MemoryEditsWebviewMessage;
}