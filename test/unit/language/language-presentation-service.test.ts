import { expect } from 'chai';
import { DefaultLanguagePresentationService } from '../../../src/language/language-presentation-service';

describe('Language presentation service', () => {
    const context = {
        projectRoot: 'C:\\project',
        debugArtifact: 'main.elf',
        executable: 'main.bin',
    };
    const location = { file: 'main.asm', line: 1, column: 1, isStmt: true };

    it('presents source text with highlights and resolved symbol links', async () => {
        const presentation = new DefaultLanguagePresentationService(
            { read: async () => ({ sourceId: 'main.asm', line: 1, text: 'jmp target', version: '2' }), clear() {} },
            { tokenizeLine: () => [{ start: 0, length: 3, tokenClass: 'control' }], tokenizeDocument: () => [] },
            {
                links: async () => [{ start: 4, length: 6, name: 'target', target: location }],
                resolve: async () => location,
            },
        );

        expect(await presentation.presentSourceLine(location, context)).to.deep.equal({
            text: 'jmp target',
            highlights: [{ start: 0, length: 3, tokenClass: 'control' }],
            links: [{ start: 4, length: 6, name: 'target', target: location }],
        });
    });

    it('presents standalone text without source links', () => {
        const presentation = new DefaultLanguagePresentationService(
            { read: async () => undefined, clear() {} },
            { tokenizeLine: () => [{ start: 0, length: 3, tokenClass: 'instruction' }], tokenizeDocument: () => [] },
            { links: async () => { throw new Error('not expected'); }, resolve: async () => undefined },
        );

        expect(presentation.presentStandaloneLine('nop')).to.deep.equal({
            text: 'nop',
            highlights: [{ start: 0, length: 3, tokenClass: 'instruction' }],
            links: [],
        });
    });
});