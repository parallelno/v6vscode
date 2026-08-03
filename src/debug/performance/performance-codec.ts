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
    if (addrStart >= addrEnd) { throw new Error('addrEnd must be greater than addrStart'); }
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
    if (!Array.isArray(value)) { throw new Error('CodePerf response must be an array'); }
    if (value.length > limits.maxRecords) { throw new Error('CodePerf response exceeds maxRecords'); }
    const entries = value.map(entry => decodeCodePerfSnapshot(entry, limits));
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1].id >= entries[index].id) {
            throw new Error('CodePerf snapshots must be ordered by unique ID');
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

function exactFields(record: Record<string, unknown>, allowed: Set<string>, name: string): void {
    const unknown = Object.keys(record).find(field => !allowed.has(field));
    if (unknown) { throw new Error(`Unknown ${name} field: ${unknown}`); }
    const missing = [...allowed].find(field => !(field in record));
    if (missing) { throw new Error(`Missing ${name} field: ${missing}`); }
}

function integer(value: unknown, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${name} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function finiteNumber(value: unknown, name: string, min: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
        throw new Error(`${name} must be a finite number greater than or equal to ${min}`);
    }
    return value;
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