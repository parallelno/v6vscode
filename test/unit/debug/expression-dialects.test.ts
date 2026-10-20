import * as assert from 'assert';
import { CExpressionService } from '../../../src/debug/values/c-expression-service';
import { evaluateSymbolExpression } from '../../../src/debug/utilities/symbol-expression';
import { parseExpression } from '../../../src/debug/expressions/expression-syntax';

describe('Bounded expression dialect contracts', () => {
    const c = new CExpressionService();
    for (const [input, expected] of [['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['-3 * -2 + 1', 7], ['0x10 + 2', 18]] as const) {
        it(`shares precedence/arithmetic for ${input}`, async () => {
            assert.strictEqual(evaluateSymbolExpression(input, () => 0), expected);
            assert.strictEqual(await c.evaluate(input, () => 0), expected);
            assert.deepStrictEqual(parseExpression(input, 'address'), parseExpression(input, 'c'));
        });
    }
    it('keeps address symbols and literal dialects distinct from typed C lookup', async () => {
        assert.strictEqual(evaluateSymbolExpression('@actor.ptr + $10 + FFh', name => name === '@actor.ptr' ? 1 : 0), 272);
        assert.strictEqual(evaluateSymbolExpression('hero.health', name => name === 'hero.health' ? 5 : 0), 5);
        await assert.rejects(c.evaluate('hero.health', () => 5), /typed variable context/);
        for (const input of ['1/2', '1==1', '*pointer', 'value[1]', '~1', '1&&2']) {
            assert.throws(() => evaluateSymbolExpression(input, () => 1));
        }
        assert.strictEqual(await c.evaluate('0 && missing', () => { throw new Error('must short circuit'); }), 0);
    });
    it('bounds both dialects without allowing unsafe arithmetic or deep parser recursion', async () => {
        for (const input of ['1'.repeat(4097), '('.repeat(65) + '1' + ')'.repeat(65), Array(300).fill('1').join('+')]) {
            assert.throws(() => evaluateSymbolExpression(input, () => 0), /too long|too deep|too many/);
            await assert.rejects(c.evaluate(input, () => 0), /too long|too deep|too many/);
        }
        assert.throws(() => evaluateSymbolExpression('9007199254740991*2', () => 0), /safe integer/);
    });
});