import * as path from 'path';
import * as vscode from 'vscode';
import { SourceLocation } from '../debug/metadata/debug-index';
import { resolveDebugSourcePath } from '../debug/metadata/debug-source-path';

export interface SourceLine {
    sourceId: string;
    line: number;
    text: string;
    version: string;
}

export interface SourceLineService {
    read(location: SourceLocation, projectRoot: string): Promise<SourceLine | undefined>;
    clear(): void;
}

export interface SourceDocument {
    readonly uri: vscode.Uri;
    readonly version: number;
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string };
}

export type SourceDocumentLoader = (uri: vscode.Uri) => Thenable<SourceDocument>;

export class VsCodeSourceLineService implements SourceLineService, vscode.Disposable {
    private readonly cache = new Map<string, SourceLine>();
    private readonly disposables: vscode.Disposable[];

    constructor(
        private readonly openDocument: SourceDocumentLoader = uri => vscode.workspace.openTextDocument(uri),
        private readonly maxEntries = 256,
    ) {
        this.disposables = [
            vscode.workspace.onDidChangeTextDocument(event => this.deleteUri(event.document.uri)),
            vscode.workspace.onDidCloseTextDocument(document => this.deleteUri(document.uri)),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.clear()),
        ];
    }

    async read(location: SourceLocation, projectRoot: string): Promise<SourceLine | undefined> {
        if (!Number.isInteger(location.line) || location.line < 1 || !location.file) {
            return undefined;
        }
        const sourcePath = resolveDebugSourcePath(location.file, projectRoot);
        const uri = vscode.Uri.file(sourcePath);
        let document: SourceDocument;
        try {
            document = await this.openDocument(uri);
        } catch {
            return undefined;
        }
        if (location.line > document.lineCount) { return undefined; }

        const sourceId = document.uri.toString();
        const version = String(document.version);
        const key = `${normalizeSourceId(sourceId)}\0${version}\0${location.line}`;
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }

        const sourceLine: SourceLine = {
            sourceId,
            line: location.line,
            text: document.lineAt(location.line - 1).text,
            version,
        };
        this.cache.set(key, sourceLine);
        this.trimCache();
        return sourceLine;
    }

    clear(): void {
        this.cache.clear();
    }

    dispose(): void {
        this.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private deleteUri(uri: vscode.Uri): void {
        const prefix = `${normalizeSourceId(uri.toString())}\0`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) { this.cache.delete(key); }
        }
    }

    private trimCache(): void {
        while (this.cache.size > Math.max(1, this.maxEntries)) {
            this.cache.delete(this.cache.keys().next().value!);
        }
    }
}

function normalizeSourceId(sourceId: string): string {
    return process.platform === 'win32' ? sourceId.toLowerCase() : path.normalize(sourceId);
}