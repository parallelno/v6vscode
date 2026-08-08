import { expect } from 'chai';
import * as vscode from 'vscode';
import {
    findLabelDefinition,
    findSymbolTokens,
    registerExpressionForHover,
    SymbolLinkProvider,
} from '../../../src/language/symbols/symbol-link-provider';

describe('Symbol link provider helpers', () => {
    const source = { file: 'src/main.asm', line: 3, column: 2, isStmt: true };
    const project = {
        uri: vscode.Uri.file('C:\\project\\demo.project.json'),
        run: { debugArtifact: 'main.elf', executable: 'main.bin' },
    };
    const activeProjectService = {
        getActiveProject: () => project,
        resolve: async () => project,
    } as any;
    const document = {
        getText: () => 'jmp target',
        lineAt: () => ({ text: 'jmp target' }),
    } as any;

    it('uses the hovered instruction to distinguish register pairs from bytes', () => {
        expect(registerExpressionForHover('lxi h, main', 'h')).to.equal('HL');
        expect(registerExpressionForHover('loop: inx d', 'd')).to.equal('DE');
        expect(registerExpressionForHover('stax b', 'b')).to.equal('BC');
        expect(registerExpressionForHover('mvi h, 0', 'h')).to.equal('H');
        expect(registerExpressionForHover('mov a, h', 'h')).to.equal('H');
        expect(registerExpressionForHover('lxi sp, 0x8000', 'sp')).to.equal('SP');
    });

    it('evaluates the pair selected by the hovered instruction', async () => {
        const expressions: string[] = [];
        (vscode.debug as any).activeDebugSession = {
            type: 'v6',
            customRequest: async (_command: string, args: { expression: string }) => {
                expressions.push(args.expression);
                return { result: '0x0100', variablesReference: 0 };
            },
        };
        const provider = new SymbolLinkProvider({} as any, {} as any, {
            links: async () => [],
            resolve: async () => undefined,
        });
        const document = {
            getText: () => 'lxi h, main',
            lineAt: () => ({ text: 'lxi h, main' }),
        } as any;

        const hover = await provider.provideHover(
            document,
            new vscode.Position(0, 4),
            { isCancellationRequested: false } as any,
        );

        expect(expressions).to.deep.equal(['HL']);
        expect((hover as any).contents).to.equal('0x0100');
        (vscode.debug as any).activeDebugSession = undefined;
    });

    it('finds assembler symbols but skips quoted strings and comments', () => {
        const tokens = findSymbolTokens([
            'main: lxi h, DISPLAY_ADDR ; OPCODE_EI',
            '.include "sub/rnd.asm"',
            'mvi a, OPCODE_RET',
        ].join('\n'));

        expect(tokens.map(token => token.name)).to.deep.equal([
            'main', 'lxi', 'h', 'DISPLAY_ADDR', '.include', 'mvi', 'a', 'OPCODE_RET',
        ]);
    });

    it('finds the exact global label definition outside comments', () => {
        const location = findLabelDefinition([
            '; target:',
            '  target: mvi a, 1',
            'target_else: ret',
        ].join('\n'), 'target');

        expect(location).to.deep.equal({ file: '', line: 2, column: 3, isStmt: false });
    });

    it('does not confuse a longer label with the requested label', () => {
        expect(findLabelDefinition('target_else: ret', 'target')).to.equal(undefined);
    });

    it('preserves symbol hover links and values through the extracted service', async () => {
        const symbols = {
            resolveSymbol: () => ({
                kind: 'found',
                symbol: { name: 'target', address: 0x1234 },
            }),
        } as any;
        const provider = new SymbolLinkProvider(activeProjectService, symbols, {
            links: async () => [],
            resolve: async () => source,
        });

        const hover = await provider.provideHover(
            document,
            new vscode.Position(0, 5),
            { isCancellationRequested: false } as any,
        );

        expect((hover as any).contents.value).to.include('Value: 0x1234');
        expect((hover as any).contents.value).to.include('command:v6.revealSymbolSource');
        expect((hover as any).contents.isTrusted).to.equal(true);
    });

    it('preserves definition navigation through the extracted service', async () => {
        const provider = new SymbolLinkProvider(activeProjectService, {} as any, {
            links: async () => [],
            resolve: async () => source,
        });

        const definition = await provider.provideDefinition(
            document,
            new vscode.Position(0, 5),
            { isCancellationRequested: false } as any,
        );

        expect((definition as any).uri.fsPath).to.equal('C:\\project\\src\\main.asm');
        expect((definition as any).range).to.deep.include({ line: 2, character: 1 });
    });

    it('does not resolve provider links after cancellation', async () => {
        let resolveCalls = 0;
        let cancellationChecks = 0;
        const provider = new SymbolLinkProvider(activeProjectService, {} as any, {
            links: async () => [],
            resolve: async () => { resolveCalls++; return source; },
        });
        const token = {
            get isCancellationRequested() { return cancellationChecks++ > 0; },
        } as any;

        const definition = await provider.provideDefinition(
            document,
            new vscode.Position(0, 5),
            token,
        );

        expect(resolveCalls).to.equal(1);
        expect(definition).to.equal(undefined);
    });
});