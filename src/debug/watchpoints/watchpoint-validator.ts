import {
    DebugCondition,
    WatchpointAccess,
    WatchpointAddRequest,
    WatchpointEntry,
    WatchpointType,
} from '../../emulator/protocol/debug-models';

const ACCESS = new Set<WatchpointAccess>(['R', 'W', 'RW']);
const CONDITIONS = new Set<DebugCondition>([
    'ANY', 'EQU', 'LESS', 'GREATER', 'LESS_EQU', 'GREATER_EQU', 'NOT_EQU',
]);
const TYPES = new Set<WatchpointType>(['LEN', 'WORD']);
const CONFIG_FIELDS = ['globalAddr', 'len', 'value', 'access', 'condition', 'type', 'active', 'comment'];

export interface WatchpointValidationLimits {
    maxGlobalAddress: number;
    maxRangeLength: number;
    maxCommentBytes: number;
}

export const DEFAULT_WATCHPOINT_LIMITS: WatchpointValidationLimits = {
    maxGlobalAddress: 0x20FFFF,
    maxRangeLength: 0xFFFF,
    maxCommentBytes: 1024,
};

export function validateWatchpointConfig(
    value: unknown,
    limits: WatchpointValidationLimits = DEFAULT_WATCHPOINT_LIMITS,
): WatchpointAddRequest {
    if (!isRecord(value)) { throw new Error('Watchpoint must be an object'); }
    rejectUnknownFields(value, CONFIG_FIELDS);
    const globalAddr = integer(value.globalAddr, 'globalAddr', 0, limits.maxGlobalAddress);
    const len = integer(value.len, 'len', 1, limits.maxRangeLength);
    if (globalAddr + len - 1 > limits.maxGlobalAddress) {
        throw new Error('Watchpoint range exceeds global memory');
    }
    const type = enumValue(value.type, 'type', TYPES);
    if (type === 'WORD' && len !== 2) { throw new Error('WORD watchpoints require len = 2'); }
    const valueLimit = type === 'WORD' ? 0xFFFF : 0xFF;
    return {
        globalAddr,
        len,
        value: integer(value.value, 'value', 0, valueLimit),
        access: enumValue(value.access, 'access', ACCESS),
        condition: enumValue(value.condition, 'condition', CONDITIONS),
        type,
        active: booleanValue(value.active, 'active'),
        comment: utf8String(value.comment, 'comment', limits.maxCommentBytes),
    };
}

export function decodeWatchpointEntry(
    value: unknown,
    limits: WatchpointValidationLimits = DEFAULT_WATCHPOINT_LIMITS,
): WatchpointEntry {
    if (!isRecord(value)) { throw new Error('Watchpoint entry must be an object'); }
    rejectUnknownFields(value, [...CONFIG_FIELDS, 'id']);
    return { id: integer(value.id, 'id', 0, Number.MAX_SAFE_INTEGER), ...validateFields(value, limits) };
}

export function decodeWatchpointList(
    value: unknown,
    limits: WatchpointValidationLimits = DEFAULT_WATCHPOINT_LIMITS,
): WatchpointEntry[] {
    if (!Array.isArray(value)) { throw new Error('Watchpoint list must be an array'); }
    const entries = value.map(entry => decodeWatchpointEntry(entry, limits));
    const ids = new Set<number>();
    for (const entry of entries) {
        if (ids.has(entry.id)) { throw new Error(`Duplicate watchpoint id ${entry.id}`); }
        ids.add(entry.id);
    }
    return entries.sort((left, right) => left.id - right.id);
}

function validateFields(value: Record<string, unknown>, limits: WatchpointValidationLimits): WatchpointAddRequest {
    const config = Object.fromEntries(CONFIG_FIELDS.map(field => [field, value[field]]));
    return validateWatchpointConfig(config, limits);
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[]): void {
    const allowedFields = new Set(allowed);
    const unknown = Object.keys(value).find(field => !allowedFields.has(field));
    if (unknown) { throw new Error(`Unknown watchpoint field: ${unknown}`); }
}

function integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${field} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function enumValue<T extends string>(value: unknown, field: string, values: Set<T>): T {
    if (typeof value !== 'string' || !values.has(value as T)) { throw new Error(`Invalid ${field}`); }
    return value as T;
}

function booleanValue(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') { throw new Error(`${field} must be a boolean`); }
    return value;
}

function utf8String(value: unknown, field: string, maxBytes: number): string {
    if (typeof value !== 'string') { throw new Error(`${field} must be a string`); }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) { throw new Error(`${field} exceeds ${maxBytes} UTF-8 bytes`); }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}