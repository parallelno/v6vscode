import * as assert from 'assert';
import * as path from 'path';
import { DirectivePathService } from '../../src/language/includes/directive-path-service';
import { scanDirectives } from '../../src/language/includes/directive-scan';

const root = path.resolve('include-regression');

describe('Regression: directive scan and lookup', () => {
    it('keeps directive text inside comments and strings out of navigation', () => {
        const text = [
            '; .include "commented.inc"',
            '/* .incbin',
            '   "block.bin" */',
            'db ".filesize \\"text.bin\\""',
            'value .filesize "real.bin"',
        ].join('\n');
        assert.deepStrictEqual(scanDirectives(text).map(match => [match.kind, match.value]),
            [['filesize', 'real.bin']]);
    });

    it('keeps a mid-line label directive navigable', () => {
        const text = 'loop: .include "mid.inc"';
        const [match] = scanDirectives(text);
        assert.strictEqual(match.value, 'mid.inc');
        assert.strictEqual(text.slice(match.startChar, match.startChar + match.length), 'mid.inc');
    });

    it('normalizes backslash operands through the host path rules', async () => {
        const source = path.join(root, 'src');
        const candidate = path.resolve(source, 'sub\\file.inc');
        const paths = new DirectivePathService({
            fileExists: async file => file === candidate,
            findFilesByBaseName: async () => [],
        });
        const [resolution] = await paths.analyze({
            documentPath: path.join(source, 'main.asm'),
            documentVersion: 1,
            text: '.include "sub\\\\file.inc"',
            workspaceRoots: [],
        });
        assert.strictEqual(resolution.path, candidate);
    });

    it('handles whitespace-only text and unclosed literals without matches', () => {
        assert.deepStrictEqual(scanDirectives('   \n   \n   '), []);
        assert.deepStrictEqual(scanDirectives('.include "unclosed'), []);
        assert.deepStrictEqual(scanDirectives('.include ""'), []);
    });

    it('handles very long include paths', () => {
        const longPath = 'a/'.repeat(100) + 'file.inc';
        assert.strictEqual(scanDirectives(`.include "${longPath}"`)[0].value, longPath);
    });
});
