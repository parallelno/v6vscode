import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
import { SourceLocation, SymbolInfo } from '../../debug/metadata/debug-index';
import { resolveDebugSourcePath } from '../../debug/metadata/debug-source-path';

export const CMD_REVEAL_SYMBOL_SOURCE = 'v6.revealSymbolSource';

const SYMBOL_PATTERN = /[A-Za-z_.@][A-Za-z0-9_.@$]*/g;

export interface SymbolToken {
    name: string;
    line: number;
    start: number;
    length: number;
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

export class SymbolLinkProvider implements vscode.DocumentLinkProvider {
    constructor(
        private readonly activeProjectService: ActiveProjectService,
        private readonly symbols: DebugSymbolService,
    ) {}

    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentLink[]> {
        const project = this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
        if (token.isCancellationRequested || !project?.run.debugArtifact) { return []; }

        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
        } catch {
            return [];
        }
        if (token.isCancellationRequested) { return []; }

        const links: vscode.DocumentLink[] = [];
        for (const symbolToken of findSymbolTokens(document.getText())) {
            const resolution = this.symbols.resolveSymbol(symbolToken.name);
            if (resolution.kind !== 'found') { continue; }
            const source = this.sourceForSymbol(resolution.symbol, path.dirname(project.uri.fsPath));
            if (!source) { continue; }
            const range = new vscode.Range(
                new vscode.Position(symbolToken.line, symbolToken.start),
                new vscode.Position(symbolToken.line, symbolToken.start + symbolToken.length),
            );
            const target = vscode.Uri.parse(
                `command:${CMD_REVEAL_SYMBOL_SOURCE}?${encodeURIComponent(JSON.stringify(source))}`,
            );
            const link = new vscode.DocumentLink(range, target);
            link.tooltip = 'Follow link';
            links.push(link);
        }
        return links;
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
