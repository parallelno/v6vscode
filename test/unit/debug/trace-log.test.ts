import { EventEmitter } from 'events';
import { expect } from 'chai';
import {
    decodeTraceLogFilterResponse,
    decodeTraceLogWindowResponse,
} from '../../../src/debug/trace-log/trace-log-codec';
import { parseTraceLogQuery } from '../../../src/debug/trace-log/trace-log-query';
import { TraceLogService } from '../../../src/debug/trace-log/trace-log-service';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { validateTraceLogServer } from '../../../src/emulator/protocol/ipc-server-info';

class FakeLifecycle extends EventEmitter {
    connected = true;
    running = false;
    serverInfo = traceServerInfo();
}

describe('Trace Log protocol', () => {
    it('requires schema 1, limits, and both query commands', () => {
        const info = traceServerInfo();
        expect(() => validateTraceLogServer(info)).not.to.throw();
        expect(() => validateTraceLogServer({
            ...info,
            commands: info.commands.filter(command => command !== IpcCommand.DEBUG_TRACE_LOG_WINDOW),
        })).to.throw('does not provide trace-log schema 1');
        expect(() => validateTraceLogServer({
            ...info,
            capabilities: { ...info.capabilities, traceLogLimits: { ...info.capabilities.traceLogLimits, maxLines: 0 } },
        })).to.throw('does not provide trace-log schema 1');
    });

    it('decodes exact bounded filter and window payloads', () => {
        expect(decodeTraceLogFilterResponse({ filterId: 7, totalMatches: 2 }, 300000))
            .to.deep.equal({ filterId: 7, totalMatches: 2 });
        expect(decodeTraceLogWindowResponse({
            start: 0,
            entries: [{ address: 0x1234, bytes: [0x3E, 0x10], instruction: 'MVI A, 0x10' }],
        }, 0, 1, 2)).to.deep.equal({
            start: 0,
            entries: [{ address: 0x1234, bytes: [0x3E, 0x10], instruction: 'MVI A, 0x10' }],
        });
    });

    it('rejects malformed, oversized, and shifted responses', () => {
        expect(() => decodeTraceLogFilterResponse({ filterId: 0, totalMatches: 1 }, 10)).to.throw('filterId');
        expect(() => decodeTraceLogFilterResponse({ filterId: 1, totalMatches: 11 }, 10)).to.throw('totalMatches');
        expect(() => decodeTraceLogWindowResponse({ start: 1, entries: [] }, 0, 1, 2)).to.throw('requested start');
        expect(() => decodeTraceLogWindowResponse({ start: 0, entries: [] }, 0, 1, 2)).to.throw('must contain 1 rows');
        expect(() => decodeTraceLogWindowResponse({
            start: 0, entries: [{ address: 0x10000, bytes: [0], instruction: 'NOP' }],
        }, 0, 1, 1)).to.throw('address');
        expect(() => decodeTraceLogWindowResponse({
            start: 0, entries: [{ address: 0, bytes: [], instruction: 'NOP' }],
        }, 0, 1, 1)).to.throw('one to three bytes');
        expect(() => decodeTraceLogWindowResponse({
            start: 0, entries: [{ address: 0, bytes: [0], instruction: 'NOP', sequence: 1 }],
        }, 0, 1, 1)).to.throw('exactly address, bytes, instruction');
    });
});

describe('Trace Log query parser', () => {
    it('maps the query grammar to optional server patterns', () => {
        expect(parseTraceLogQuery('', 64)).to.deep.equal({ ok: true, request: {} });
        expect(parseTraceLogQuery('* JMP*', 64)).to.deep.equal({
            ok: true, request: { instructionPattern: 'JMP*' },
        });
        expect(parseTraceLogQuery('0x10* MVI A, *', 64)).to.deep.equal({
            ok: true, request: { addressPattern: '0x10*', instructionPattern: 'MVI A, *' },
        });
    });

    it('rejects invalid addresses and counts UTF-8 bytes', () => {
        expect(parseTraceLogQuery('1000 NOP', 64)).to.deep.include({ ok: false });
        expect(parseTraceLogQuery(`* ${'Ж'.repeat(33)}`, 64)).to.deep.include({ ok: false });
        expect(parseTraceLogQuery(`* ${'Ж'.repeat(32)}`, 64)).to.deep.include({ ok: true });
    });
});

