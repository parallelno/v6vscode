import {
    expectRecord as object, expectInteger as integer, expectBoolean as boolean,
    expectUtf8String as utf8String, expectFields as exactFields, ValidationError,
    expectFiniteNumber as finiteNumber, expectArray,
} from '../../shared/validation';
import { CodePerfInput, CodePerfLimits, CodePerfSnapshot } from '../../emulator/protocol/debug-models';

export const DEFAULT_CODE_PERF_LIMITS: CodePerfLimits = {
    addressExclusive: 0x10000,
    maxNameBytes: 1024,
    maxRecords: 256,
    maxTestCount: 20000,
};

export function validateCodePerfInput(
    value: unknown,
    limits: CodePerfLimits = DEFAULT_CODE_PERF_LIMITS,
): CodePerfInput {
    const record = object(value, 'CodePerf input');
    exactFields(record, new Set(['name', 'addrStart', 'addrEnd', 'active']), 'CodePerf input');
    const addrStart = integer(record.addrStart, 'addrStart', 0, limits.addressExclusive - 1);
    const addrEnd = integer(record.addrEnd, 'addrEnd', 0, limits.addressExclusive - 1);
    if (addrStart >= addrEnd) { throw new ValidationError('addrEnd', 'addrEnd must be greater than addrStart', 'range'); }
    return {
        name: utf8String(record.name, 'name', limits.maxNameBytes),
        addrStart,
        addrEnd,
        active: boolean(record.active, 'active'),
    };
}

export function decodeCodePerfSnapshot(
    value: unknown,
    limits: CodePerfLimits = DEFAULT_CODE_PERF_LIMITS,
): CodePerfSnapshot {
    const record = object(value, 'CodePerf snapshot');
    exactFields(record, new Set([
        'id', 'name', 'addrStart', 'addrEnd', 'active', 'averageClockCycles', 'testCount',
    ]), 'CodePerf snapshot');
    const input = validateCodePerfInput({
        name: record.name,
        addrStart: record.addrStart,
        addrEnd: record.addrEnd,
        active: record.active,
    }, limits);
    return {
        id: integer(record.id, 'id', 0, 0x7FFFFFFF),
        ...input,
        averageClockCycles: finiteNumber(record.averageClockCycles, 'averageClockCycles', 0),
        testCount: integer(record.testCount, 'testCount', 0, limits.maxTestCount),
    };
}

export function decodeCodePerfSnapshots(
    value: unknown,
    limits: CodePerfLimits = DEFAULT_CODE_PERF_LIMITS,
): CodePerfSnapshot[] {
    const entries = expectArray(value, 'CodePerf response', limits.maxRecords).map((entry, index) => {
        try { return decodeCodePerfSnapshot(entry, limits); }
        catch (error) {
            if (error instanceof ValidationError) { throw new ValidationError(`[${index}].${error.field}`, error.message, error.reason, error); }
            throw error;
        }
    });
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1].id >= entries[index].id) {
            throw new ValidationError('entries', 'CodePerf snapshots must be ordered by unique ID', 'order');
        }
    }
    return entries;
}
