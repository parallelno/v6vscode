import { expect } from 'chai';
import {
    BP_ALL_PAGES,
    BP_STATUS_DISABLED,
    BP_STATUS_ACTIVE,
    BP_STATUS_DELETED,
    BP_OPERAND_A,
    BP_COND_ANY,
    encodeBpData2,
    decodeBpAddr,
    decodeBpStatus,
    isBpActive,
    makeBreakpointAdd,
} from '../../../src/emulator/protocol/debug-models';

// ---------------------------------------------------------------------------
// data2 encoding
// ---------------------------------------------------------------------------

describe('encodeBpData2', () => {
    it('encodes address in bits 0-15', () => {
        expect(encodeBpData2(0x1234) & 0xFFFF).to.equal(0x1234);
        expect(encodeBpData2(0x0100) & 0xFFFF).to.equal(0x0100);
        expect(encodeBpData2(0x0000) & 0xFFFF).to.equal(0x0000);
        expect(encodeBpData2(0xFFFF) & 0xFFFF).to.equal(0xFFFF);
    });

    it('defaults to ACTIVE status (bit 24 = 1)', () => {
        const data2 = encodeBpData2(0x1234);
        expect((data2 >>> 24) & 0x3).to.equal(BP_STATUS_ACTIVE);
    });

    it('encodes DISABLED status correctly', () => {
        const data2 = encodeBpData2(0x1234, BP_STATUS_DISABLED);
        expect((data2 >>> 24) & 0x3).to.equal(BP_STATUS_DISABLED);
    });

    it('encodes DELETED status correctly', () => {
        const data2 = encodeBpData2(0x1234, BP_STATUS_DELETED);
        expect((data2 >>> 24) & 0x3).to.equal(BP_STATUS_DELETED);
    });

    it('encodes autoDel in bit 26', () => {
        const with_del = encodeBpData2(0x0100, BP_STATUS_ACTIVE, BP_OPERAND_A, BP_COND_ANY, true);
        const without = encodeBpData2(0x0100, BP_STATUS_ACTIVE, BP_OPERAND_A, BP_COND_ANY, false);
        expect((with_del >>> 26) & 1).to.equal(1);
        expect((without >>> 26) & 1).to.equal(0);
    });

    it('encodes operand in bits 16-19', () => {
        const data2 = encodeBpData2(0x0000, BP_STATUS_ACTIVE, 5 /* E */);
        expect((data2 >>> 16) & 0xF).to.equal(5);
    });

    it('encodes condition in bits 20-23', () => {
        const data2 = encodeBpData2(0x0000, BP_STATUS_ACTIVE, BP_OPERAND_A, 2 /* LESS */);
        expect((data2 >>> 20) & 0xF).to.equal(2);
    });

    it('produces the verified live value for addr=0x1234 all-defaults', () => {
        // Live test on 2026-07-29 showed status=0 (DISABLED) when data2=4660=0x1234.
        // With ACTIVE (status=1) the expected value is 0x01001234 = 16781876.
        const data2 = encodeBpData2(0x1234);
        expect(data2).to.equal(0x01001234); // 16781876
    });

    it('produces the verified live value for addr=0x0100 all-defaults', () => {
        // 0x01000100 = 16777472
        const data2 = encodeBpData2(0x0100);
        expect(data2).to.equal(0x01000100); // 16777472
    });

    it('DISABLED breakpoint matches the live GET_ALL data2=4660 result', () => {
        // The verification test added a breakpoint with data2=4660 (addr=0x1234, status=DISABLED)
        // and GET_STATUS returned status=0. This confirms bit 24 not set → DISABLED.
        const data2 = encodeBpData2(0x1234, BP_STATUS_DISABLED);
        expect(data2).to.equal(0x1234); // 4660
    });
});

// ---------------------------------------------------------------------------
// data2 decoding
// ---------------------------------------------------------------------------

describe('decodeBpAddr', () => {
    it('extracts the address from bits 0-15', () => {
        expect(decodeBpAddr(0x01001234)).to.equal(0x1234);
        expect(decodeBpAddr(0x01000100)).to.equal(0x0100);
        expect(decodeBpAddr(4660)).to.equal(0x1234); // 4660 = 0x1234
        expect(decodeBpAddr(256)).to.equal(0x0100);  // 256 = 0x100
    });

    it('masks upper bits', () => {
        expect(decodeBpAddr(0xFFFFFFFF)).to.equal(0xFFFF);
    });
});

describe('decodeBpStatus', () => {
    it('extracts status from bits 24-25', () => {
        expect(decodeBpStatus(0x00001234)).to.equal(BP_STATUS_DISABLED);
        expect(decodeBpStatus(0x01001234)).to.equal(BP_STATUS_ACTIVE);
        expect(decodeBpStatus(0x02001234)).to.equal(BP_STATUS_DELETED);
    });
});

describe('isBpActive', () => {
    it('returns true for ACTIVE status', () => {
        expect(isBpActive(encodeBpData2(0x1234, BP_STATUS_ACTIVE))).to.be.true;
    });

    it('returns false for DISABLED', () => {
        expect(isBpActive(encodeBpData2(0x1234, BP_STATUS_DISABLED))).to.be.false;
    });

    it('returns false for DELETED', () => {
        expect(isBpActive(encodeBpData2(0x1234, BP_STATUS_DELETED))).to.be.false;
    });
});

// ---------------------------------------------------------------------------
// makeBreakpointAdd
// ---------------------------------------------------------------------------

describe('makeBreakpointAdd', () => {
    it('uses BP_ALL_PAGES as data0', () => {
        const req = makeBreakpointAdd(0x1234, 'test');
        expect(req.data0).to.equal(BP_ALL_PAGES);
    });

    it('sets data1 to zero', () => {
        expect(makeBreakpointAdd(0x1234, 'test').data1).to.equal(0);
    });

    it('produces an ACTIVE breakpoint by default', () => {
        const req = makeBreakpointAdd(0x1234, 'test');
        expect(isBpActive(req.data2)).to.be.true;
        expect(decodeBpAddr(req.data2)).to.equal(0x1234);
    });

    it('sets autoDel when requested', () => {
        const req = makeBreakpointAdd(0x0100, 'step-over', true);
        expect((req.data2 >>> 26) & 1).to.equal(1);
        expect(isBpActive(req.data2)).to.be.true;
    });

    it('preserves the comment', () => {
        expect(makeBreakpointAdd(0x0100, 'my comment').comment).to.equal('my comment');
    });

    it('round-trips addr through data2', () => {
        for (const addr of [0x0000, 0x0100, 0x1234, 0x8000, 0xFFFF]) {
            const req = makeBreakpointAdd(addr, 'test');
            expect(decodeBpAddr(req.data2)).to.equal(addr);
        }
    });
});

// ---------------------------------------------------------------------------
// BP_ALL_PAGES constant
// ---------------------------------------------------------------------------

describe('BP_ALL_PAGES', () => {
    it('equals 0x1_FFFF_FFFF (33 bits set)', () => {
        expect(BP_ALL_PAGES).to.equal(0x1FFFFFFFF);
    });

    it('covers RAM bit (bit 0)', () => {
        expect(BP_ALL_PAGES & 1).to.equal(1);
    });

    it('covers all 32 RAM-disk page bits (bits 1-32)', () => {
        for (let i = 1; i <= 32; i++) {
            expect((BP_ALL_PAGES >>> i) & 1).to.equal(1, `bit ${i} should be set`);
        }
    });
});
