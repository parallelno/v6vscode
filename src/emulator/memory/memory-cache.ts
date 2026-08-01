import {
    allMemorySpaces,
    MEMORY_BANK_SIZE,
    MemorySpace,
    memorySpaceKey,
} from './memory-space';

interface BankCache {
    readonly values: Uint8Array;
    readonly valid: Uint8Array;
}

export interface CachedMemoryRange {
    readonly values: Uint8Array;
    readonly valid: Uint8Array;
}

export class MemoryCache {
    private readonly banks = new Map<string, BankCache>();

    constructor() {
        for (const space of allMemorySpaces()) {
            this.banks.set(memorySpaceKey(space), {
                values: new Uint8Array(MEMORY_BANK_SIZE),
                valid: new Uint8Array(MEMORY_BANK_SIZE),
            });
        }
    }

    write(space: MemorySpace, offset: number, bytes: Uint8Array): void {
        this.assertRange(offset, bytes.length);
        const bank = this.bank(space);
        bank.values.set(bytes, offset);
        bank.valid.fill(1, offset, offset + bytes.length);
    }

    read(space: MemorySpace, offset: number, length: number): CachedMemoryRange {
        this.assertRange(offset, length);
        const bank = this.bank(space);
        return {
            values: bank.values.slice(offset, offset + length),
            valid: bank.valid.slice(offset, offset + length),
        };
    }

    clearValidity(): void {
        for (const bank of this.banks.values()) {
            bank.valid.fill(0);
        }
    }

    private bank(space: MemorySpace): BankCache {
        const bank = this.banks.get(memorySpaceKey(space));
        if (!bank) {
            throw new RangeError(`Unsupported memory space: ${memorySpaceKey(space)}`);
        }
        return bank;
    }

    private assertRange(offset: number, length: number): void {
        if (!Number.isInteger(offset) || !Number.isInteger(length)
            || offset < 0 || length < 0 || offset + length > MEMORY_BANK_SIZE) {
            throw new RangeError(`Memory range ${offset}+${length} is outside a 64 KiB bank`);
        }
    }
}