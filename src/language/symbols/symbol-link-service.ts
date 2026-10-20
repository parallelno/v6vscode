import { codeBeforeComment } from '../asm-lexical';
import type { SourceLocation, SymbolInfo } from '../../debug/metadata/debug-index';
import type { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
import { resolveDebugSourcePath } from '../../debug/metadata/debug-source-path';

const SYMBOL_PATTERN = /[A-Za-z_.@][A-Za-z0-9_.@$]*/g;

export interface SymbolToken {
    name: string;
    line: number;
    start: number;
    length: number;
}

export interface TextRange {
    start: number;
    length: number;
}

export interface SourceDocumentContext {
    projectRoot: string;
    debugArtifact: string;
    executable: string;
}

export interface SymbolLink {
    start: number;
    length: number;
    name: string;
    target: SourceLocation;
}

export interface SourceSymbolLinkService {
    links(text: string, context: SourceDocumentContext): Promise<readonly SymbolLink[]>;
    resolve(
        text: string,
        range: TextRange,
        context: SourceDocumentContext,
    ): Promise<SourceLocation | undefined>;
}

export type SourceTextReader = (sourcePath: string) => Promise<string | undefined>;

/** Return assembler identifiers outside quoted strings and ';' comments. */
export function findSymbolTokens(text: string): SymbolToken[] {
    const tokens: SymbolToken[] = [];
    for (const [line, rawLine] of text.split(/\r?\n/).entries()) {
        const code = codeBeforeComment(rawLine);
        SYMBOL_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = SYMBOL_PATTERN.exec(code)) !== null) {
            tokens.push({ name: match[0], line, start: match.index, length: match[0].length });
        }
    }
    return tokens;
}

/** Find an exact global-label definition in an assembler source file. */
export function findLabelDefinition(text: string, name: string): SourceLocation | undefined {
    const definition = new RegExp(`^\\s*${escapeRegExp(name)}\\s*:`, 'm');
    return findDefinitionMatch(text, definition, name);
}

/** Find a macro definition (`.macro NAME`) in an assembler source file. */
export function findMacroDefinition(text: string, name: string): SourceLocation | undefined {
    const definition = new RegExp(`^\\s*\\.macro\\s+${escapeRegExp(name)}\\b`, 'm');
    return findDefinitionMatch(text, definition, name);
}

/** Find a struct definition (`.struct NAME`) in an assembler source file. */
export function findStructDefinition(text: string, name: string): SourceLocation | undefined {
    const definition = new RegExp(`^\\s*\\.struct\\s+${escapeRegExp(name)}\\b`, 'im');
    return findDefinitionMatch(text, definition, name);
}

/**
 * Find a field line inside a `.struct` block, following `extends` parents for
 * inherited fields (inherited fields keep their names, so `char.pos_x` lives
 * in the `actor` block).
 */
