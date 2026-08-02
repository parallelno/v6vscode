import { EventEmitter } from 'events';
import { expect } from 'chai';
import { HardwareStatisticsService } from '../../../src/debug/hardware-statistics/hardware-statistics-service';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = false;
    running = false;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [
            IpcCommand.GET_HARDWARE_STATS,
            IpcCommand.SET_IO_PALETTE_ENTRY,
            IpcCommand.DISMOUNT_FDD,
            IpcCommand.MOUNT_FDD,
            IpcCommand.GET_IO_PORTS_IN_DATA,
            IpcCommand.GET_IO_PORTS_OUT_DATA,
        ],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            hardwareStatsSchema: 1, paletteEntryMutation: true, fddDismount: true,
        },
    };
}

const snapshot = {
    sessionId: 1, uptimeMs: 1000, cpuCycles: 10, lastRunCycles: 5,
    rasterPixel: 1, rasterLine: 2, frameCycles: 3, frameNumber: 4,
    displayMode: 0, scrollVertical: 0, rusLat: false, inte: true, iff: false, hlta: false,
    palette: Array(16).fill(0), ramDisk: { index: 0, mapping: 0 },
    fdc: { selectedDrive: 0, drives: Array.from({ length: 4 }, () => ({ mounted: false, path: '', updated: false })) },
};

describe('HardwareStatisticsService', () => {
    it('does not query while hidden or running', async () => {
        const lifecycle = new FakeLifecycle();
        const commands: IpcCommand[] = [];
        const client = { send: async (command: IpcCommand) => { commands.push(command); return { ok: true, data: snapshot }; } };
        const service = new HardwareStatisticsService(lifecycle as any, client as any);
        lifecycle.connected = true;
        await service.refresh();
        lifecycle.running = true;
        service.setVisible(true);
        await service.refresh();
        expect(commands).to.deep.equal([]);
        service.dispose();
    });

    it('coalesces overlapping snapshot refreshes', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let requests = 0;
        const client = { send: async () => { requests++; await gate; return { ok: true, data: snapshot }; } };
        const service = new HardwareStatisticsService(lifecycle as any, client as any);
        service.setVisible(true);
        const first = service.refresh();
        const second = service.refresh();
        release();
        await Promise.all([first, second]);
        expect(requests).to.equal(1);
        service.dispose();
    });

    it('derives Last Run from total cycles when a paused debugger step leaves the server latch stale', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        const responses = [snapshot, { ...snapshot, cpuCycles: 17, lastRunCycles: 5 }];
        const client = { send: async () => ({ ok: true, data: responses.shift() }) };
        const service = new HardwareStatisticsService(lifecycle as any, client as any);
        service.setVisible(true);
        await service.refresh();
        await service.refresh();
        expect(service.state.snapshot?.lastRunCycles).to.equal(7);
        service.dispose();
    });

    it('queries only expanded port directions and accepts 256-byte payloads', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        const commands: IpcCommand[] = [];
        const client = { send: async (command: IpcCommand) => {
            commands.push(command);
            return command === IpcCommand.GET_HARDWARE_STATS
                ? { ok: true, data: snapshot }
                : { ok: true, data: { bytes: Array.from({ length: 256 }, (_, index) => index) } };
        } };
        const service = new HardwareStatisticsService(lifecycle as any, client as any);
        service.setPortExpanded('in', true);
        service.setVisible(true);
        await service.refresh();
        expect(commands.filter(command => command === IpcCommand.GET_IO_PORTS_IN_DATA)).to.have.length(1);
        expect(commands).not.to.include(IpcCommand.GET_IO_PORTS_OUT_DATA);
        expect(service.state.ports.in?.bytes[255]).to.equal(255);
        service.dispose();
    });

    it('rejects stale responses after disconnect', async () => {
        const lifecycle = new FakeLifecycle(); lifecycle.connected = true;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const client = { send: async () => { await gate; return { ok: true, data: snapshot }; } };
        const service = new HardwareStatisticsService(lifecycle as any, client as any);
        service.setVisible(true);
        const refresh = service.refresh();
        lifecycle.connected = false;
        lifecycle.emit('stateChange', 'stopped');
        release();
        await refresh;
        expect(service.state.snapshot).to.equal(undefined);
        expect(service.sessionGeneration).to.equal(1);
        service.dispose();
    });
});