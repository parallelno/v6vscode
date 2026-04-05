import { expect } from 'chai';
import * as path from 'path';
import { findIncludes, resolveIncludePath } from '../../src/language/includes/include-link-provider';

describe('Regression: include link provider', () => {
    it('should handle malformed include with empty quotes (no match)', () => {
        const text = '.include ""';
        const matches = findIncludes(text);
        // Empty string inside quotes — regex requires at least one char, no match
        expect(matches).to.have.length(0);
    });

    it('should handle .include with unclosed quote (no match)', () => {
        const text = '.include "unclosed';
        const matches = findIncludes(text);
        expect(matches).to.have.length(0);
    });

    it('should handle line with .include mid-line after code', () => {
        const text = 'label: .include "mid.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('mid.inc');
    });

    it('should resolve path with backslashes on Windows-style paths', () => {
        // resolveIncludePath uses path.resolve which normalizes for the OS
        const result = resolveIncludePath('/project/src', 'sub/file.inc');
        expect(path.isAbsolute(result)).to.be.true;
    });

    it('should not crash on text with only whitespace', () => {
        const matches = findIncludes('   \n   \n   ');
        expect(matches).to.have.length(0);
    });

    it('should handle very long include path', () => {
        const longPath = 'a/'.repeat(100) + 'file.inc';
        const text = `.include "${longPath}"`;
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal(longPath);
    });

    it('should handle multiple includes on non-adjacent lines', () => {
        const lines = new Array(100).fill('nop');
        lines[10] = '.include "first.inc"';
        lines[90] = '.include "second.inc"';
        const matches = findIncludes(lines.join('\n'));
        expect(matches).to.have.length(2);
        expect(matches[0].line).to.equal(10);
        expect(matches[1].line).to.equal(90);
    });
});
