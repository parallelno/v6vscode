import { expect } from 'chai';
import { decodeStopRecord } from '../../../src/emulator/protocol/debug-models';

describe('decodeStopRecord', () => {
    it('decodes breakpoint and watchpoint attribution', () => {
        expect(decodeStopRecord({
            sequence: 7,
            reason: 'watchpoint',
            pc: 0x1234,
            globalInstructionAddress: 0x1234,
            watchpointIds: [3, 5],
            access: 'write',
            accessedGlobalAddress: 0x10000,
            observedValue: 0x20,
            oldValue: 0x10,
            newValue: 0x20,
            description: 'matched',
        })).to.deep.equal({
            sequence: 7,
            reason: 'watchpoint',
            pc: 0x1234,
            globalInstructionAddress: 0x1234,
            watchpointIds: [3, 5],
            access: 'write',
            accessedGlobalAddress: 0x10000,
            observedValue: 0x20,
            oldValue: 0x10,
            newValue: 0x20,
            description: 'matched',
        });
    });

    it('decodes script-triggered stops', () => {
        expect(decodeStopRecord({
            sequence: 8,
            reason: 'script',
            pc: 0x200,
            globalInstructionAddress: 0x10200,
            description: 'Script requested a break',
        }).reason).to.equal('script');
    });

    it('rejects malformed required and optional fields', () => {
        const valid = { sequence: 1, reason: 'pause', pc: 0, globalInstructionAddress: 0 };
        for (const value of [
            { ...valid, sequence: -1 },
            { ...valid, reason: 'halt' },
            { ...valid, pc: 0x10000 },
            { ...valid, watchpointIds: [1, -1] },
            { ...valid, access: 'RW' },
            { ...valid, description: 4 },
        ]) {
            expect(() => decodeStopRecord(value)).to.throw('Invalid stop record');
        }
    });
});