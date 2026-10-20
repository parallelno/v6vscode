import { DwarfReader, Die, DW_AT, DW_TAG, numberAttribute, stringAttribute } from './dwarf-reader';
import { DwarfStrings } from './dwarf-strings';

export interface DwarfVariableDeclaration { name: string; file: string; line: number; value: number }
export interface DwarfCompilationUnitInfo { compDir: string; stmtList?: number }
export type DeclarationFileResolver = (unitIndex: number, stmtList: number | undefined) => readonly string[];

/** Baseline v4 projection, intentionally independent of optional semantic indexing. */
function reader(info: Buffer, abbrev: Buffer, strings: Buffer): DwarfReader {
    return new DwarfReader(info, abbrev, new DwarfStrings(strings, Buffer.alloc(0), Buffer.alloc(0)), Buffer.alloc(0));
}

export function parseDwarf4CompilationUnits(info: Buffer, abbrev: Buffer, strings: Buffer): DwarfCompilationUnitInfo[] {
    return reader(info, abbrev, strings).readUnits(true).filter(unit => unit.version === 4 && unit.root?.tag === DW_TAG.compile_unit)
        .map(unit => ({ compDir: stringAttribute(unit.root!, DW_AT.comp_dir) ?? '', stmtList: numberAttribute(unit.root!, DW_AT.stmt_list) }));
}
export function parseDwarf4CompilationDirectories(info: Buffer, abbrev: Buffer, strings: Buffer): string[] {
    return parseDwarf4CompilationUnits(info, abbrev, strings).map(unit => unit.compDir).filter(Boolean);
}

export function parseDwarf4VariableDeclarations(info: Buffer, abbrev: Buffer, strings: Buffer, resolveFiles: DeclarationFileResolver): DwarfVariableDeclaration[] {
    const declarations: DwarfVariableDeclaration[] = [];
    const units = reader(info, abbrev, strings).readUnits().filter(unit => unit.version === 4 && unit.root?.tag === DW_TAG.compile_unit);
    units.forEach((unit, index) => {
        const files = resolveFiles(index, numberAttribute(unit.root!, DW_AT.stmt_list));
        const visit = (die: Die): void => {
            if (die.tag === DW_TAG.variable) {
                const name = stringAttribute(die, DW_AT.name), file = numberAttribute(die, DW_AT.decl_file),
                    line = numberAttribute(die, DW_AT.decl_line), value = numberAttribute(die, DW_AT.const_value);
                if (name !== undefined && file !== undefined && line !== undefined && value !== undefined && files[file - 1]) {
                    declarations.push({ name, file: files[file - 1], line, value });
                }
            }
            die.children.forEach(visit);
        };
        visit(unit.root!);
    });
    return declarations;
}
