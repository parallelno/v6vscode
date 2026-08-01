import { EventEmitter } from 'events';
import { expect } from 'chai';
import { WatchpointService } from '../../../src/debug/watchpoints/watchpoint-service';
import { WatchpointEntry } from '../../../src/emulator/protocol/debug-models';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = true;
    running = false;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [69, 70, 71, 72, 73, 94],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            watchpointSchema: 1, watchpointServerAllocatedIds: true, watchpointEdit: true,
            watchpointMutationsWhileRunning: true,
            watchpointLimits: { maxRangeLength: 0xFFFF, maxCommentBytes: 1024 },
        },
    };
}

describe('WatchpointService', () => {
    it('serializes add, edit, disable, and delete against authoritative snapshots', async () => {
        const lifecycle = new FakeLifecycle();
        let entries: WatchpointEntry[] = [];
        let updates = 0;
        let nextId = 3;
        const requests: Array<{ command: IpcCommand; data: unknown }> = [];
        const client = {
            send: async (command: IpcCommand, data?: any) => {
                requests.push({ command, data });
                switch (command) {
                    case IpcCommand.DEBUG_WATCHPOINT_GET_ALL:
                        expect(data).to.equal(undefined);
                        return { ok: true, data: entries.map(item => ({ ...item })) };
                    case IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES:
                        expect(data).to.equal(undefined);
                        return { ok: true, data: { updates } };
                    case IpcCommand.DEBUG_WATCHPOINT_ADD:
                        entries.push({ id: nextId++, ...data }); updates++; return { ok: true };
                    case IpcCommand.DEBUG_WATCHPOINT_EDIT:
                        entries = entries.map(item => item.id === data.id ? { ...data } : item); updates++; return { ok: true };
                    case IpcCommand.DEBUG_WATCHPOINT_DEL:
                        entries = entries.filter(item => item.id !== data.id); updates++; return { ok: true };
                    default: throw new Error(`Unexpected command ${command}`);
                }
            },
        };
        const service = new WatchpointService(lifecycle as any, client as any);
        const base = {
            globalAddr: 0x100, len: 1, value: 0, access: 'RW' as const,
            condition: 'ANY' as const, type: 'LEN' as const, active: true, comment: 'test',
        };

        const added = await service.add(base);
        expect(added.id).to.equal(3);
        expect(requests[0]).to.deep.equal({ command: IpcCommand.DEBUG_WATCHPOINT_ADD, data: base });
        const second = await service.add({ ...base, globalAddr: 0x200, comment: 'second' });
        expect(second.id).to.equal(4);
        const duplicate = await service.add(base);
        expect(duplicate.id).to.equal(5);
        expect(service.snapshot.map(entry => entry.id)).to.deep.equal([3, 4, 5]);
        await service.refresh();
        lifecycle.emit('stateChange', 'starting');
        lifecycle.emit('stateChange', 'paused');
        await service.refresh();
        expect(service.snapshot.map(entry => entry.id)).to.deep.equal([3, 4, 5]);
        const edited = await service.edit({ ...added, comment: 'edited' });
        expect(edited.comment).to.equal('edited');
        await service.disableAll();
        expect(service.snapshot[0].active).to.equal(false);
        await service.delete(added.id);
        expect(service.snapshot.map(entry => entry.id)).to.deep.equal([4, 5]);
    });

    it('serializes refreshes with mutations so stale snapshots cannot erase an add', async () => {
        const lifecycle = new FakeLifecycle();
        const base: WatchpointEntry = {
            id: 0, globalAddr: 0x100, len: 1, value: 0, access: 'RW',
            condition: 'ANY', type: 'LEN', active: true, comment: 'first',
        };
        let entries = [base];
        let updates = 1;
        let releaseFirstRefresh: (() => void) | undefined;
        const firstRefreshBlocked = new Promise<void>(resolve => { releaseFirstRefresh = resolve; });
        const commands: IpcCommand[] = [];
        let getAllCount = 0;
        const client = {
            send: async (command: IpcCommand, data?: any) => {
                commands.push(command);
                if (command === IpcCommand.DEBUG_WATCHPOINT_GET_ALL) {
                    getAllCount++;
                    const snapshot = entries.map(entry => ({ ...entry }));
                    if (getAllCount === 1) { await firstRefreshBlocked; }
                    return { ok: true, data: snapshot };
                }
                if (command === IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES) {
                    return { ok: true, data: { updates } };
                }
                if (command === IpcCommand.DEBUG_WATCHPOINT_ADD) {
                    entries = [...entries, { id: 1, ...data }];
                    updates++;
                    return { ok: true };
                }
                throw new Error(`Unexpected command ${command}`);
            },
        };
        const service = new WatchpointService(lifecycle as any, client as any);

        const refresh = service.refresh();
        const add = service.add({
            globalAddr: 0x200, len: base.len, value: base.value, access: base.access,
            condition: base.condition, type: base.type, active: base.active, comment: 'second',
        });
        await new Promise(resolve => setImmediate(resolve));
        expect(commands).to.deep.equal([IpcCommand.DEBUG_WATCHPOINT_GET_ALL]);
        releaseFirstRefresh!();
        await refresh;
        const added = await add;

        expect(added.id).to.equal(1);
        expect(service.snapshot.map(entry => entry.id)).to.deep.equal([0, 1]);
    });

    it('rejects malformed snapshots and clears state on disconnect', async () => {
        const lifecycle = new FakeLifecycle();
        let list: unknown = [{ id: 1, globalAddr: 0, len: 0 }];
        const client = { send: async (command: IpcCommand) => command === IpcCommand.DEBUG_WATCHPOINT_GET_ALL
            ? { ok: true, data: list }
            : { ok: true, data: { updates: 0 } } };
        const service = new WatchpointService(lifecycle as any, client as any);

        let message = '';
        try { await service.refresh(); } catch (error) { message = String(error); }
        expect(message).to.contain('len must be an integer');

        list = [{
            id: 1, globalAddr: 0, len: 1, value: 0, access: 'R', condition: 'ANY',
            type: 'LEN', active: true, comment: '',
        }];
        await service.refresh();
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        expect(service.snapshot).to.deep.equal([]);
    });

    it('rejects mutations while running when the backend does not advertise support', async () => {
        const lifecycle = new FakeLifecycle();
        lifecycle.running = true;
        lifecycle.serverInfo.capabilities.watchpointMutationsWhileRunning = false;
        const service = new WatchpointService(lifecycle as any, {} as any);
        let message = '';
        try {
            await service.add({
                globalAddr: 0, len: 1, value: 0, access: 'R', condition: 'ANY',
                type: 'LEN', active: true, comment: '',
            });
        } catch (error) { message = String(error); }
        expect(message).to.contain('does not allow watchpoint changes while running');
    });
});