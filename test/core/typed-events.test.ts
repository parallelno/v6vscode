import * as assert from 'assert';
import { describe, it } from 'mocha';
import { EventEmitter } from 'events';
import { IpcClient, IpcClientEvents } from '../../src/emulator/client/ipc-client';
import { SessionEvents } from '../../src/emulator/session/session-coordinator';
import { PerformanceEvents } from '../../src/debug/performance/performance-service';
import { MemoryEditEvents } from '../../src/debug/memory-edits/memory-edit-service';
import { parseExpression } from '../../src/debug/expressions/expression-syntax';

describe('Core contracts without VS Code runtime or mock', () => {
    it('delivers typed snapshot/state/disconnect events with removable listeners', () => {
        const events = new EventEmitter<SessionEvents & PerformanceEvents & MemoryEditEvents & IpcClientEvents>();
        let states = 0;
        const changed = (state: SessionEvents['stateChange'][0]) => { assert.strictEqual(state, 'running'); states++; };
        events.on('stateChange', changed); events.emit('stateChange', 'running'); events.removeListener('stateChange', changed);
        assert.strictEqual(states, 1); assert.strictEqual(events.listenerCount('stateChange'), 0);
        if (false) {
            // @ts-expect-error invalid event names are not part of the session contract
            events.emit('inventedEvent');
            // @ts-expect-error state payload cannot silently change shape
            events.emit('stateChange', 42);
        }
    });
    it('constructs/disposes transport through a structural logger and parses without host APIs', () => {
        const client = new IpcClient({ debug() {}, error() {} });
        assert.strictEqual(client.connected, false); client.disconnect(); client.disconnect();
        assert.strictEqual(parseExpression('1 + 2', 'address').kind, 'binary');
    });
});