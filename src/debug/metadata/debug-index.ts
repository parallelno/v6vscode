/**
 * Immutable debug index built from a parsed ELF/DWARF companion.
 *
 * Provides O(1) bidirectional lookups:
 *   source (file, line) → one or more CPU addresses
 *   CPU address        → source row
 *   symbol name        → address/size
 *   CPU address        → enclosing symbol name
 */

import * as path from 'path';
import { LineRow } from './dwarf4-line-reader';
import { Elf32Symbol, SHN_ABS, STT_FUNC, STT_NOTYPE, STT_OBJECT } from './elf32-reader';
import { DwarfVariableDeclaration } from './dwarf4-info-reader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceLocation {
    file: string;
    line: number;
    column: number;
    isStmt: boolean;
}

export interface SymbolInfo {
    name: string;
    address: number;
    size: number;
    type: number;   // STT_FUNC or STT_OBJECT
    binding: number;
    /** SHN_ABS symbol: an immutable absolute constant whose value is the answer. */
    absolute?: boolean;
    declaration?: SourceLocation;
}

export interface AddressRange {
    start: number;
    end: number;
}

export interface StatementRow extends SourceLocation {
    address: number;
    discriminator?: number;
}

export interface DebugIndex {
    /** All source file paths in the index. */
    readonly sourceFiles: ReadonlyArray<string>;

    /** Immutable normalized statement rows, ordered by address. */
    readonly statementRows: ReadonlyArray<StatementRow>;

    /**
     * Find the best breakpoint address for a given source location.
     * Returns the exact or next `is_stmt` row address in the same file.
     */
    resolveBreakpoint(file: string, line: number): { address: number; verifiedLine: number } | undefined;

    /** All addresses for a given source line (macros/loops may produce several). */
    resolveBreakpointAll(file: string, line: number): Array<{ address: number; verifiedLine: number }>;

    /** Reverse: CPU address → source location. */
    resolveAddress(address: number): SourceLocation | undefined;

    /**
     * All statement rows at an address in line-program emission order.
     * Macro expansion entries stack an invocation row per nesting level at the
     * same address as the deepest body row; inline frame presentation walks
     * this list from the end.
     */
    resolveAddressRows(address: number): ReadonlyArray<SourceLocation>;

    /** Nearest preceding statement address within a verified function range. */
    resolvePrecedingStatement(address: number, ranges: readonly AddressRange[]): number | undefined;

    /** Resolve a DWARF line-table file index to its normalized source path. */
    sourceFile(index: number): string | undefined;

    /** Symbol by name. */
    symbol(name: string): SymbolInfo | undefined;

    /** All exact-name symbols; duplicate names are preserved. */
    symbols(name: string): ReadonlyArray<SymbolInfo>;

    /** All symbols ordered by address and then name. */
    allSymbols(): ReadonlyArray<SymbolInfo>;

    /** Symbols whose start address is within the inclusive range. */
    symbolsInRange(start: number, end: number): ReadonlyArray<SymbolInfo>;