export function findStructFieldDefinition(
    text: string,
    structName: string,
    field: string,
    visited: Set<string> = new Set(),
): SourceLocation | undefined {
    const key = structName.toLowerCase();
    if (visited.has(key)) { return undefined; }
    visited.add(key);
    const fieldPattern = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:`, 'i');
    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
        const header = /^\s*\.struct\s+([^\s;]+)(?:\s+extends\s+([^\s;]+))?/i.exec(codeBeforeComment(lines[line]));
        if (!header || header[1].toLowerCase() !== structName.toLowerCase()) { continue; }
        for (let bodyLine = line + 1; bodyLine < lines.length; bodyLine++) {
            const body = codeBeforeComment(lines[bodyLine]);
            if (/^\s*\.(?:ends|endstruct)\b/i.test(body)) { break; }
            if (/^\s*\.struct\b/i.test(body)) { break; }
            const fieldMatch = fieldPattern.exec(body);
            if (fieldMatch) {
                return { file: '', line: bodyLine + 1, column: fieldMatch[0].indexOf(field) + 1, isStmt: false };
            }
        }
        if (header[2]) {
            const parent = findStructFieldDefinition(text, header[2], field, visited);
            if (parent) { return parent; }
        }
        return undefined;
    }
    return undefined;
}

/** Find a constant definition (`NAME = value`) in an assembler source file. */
export function findConstantDefinition(text: string, name: string): SourceLocation | undefined {
    const definition = new RegExp(`^\\s*${escapeRegExp(name)}\\s*=(?!=)`, 'm');
    return findDefinitionMatch(text, definition, name);
}

function findDefinitionMatch(text: string, definition: RegExp, name: string): SourceLocation | undefined {
    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
        const match = definition.exec(codeBeforeComment(lines[line]));
        if (match) {
            return { file: '', line: line + 1, column: match[0].indexOf(name) + 1, isStmt: false };
        }
    }
    return undefined;
}

export class DebugSourceSymbolLinkService implements SourceSymbolLinkService {
    private definitionScanCache = new Map<string, SourceLocation | undefined>();
    private sourceRevision = 0;

    invalidateSourceDefinitions(): void { this.sourceRevision++; this.definitionScanCache.clear(); }

    constructor(
        private readonly symbols: DebugSymbolService,
        private readonly readSourceText: SourceTextReader,
        private readonly resolveSourcePath: (file: string, root: string) => string = resolveDebugSourcePath,
    ) {}

    async links(text: string, context: SourceDocumentContext): Promise<readonly SymbolLink[]> {
        const symbols = await this.load(context);
        const links: SymbolLink[] = [];
        for (const token of findSymbolTokens(text)) {
            const target = await this.resolveToken(token.name, context.projectRoot, symbols);
            if (target) {
                links.push({
                    start: token.start,
                    length: token.length,
                    name: token.name,
                    target,
                });
            }
        }
        return links;
    }

    async resolve(
        text: string,
        range: TextRange,
        context: SourceDocumentContext,
    ): Promise<SourceLocation | undefined> {
        if (!Number.isInteger(range.start) || !Number.isInteger(range.length)
            || range.start < 0 || range.length <= 0 || range.start + range.length > text.length) {
            return undefined;
        }
        const token = findSymbolTokens(text).find(candidate =>
            candidate.line === 0
            && candidate.start === range.start
            && candidate.length === range.length,
        );
        if (!token || text.slice(range.start, range.start + range.length) !== token.name) {
            return undefined;
        }
        const symbols = await this.load(context);
        return this.resolveToken(token.name, context.projectRoot, symbols);
    }

    private async load(context: SourceDocumentContext): Promise<DebugSymbolService> {
        const symbols = this.symbols.fork();
        await symbols.load(context.debugArtifact, context.executable);
        return symbols;
    }

    private async resolveToken(name: string, projectRoot: string, symbols: DebugSymbolService): Promise<SourceLocation | undefined> {
        const resolution = symbols.resolveSymbol(name);
        if (resolution.kind === 'found') {
            return await this.sourceForSymbol(resolution.symbol, projectRoot, symbols)
                ?? this.scanDefinitionInSources(name, projectRoot, symbols);
        }
        if (resolution.kind === 'missing') {
            // Macros and constants without DWARF declarations produce no ELF
            // symbol — locate their definition by scanning the sources.
            return this.scanDefinitionInSources(name, projectRoot, symbols);
        }
        return undefined;
    }

    private async sourceForSymbol(
        symbol: SymbolInfo,
        projectRoot: string,
        symbols: DebugSymbolService,
    ): Promise<SourceLocation | undefined> {
        if (symbol.declaration) { return symbol.declaration; }
        let nonLabelMatch: SourceLocation | undefined;
        for (const file of symbols.sourceFiles()) {
            const sourcePath = this.resolveSourcePath(file, projectRoot);
            const text = await this.readSourceText(sourcePath);
            if (text === undefined) { continue; }
            const label = findLabelDefinition(text, symbol.name);
            if (label) { return { ...label, file }; }
            // A label definition is preferred; remember macro/constant matches
            // in case no label definition exists anywhere.
            if (nonLabelMatch === undefined) {
                const match = findMacroDefinition(text, symbol.name)
                    ?? findConstantDefinition(text, symbol.name);
                if (match) { nonLabelMatch = { ...match, file }; }
            }
        }
        return nonLabelMatch ?? symbols.sourceAtExactAddress(symbol.address);
    }

    private async scanDefinitionInSources(name: string, projectRoot: string, symbols: DebugSymbolService): Promise<SourceLocation | undefined> {
        const revision = this.sourceRevision;
        const cacheKey = `${revision}|${symbols.artifactVersion}|${projectRoot}|${name}`;
        if (this.definitionScanCache.has(cacheKey)) { return this.definitionScanCache.get(cacheKey); }
        const result = await this.scanSources(name, projectRoot, symbols);
        if (revision === this.sourceRevision) { this.definitionScanCache.set(cacheKey, result); }
        while (this.definitionScanCache.size > 512) { this.definitionScanCache.delete(this.definitionScanCache.keys().next().value!); }
        return result;
    }

    private async scanSources(name: string, projectRoot: string, symbols: DebugSymbolService): Promise<SourceLocation | undefined> {
        const dotIndex = name.indexOf('.');
        for (const file of symbols.sourceFiles()) {
            const sourcePath = this.resolveSourcePath(file, projectRoot);
            const text = await this.readSourceText(sourcePath);
            if (text === undefined) { continue; }
            if (dotIndex > 0) {
                // `struct.field` resolves to the field line (following extends);
                // otherwise the base may be an instance label (`hero.pos_x`).
                const base = name.slice(0, dotIndex);
                const field = name.slice(dotIndex + 1);
                const structField = findStructFieldDefinition(text, base, field);
                if (structField) { return { ...structField, file }; }
                const labelBase = findLabelDefinition(text, base);
                if (labelBase) { return { ...labelBase, file }; }
            }
            const macro = findMacroDefinition(text, name);
            if (macro) { return { ...macro, file }; }
            const constant = findConstantDefinition(text, name);
            if (constant) { return { ...constant, file }; }
            const label = findLabelDefinition(text, name);
            if (label) { return { ...label, file }; }
            const struct = findStructDefinition(text, name);
            if (struct) { return { ...struct, file }; }
        }
        return undefined;
    }
}


function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}