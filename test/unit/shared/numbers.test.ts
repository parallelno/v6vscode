import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';
import { parseIntegerLiteral, formatHex } from '../../../src/shared/numbers';
import { parseMemoryEditQuery } from '../../../src/debug/views/memory-edits-query';
import { parseHardwareByte } from '../../../src/debug/hardware-statistics/hardware-statistics-format';
import { parseHexQuery } from '../../../src/debug/views/hex-viewer-query';
import { evaluateSymbolExpression } from '../../../src/debug/utilities/symbol-expression';
import { hexAddress } from '../../../src/debug/values/value-format';

const literals: Array<[string, number | undefined]> = [
    ['42', 42], ['  $2a ', 42], ['0X2A', 42], ['2aH', 42], ['010', 10], ['FFh', 255],
    ['', undefined], ['+1', undefined], ['-1', undefined], ['1.5', undefined], ['0b10', undefined],
    ['0x', undefined], ['12tail', undefined], ['FF', undefined], ['1_000', undefined],
];

describe('Shared numeric mechanics', () => {
    it('preserves decimal defaults and requires full, explicitly marked hex literals', () => {
        for (const [input, expected] of literals) { assert.strictEqual(parseIntegerLiteral(input), expected, input); }
    });

    it('keeps byte, CPU address and expression range/resolution policies separate', () => {
        for (const input of ['42', '$2a', '0X2A', '2aH']) {
            assert.deepStrictEqual(parseMemoryEditQuery(input), { kind: 'value', value: 42 });
            assert.strictEqual(parseHardwareByte(input), 42);
            assert.deepStrictEqual(parseHexQuery(input), { kind: 'location', location: { kind: 'address', value: 42 } });
            assert.strictEqual(evaluateSymbolExpression(input, () => { throw new Error('Not a symbol'); }), 42);
        }
        assert.strictEqual(parseMemoryEditQuery('256').kind, 'invalid');
        assert.throws(() => parseHardwareByte('256'), /0\.\.255/);
        assert.strictEqual(parseHexQuery('65536').kind, 'invalid');
        assert.strictEqual(evaluateSymbolExpression('65536 + main', name => name === 'main' ? 1 : 0), 65537);
        assert.throws(() => evaluateSymbolExpression('9007199254740992', () => 0), /safe integer/);
        assert.deepStrictEqual(parseHexQuery('main'), { kind: 'location', location: { kind: 'symbol', name: 'main' } });
    });

    it('uses minimum digit widths without wrapping, except at explicit machine adapters', () => {
        assert.strictEqual(formatHex(0x12, 2), '0x12');
        assert.strictEqual(formatHex(0x12, 4), '0x0012');
        assert.strictEqual(formatHex(0x20FFFF, 6), '0x20FFFF');
        assert.strictEqual(formatHex(0x12345, 4), '0x12345');
        assert.strictEqual(hexAddress(-1), '0xFFFFFFFF');
        assert.strictEqual(hexAddress(1, 3), '0x000001');
        for (const bad of [-1, 1.5, NaN, Infinity]) { assert.throws(() => formatHex(bad, 2), RangeError); }
    });

    it('executes the same ESM implementation without Node/browser globals or a second parser', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/shared/numbers.ts'), 'utf8');
        const esm = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ES2020 } }).outputText;
        const url = `data:text/javascript;base64,${Buffer.from(esm).toString('base64')}`;
        const result = execFileSync(process.execPath, ['--input-type=module', '-e',
            `import { parseIntegerLiteral, formatHex } from ${JSON.stringify(url)};
             console.log(JSON.stringify({ values: ${JSON.stringify(literals.map(([input]) => input))}.map(parseIntegerLiteral), hex: formatHex(0x20ffff, 6) }));`], { encoding: 'utf8' });
        assert.deepStrictEqual(JSON.parse(result), { values: literals.map(([, value]) => value ?? null), hex: '0x20FFFF' });
        for (const asset of ['memory-edits', 'watchpoints']) {
            const file = path.join(process.cwd(), `src/debug/views/assets/${asset}.js`);
            const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
            const imports = sourceFile.statements.filter(ts.isImportDeclaration);
            assert.strictEqual(imports.length, 1);
            const specifier = (imports[0].moduleSpecifier as ts.StringLiteral).text;
            assert.strictEqual(path.resolve(path.dirname(file), specifier), path.join(process.cwd(), 'out/webview/numbers.js'));
        }
    });
});