describe('TraceLogService', () => {
    it('filters once and coalesces requests into cached negotiated blocks', async () => {
        const lifecycle = new FakeLifecycle();
        const requests: Array<{ command: IpcCommand; data: any }> = [];
        const client = { send: async (command: IpcCommand, data: any) => {
            requests.push({ command, data });
            if (command === IpcCommand.DEBUG_TRACE_LOG_FILTER) {
                return { ok: true, data: { filterId: 9, totalMatches: 1200 } };
            }
            const entries = Array.from({ length: data.lines }, (_, index) => ({
                address: (data.start + index) & 0xFFFF, bytes: [0], instruction: 'NOP',
            }));
            return { ok: true, data: { start: data.start, entries } };
        } };
        const service = new TraceLogService(lifecycle as any, client as any);
        service.setVisible(true);

        expect(await service.filter({ instructionPattern: 'JMP*' })).to.include({ filterId: 9, totalMatches: 1200 });
        const first = service.window(10, 30);
        const sameBlock = service.window(200, 30);
        expect(sameBlock).to.equal(first);
        expect((await first).start).to.equal(0);
        expect((await service.window(600, 30)).start).to.equal(512);
        expect((await service.window(10, 30)).start).to.equal(0);
        expect(requests.map(request => request.command)).to.deep.equal([
            IpcCommand.DEBUG_TRACE_LOG_FILTER,
            IpcCommand.DEBUG_TRACE_LOG_WINDOW,
            IpcCommand.DEBUG_TRACE_LOG_WINDOW,
        ]);
        expect(requests[1].data).to.deep.equal({ filterId: 9, start: 0, lines: 512 });
        expect(service.entry(600)?.address).to.equal(600);
        service.dispose();
    });

    it('does not query while hidden or running', async () => {
        const lifecycle = new FakeLifecycle();
        let requests = 0;
        const service = new TraceLogService(lifecycle as any, { send: async () => { requests++; } } as any);
        expect(await failure(service.filter({}))).to.contain('not visible');
        service.setVisible(true);
        lifecycle.running = true;
        expect(await failure(service.filter({}))).to.contain('paused emulator');
        expect(requests).to.equal(0);
        service.dispose();
    });

    it('rejects a filter response after resume and clears the active result', async () => {
        const lifecycle = new FakeLifecycle();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const service = new TraceLogService(lifecycle as any, { send: async () => {
            await gate;
            return { ok: true, data: { filterId: 1, totalMatches: 0 } };
        } } as any);
        service.setVisible(true);
        const filtering = service.filter({});
        lifecycle.running = true;
        lifecycle.emit('stateChange', 'running');
        release();
        expect(await failure(filtering)).to.contain('inactive result');
        expect(service.activeFilter).to.equal(undefined);
        service.dispose();
    });

    it('rejects a window response after filter replacement', async () => {
        const lifecycle = new FakeLifecycle();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let filterId = 0;
        const service = new TraceLogService(lifecycle as any, { send: async (command: IpcCommand, data: any) => {
            if (command === IpcCommand.DEBUG_TRACE_LOG_FILTER) {
                return { ok: true, data: { filterId: ++filterId, totalMatches: 2 } };
            }
            await gate;
            return { ok: true, data: { start: data.start, entries: [{ address: 0, bytes: [0], instruction: 'NOP' }] } };
        } } as any);
        service.setVisible(true);
        await service.filter({});
        const window = service.window(0, 1);
        await service.filter({ addressPattern: '0x1*' });
        release();
        expect(await failure(window)).to.contain('inactive result');
        service.dispose();
    });
});

function traceServerInfo() {
    return {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [IpcCommand.DEBUG_TRACE_LOG_FILTER, IpcCommand.DEBUG_TRACE_LOG_WINDOW],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            traceLogSchema: 1,
            traceLogFilter: true,
            traceLogWindowQuery: true,
            traceLogLimits: { capacity: 300000, maxLines: 512, maxPatternBytes: 64 },
        },
    };
}

async function failure(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return '';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}