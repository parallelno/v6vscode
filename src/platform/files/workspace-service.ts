import * as vscode from 'vscode';

export class WorkspaceService {
    getRootUris(): vscode.Uri[] {
        return vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
    }
}
