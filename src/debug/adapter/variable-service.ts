import { DebugStopContext, PhysicalFrame } from '../metadata/debug-stop-context';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { EvaluatedLocation } from '../metadata/dwarf-expression';
import { TypeInfo } from '../metadata/dwarf-types';
import { VariableNode } from '../metadata/dwarf-scopes';

export interface TypedValue {
    type?: TypeInfo;
    storage?: EvaluatedLocation;
    bytes?: Uint8Array;
    address?: number;
    availability: 'available' | 'optimized-out' | 'inactive' | 'unsupported' | 'unreadable';
}

export interface EvaluatedVariable {
    variable: VariableNode;
    value: TypedValue;
}

export interface DapVariable {
    name: string;
    value: string;
    type?: string;
    memoryReference?: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
}

export interface DapVariableValue extends DapVariable {
    valueData: TypedValue;
}

const MAX_VALUE_BYTES = 256;
const MAX_CHILDREN = 100;

/** Evaluates DWARF variable locations against one recovered physical frame. */
export class VariableService {
    async evaluate(
        metadata: DebugMetadataIndex,
        context: DebugStopContext,
        frame: PhysicalFrame,
        variable: VariableNode,
    ): Promise<EvaluatedVariable> {
        const origin = metadata.resolveAbstractOrigin(variable);
        const declaration = origin && origin !== variable ? origin : undefined;
        const typeOffset = variable.typeOffset ?? declaration?.typeOffset;
        const type = typeOffset === undefined ? undefined : metadata.typeOf(typeOffset);
        const name = variable.name || declaration?.name || '';
        const resolved = name === variable.name ? variable : { ...variable, name };
        if (variable.constValue !== undefined) {
            return { variable: resolved, value: { type, bytes: encode(variable.constValue, type?.byteSize), availability: 'available' } };
        }

        const cache = new Map<number, number>();
        const storage = metadata.evaluateVariable(variable, frame.pc, context.evalContext(frame, cache));
        if (storage.kind === 'unavailable') {
            return { variable: resolved, value: { type, storage, availability: availability(resolved, storage.reason) } };
        }
        if (storage.kind === 'register') {
            const register = frame.registers[storage.register];
            return register === undefined
                ? { variable: resolved, value: { type, storage, availability: 'unreadable' } }
                : { variable: resolved, value: { type, storage, bytes: encode(register, type?.byteSize), availability: 'available' } };
        }
        if (storage.kind === 'value') {
            return { variable: resolved, value: { type, storage, bytes: encode(storage.value, type?.byteSize), availability: 'available' } };
        }

        const length = type?.byteSize || 1;
        if (!Number.isInteger(length) || length <= 0 || length > MAX_VALUE_BYTES) {
            return { variable: resolved, value: { type, storage, address: storage.address, availability: 'unsupported' } };
        }
        const bytes = await context.memory.readBytes(storage.address, length);
        return bytes === undefined
            ? { variable: resolved, value: { type, storage, address: storage.address, availability: 'unreadable' } }
            : { variable: resolved, value: { type, storage, bytes, address: storage.address, availability: 'available' } };
    }

    async dapVariables(
        metadata: DebugMetadataIndex,
        context: DebugStopContext,
        frame: PhysicalFrame,
        variables: readonly VariableNode[],
        start = 0,
        count?: number,
    ): Promise<DapVariableValue[]> {
        const page = variables.slice(Math.max(0, start), count === undefined ? undefined : Math.max(0, start) + Math.max(0, count));
        const values = await Promise.all(page.map(variable => this.evaluate(metadata, context, frame, variable)));
        return values.map(({ variable, value }) => dapVariableValue(value, variable.name || `<anonymous@${variable.id.toString(16)}>`));
    }

    async children(
        context: DebugStopContext,
        value: TypedValue,
        start = 0,
        count?: number,
    ): Promise<DapVariableValue[]> {
        if (value.availability !== 'available' || !value.type) { return []; }
        const type = unwrap(value.type);
        const address = childAddress(value, type);
        if (address === undefined) { return []; }
        const entries: Array<{ name: string; type: TypeInfo; address: number }> = [];
        const first = Math.max(0, start);
        const requested = Math.min(MAX_CHILDREN, Math.max(0, count ?? MAX_CHILDREN));
        const end = first + requested;
        if ((type.kind === 'pointer' || type.kind === 'reference') && type.of && type.of.byteSize > 0) {
            entries.push({ name: '*', type: type.of, address });
        } else if (type.kind === 'array' && type.of && type.count !== undefined) {
            for (let index = first; index < Math.min(type.count, end); index++) {
                entries.push({ name: `[${index}]`, type: type.of, address: address + index * type.of.byteSize });
            }
        } else if ((type.kind === 'structure' || type.kind === 'union') && type.members) {
            for (const member of type.members.slice(first, end)) {
                if (member.type) { entries.push({ name: member.name, type: member.type, address: address + member.offset }); }
            }
        } else {
            return [];
        }
        return Promise.all(entries.map(async entry => {
            const child = await this.readAt(context, entry.type, entry.address);
            return {
                name: entry.name,
                value: format(child),
                type: entry.type.name,
                memoryReference: `0x${entry.address.toString(16).padStart(4, '0').toUpperCase()}`,
                variablesReference: 0,
                ...childCounts(child),
                valueData: child,
            };
        }));
    }

