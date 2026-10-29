import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { fixtureRom } from '../../fixture-paths';

suite('Assembly function history', () => {
    test('shows the reduced caller chain and steps out through the recorded caller successor', async function () {
        this.timeout(35000);
        const root = process.env.V6_EXTENSION_ROOT;
        if (!root || !process.env.V6EMUL || !fs.existsSync(process.env.V6EMUL)) { this.skip(); return; }
        const projectPath = path.join(root, 'temp', 'integration-debug-workspace', 'cdbg.project.json');
        const original = fs.readFileSync(projectPath, 'utf8');
        const fixture = path.join(root, 'test', 'fixtures', 'asmdbg');
        const source = vscode.Uri.file(path.join(fixture, 'functions.asm'));
        const project = JSON.parse(original);
        project.run.executable = fixtureRom(path.join(fixture, 'functions-linked.elf'));
        project.run.debugArtifact = path.join(fixture, 'functions-linked.elf');
        project.run.loadAddr = '0x100';
        const lines = fs.readFileSync(source.fsPath, 'utf8').split(/\r?\n/);
        const target = lines.findIndex(line => line.trim() === 'emit:') + 2;
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(source, new vscode.Position(target - 1, 0)));
        const errors: unknown[] = [];
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('v6', {
            createDebugAdapterTracker: () => ({ onDidSendMessage: message => {
                if (message.type === 'response' && message.success === false) { errors.push(message); }
            } }),
        });
        const wait = (name: string) => new Promise<{ session: vscode.DebugSession; thread: number; frames: any[] }>((resolve, reject) => {
            let seen: unknown;
            const timer = setTimeout(() => { listener.dispose(); reject(new Error(`Timed out waiting for ${name}; frames=${JSON.stringify(seen)}; errors=${JSON.stringify(errors)}`)); }, 12000);
            const listener = vscode.debug.onDidChangeActiveStackItem(async item => {
                if (!(item instanceof vscode.DebugStackFrame)) { return; }
                try {
                    const result = await item.session.customRequest('stackTrace', { threadId: item.threadId });
                    seen = result.stackFrames;
                    if (result.stackFrames[0]?.name !== name) { return; }
                    clearTimeout(timer); listener.dispose();
                    resolve({ session: item.session, thread: item.threadId, frames: result.stackFrames });
                } catch (error) { clearTimeout(timer); listener.dispose(); reject(error); }
            });
        });
        try {
            fs.writeFileSync(projectPath, JSON.stringify(project, undefined, 2));
            const workspace = path.dirname(projectPath);
            fs.copyFileSync(source.fsPath, path.join(workspace, 'functions.asm'));
            vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
            vscode.debug.addBreakpoints([breakpoint]);
            const stopped = wait('emit');
            assert.strictEqual(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0],
                { type: 'v6', request: 'launch', name: 'ASM function integration' }), true);
            const result = await stopped;
            assert.deepStrictEqual(result.frames.map(frame => frame.name), ['emit', 'prepare', 'main']);
            assert.strictEqual(result.frames[0].line, target);
            assert.ok(fs.existsSync(result.frames[0].source.path), 'Active body source must open');
            assert.ok(fs.existsSync(result.frames[1].source.path), 'Caller source must open');
            const afterOut = wait('prepare');
            await result.session.customRequest('stepOut', { threadId: result.thread });
            const resumed = await afterOut;
            assert.deepStrictEqual(resumed.frames.map(frame => frame.name), ['prepare', 'main']);
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
            fs.writeFileSync(projectPath, original);
            tracker.dispose();
        }
    });
});