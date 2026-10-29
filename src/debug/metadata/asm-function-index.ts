import { CompilationUnit, Die, DW_AT, numberAttribute, stringAttribute } from './dwarf-reader';

export interface AsmFunctionEntry {
    name: string;
    address: number;
    file: string;
    line: number;
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
        const visit = (die: Die) => {
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
                            entries.push({ name, address, file: stringAttribute(child, 0x3f01) ?? '',
                                line: numberAttribute(child, DW_AT.decl_line) ?? 1 });
                        }
                    }
                    regions.push({ id: die.offset, start, end: start + size, entries });
                }
            }
            for (const child of die.children) { visit(child); }
        };
        for (const unit of units) { if (unit.root) { visit(unit.root); } }
        this.regions = regions;
    }

    at(pc: number): AsmFunctionRegion | undefined {
        return this.regions.filter(region => pc >= region.start && pc < region.end)
            .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.id - b.id)[0];
    }
}