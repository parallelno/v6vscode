import * as assert from 'assert';
import { expectArray, expectBoolean, expectFields, expectInteger, expectRecord, expectUtf8String, ValidationError } from '../../../src/shared/validation';
import { decodeProtocolData, diagnosticField, ProtocolError, requireProtocolOk } from '../../../src/emulator/protocol/protocol-result';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { validateMemoryEditInput, decodeMemoryEditList } from '../../../src/debug/memory-edits/memory-edit-codec';
import { validateCodePerfInput, decodeCodePerfSnapshots } from '../../../src/debug/performance/performance-codec';

function failure(action: () => unknown): unknown { try { action(); } catch (error) { return error; } throw new Error('Expected failure'); }

describe('Shared validation and protocol results', () => {
    it('validates primitive types and UTF-8 bytes without coercing values', () => {
        for (const value of [NaN, Infinity, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
            assert.throws(() => expectInteger(value, 'count', 0, 255), ValidationError);
        }
        assert.strictEqual(expectInteger(255, 'count', 0, 255), 255);
        assert.strictEqual(expectUtf8String('é', 'name', 2), 'é');
        assert.throws(() => expectUtf8String('é', 'name', 1), ValidationError);
        assert.throws(() => expectBoolean(1, 'active'), ValidationError);
        assert.throws(() => expectRecord([], 'input'), ValidationError);
        assert.throws(() => expectArray([1, 2], 'entries', 1), ValidationError);
        const inherited = Object.create({ name: 'inherited' });
        assert.throws(() => expectFields(inherited, new Set(['name']), 'input'), /Missing/);
        assert.throws(() => expectFields({ unexpected: 1 }, new Set(), 'input'), /Unknown/);
        assert.throws(() => expectFields({ '': 1 }, new Set(), 'input'), /Unknown/);
        assert.throws(() => expectFields({}, new Set(['']), 'input'), /Missing/);
    });

    it('preserves remote command/code/details and never promises safe automatic replay', () => {
        const response = { ok: false, code: 'invalid_request', error: 'localized server text', details: { field: 'addrEnd', reason: 'range', id: 7 } };
        const error = failure(() => requireProtocolOk(IpcCommand.DEBUG_CODE_PERF_EDIT, response, 'fallback'));
        assert.ok(error instanceof ProtocolError);
        assert.strictEqual(error.kind, 'remote');
        assert.strictEqual(error.command, IpcCommand.DEBUG_CODE_PERF_EDIT);
        assert.strictEqual(error.code, 'invalid_request');
        assert.strictEqual(diagnosticField(error), 'addrEnd');
        assert.strictEqual(error.reason, 'range');
        assert.strictEqual(error.details?.id, 7);
        assert.strictEqual(error.retryable, false);
        response.details.field = 'changed';
        assert.strictEqual(error.field, 'addrEnd');
    });

    it('distinguishes malformed wire data from invalid user input with field paths and causes', () => {
        const input = { name: 'frame', addrStart: 1, addrEnd: 4, active: true };
        const invalidInput = failure(() => validateCodePerfInput({ ...input, addrEnd: -1 }));
        assert.ok(invalidInput instanceof ValidationError);
        const error = failure(() => decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_GET_ALL,
            { ok: true, data: [{ ...input, id: 1, averageClockCycles: 0, testCount: -1 }] }, 'list failed', decodeCodePerfSnapshots));
        assert.ok(error instanceof ProtocolError);
        assert.strictEqual(error.kind, 'malformed');
        assert.strictEqual(error.field, '[0].testCount');
        assert.ok(error.cause instanceof ValidationError);
        for (const response of [null, {}, { ok: 'yes' }, { ok: true, code: 3 }, { ok: false, details: [] }]) {
            assert.throws(() => requireProtocolOk(IpcCommand.PING, response, 'bad envelope'), ProtocolError);
        }
        assert.throws(() => decodeProtocolData(IpcCommand.PING, { ok: true }, 'missing data', x => x), ProtocolError);
        assert.strictEqual(requireProtocolOk(IpcCommand.STOP, { ok: true }, 'stop').ok, true);
    });

    it('uses the same bounded-number and UTF-8 contracts in both feature codecs', () => {
        const memory = { globalAddr: 1, enteredValue: 2, readonly: false, active: true, comment: '' };
        const performance = { name: '', addrStart: 1, addrEnd: 4, active: true };
        for (const bad of [NaN, 0.5, -1, '1', undefined]) {
            assert.ok(failure(() => validateMemoryEditInput({ ...memory, enteredValue: bad })) instanceof ValidationError);
            assert.ok(failure(() => validateCodePerfInput({ ...performance, addrStart: bad })) instanceof ValidationError);
        }
        assert.throws(() => validateMemoryEditInput({ ...memory, unknown: true }), /Unknown/);
        const error = failure(() => decodeProtocolData(IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL,
            { ok: true, data: { edits: [{ ...memory, originalValue: 1, currentValue: 256 }] } }, 'bad edits', decodeMemoryEditList));
        assert.ok(error instanceof ProtocolError);
        assert.strictEqual(error.field, 'edits[0].currentValue');
    });
});
