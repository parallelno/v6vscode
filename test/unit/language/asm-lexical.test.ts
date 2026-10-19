import * as assert from 'assert';
import { codeBeforeComment } from '../../../src/language/asm-lexical';
import { findSymbolTokens } from '../../../src/language/symbols/symbol-link-service';
import { registerExpressionForHover } from '../../../src/language/symbols/symbol-link-provider';

describe('Shared ASM lexical masking', () => {
    it('masks quoted semicolons and truncates only the unquoted comment', () => {
        const text = 'db "a;b", target ; hidden';
        const masked = codeBeforeComment(text);
        assert.strictEqual(masked, 'db      , target ');
        assert.strictEqual(masked.indexOf('target'), text.indexOf('target'));
        assert.ok(!findSymbolTokens(text).some(token => token.name === 'hidden'));
    });

    it('preserves UTF-16 token offsets after astral characters inside strings', () => {
        const line = 'db "😀", target';
        const token = findSymbolTokens(line).find(token => token.name === 'target')!;
        assert.strictEqual(token.start, line.indexOf('target'));
        assert.strictEqual(codeBeforeComment(line).length, line.length);
    });

    it('retains the legacy quote-toggle and single-quote policy rather than inventing a dialect', () => {
        assert.strictEqual(codeBeforeComment('db "unterminated ; hidden'), 'db ' + ' '.repeat(22));
        assert.strictEqual(codeBeforeComment("db ';', target"), "db '");
        assert.strictEqual(codeBeforeComment('lxi h, main ; "ignored'), 'lxi h, main ');
        assert.strictEqual(registerExpressionForHover('label: lxi h, main ; mvi h, 0', 'h'), 'HL');
        assert.strictEqual(registerExpressionForHover('mvi h, "; lxi h"', 'h'), 'H');
    });
});