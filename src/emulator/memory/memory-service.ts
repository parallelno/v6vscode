import { IpcClient } from '../client/ipc-client';
import { IpcCommand } from '../protocol/ipc-commands';
import { MemoryReadCapabilities, ReadMemoryResponse, WriteByteRequest } from '../protocol/memory-models';
import { MemoryCache, CachedMemoryRange } from './memory-cache';
import { isValidMemorySpace, MEMORY_BANK_SIZE, MemorySpace, memorySpaceGlobalAddress } from './memory-space';

export class MemoryService {
    readonly cache = new MemoryCache();
    private epoch = 0;

    constructor(
        private readonly client: IpcClient,
        private capabilities: MemoryReadCapabilities | undefined,
    ) {}

    setCapabilities(capabilities: MemoryReadCapabilities | undefined): void {
        if (sameCapabilities(this.capabilities, capabilities)) {
            return;
        }
        this.capabilities = capabilities;
        this.epoch++;
        this.cache.clearValidity();
    }

    get supported(): boolean {
        const capabilities = this.capabilities;
        return !!capabilities
            && capabilities.bytesPerBank === MEMORY_BANK_SIZE
            && capabilities.maxReadLength > 0;
    }

    get memoryCapabilities(): MemoryReadCapabilities | undefined {
        return this.capabilities;
    }

    async refreshVisible(space: MemorySpace, offset: number, length: number): Promise<CachedMemoryRange> {
        this.validateRequest(space, offset, length);
        const capabilities = this.capabilities!;
        const epoch = this.epoch;
        let cursor = offset;
        const end = offset + length;

        while (cursor < end) {
            const requestLength = Math.min(capabilities.maxReadLength, end - cursor);
            const globalAddress = memorySpaceGlobalAddress(space, cursor);
            const response = await this.client.send<ReadMemoryResponse>(IpcCommand.GET_MEM, {
                addr: globalAddress,
                len: requestLength,
            }, 5000, 'normal');
            if (!response.ok || !response.data) {
                throw new Error(response.error ?? 'Memory read failed');
            }
            const data = response.data;
            if (data.addr !== globalAddress) {
                throw new Error('Memory read returned an invalid range');
            }
            const bytes = data.data instanceof Uint8Array ? data.data : Uint8Array.from(data.data);
            if (bytes.length !== requestLength) {
                throw new Error(`Memory read returned ${bytes.length} bytes; expected ${requestLength}`);
            }
            if (epoch !== this.epoch) {
                throw new Error('Memory read belongs to an inactive session');
            }
            this.cache.write(space, cursor, bytes);
            cursor += requestLength;
        }

        return this.cache.read(space, offset, length);
    }

    readCached(space: MemorySpace, offset: number, length: number): CachedMemoryRange {
        return this.cache.read(space, offset, length);
    }

    async writeByte(space: MemorySpace, offset: number, value: number): Promise<void> {
        this.validateRequest(space, offset, 1);
        if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
            throw new RangeError('Byte value must be an integer from 0 to 255');
        }
        const request: WriteByteRequest = {
            addr: memorySpaceGlobalAddress(space, offset),
            data: value,
        };
        const epoch = this.epoch;
        const response = await this.client.send(IpcCommand.SET_BYTE_GLOBAL, request, 5000, 'normal');
        if (!response.ok) {
            throw new Error(response.error ?? 'Memory write failed');
        }
        if (epoch !== this.epoch) {
            throw new Error('Memory write belongs to an inactive session');
        }
        this.cache.write(space, offset, Uint8Array.of(value));
    }

    clear(): void {
        this.epoch++;
        this.cache.clearValidity();
    }

    private validateRequest(space: MemorySpace, offset: number, length: number): void {
        if (!this.supported) {
            throw new Error('The active v6emul does not support GET_MEM global memory reads');
        }
        if (!isValidMemorySpace(space)) {
            throw new RangeError('Invalid memory space');
        }
        if (space.kind === 'ramDisk') {
            const capabilities = this.capabilities!;
            if (space.disk > capabilities.ramDiskCount || space.bank >= capabilities.banksPerRamDisk) {
                throw new RangeError('Memory space is not supported by the active emulator');
            }
        }
        if (!Number.isInteger(offset) || !Number.isInteger(length)
            || offset < 0 || length <= 0 || offset + length > MEMORY_BANK_SIZE) {
            throw new RangeError('Visible memory range is outside the selected bank');
        }
    }
}

function sameCapabilities(
    left: MemoryReadCapabilities | undefined,
    right: MemoryReadCapabilities | undefined,
): boolean {
    if (left === right) { return true; }
    if (!left || !right) { return false; }
    return left.maxReadLength === right.maxReadLength
        && left.ramDiskCount === right.ramDiskCount
        && left.banksPerRamDisk === right.banksPerRamDisk
        && left.bytesPerBank === right.bytesPerBank
        && left.coherentWhileRunning === right.coherentWhileRunning;
}