import * as assert from 'assert';
import * as vscode from 'vscode';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('V6DebugAdapter', () => {
    it('formats byte and word register evaluations at their native widths', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).cachedRegs = {
            af: 0x1002, bc: 0, de: 0, hl: 0x0100, sp: 0, pc: 0, m: 0,
        };
        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));

        await sendRequest(adapter, { seq: 1, command: 'evaluate', arguments: { expression: 'A' } });
        await sendRequest(adapter, { seq: 2, command: 'evaluate', arguments: { expression: 'HL' } });

        assert.strictEqual(responses[0].body.result, '0x10');
        assert.strictEqual(responses[1].body.result, '0x0100');
    });

    it('evaluates Watch and Debug Console expressions against the selected C frame', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).stoppedGeneration = 1;
        (adapter as any).debugMetadata = {
            variablesAt: () => [{ id: 1, name: 'count', kind: 'local', typeOffset: 1 }],
            scopes: { variables: [] },
            resolveAbstractOrigin: (variable: unknown) => variable,
            typeOf: () => ({ name: 'int', byteSize: 2, signed: true }),
            evaluateVariable: () => ({ kind: 'value', value: 3 }),
        };
        (adapter as any).stopContext = { evalContext: () => ({}) };
        (adapter as any).stackTraceService.frame = () => ({
            name: 'caller', instructionPc: 0x1000, physicalFrame: { pc: 0x1000, registers: { 0: 2 } },
        });
        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));

        await sendRequest(adapter, { seq: 1, command: 'evaluate', arguments: { expression: 'count + A', frameId: 100, context: 'watch' } });
        await sendRequest(adapter, { seq: 2, command: 'evaluate', arguments: { expression: 'count + A', frameId: 100, context: 'repl' } });

        assert.strictEqual(responses[0].body.result, '5');
        assert.strictEqual(responses[1].body.result, '5');
    });

    it('bounds hover evaluation latency', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).cExpressionService = {
            evaluateValue: () => new Promise(() => {}),
        };
        const started = Date.now();

        await assert.rejects(
            () => (adapter as any).evaluateExpression('hover', 'value', {}),
            /Hover evaluation timed out/,
        );

        assert.ok(Date.now() - started < 250);
    });

    it('keeps machine-state scopes without exposing a source for an unmapped CPU frame', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).cachedRegs = { pc: 0x000B };

        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));

        await sendRequest(adapter, { seq: 1, command: 'stackTrace', arguments: { threadId: 1 } });
        const frame = responses[0].body.stackFrames[0];
        assert.strictEqual(frame.source, undefined);
        assert.strictEqual(frame.line, 1);
        assert.strictEqual(frame.column, 1);

        await sendRequest(adapter, { seq: 2, command: 'scopes', arguments: { frameId: frame.id } });
        assert.deepStrictEqual(
            responses[1].body.scopes.map((scope: any) => scope.name),
            ['Registers', 'Flags', 'Raw Stack'],
        );
    });

    it('rejects machine scope handles after the stopped generation changes', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).cachedRegs = { af: 0, bc: 0, de: 0, hl: 0, sp: 0, pc: 0, m: 0 };
        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));

        await sendRequest(adapter, { seq: 1, command: 'scopes', arguments: { frameId: 1 } });
        const registersReference = responses[0].body.scopes[0].variablesReference;
        (adapter as any).invalidateStopContext();
        await sendRequest(adapter, { seq: 2, command: 'variables', arguments: { variablesReference: registersReference } });

        assert.deepStrictEqual(responses[1].body.variables, []);
    });

    it('keeps the last source location when debug metadata cannot resolve the current address', async () => {
        const adapter = new V6DebugAdapter(
            {} as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        (adapter as any).workspaceRoot = 'C:\\project';
        (adapter as any).debugIndex = {
            resolveAddress: (address: number) => address === 0x0100
                ? { file: 'src\\main.asm', line: 12, column: 3 }
                : undefined,
            symbolAtAddress: () => undefined,
        };
        (adapter as any).showUnavailableSourceIndicator = () => {};
        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));

        (adapter as any).cachedRegs = { pc: 0x0100 };
        await sendRequest(adapter, { seq: 1, command: 'stackTrace', arguments: { threadId: 1 } });
        (adapter as any).cachedRegs = { pc: 0x0101 };
        await sendRequest(adapter, { seq: 2, command: 'stackTrace', arguments: { threadId: 1 } });

        const frame = responses[1].body.stackFrames[0];
        assert.deepStrictEqual(frame.source, {
            path: 'C:\\project\\src\\main.asm',
            name: 'main.asm',
            sourceReference: 0,
        });
        assert.strictEqual(frame.line, 12);
        assert.strictEqual(frame.column, 3);
    });

    it('steps over by adding an auto-delete breakpoint at the backend address', async () => {
        const adapter = new V6DebugAdapter(
            { setExecutionRunning() {} } as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        const calls: Array<{ command: IpcCommand; data: unknown }> = [];
        (adapter as any).client = {
            send: async (command: IpcCommand, data: unknown) => {
                calls.push({ command, data });
                return command === IpcCommand.GET_STEP_OVER_ADDR
                    ? { ok: true, data: { data: 0x1234 } }
                    : { ok: true };
            },
        };
        (adapter as any).stopRecordsSupported = false;
        (adapter as any).startPoll = () => {};

        await (adapter as any).onNext({ seq: 1, command: 'next' });

        assert.deepStrictEqual(calls, [
            { command: IpcCommand.GET_STEP_OVER_ADDR, data: undefined },
            {
                command: IpcCommand.DEBUG_BREAKPOINT_ADD,
                data: {
                    addr: 0x1234,
                    memPages: 8589934591,
                    status: 'ACTIVE',
                    autoDelete: true,
                    operand: 'A',
                    condition: 'ANY',
                    value: 0,
                    comment: '__dap_next',
                },
            },
            { command: IpcCommand.DEBUG_BREAKPOINT_GET_ALL, data: undefined },
            { command: IpcCommand.RUN, data: undefined },
        ]);
    });

    it('uses bounded instruction progression for statement-granularity Step Into', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: Array<{ command: IpcCommand; data: any }> = [];
        (adapter as any).client.send = async (command: IpcCommand, data: any) => {
            calls.push({ command, data });
            return command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL ? { ok: true, data: [] } : { ok: true };
        };
        (adapter as any).startPoll = () => {};

        await (adapter as any).onStepIn({ seq: 1, command: 'stepIn', arguments: { granularity: 'statement' } });

        assert.ok(calls.some(call => call.command === IpcCommand.EXECUTE_INSTR));
        assert.strictEqual(calls.some(call => call.command === IpcCommand.DEBUG_BREAKPOINT_ADD), false);
    });

    it('keeps instruction-granularity Step Into as one backend instruction', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: IpcCommand[] = [];
        (adapter as any).client.send = async (command: IpcCommand) => {
            calls.push(command);
            return command === IpcCommand.EXECUTE_INSTR ? { ok: true } : { ok: true, data: [] };
        };

        await (adapter as any).onStepIn({ seq: 1, command: 'stepIn', arguments: { granularity: 'instruction' } });

        assert.ok(calls.includes(IpcCommand.EXECUTE_INSTR));
        assert.strictEqual(calls.includes(IpcCommand.DEBUG_BREAKPOINT_ADD), false);
    });

    it('uses a bounded instruction fallback when no source-step candidate exists', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: IpcCommand[] = [];
        (adapter as any).debugIndex = { statementRows: [
            { address: 0x100, file: 'main.c', line: 10, column: 1, isStmt: true },
        ] };
        (adapter as any).client.send = async (command: IpcCommand) => {
            calls.push(command);
            return command === IpcCommand.GET_REGS
                ? { ok: true, data: { pc: 0x101 } }
                : { ok: true, data: [] };
        };

        await (adapter as any).onStepIn({ seq: 1, command: 'stepIn', arguments: { granularity: 'statement' } });

        assert.ok(calls.includes(IpcCommand.EXECUTE_INSTR));
        assert.strictEqual(calls.includes(IpcCommand.RUN), false);
    });

    it('filters matching source Step Over targets', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: Array<{ command: IpcCommand; data: any }> = [];
        const originalConfiguration = vscode.workspace.getConfiguration;
        (adapter as any).debugIndex = { statementRows: [
            { address: 0x100, file: 'main.c', line: 10, column: 1, isStmt: true },
            { address: 0x101, file: 'runtime/support.c', line: 11, column: 1, isStmt: true },
            { address: 0x102, file: 'main.c', line: 12, column: 1, isStmt: true },
        ] };
        (adapter as any).client.send = async (command: IpcCommand, data: any) => {
            calls.push({ command, data });
            return command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL ? { ok: true, data: [] } : { ok: true };
        };
        (adapter as any).startPoll = () => {};
        (vscode.workspace as any).getConfiguration = () => ({
            get: (key: string, defaultValue: unknown) => key === 'sourceStepFilters' ? ['runtime/**'] : defaultValue,
        });

        try {
            await (adapter as any).onNext({ seq: 1, command: 'next', arguments: { granularity: 'statement' } });
        } finally {
            (vscode.workspace as any).getConfiguration = originalConfiguration;
        }

        assert.strictEqual(calls[0].command, IpcCommand.DEBUG_BREAKPOINT_ADD);
        assert.strictEqual(calls[0].data.addr, 0x102);
    });

    it('uses only a verified caller return PC for physical Step Out', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: Array<{ command: IpcCommand; data: any }> = [];
        (adapter as any).stackTraceService.frame = () => ({ physicalFrame: { returnPc: 0x2222 } });
        (adapter as any).client.send = async (command: IpcCommand, data: any) => {
            calls.push({ command, data });
            return command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL ? { ok: true, data: [] } : { ok: true };
        };
        (adapter as any).startPoll = () => {};

        await (adapter as any).onStepOut({ seq: 1, command: 'stepOut', arguments: { frameId: 1 } });

        assert.strictEqual(calls[0].command, IpcCommand.DEBUG_BREAKPOINT_ADD);
        assert.strictEqual(calls[0].data.addr, 0x2222);
    });

    it('uses a containing-frame statement for inline Step Out', async () => {
        const adapter = makeSourceStepAdapter();
        const calls: Array<{ command: IpcCommand; data: any }> = [];
        (adapter as any).debugIndex = { statementRows: [
            { address: 0x100, file: 'main.c', line: 10, column: 1, isStmt: true },
            { address: 0x101, file: 'main.c', line: 11, column: 1, isStmt: true },
        ] };
        (adapter as any).debugMetadata = {
            subprogramAt: () => ({ ranges: [{ start: 0x100, end: 0x200 }] }),
            inlineChainAt: (address: number) => address === 0x100 ? [{ id: 7 }] : [],
        };
        (adapter as any).stackTraceService.frame = () => ({
            inlineDieIdentity: 7,
            instructionPc: 0x100,
            physicalFrame: { index: 0 },
        });
        (adapter as any).client.send = async (command: IpcCommand, data: any) => {
            calls.push({ command, data });
            return command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL ? { ok: true, data: [] } : { ok: true };
        };
        (adapter as any).startPoll = () => {};

        await (adapter as any).onStepOut({ seq: 1, command: 'stepOut', arguments: { frameId: 1 } });

        assert.strictEqual(calls[0].command, IpcCommand.DEBUG_BREAKPOINT_ADD);
        assert.strictEqual(calls[0].data.addr, 0x101);
    });

    it('publishes server-only breakpoints when execution resumes', async () => {
        const adapter = new V6DebugAdapter(
            { setExecutionRunning() {} } as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        const messages: any[] = [];
        adapter.onDidSendMessage(message => messages.push(message));
        (adapter as any).workspaceRoot = 'C:\\project';
        (adapter as any).debugIndex = {
            resolveAddress: () => ({ file: 'src\\main.asm', line: 58, column: 1 }),
        };
        (adapter as any).client = {
            send: async (command: IpcCommand) => {
                if (command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL) {
                    return {
                        ok: true,
                        data: [{
                            addr: 0x1234,
                            memPages: 8589934591,
                            status: 'ACTIVE',
                            autoDelete: true,
                            operand: 'A',
                            condition: 'ANY',
                            value: 0,
                            comment: '__dap_next',
                        }],
                    };
                }
                return { ok: true };
            },
        };
        (adapter as any).stopRecordsSupported = false;
        (adapter as any).startPoll = () => {};

        await (adapter as any).run();

        assert.deepStrictEqual(messages[0], {
            type: 'event',
            event: 'breakpoint',
            body: {
                reason: 'new',
                breakpoint: {
                    id: 1,
                    verified: true,
                    instructionReference: '0x1234',
                    message: '__dap_next',
                    source: { name: 'main.asm', path: 'C:\\project\\src\\main.asm', sourceReference: 0 },
                    line: 58,
                    column: 1,
                },
            },
        });
    });

    it('keeps a temporary step-over breakpoint after a manual pause', async () => {
        const adapter = new V6DebugAdapter(
            { setExecutionRunning() {} } as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        const calls: IpcCommand[] = [];
        (adapter as any).pendingStepOverAddr = 0x1234;
        (adapter as any).client = {
            send: async (command: IpcCommand) => {
                calls.push(command);
                if (command === IpcCommand.DEBUG_BREAKPOINT_GET_ALL) {
                    return { ok: true, data: [] };
                }
                return { ok: true };
            },
        };

        await (adapter as any).onStop({ reason: 'pause', pc: 0x1200 });

        assert.strictEqual((adapter as any).pendingStepOverAddr, 0x1234);
        assert.strictEqual(calls.includes(IpcCommand.DEBUG_BREAKPOINT_DEL), false);
    });

    it('does not execute when the temporary step-over breakpoint is rejected', async () => {
        const adapter = new V6DebugAdapter(
            { setExecutionRunning() {} } as any,
            {} as any,
            { debug() {}, error() {} } as any,
            {} as any,
            () => ({} as any),
        );
        const calls: IpcCommand[] = [];
        const responses: any[] = [];
        adapter.onDidSendMessage(message => responses.push(message));
        (adapter as any).client = {
            send: async (command: IpcCommand) => {
                calls.push(command);
                return command === IpcCommand.GET_STEP_OVER_ADDR
                    ? { ok: true, data: { data: 0x1234 } }
                    : { ok: false, error: 'Breakpoint rejected' };
            },
        };

        await (adapter as any).onNext({ seq: 1, command: 'next' });

        assert.deepStrictEqual(calls, [
            IpcCommand.GET_STEP_OVER_ADDR,
            IpcCommand.DEBUG_BREAKPOINT_ADD,
        ]);
        assert.strictEqual(responses[0].success, false);
        assert.strictEqual(responses[0].message, 'Breakpoint rejected');
    });
});

