import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { loadDebugArtifact } from '../../../debug/metadata/debug-artifact-loader';

suite('C source breakpoint', () => {
    test('stops the real emulator before executing the display write', async function () {
        const extensionRoot = process.env.V6_EXTENSION_ROOT;
        const emulator = process.env.V6EMUL;
        if (!extensionRoot || !emulator || !fs.existsSync(emulator)) {
            this.skip();
            return;
        }

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const targetLine = sourceLines.findIndex(line => line.includes('uint8_t s =')) + 1;
        assert.ok(targetLine > 0, 'Expected the innermost C integration breakpoint statement.');
        const artifact = await loadDebugArtifact(
            path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O0.elf'),
            path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O0.rom'),
        );
        const resolvedBreakpoint = artifact.index.resolveBreakpoint(sourceUri.fsPath, targetLine);
        assert.ok(
            resolvedBreakpoint && resolvedBreakpoint.verifiedLine === targetLine,
            `Extension Host source files: ${JSON.stringify(artifact.index.sourceFiles)}`,
        );
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(sourceUri, new vscode.Position(targetLine - 1, 0)),
        );
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        vscode.debug.addBreakpoints([breakpoint]);

        const stopped = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`Timed out waiting for C breakpoint; breakpoints=${JSON.stringify(vscode.debug.breakpoints)}`));
            }, 12_000);
            const disposable = vscode.debug.onDidChangeActiveStackItem(async item => {
                if (!(item instanceof vscode.DebugStackFrame)) { return; }
                const response = await item.session.customRequest('stackTrace', {
                    threadId: item.threadId,
                    startFrame: 0,
                    levels: 10,
                });
                const frame = response?.stackFrames?.[0];
                if (path.normalize(frame?.source?.path ?? '') !== path.normalize(sourceUri.fsPath)
                    || frame?.line !== targetLine) { return; }
                clearTimeout(timer);
                disposable.dispose();
                resolve(response.stackFrames);
            });
        });

        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
            type: 'v6',
            request: 'launch',
            name: 'C breakpoint integration',
        });
        assert.strictEqual(started, true);

        try {
            const frames = await stopped;
            assert.deepStrictEqual(frames.slice(0, 3).map((frame: any) => frame.name), ['add8', 'accumulate', 'main']);
            assert.strictEqual(frames[0].line, targetLine);
            assert.match(frames[0].instructionPointerReference, /^0x[0-9A-F]{4}$/);

            const session = vscode.debug.activeDebugSession;
            assert.ok(session, 'Expected an active debug session at the C breakpoint.');
            const scopes = await session.customRequest('scopes', { frameId: frames[0].id });
            assert.deepStrictEqual(scopes.scopes.slice(0, 4).map((scope: any) => scope.name), ['Parameters', 'Locals', 'Statics', 'Globals']);
            const parameters = await session.customRequest('variables', { variablesReference: scopes.scopes[0].variablesReference });
            const locals = await session.customRequest('variables', { variablesReference: scopes.scopes[1].variablesReference });
            assert.deepStrictEqual(parameters.variables.map((variable: any) => variable.name).sort(), ['a', 'b']);
            assert.deepStrictEqual(parameters.variables.map((variable: any) => variable.value).sort(), ['0', '1']);
            assert.ok(locals.variables.some((variable: any) => variable.name === 's'), 'Expected add8 local s.');

            const watch = await session.customRequest('evaluate', { expression: 's', frameId: frames[0].id, context: 'watch' });
            assert.strictEqual(watch.result, '0');
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });

    test('steps into add8 and back to the accumulate call continuation', async function () {
        const extensionRoot = process.env.V6_EXTENSION_ROOT;
        const emulator = process.env.V6EMUL;
        if (!extensionRoot || !emulator || !fs.existsSync(emulator)) {
            this.skip();
            return;
        }

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const callLine = sourceLines.findIndex(line => line.includes('total = add8')) + 1;
        assert.ok(callLine > 0, 'Expected the accumulate call statement.');
        const artifact = await loadDebugArtifact(
            path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O0.elf'),
            path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O0.rom'),
        );
        assert.ok(artifact.index.resolveBreakpoint(sourceUri.fsPath, callLine), 'Expected an executable accumulate call statement.');
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(sourceUri, new vscode.Position(callLine - 1, 0)),
        );
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        vscode.debug.addBreakpoints([breakpoint]);

        const waitForFrame = (name: string, line?: number) => new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`Timed out waiting for ${name}.`));
            }, 12_000);
            const disposable = vscode.debug.onDidChangeActiveStackItem(async item => {
                if (!(item instanceof vscode.DebugStackFrame)) { return; }
                const frames = await item.session.customRequest('stackTrace', {
                    threadId: item.threadId,
                    startFrame: 0,
                    levels: 10,
                });
                const top = frames?.stackFrames?.[0];
                if (top?.name !== name || line !== undefined && top?.line !== line) { return; }
                clearTimeout(timer);
                disposable.dispose();
                resolve({ session: item.session, frames: frames.stackFrames, threadId: item.threadId });
            });
        });

        const atCall = waitForFrame('accumulate', callLine);
        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
            type: 'v6', request: 'launch', name: 'C source stepping integration',
        });
        assert.strictEqual(started, true);

        try {
            const caller = await atCall;
            const intoAdd8 = waitForFrame('add8');
            await caller.session.customRequest('stepIn', { threadId: caller.threadId, granularity: 'statement' });
            const callee = await intoAdd8;
            assert.strictEqual(callee.frames[0].name, 'add8');

            const backInCaller = waitForFrame('accumulate');
            await callee.session.customRequest('stepOut', { threadId: callee.threadId, frameId: callee.frames[0].id });
            const continuation = await backInCaller;
            assert.strictEqual(continuation.frames[0].name, 'accumulate');

            const afterOver = waitForFrame('accumulate');
            await continuation.session.customRequest('next', { threadId: continuation.threadId, granularity: 'statement' });
            const steppedOver = await afterOver;
            assert.strictEqual(steppedOver.frames[0].name, 'accumulate');
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });

    test('relocates O1 and O2 breakpoints from an omitted line to the next emitted statement', async function () {
        const extensionRoot = process.env.V6_EXTENSION_ROOT;
        const emulator = process.env.V6EMUL;
        if (!extensionRoot || !emulator || !fs.existsSync(emulator)) {
            this.skip();
            return;
        }

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const omittedLine = sourceLines.findIndex(line => line.includes('uint8_t result =')) + 1;
        assert.ok(omittedLine > 0, 'Expected the optimized-away result declaration.');
        const projectPath = path.join(extensionRoot, 'temp', 'integration-debug-workspace', 'cdbg.project.json');
        const originalProject = fs.readFileSync(projectPath, 'utf8');

        try {
            for (const optimization of ['O1', 'O2']) {
                const artifact = await loadDebugArtifact(
                    path.join(extensionRoot, 'test', 'fixtures', 'cdbg', `probe-${optimization}.elf`),
                    path.join(extensionRoot, 'test', 'fixtures', 'cdbg', `probe-${optimization}.rom`),
                );
                const resolved = artifact.index.resolveBreakpoint(sourceUri.fsPath, omittedLine);
                assert.ok(resolved, `Expected an emitted statement after the omitted ${optimization} source line.`);
                assert.ok(resolved.verifiedLine > omittedLine, `Expected the requested ${optimization} source line to be omitted.`);
                const project = JSON.parse(originalProject);
                project.run.executable = path.join(extensionRoot, 'test', 'fixtures', 'cdbg', `probe-${optimization}.rom`);
                project.run.debugArtifact = path.join(extensionRoot, 'test', 'fixtures', 'cdbg', `probe-${optimization}.elf`);
                fs.writeFileSync(projectPath, `${JSON.stringify(project, undefined, 2)}\n`);
                const breakpoint = new vscode.SourceBreakpoint(
                    new vscode.Location(sourceUri, new vscode.Position(omittedLine - 1, 0)),
                );
                vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
                vscode.debug.addBreakpoints([breakpoint]);
                const stopped = new Promise<any>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        disposable.dispose();
                        reject(new Error(`Timed out waiting for the relocated ${optimization} source breakpoint.`));
                    }, 12_000);
                    const disposable = vscode.debug.onDidChangeActiveStackItem(async item => {
                        if (!(item instanceof vscode.DebugStackFrame)) { return; }
                        const frames = await item.session.customRequest('stackTrace', {
                            threadId: item.threadId,
                            startFrame: 0,
                            levels: 10,
                        });
                        const top = frames?.stackFrames?.[0];
                        if (path.normalize(top?.source?.path ?? '') !== path.normalize(sourceUri.fsPath)
                            || top?.line !== resolved.verifiedLine) { return; }
                        clearTimeout(timer);
                        disposable.dispose();
                        resolve(top);
                    });
                });
                const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
                    type: 'v6', request: 'launch', name: `${optimization} relocation integration`,
                });
                assert.strictEqual(started, true);
                const frame = await stopped;
                assert.strictEqual(frame.line, resolved.verifiedLine);
                await vscode.commands.executeCommand('workbench.action.debug.stop');
                vscode.debug.removeBreakpoints([breakpoint]);
            }
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            fs.writeFileSync(projectPath, originalProject);
        }
    });

    test('steps into and out of nested O2 inline frames', async function () {
        const extensionRoot = process.env.V6_EXTENSION_ROOT;
        const emulator = process.env.V6EMUL;
        if (!extensionRoot || !emulator || !fs.existsSync(emulator)) {
            this.skip();
            return;
        }

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const entryLine = sourceLines.findIndex(line => line.includes('uint8_t values')) + 1;
        const add8Line = sourceLines.findIndex(line => line.includes('uint8_t s =')) + 1;
        const accumulateLine = sourceLines.findIndex(line => line.includes('for (uint8_t i')) + 1;
        assert.ok(entryLine > 0 && add8Line > 0 && accumulateLine > 0, 'Expected O2 inline probe statements.');

        const projectPath = path.join(extensionRoot, 'temp', 'integration-debug-workspace', 'cdbg.project.json');
        const originalProject = fs.readFileSync(projectPath, 'utf8');
        const project = JSON.parse(originalProject);
        project.run.executable = path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O2.rom');
        project.run.debugArtifact = path.join(extensionRoot, 'test', 'fixtures', 'cdbg', 'probe-O2.elf');
        fs.writeFileSync(projectPath, `${JSON.stringify(project, undefined, 2)}\n`);

        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(sourceUri, new vscode.Position(entryLine - 1, 0)),
        );
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        vscode.debug.addBreakpoints([breakpoint]);
        const waitForTop = (name: string, line: number) => new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`Timed out waiting for inline ${name} at line ${line}.`));
            }, 12_000);
            const disposable = vscode.debug.onDidChangeActiveStackItem(async item => {
                if (!(item instanceof vscode.DebugStackFrame)) { return; }
                const response = await item.session.customRequest('stackTrace', {
                    threadId: item.threadId,
                    startFrame: 0,
                    levels: 10,
                });
                const top = response?.stackFrames?.[0];
                if (top?.name !== name || top?.line !== line) { return; }
                clearTimeout(timer);
                disposable.dispose();
                resolve({ session: item.session, threadId: item.threadId, frame: top });
            });
        });

        const atMain = waitForTop('main', entryLine);
        try {
            const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
                type: 'v6', request: 'launch', name: 'O2 inline stepping integration',
            });
            assert.strictEqual(started, true);
            const main = await atMain;

            const inAdd8 = waitForTop('add8', add8Line);
            await main.session.customRequest('stepIn', { threadId: main.threadId, granularity: 'statement' });
            const add8 = await inAdd8;

            const inAccumulate = waitForTop('accumulate', accumulateLine);
            await add8.session.customRequest('stepOut', { threadId: add8.threadId, frameId: add8.frame.id });
            await inAccumulate;
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
            fs.writeFileSync(projectPath, originalProject);
        }
    });
});