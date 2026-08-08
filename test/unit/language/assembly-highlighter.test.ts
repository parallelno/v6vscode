import { expect } from 'chai';
import * as path from 'path';
import {
    AssemblyTokenClass,
    classifyScopes,
    createAssemblyHighlighter,
} from '../../../src/language/assembly-highlighter';

describe('Assembly highlighter', () => {
    it('maps the existing grammar to stable presentation classes', async () => {
        const highlighter = await createAssemblyHighlighter(path.resolve(__dirname, '../../..'));
        const line = 'main: lxi h, 0x1234 + VALUE ; note';
        const spans = highlighter.tokenizeLine(line);
        const classified = (tokenClass: AssemblyTokenClass) => spans
            .filter(span => span.tokenClass === tokenClass)
            .map(span => line.slice(span.start, span.start + span.length));

        expect(classified('label')).to.deep.equal(['main:']);
        expect(classified('instruction')).to.deep.equal(['lxi']);
        expect(classified('register')).to.deep.equal(['h']);
        expect(classified('number')).to.deep.equal(['0x1234']);
        expect(classified('operator')).to.include('+');
        expect(classified('comment')).to.deep.equal(['; note']);
    });

    it('preserves rule state across document lines but not standalone lines', async () => {
        const highlighter = await createAssemblyHighlighter(path.resolve(__dirname, '../../..'));
        const document = highlighter.tokenizeDocument('/* first\nsecond */ mvi a, 1');

        expect(document[1][0].tokenClass).to.equal('comment');
        expect(highlighter.tokenizeLine('second */ mvi a, 1')[0].tokenClass).to.equal('plain');
    });

    it('bounds standalone and source-document caches', async () => {
        const highlighter = await createAssemblyHighlighter(path.resolve(__dirname, '../../..'), 2, 2);
        highlighter.tokenizeLine('nop');
        highlighter.tokenizeLine('ret');
        highlighter.tokenizeLine('hlt');
        highlighter.tokenizeSourceDocument('a.asm', '1', 'nop');
        highlighter.tokenizeSourceDocument('b.asm', '1', 'ret');
        highlighter.tokenizeSourceDocument('c.asm', '1', 'hlt');

        expect(highlighter.cacheSizes()).to.deep.equal({ lines: 2, documents: 2 });
    });

    it('invalidates source-document tokenization when the version changes', async () => {
        const highlighter = await createAssemblyHighlighter(path.resolve(__dirname, '../../..'));
        const initial = highlighter.tokenizeSourceDocument('main.asm', '1', '/* open');
        const sameVersion = highlighter.tokenizeSourceDocument('main.asm', '1', 'nop');
        const nextVersion = highlighter.tokenizeSourceDocument('main.asm', '2', 'nop');

        expect(sameVersion).to.equal(initial);
        expect(nextVersion).not.to.equal(initial);
        expect(nextVersion[0].some(span => span.tokenClass === 'instruction')).to.equal(true);
    });

    it('maps every public presentation class from grammar scopes', () => {
        expect([
            classifyScopes(['source.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'comment.line.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'string.quoted.double.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.globallabel.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.directive.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.keyword.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.control.flow.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.instruction.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.register.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'constant.numeric.hexadecimal.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.operator.v6vscode_8080']),
        ]).to.deep.equal([
            'plain', 'comment', 'string', 'label', 'directive', 'keyword',
            'control', 'instruction', 'register', 'number', 'operator',
        ]);
    });

    it('classifies representative source with the registered grammar', async () => {
        const highlighter = await createAssemblyHighlighter(path.resolve(__dirname, '../../..'));
        const lines = [
            '.org 0x1000',
            '.if true',
            'message: .text "hello"',
            'call target',
            'mov a, b',
            'value: .word 42 + 1 ; note',
        ];
        const tokenClasses = highlighter.tokenizeDocument(lines.join('\n'))
            .flatMap(spans => spans.map(span => span.tokenClass));

        expect(tokenClasses).to.include.members([
            'directive', 'number', 'keyword', 'label', 'string', 'control',
            'instruction', 'register', 'operator', 'comment',
        ]);
    });
});