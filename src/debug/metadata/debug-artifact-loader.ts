/**
 * Loads a companion ELF file, parses its DWARF debug sections, and builds
 * an immutable DebugIndex for the debug session.
 *
 * Usage:
 *   const service = await DebugArtifactLoader.load(elfPath, romPath);
 *   service.resolveBreakpoint(sourceFile, line) → { address, verifiedLine }
 */

import * as fs from 'fs';
import { parseElf32 } from './elf32-reader';
import { parseDwarf4LineSection } from './dwarf4-line-reader';
import { buildDebugIndex, DebugIndex } from './debug-index';

// ---------------------------------------------------------------------------
// Compilation directory extraction
// ---------------------------------------------------------------------------

/**
 * Compilation directories must be decoded through .debug_abbrev and
 * .debug_info attribute forms. Guessing from .debug_str is unsafe because
 * source filenames and include directories use the same string table.
 */
function extractCompDir(): string {
    return '';
}

// ---------------------------------------------------------------------------
// ROM / ELF validation
// ---------------------------------------------------------------------------

/**
 * Verify that the ELF's .text section byte-content matches the flat ROM.
 * Returns a warning string if mismatch detected, undefined if OK or skipped.
 *
 * The ROM file is a flat binary whose byte 0 corresponds to CPU address
 * text.addr (the load address, e.g. 0x0100). Therefore the file offset into
 * the ROM is always 0 for a direct-ROM companion ELF — do NOT use text.addr
 * as a byte offset.
 */
function validateRomElf(elf: ReturnType<typeof parseElf32>, romPath: string): string | undefined {
    if (!romPath || !fs.existsSync(romPath)) { return undefined; }
    const text = elf.sections.find(s => s.name === '.text');
    if (!text) { return undefined; }

    const rom = fs.readFileSync(romPath);
    if (text.data.length !== rom.length) {
        return `ELF .text size (${text.data.length} bytes) does not match ROM size (${rom.length} bytes) — rebuild with \`make\``;
    }
    if (!text.data.equals(rom)) {
        return `ELF .text content does not match ROM — rebuild with \`make\``;
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

    // Extract compilation directory
    const compDir = extractCompDir();

    // Parse line rows
    const debugLine = elf.sections.find(s => s.name === '.debug_line');
    const rows = debugLine
        ? parseDwarf4LineSection(debugLine.data, elf.addressSize, compDir)
        : [];

    // Build index
    const index = buildDebugIndex(rows, elf.symbols, compDir);

    // Validate ROM/ELF match
    const validationWarning = validateRomElf(elf, romPath);
    if (validationWarning) {
        throw new Error(validationWarning);
    }

    return { index, validationWarning, compDir };
}
