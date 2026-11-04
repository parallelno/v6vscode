import * as vscode from 'vscode';
import { WorkspaceService } from '../../platform/files/workspace-service';
import { DirectivePathService } from './directive-path-service';
import { analyzeDocument, directiveRange } from './include-document';

export class IncludeLinkProvider implements vscode.DocumentLinkProvider {
    constructor(
        private readonly paths: DirectivePathService,
        private readonly workspace: WorkspaceService,
    ) {}

    async provideDocumentLinks(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentLink[]> {
        const resolutions = await analyzeDocument(this.paths, this.workspace, document);
        if (token.isCancellationRequested) {
            return [];
        }
        const links: vscode.DocumentLink[] = [];
        for (const resolution of resolutions) {
            if (resolution.path) {
                links.push(new vscode.DocumentLink(
                    directiveRange(resolution.directive),
                    vscode.Uri.file(resolution.path),
                ));
            }
        }
        return links;
    }
}

