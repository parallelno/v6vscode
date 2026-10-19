import * as assert from 'assert';
import { EventEmitter } from 'events';
import { PerformanceService } from '../../../src/debug/performance/performance-service';
import { MemoryEditService } from '../../../src/debug/memory-edits/memory-edit-service';
import { IpcCommand, GetServerInfoResponse, IpcResponse } from '../../../src/emulator/protocol/ipc-commands';
import { CommandTransport, SessionOperation, SessionOperations, SessionState } from '../../../src/emulator/session/session-operations';
import { ProtocolError } from '../../../src/emulator/protocol/protocol-result';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

class State extends EventEmitter implements SessionState {
    connected = true;
    running = false;
    serverInfo: GetServerInfoResponse = {
        protocolVersion: 2, emulatorVersion: 'test',
        commands: [IpcCommand.DEBUG_MEMORY_EDIT_ADD, IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL, IpcCommand.DEBUG_MEMORY_EDIT_DEL,
            IpcCommand.DEBUG_MEMORY_EDIT_GET, IpcCommand.DEBUG_MEMORY_EDIT_EXISTS, IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL,
            IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, IpcCommand.SET_BYTE_GLOBAL, IpcCommand.DEBUG_CODE_PERF_ADD,
            IpcCommand.DEBUG_CODE_PERF_DEL_ALL, IpcCommand.DEBUG_CODE_PERF_DEL, IpcCommand.DEBUG_CODE_PERF_GET,
            IpcCommand.DEBUG_CODE_PERF_EXISTS, IpcCommand.DEBUG_CODE_PERF_GET_ALL, IpcCommand.DEBUG_CODE_PERF_EDIT, IpcCommand.DEBUG_ATTACH],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            memoryEditSchema: 1, memoryEditLimits: { globalAddressExclusive: 0x210000, maxCommentBytes: 1024 },
            codePerfSchema: 1, codePerfServerAllocatedIds: true, codePerfEdit: true, codePerfMutationsWhileRunning: true,
            codePerfLimits: { addressExclusive: 0x10000, maxNameBytes: 1024, maxRecords: 256, maxTestCount: 20000 },
        },
    } as GetServerInfoResponse;
    replace() { this.connected = false; this.emit('stateChange'); this.serverInfo = { ...this.serverInfo }; this.connected = true; this.emit('stateChange'); }
}

class Transport implements CommandTransport {
    connectionEpoch = 1;
    connected = true;
    requests: IpcCommand[] = [];
    handler: (command: IpcCommand, data?: unknown) => Promise<IpcResponse<unknown>> = async () => ({ ok: true });
    async send<T>(command: IpcCommand, data?: unknown): Promise<IpcResponse<T>> {
        this.requests.push(command);
        return await this.handler(command, data) as IpcResponse<T>;
    }
}

