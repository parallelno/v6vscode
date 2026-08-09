import { EventEmitter } from 'events';
import { expect } from 'chai';
import { ScriptService } from '../../../src/debug/scripts/script-service';
import { ScriptSnapshot } from '../../../src/emulator/protocol/debug-models';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = true;
    running = false;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [
            IpcCommand.DEBUG_SCRIPT_ADD, IpcCommand.DEBUG_SCRIPT_DEL_ALL,
            IpcCommand.DEBUG_SCRIPT_DEL, IpcCommand.DEBUG_SCRIPT_GET_ALL,
            IpcCommand.DEBUG_SCRIPT_GET_UPDATES, IpcCommand.DEBUG_SCRIPT_EDIT,
            IpcCommand.DEBUG_SCRIPT_COMPILE, IpcCommand.DEBUG_SCRIPT_RUN_ONCE,
            IpcCommand.DEBUG_SCRIPT_DISABLE, IpcCommand.DEBUG_SCRIPT_DISABLE_ALL,
        ],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            scriptSchema: 1, scriptServerAllocatedIds: true, scriptPathSources: true,
            scriptExplicitCompile: true, scriptRunOnce: true, scriptBulkDisable: true,
            scriptMutationsWhileRunning: true, scriptRunOnceWhileRunning: true,
            scriptLimits: {
                maxNameBytes: 64, maxPathBytes: 256, maxSourceBytes: 1024,
                maxRecords: 16, maxErrorBytes: 256, maxInstructionsPerRun: 1000,
                maxExecutionMilliseconds: 100,
            },
        },
    };
}

function makeSnapshot(scriptId: number, name: string, active = true): ScriptSnapshot {
    return {
        scriptId, name, path: `C:/scripts/${name}.lua`, active,
        compilation: { status: 'compiled', error: null },
        runtime: { status: 'never_run', error: null },
    };
}

describe('ScriptService', () => {
    it('applies mutation revisions, Run Once runtime, and refreshes collection-only changes', async () => {
        const lifecycle = new FakeLifecycle();
        let revision = 0;
        let entries: ScriptSnapshot[] = [];
        const requests: IpcCommand[] = [];
        const client = { send: async (command: IpcCommand, data?: any) => {
            requests.push(command);
            if (command === IpcCommand.DEBUG_SCRIPT_GET_ALL) {
                return { ok: true, data: { updates: revision, scripts: entries } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_GET_UPDATES) {
                return { ok: true, data: { updates: revision } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_ADD) {
                const script = { ...makeSnapshot(4, data.name, data.active), path: data.path };
                entries = [script]; revision++;
                return { ok: true, data: { updates: revision, script } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_EDIT) {
                const script = { ...entries[0], ...data };
                entries = [script]; revision++;
                return { ok: true, data: { updates: revision, script } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_RUN_ONCE) {
                entries = [{ ...entries[0], runtime: { status: 'succeeded', error: null } }]; revision++;
                return { ok: true, data: {
                    scriptId: data.scriptId, succeeded: true, breakRequested: false,
                    updates: revision, runtime: entries[0].runtime,
                } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_DISABLE_ALL) {
                entries = entries.map(entry => ({ ...entry, active: false })); revision++;
                return { ok: true, data: { disabled: 1 } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_DEL) {
                entries = []; revision++; return { ok: true };
            }
            throw new Error(`Unexpected command ${command}`);
        } };
        const service = new ScriptService(lifecycle as any, client as any);

        const added = await service.add({ name: 'frame', path: 'C:/scripts/frame.lua', active: true });
        expect(added.scriptId).to.equal(4);
        expect(service.collectionRevision).to.equal(1);
        await service.edit(4, { name: 'frame 2', path: 'C:/scripts/frame.lua', active: true });
        const run = await service.runOnce(4);
        expect(run.succeeded).to.equal(true);
        expect(service.snapshot[0].runtime.status).to.equal('succeeded');
        expect(await service.disableAll()).to.equal(1);
        expect(service.snapshot[0].active).to.equal(false);
        await service.delete(4);
        expect(service.snapshot).to.deep.equal([]);
        expect(requests.filter(command => command === IpcCommand.DEBUG_SCRIPT_GET_ALL)).to.have.length(2);
        service.dispose();
    });

    it('polls the revision, handles wraparound as changed, and clears on disconnect', async () => {
        const lifecycle = new FakeLifecycle();
        let revision = 0xFFFFFFFF;
        let entry = makeSnapshot(1, 'first');
        const client = { send: async (command: IpcCommand) => {
            if (command === IpcCommand.DEBUG_SCRIPT_GET_ALL) {
                return { ok: true, data: { updates: revision, scripts: [entry] } };
            }
            if (command === IpcCommand.DEBUG_SCRIPT_GET_UPDATES) return { ok: true, data: { updates: revision } };
            throw new Error('Unexpected command');
        } };
        const service = new ScriptService(lifecycle as any, client as any);
        await service.refresh();
        expect(await service.refreshIfChanged()).to.equal(false);
        revision = 0; entry = makeSnapshot(1, 'wrapped');
        expect(await service.refreshIfChanged()).to.equal(true);
        expect(service.snapshot[0].name).to.equal('wrapped');
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        expect(service.snapshot).to.deep.equal([]);
        expect(service.sessionGeneration).to.equal(1);
        service.dispose();
    });

    it('gates mutations and Run Once independently while running', async () => {
        const lifecycle = new FakeLifecycle();
        lifecycle.running = true;
        lifecycle.serverInfo.capabilities.scriptMutationsWhileRunning = false;
        lifecycle.serverInfo.capabilities.scriptRunOnceWhileRunning = false;
        const service = new ScriptService(lifecycle as any, { send: async () => ({ ok: true }) } as any);
        let message = '';
        try { await service.add({ name: 'x', path: 'C:/x.lua', active: true }); }
        catch (error) { message = String(error); }
        expect(message).to.contain('changes while running');
        service.dispose();
    });
});
