import * as assert from 'assert';
import { OperationScope, ScopedTaskQueue, SingleFlight } from '../../../src/platform/async/scoped-task-queue';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('Scoped queues and single-flight refresh', () => {
    it('serializes same-scope transactions and recovers after rejection', async () => {
        const queue = new ScopedTaskQueue();
        const scope: OperationScope = { key: {}, assertCurrent() {} };
        const gate = deferred();
        const calls: string[] = [];
        const first = queue.run(scope, async () => { calls.push('first'); await gate.promise; throw new Error('failed'); });
        const rejected = assert.rejects(first, /failed/);
        const second = queue.run(scope, async () => { calls.push('second'); return 42; });
        await Promise.resolve();
        assert.deepStrictEqual(calls, ['first']);
        gate.resolve();
        await rejected;
        assert.strictEqual(await second, 42);
        assert.deepStrictEqual(calls, ['first', 'second']);
    });

    it('checks validity before execution and after completion without blocking replacement scopes', async () => {
        const queue = new ScopedTaskQueue();
        let valid = true;
        const old: OperationScope = { key: {}, assertCurrent() { if (!valid) { throw new Error('stale'); } } };
        const gate = deferred();
        const first = queue.run(old, async () => { await gate.promise; return 1; });
        const rejected = assert.rejects(first, /stale/);
        let executed = false;
        const queued = assert.rejects(queue.run(old, async () => { executed = true; }), /stale/);
        await Promise.resolve();
        valid = false;
        assert.strictEqual(await queue.run({ key: {}, assertCurrent() {} }, async () => 2), 2);
        gate.resolve();
        await Promise.all([rejected, queued]);
        assert.strictEqual(executed, false);
    });

    it('coalesces by key, releases failed work, and keeps replacement refreshes separate', async () => {
        const flight = new SingleFlight<number>();
        const old = {}, next = {}, gate = deferred();
        let calls = 0;
        const first = flight.run(old, async () => { calls++; await gate.promise; throw new Error('failed'); });
        assert.strictEqual(flight.run(old, async () => 99), first);
        const rejected = assert.rejects(first, /failed/);
        assert.strictEqual(await flight.run(next, async () => 2), 2);
        gate.resolve();
        await rejected;
        assert.strictEqual(await flight.run(old, async () => { calls++; return 3; }), 3);
        assert.strictEqual(calls, 2);
    });
});
