import { codeBeforeComment } from '../asm-lexical';
import { projectSourceRoot } from '../../project/model/source-context';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { DebugSymbolService } from '../../debug/metadata/debug-symbol-service';
import { SourceLocation } from '../../debug/metadata/debug-index';
import { resolveDebugSourcePath } from '../../debug/metadata/debug-source-path';
import { ASM_BYTE_REGISTERS, ASM_HOVER_REQUEST, ASM_WORD_REGISTERS, AsmHoverRow, AsmHoverTarget, formatAsmHoverRow, isAsmConstant } from '../../debug/values/asm-hover';
import {
    findSymbolTokens,
    SourceDocumentContext,
    SourceSymbolLinkService,
    SymbolToken,
} from './symbol-link-service';

export const CMD_REVEAL_SYMBOL_SOURCE = 'v6.revealSymbolSource';

const PAIR_OPERAND_MNEMONICS = new Set(['LXI', 'DAD', 'INX', 'DCX', 'PUSH', 'POP', 'LDAX', 'STAX']);
const BYTE_OPERAND_MNEMONICS = new Set(['MOV', 'MVI', 'INR', 'DCR', 'ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP']);
const COMPAT_REGISTER_MNEMONICS = new Set(['LD', 'INC', 'DEC', 'EX', 'SBC', 'AND', 'XOR', 'OR', 'CP']);
const MNEMONICS = new Set([
    ...PAIR_OPERAND_MNEMONICS, ...BYTE_OPERAND_MNEMONICS, ...COMPAT_REGISTER_MNEMONICS,
    ...'ACI ADI ANI CMA CMC CPI DAA DI EI HLT IN LDA LHLD NOP ORI OUT RAL RAR RLC RRC SBI SHLD SPHL STA STC SUI XCHG XRI XTHL'.split(' '),
    ...'CALL CC CM CNC CNZ CP CPE CPO CZ JC JM JMP JNC JNZ JP JPE JPO JZ PCHL RC RET RM RNC RNZ RP RPE RPO RST RZ'.split(' '),
    ...'HALT RLCA RRCA RLA RRA CPL SCF CCF'.split(' '),
]);

function instructionOnLine(code: string): { name: string; start: number; end: number } | undefined {
    const head = /^\s*(?:[\w.@$]+\s*:\s*)*([a-z]+)(?=\s|$)/i.exec(code);
    if (!head || !MNEMONICS.has(head[1].toUpperCase())) { return undefined; }
    return { name: head[1].toUpperCase(), start: head[0].length - head[1].length, end: head[0].length };
}

export function revealSymbolCommandUri(source: SourceLocation): string {
    return `command:${CMD_REVEAL_SYMBOL_SOURCE}?${encodeURIComponent(JSON.stringify(source))}`;
}

