import * as assert from 'assert';
import { StepBreakpointStore } from '../../../src/debug/adapter/step-breakpoint-store';

describe('StepBreakpointStore', () => {
    it('reference-counts temporary ownership and does not replace a user breakpoint', async () => {
        const added: number[] = [];
        const removed: number[] = [];
        const store = new StepBreakpointStore({
            add: async address => { added.push(address); return true; },
            remove: async address => { removed.push(address); },
        });

        store.setUserOwned(0x1234, true);
        assert.strictEqual(await store.acquire(0x1234), true);
        assert.strictEqual(await store.acquire(0x1234), true);
        await store.release(0x1234);
        await store.release(0x1234);

        assert.deepStrictEqual(added, []);
        assert.deepStrictEqual(removed, []);
        assert.strictEqual(store.isTemporary(0x1234), false);
        assert.strictEqual(store.isUserOwned(0x1234), true);
    });

    it('removes an unshared temporary breakpoint once and clears all active ownership', async () => {
        const removed: number[] = [];
        const store = new StepBreakpointStore({ add: async () => true, remove: async address => { removed.push(address); } });

        await store.acquire(0x100);
        await store.acquire(0x200);
        await store.clear();

        assert.deepStrictEqual(removed.sort((left, right) => left - right), [0x100, 0x200]);
        assert.strictEqual(store.isTemporary(0x100), false);
    });

    it('does not retain a reference when backend installation fails', async () => {
        const store = new StepBreakpointStore({ add: async () => false, remove: async () => {} });
        assert.strictEqual(await store.acquire(0x1234), false);
        assert.strictEqual(store.isTemporary(0x1234), false);
    });

    it('reinstalls a temporary breakpoint after shared user ownership is removed', async () => {
        const added: number[] = [];
        const store = new StepBreakpointStore({
            add: async address => { added.push(address); return true; },
            remove: async () => {},
        });

        store.setUserOwned(0x1234, true);
        assert.strictEqual(await store.acquire(0x1234), true);
        store.setUserOwned(0x1234, false);

        assert.strictEqual(await store.restoreTemporary(0x1234), true);
        assert.deepStrictEqual(added, [0x1234]);
    });
});