import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
import { SourceLocation, SymbolInfo } from '../../debug/metadata/debug-index';
import { resolveDebugSourcePath } from '../../debug/metadata/debug-source-path';

export const CMD_REVEAL_SYMBOL_SOURCE = 'v6.revealSymbolSource';

const SYMBOL_PATTERN = /[A-Za-z_.@][A-Za-z0-9_.@$]*/g;
const BYTE_REGISTERS = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'M']);
const WORD_REGISTERS = new Set(['AF', 'BC', 'DE', 'HL', 'SP', 'PC']);
const PAIR_OPERAND_MNEMONICS = new Set(['LXI', 'DAD', 'INX', 'DCX', 'PUSH', 'POP', 'LDAX', 'STAX']);

export interface SymbolToken {
    name: string;
    line: number;
    start: number;
    length: number;
}

export function revealSymbolCommandUri(source: SourceLocation): string {
    return `command:${CMD_REVEAL_SYMBOL_SOURCE}?${encodeURIComponent(JSON.stringify(source))}`;
}

export function registerExpressionForHover(line: string, token: string): string | undefined {
    const register = token.toUpperCase();
    if (!BYTE_REGISTERS.has(register) && !WORD_REGISTERS.has(register) && register !== 'PSW') {
        return undefined;
    }

    const code = codeBeforeComment(line).trim().toUpperCase();
    const instruction = /^(?:[A-Z_.@][A-Z0-9_.@$]*:\s*)?([A-Z]+)\s+([A-Z]+)\b/.exec(code);
    if (instruction
        && PAIR_OPERAND_MNEMONICS.has(instruction[1])
        && instruction[2] === register) {
        return ({ B: 'BC', D: 'DE', H: 'HL', PSW: 'AF' } as Record<string, string>)[register]
            ?? register;
    }
    return register === 'PSW' ? undefined : register;
}

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
    const lines = text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
        const match = definition.exec(codeBeforeComment(lines[line]));
        if (match) {
            return { file: '', line: line + 1, column: match[0].indexOf(name) + 1, isStmt: false };
        }
    }
    return undefined;
}

export class SymbolLinkProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
    constructor(
        private readonly activeProjectService: ActiveProjectService,
        private readonly symbols: DebugSymbolService,
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        const symbolToken = findSymbolTokens(document.getText()).find(candidate =>
            candidate.line === position.line
            && candidate.start <= position.character
            && position.character < candidate.start + candidate.length,
        );
        if (!symbolToken) { return undefined; }

        const registerExpression = registerExpressionForHover(
            document.lineAt(position.line).text,
            symbolToken.name,
        );
        const debugSession = vscode.debug.activeDebugSession;
        if (registerExpression && debugSession?.type === 'v6') {
            try {
                const evaluation = await debugSession.customRequest('evaluate', {
                    expression: registerExpression,
                    context: 'hover',
                });
                if (token.isCancellationRequested || typeof evaluation?.result !== 'string') {
                    return undefined;
                }
                const range = new vscode.Range(
                    new vscode.Position(symbolToken.line, symbolToken.start),
                    new vscode.Position(symbolToken.line, symbolToken.start + symbolToken.length),
                );
                return new vscode.Hover(evaluation.result, range);
            } catch {
                return undefined;
            }
        }

        const project = this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
        if (token.isCancellationRequested || !project?.run.debugArtifact) { return undefined; }

        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
        } catch {
            return undefined;
        }
        if (token.isCancellationRequested) { return undefined; }

        const resolution = this.symbols.resolveSymbol(symbolToken.name);
        if (resolution.kind !== 'found') { return undefined; }
        const source = this.sourceForSymbol(resolution.symbol, path.dirname(project.uri.fsPath));
        if (!source) { return undefined; }

        const markdown = new vscode.MarkdownString();
        markdown.appendText(`Value: 0x${resolution.symbol.address.toString(16).toUpperCase().padStart(4, '0')}\n`);
        markdown.appendMarkdown(`[Go to Definition](${revealSymbolCommandUri(source)}) (ctrl + click)`);
        markdown.isTrusted = true;
        const range = new vscode.Range(
            new vscode.Position(symbolToken.line, symbolToken.start),
            new vscode.Position(symbolToken.line, symbolToken.start + symbolToken.length),
        );
        return new vscode.Hover(markdown, range);
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Location | undefined> {
        const symbolToken = findSymbolTokens(document.getText()).find(candidate =>
            candidate.line === position.line
            && candidate.start <= position.character
            && position.character < candidate.start + candidate.length,
        );
        if (!symbolToken) { return undefined; }

        const project = this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
        if (token.isCancellationRequested || !project?.run.debugArtifact) { return undefined; }

        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
        } catch {
            return undefined;
        }
        if (token.isCancellationRequested) { return undefined; }

        const resolution = this.symbols.resolveSymbol(symbolToken.name);
        if (resolution.kind !== 'found') { return undefined; }
        const source = this.sourceForSymbol(resolution.symbol, path.dirname(project.uri.fsPath));
        if (!source) { return undefined; }

        const target = new vscode.Position(Math.max(0, source.line - 1), Math.max(0, source.column - 1));
        return new vscode.Location(
            vscode.Uri.file(resolveDebugSourcePath(source.file, path.dirname(project.uri.fsPath))),
            target,
        );
    }

    private sourceForSymbol(symbol: SymbolInfo, projectRoot: string): SourceLocation | undefined {
        if (symbol.declaration) { return symbol.declaration; }
        for (const file of this.symbols.sourceFiles()) {
            const sourcePath = resolveDebugSourcePath(file, projectRoot);
            if (!fs.existsSync(sourcePath)) { continue; }
            const definition = findLabelDefinition(fs.readFileSync(sourcePath, 'utf8'), symbol.name);
            if (definition) { return { ...definition, file }; }
        }
        return this.symbols.sourceAtExactAddress(symbol.address);
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