    async readAt(context: DebugStopContext, type: TypeInfo, address: number): Promise<TypedValue> {
        const byteSize = type.byteSize;
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFF || byteSize <= 0 || byteSize > MAX_VALUE_BYTES || address + byteSize > 0x10000) {
            return { type, address, availability: 'unreadable' };
        }
        const bytes = await context.memory.readBytes(address, byteSize);
        return bytes === undefined
            ? { type, address, availability: 'unreadable' }
            : { type, address, bytes, availability: 'available' };
    }
}

function availability(variable: VariableNode, reason: string): TypedValue['availability'] {
    if (variable.loclist) { return 'inactive'; }
    if (reason.startsWith('unsupported')) { return 'unsupported'; }
    if (reason.includes('memory')) { return 'unreadable'; }
    return 'optimized-out';
}

function encode(value: number, size = 2): Uint8Array {
    const length = Math.max(1, Math.min(size, 8));
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) { bytes[index] = (value >>> (index * 8)) & 0xFF; }
    return bytes;
}

function format(value: TypedValue): string {
    switch (value.availability) {
        case 'optimized-out': return '<optimized out>';
        case 'inactive': return '<not available at this location>';
        case 'unsupported': return `<unsupported location: ${value.storage?.kind === 'unavailable' ? value.storage.reason : 'value'}>`;
        case 'unreadable': return '<memory unavailable>';
    }
    const bytes = value.bytes ?? new Uint8Array();
    const numeric = decode(bytes);
    const type = value.type;
    if (type?.kind === 'pointer' || type?.kind === 'reference') {
        if (numeric === 0) { return 'NULL'; }
        const address = `0x${numeric.toString(16).padStart(4, '0').toUpperCase()}`;
        return type.of?.kind === 'subroutine' ? `${address} <function>` : address;
    }
    if (type?.kind === 'base' && (type.name === '_Bool' || type.name === 'bool')) {
        return numeric === 0 ? 'false' : 'true';
    }
    if (type?.kind === 'base' && (type.encoding === 'signed_char' || type.name === 'char' || type.name === 'signed char')) {
        const character = numeric & 0xFF;
        return `${signed(numeric, bytes.length)} '${escapeCharacter(character)}'`;
    }
    if (type?.kind === 'enum') {
        const name = Array.from(type.enumerators ?? []).find(([, member]) => member === signed(numeric, bytes.length))?.[0];
        return name ? `${name} (${signed(numeric, bytes.length)})` : String(signed(numeric, bytes.length));
    }
    return String(type?.signed ? signed(numeric, bytes.length) : numeric);
}

function decode(bytes: Uint8Array): number {
    let value = 0;
    for (let index = 0; index < Math.min(bytes.length, 4); index++) { value |= bytes[index] << (index * 8); }
    return value >>> 0;
}

function signed(value: number, byteSize: number): number {
    const bits = Math.min(32, Math.max(8, byteSize * 8));
    const sign = 2 ** (bits - 1);
    return value & sign ? value - 2 ** bits : value;
}

function escapeCharacter(value: number): string {
    const escapes: Record<number, string> = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r', 39: "\\'", 92: '\\\\' };
    if (escapes[value] !== undefined) { return escapes[value]; }
    return value >= 32 && value <= 126 ? String.fromCharCode(value) : `\\x${value.toString(16).padStart(2, '0')}`;
}

function childCounts(value: TypedValue): Pick<DapVariable, 'namedVariables' | 'indexedVariables'> {
    if (value.availability !== 'available' || !value.type) { return {}; }
    const type = unwrap(value.type);
    if (type.kind === 'pointer' || type.kind === 'reference') {
        return type.of && type.of.byteSize > 0 ? { namedVariables: 1 } : {};
    }
    if (type.kind === 'array' && type.count !== undefined) { return { indexedVariables: type.count }; }
    if ((type.kind === 'structure' || type.kind === 'union') && type.members) { return { namedVariables: type.members.length }; }
    return {};
}

function unwrap(type: TypeInfo): TypeInfo {
    return type.kind === 'typedef' || type.kind === 'qualified' ? (type.of ? unwrap(type.of) : type) : type;
}

function childAddress(value: TypedValue, type: TypeInfo): number | undefined {
    if (type.kind === 'pointer' || type.kind === 'reference') {
        const address = decode(value.bytes ?? new Uint8Array());
        return address === 0 ? undefined : address;
    }
    return value.address;
}

export function dapVariableValue(value: TypedValue, name = ''): DapVariableValue {
    return {
        name,
        value: format(value),
        type: value.type?.name,
        memoryReference: value.address === undefined ? undefined : `0x${value.address.toString(16).padStart(4, '0').toUpperCase()}`,
        variablesReference: 0,
        ...childCounts(value),
        valueData: value,
    };
}