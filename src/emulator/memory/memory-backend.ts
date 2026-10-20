import { GetServerInfoResponse, IpcCommand } from '../protocol/ipc-commands';
import { MemoryReadCapabilities } from '../protocol/memory-models';
import type { CommandSender } from '../session/session-operations';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { decodeProtocolData, requireProtocolOk } from '../protocol/protocol-result';
import { expectInteger, expectRecord, ValidationError } from '../../shared/validation';
import { MEMORY_BANK_SIZE, RAM_DISK_BANK_COUNT, RAM_DISK_COUNT, MemorySpace, isValidMemorySpace, memorySpaceGlobalAddress } from './memory-space';

/** Protocol v2 command 93 has a fixed global layout; these are protocol limits,
 * not per-panel negotiated fields. Preview/value budgets remain consumer policy.
 */
export const PROTOCOL_V2_MEMORY: Readonly<MemoryReadCapabilities> = Object.freeze({
    maxReadLength: MEMORY_BANK_SIZE, ramDiskCount: RAM_DISK_COUNT,
    banksPerRamDisk: RAM_DISK_BANK_COUNT, bytesPerBank: MEMORY_BANK_SIZE, coherentWhileRunning: true,
});

export function memoryCapabilities(info: GetServerInfoResponse | undefined): Readonly<MemoryReadCapabilities> | undefined {
    return info?.protocolVersion === 2 && info.commands.includes(IpcCommand.GET_MEM) ? PROTOCOL_V2_MEMORY : undefined;
}

export function validateMemoryCapabilities(value: MemoryReadCapabilities | undefined): Readonly<MemoryReadCapabilities> {
    if (!value) { throw new Error('The active v6emul does not support GET_MEM global memory reads'); }
    expectInteger(value.maxReadLength, 'maxReadLength', 1, MEMORY_BANK_SIZE);
    expectInteger(value.ramDiskCount, 'ramDiskCount', 0, RAM_DISK_COUNT);
    expectInteger(value.banksPerRamDisk, 'banksPerRamDisk', 1, RAM_DISK_BANK_COUNT);
    if (value.bytesPerBank !== MEMORY_BANK_SIZE || typeof value.coherentWhileRunning !== 'boolean') {
        throw new ValidationError('memoryCapabilities', 'Invalid memory bank/coherence capabilities', 'range');
    }
    return Object.freeze({ ...value });
}

/** Checked wire boundary only. No live-view cache or stopped-generation cache. */
export class MemoryBackend {
    constructor(private readonly client: CommandSender & { readonly connectionEpoch?: number; readonly connected?: boolean }) {}

    capture(assertValid: () => void = () => {}): OperationScope {
        const epoch = this.client.connectionEpoch;
        return {
            key: {},
            assertCurrent: () => {
                assertValid();
                if (epoch !== this.client.connectionEpoch || this.client.connected === false) { throw new Error('Memory operation belongs to an inactive session'); }
            },
        };
    }

    validateRange(capabilities: MemoryReadCapabilities | undefined, space: MemorySpace, offset: number, length: number): Readonly<MemoryReadCapabilities> {
        const limits = validateMemoryCapabilities(capabilities);
        if (!space || !isValidMemorySpace(space)) { throw new RangeError('Invalid memory space'); }
        if (space.kind === 'ramDisk' && (space.disk > limits.ramDiskCount || space.bank >= limits.banksPerRamDisk)) {
            throw new RangeError('Memory space is not supported by the active emulator');
        }
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > MEMORY_BANK_SIZE) {
            throw new RangeError('Visible memory range is outside the selected bank');
        }
        return limits;
    }

    async read(space: MemorySpace, offset: number, length: number, capabilities: MemoryReadCapabilities | undefined,
        scope = this.capture(), priority: 'high' | 'normal' = 'normal'): Promise<Uint8Array> {
        const limits = this.validateRange(capabilities, space, offset, length);
        const bytes = new Uint8Array(length);
        for (let cursor = 0; cursor < length;) {
            scope.assertCurrent();
            const count = Math.min(limits.maxReadLength, length - cursor);
            const addr = memorySpaceGlobalAddress(space, offset + cursor);
            const response = await this.client.send(IpcCommand.GET_MEM, { addr, len: count }, 5000, priority, scope);
            scope.assertCurrent();
            const chunk = decodeProtocolData(IpcCommand.GET_MEM, response, 'Memory read failed', data => {
                const record = expectRecord(data, 'memory read');
                if (record.addr !== addr) { throw new ValidationError('addr', 'Memory read returned an invalid range', 'mismatch'); }
                if (!(record.data instanceof Uint8Array) && !Array.isArray(record.data)) {
                    throw new ValidationError('data', 'Memory read data must be a byte array', 'type');
                }
                if (record.data.length !== count) { throw new ValidationError('data', `Memory read returned ${record.data.length} bytes; expected ${count}`, 'length'); }
                // Do not silently truncate/coerce negative, fractional or string entries.
                if (Array.isArray(record.data)) { record.data.forEach((byte, index) => expectInteger(byte, `data[${index}]`, 0, 255)); }
                return Uint8Array.from(record.data);
            });
            bytes.set(chunk, cursor);
            cursor += count;
        }
        scope.assertCurrent();
        return bytes;
    }

    async writeByte(space: MemorySpace, offset: number, value: number, capabilities: MemoryReadCapabilities | undefined,
        scope = this.capture()): Promise<void> {
        this.validateRange(capabilities, space, offset, 1);
        if (!Number.isInteger(value) || value < 0 || value > 255) { throw new RangeError('Byte value must be an integer from 0 to 255'); }
        scope.assertCurrent();
        const response = await this.client.send(IpcCommand.SET_BYTE_GLOBAL,
            { addr: memorySpaceGlobalAddress(space, offset), data: value }, 5000, 'normal', scope);
        scope.assertCurrent();
        requireProtocolOk(IpcCommand.SET_BYTE_GLOBAL, response, 'Memory write failed');
    }
}