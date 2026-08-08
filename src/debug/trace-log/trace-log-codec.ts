import {
    TraceLogEntry,
    TraceLogFilterResponse,
    TraceLogWindowResponse,
} from '../../emulator/protocol/ipc-commands';

export function decodeTraceLogFilterResponse(value: unknown, capacity: number): TraceLogFilterResponse {
    const record = exactRecord(value, ['filterId', 'totalMatches'], 'trace-log filter response');
    const filterId = integer(record.filterId, 1, Number.MAX_SAFE_INTEGER, 'filterId');
    const totalMatches = integer(record.totalMatches, 0, capacity, 'totalMatches');
    return Object.freeze({ filterId, totalMatches });
}

export function decodeTraceLogWindowResponse(
    value: unknown,
    expectedStart: number,
    requestedLines: number,
    totalMatches: number,
): TraceLogWindowResponse {
    const record = exactRecord(value, ['start', 'entries'], 'trace-log window response');
    const start = integer(record.start, 0, totalMatches, 'start');
    if (start !== expectedStart) {
        throw new Error(`Trace-log window start ${start} does not match requested start ${expectedStart}`);
    }
    if (!Array.isArray(record.entries) || record.entries.length > requestedLines) {
        throw new Error(`Trace-log entries must be an array of at most ${requestedLines} rows`);
    }
    const expectedEntries = Math.min(requestedLines, totalMatches - start);
    if (record.entries.length !== expectedEntries) {
        throw new Error(`Trace-log window must contain ${expectedEntries} rows`);
    }
    if (start + record.entries.length > totalMatches) {
        throw new Error('Trace-log window extends beyond the filtered result');
    }
    const entries = record.entries.map((entry, index) => decodeEntry(entry, index));
    return Object.freeze({ start, entries: Object.freeze(entries) });
}

function decodeEntry(value: unknown, index: number): TraceLogEntry {
    const record = exactRecord(value, ['address', 'bytes', 'instruction'], `trace-log entry ${index}`);
    const address = integer(record.address, 0, 0xFFFF, `entries[${index}].address`);
    if (!Array.isArray(record.bytes) || record.bytes.length < 1 || record.bytes.length > 3) {
        throw new Error(`entries[${index}].bytes must contain one to three bytes`);
    }
    const bytes = record.bytes.map((byte, byteIndex) =>
        integer(byte, 0, 0xFF, `entries[${index}].bytes[${byteIndex}]`));
    if (typeof record.instruction !== 'string' || record.instruction.length === 0) {
        throw new Error(`entries[${index}].instruction must be a non-empty string`);
    }
    return Object.freeze({
        address,
        bytes: Object.freeze(bytes),
        instruction: record.instruction,
    });
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new Error(`${label} must contain exactly ${fields.join(', ')}`);
    }
    return record;
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${field} must be an integer in ${minimum}..${maximum}`);
    }
    return value as number;
}