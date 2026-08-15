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
import { parseDwarf4LineFiles, parseDwarf4LineSection } from './dwarf4-line-reader';
import { parseDwarf4CompilationDirectories, parseDwarf4VariableDeclarations } from './dwarf4-info-reader';
import { buildDebugIndex, DebugIndex } from './debug-index';

// ---------------------------------------------------------------------------
// Compilation directory extraction
// ---------------------------------------------------------------------------

/**
 * Compilation directories must be decoded through .debug_abbrev and
 * .debug_info attribute forms. Guessing from .debug_str is unsafe because
 * source filenames and include directories use the same string table.
 */
function extractCompDir(
    debugInfo: Buffer | undefined,
    debugAbbrev: Buffer | undefined,
    debugStrings: Buffer | undefined,
): string {
    if (!debugInfo || !debugAbbrev || !debugStrings) { return ''; }
    try {
        return parseDwarf4CompilationDirectories(debugInfo, debugAbbrev, debugStrings)
            .find(directory => path.isAbsolute(directory)) ?? '';
    } catch (error: any) {
        if (!String(error?.message ?? error).startsWith('Unsupported DWARF attribute form')) { throw error; }
        return '';
    }
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

    // Extract compilation directory before resolving relative line-table paths.
    const compDir = extractCompDir(debugInfo?.data, debugAbbrev?.data, debugStrings?.data);

    // Parse line rows
    const debugLine = elf.sections.find(s => s.name === '.debug_line');
    const rows = debugLine
        ? parseDwarf4LineSection(debugLine.data, elf.addressSize, compDir, debugStrings?.data, elf.sections.find(section => section.name === '.debug_line_str')?.data)
        : [];
    const files = debugLine ? parseDwarf4LineFiles(debugLine.data, compDir, debugStrings?.data, elf.sections.find(section => section.name === '.debug_line_str')?.data) : [];
    let declarations: ReturnType<typeof parseDwarf4VariableDeclarations> = [];
    const debugInfoVersion = debugInfo && debugInfo.data.length >= 6 ? debugInfo.data.readUInt16LE(4) : 0;
    if (debugInfoVersion === 4 && debugInfo && debugAbbrev && debugStrings) {
        try {
            declarations = parseDwarf4VariableDeclarations(debugInfo.data, debugAbbrev.data, debugStrings.data, files);
        } catch (error: any) {
            if (!String(error?.message ?? error).startsWith('Unsupported DWARF attribute form')) { throw error; }
        }
    }

    // Build index
    const index = buildDebugIndex(rows, elf.symbols, compDir, declarations);

    // Validate ROM/ELF match
    const validationWarning = validateRomElf(elf, romPath);
    if (validationWarning) {
        throw new Error(validationWarning);
    }

    return { index, validationWarning, compDir };
}
