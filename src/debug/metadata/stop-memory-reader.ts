/**
 * Bounded memory reader over v6emul GET_MEM for stopped-state evaluation.
 *
 * CPU RAM at address N is global address N (RAM is the base memory space).
 * All reads are bounded and 16-bit wrapped; reads return undefined on failure
 * so a single bad read degrades one variable rather than aborting the stop.
 */

import { IpcClient } from '../../emulator/client/ipc-client';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import { ReadMemoryResponse } from '../../emulator/protocol/memory-models';

const MAX_READ = 256;

export class StopMemoryReader {
    constructor(private readonly client: IpcClient) {}

    /** Read a little-endian integer of byteSize (1 or 2) at a 16-bit address. */
    async read(address: number, byteSize: number): Promise<number | undefined> {
        if (byteSize !== 1 && byteSize !== 2) { return undefined; }
        const bytes = await this.readBytes(address, byteSize);
        if (!bytes) { return undefined; }
        return byteSize === 1 ? bytes[0] : (bytes[0] | (bytes[1] << 8));
    }

    /** Read raw bytes with 16-bit address wrapping; undefined on failure. */
    async readBytes(address: number, length: number): Promise<Uint8Array | undefined> {
        if (!Number.isInteger(address) || !Number.isInteger(length)
            || address < 0 || length <= 0 || length > MAX_READ) {
            return undefined;
        }
        const start = address & 0xFFFF;
        // Avoid a read that would wrap past 0xFFFF; keep it in one range.
        const end = start + length;
        const capped = Math.min(end, 0x10000);
        const cappedLength = capped - start;
        if (cappedLength !== length) {
            // The C ABI does not wrap memory operands; treat wrap as a failure.
            return undefined;
        }
        try {
            const response = await this.client.send<ReadMemoryResponse>(IpcCommand.GET_MEM, {
                addr: start,
                len: length,
            }, 5000, 'high');
            if (!response.ok || !response.data) { return undefined; }
            const data = response.data.data instanceof Uint8Array
                ? response.data.data
                : Uint8Array.from(response.data.data);
            return data.length === length ? data : undefined;
        } catch {
            return undefined;
        }
    }
}
