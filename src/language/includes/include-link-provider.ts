import * as vscode from 'vscode';
import * as path from 'path';

const INCLUDE_REGEX = /\.include\s+"([^"]+)"/g;

export interface IncludeMatch {
    path: string;
    offset: number;
    length: number;
    line: number;
    startChar: number;
}

export function findIncludes(text: string): IncludeMatch[] {
    const matches: IncludeMatch[] = [];
    const lines = text.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        INCLUDE_REGEX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INCLUDE_REGEX.exec(line)) !== null) {
            const filePath = m[1];
            const quoteStart = m.index + m[0].indexOf('"') + 1;
            matches.push({
                path: filePath,
                offset: m.index,
                length: m[0].length,
                line: lineNum,
                startChar: quoteStart,
            });
        }
    }

    return matches;
}

export function resolveIncludePath(sourceDir: string, includePath: string): string {
    if (path.isAbsolute(includePath)) {
        return includePath;
    }
    return path.resolve(sourceDir, includePath);
}

export class IncludeLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.DocumentLink[] {
        const text = document.getText();
        const includes = findIncludes(text);
        const sourceDir = path.dirname(document.uri.fsPath);

        return includes.map(inc => {
            const resolved = resolveIncludePath(sourceDir, inc.path);
            const startPos = new vscode.Position(inc.line, inc.startChar);
            const endPos = new vscode.Position(inc.line, inc.startChar + inc.path.length);
            const range = new vscode.Range(startPos, endPos);
            const targetUri = vscode.Uri.file(resolved);
            return new vscode.DocumentLink(range, targetUri);
        });
    }
}
