import * as assert from 'assert';
import { ValueEvaluationService, ValueEvaluationContext } from '../../../src/debug/values/value-evaluation-service';
import { ValueReader } from '../../../src/debug/values/value-reader';
import { format, scalarValue, TypedValue } from '../../../src/debug/values/value-format';
import { dapVariableValue } from '../../../src/debug/adapter/dap-value-presenter';
import { DebugMetadataIndex } from '../../../src/debug/metadata/debug-metadata-index';
import { DebugStopContext } from '../../../src/debug/metadata/debug-stop-context';
import { TypeInfo } from '../../../src/debug/metadata/dwarf-types';
import { VariableNode } from '../../../src/debug/metadata/dwarf-scopes';
import { DWARF_REG } from '../../../src/debug/metadata/v6c-register-map';
import { STT_FUNC } from '../../../src/debug/metadata/elf32-reader';

const signed: TypeInfo = { id: 1, name: 'int', byteSize: 2, kind: 'base', signed: true, encoding: 'signed' };

describe('Typed value application API', () => {
    const service = new ValueEvaluationService();

    it('returns domain values consistently for all presenters without DAP handles or envelopes', async () => {
        const context: ValueEvaluationContext = { variables: [], registers: { [DWARF_REG.HL]: 0x1234 } };
        const result = await service.evaluate('HL', context);
        assert.strictEqual(format(result.value), '0x1234');
        assert.strictEqual(dapVariableValue(result.value).value, format(result.value));
        assert.ok(!('variablesReference' in result));
        assert.ok(!('result' in result));
        assert.ok(!('variablesReference' in result.value));
        const comparison = await service.evaluate('(int)65535 < 0', { variables: [] });
        assert.strictEqual(format(comparison.value), '1');
    });

    it('resolves typed variables before register aliases or ELF symbol fallback', async () => {
        class ConstantReader extends ValueReader {
            override async evaluate(_metadata: DebugMetadataIndex, _context: DebugStopContext,
                _frame: Parameters<ValueReader['evaluate']>[2], variable: VariableNode) {
                return { variable, value: scalarValue(-1, signed) };
            }
        }
        const values = new ValueEvaluationService(new ConstantReader());
        const context: ValueEvaluationContext = {
            variables: [{ id: 1, name: 'A', kind: 'local', typeOffset: 1 }],
            metadata: { resolveAbstractOrigin: (variable: VariableNode) => variable, typeOf: () => signed } as unknown as DebugMetadataIndex,
            memory: {} as DebugStopContext,
            frame: { index: 0, pc: 0x100, sp: 0x7000, registers: { [DWARF_REG.A]: 42 } },
            symbols: { symbols: () => [{ name: 'A', address: 99, size: 1, type: 0, binding: 0, absolute: true }] },
        };
        assert.strictEqual(format((await values.evaluate('A', context)).value), '-1');
    });

    it('keeps ELF constants/function addresses distinct from unreadable memory labels', async () => {
        const symbols: NonNullable<ValueEvaluationContext['symbols']> = {
            symbols: name => [{ name, address: name === 'Record.ptr' ? 1 : 0x1234, size: 2,
                type: name === 'function_name' ? STT_FUNC : 0, binding: 0, absolute: name === 'Record.ptr' }],
        };
        assert.strictEqual(format((await service.evaluate('Record.ptr + 2', { variables: [], symbols })).value), '3');
        assert.strictEqual(format((await service.evaluate('function_name', { variables: [], symbols })).value), '0x1234');
        await assert.rejects(service.evaluate('raw_label', { variables: [], symbols }), /unreadable/);
    });

    it('rejects a stale context before resolving and after a delayed value read', async () => {
        let valid = true;
        let finish!: (value: TypedValue) => void;
        class DelayedReader extends ValueReader {
            override async readAt(): Promise<TypedValue> { return new Promise(resolve => { finish = resolve; }); }
        }
        const values = new ValueEvaluationService(new DelayedReader());
        const context: ValueEvaluationContext = {
            variables: [], memory: {} as DebugStopContext,
            symbols: { symbols: name => [{ name, address: 0x100, size: 2, type: 0, binding: 0 }] },
            assertCurrent: () => { if (!valid) { throw new Error('stale stop'); } },
        };
        const pending = assert.rejects(values.evaluate('label', context), /stale stop/);
        valid = false;
        finish(scalarValue(42, signed));
        await pending;
        await assert.rejects(values.evaluate('1', context), /stale stop/);
    });

    it('enumerates bounded aggregate children as named domain values', async () => {
        class BytesReader extends ValueReader {
            override async readAt(_context: DebugStopContext, type: TypeInfo | undefined, address: number) {
                return { ...scalarValue(address, type), address };
            }
        }
        const reader = new BytesReader();
        const type: TypeInfo = { id: 2, name: 'int[]', kind: 'array', signed: false, byteSize: 400, count: 200, of: signed };
        const children = await reader.childValues({} as DebugStopContext, { type, address: 0x100, availability: 'available' }, 1, 500);
        assert.strictEqual(children.length, 100);
        assert.strictEqual(children[0].name, '[1]');
        assert.strictEqual(children[0].value.address, 0x102);
        assert.ok(!('variablesReference' in children[0]));
    });
});