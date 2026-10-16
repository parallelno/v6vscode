import { SourceLocation, SymbolInfo } from '../../debug/metadata/debug-index';
import { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
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

    constructor(
        private readonly symbols: DebugSymbolService,
        private readonly readSourceText: SourceTextReader,
    ) {}

    async links(text: string, context: SourceDocumentContext): Promise<readonly SymbolLink[]> {
        await this.load(context);
        const links: SymbolLink[] = [];
        for (const token of findSymbolTokens(text)) {
            const target = await this.resolveToken(token.name, context.projectRoot);
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
        await this.load(context);
        return this.resolveToken(token.name, context.projectRoot);
    }

    private async load(context: SourceDocumentContext): Promise<void> {
        await this.symbols.load(context.debugArtifact, context.executable);
        this.definitionScanCache.clear();
    }

    private async resolveToken(name: string, projectRoot: string): Promise<SourceLocation | undefined> {
        const resolution = this.symbols.resolveSymbol(name);
        if (resolution.kind === 'found') {
            return await this.sourceForSymbol(resolution.symbol, projectRoot)
                ?? this.scanDefinitionInSources(name, projectRoot);
        }
        if (resolution.kind === 'missing') {
            // Macros and constants without DWARF declarations produce no ELF
            // symbol — locate their definition by scanning the sources.
            return this.scanDefinitionInSources(name, projectRoot);
        }
        return undefined;
    }

    private async sourceForSymbol(
        symbol: SymbolInfo,
        projectRoot: string,
    ): Promise<SourceLocation | undefined> {
        if (symbol.declaration) { return symbol.declaration; }
        let nonLabelMatch: SourceLocation | undefined;
        for (const file of this.symbols.sourceFiles()) {
            const sourcePath = resolveDebugSourcePath(file, projectRoot);
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
        return nonLabelMatch ?? this.symbols.sourceAtExactAddress(symbol.address);
    }

    private async scanDefinitionInSources(name: string, projectRoot: string): Promise<SourceLocation | undefined> {
        const cacheKey = `${projectRoot}|${name}`;
        if (this.definitionScanCache.has(cacheKey)) { return this.definitionScanCache.get(cacheKey); }
        const result = await this.scanSources(name, projectRoot);
        this.definitionScanCache.set(cacheKey, result);
        return result;
    }

    private async scanSources(name: string, projectRoot: string): Promise<SourceLocation | undefined> {
        for (const file of this.symbols.sourceFiles()) {
            const sourcePath = resolveDebugSourcePath(file, projectRoot);
            const text = await this.readSourceText(sourcePath);
            if (text === undefined) { continue; }
            const macro = findMacroDefinition(text, name);
            if (macro) { return { ...macro, file }; }
            const constant = findConstantDefinition(text, name);
            if (constant) { return { ...constant, file }; }
            const label = findLabelDefinition(text, name);
            if (label) { return { ...label, file }; }
        }
        return undefined;
    }
}

function codeBeforeComment(line: string): string {
    let quoted = false;
    let result = '';
    for (const character of line) {
        if (character === '"') { quoted = !quoted; result += ' '; continue; }
        if (!quoted && character === ';') { break; }
        result += quoted ? ' ' : character;
    }
    return result;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}