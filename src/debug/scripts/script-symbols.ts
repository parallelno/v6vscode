import { createHash } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import * as path from 'path';
import { TextDecoder } from 'util';
import { ScriptInput, ScriptLimits } from '../../emulator/protocol/debug-models';
import type { SymbolInfo } from '../metadata/debug-index';

/** Lexical substitution: strings, comments, numeric literals and partial names are untouched. */
export function replaceScriptSymbols(source: string, symbols: readonly Pick<SymbolInfo, 'name' | 'address'>[]): string {
    const values = new Map<string, number>();
    const ambiguous = new Set<string>();
    for (const symbol of symbols) {
        if (values.has(symbol.name) && values.get(symbol.name) !== symbol.address) { ambiguous.add(symbol.name); }
        values.set(symbol.name, symbol.address);
    }
    const token = /--\[(=*)\[[\s\S]*?\]\1\]|--[^\r\n]*|\[(=*)\[[\s\S]*?\]\2\]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?\d+)?|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)|[A-Za-z_][A-Za-z0-9_]*/g;
    return source.replace(token, match => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(match) || !values.has(match)) { return match; }
        if (ambiguous.has(match)) { throw new Error(`Script symbol is ambiguous: ${match}`); }
        return `0x${values.get(match)!.toString(16).toUpperCase()}`;
    });
}

/** Generated files remain available for emulator-owned records after panel/extension disposal. */
export async function prepareSymbolScript(
    input: ScriptInput, limits: ScriptLimits, cacheDirectory: string,
    symbols: readonly Pick<SymbolInfo, 'name' | 'address'>[],
): Promise<ScriptInput> {
    if (!input.useDebugSymbols) { return { name: input.name, path: input.path, active: input.active }; }
    const file = await stat(input.path);
    if (!file.isFile() || file.size > limits.maxSourceBytes) { throw new Error('Script source is not a regular file or exceeds maxSourceBytes'); }
    const bytes = await readFile(input.path);
    if (bytes.length > limits.maxSourceBytes) { throw new Error('Script source exceeds maxSourceBytes'); }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (source.includes('\0')) { throw new Error('Script source contains NUL bytes'); }
    const processed = replaceScriptSymbols(source, symbols);
    if (Buffer.byteLength(processed, 'utf8') > limits.maxSourceBytes) { throw new Error('Processed script source exceeds maxSourceBytes'); }
    const hash = createHash('sha256').update(input.path).update('\0').update(processed).digest('hex');
    const destination = path.join(cacheDirectory, `${hash}.lua`).replace(/\\/g, '/');
    if (Buffer.byteLength(destination, 'utf8') > limits.maxPathBytes) { throw new Error('Generated script path exceeds maxPathBytes'); }
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(destination, processed, 'utf8');
    return { name: input.name, path: destination, active: input.active };
}