import { expect } from 'chai';
import {
    findLabelDefinition,
    findSymbolTokens,
} from '../../../src/language/symbols/symbol-link-provider';

describe('Symbol link provider helpers', () => {
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