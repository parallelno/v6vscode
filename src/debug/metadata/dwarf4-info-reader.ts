import { readCString, readSLEB128, readULEB128 } from './elf32-reader';

const DW_TAG_COMPILE_UNIT = 0x11;
const DW_TAG_VARIABLE = 0x34;
const DW_AT_COMP_DIR = 0x1B;
const DW_AT_NAME = 0x03;
const DW_AT_CONST_VALUE = 0x1C;
const DW_AT_DECL_FILE = 0x3A;
const DW_AT_DECL_LINE = 0x3B;

const DW_FORM_DATA1 = 0x0B;
const DW_FORM_DATA2 = 0x05;
const DW_FORM_DATA4 = 0x06;
const DW_FORM_DATA8 = 0x07;
const DW_FORM_SDATA = 0x0D;
const DW_FORM_STRP = 0x0E;
const DW_FORM_UDATA = 0x0F;
const DW_FORM_SEC_OFFSET = 0x17;

interface Abbreviation {
    tag: number;
    attributes: Array<{ name: number; form: number }>;
}

export interface DwarfVariableDeclaration {
    name: string;
    file: string;
    line: number;
    value: number;
}

/** Return the compilation directories declared by DWARF compilation units. */
export function parseDwarf4CompilationDirectories(
    info: Buffer,
    abbrev: Buffer,
    strings: Buffer,
): string[] {
    const directories: string[] = [];
    let unitOffset = 0;
    while (unitOffset + 11 <= info.length) {
        const unitLength = info.readUInt32LE(unitOffset);
        if (unitLength === 0 || unitOffset + 4 + unitLength > info.length) { break; }
        const abbrevOffset = info.readUInt32LE(unitOffset + 6);
        const abbreviations = readAbbreviations(abbrev, abbrevOffset);
        let offset = unitOffset + 11;
        const unitEnd = unitOffset + 4 + unitLength;

        const [code, codeLength] = readULEB128(info, offset);
        offset += codeLength;
        const abbreviation = abbreviations.get(code);
        if (code !== 0 && abbreviation?.tag === DW_TAG_COMPILE_UNIT) {
            for (const attribute of abbreviation.attributes) {
                const decoded = readForm(info, offset, attribute.form, strings);
                offset = decoded.offset;
                if (attribute.name === DW_AT_COMP_DIR && typeof decoded.value === 'string') {
                    directories.push(decoded.value);
                }
            }
        }
        unitOffset = unitEnd;
    }
    return directories;
}

/** Read v6asm's DWARF v4 variable declarations for absolute constants. */
export function parseDwarf4VariableDeclarations(
    info: Buffer,
    abbrev: Buffer,
    strings: Buffer,
    files: readonly string[],
): DwarfVariableDeclaration[] {
    const declarations: DwarfVariableDeclaration[] = [];
    let unitOffset = 0;
    while (unitOffset + 11 <= info.length) {
        const unitLength = info.readUInt32LE(unitOffset);
        if (unitLength === 0 || unitOffset + 4 + unitLength > info.length) { break; }
        const abbrevOffset = info.readUInt32LE(unitOffset + 6);
        const abbreviations = readAbbreviations(abbrev, abbrevOffset);
        let offset = unitOffset + 11;
        const unitEnd = unitOffset + 4 + unitLength;
        while (offset < unitEnd) {
            const [code, codeLength] = readULEB128(info, offset);
            offset += codeLength;
            if (code === 0) { continue; }
            const abbreviation = abbreviations.get(code);
            if (!abbreviation) { throw new Error(`Unknown DWARF abbreviation ${code}`); }
            const attributes = new Map<number, unknown>();
            for (const attribute of abbreviation.attributes) {
                const decoded = readForm(info, offset, attribute.form, strings);
                offset = decoded.offset;
                attributes.set(attribute.name, decoded.value);
            }
            if (abbreviation.tag !== DW_TAG_VARIABLE) { continue; }
            const name = attributes.get(DW_AT_NAME);
            const fileIndex = attributes.get(DW_AT_DECL_FILE);
            const line = attributes.get(DW_AT_DECL_LINE);
            const value = attributes.get(DW_AT_CONST_VALUE);
            if (typeof name === 'string' && typeof fileIndex === 'number'
                && typeof line === 'number' && typeof value === 'number' && files[fileIndex - 1]) {
                declarations.push({ name, file: files[fileIndex - 1], line, value });
            }
        }
        unitOffset = unitEnd;
    }
    return declarations;
}

function readAbbreviations(data: Buffer, offset: number): Map<number, Abbreviation> {
    const result = new Map<number, Abbreviation>();
    let cursor = offset;
    while (cursor < data.length) {
        const [code, codeLength] = readULEB128(data, cursor);
        cursor += codeLength;
        if (code === 0) { break; }
        const [tag, tagLength] = readULEB128(data, cursor);
        cursor += tagLength + 1; // children flag
        const attributes: Abbreviation['attributes'] = [];
        while (cursor < data.length) {
            const [name, nameLength] = readULEB128(data, cursor);
            cursor += nameLength;
            const [form, formLength] = readULEB128(data, cursor);
            cursor += formLength;
            if (name === 0 && form === 0) { break; }
            attributes.push({ name, form });
        }
        result.set(code, { tag, attributes });
    }
    return result;
}

function readForm(data: Buffer, offset: number, form: number, strings: Buffer): { value: unknown; offset: number } {
    switch (form) {
        case DW_FORM_DATA1: return { value: data[offset], offset: offset + 1 };
        case DW_FORM_DATA2: return { value: data.readUInt16LE(offset), offset: offset + 2 };
        case DW_FORM_DATA4: return { value: data.readUInt32LE(offset), offset: offset + 4 };
        case DW_FORM_SEC_OFFSET: return { value: data.readUInt32LE(offset), offset: offset + 4 };
        case DW_FORM_DATA8: return { value: Number(data.readBigUInt64LE(offset)), offset: offset + 8 };
        case DW_FORM_SDATA: {
            const [value, length] = readSLEB128(data, offset);
            return { value, offset: offset + length };
        }
        case DW_FORM_STRP: {
            const stringOffset = data.readUInt32LE(offset);
            return { value: readCString(strings, stringOffset), offset: offset + 4 };
        }
        case DW_FORM_UDATA: {
            const [value, length] = readULEB128(data, offset);
            return { value, offset: offset + length };
        }
        default: throw new Error(`Unsupported DWARF attribute form ${form}`);
    }
}