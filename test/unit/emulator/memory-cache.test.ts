import { expect } from 'chai';
import { MemoryCache } from '../../../src/emulator/memory/memory-cache';
import { allMemorySpaces, MAIN_MEMORY_SPACE, MEMORY_BANK_SIZE } from '../../../src/emulator/memory/memory-space';

describe('MemoryCache', () => {
    it('allocates independent storage for Main RAM and all 32 RAM-disk banks', () => {
        const cache = new MemoryCache();
        const spaces = allMemorySpaces();
        expect(spaces).to.have.length(33);

        spaces.forEach((space, index) => {
            cache.write(space, 0x1234, Uint8Array.of(index));
        });

        spaces.forEach((space, index) => {
            const range = cache.read(space, 0x1234, 1);
            expect(Array.from(range.values)).to.deep.equal([index]);
            expect(Array.from(range.valid)).to.deep.equal([1]);
        });
    });

    it('tracks validity independently from byte values', () => {
        const cache = new MemoryCache();
        cache.write(MAIN_MEMORY_SPACE, 0x0010, Uint8Array.of(0x00, 0x7F));

        const range = cache.read(MAIN_MEMORY_SPACE, 0x000F, 4);
        expect(Array.from(range.values)).to.deep.equal([0x00, 0x00, 0x7F, 0x00]);
        expect(Array.from(range.valid)).to.deep.equal([0, 1, 1, 0]);

        cache.clearValidity();
        expect(Array.from(cache.read(MAIN_MEMORY_SPACE, 0x0010, 2).valid)).to.deep.equal([0, 0]);
    });

    it('supports the final byte and rejects cross-bank ranges', () => {
        const cache = new MemoryCache();
        cache.write(MAIN_MEMORY_SPACE, MEMORY_BANK_SIZE - 1, Uint8Array.of(0xAA));
        expect(cache.read(MAIN_MEMORY_SPACE, MEMORY_BANK_SIZE - 1, 1).values[0]).to.equal(0xAA);
        expect(() => cache.read(MAIN_MEMORY_SPACE, MEMORY_BANK_SIZE - 1, 2)).to.throw(RangeError);
    });
});