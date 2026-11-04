import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { DirectivePathService } from '../../../src/language/includes/directive-path-service';
import { IncludeLinkProvider } from '../../../src/language/includes/include-link-provider';
import { IncludeHoverProvider } from '../../../src/language/includes/include-hover-provider';
import { IncludeDefinitionProvider } from '../../../src/language/includes/include-definition-provider';

const root = path.resolve('include-provider');
const documentPath = path.join(root, 'src', 'main.asm');
const existingTarget = path.join(root, 'src', 'present.inc');

const workspace = { getRootUris: () => [vscode.Uri.file(root)] } as any;
const cancellation = { isCancellationRequested: false } as vscode.CancellationToken;

function documentWith(text: string, version = 1): vscode.TextDocument {
    return {
        uri: vscode.Uri.file(documentPath),
        version,
        languageId: 'asm',
        getText: () => text,
    } as unknown as vscode.TextDocument;
}

function service(): DirectivePathService {
    return new DirectivePathService({
        fileExists: async candidate => candidate === existingTarget,
        findFilesByBaseName: async () => [],
    });
}

describe('Include directive providers', () => {
    it('links resolved operands and skips missing ones', async () => {
        const text = '.include "sub/missing.inc"\r\n.include "present.inc"';
        const links = await new IncludeLinkProvider(service(), workspace)
            .provideDocumentLinks(documentWith(text), cancellation);
        assert.strictEqual(links.length, 1);
        assert.strictEqual(links[0].target?.fsPath, existingTarget);
        const operand = text.split('\n')[links[0].range.start.line]
            .slice(links[0].range.start.character, links[0].range.end.character);
        assert.strictEqual(operand, 'present.inc');
        assert.strictEqual(links[0].range.start.line, 1);
    });

    it('links binary directives and keeps the raw quoted range', async () => {
        const text = 'blob: .incbin "present.inc", 0, 4';
        const links = await new IncludeLinkProvider(service(), workspace)
            .provideDocumentLinks(documentWith(text), cancellation);
        assert.strictEqual(links.length, 1);
        assert.strictEqual(links[0].target?.fsPath, existingTarget);
        assert.deepStrictEqual(
            [links[0].range.start.character, links[0].range.end.character],
            [15, 26],
        );
    });

    it('returns no links for commented, single-quoted, empty, or unclosed operands', async () => {
        const text = [
            '; .include "present.inc"',
            ".include 'present.inc'",
            '.include ""',
            '.include "unclosed',
        ].join('\n');
        const links = await new IncludeLinkProvider(service(), workspace)
            .provideDocumentLinks(documentWith(text), cancellation);
        assert.deepStrictEqual(links, []);
    });

    it('shows the resolved path in hover and skips unresolved operands', async () => {
        const text = '.include "present.inc"\n.include "sub/missing.inc"';
        const hover = await new IncludeHoverProvider(service(), workspace)
            .provideHover(documentWith(text), new vscode.Position(0, 14), cancellation);
        assert.strictEqual((hover as any).contents, existingTarget);
        const missing = await new IncludeHoverProvider(service(), workspace)
            .provideHover(documentWith(text), new vscode.Position(1, 14), cancellation);
        assert.strictEqual(missing, undefined);
        const elsewhere = await new IncludeHoverProvider(service(), workspace)
            .provideHover(documentWith(text), new vscode.Position(0, 0), cancellation);
        assert.strictEqual(elsewhere, undefined);
    });

    it('opens resolved operands at the start of the file', async () => {
        const provider = new IncludeDefinitionProvider(service(), workspace);
        const definition = await provider.provideDefinition(
            documentWith('.include "present.inc"', 1), new vscode.Position(0, 14), cancellation);
        assert.strictEqual((definition as vscode.Location).uri.fsPath, existingTarget);
        assert.strictEqual((definition as vscode.Location).range.start.line, 0);
        const missing = await provider.provideDefinition(
            documentWith('.include "sub/missing.inc"', 2), new vscode.Position(0, 14), cancellation);
        assert.strictEqual(missing, undefined);
    });

    it('reuses one analysis per document version and re-analyzes after a change', async () => {
        let searches = 0;
        const paths = new DirectivePathService({
            fileExists: async () => false,
            findFilesByBaseName: async () => { searches++; return [existingTarget]; },
        });
        const provider = new IncludeLinkProvider(paths, workspace);
        await provider.provideDocumentLinks(documentWith('.include "common.inc"', 1), cancellation);
        await provider.provideDocumentLinks(documentWith('.include "common.inc"', 1), cancellation);
        assert.strictEqual(searches, 1);
        await provider.provideDocumentLinks(documentWith('.include "common.inc"', 2), cancellation);
        assert.strictEqual(searches, 2);
    });
});
