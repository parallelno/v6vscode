import { MemoryEditInput, MemoryEditSnapshot } from '../../emulator/protocol/debug-models';

export interface MemoryEditValidationLimits {
    globalAddressExclusive: number;
    maxCommentBytes: number;
}

export const DEFAULT_MEMORY_EDIT_LIMITS: MemoryEditValidationLimits = {
    globalAddressExclusive: 0x210000,
    maxCommentBytes: 1024,
};

export function validateMemoryEditInput(
    value: unknown,
    limits: MemoryEditValidationLimits = DEFAULT_MEMORY_EDIT_LIMITS,
): MemoryEditInput {
    const record = object(value, 'memory edit');
    const allowed = new Set(['globalAddr', 'enteredValue', 'readonly', 'active', 'comment']);
    const unknown = Object.keys(record).find(field => !allowed.has(field));
    if (unknown) { throw new Error(`Unknown memory edit field: ${unknown}`); }
    return {
        globalAddr: integer(record.globalAddr, 'globalAddr', 0, limits.globalAddressExclusive - 1),
        enteredValue: integer(record.enteredValue, 'enteredValue', 0, 0xFF),
        readonly: boolean(record.readonly, 'readonly'),
        active: boolean(record.active, 'active'),
        comment: utf8String(record.comment, 'comment', limits.maxCommentBytes),
    };
}

export function decodeMemoryEditSnapshot(
    value: unknown,
    limits: MemoryEditValidationLimits = DEFAULT_MEMORY_EDIT_LIMITS,
): MemoryEditSnapshot {
    const record = object(value, 'memory edit snapshot');
    const input = {
        globalAddr: record.globalAddr,
        enteredValue: record.enteredValue,
        readonly: record.readonly,
        active: record.active,
        comment: record.comment,
    };
    return {
        ...validateMemoryEditInput(input, limits),
        originalValue: integer(record.originalValue, 'originalValue', 0, 0xFF),
        currentValue: integer(record.currentValue, 'currentValue', 0, 0xFF),
    };
}

export function decodeMemoryEditList(
    value: unknown,
    limits: MemoryEditValidationLimits = DEFAULT_MEMORY_EDIT_LIMITS,
): MemoryEditSnapshot[] {
    const root = object(value, 'memory edit response');
    if (!Array.isArray(root.edits)) { throw new Error('Memory edit response edits must be an array'); }
    const entries = root.edits.map(entry => decodeMemoryEditSnapshot(entry, limits));
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1].globalAddr >= entries[index].globalAddr) {
            throw new Error('Memory edit snapshots must be ordered by unique global address');
        }
    }
    return entries;
}

function object(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${name} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') { throw new Error(`${name} must be a boolean`); }
    return value;
}

function utf8String(value: unknown, name: string, maxBytes: number): string {
    if (typeof value !== 'string') { throw new Error(`${name} must be a string`); }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new Error(`${name} exceeds ${maxBytes} UTF-8 bytes`);
    }
    return value;
}