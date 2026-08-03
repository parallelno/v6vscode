import { EventEmitter } from 'events';
import { expect } from 'chai';
import { PerformanceService } from '../../../src/debug/performance/performance-service';
import { CodePerfSnapshot } from '../../../src/emulator/protocol/debug-models';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = true;
    running = false;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [
            IpcCommand.DEBUG_CODE_PERF_ADD, IpcCommand.DEBUG_CODE_PERF_DEL_ALL,
            IpcCommand.DEBUG_CODE_PERF_DEL, IpcCommand.DEBUG_CODE_PERF_GET,
            IpcCommand.DEBUG_CODE_PERF_EXISTS, IpcCommand.DEBUG_CODE_PERF_GET_ALL,
            IpcCommand.DEBUG_CODE_PERF_EDIT,
        ],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            codePerfSchema: 1, codePerfServerAllocatedIds: true, codePerfEdit: true,
            codePerfMutationsWhileRunning: true,
            codePerfLimits: {
                addressExclusive: 0x10000, maxNameBytes: 1024, maxRecords: 256, maxTestCount: 20000,
            },
        },
    };
}

describe('PerformanceService', () => {
    it('serializes mutations and reconciles authoritative snapshots by ID', async () => {
        const lifecycle = new FakeLifecycle();
        let nextId = 4;
        let entries: CodePerfSnapshot[] = [];
        const requests: Array<{ command: IpcCommand; data: any }> = [];
        const client = {
            send: async (command: IpcCommand, data?: any) => {
                requests.push({ command, data });
                if (command === IpcCommand.DEBUG_CODE_PERF_GET_ALL) {
                    return { ok: true, data: entries.map(entry => ({ ...entry })) };
                }
                if (command === IpcCommand.DEBUG_CODE_PERF_ADD) {
                    expect(Object.keys(data).sort()).to.deep.equal(['active', 'addrEnd', 'addrStart', 'name']);
                    const created = { id: nextId++, ...data, averageClockCycles: 0, testCount: 0 };
                    entries.push(created);
                    return { ok: true, data: created };
                }
                if (command === IpcCommand.DEBUG_CODE_PERF_EDIT) {
                    expect(Object.keys(data).sort()).to.deep.equal(['active', 'addrEnd', 'addrStart', 'id', 'name']);
                    const existing = entries.find(entry => entry.id === data.id)!;
                    const edited = { ...existing, ...data };
                    entries = entries.map(entry => entry.id === data.id ? edited : entry);
                    return { ok: true, data: edited };
                }
                if (command === IpcCommand.DEBUG_CODE_PERF_DEL) {
                    entries = entries.filter(entry => entry.id !== data.id);
                    return { ok: true };
                }
                if (command === IpcCommand.DEBUG_CODE_PERF_DEL_ALL) {
                    entries = [];
                    return { ok: true };
                }
                throw new Error(`Unexpected command ${command}`);
            },
        };
        const service = new PerformanceService(lifecycle as any, client as any);

        const first = await service.add({ name: 'frame', addrStart: 0x100, addrEnd: 0x120, active: true });
        const second = await service.add({ name: 'draw', addrStart: 0x200, addrEnd: 0x220, active: true });
        expect([first.id, second.id]).to.deep.equal([4, 5]);
        await service.edit(4, { name: 'main frame', addrStart: 0x100, addrEnd: 0x130, active: true });
        expect(service.snapshot[0]).to.include({ id: 4, name: 'main frame', addrEnd: 0x130 });
        await service.setActivity(4, false);
        await service.disableAll();
        expect(service.snapshot.every(entry => !entry.active)).to.equal(true);
        await service.delete(4);
        expect(service.snapshot.map(entry => entry.id)).to.deep.equal([5]);
        await service.deleteAll();
        expect(service.snapshot).to.deep.equal([]);
        expect(requests.filter(request => request.command === IpcCommand.DEBUG_CODE_PERF_GET_ALL)).to.have.length(7);
        service.dispose();
    });

    it('clears local state and increments generation on disconnect', async () => {
        const lifecycle = new FakeLifecycle();
        const snapshot = {
            id: 1, name: 'frame', addrStart: 1, addrEnd: 2, active: true,
            averageClockCycles: 0, testCount: 0,
        };
        const client = { send: async () => ({ ok: true, data: [snapshot] }) };
        const service = new PerformanceService(lifecycle as any, client as any);
        await service.refresh();
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        expect(service.snapshot).to.deep.equal([]);
        expect(service.sessionGeneration).to.equal(1);
        service.dispose();
    });

    it('coalesces concurrent refreshes and rejects a response from an inactive connection', async () => {
        const lifecycle = new FakeLifecycle();
        let release: (() => void) | undefined;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        let requests = 0;
        const client = { send: async () => { requests++; await blocked; return { ok: true, data: [] }; } };
        const service = new PerformanceService(lifecycle as any, client as any);

        const first = service.refresh();
        const second = service.refresh();
        expect(second).to.equal(first);
        await new Promise(resolve => setImmediate(resolve));
        expect(requests).to.equal(1);
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        release!();
        let message = '';
        try { await first; } catch (error) { message = String(error); }
        expect(message).to.contain('inactive connection');
        expect(service.snapshot).to.deep.equal([]);
        service.dispose();
    });

    it('reconciles a failed edit and reports actionable collection failures', async () => {
        const lifecycle = new FakeLifecycle();
        const snapshot = {
            id: 1, name: 'frame', addrStart: 1, addrEnd: 2, active: true,
            averageClockCycles: 0, testCount: 0,
        };
        let entries = [snapshot];
        let failure: 'edit' | 'capacity' = 'edit';
        const client = { send: async (command: IpcCommand) => {
            if (command === IpcCommand.DEBUG_CODE_PERF_GET_ALL) {
                return { ok: true, data: entries.map(entry => ({ ...entry })) };
            }
            if (command === IpcCommand.DEBUG_CODE_PERF_EDIT) {
                entries = [];
                return { ok: false, error: 'missing record', details: { field: 'id', reason: 'missing' } };
            }
            if (command === IpcCommand.DEBUG_CODE_PERF_ADD && failure === 'capacity') {
                return { ok: false, error: 'collection full', details: { field: 'collection', reason: 'capacity' } };
            }
            throw new Error(`Unexpected command ${command}`);
        } };
        const service = new PerformanceService(lifecycle as any, client as any);
        await service.refresh();

        let message = '';
        try { await service.edit(1, { name: 'edited', addrStart: 1, addrEnd: 2, active: true }); }
        catch (error) { message = String(error); }
        expect(message).to.contain('missing record');
        expect(service.snapshot).to.deep.equal([]);

        failure = 'capacity';
        try { await service.add({ name: 'new', addrStart: 3, addrEnd: 4, active: true }); }
        catch (error) { message = String(error); }
        expect(message).to.contain('deleting a record can free capacity');
        service.dispose();
    });
});