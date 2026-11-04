import * as vscode from 'vscode';
import { WorkspaceService } from '../../platform/files/workspace-service';
import { DirectivePathService } from './directive-path-service';
import { analyzeDocument, ASM_LANGUAGE_ID, directiveRange, missingFileMessage } from './include-document';

/** Watches ASM documents and reports unresolved directive operands. */
export class IncludeDiagnostics implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('v6-include-paths');
    private readonly subscriptions: vscode.Disposable[] = [];
    private readonly pending = new Map<string, vscode.TextDocument>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(
        private readonly paths: DirectivePathService,
        private readonly workspace: WorkspaceService,
        private readonly debounceMs = 150,
    ) {
        this.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => this.schedule(event.document)),
            vscode.workspace.onDidOpenTextDocument(document => this.schedule(document)),
            vscode.workspace.onDidCloseTextDocument(document => this.clear(document.uri)),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleAll()),
        );
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        if (watcher) {
            this.subscriptions.push(
                watcher,
                watcher.onDidCreate(() => this.scheduleAll()),
                watcher.onDidDelete(() => this.scheduleAll()),
            );
        }
        this.refreshAll();
    }

    /** Reports unresolved operands of one document immediately. */
    async refresh(document: vscode.TextDocument): Promise<void> {
        if (this.disposed || document.languageId !== ASM_LANGUAGE_ID) {
            return;
        }
        const resolutions = await analyzeDocument(this.paths, this.workspace, document);
        if (this.disposed) {
            return;
        }
        const diagnostics = resolutions
            .filter(resolution => !resolution.path)
            .map(resolution => {
                const diagnostic = new vscode.Diagnostic(
                    directiveRange(resolution.directive),
                    missingFileMessage(resolution.directive.value),
                    vscode.DiagnosticSeverity.Error,
                );
                diagnostic.source = 'v6';
                return diagnostic;
            });
        this.collection.set(document.uri, diagnostics);
    }

    refreshAll(): void {
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === ASM_LANGUAGE_ID) {
                this.schedule(document);
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.pending.clear();
        this.collection.dispose();
        for (const subscription of this.subscriptions.reverse()) {
            subscription.dispose();
        }
    }

    private schedule(document: vscode.TextDocument): void {
        if (this.disposed || document.languageId !== ASM_LANGUAGE_ID) {
            return;
        }
        this.pending.set(document.uri.toString(), document);
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => void this.flush(), this.debounceMs);
    }

    private scheduleAll(): void {
        if (this.disposed) {
            return;
        }
        this.paths.invalidate();
        this.pending.clear();
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === ASM_LANGUAGE_ID) {
                this.pending.set(document.uri.toString(), document);
            }
        }
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => void this.flush(), this.debounceMs);
    }

    private async flush(): Promise<void> {
        this.timer = undefined;
        const documents = [...this.pending.values()];
        this.pending.clear();
        this.paths.invalidate();
        for (const document of documents) {
            await this.refresh(document);
        }
    }

    private clear(uri: vscode.Uri): void {
        this.pending.delete(uri.toString());
        this.collection.delete(uri);
        this.paths.invalidate();
    }
}
