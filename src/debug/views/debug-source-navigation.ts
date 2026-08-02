import * as path from 'path';
import * as vscode from 'vscode';
import { SourceLocation } from '../metadata/debug-index';
import { resolveDebugSourcePath } from '../metadata/debug-source-path';

export async function revealDebugSource(source: SourceLocation, projectRoot: string): Promise<void> {
    const sourcePath = resolveDebugSourcePath(source.file, projectRoot);
    const sourceUri = vscode.Uri.file(sourcePath);
    const visibleEditor = vscode.window.visibleTextEditors.find(editor => sameFile(editor.document.uri, sourceUri));

    let editor: vscode.TextEditor;
    if (visibleEditor) {
        editor = await vscode.window.showTextDocument(
            visibleEditor.document,
            visibleEditor.viewColumn,
            false,
        );
    } else {
        const openGroup = vscode.window.tabGroups.all.find(group => group.tabs.some(tab =>
            tab.input instanceof vscode.TabInputText && sameFile(tab.input.uri, sourceUri),
        ));
        const document = await vscode.workspace.openTextDocument(sourceUri);
        editor = await vscode.window.showTextDocument(document, openGroup
            ? { viewColumn: openGroup.viewColumn, preserveFocus: false }
            : { preview: true });
    }

    const line = Math.max(0, Math.min(editor.document.lineCount - 1, source.line - 1));
    const column = Math.max(0, Math.min(editor.document.lineAt(line).text.length, source.column - 1));
    const position = new vscode.Position(line, column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function sameFile(left: vscode.Uri, right: vscode.Uri): boolean {
    const leftPath = path.normalize(left.fsPath);
    const rightPath = path.normalize(right.fsPath);
    return process.platform === 'win32'
        ? leftPath.toLocaleLowerCase() === rightPath.toLocaleLowerCase()
        : leftPath === rightPath;
}