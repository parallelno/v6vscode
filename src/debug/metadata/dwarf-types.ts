/**
 * Immutable C type graph built from the generic DIE reader.
 *
 * Types are resolved by DIE offset and support integers, booleans, characters,
 * enums, pointers, arrays, structures, unions, typedefs, and C qualifiers.
 */

import { attribute, blockAttribute, Die, numberAttribute, stringAttribute, DW_AT, DW_TAG } from './dwarf-reader';

export type TypeKind =
    | 'base' | 'pointer' | 'reference' | 'array' | 'structure' | 'union'
    | 'enum' | 'typedef' | 'qualified' | 'subroutine' | 'unspecified';

export interface TypeInfo {
    id: number;                 // DIE offset
    kind: TypeKind;
    name: string;
    byteSize: number;
    signed: boolean;
    encoding?: string;
    /** Element/pointee/underlying type, when present. */
    of?: TypeInfo;
    /** Array bounds. */
    count?: number;
    /** Struct/union members. */
    members?: Array<{ name: string; offset: number; type?: TypeInfo }>;
    /** Enum name->value map. */
    enumerators?: Map<string, number>;
    /** Pointer/reference target size when known. */
    targetByteSize?: number;
    /** Qualifier name when kind is 'qualified'. */
    qualifier?: 'const' | 'volatile' | 'restrict' | 'atomic';
}

const DEFAULT_SIGNED: Record<string, boolean> = {
    'char': false, 'signed char': true, 'unsigned char': false,
    'short': true, 'short int': true, 'int': true, 'long': true, 'long int': true,
    'unsigned short': false, 'unsigned int': false, 'unsigned long': false,
    '_Bool': false, 'bool': false,
};

export class DwarfTypes {
    private readonly cache = new Map<number, TypeInfo>();
    private readonly inProgress = new Set<number>();

    constructor(private readonly byOffset: Map<number, Die>) {}

    /** Resolve a type DIE by offset; undefined when not a type. */
    resolve(offset: number): TypeInfo | undefined {
        const cached = this.cache.get(offset);
        if (cached) { return cached; }
        if (this.inProgress.has(offset)) {
            return undefined; // recursion guard
        }
        const die = this.byOffset.get(offset);
        if (!die) { return undefined; }
        this.inProgress.add(offset);
        try {
            const type = this.build(die);
            if (type) { this.cache.set(offset, type); }
            return type;
        } finally {
            this.inProgress.delete(offset);
        }
    }

    private build(die: Die): TypeInfo | undefined {
        const name = stringAttribute(die, DW_AT.name) ?? '';
        const byteSize = numberAttribute(die, DW_AT.byte_size) ?? 0;

        switch (die.tag) {
            case DW_TAG.base_type: {
                const signed = DEFAULT_SIGNED[name] ?? this.inferSigned(name);
                return { id: die.offset, kind: 'base', name, byteSize, signed, encoding: this.encodingName(die) };
            }
            case DW_TAG.pointer_type:
            case DW_TAG.reference_type: {
                const target = this.typeOf(die);
                return {
                    id: die.offset, kind: die.tag === DW_TAG.pointer_type ? 'pointer' : 'reference',
                    name: `${target?.name ?? 'void'}${die.tag === DW_TAG.pointer_type ? ' *' : ' &'}`,
                    byteSize: byteSize || 2, signed: false, of: target,
                    targetByteSize: target?.byteSize,
                };
            }
            case DW_TAG.const_type: case DW_TAG.volatile_type:
            case DW_TAG.restrict_type: case DW_TAG.atomic_type: {
                const underlying = this.typeOf(die);
                const qualifier = die.tag === DW_TAG.const_type ? 'const'
                    : die.tag === DW_TAG.volatile_type ? 'volatile'
                    : die.tag === DW_TAG.restrict_type ? 'restrict' : 'atomic';
                return {
                    id: die.offset, kind: 'qualified', name: `${qualifier} ${underlying?.name ?? ''}`.trim(),
                    byteSize: underlying?.byteSize ?? 0, signed: underlying?.signed ?? false, of: underlying, qualifier,
                };
            }
            case DW_TAG.typedef: {
                const underlying = this.typeOf(die);
                return {
                    id: die.offset, kind: 'typedef', name: name || underlying?.name || 'typedef',
                    byteSize: underlying?.byteSize ?? 0, signed: underlying?.signed ?? false, of: underlying,
                };
            }
            case DW_TAG.array_type: {
                const element = this.typeOf(die);
                const count = this.arrayCount(die);
                return {
                    id: die.offset, kind: 'array',
                    name: `${element?.name ?? '?'}[]`, byteSize,
                    signed: false, of: element, count,
                };
            }
            case DW_TAG.structure_type: case DW_TAG.union_type: {
                const members = die.children
                    .filter(child => child.tag === DW_TAG.member)
                    .map(child => ({
                        name: stringAttribute(child, DW_AT.name) ?? '',
                        offset: this.memberOffset(child),
                        type: this.typeOf(child),
                    }));
                return {
                    id: die.offset, kind: die.tag === DW_TAG.structure_type ? 'structure' : 'union',
                    name: name || (die.tag === DW_TAG.structure_type ? 'struct' : 'union'),
                    byteSize, signed: false, members,
                };
            }
            case DW_TAG.enumeration_type: {
                const enumerators = new Map<string, number>();
                for (const child of die.children) {
                    if (child.tag !== DW_TAG.enumerator) { continue; }
                    const value = numberAttribute(child, DW_AT.const_value);
                    enumerators.set(stringAttribute(child, DW_AT.name) ?? '', value ?? 0);
                }
                return { id: die.offset, kind: 'enum', name, byteSize, signed: this.inferSigned(name), enumerators };
            }
            case DW_TAG.subroutine_type:
                return { id: die.offset, kind: 'subroutine', name: 'function', byteSize: 2, signed: false };
            case DW_TAG.unspecified_type:
                return { id: die.offset, kind: 'unspecified', name: name || 'void', byteSize: 0, signed: false };
            default:
                return undefined;
        }
    }

    private typeOf(die: Die): TypeInfo | undefined {
        const ref = attribute(die, DW_AT.type);
        if (!ref) { return undefined; }
        const offset = typeof ref.value === 'number' ? ref.value : Number(ref.value);
        return this.resolve(offset);
    }

    private arrayCount(die: Die): number | undefined {
        for (const child of die.children) {
            if (child.tag !== DW_TAG.subrange_type) { continue; }
            const count = numberAttribute(child, DW_AT.count);
            if (count !== undefined) { return count; }
            const upper = numberAttribute(child, DW_AT.high_pc);
            const lower = numberAttribute(child, DW_AT.low_pc) ?? 0;
            if (upper !== undefined) { return upper - lower + 1; }
        }
        return undefined;
    }

    private memberOffset(die: Die): number {
        // data_member_location may be a constant or a small block; handle constant first.
        const value = numberAttribute(die, DW_AT.data_member_location);
        if (value !== undefined) { return value; }
        return 0;
    }

    private encodingName(die: Die): string | undefined {
        const encoding = numberAttribute(die, DW_AT.encoding);
        if (encoding === undefined) { return undefined; }
        const names: Record<number, string> = {
            1: 'address', 2: 'boolean', 3: 'complex_float', 4: 'float',
            5: 'signed', 6: 'signed_char', 7: 'unsigned', 8: 'unsigned_char',
        };
        return names[encoding];
    }

    private inferSigned(name: string): boolean {
        if (!name) { return false; }
        if (name.startsWith('unsigned')) { return false; }
        return name === 'char' || name.includes('int') || name.includes('long') || name.includes('short');
    }
}
