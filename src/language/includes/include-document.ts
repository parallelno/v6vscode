import * as vscode from 'vscode';
import { WorkspaceService } from '../../platform/files/workspace-service';
import { DirectivePathService, DirectiveResolution } from './directive-path-service';
import { DirectiveMatch } from './directive-scan';

export const ASM_LANGUAGE_ID = 'asm';

/** Analyzes one open document with the workspace roots of the current session. */
export function analyzeDocument(
    paths: DirectivePathService,
    workspace: WorkspaceService,
    document: vscode.TextDocument,
): Promise<DirectiveResolution[]> {
    return paths.analyze({
        documentPath: document.uri.fsPath,
        documentVersion: document.version,
        text: document.getText(),
        workspaceRoots: workspace.getRootUris().map(uri => uri.fsPath),
    });
}

/** Range of the quoted operand, excluding the quotes. */
export function directiveRange(directive: DirectiveMatch): vscode.Range {
    const start = new vscode.Position(directive.line, directive.startChar);
    const end = new vscode.Position(directive.line, directive.startChar + directive.length);
    return new vscode.Range(start, end);
}

export function directiveAtPosition(
    resolutions: readonly DirectiveResolution[],
    position: vscode.Position,
): DirectiveResolution | undefined {
    return resolutions.find(({ directive }) =>
        directive.line === position.line
        && position.character >= directive.startChar
        && position.character <= directive.startChar + directive.length);
}

export function missingFileMessage(operand: string): string {
    return `Cannot find file "${operand}"`;
}
