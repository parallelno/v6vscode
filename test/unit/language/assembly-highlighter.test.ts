import { expect } from 'chai';
import * as path from 'path';
import {
    AssemblyTokenClass,
    classifyScopes,
    createAssemblyHighlighter,
} from '../../../src/language/assembly-highlighter';

describe('Assembly highlighter', () => {
    it('maps the existing grammar to stable presentation classes', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd());
        const line = 'main: lxi h, 0x1234 + VALUE ; note';
        const spans = highlighter.tokenizeLine(line);
        const classified = (tokenClass: AssemblyTokenClass) => spans
            .filter(span => span.tokenClass === tokenClass)
            .map(span => line.slice(span.start, span.start + span.length));

        expect(classified('global-label')).to.deep.equal(['main:']);
        expect(classified('instruction')).to.deep.equal(['lxi']);
        expect(classified('register')).to.deep.equal(['h']);
        expect(classified('number')).to.deep.equal(['0x1234']);
        expect(classified('operator')).to.include('+');
        expect(classified('line-comment')).to.deep.equal(['; note']);
    });

    it('preserves rule state across document lines but not standalone lines', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd());
        const document = highlighter.tokenizeDocument('/* first\nsecond */ mvi a, 1');

        expect(document[1][0].tokenClass).to.equal('comment');
        expect(highlighter.tokenizeLine('second */ mvi a, 1')[0].tokenClass).to.equal('plain');
    });

    it('bounds standalone and source-document caches', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd(), 2, 2);
        highlighter.tokenizeLine('nop');
        highlighter.tokenizeLine('ret');
        highlighter.tokenizeLine('hlt');
        highlighter.tokenizeSourceDocument('a.asm', '1', 'nop');
        highlighter.tokenizeSourceDocument('b.asm', '1', 'ret');
        highlighter.tokenizeSourceDocument('c.asm', '1', 'hlt');

        expect(highlighter.cacheSizes()).to.deep.equal({ lines: 2, documents: 2 });
    });

    it('invalidates source-document tokenization when the version changes', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd());
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
            classifyScopes(['source.v6vscode_8080', 'comment.block.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'string.quoted.double.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.globallabel.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.locallabel.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.constantslabel.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'entity.name.function.macro.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.directive.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.keyword.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.control.flow.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.instruction.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.register.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'constant.numeric.hexadecimal.v6vscode_8080']),
            classifyScopes(['source.v6vscode_8080', 'keyword.operator.v6vscode_8080']),
        ]).to.deep.equal([
            'plain', 'line-comment', 'comment', 'string', 'global-label', 'local-label', 'constant', 'macro', 'directive', 'keyword',
            'control', 'instruction', 'register', 'number', 'operator',
        ]);
    });

    it('classifies representative source with the registered grammar', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd());
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
            'directive', 'number', 'keyword', 'global-label', 'string', 'control',
            'instruction', 'register', 'operator', 'line-comment',
        ]);
    });

    it('distinguishes gray one-line comments from block comments', async () => {
        const highlighter = await createAssemblyHighlighter(process.cwd());
        const tokenClasses = highlighter.tokenizeDocument('; semicolon\n// slash\n/* block */')
            .map(spans => spans[0]?.tokenClass);

        expect(tokenClasses).to.deep.equal(['line-comment', 'line-comment', 'comment']);
    });
});