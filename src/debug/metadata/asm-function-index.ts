import { CompilationUnit, Die, DW_AT, numberAttribute, stringAttribute } from './dwarf-reader';

export interface AsmFunctionEntry {
    name: string;
    address: number;
    /** v6asm vendor source-path attribute (0x3f01), exactly as the assembler wrote it. */
    file: string;
    line: number;
    /** DW_AT_decl_file index into the owning CU's own line-program file table, when emitted. */
    declFile?: number;
    /** Index of the owning compilation unit in the parsed unit list. */
    unitIndex: number;
}

export interface AsmFunctionRegion {
    id: number;
    start: number;
    end: number;
    entries: readonly AsmFunctionEntry[];
}

/** v6asm DWARF v4 vendor region tag; standard entry_point children. */
export class AsmFunctionIndex {
    readonly regions: readonly AsmFunctionRegion[];

    constructor(units: readonly CompilationUnit[]) {
        const regions: AsmFunctionRegion[] = [];
        const visit = (die: Die, unitIndex: number) => {
            if (die.tag === 0x4080) {
                const start = numberAttribute(die, DW_AT.low_pc);
                const size = numberAttribute(die, DW_AT.high_pc);
                if (start !== undefined && start !== 0xFFFF && size !== undefined
                    && size > 0 && start + size <= 0x10000) {
                    const entries: AsmFunctionEntry[] = [];
                    for (const child of die.children) {
                        const address = numberAttribute(child, DW_AT.low_pc);
                        const name = stringAttribute(child, DW_AT.name);
                        if (child.tag === 0x03 && name && address !== undefined && address !== 0xFFFF
                            && address >= start && address < start + size) {
                            // DW_AT_decl_file is CU-relative and is preferred over the
                            // vendor path when the producer emits it (see the loader).
                            const declFile = numberAttribute(child, DW_AT.decl_file);
                            entries.push({
                                name, address, file: stringAttribute(child, 0x3f01) ?? '',
                                line: numberAttribute(child, DW_AT.decl_line) ?? 1,
                                ...(declFile === undefined ? {} : { declFile }),
                                unitIndex,
                            });
                        }
                    }
                    regions.push({ id: die.offset, start, end: start + size, entries });
                }
            }
            for (const child of die.children) { visit(child, unitIndex); }
        };
        units.forEach((unit, unitIndex) => { if (unit.root) { visit(unit.root, unitIndex); } });
        this.regions = regions;
    }

    at(pc: number): AsmFunctionRegion | undefined {
        return this.regions.filter(region => pc >= region.start && pc < region.end)
            .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.id - b.id)[0];
    }
}