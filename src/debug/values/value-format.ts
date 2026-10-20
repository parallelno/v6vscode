import { formatHex } from '../../shared/numbers';
import { TypeInfo } from '../metadata/dwarf-types';
import { EvaluatedLocation } from '../metadata/dwarf-expression';

/**
 * Shared value presentation for debugger values.
 *
 * This module is the single source of truth for how a TypedValue is decoded,
 * aggregated, and rendered. Variable rows (Watch/Variables), struct pools,
 * expression evaluation, and editor hovers all format through these helpers so
 * the same value always presents the same way regardless of which feature
 * displays it.
 */

// ---------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------

/** A decoded value with its optional C type, location, and raw bytes. */
export interface TypedValue {
    type?: TypeInfo;
    storage?: EvaluatedLocation;
    bytes?: Uint8Array;
    address?: number;
    availability: 'available' | 'optimized-out' | 'inactive' | 'unsupported' | 'unreadable';
}

// ---------------------------------------------------------------------------
// Decoding and character/address helpers
// ---------------------------------------------------------------------------

/** Little-endian unsigned decode of up to four bytes. */
export function decode(bytes: Uint8Array | undefined): number {
    let value = 0;
    for (let index = 0; index < Math.min(bytes?.length ?? 0, 4); index++) { value |= bytes![index] << (index * 8); }
    return value >>> 0;
}

/** Reinterprets a decoded value as signed for the given byte width. */
export function signed(value: number, byteSize: number): number {
    const bits = Math.min(32, Math.max(8, byteSize * 8));
    const sign = 2 ** (bits - 1);
    return value & sign ? value - 2 ** bits : value;
}

export function escapeCharacter(value: number): string {
    const escapes: Record<number, string> = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r', 39: "\\'", 92: '\\\\' };
    if (escapes[value] !== undefined) { return escapes[value]; }
    return value >= 32 && value <= 126 ? String.fromCharCode(value) : `\\x${value.toString(16).padStart(2, '0')}`;
}

export function hexAddress(address: number, byteSize = 2): string {
    return formatHex(address >>> 0, byteSize * 2);
}

/** Encode an immediate using the same width rules as memory-backed values. */
export function scalarValue(value: number, type?: TypeInfo, byteSize = type?.byteSize || 2): TypedValue {
    const bytes = new Uint8Array(Math.max(1, Math.min(byteSize, 4)));
    for (let index = 0; index < bytes.length; index++) { bytes[index] = value >>> (index * 8) & 0xFF; }
    return { type, bytes, availability: 'available' };
}

/** Strips typedef/qualifier wrappers to reach the concrete type. */
export function unwrap(type: TypeInfo): TypeInfo {
    return type.kind === 'typedef' || type.kind === 'qualified' ? (type.of ? unwrap(type.of) : type) : type;
}

// ---------------------------------------------------------------------------
// Aggregate value mechanics
// ---------------------------------------------------------------------------

/** Base address for child reads; pointer indirection reads the pointee address. */
export function childAddress(value: TypedValue, type: TypeInfo): number | undefined {
    if (type.kind === 'pointer' || type.kind === 'reference') {
        const address = decode(value.bytes ?? new Uint8Array());
        return address === 0 ? undefined : address;
    }
    return value.address;
}

/**
 * GDB-style one-line content summary for structure and union rows,
 * e.g. `{health = 100, ptr = 255}`. Bounded to the first four scalar
 * members; nested aggregates collapse to `{...}`. Returns '' when the
 * aggregate contents were not read.
 */
export function aggregateSummary(value: TypedValue, type: TypeInfo): string {
    if (!value.bytes || value.bytes.length === 0) { return ''; }
    const members = type.members ?? [];
    if (members.length === 0) { return '{...}'; }
    const parts: string[] = [];
    const shown = Math.min(members.length, 4);
    for (let index = 0; index < shown; index++) {
        const member = members[index];
        const memberType = member.type ? unwrap(member.type) : undefined;
        const end = member.offset + (memberType?.byteSize ?? 0);
        const bytes = value.bytes.slice(member.offset, end);
        const memberValue: TypedValue = {
            type: member.type, bytes,
            availability: memberType && memberType.byteSize > 0 && bytes.length === memberType.byteSize ? 'available' : 'unreadable',
        };
        const nested = memberType !== undefined
            && (memberType.kind === 'array' || memberType.kind === 'structure' || memberType.kind === 'union');
        parts.push(`${member.name} = ${nested ? '{...}' : format(memberValue)}`);
    }
    if (members.length > shown) { parts.push('...'); }
    return `{${parts.join(', ')}}`;
}

/**
 * Formats a typed value for display.
 *
 * This is the single presentation path for every debugger surface: Variables,
 * Watch, Debug Console, tooltips, and struct pool rows all render through
 * here, so identical values always produce identical output.
 */
export function format(value: TypedValue): string {
    switch (value.availability) {
        case 'optimized-out': return '<optimized out>';
        case 'inactive': return '<not available at this location>';
        case 'unsupported': return `<unsupported location: ${value.storage?.kind === 'unavailable' ? value.storage.reason : 'value'}>`;
        case 'unreadable': return '<memory unavailable>';
    }
    const type = value.type && unwrap(value.type);
    const bytes = value.bytes?.slice(0, type?.byteSize || undefined) ?? new Uint8Array();
    const numeric = decode(bytes);
    if (type?.kind === 'pointer' || type?.kind === 'reference') {
        if (numeric === 0) { return 'NULL'; }
        const address = hexAddress(numeric);
        return type.of && unwrap(type.of).kind === 'subroutine' ? `${address} <function>` : address;
    }
    // Aggregates are not numbers: show the base address with a GDB-style
    // one-line content summary instead of the raw contents decoded as an
    // integer (identical for C and assembler structs).
    if (type?.kind === 'array') {
        return value.address !== undefined ? hexAddress(value.address) : '<array>';
    }
    if (type?.kind === 'structure' || type?.kind === 'union') {
        if (value.address === undefined) { return '<struct>'; }
        const summary = aggregateSummary(value, type);
        return summary ? `${hexAddress(value.address)} ${summary}` : hexAddress(value.address);
    }
    if (type?.kind === 'base' && (type.name === '_Bool' || type.name === 'bool')) {
        return numeric === 0 ? 'false' : 'true';
    }
    if (type?.kind === 'base' && (type.encoding === 'signed_char' || type.name === 'char' || type.name === 'signed char')) {
        const character = numeric & 0xFF;
        return `${scalarNumber(value)} '${escapeCharacter(character)}'`;
    }
    if (type?.kind === 'enum') {
        const number = scalarNumber(value);
        const name = Array.from(type.enumerators ?? []).find(([, member]) => member === number)?.[0];
        return name ? `${name} (${number})` : String(number);
    }
    if (type?.encoding === 'address') { return hexAddress(numeric, type.byteSize); }
    return String(scalarNumber(value));
}

/** Interpret scalar storage consistently for expressions and presentation. */
export function scalarNumber(value: TypedValue): number {
    const type = value.type && unwrap(value.type);
    const bytes = value.bytes?.slice(0, type?.byteSize || undefined);
    const numeric = decode(bytes);
    if (type?.kind === 'pointer' || type?.kind === 'reference') { return numeric; }
    const isSigned = type?.encoding === 'signed' || type?.encoding === 'signed_char'
        || (type?.encoding !== 'unsigned' && type?.encoding !== 'unsigned_char'
            && (type?.signed || type?.name === 'char' || type?.name === 'signed char'));
    return isSigned ? signed(numeric, bytes?.length ?? type?.byteSize ?? 2) : numeric;
}
