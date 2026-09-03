import * as assert from 'assert';
import { StackTraceService } from '../../../src/debug/adapter/stack-trace-service';

describe('StackTraceService', () => {
    it('projects verified frames with stable IDs and DAP pagination', async () => {
        const service = new StackTraceService();
        const context = {
            unwind: async () => [
                { index: 0, pc: 0x0120, sp: 0xFF00, registers: {} },
                { index: 1, pc: 0x0080, sp: 0xFF04, registers: {} },
                { index: 2, pc: 0x0040, sp: 0xFF08, registers: {} },
            ],
        };

        await service.capture(3, context as any, pc => ({ 0x0120: 'copyToDisplay', 0x0080: 'bubbleSort', 0x0040: 'main' })[pc], () => [], frame => frame.pc - 1);

        const firstPage = service.page(0, 2);
        assert.strictEqual(firstPage.totalFrames, 3);
        assert.deepStrictEqual(firstPage.frames.map(frame => [frame.id, frame.name]), [
            [3001, 'copyToDisplay'],
            [3002, 'bubbleSort'],
        ]);
        assert.deepStrictEqual(firstPage.frames.map(frame => [frame.instructionPc, frame.displayPc]), [
            [0x0120, 0x011F],
            [0x0080, 0x007F],
        ]);

        const finalPage = service.page(2, 1);
        assert.deepStrictEqual(finalPage.frames.map(frame => [frame.id, frame.name]), [[3003, 'main']]);

        await service.capture(3, context as any, () => 'changed', () => [], frame => frame.pc);
        assert.deepStrictEqual(service.page(0, 1).frames.map(frame => frame.name), ['copyToDisplay']);
        assert.strictEqual(service.frame(3, 3001)?.name, 'copyToDisplay');
        assert.strictEqual(service.frame(4, 3001), undefined);
    });

    it('puts active inline frames before their physical frame', async () => {
        const service = new StackTraceService();
        const context = { unwind: async () => [{ index: 0, pc: 0x0120, sp: 0xFF00, registers: {} }] };

        await service.capture(1, context as any, () => 'concrete', () => [
            { id: 11, name: 'innermostInline' },
            { id: 10, name: 'outerInline' },
        ], frame => frame.pc);

        assert.deepStrictEqual(service.page(0, 0).frames.map(frame => [frame.name, frame.inlineDieIdentity]), [
            ['innermostInline', 11],
            ['outerInline', 10],
            ['concrete', undefined],
        ]);
        assert.deepStrictEqual(service.page(0, 1).frames[0].source, undefined);
    });

    it('retains inline call-site source metadata independently from instruction PC', async () => {
        const service = new StackTraceService();
        const context = { unwind: async () => [{ index: 0, pc: 0x0120, sp: 0xFF00, registers: {} }] };

        await service.capture(1, context as any, () => 'concrete', () => [{
            id: 11,
            name: 'inlined',
            source: { file: 'probe.c', line: 12, column: 4 },
        }], frame => frame.pc);

        const frame = service.page(0, 1).frames[0];
        assert.strictEqual(frame.instructionPc, 0x0120);
        assert.deepStrictEqual(frame.source, { file: 'probe.c', line: 12, column: 4 });
    });
});