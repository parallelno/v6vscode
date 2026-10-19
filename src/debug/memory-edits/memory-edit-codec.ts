import {
    expectRecord as object, expectInteger as integer, expectBoolean as boolean,
    expectUtf8String as utf8String, expectFields as exactFields, expectArray, ValidationError,
} from '../../shared/validation';
import { MemoryEditInput, MemoryEditSnapshot, MemoryEditRestoreResponse } from '../../emulator/protocol/debug-models';

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
    exactFields(record, allowed, 'memory edit', false);

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
    const entries = expectArray(root.edits, 'Memory edit response edits').map((entry, index) => {
        try { return decodeMemoryEditSnapshot(entry, limits); }
        catch (error) {
            if (error instanceof ValidationError) { throw new ValidationError(`edits[${index}].${error.field}`, error.message, error.reason, error); }
            throw error;
        }
    });
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1].globalAddr >= entries[index].globalAddr) {
            throw new ValidationError('edits', 'Memory edit snapshots must be ordered by unique global address', 'order');
        }
    }
    return entries;
}

export function decodeMemoryEditRestore(value: unknown): MemoryEditRestoreResponse {
    const record = object(value, 'memory edit restore');
    if (record.deleted !== true) { throw new ValidationError('deleted', 'Memory edit restore returned an invalid result: deleted must be true', 'value'); }
    return {
        globalAddr: integer(record.globalAddr, 'globalAddr', 0, Number.MAX_SAFE_INTEGER),
        restoredValue: integer(record.restoredValue, 'restoredValue', 0, 0xFF),
        deleted: true,
    };
}
