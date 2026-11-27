import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Recorder editor panel', () => {
    test('opens, refreshes, and closes from the shipped launcher commands', async () => {
        const activeRecorder = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
            .find(tab => tab.label === 'Recorder' && tab.input instanceof vscode.TabInputWebview);
        async function waitFor(open: boolean): Promise<void> {
            const deadline = Date.now() + 5000;
            while (!!activeRecorder() !== open) {
                if (Date.now() > deadline) { throw new Error(`Recorder tab did not ${open ? 'open' : 'close'}`); }
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
        assert.strictEqual(activeRecorder(), undefined);
        await vscode.commands.executeCommand('v6emul.toggleRecorder');
        try {
            await waitFor(true);
            await vscode.commands.executeCommand('v6.refreshRecorder');
        } finally {
            await vscode.commands.executeCommand('v6emul.toggleRecorder');
        }
        await waitFor(false);
    });
});