import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
import { SourceLocation } from '../../debug/metadata/debug-index';
import { resolveDebugSourcePath } from '../../debug/metadata/debug-source-path';
import {
    findLabelDefinition,
    findSymbolTokens,
    SourceDocumentContext,
    SourceSymbolLinkService,
    SymbolToken,
} from './symbol-link-service';

export { findLabelDefinition, findSymbolTokens, SourceDocumentContext, SymbolToken };

export const CMD_REVEAL_SYMBOL_SOURCE = 'v6.revealSymbolSource';

const BYTE_REGISTERS = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'M']);
const WORD_REGISTERS = new Set(['AF', 'BC', 'DE', 'HL', 'SP', 'PC']);
const PAIR_OPERAND_MNEMONICS = new Set(['LXI', 'DAD', 'INX', 'DCX', 'PUSH', 'POP', 'LDAX', 'STAX']);

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

export class SymbolLinkProvider implements vscode.HoverProvider, vscode.DefinitionProvider {
    constructor(
        private readonly activeProjectService: ActiveProjectService,
        private readonly symbols: DebugSymbolService,
        private readonly linkService: SourceSymbolLinkService,
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

        const context = this.contextForProject(project);
        let source: SourceLocation | undefined;
        try {
            source = await this.linkService.resolve(
                document.lineAt(position.line).text,
                { start: symbolToken.start, length: symbolToken.length },
                context,
            );
        } catch {
            return undefined;
        }
        if (token.isCancellationRequested) { return undefined; }
        if (!source) { return undefined; }

        const resolution = this.symbols.resolveSymbol(symbolToken.name);
        if (resolution.kind !== 'found') { return undefined; }

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

        let source: SourceLocation | undefined;
        try {
            source = await this.linkService.resolve(
                document.lineAt(position.line).text,
                { start: symbolToken.start, length: symbolToken.length },
                this.contextForProject(project),
            );
        } catch {
            return undefined;
        }
        if (token.isCancellationRequested) { return undefined; }
        if (!source) { return undefined; }

        const target = new vscode.Position(Math.max(0, source.line - 1), Math.max(0, source.column - 1));
        return new vscode.Location(
            vscode.Uri.file(resolveDebugSourcePath(source.file, path.dirname(project.uri.fsPath))),
            target,
        );
    }

    private contextForProject(project: {
        uri: vscode.Uri;
        run: { debugArtifact?: string; executable: string };
    }): SourceDocumentContext {
        return {
            projectRoot: path.dirname(project.uri.fsPath),
            debugArtifact: project.run.debugArtifact!,
            executable: project.run.executable,
        };
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
