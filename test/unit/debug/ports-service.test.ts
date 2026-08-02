import { EventEmitter } from 'events';
import { expect } from 'chai';
import { PortsService } from '../../../src/debug/ports/ports-service';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = false;
    running = false;
    serverInfo = {
        emulatorVersion: 'test',
        commands: [IpcCommand.GET_IO_PORTS_IN_DATA, IpcCommand.GET_IO_PORTS_OUT_DATA],
    };
}

const bytes = (changes: Readonly<Record<number, number>> = {}) => ({
    bytes: Array.from({ length: 256 }, (_, index) => changes[index] ?? index),
});

describe('PortsService', () => {
    it('does not query while hidden or running', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        const commands: IpcCommand[] = [];
        const service = new PortsService(lifecycle as any, { send: async (command: IpcCommand) => {
            commands.push(command); return { ok: true, data: bytes() };
        } } as any);
        await service.refresh();
        lifecycle.running = true;
        service.setVisible(true);
        await service.refresh();
        expect(commands).to.deep.equal([]);
        service.dispose();
    });

    it('refreshes both directions and highlights only values changed since the previous update', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        const calls = new Map<IpcCommand, number>();
        const service = new PortsService(lifecycle as any, { send: async (command: IpcCommand) => {
            const call = (calls.get(command) ?? 0) + 1; calls.set(command, call);
            if (call === 1) return { ok: true, data: bytes() };
            return {
                ok: true,
                data: command === IpcCommand.GET_IO_PORTS_IN_DATA ? bytes({ 3: 0xAA, 240: 0xBB }) : bytes({ 17: 0xCC }),
            };
        } } as any);
        service.setVisible(true);
        await service.refresh();
        expect(service.state.changed.in).to.deep.equal([]);
        expect(service.state.changed.out).to.deep.equal([]);
        await service.refresh();
        expect(service.state.changed.in).to.deep.equal([3, 240]);
        expect(service.state.changed.out).to.deep.equal([17]);
        expect(service.state.ports.in?.[3]).to.equal(0xAA);
        service.dispose();
    });

    it('rejects responses after the emulator session stops', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const service = new PortsService(lifecycle as any, { send: async () => {
            await gate; return { ok: true, data: bytes() };
        } } as any);
        service.setVisible(true);
        const refresh = service.refresh();
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        release();
        await refresh;
        expect(service.state.ports.in).to.equal(undefined);
        expect(service.state.ports.out).to.equal(undefined);
        expect(service.state.generation).to.equal(1);
        service.dispose();
    });

    it('rejects a paused refresh response if execution resumes before it arrives', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const service = new PortsService(lifecycle as any, { send: async () => {
            await gate; return { ok: true, data: bytes() };
        } } as any);
        service.setVisible(true);
        const refresh = service.refresh();
        lifecycle.running = true;
        release();
        await refresh;
        expect(service.state.ports.in).to.equal(undefined);
        expect(service.state.ports.out).to.equal(undefined);
        service.dispose();
    });
});