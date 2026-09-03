import * as assert from 'assert';
import { evaluateDwarfExpression } from '../../../src/debug/metadata/dwarf-expression';

describe('evaluateDwarfExpression', () => {
    it('evaluates DW_OP_addrx before the overlapping DW_OP_breg opcode range', () => {
        const value = evaluateDwarfExpression(Buffer.from([0xA1, 0x11, 0x23, 0x02]), {
            registers: {},
            cfa: 0,
            frameBase: 0,
            addressSize: 2,
            readMemory: () => undefined,
            resolveAddress: index => index === 17 ? 0x2340 : 0,
        });

        assert.deepStrictEqual(value, { kind: 'memory', address: 0x2342 });
    });
});