import * as assert from 'assert';
import { VariableService } from '../../../src/debug/adapter/variable-service';

describe('VariableService', () => {
    it('formats a value held in a recovered frame register', async () => {
        const service = new VariableService();
        const metadata = {
            resolveAbstractOrigin: (variable: unknown) => variable,
            typeOf: () => ({ name: 'unsigned char', byteSize: 1 }),
            evaluateVariable: () => ({ kind: 'register', register: 3 }),
        } as any;
        const context = { evalContext: () => ({}) } as any;
        const frame = { pc: 0x1000, registers: { 3: 0xAB } } as any;

        const result = await service.dapVariables(metadata, context, frame, [{ id: 1, name: 'value', kind: 'local', typeOffset: 1 }]);

        const { valueData, ...dapVariable } = result[0];
        assert.deepStrictEqual(dapVariable, { name: 'value', value: '171', type: 'unsigned char', memoryReference: undefined, variablesReference: 0 });
        assert.strictEqual(valueData.availability, 'available');
    });

    it('reports a location-list gap without suppressing another variable', async () => {
        const service = new VariableService();
        const metadata = {
            resolveAbstractOrigin: (variable: unknown) => variable,
            typeOf: () => undefined,
            evaluateVariable: (variable: any) => variable.name === 'gone'
                ? { kind: 'unavailable', reason: 'no location' }
                : { kind: 'value', value: 1 },
        } as any;
        const context = { evalContext: () => ({}) } as any;
        const frame = { pc: 0x1000, registers: {} } as any;

        const result = await service.dapVariables(metadata, context, frame, [
            { id: 1, name: 'gone', kind: 'local', loclist: [] },
            { id: 2, name: 'present', kind: 'local' },
        ]);

        assert.strictEqual(result[0].value, '<not available at this location>');
        assert.strictEqual(result[1].value, '1');
    });

    it('formats signed integers, characters, booleans, and enumerators', async () => {
        const service = new VariableService();
        const types = [
            { kind: 'base', name: 'int', byteSize: 2, signed: true },
            { kind: 'base', name: 'char', byteSize: 1, signed: false, encoding: 'signed_char' },
            { kind: 'base', name: '_Bool', byteSize: 1, signed: false },
            { kind: 'enum', name: 'Color', byteSize: 1, signed: true, enumerators: new Map([['green', 2]]) },
        ];
        const metadata = {
            resolveAbstractOrigin: (variable: unknown) => variable,
            typeOf: (offset: number) => types[offset],
            evaluateVariable: (variable: any) => ({ kind: 'value', value: variable.name === 'color' ? 2 : 0xFFFE }),
        } as any;
        const context = { evalContext: () => ({}) } as any;
        const frame = { pc: 0x1000, registers: {} } as any;

        const result = await service.dapVariables(metadata, context, frame, [
            { id: 1, name: 'integer', kind: 'local', typeOffset: 0 },
            { id: 2, name: 'character', kind: 'local', typeOffset: 1 },
            { id: 3, name: 'boolean', kind: 'local', typeOffset: 2 },
            { id: 4, name: 'color', kind: 'local', typeOffset: 3 },
        ]);

        assert.deepStrictEqual(result.map(variable => variable.value), ['-2', "-2 '\\xfe'", 'true', 'green (2)']);
    });

    it('formats null, data, and function pointers', async () => {
        const service = new VariableService();
        const types = [
            { kind: 'pointer', name: 'int *', byteSize: 2, signed: false },
            { kind: 'pointer', name: 'fn *', byteSize: 2, signed: false, of: { kind: 'subroutine' } },
        ];
        const metadata = {
            resolveAbstractOrigin: (variable: unknown) => variable,
            typeOf: (offset: number) => types[offset],
            evaluateVariable: (variable: any) => ({ kind: 'value', value: variable.name === 'null' ? 0 : 0x1234 }),
        } as any;
        const context = { evalContext: () => ({}) } as any;
        const frame = { pc: 0x1000, registers: {} } as any;

        const result = await service.dapVariables(metadata, context, frame, [
            { id: 1, name: 'null', kind: 'local', typeOffset: 0 },
            { id: 2, name: 'data', kind: 'local', typeOffset: 0 },
            { id: 3, name: 'function', kind: 'local', typeOffset: 1 },
        ]);

        assert.deepStrictEqual(result.map(variable => variable.value), ['NULL', '0x1234', '0x1234 <function>']);
    });

    it('pages array and structure children from bounded target memory', async () => {
        const service = new VariableService();
        const byte = { kind: 'base', name: 'unsigned char', byteSize: 1, signed: false } as any;
        const array = { kind: 'array', name: 'unsigned char[3]', byteSize: 3, signed: false, of: byte, count: 3 } as any;
        const struct = { kind: 'structure', name: 'Pair', byteSize: 2, signed: false, members: [{ name: 'first', offset: 0, type: byte }, { name: 'second', offset: 1, type: byte }] } as any;
        const context = { memory: { readBytes: async (address: number) => new Uint8Array([address & 0xFF]) } } as any;

        const arrayChildren = await service.children(context, { type: array, address: 0x1000, bytes: new Uint8Array([0, 0, 0]), availability: 'available' }, 1, 1);
        const members = await service.children(context, { type: struct, address: 0x1000, bytes: new Uint8Array([0, 0]), availability: 'available' });

        assert.strictEqual(arrayChildren.length, 1);
        assert.strictEqual(arrayChildren[0].name, '[1]');
        assert.deepStrictEqual(members.map(member => member.name), ['first', 'second']);
        assert.strictEqual(members[1].memoryReference, '0x1001');
    });

    it('expands a non-null pointer through a single dereference child', async () => {
        const service = new VariableService();
        const byte = { kind: 'base', name: 'unsigned char', byteSize: 1, signed: false } as any;
        const pointer = { kind: 'pointer', name: 'unsigned char *', byteSize: 2, signed: false, of: byte } as any;
        const context = { memory: { readBytes: async () => new Uint8Array([0x2A]) } } as any;

        const children = await service.children(context, { type: pointer, bytes: new Uint8Array([0x34, 0x12]), availability: 'available' });

        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].name, '*');
        assert.strictEqual(children[0].value, '42');
        assert.strictEqual(children[0].memoryReference, '0x1234');
    });

    it('uses a concrete inline location while inheriting its abstract-origin type', async () => {
        const service = new VariableService();
        const concrete: any = { id: 2, name: '', kind: 'local', abstractOrigin: 1 };
        const origin: any = { id: 1, name: 'argument', kind: 'parameter', typeOffset: 1 };
        const metadata = {
            resolveAbstractOrigin: () => origin,
            typeOf: () => ({ kind: 'base', name: 'unsigned char', byteSize: 1, signed: false }),
            evaluateVariable: (variable: unknown) => variable === concrete ? { kind: 'value', value: 7 } : { kind: 'unavailable', reason: 'no location' },
        } as any;
        const context = { evalContext: () => ({}) } as any;
        const frame = { pc: 0x1000, registers: {} } as any;

        const result = await service.dapVariables(metadata, context, frame, [concrete]);

        assert.strictEqual(result[0].name, 'argument');
        assert.strictEqual(result[0].value, '7');
    });
});