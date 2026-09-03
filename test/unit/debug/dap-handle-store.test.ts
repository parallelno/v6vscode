import * as assert from 'assert';
import { DapHandleStore } from '../../../src/debug/adapter/dap-handle-store';

describe('DapHandleStore', () => {
    it('allocates handles within a stopped generation', () => {
        const handles = new DapHandleStore<string>();

        const first = handles.create(1, 'scope');
        const second = handles.create(1, 'variable');

        assert.notStrictEqual(first, second);
        assert.strictEqual(handles.get(1, first), 'scope');
        assert.strictEqual(handles.get(1, second), 'variable');
    });

    it('rejects handles outside their stopped generation', () => {
        const handles = new DapHandleStore<string>();
        handles.set(1, 1001, 'frame');

        assert.strictEqual(handles.get(1, 1001), 'frame');
        assert.strictEqual(handles.get(2, 1001), undefined);

        handles.reset(2);
        assert.strictEqual(handles.get(1, 1001), undefined);
    });
});