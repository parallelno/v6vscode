import { expect } from 'chai';
import { MemoryService } from '../../../src/emulator/memory/memory-service';
import { MAIN_MEMORY_SPACE } from '../../../src/emulator/memory/memory-space';
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
});