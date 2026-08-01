import { expect } from 'chai';
import { MemoryService } from '../../../src/emulator/memory/memory-service';
import {
    globalAddressMemoryLocation,
    MAIN_MEMORY_SPACE,
} from '../../../src/emulator/memory/memory-space';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('MemoryService', () => {
    const capabilities = {
        maxReadLength: 4,
        ramDiskCount: 8,
        banksPerRamDisk: 4,
        bytesPerBank: 0x10000,
        coherentWhileRunning: true,
    };

    it('splits only within the visible interval and populates the full cache', async () => {
        const requests: Array<{ addr: number; len: number }> = [];
        const client = {
            send: async (command: IpcCommand, request: { addr: number; len: number }) => {
                expect(command).to.equal(IpcCommand.GET_MEM);
                requests.push(request);
                return {
                    ok: true,
                    data: {
                        addr: request.addr,
                        data: Array.from({ length: request.len }, (_, index) => request.addr + index),
                    },
                };
            },
        } as any;
        const service = new MemoryService(client, capabilities);

        const result = await service.refreshVisible(MAIN_MEMORY_SPACE, 10, 9);

        expect(requests).to.deep.equal([
            { addr: 10, len: 4 },
            { addr: 14, len: 4 },
            { addr: 18, len: 1 },
        ]);
        expect(Array.from(result.values)).to.deep.equal([10, 11, 12, 13, 14, 15, 16, 17, 18]);
        expect(Array.from(result.valid)).to.deep.equal(new Array(9).fill(1));
    });

    it('rejects reads when the backend capability is unavailable', async () => {
        const service = new MemoryService({} as any, undefined);
        let message = '';
        try {
            await service.refreshVisible(MAIN_MEMORY_SPACE, 0, 16);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain('does not support GET_MEM global memory reads');
    });

    it('maps each RAM-disk bank after the preceding 64 KiB global spaces', async () => {
        const requests: Array<{ addr: number; len: number }> = [];
        const client = {
            send: async (_command: IpcCommand, request: { addr: number; len: number }) => {
                requests.push(request);
                return { ok: true, data: { addr: request.addr, data: new Array(request.len).fill(0) } };
            },
        } as any;
        const service = new MemoryService(client, capabilities);

        await service.refreshVisible({ kind: 'ramDisk', disk: 1, bank: 0 }, 0x20, 1);
        await service.refreshVisible({ kind: 'ramDisk', disk: 2, bank: 3 }, 0x20, 1);

        expect(requests).to.deep.equal([
            { addr: 0x10020, len: 1 },
            { addr: 0x80020, len: 1 },
        ]);
    });

    it('maps global watchpoint addresses back to typed memory locations', () => {
        expect(globalAddressMemoryLocation(0xFFFF)).to.deep.equal({ space: { kind: 'main' }, offset: 0xFFFF });
        expect(globalAddressMemoryLocation(0x10020)).to.deep.equal({
            space: { kind: 'ramDisk', disk: 1, bank: 0 }, offset: 0x20,
        });
        expect(globalAddressMemoryLocation(0x80020)).to.deep.equal({
            space: { kind: 'ramDisk', disk: 2, bank: 3 }, offset: 0x20,
        });
        expect(() => globalAddressMemoryLocation(0x210000)).to.throw('outside emulator memory');
    });

    it('writes a byte through SET_BYTE_GLOBAL and updates the cache after acknowledgment', async () => {
        const requests: Array<{ command: IpcCommand; data: { addr: number; data: number } }> = [];
        const client = {
            send: async (command: IpcCommand, data: { addr: number; data: number }) => {
                requests.push({ command, data });
                return { ok: true, data: {} };
            },
        } as any;
        const service = new MemoryService(client, capabilities);

        await service.writeByte({ kind: 'ramDisk', disk: 1, bank: 0 }, 0x20, 0xAB);

        expect(requests).to.deep.equal([{
            command: IpcCommand.SET_BYTE_GLOBAL,
            data: { addr: 0x10020, data: 0xAB },
        }]);
        expect(Array.from(service.readCached({ kind: 'ramDisk', disk: 1, bank: 0 }, 0x20, 1).values))
            .to.deep.equal([0xAB]);
        expect(Array.from(service.readCached({ kind: 'ramDisk', disk: 1, bank: 0 }, 0x20, 1).valid))
            .to.deep.equal([1]);
    });

    it('does not update the cache when a byte write fails', async () => {
        const service = new MemoryService({
            send: async () => ({ ok: false, error: 'write rejected' }),
        } as any, capabilities);

        let message = '';
        try {
            await service.writeByte(MAIN_MEMORY_SPACE, 0x20, 0xAB);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).to.equal('write rejected');
        expect(Array.from(service.readCached(MAIN_MEMORY_SPACE, 0x20, 1).valid)).to.deep.equal([0]);
    });

    it('rejects a byte write acknowledgment from an inactive session', async () => {
        let acknowledge: ((response: { ok: boolean; data: object }) => void) | undefined;
        const client = {
            send: () => new Promise(resolve => { acknowledge = resolve; }),
        } as any;
        const service = new MemoryService(client, capabilities);
        const write = service.writeByte(MAIN_MEMORY_SPACE, 0x20, 0xAB);

        service.clear();
        acknowledge!({ ok: true, data: {} });

        let message = '';
        try { await write; } catch (error) { message = error instanceof Error ? error.message : String(error); }
        expect(message).to.equal('Memory write belongs to an inactive session');
        expect(Array.from(service.readCached(MAIN_MEMORY_SPACE, 0x20, 1).valid)).to.deep.equal([0]);
    });

    it('rejects byte values outside 0..255 before sending', async () => {
        let sends = 0;
        const service = new MemoryService({ send: async () => { sends++; } } as any, capabilities);

        for (const value of [-1, 256, 1.5]) {
            try { await service.writeByte(MAIN_MEMORY_SPACE, 0, value); } catch { /* expected */ }
        }

        expect(sends).to.equal(0);
    });
});