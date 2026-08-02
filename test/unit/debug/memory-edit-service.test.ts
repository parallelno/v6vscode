import { EventEmitter } from 'events';
import { expect } from 'chai';
import { MemoryEditService } from '../../../src/debug/memory-edits/memory-edit-service';
import { MemoryEditSnapshot } from '../../../src/emulator/protocol/debug-models';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = true;
    running = false;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [
            IpcCommand.DEBUG_MEMORY_EDIT_ADD, IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL,
            IpcCommand.DEBUG_MEMORY_EDIT_DEL, IpcCommand.DEBUG_MEMORY_EDIT_GET,
            IpcCommand.DEBUG_MEMORY_EDIT_EXISTS, IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL,
            IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, IpcCommand.SET_BYTE_GLOBAL,
        ],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            memoryEditSchema: 1,
            memoryEditLimits: { globalAddressExclusive: 0x210000, maxCommentBytes: 1024 },
        },
    };
}

describe('MemoryEditService', () => {
    it('does not create a record when a new Hex Viewer value is unchanged', async () => {
        const lifecycle = new FakeLifecycle();
        const commands: IpcCommand[] = [];
        const client = {
            send: async (command: IpcCommand) => {
                commands.push(command);
                throw new Error(`Unexpected command ${command}`);
            },
        };
        const service = new MemoryEditService(lifecycle as any, client as any);

        expect(await service.apply(0x100, 0x11, 0x11)).to.equal(undefined);
        expect(commands).to.deep.equal([]);
        expect(service.snapshot).to.deep.equal([]);
        let message = '';
        try { await service.apply(0x100, 0x100, 0x100); } catch (error) { message = String(error); }
        expect(message).to.contain('enteredValue must be an integer in 0..255');
        service.dispose();
    });

    it('serializes mutations and reconciles authoritative snapshots', async () => {
        const lifecycle = new FakeLifecycle();
        const memory = new Map<number, number>([[0x100, 0x11]]);
        let entries: MemoryEditSnapshot[] = [];
        const commands: IpcCommand[] = [];
        const client = {
            send: async (command: IpcCommand, data?: any) => {
                commands.push(command);
                if (command === IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL) {
                    return { ok: true, data: { edits: entries.map(entry => ({ ...entry, currentValue: memory.get(entry.globalAddr) })) } };
                }
                if (command === IpcCommand.DEBUG_MEMORY_EDIT_ADD) {
                    expect(Object.keys(data).sort()).to.deep.equal([
                        'active', 'comment', 'enteredValue', 'globalAddr', 'readonly',
                    ]);
                    const existing = entries.find(entry => entry.globalAddr === data.globalAddr);
                    const apply = data.active && (!existing || !existing.active || existing.enteredValue !== data.enteredValue);
                    const next = {
                        ...data,
                        originalValue: existing?.originalValue ?? memory.get(data.globalAddr) ?? 0,
                        currentValue: apply ? data.enteredValue : memory.get(data.globalAddr) ?? 0,
                    };
                    entries = [...entries.filter(entry => entry.globalAddr !== data.globalAddr), next]
                        .sort((left, right) => left.globalAddr - right.globalAddr);
                    if (apply) memory.set(data.globalAddr, data.enteredValue);
                    return { ok: true };
                }
                if (command === IpcCommand.SET_BYTE_GLOBAL) { memory.set(data.addr, data.data); return { ok: true }; }
                if (command === IpcCommand.DEBUG_MEMORY_EDIT_DEL) {
                    entries = entries.filter(entry => entry.globalAddr !== data.globalAddr); return { ok: true };
                }
                if (command === IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL) {
                    entries = []; return { ok: true };
                }
                if (command === IpcCommand.DEBUG_MEMORY_EDIT_RESTORE) {
                    const entry = entries.find(item => item.globalAddr === data.globalAddr)!;
                    memory.set(data.globalAddr, entry.originalValue);
                    entries = entries.filter(item => item.globalAddr !== data.globalAddr);
                    return { ok: true, data: { globalAddr: data.globalAddr, restoredValue: entry.originalValue, deleted: true } };
                }
                throw new Error(`Unexpected command ${command}`);
            },
        };
        const service = new MemoryEditService(lifecycle as any, client as any);

        const added = await service.apply(0x100, 0x22);
        expect(added).to.include({ originalValue: 0x11, enteredValue: 0x22, currentValue: 0x22 });
        const reapplied = await service.apply(0x100, 0x22, 0x22);
        expect(reapplied).to.include({ originalValue: 0x11, enteredValue: 0x22, currentValue: 0x22 });
        await service.setAutoUpdate(0x100, true);
        expect(service.snapshot[0].readonly).to.equal(true);
        lifecycle.running = true;
        await service.restoreRetaining(0x100);
        expect(service.snapshot[0]).to.include({ active: false, originalValue: 0x11, currentValue: 0x11 });
        lifecycle.running = false;
        await service.setEnteredValue(0x100, 0x33);
        expect(service.snapshot[0]).to.include({ active: true, enteredValue: 0x33, currentValue: 0x33 });
        await service.setActivity(0x100, false);
        expect(service.snapshot[0].active).to.equal(false);
        await service.setActivity(0x100, true);
        expect(service.snapshot[0].active).to.equal(true);
        await service.disable(0x100);
        expect(service.snapshot[0].active).to.equal(false);
        await service.apply(0x200, 0x44);
        await service.disableAll();
        expect(service.snapshot.every(entry => !entry.active)).to.equal(true);
        await service.deleteAndRestoreAll();
        expect(service.snapshot).to.deep.equal([]);
        expect(memory.get(0x100)).to.equal(0x11);
        expect(memory.get(0x200)).to.equal(0x00);
        await service.apply(0x100, 0x33);
        await service.deleteAll();
        expect(service.snapshot).to.deep.equal([]);
        await service.apply(0x100, 0x33);
        await service.deleteAndRestore(0x100);
        expect(service.snapshot).to.deep.equal([]);
        expect(memory.get(0x100)).to.equal(0x33);
        expect(commands.filter(command => command === IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL).length).to.equal(15);
        service.dispose();
    });

    it('clears local state on disconnect', async () => {
        const lifecycle = new FakeLifecycle();
        const snapshot = {
            globalAddr: 1, enteredValue: 2, originalValue: 1, currentValue: 2,
            readonly: false, active: true, comment: '',
        };
        const client = { send: async () => ({ ok: true, data: { edits: [snapshot] } }) };
        const service = new MemoryEditService(lifecycle as any, client as any);
        await service.refresh();
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        expect(service.snapshot).to.deep.equal([]);
        expect(service.sessionGeneration).to.equal(1);
        service.dispose();
    });
});