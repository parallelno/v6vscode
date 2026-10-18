import { expect } from 'chai';
import { decodeDataMemberLocationBlock } from '../../../src/debug/metadata/dwarf-types';

describe('data_member_location exprloc decoding', () => {
    it('decodes DW_OP_plus_uconst offsets including ULEB128 forms', () => {
        expect(decodeDataMemberLocationBlock(Buffer.from([0x23, 0x00]))).to.equal(0);
        expect(decodeDataMemberLocationBlock(Buffer.from([0x23, 0x11]))).to.equal(17);
        expect(decodeDataMemberLocationBlock(Buffer.from([0x23, 0xA5, 0x01]))).to.equal(165);
    });

    it('rejects other opcodes, short blocks, and missing blocks', () => {
        expect(decodeDataMemberLocationBlock(undefined)).to.equal(0);
        expect(decodeDataMemberLocationBlock(Buffer.from([0x23]))).to.equal(0);
        expect(decodeDataMemberLocationBlock(Buffer.from([0x91, 0x08]))).to.equal(0);
        expect(decodeDataMemberLocationBlock(Buffer.alloc(0))).to.equal(0);
    });
});
