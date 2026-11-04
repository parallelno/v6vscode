import * as path from 'path';
import * as vscode from 'vscode';

/** Workspace-wide filename search used by directive lookup. */
export function createWorkspaceFileSearch(): (
    root: string,
    baseName: string,
) => Promise<readonly string[]> {
    return async (root, baseName) => {
        const pattern = new vscode.RelativePattern(vscode.Uri.file(root), `**/${escapeGlob(baseName)}`);
        const found = await vscode.workspace.findFiles(pattern);
        return found.map(uri => uri.fsPath).filter(file => path.basename(file) === baseName);
    };
}

/** Keeps glob characters in a filename literal so the search stays narrow. */
function escapeGlob(name: string): string {
    return name.replace(/[*?[\]{}()]/g, character => `[${character}]`);
}
