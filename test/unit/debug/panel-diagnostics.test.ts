import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { PerformancePanel } from '../../../src/debug/views/performance-panel';
import { MemoryEditsPanel } from '../../../src/debug/views/memory-edits-panel';
import { ProtocolError } from '../../../src/emulator/protocol/protocol-result';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { ValidationError } from '../../../src/shared/validation';

// Host adapter test: exercise real posting/projection, not implementation source text.
describe('Panel diagnostic projection', () => {
    function setup(kind: 'performance' | 'memory') {
        const lifecycle = Object.assign(new EventEmitter(), { connected: true });
        const service = Object.assign(new EventEmitter(), { available: true, sessionGeneration: 0, snapshot: [] });
        const messages: any[] = [];
        const uri = vscode.Uri.file('C:\\extension');
        const logger = { error() {}, warn() {} };
        const panel: any = kind === 'performance'
            ? new PerformancePanel(uri, lifecycle as any, service as any, {} as any, {} as any, {} as any, logger as any)
            : new MemoryEditsPanel(uri, lifecycle as any, service as any, {} as any, {} as any, logger as any);
        panel.host.panel = { webview: { postMessage: (message: unknown) => { messages.push(message); } } };
        panel.host.ready = true;
        return { panel, messages, lifecycle, service };
    }

    for (const kind of ['performance', 'memory'] as const) {
        it(`carries command/code/field/reason through ${kind} messages independently of error wording`, () => {
            const { panel, messages, lifecycle, service } = setup(kind);
            panel.report('edit', new ProtocolError(IpcCommand.DEBUG_CODE_PERF_EDIT, 'localized wording with no field prefix',
                'remote', 'invalid_request', { field: 'addrEnd', reason: 'range' }));
            const operation = messages.find(message => message.type === 'operation');
            assert.deepStrictEqual(operation.diagnostic, { kind: 'remote', command: IpcCommand.DEBUG_CODE_PERF_EDIT,
                code: 'invalid_request', field: 'addrEnd', reason: 'range' });
            if (kind === 'performance') { assert.strictEqual(operation.field, 'addrEnd'); }
            panel.host.panel = undefined;
            panel.dispose();
            assert.strictEqual(lifecycle.listenerCount('stateChange'), 0);
            assert.strictEqual(service.listenerCount('change'), 0);
        });
    }

    it('preserves a user expression field and cause instead of inferring it from prose', () => {
        const { panel, messages } = setup('performance');
        let failure: unknown;
        try { panel.resolveAddress('unknown +', 'Start address'); } catch (error) { failure = error; }
        assert.ok(failure instanceof ValidationError);
        assert.strictEqual(failure.field, 'addrStart');
        assert.ok(failure.cause instanceof Error);
        panel.report('add', failure);
        assert.strictEqual(messages[0].field, 'addrStart');
        assert.strictEqual(messages[0].diagnostic.kind, 'input');
        panel.host.panel = undefined;
        panel.dispose();
    });
    for (const kind of ['performance', 'memory'] as const) {
        for (const failure of [false, true]) {
            it(`drops stale ${failure ? 'failure' : 'success'} publication for ${kind} after session replacement`, async () => {
                const { panel, service, messages } = setup(kind);
                let finish!: () => void;
                const gate = new Promise<void>(resolve => { finish = resolve; });
                const pending = panel.runOperation('edit', async () => {
                    await gate;
                    if (failure) { throw new Error('old-session error'); }
                });
                service.sessionGeneration++;
                messages.length = 0;
                finish();
                await pending;
                assert.deepStrictEqual(messages, []);
                panel.host.panel = undefined;
                panel.dispose();
            });
        }

        it(`does not let a delayed ${kind} confirmation submit against a replacement session`, async () => {
            const { panel, service } = setup(kind);
            const window = vscode.window as any;
            const original = window.showWarningMessage;
            let confirm!: (value: string) => void;
            let mutations = 0;
            window.showWarningMessage = () => new Promise<string>(resolve => { confirm = resolve; });
            (service as any).deleteAll = async () => { mutations++; };
            try {
                const pending = panel.deleteAll();
                service.sessionGeneration++;
                confirm('Delete All');
                await pending;
                assert.strictEqual(mutations, 0);
            } finally {
                window.showWarningMessage = original;
                panel.host.panel = undefined;
                panel.dispose();
            }
        });

        it(`drops late ${kind} completion after its panel is replaced or disposed`, async () => {
            const { panel, messages } = setup(kind);
            let finish!: () => void;
            const gate = new Promise<void>(resolve => { finish = resolve; });
            const pending = panel.runOperation('refresh', async () => gate);
            panel.host.panel = undefined;
            panel.dispose(); panel.dispose();
            messages.length = 0;
            finish();
            await pending;
            assert.deepStrictEqual(messages, []);
        });
    }

    for (const operation of ['add', 'edit'] as const) {
        it(`does not attach old ${operation} address expressions to replacement-session performance IDs`, async () => {
            const { panel, service } = setup('performance');
            let finish!: (value: unknown) => void;
            (service as any)[operation] = () => new Promise(resolve => { finish = resolve; });
            const input = { name: 'old', addrStart: 1, addrEnd: 4, active: true };
            const pending = panel.handleMessage({ type: operation, id: 7, generation: 0, input });
            service.sessionGeneration++;
            const entry = { id: 7, ...input, averageClockCycles: 0, testCount: 0 };
            finish(entry);
            await pending;
            assert.strictEqual(panel.addressExpressions.decorate([entry], 1)[0].addrStart, '0x0001');
            panel.host.panel = undefined;
            panel.dispose();
        });
    }
});
