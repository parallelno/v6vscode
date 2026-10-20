import { DebugStopContext, PhysicalFrame } from '../metadata/debug-stop-context';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { TypeInfo } from '../metadata/dwarf-types';
import { VariableNode } from '../metadata/dwarf-scopes';
import { TypedValue, childAddress, scalarValue, unwrap } from './value-format';

export interface EvaluatedVariable { variable: VariableNode; value: TypedValue }
export interface NamedValue { name: string; value: TypedValue }
const MAX_VALUE_BYTES = 256;
const MAX_CHILDREN = 100;

/** Typed reads/locations/children independent of DAP handles and response envelopes. */
export class ValueReader {
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
            return { variable: resolved, value: scalarValue(variable.constValue, type) };
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
                : { variable: resolved, value: { ...scalarValue(register, type), storage } };
        }
        if (storage.kind === 'value') {
            return { variable: resolved, value: { ...scalarValue(storage.value, type), storage } };
        }

        const value = await this.readAt(context, type, storage.address);
        return { variable: resolved, value: { ...value, storage } };
    }

    async childValues(
        context: DebugStopContext,
        value: TypedValue,
        start = 0,
        count?: number,
    ): Promise<NamedValue[]> {
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
            return { name: entry.name, value: child };
        }));
    }

    async readAt(context: DebugStopContext, type: TypeInfo | undefined, address: number): Promise<TypedValue> {
        const byteSize = type?.byteSize ?? 1;
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFF || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_VALUE_BYTES || address + byteSize > 0x10000) {
            return { type, address, availability: 'unreadable' };
        }
        const bytes = await context.memory.readBytes(address, byteSize);
        return bytes === undefined || bytes.length < byteSize
            ? { type, address, availability: 'unreadable' }
            : { type, address, bytes: bytes.slice(0, byteSize), availability: 'available' };
    }
}

function availability(variable: VariableNode, reason: string): TypedValue['availability'] {
    if (variable.loclist) { return 'inactive'; }
    if (reason.startsWith('unsupported')) { return 'unsupported'; }
    if (reason.includes('memory')) { return 'unreadable'; }
    return 'optimized-out';
}
