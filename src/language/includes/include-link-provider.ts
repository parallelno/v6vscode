import * as vscode from 'vscode';
import * as path from 'path';
import { findIncludes, resolveIncludePath } from './include-resolution';

export class IncludeLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.DocumentLink[] {
        const text = document.getText();
        const includes = findIncludes(text);
        const sourceDir = path.dirname(document.uri.fsPath);

        return includes.map(inc => {
            const resolved = resolveIncludePath(sourceDir, inc.path);
            const startPos = new vscode.Position(inc.line, inc.startChar);
            const endPos = new vscode.Position(inc.line, inc.startChar + inc.path.length);
            const range = new vscode.Range(startPos, endPos);
            const targetUri = vscode.Uri.file(resolved);
            return new vscode.DocumentLink(range, targetUri);
        });
    }
}
