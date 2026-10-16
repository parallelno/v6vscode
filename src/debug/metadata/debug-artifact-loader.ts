/**
 * Loads a companion ELF file, parses its DWARF debug sections, and builds
 * an immutable DebugIndex for the debug session.
 *
 * Usage:
 *   const service = await DebugArtifactLoader.load(elfPath, romPath);
 *   service.resolveBreakpoint(sourceFile, line) → { address, verifiedLine }
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseElf32, SHF_ALLOC, SHT_PROGBITS } from './elf32-reader';
import { parseDwarf4LineFileTables, parseDwarf4LineSection, DwarfLineCompDirs } from './dwarf4-line-reader';
import { parseDwarf4CompilationUnits, parseDwarf4VariableDeclarations, DwarfCompilationUnitInfo, DwarfVariableDeclaration } from './dwarf4-info-reader';
import { buildDebugIndex, DebugIndex } from './debug-index';
import { DebugMetadataIndex } from './debug-metadata-index';

// ---------------------------------------------------------------------------
// Compilation directory extraction
// ---------------------------------------------------------------------------

/**
 * Compilation directories must be decoded through .debug_abbrev and
 * .debug_info attribute forms. Guessing from .debug_str is unsafe because
 * source filenames and include directories use the same string table.
 */
function parseCompilationUnits(
    debugInfo: Buffer | undefined,
    debugAbbrev: Buffer | undefined,
    debugStrings: Buffer | undefined,
): DwarfCompilationUnitInfo[] {
    if (!debugInfo || !debugAbbrev || !debugStrings) { return []; }
    try {
        return parseDwarf4CompilationUnits(debugInfo, debugAbbrev, debugStrings);
    } catch (error: any) {
        if (!String(error?.message ?? error).startsWith('Unsupported DWARF attribute form')) { throw error; }
        return [];
    }
}

/**
 * Per-line-program compilation directories. Each line program resolves its
 * files against its own compilation unit's comp_dir — matched by
 * DW_AT_stmt_list when every unit declares one, otherwise by program order.
 * Units without an absolute comp_dir fall back to the first absolute one.
 */
function buildLineCompDirs(compUnits: DwarfCompilationUnitInfo[], fallback: string): DwarfLineCompDirs | undefined {
    if (compUnits.length === 0) { return undefined; }
    const resolveForUnit = (unit: DwarfCompilationUnitInfo): string =>
        path.isAbsolute(unit.compDir) ? unit.compDir : (fallback || unit.compDir);
    if (compUnits.every(unit => unit.stmtList !== undefined)) {
        return new Map(compUnits.map(unit => [unit.stmtList as number, resolveForUnit(unit)]));
    }
    return compUnits.map(resolveForUnit);
}

/**
 * File table of the compilation unit owning a variable declaration. Matched by
 * the unit's DW_AT_stmt_list when available, otherwise by declaration order.
 */
function filesForUnit(
    unitIndex: number,
    stmtList: number | undefined,
    lineTables: Array<{ offset: number; files: string[] }>,
    mergedFiles: string[],
): readonly string[] {
    if (stmtList !== undefined) {
        const table = lineTables.find(candidate => candidate.offset === stmtList);
        if (table) { return table.files; }
    }
    return lineTables[unitIndex]?.files ?? mergedFiles;
}

// ---------------------------------------------------------------------------
// ROM / ELF validation
// ---------------------------------------------------------------------------

/**
 * Verify that the ELF's loadable section bytes match the flat ROM.
 * Returns a warning string if mismatch detected, undefined if OK or skipped.
 *
 * The ROM file is a flat image whose byte 0 corresponds to the lowest loadable
 * section address. C artifacts commonly split this image across .text and
 * .data, while assembly companions may contain only .text.
 */
