import type { CommandSender } from '../../emulator/session/session-operations';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { MemoryReadCapabilities } from '../../emulator/protocol/memory-models';
import { MemoryBackend, PROTOCOL_V2_MEMORY } from '../../emulator/memory/memory-backend';
import { MAIN_MEMORY_SPACE } from '../../emulator/memory/memory-space';

/** Stopped CPU reader: bounded consumer budget, no address wrapping and no live cache. */
export class StopMemoryReader {
    private readonly backend: MemoryBackend;
    private readonly scope: OperationScope;

    constructor(client: CommandSender, private readonly capabilities: MemoryReadCapabilities | null = PROTOCOL_V2_MEMORY,
        assertCurrent: () => void = () => {}) {
        this.backend = new MemoryBackend(client);
        this.scope = this.backend.capture(assertCurrent);
    }

    async read(address: number, byteSize: number): Promise<number | undefined> {
        if (byteSize !== 1 && byteSize !== 2) { return undefined; }
        const bytes = await this.readBytes(address, byteSize);
        return bytes ? byteSize === 1 ? bytes[0] : bytes[0] | bytes[1] << 8 : undefined;
    }

    async readBytes(address: number, length: number): Promise<Uint8Array | undefined> {
        if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length)
            || address < 0 || length <= 0 || length > 256 || address + length > 0x10000) { return undefined; }
        try { return await this.backend.read(MAIN_MEMORY_SPACE, address, length, this.capabilities ?? undefined, this.scope, 'high'); }
        catch { return undefined; } // An unreadable variable must not abort the whole stop.
    }
}
