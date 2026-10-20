import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { IncludeLinkProvider } from '../../../src/language/includes/include-link-provider';

describe('Include link VS Code adapter', () => {
    it('returns quoted ranges and source-relative file URIs even for nonexistent targets', () => {
        const text = '😀 .include "sub/missing.inc"\r\n.include "../common.inc"';
        const uri = vscode.Uri.file(path.resolve('include-provider', 'src', 'main.asm'));
        const links = new IncludeLinkProvider().provideDocumentLinks({ uri, getText: () => text } as vscode.TextDocument,
            { isCancellationRequested: false } as vscode.CancellationToken);
        assert.strictEqual(links.length, 2);
        assert.strictEqual(links[0].target?.fsPath, path.resolve(path.dirname(uri.fsPath), 'sub/missing.inc'));
        assert.strictEqual(links[1].target?.fsPath, path.resolve(path.dirname(uri.fsPath), '../common.inc'));
        for (const link of links) {
            const { start, end } = link.range;
            assert.strictEqual(start.line, end.line);
            const operand = text.split('\n')[start.line].slice(start.character, end.character);
            assert.ok(['sub/missing.inc', '../common.inc'].includes(operand));
        }
    });
});