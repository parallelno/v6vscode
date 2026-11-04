import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { DirectivePathService } from '../../../src/language/includes/directive-path-service';
import { IncludeDiagnostics } from '../../../src/language/includes/include-diagnostics';

const root = path.resolve('include-diagnostics');
const documentPath = path.join(root, 'main.asm');

const workspace = { getRootUris: () => [vscode.Uri.file(root)] } as any;

function documentWith(text: string, version = 1): vscode.TextDocument {
    return {
        uri: vscode.Uri.file(documentPath),
        version,
        languageId: 'asm',
        getText: () => text,
    } as unknown as vscode.TextDocument;
}

function collection(): any {
    const collections = (vscode.languages as any)._collections;
    return collections[collections.length - 1];
}

describe('Include diagnostics', () => {
    it('reports one error per unresolved operand and none for resolved ones', async () => {
        const existing = path.join(root, 'present.inc');
        const paths = new DirectivePathService({
            fileExists: async candidate => candidate === existing,
            findFilesByBaseName: async () => [],
        });
        const diagnostics = new IncludeDiagnostics(paths, workspace);
        assert.strictEqual(collection().name, 'v6-include-paths');

        await diagnostics.refresh(documentWith('.include "present.inc"\n.include "gone.inc"'));
        const reported = collection().entries.get(documentPath);
        assert.strictEqual(reported.length, 1);
        assert.strictEqual(reported[0].message, 'Cannot find file "gone.inc"');
        assert.strictEqual(reported[0].severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(reported[0].source, 'v6');
        assert.deepStrictEqual(
            [reported[0].range.start.line, reported[0].range.start.character],
            [1, 10],
        );

        await diagnostics.refresh(documentWith('.include "present.inc"', 2));
        assert.deepStrictEqual(collection().entries.get(documentPath), []);
        diagnostics.dispose();
    });

    it('ignores documents that are not assembly sources', async () => {
        const paths = new DirectivePathService({ fileExists: async () => false });
        const diagnostics = new IncludeDiagnostics(paths, workspace);
        const other = { ...documentWith('.include "gone.inc"'), languageId: 'c' } as unknown as vscode.TextDocument;
        await diagnostics.refresh(other);
        assert.strictEqual(collection().entries.has(documentPath), false);
        diagnostics.dispose();
    });
});
