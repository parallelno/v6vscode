import { EventEmitter } from 'events';
import { expect } from 'chai';
import { CodePerfInput, CodePerfSnapshot } from '../../../src/emulator/protocol/debug-models';
import { PerformancePanel } from '../../../src/debug/views/performance-panel';

describe('Performance address expressions', () => {
    it('evaluates service input and preserves exact start and end expressions', async () => {
        const lifecycle = Object.assign(new EventEmitter(), { connected: true, running: true });
        let submitted: CodePerfInput | undefined;
        const service = Object.assign(new EventEmitter(), {
            sessionGeneration: 0,
            snapshot: [] as CodePerfSnapshot[],
            available: true,
            add: async (input: CodePerfInput): Promise<CodePerfSnapshot> => {
                submitted = input;
                const entry = { id: 7, ...input, averageClockCycles: 0, testCount: 0 };
                service.snapshot = [entry];
                return entry;
            },
        });
        const symbols = {
            requireSymbolAddress: (name: string) => {
                if (name === 'main') { return 0x100; }
                if (name === 'end') { return 0x180; }
                throw new Error(`Symbol not found: ${name}`);
            },
        };
        const panel = new PerformancePanel(
            {} as any,
            lifecycle as any,
            service as any,
            symbols as any,
            { getActiveProject: () => undefined } as any,
            { get: () => undefined, update: async () => {} } as any,
            { error: () => {}, warn: () => {} } as any,
        );
        const input = {
            name: 'frame',
            addrStart: '  main + 2*3  ',
            addrEnd: 'end-$10',
            active: true,
        };

        await (panel as any).handleMessage({ type: 'add', generation: 0, input });

        expect(submitted).to.deep.equal({ name: 'frame', addrStart: 0x106, addrEnd: 0x170, active: true });
        const entry = { id: 7, ...submitted!, averageClockCycles: 0, testCount: 0 };
        expect((panel as any).addressExpressions.decorate([entry], 0)[0]).to.include({
            addrStart: '  main + 2*3  ',
            addrEnd: 'end-$10',
        });
        panel.dispose();
    });

    it('rejects unresolved expressions before calling the service', async () => {
        const lifecycle = Object.assign(new EventEmitter(), { connected: true, running: false });
        let called = false;
        const service = Object.assign(new EventEmitter(), {
            sessionGeneration: 0,
            snapshot: [],
            available: true,
            add: async () => { called = true; },
        });
        const panel = new PerformancePanel(
            {} as any,
            lifecycle as any,
            service as any,
            { requireSymbolAddress: () => { throw new Error('Symbol not found: missing'); } } as any,
            { getActiveProject: () => undefined } as any,
            { get: () => undefined, update: async () => {} } as any,
            { error: () => {}, warn: () => {} } as any,
        );

        await (panel as any).handleMessage({
            type: 'add', generation: 0,
            input: { name: 'bad', addrStart: 'missing+1', addrEnd: '0x200', active: true },
        });

        expect(called).to.equal(false);
        panel.dispose();
    });
});