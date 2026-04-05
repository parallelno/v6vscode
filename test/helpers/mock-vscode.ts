import * as path from 'path';

// Lightweight vscode.Uri stub for unit tests
export class MockUri {
    readonly scheme: string;
    readonly fsPath: string;

    constructor(fsPath: string) {
        this.scheme = 'file';
        this.fsPath = fsPath;
    }

    static file(fsPath: string): MockUri {
        return new MockUri(fsPath);
    }

    static joinPath(base: MockUri, ...pathSegments: string[]): MockUri {
        return new MockUri(path.join(base.fsPath, ...pathSegments));
    }

    toString(): string {
        return `file://${this.fsPath}`;
    }
}

// Minimal vscode module mock for unit tests
export const mockVscode = {
    Uri: MockUri,
    workspace: {
        workspaceFolders: undefined as any[] | undefined,
        getConfiguration: (_section?: string) => ({
            get: <T>(_key: string, defaultValue?: T) => defaultValue,
        }),
        findFiles: async () => [],
    },
    window: {
        createOutputChannel: (_name: string) => ({
            appendLine: () => {},
            dispose: () => {},
        }),
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
    },
    commands: {
        registerCommand: (_id: string, _handler: (...args: any[]) => any) => ({
            dispose: () => {},
        }),
    },
    Disposable: class {
        static from(...disposables: { dispose: () => any }[]) {
            return { dispose: () => disposables.forEach(d => d.dispose()) };
        }
    },
};
