import * as assert from 'assert';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';

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

    it('exposes machine-state scopes for an unmapped CPU frame', async () => {
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
        assert.deepStrictEqual(frame.source, { name: 'Unknown Source', sourceReference: 1 });
        assert.strictEqual(frame.line, 1);
        assert.strictEqual(frame.column, 1);

        await sendRequest(adapter, { seq: 2, command: 'scopes', arguments: { frameId: frame.id } });
        assert.deepStrictEqual(
            responses[1].body.scopes.map((scope: any) => scope.name),
            ['Registers', 'Flags', 'Raw Stack'],
        );

        await sendRequest(adapter, { seq: 3, command: 'source', arguments: { sourceReference: 1 } });
        assert.strictEqual(responses[2].body.content, 'Source is unavailable for the current CPU address.');
    });
});

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