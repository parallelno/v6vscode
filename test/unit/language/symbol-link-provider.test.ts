import { expect } from 'chai';
import * as vscode from 'vscode';
import {
    findLabelDefinition,
    findSymbolTokens,
    registerExpressionForHover,
    SymbolLinkProvider,
} from '../../../src/language/symbols/symbol-link-provider';

describe('Symbol link provider helpers', () => {
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
        const provider = new SymbolLinkProvider({} as any, {} as any);
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
});