function makeSourceStepAdapter(): V6DebugAdapter {
    const adapter = new V6DebugAdapter(
        { setExecutionRunning() {} } as any,
        {} as any,
        { debug() {}, error() {} } as any,
        {} as any,
        () => ({} as any),
    );
    (adapter as any).cachedRegs = { pc: 0x100 };
    (adapter as any).debugIndex = {
        statementRows: [
            { address: 0x100, file: 'main.c', line: 1, column: 1, isStmt: true },
            { address: 0x101, file: 'main.c', line: 2, column: 1, isStmt: true },
        ],
    };
    (adapter as any).debugMetadata = {
        subprogramAt: () => ({ ranges: [{ start: 0x100, end: 0x200 }] }),
        inlineChainAt: () => [],
    };
    (adapter as any).client = { send: async () => ({ ok: true, data: [] }) };
    (adapter as any).stopRecordsSupported = false;
    return adapter;
}

async function sendRequest(adapter: V6DebugAdapter, request: any): Promise<void> {
    await new Promise<void>((resolve) => {
        const subscription = adapter.onDidSendMessage((message: any) => {
            if (message.type === 'response' && message.request_seq === request.seq) {
                subscription.dispose();
                resolve();
            }
        });
        adapter.handleMessage({ type: 'request', ...request } as any);
    });
}