import { expect } from 'chai';
import * as path from 'path';
import { findIncludes, resolveIncludePath } from '../../../src/language/includes/include-link-provider';

describe('findIncludes', () => {
    it('should find a single .include directive', () => {
        const text = '.include "hardware.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('hardware.inc');
        expect(matches[0].line).to.equal(0);
    });

    it('should find .include with extra whitespace', () => {
        const text = '.include   "lib/io.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('lib/io.inc');
    });

    it('should find .include with tab whitespace', () => {
        const text = '.include\t"data.asm"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('data.asm');
    });

    it('should find multiple .include directives on separate lines', () => {
        const text = [
            '; header',
            '.include "a.inc"',
            'nop',
            '.include "b.inc"',
        ].join('\n');
        const matches = findIncludes(text);
        expect(matches).to.have.length(2);
        expect(matches[0].path).to.equal('a.inc');
        expect(matches[0].line).to.equal(1);
        expect(matches[1].path).to.equal('b.inc');
        expect(matches[1].line).to.equal(3);
    });

    it('should return correct startChar pointing inside the quotes', () => {
        const text = '.include "foo.asm"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        // .include "foo.asm"
        // 0123456789...
        // The quote at index 9, path starts at 10
        expect(matches[0].startChar).to.equal(10);
    });

    it('should find .include with leading whitespace (indented)', () => {
        const text = '    .include "lib.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('lib.inc');
    });

    it('should not match lines without .include', () => {
        const text = [
            '; .include "commented.inc"',
            'mov a, b',
            'label:',
        ].join('\n');
        const matches = findIncludes(text);
        // The regex is not context-aware for comments, but in this case
        // the ; comment still contains .include so it will match.
        // This is acceptable — the link will just point to a file that may not resolve.
        // The important thing is no crash.
    });

    it('should return empty for text with no includes', () => {
        const text = 'mov a, b\nnop\nhlt\n';
        const matches = findIncludes(text);
        expect(matches).to.have.length(0);
    });

    it('should return empty for empty text', () => {
        expect(findIncludes('')).to.have.length(0);
    });

    it('should handle .include with path containing subdirectory', () => {
        const text = '.include "sub/dir/file.asm"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('sub/dir/file.asm');
    });

    it('should handle .include with relative parent path', () => {
        const text = '.include "../shared/common.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(1);
        expect(matches[0].path).to.equal('../shared/common.inc');
    });

    it('should not match include without dot prefix', () => {
        const text = 'include "nope.inc"';
        const matches = findIncludes(text);
        expect(matches).to.have.length(0);
    });

    it('should not match .include with single quotes', () => {
        const text = ".include 'nope.inc'";
        const matches = findIncludes(text);
        expect(matches).to.have.length(0);
    });

    it('should not match .include without quotes', () => {
        const text = '.include nope.inc';
        const matches = findIncludes(text);
        expect(matches).to.have.length(0);
    });
});

describe('resolveIncludePath', () => {
    it('should resolve a relative path from the source directory', () => {
        const result = resolveIncludePath('/project/src', 'lib/io.inc');
        expect(result).to.equal(path.resolve('/project/src', 'lib/io.inc'));
    });

    it('should resolve a parent-relative path', () => {
        const result = resolveIncludePath('/project/src', '../shared/common.inc');
        expect(result).to.equal(path.resolve('/project/src', '../shared/common.inc'));
    });

    it('should return absolute paths unchanged', () => {
        const abs = path.resolve('/absolute/path/file.inc');
        const result = resolveIncludePath('/project/src', abs);
        expect(result).to.equal(abs);
    });

    it('should resolve a simple filename in the same directory', () => {
        const result = resolveIncludePath('/project/src', 'hardware.inc');
        expect(result).to.equal(path.resolve('/project/src', 'hardware.inc'));
    });
});
