import { expect } from 'chai';
import {
    BP_ALL_PAGES,
    BreakpointAddRequest,
    BreakpointEntry,
    BreakpointGetStatusResponse,
    WatchpointAddRequest,
    WatchpointEditRequest,
    WatchpointEntry,
    makeBreakpointAdd,
} from '../../../src/emulator/protocol/debug-models';

describe('structured breakpoint schema', () => {
    it('builds a standard active breakpoint without packed fields', () => {
        const request = makeBreakpointAdd(0x1234, 'test');

        expect(request).to.deep.equal({
            addr: 0x1234,
            memPages: BP_ALL_PAGES,
            status: 'ACTIVE',
            autoDelete: false,
            operand: 'A',
            condition: 'ANY',
            value: 0,
            comment: 'test',
        });
        expect(request).not.to.have.any.keys('data0', 'data1', 'data2');
    });

    it('includes requested conditions and counters without changing ordinary payloads', () => {
        expect(makeBreakpointAdd(0x0100, 'conditional', {
            autoDelete: true,
            operand: 'HL',
            condition: 'GREATER_EQU',
            value: 0x1000,
            counter: 5,
        })).to.include({
            autoDelete: true,
            operand: 'HL',
            condition: 'GREATER_EQU',
            value: 0x1000,
            counter: 5,
        });
    });

    it('models named status, operand, and condition fields', () => {
        const request: BreakpointAddRequest = {
            addr: 0xFFFF,
            memPages: 1,
            status: 'DISABLED',
            autoDelete: false,
            operand: 'CC',
            condition: 'GREATER_EQU',
            value: Number.MAX_SAFE_INTEGER,
            comment: 'conditional',
        };
        const entry: BreakpointEntry = request;
        const status: BreakpointGetStatusResponse = { status: 'DELETED' };

        expect(entry.condition).to.equal('GREATER_EQU');
        expect(status.status).to.equal('DELETED');
    });
});

describe('structured watchpoint schema', () => {
    it('separates create and edit request types', () => {
        const create: WatchpointAddRequest = {
            globalAddr: 0x10000,
            len: 4,
            value: 0x20,
            access: 'RW',
            condition: 'EQU',
            type: 'LEN',
            active: true,
            comment: 'screen buffer',
        };
        const edit: WatchpointEditRequest = { id: 7, ...create, active: false };
        const entry: WatchpointEntry = edit;

        expect(create).not.to.have.property('id');
        expect(edit).to.include({ id: 7, active: false });
        expect(entry.id).to.equal(7);
        expect(entry).not.to.have.any.keys('data0', 'data1');
    });
});

describe('BP_ALL_PAGES', () => {
    it('is the complete 33-bit mapping mask', () => {
        expect(BP_ALL_PAGES).to.equal(0x1FFFFFFFF);
        expect(Number.isSafeInteger(BP_ALL_PAGES)).to.equal(true);
    });
});