for (const kind of ['performance', 'memory'] as const) {
    describe(`Session-scoped ${kind} service`, () => {
        const list = kind === 'performance' ? IpcCommand.DEBUG_CODE_PERF_GET_ALL : IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL;
        const add = kind === 'performance' ? IpcCommand.DEBUG_CODE_PERF_ADD : IpcCommand.DEBUG_MEMORY_EDIT_ADD;
        const empty = kind === 'performance' ? [] : { edits: [] };
        const input = { name: 'frame', addrStart: 1, addrEnd: 4, active: true };
        function fixture() {
            const state = new State(), transport = new Transport();
            const service = kind === 'performance' ? new PerformanceService(state, transport) : new MemoryEditService(state, transport);
            const mutate = () => service instanceof PerformanceService ? service.add(input) : service.apply(0x100, 42);
            return { state, transport, service, mutate };
        }

        it('rejects actions submitted before a session replacement, even when not yet executed', async () => {
            const { state, service, transport, mutate } = fixture();
            const rejected = assert.rejects(mutate(), /inactive connection/);
            state.replace();
            await rejected;
            assert.deepStrictEqual(transport.requests, []);
            service.dispose();
        });

        it('does not let old queued mutations or late responses affect a new session', async () => {
            const { state, service, transport, mutate } = fixture();
            const gate = deferred<IpcResponse<unknown>>(), entered = deferred<void>();
            transport.handler = async () => { entered.resolve(); return gate.promise; };
            const first = service.refresh();
            const oldRejected = assert.rejects(first, /inactive connection/);
            await entered.promise;
            const queued = assert.rejects(mutate(), /inactive connection/);
            state.replace();
            transport.handler = async command => { assert.strictEqual(command, list); return { ok: true, data: empty }; };
            assert.deepStrictEqual(await service.refresh(), []);
            gate.resolve({ ok: true, data: empty });
            await Promise.all([oldRejected, queued]);
            assert.deepStrictEqual(transport.requests, [list, list]);
            assert.deepStrictEqual(service.snapshot, []);
            service.dispose();
        });

        it('stops multi-command mutation/reconciliation at the first stale response', async () => {
            const { state, service, transport, mutate } = fixture();
            transport.handler = async command => {
                assert.strictEqual(command, add);
                state.replace();
                return { ok: true, data: { ...input, id: 1, averageClockCycles: 0, testCount: 0 } };
            };
            await assert.rejects(mutate(), /inactive connection/);
            assert.deepStrictEqual(transport.requests, [add]);
            service.dispose();
        });

        it('invalidates pending work on dispose and detaches listeners idempotently', async () => {
            const { state, service, transport } = fixture();
            const gate = deferred<IpcResponse<unknown>>(), entered = deferred<void>();
            transport.handler = async () => { entered.resolve(); return gate.promise; };
            const rejected = assert.rejects(service.refresh(), /disposed service/);
            await entered.promise;
            service.dispose(); service.dispose();
            assert.strictEqual(state.listenerCount('stateChange'), 0);
            gate.resolve({ ok: true, data: empty });
            await rejected;
            await assert.rejects(service.refresh(), /disposed service/);
        });

        it('coalesces refreshes and recovers the queue after a structured server error', async () => {
            const { service, transport, mutate } = fixture();
            transport.handler = async command => command === list ? { ok: true, data: empty }
                : { ok: false, code: 'invalid_request', error: 'translated', details: { field: 'collection', reason: 'capacity', id: 9 } };
            const first = service.refresh();
            assert.strictEqual(service.refresh(), first);
            await first;
            await assert.rejects(mutate(), (error: unknown) => error instanceof ProtocolError && error.command === add
                && error.code === 'invalid_request' && error.field === 'collection' && error.reason === 'capacity' && error.details?.id === 9);
            assert.deepStrictEqual(await service.refresh(), []);
            service.dispose();
        });

        it('preserves submission order between refresh and mutation', async () => {
            const { service, transport, mutate } = fixture();
            const gate = deferred<IpcResponse<unknown>>(), entered = deferred<void>();
            transport.handler = async command => {
                if (command === list) { entered.resolve(); return gate.promise; }
                return { ok: false, error: 'expected mutation failure' };
            };
            const refreshed = service.refresh();
            const mutation = assert.rejects(mutate(), /expected mutation failure/);
            await entered.promise;
            assert.deepStrictEqual(transport.requests, [list]);
            transport.handler = async command => command === list ? { ok: true, data: empty } : { ok: false, error: 'expected mutation failure' };
            gate.resolve({ ok: true, data: empty });
            await refreshed;
            await mutation;
            assert.strictEqual(transport.requests[1], add);
            service.dispose();
        });
        it('classifies malformed snapshots with the actual command and field path', async () => {
            const { service, transport } = fixture();
            transport.handler = async () => ({ ok: true, data: kind === 'performance'
                ? [{ ...input, id: 1, averageClockCycles: 0, testCount: -1 }]
                : { edits: [{ globalAddr: 1, enteredValue: 1, originalValue: 0, currentValue: 300, active: true, readonly: false, comment: '' }] } });
            await assert.rejects(service.refresh(), (error: unknown) => error instanceof ProtocolError
                && error.kind === 'malformed' && error.command === list && error.field === (kind === 'performance' ? '[0].testCount' : 'edits[0].currentValue'));
            service.dispose();
        });

        it('rejects malformed envelopes without publishing and leaves refresh usable', async () => {
            const { service, transport } = fixture();
            let changes = 0;
            service.on('change', () => changes++);
            transport.handler = async () => ({ ok: 'true', data: empty } as unknown as IpcResponse<unknown>);
            await assert.rejects(service.refresh(), (error: unknown) => error instanceof ProtocolError
                && error.kind === 'malformed' && error.command === list && error.field === 'ok');
            assert.strictEqual(changes, 0);
            transport.handler = async () => ({ ok: true, data: empty });
            assert.deepStrictEqual(await service.refresh(), []);
            assert.strictEqual(changes, 1);
            service.dispose();
            assert.strictEqual(service.available, false);
        });
    });
}

describe('Session operation identity', () => {
    it('detects transport reconnects even without a lifecycle state event', async () => {
        const state = new State(), transport = new Transport();
        let invalidations = 0;
        const operations = new SessionOperations<void>(state, transport, () => invalidations++);
        const scope = operations.capture();
        transport.connectionEpoch++;
        assert.throws(scope.assertCurrent, /inactive connection/);
        assert.strictEqual(invalidations, 1);
        await operations.enqueue(async next => { await next.send(IpcCommand.PING); });
        operations.dispose();
    });

    it('rejects a saved scope before a dependent command can run in the replacement session', async () => {
        const state = new State(), transport = new Transport();
        const operations = new SessionOperations<void>(state, transport, () => {});
        let saved: SessionOperation | undefined;
        await operations.enqueue(async scope => { saved = scope; });
        state.replace();
        await assert.rejects(saved!.send(IpcCommand.STOP), /inactive connection/);
        assert.deepStrictEqual(transport.requests, []);
        operations.dispose();
    });
});
