import * as vscode from 'vscode';

export function toDisposable(fn: () => void): vscode.Disposable {
    return { dispose: fn };
}

export class DisposableStore implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private disposed = false;

    add<T extends vscode.Disposable>(disposable: T): T {
        if (this.disposed) {
            disposable.dispose();
            return disposable;
        }
        this.disposables.push(disposable);
        return disposable;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const d of this.disposables.reverse()) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
