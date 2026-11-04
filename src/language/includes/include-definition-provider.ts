import * as vscode from 'vscode';
import { WorkspaceService } from '../../platform/files/workspace-service';
import { DirectivePathService } from './directive-path-service';
import { analyzeDocument, directiveAtPosition } from './include-document';

/** Opens a resolved directive operand at the start of its file. */
export class IncludeDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private readonly paths: DirectivePathService,
        private readonly workspace: WorkspaceService,
    ) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Location | undefined> {
        const resolutions = await analyzeDocument(this.paths, this.workspace, document);
        if (token.isCancellationRequested) {
            return undefined;
        }
        const resolution = directiveAtPosition(resolutions, position);
        if (!resolution?.path) {
            return undefined;
        }
        return new vscode.Location(vscode.Uri.file(resolution.path), new vscode.Position(0, 0));
    }
}