export function registerExpressionForHover(line: string, token: string, start?: number): string | undefined {
    const code = codeBeforeComment(line).replace(/\/\/.*$/, '');
    const instruction = instructionOnLine(code);
    if (!instruction) { return undefined; }
    let operandStart = instruction.end;
    const operands = code.slice(operandStart).split(',');
    for (const [index, operand] of operands.entries()) {
        const match = /^(\s*(?:\(\s*)?)([a-z]+)\s*(\))?\s*$/i.exec(operand);
        const registerStart = operandStart + (match?.[1].length ?? 0);
        operandStart += operand.length + 1;
        if (!match || (start !== undefined && start !== registerStart)) { continue; }
        const register = match[2].toUpperCase();
        const indirect = match[1].includes('(');
        if (register !== token.toUpperCase() || indirect !== Boolean(match[3])) { continue; }
        const mnemonic = instruction.name;
        if (PAIR_OPERAND_MNEMONICS.has(mnemonic) && index === 0 && !indirect) {
            const aliases: Record<string, string> = { B: 'BC', D: 'DE', H: 'HL', PSW: 'AF' };
            const pair = aliases[register] ?? register;
            if (ASM_WORD_REGISTERS.has(pair)) { return pair; }
        } else if (BYTE_OPERAND_MNEMONICS.has(mnemonic) || COMPAT_REGISTER_MNEMONICS.has(mnemonic)) {
            if (index > 0 && mnemonic === 'MVI') { continue; }
            if (register === 'HL' && indirect) { return 'M'; }
            if (ASM_WORD_REGISTERS.has(register)) { return register; }
            if (ASM_BYTE_REGISTERS.has(register) && !indirect) { return register; }
        } else if (index === 0 && mnemonic === 'JP' && register === 'HL' && indirect) {
            return 'HL';
        }
    }
    return undefined;
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

        if (token.isCancellationRequested) { return undefined; }
        const line = document.lineAt(position.line).text;
        const code = codeBeforeComment(line).replace(/\/\/.*$/, '');
        if (symbolToken.start >= code.length) { return undefined; }
        const instruction = instructionOnLine(code);
        const register = registerExpressionForHover(line, symbolToken.name, symbolToken.start);
        const target: AsmHoverTarget = instruction?.start === symbolToken.start
            && instruction.end === symbolToken.start + symbolToken.length
            ? { kind: 'instruction', file: document.uri.fsPath, line: position.line + 1 }
            : register ? { kind: 'register', name: register } : { kind: 'symbol', name: symbolToken.name };
        const debugSession = vscode.debug.activeDebugSession;
        let rows: AsmHoverRow[] | undefined;
        if (debugSession?.type === 'v6') {
            try {
                const stackItem = vscode.debug.activeStackItem;
                const frameId = stackItem instanceof vscode.DebugStackFrame && stackItem.session === debugSession
                    ? stackItem.frameId : undefined;
                const response = await debugSession.customRequest(ASM_HOVER_REQUEST, { hoverTarget: target, frameId });
                if (response?.rows?.length && vscode.debug.activeDebugSession === debugSession) { rows = response.rows; }
            } catch {
                // Static symbols and definition links do not require a stopped emulator.
            }
        }
        if (token.isCancellationRequested) { return undefined; }
        if (target.kind !== 'symbol') {
            return rows ? this.hover(symbolToken, rows) : undefined;
        }

        const project = this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
        if (token.isCancellationRequested) { return undefined; }
        if (!project?.run.debugArtifact) { return rows ? this.hover(symbolToken, rows) : undefined; }
        let source: SourceLocation | undefined;
        try {
            source = await this.linkService.resolve(
                line,
                { start: symbolToken.start, length: symbolToken.length },
                this.contextForProject(project),
            );
        } catch {
            // Source lookup failure must not hide a successfully evaluated value.
        }
        if (token.isCancellationRequested) { return undefined; }
        if (!rows || vscode.debug.activeDebugSession !== debugSession) {
            const resolution = this.symbols.resolveSymbol(symbolToken.name);
            if (resolution.kind !== 'found') { return undefined; }
            rows = [{ label: isAsmConstant(resolution.symbol) ? 'Value' : 'Address', value: resolution.symbol.address, byteSize: 2 }];
        }
        return this.hover(symbolToken, rows, source);
    }

    private hover(symbol: SymbolToken, rows: AsmHoverRow[], source?: SourceLocation): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        for (const [index, row] of rows.entries()) {
            if (index > 0) { markdown.appendMarkdown('\n\n'); }
            markdown.appendText(formatAsmHoverRow(row));
        }
        if (source) {
            markdown.appendMarkdown(`\n\n[Go to Definition](${revealSymbolCommandUri(source)}) (Ctrl + Click)`);
            markdown.isTrusted = true;
        }
        return new vscode.Hover(markdown, new vscode.Range(
            new vscode.Position(symbol.line, symbol.start),
            new vscode.Position(symbol.line, symbol.start + symbol.length),
        ));
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
            vscode.Uri.file(resolveDebugSourcePath(source.file, projectSourceRoot(project))),
            target,
        );
    }

    private contextForProject(project: {
        uri: vscode.Uri;
        run: { debugArtifact?: string; executable: string };
    }): SourceDocumentContext {
        return {
            projectRoot: projectSourceRoot(project),
            debugArtifact: project.run.debugArtifact!,
            executable: project.run.executable,
        };
    }
}
