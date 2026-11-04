import * as vscode from 'vscode';
import { WorkspaceService } from '../../platform/files/workspace-service';
import { DirectivePathService } from './directive-path-service';
import { analyzeDocument, directiveAtPosition, directiveRange } from './include-document';

/** Shows the resolved file path. Unresolved operands use the diagnostic hover. */
export class IncludeHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly paths: DirectivePathService,
        private readonly workspace: WorkspaceService,
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        const resolutions = await analyzeDocument(this.paths, this.workspace, document);
        if (token.isCancellationRequested) {
            return undefined;
        }
        const resolution = directiveAtPosition(resolutions, position);
        if (!resolution?.path) {
            return undefined;
        }
        return new vscode.Hover(resolution.path, directiveRange(resolution.directive));
    }
}
