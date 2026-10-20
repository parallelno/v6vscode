import * as vscode from 'vscode';
import { resolveAgainstDirectory } from './local-path';

export class PathService {
    private readonly extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    resolveExtensionPath(relativePath: string): string {
        return vscode.Uri.joinPath(this.extensionUri, relativePath).fsPath;
    }

    expandTokens(value: string): string {
        return value.replace(/\$\{extension\}/g, this.extensionUri.fsPath);
    }

    resolveRelative(basePath: string, relativePath: string): string {
        return resolveAgainstDirectory(basePath, relativePath);
    }
}
