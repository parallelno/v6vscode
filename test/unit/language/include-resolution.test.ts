import { expect } from 'chai';
import { scanDirectives } from '../../../src/language/includes/directive-scan';

describe('scanDirectives', () => {
    it('finds all three directives with their operands', () => {
        const text = [
            '.include "lib/io.inc"',
            'data: .incbin "assets/data.bin", 0, 16',
            'SIZE .filesize "assets/data.bin"',
        ].join('\n');
        expect(scanDirectives(text).map(match => [match.kind, match.value, match.line])).to.deep.equal([
            ['include', 'lib/io.inc', 0],
            ['incbin', 'assets/data.bin', 1],
            ['filesize', 'assets/data.bin', 2],
        ]);
    });

    it('accepts labels, constant names, and mixed case', () => {
        const text = [
            'part: .Include "part.asm"',
            'size_label: SIZE .FileSize "data.bin"',
            'blob: .INCBIN "blob.bin"',
        ].join('\n');
        expect(scanDirectives(text).map(match => [match.kind, match.value])).to.deep.equal([
            ['include', 'part.asm'],
            ['filesize', 'data.bin'],
            ['incbin', 'blob.bin'],
        ]);
    });

    it('ignores directives inside comments and inside strings', () => {
        const text = [
            '; .include "semicolon.inc"',
            '// .include "slash.inc"',
            '/* .include "block.inc"',
            '   .incbin "block.bin" */',
            'db ".include \\"quoted.inc\\""',
            '.include "real.inc"',
        ].join('\n');
        expect(scanDirectives(text).map(match => match.value)).to.deep.equal(['real.inc']);
    });

    it('requires a directive name boundary', () => {
        expect(scanDirectives('.includeExtra "no.inc"')).to.deep.equal([]);
        expect(scanDirectives('.included "no.inc"')).to.deep.equal([]);
    });

    it('reports the raw quoted range while decoding escapes for lookup', () => {
        const text = '😀 .include "lib\\\\io.inc"';
        const [match] = scanDirectives(text);
        expect(match.value).to.equal('lib\\io.inc');
        expect(text.split('\n')[match.line].slice(match.startChar, match.startChar + match.length))
            .to.equal('lib\\\\io.inc');
    });

    it('skips empty, single-quoted, unclosed, and unknown-escape operands', () => {
        const text = [
            '.include ""',
            ".include 'single.inc'",
            '.include "unclosed',
            '.include "bad\\q.inc"',
        ].join('\n');
        expect(scanDirectives(text)).to.deep.equal([]);
    });

    it('keeps line and character positions for CRLF and Unicode text', () => {
        const matches = scanDirectives('nop\r\n😀.include "a.inc"\r\n');
        expect(matches).to.have.length(1);
        expect(matches[0]).to.include({ value: 'a.inc', line: 1, startChar: 12, length: 5 });
    });

    it('finds several directives across non-adjacent lines', () => {
        const lines = new Array(100).fill('nop');
        lines[10] = '.include "first.inc"';
        lines[90] = '.incbin "second.bin"';
        expect(scanDirectives(lines.join('\n')).map(match => [match.line, match.value])).to.deep.equal([
            [10, 'first.inc'],
            [90, 'second.bin'],
        ]);
    });

    it('handles long paths and text without directives', () => {
        const longPath = 'a/'.repeat(100) + 'file.inc';
        expect(scanDirectives(`.include "${longPath}"`)[0].value).to.equal(longPath);
        expect(scanDirectives('mov a, b\nnop\nhlt\n')).to.deep.equal([]);
        expect(scanDirectives('   \r\n   \r\n')).to.deep.equal([]);
        expect(scanDirectives('')).to.deep.equal([]);
    });
});