    /** Enclosing function/object symbol for a CPU address. */
    symbolAtAddress(address: number): SymbolInfo | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildDebugIndex(
    rows: LineRow[],
    symbols: Elf32Symbol[],
    compDir: string,
    declarations: DwarfVariableDeclaration[] = [],
    lineFiles: readonly string[] = [],
): DebugIndex {
    // ---- Normalize all file paths relative to compDir ----
    const norm = (f: string) => normalizePath(f, compDir);
    const normalizedRows = rows.map(r => ({ ...r, file: norm(r.file) }));

    // ---- Address → source (prefer executable statement rows per address) ----
    const byAddress = new Map<number, SourceLocation>();
    const statementRows: StatementRow[] = [];
    for (const r of normalizedRows) {
        const existing = byAddress.get(r.address);
        if (!existing || (!existing.isStmt && r.isStmt)) {
            byAddress.set(r.address, { file: r.file, line: r.line, column: r.column, isStmt: r.isStmt });
        }
    }
    for (const row of normalizedRows) {
        if (row.isStmt) {
            statementRows.push({
                address: row.address,
                file: row.file,
                line: row.line,
                column: row.column,
                isStmt: true,
                ...(row.discriminator === undefined ? {} : { discriminator: row.discriminator }),
            });
        }
    }
    statementRows.sort((left, right) => left.address - right.address || left.file.localeCompare(right.file)
        || left.line - right.line || left.column - right.column);
    const statementAddresses = [...new Set(statementRows.map(row => row.address))];

    // ---- Address → all statement rows in line-program emission order ----
    // Nested macro expansions stack an invocation row per level at the same
    // address as the deepest body row; presentation walks this list from the
    // end so each inline frame shows its own body statement.
    const rowsByAddress = new Map<number, SourceLocation[]>();
    for (const r of normalizedRows) {
        if (!r.isStmt) { continue; }
        const list = rowsByAddress.get(r.address) ?? [];
        list.push({ file: r.file, line: r.line, column: r.column, isStmt: r.isStmt });
        rowsByAddress.set(r.address, list);
    }

    // ---- Source (file, line) → addresses (sorted) ----
    // Key: normalized file path + ':' + line number
    const bySource = new Map<string, number[]>();
    for (const r of normalizedRows) {
        if (!r.isStmt) { continue; }  // only statement rows are valid breakpoint targets
        const key = sourceKey(r.file, r.line);
        const list = bySource.get(key) ?? [];
        if (!list.includes(r.address)) { list.push(r.address); }
        bySource.set(key, list);
    }

    // ---- Per-file sorted line → address map for "next statement" lookup ----
    const fileLines = new Map<string, Array<{ line: number; address: number }>>();
    for (const r of normalizedRows) {
        if (!r.isStmt) { continue; }
        const list = fileLines.get(r.file) ?? [];
        list.push({ line: r.line, address: r.address });
        fileLines.set(r.file, list);
    }
    // Sort by line within each file
    for (const list of fileLines.values()) {
        list.sort((a, b) => a.line - b.line);
    }

    // ---- Unique source files ----
    const normalizedDeclarations = declarations.map(declaration => ({
        ...declaration,
        file: norm(declaration.file),
    }));
    const sourceFiles = [...new Set([
        ...normalizedRows.map(row => row.file),
        ...normalizedDeclarations.map(declaration => declaration.file),
        // Line-table files without code rows (data-only sources) are still
        // navigation targets for the labels and constants they define.
        ...lineFiles.map(file => norm(file)),
    ])].sort();

    // ---- Symbol indexes ----
    const symbolsByName = new Map<string, SymbolInfo[]>();
    const symbolsByAddr: SymbolInfo[] = [];
    for (const s of symbols) {
        if (!s.name || s.section === 0) { continue; }
        const isCodeOrObject = s.type === STT_FUNC || s.type === STT_OBJECT;
        const isAbsoluteConstant = s.type === STT_NOTYPE && s.section === SHN_ABS;
        // Untyped labels in real sections are RAM variables and sub-labels
        // (e.g. engine runtime data) — valid navigation targets.
        const isDataLabel = s.type === STT_NOTYPE && s.section !== SHN_ABS;
        if (!isCodeOrObject && !isAbsoluteConstant && !isDataLabel) { continue; }
        if (isAbsoluteConstant) {
            // Constants included by several objects appear once per object in
            // the symbol table with identical name and value — they are the
            // same constant and must not make navigation ambiguous.
            const duplicate = (symbolsByName.get(s.name) ?? [])
                .find(candidate => candidate.address === s.value);
            if (duplicate) { continue; }
        }
        const declaration = isAbsoluteConstant
            ? normalizedDeclarations.find(item => item.name === s.name && item.value === s.value)
            : undefined;
        const info: SymbolInfo = {
            name: s.name, address: s.value, size: s.size, type: s.type, binding: s.binding,
            absolute: s.section === SHN_ABS,
            declaration: declaration && { file: declaration.file, line: declaration.line, column: 0, isStmt: false },
        };
        const named = symbolsByName.get(s.name) ?? [];
        named.push(info);
        symbolsByName.set(s.name, named);
        symbolsByAddr.push(info);
    }
    symbolsByAddr.sort((a, b) => a.address - b.address || a.name.localeCompare(b.name));

    // ---- Return implementation ----
    return {
        sourceFiles,
        statementRows,

        resolveBreakpoint(file, line) {
            const nf = resolveIndexedFile(norm(file), sourceFiles);
            if (!nf) { return undefined; }
            const key = sourceKey(nf, line);
            const addrs = bySource.get(key);
            if (addrs && addrs.length > 0) {
                return { address: addrs[0], verifiedLine: line };
            }
            // Slide to next stmt row in same file
            const rows = fileLines.get(nf);
            if (!rows) { return undefined; }
            const next = rows.find(r => r.line >= line);
            return next ? { address: next.address, verifiedLine: next.line } : undefined;
        },

        resolveBreakpointAll(file, line) {
            const nf = resolveIndexedFile(norm(file), sourceFiles);
            if (!nf) { return []; }
            const key = sourceKey(nf, line);
            const addrs = bySource.get(key);
            if (!addrs || addrs.length === 0) { return []; }
            return addrs.map(a => ({ address: a, verifiedLine: line }));
        },

        resolveAddress(address) {
            return byAddress.get(address);
        },

        resolveAddressRows(address) {
            return rowsByAddress.get(address) ?? [];
        },

        resolvePrecedingStatement(address, ranges) {
            for (let index = statementAddresses.length - 1; index >= 0; index--) {
                const candidate = statementAddresses[index];
                if (candidate >= address) { continue; }
                if (ranges.some(range => candidate >= range.start && candidate < range.end)) {
                    return candidate;
                }
            }
            return undefined;
        },

        sourceFile(index) {
            return lineFiles[index] ?? lineFiles[index - 1];
        },

        symbol(name) {
            const matches = symbolsByName.get(name);
            return matches?.length === 1 ? matches[0] : undefined;
        },

        symbols(name) {
            return symbolsByName.get(name) ?? [];
        },

        allSymbols() {
            return symbolsByAddr;
        },

        symbolsInRange(start, end) {
            if (start > end) { return []; }
            return symbolsByAddr.filter(symbol => symbol.address >= start && symbol.address <= end);
        },

        symbolAtAddress(address) {
            // Find the last symbol whose start <= address and start + size > address
            let best: SymbolInfo | undefined;
            for (const s of symbolsByAddr) {
                if (s.address > address) { break; }
                const end = s.address + (s.size || 1);
                if (address < end) { best = s; }
            }
            return best;
        },
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceKey(file: string, line: number): string {
    return `${file}:${line}`;
}

function normalizePath(f: string, compDir: string): string {
    if (path.isAbsolute(f)) { return path.normalize(f); }
    const resolved = compDir ? path.resolve(compDir, f) : f;
    return path.normalize(resolved);
}

function resolveIndexedFile(file: string, sourceFiles: ReadonlyArray<string>): string | undefined {
    const caseInsensitive = process.platform === 'win32'
        || path.win32.isAbsolute(file)
        || sourceFiles.some(candidate => path.win32.isAbsolute(candidate));
    const comparable = (value: string) => caseInsensitive ? value.toLowerCase() : value;
    const comparableFile = comparable(file);
    const exact = sourceFiles.find(candidate => comparable(candidate) === comparableFile);
    if (exact) { return exact; }

    const suffix = `${path.sep}${comparableFile}`;
    const matches = sourceFiles.filter(candidate =>
        comparable(candidate).endsWith(suffix)
        || comparableFile.endsWith(`${path.sep}${comparable(candidate)}`),
    );
    if (matches.length === 1) { return matches[0]; }
    if (matches.length > 1) { return undefined; }

    // The breakpoint path and the indexed path can be rooted at different
    // locations: the debug metadata records the machine layout where the ROM
    // was built, while the breakpoint comes from the workspace copy of the
    // same sources. Match by the longest common run of trailing path
    // segments and require the best match to be unique.
    return matchByTrailingSegments(comparableFile, sourceFiles, comparable);
}

function splitPathSegments(value: string): string[] {
    return value.split(/[\\/]+/)
        .filter(segment => segment.length > 0 && !/^[A-Za-z]:$/.test(segment));
}

function matchByTrailingSegments(
    file: string,
    candidates: ReadonlyArray<string>,
    comparable: (value: string) => string,
): string | undefined {
    const fileSegments = splitPathSegments(file);
    if (fileSegments.length === 0) { return undefined; }
    let best: string | undefined;
    let bestLength = 0;
    let ties = 0;
    for (const candidate of candidates) {
        const candidateSegments = splitPathSegments(comparable(candidate));
        const limit = Math.min(fileSegments.length, candidateSegments.length);
        let length = 0;
        while (length < limit
            && fileSegments[fileSegments.length - 1 - length] === candidateSegments[candidateSegments.length - 1 - length]) {
            length++;
        }
        if (length > bestLength) {
            best = candidate;
            bestLength = length;
            ties = 1;
        } else if (length === bestLength && length > 0) {
            ties++;
        }
    }
    return ties === 1 ? best : undefined;
}