function validateRomElf(elf: ReturnType<typeof parseElf32>, romPath: string): string | undefined {
    if (!romPath || !fs.existsSync(romPath)) { return undefined; }
    const loadableSections = elf.sections
        .filter(section => section.type === SHT_PROGBITS && (section.flags & SHF_ALLOC) !== 0 && section.data.length > 0)
        .sort((left, right) => left.addr - right.addr);
    if (loadableSections.length === 0) { return undefined; }

    const rom = fs.readFileSync(romPath);
    const loadAddress = loadableSections[0].addr;
    const imageEnd = Math.max(...loadableSections.map(section => section.addr + section.data.length));
    const imageSize = imageEnd - loadAddress;
    if (imageSize !== rom.length) {
        return `ELF load image size (${imageSize} bytes) does not match ROM size (${rom.length} bytes) — rebuild with \`make\``;
    }
    for (const section of loadableSections) {
        const offset = section.addr - loadAddress;
        if (!section.data.equals(rom.subarray(offset, offset + section.data.length))) {
            return `ELF ${section.name} content does not match ROM — rebuild with \`make\``;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadResult {
    index: DebugIndex;
    /** Semantic DWARF metadata when supported by the companion artifact. */
    metadata: DebugMetadataIndex | undefined;
    /** Non-empty if the ROM and ELF do not match — source breakpoints may be unreliable. */
    validationWarning: string | undefined;
    compDir: string;
}

/**
 * Load a companion ELF and build a debug index.
 *
 * @param elfPath  Absolute path to the companion ELF file.
 * @param romPath  Absolute path to the ROM (for ROM/ELF validation); may be ''.
 */
export async function loadDebugArtifact(elfPath: string, romPath = ''): Promise<LoadResult> {
    if (!fs.existsSync(elfPath)) {
        throw new Error(`Debug artifact not found: ${elfPath}`);
    }

    const elfBuf = fs.readFileSync(elfPath);
    const elf = parseElf32(elfBuf);

    const debugInfo = elf.sections.find(section => section.name === '.debug_info');
    const debugAbbrev = elf.sections.find(section => section.name === '.debug_abbrev');
    const debugStrings = elf.sections.find(section => section.name === '.debug_str');

    // Extract compilation directories before resolving relative line-table paths.
    const compUnits = parseCompilationUnits(debugInfo?.data, debugAbbrev?.data, debugStrings?.data);
    const compDir = compUnits.map(unit => unit.compDir).find(directory => path.isAbsolute(directory)) ?? '';
    const lineCompDirs = buildLineCompDirs(compUnits, compDir);

    // Parse line rows
    const debugLine = elf.sections.find(s => s.name === '.debug_line');
    const lineStrings = elf.sections.find(section => section.name === '.debug_line_str')?.data;
    const lineTables = debugLine
        ? parseDwarf4LineFileTables(debugLine.data, compDir, debugStrings?.data, lineStrings, lineCompDirs)
        : [];
    const files = [...new Set(lineTables.flatMap(table => table.files))];
    const rows = debugLine
        ? parseDwarf4LineSection(debugLine.data, elf.addressSize, compDir, debugStrings?.data, lineStrings, lineCompDirs)
        : [];
    let declarations: DwarfVariableDeclaration[] = [];
    const debugInfoVersion = debugInfo && debugInfo.data.length >= 6 ? debugInfo.data.readUInt16LE(4) : 0;
    if (debugInfoVersion === 4 && debugInfo && debugAbbrev && debugStrings) {
        try {
            declarations = parseDwarf4VariableDeclarations(
                debugInfo.data,
                debugAbbrev.data,
                debugStrings.data,
                (unitIndex, stmtList) => filesForUnit(unitIndex, stmtList, lineTables, files),
            );
        } catch (error: any) {
            if (!String(error?.message ?? error).startsWith('Unsupported DWARF attribute form')) { throw error; }
        }
    }

    // Build the legacy line/symbol index and optional semantic metadata independently.
    const index = buildDebugIndex(rows, elf.symbols, compDir, declarations, files);
    let metadata: DebugMetadataIndex | undefined;
    try {
        metadata = new DebugMetadataIndex(elf);
    } catch {
        // Optional semantic metadata must not disable baseline source debugging.
    }

    // Validate ROM/ELF match
    const validationWarning = validateRomElf(elf, romPath);
    if (validationWarning) {
        throw new Error(validationWarning);
    }

    return { index, metadata, validationWarning, compDir };
}
