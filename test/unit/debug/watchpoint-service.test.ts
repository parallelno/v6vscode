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
        const client = {
            send: async (command: IpcCommand, data?: any) => {
                switch (command) {
                    case IpcCommand.DEBUG_WATCHPOINT_GET_ALL: return { ok: true, data: entries.map(item => ({ ...item })) };
                    case IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES: return { ok: true, data: { updates } };
                    case IpcCommand.DEBUG_WATCHPOINT_ADD:
                        expect(data).not.to.have.property('id');
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
        const edited = await service.edit({ ...added, comment: 'edited' });
        expect(edited.comment).to.equal('edited');
        await service.disableAll();
        expect(service.snapshot[0].active).to.equal(false);
        await service.delete(added.id);
        expect(service.snapshot).to.deep.equal([]);
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