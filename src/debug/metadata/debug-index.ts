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
import { Elf32Symbol, STT_FUNC, STT_OBJECT } from './elf32-reader';

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
}

export interface DebugIndex {
    /** All source file paths in the index. */
    readonly sourceFiles: ReadonlyArray<string>;

    /**
     * Find the best breakpoint address for a given source location.
     * Returns the exact or next `is_stmt` row address in the same file.
     */
    resolveBreakpoint(file: string, line: number): { address: number; verifiedLine: number } | undefined;

    /** All addresses for a given source line (macros/loops may produce several). */
    resolveBreakpointAll(file: string, line: number): Array<{ address: number; verifiedLine: number }>;

    /** Reverse: CPU address → source location. */
    resolveAddress(address: number): SourceLocation | undefined;

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
): DebugIndex {
    // ---- Normalize all file paths relative to compDir ----
    const norm = (f: string) => normalizePath(f, compDir);
    const normalizedRows = rows.map(r => ({ ...r, file: norm(r.file) }));

    // ---- Address → source (first is_stmt row wins for each address) ----
    const byAddress = new Map<number, SourceLocation>();
    for (const r of normalizedRows) {
        if (!byAddress.has(r.address)) {
            byAddress.set(r.address, { file: r.file, line: r.line, column: r.column, isStmt: r.isStmt });
        }
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
    const sourceFiles = [...new Set(normalizedRows.map(r => r.file))].sort();

    // ---- Symbol indexes ----
    const symbolsByName = new Map<string, SymbolInfo[]>();
    const symbolsByAddr: SymbolInfo[] = [];
    for (const s of symbols) {
        if (!s.name || s.section === 0) { continue; }
        if (s.type !== STT_FUNC && s.type !== STT_OBJECT) { continue; }
        const info: SymbolInfo = { name: s.name, address: s.value, size: s.size, type: s.type, binding: s.binding };
        const named = symbolsByName.get(s.name) ?? [];
        named.push(info);
        symbolsByName.set(s.name, named);
        symbolsByAddr.push(info);
    }
    symbolsByAddr.sort((a, b) => a.address - b.address || a.name.localeCompare(b.name));

    // ---- Return implementation ----
    return {
        sourceFiles,

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
    if (sourceFiles.includes(file)) { return file; }

    const suffix = `${path.sep}${file}`;
    const matches = sourceFiles.filter(candidate =>
        candidate.endsWith(suffix) || file.endsWith(`${path.sep}${candidate}`),
    );
    return matches.length === 1 ? matches[0] : undefined;
}
