import * as assert from 'assert';
import { MemoryBackend, memoryCapabilities, PROTOCOL_V2_MEMORY } from '../../../src/emulator/memory/memory-backend';
import { MemoryService } from '../../../src/emulator/memory/memory-service';
import { StopMemoryReader } from '../../../src/debug/metadata/stop-memory-reader';
import { MAIN_MEMORY_SPACE } from '../../../src/shared/memory-space';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { ProtocolError } from '../../../src/emulator/protocol/protocol-result';

describe('Shared checked memory boundary', () => {
    const malformed: unknown[] = [
        null, {}, { ok: 'true' }, { ok: true, data: null },
        { ok: true, data: { addr: 2, data: [0, 1] } },
        { ok: true, data: { addr: 0, data: [0] } },
        ...[[-1, 1], [256, 1], [0.5, 1], ['0', 1], [NaN, 1], null, {}, 'ab'].map(data => ({ ok: true, data: { addr: 0, data } })),
    ];

    it('rejects the same malformed envelopes/ranges/bytes in live and stopped readers without cache publication', async () => {
        for (const response of malformed) {
            const client = { send: async () => response } as any;
            const live = new MemoryService(client, PROTOCOL_V2_MEMORY);
            const stopped = new StopMemoryReader(client);
            await assert.rejects(live.refreshVisible(MAIN_MEMORY_SPACE, 0, 2), ProtocolError);
            assert.strictEqual(await stopped.readBytes(0, 2), undefined);
            assert.deepStrictEqual([...live.readCached(MAIN_MEMORY_SPACE, 0, 2).valid], [0, 0]);
        }
    });

    it('retains command/code/field diagnostics and accepts byte arrays without coercion', async () => {
        const backend = new MemoryBackend({ send: async () => ({ ok: false, code: 'invalid_request', details: { field: 'len', reason: 'range' } }) } as any);
        await assert.rejects(backend.read(MAIN_MEMORY_SPACE, 0, 2, PROTOCOL_V2_MEMORY),
            (error: unknown) => error instanceof ProtocolError && error.command === IpcCommand.GET_MEM && error.field === 'len' && error.code === 'invalid_request');
        for (const data of [[0, 255], Uint8Array.of(0, 255)]) {
            const stopped = new StopMemoryReader({ send: async () => ({ ok: true, data: { addr: 0, data } }) } as any);
            assert.deepStrictEqual([...(await stopped.readBytes(0, 2))!], [0, 255]);
        }
    });

    it('validates capability and bank bounds before any command and does not wrap CPU addresses', async () => {
        let sends = 0;
        const client = { send: async () => { sends++; } } as any;
        const backend = new MemoryBackend(client);
        for (const capabilities of [undefined, { ...PROTOCOL_V2_MEMORY, maxReadLength: NaN }, { ...PROTOCOL_V2_MEMORY, ramDiskCount: 9 }]) {
            await assert.rejects(backend.read(MAIN_MEMORY_SPACE, 0, 1, capabilities));
        }
        for (const [offset, length] of [[-1, 1], [0.5, 1], [0xFFFF, 2], [0, 0]]) {
            await assert.rejects(backend.read(MAIN_MEMORY_SPACE, offset, length, PROTOCOL_V2_MEMORY));
        }
        await assert.rejects(backend.read({ kind: 'ramDisk', disk: 2, bank: 0 }, 0, 1, { ...PROTOCOL_V2_MEMORY, ramDiskCount: 1 }));
        const stopped = new StopMemoryReader(client);
        assert.strictEqual(await stopped.readBytes(0x10000, 1), undefined);
        assert.strictEqual(await new StopMemoryReader(client, null).readBytes(0, 1), undefined);
        assert.strictEqual(sends, 0);
        assert.strictEqual(memoryCapabilities(undefined), undefined);
        assert.strictEqual(memoryCapabilities({ protocolVersion: 2, commands: [IpcCommand.GET_MEM] } as any), PROTOCOL_V2_MEMORY);
    });

    it('keeps consumer budgets separate from backend chunk size and publishes chunks atomically', async () => {
        let sends = 0;
        const client = { send: async (_command: IpcCommand, request: { addr: number; len: number }) => {
            sends++;
            return { ok: true, data: { addr: request.addr, data: new Array(request.len).fill(sends === 2 ? 999 : 42) } };
        } } as any;
        const caps = { ...PROTOCOL_V2_MEMORY, maxReadLength: 2 };
        const live = new MemoryService(client, caps);
        await assert.rejects(live.refreshVisible(MAIN_MEMORY_SPACE, 0, 4), ProtocolError);
        assert.deepStrictEqual([...live.readCached(MAIN_MEMORY_SPACE, 0, 4).valid], [0, 0, 0, 0]);
        sends = 0;
        assert.strictEqual(await new StopMemoryReader(client, caps).readBytes(0, 4), undefined);
        assert.strictEqual(sends, 2);
    });

    it('invalidates before dispatch and after response on reconnect, stop change or clear', async () => {
        let scope: { assertCurrent(): void } | undefined;
        let finish!: (response: unknown) => void;
        const client = { connectionEpoch: 1, connected: true,
            send: (_command: IpcCommand, _data: unknown, _timeout: number, _priority: string, submitted: any) => {
                scope = submitted;
                return new Promise(resolve => { finish = resolve; });
            } } as any;
        const live = new MemoryService(client, PROTOCOL_V2_MEMORY);
        const result = assert.rejects(live.refreshVisible(MAIN_MEMORY_SPACE, 0, 1), /inactive session/);
        client.connectionEpoch++;
        assert.throws(() => scope!.assertCurrent(), /inactive session/);
        finish({ ok: true, data: { addr: 0, data: [42] } });
        await result;
        assert.strictEqual(live.readCached(MAIN_MEMORY_SPACE, 0, 1).valid[0], 0);
        let valid = true;
        const stopped = new StopMemoryReader(client, PROTOCOL_V2_MEMORY, () => { if (!valid) { throw new Error('stop changed'); } });
        valid = false;
        assert.strictEqual(await stopped.readBytes(0, 1), undefined);
    });
});