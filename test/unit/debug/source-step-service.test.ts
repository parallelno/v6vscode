import * as assert from 'assert';
import { SourceStepService, SourceStepState } from '../../../src/debug/adapter/source-step-service';

const start: SourceStepState = {
    location: { physicalFrameId: 'frame-0', inlineChain: [], file: 'main.c', line: 10, column: 1, isStmt: true },
    physicalDepth: 0,
    inlineDepth: 0,
};

describe('SourceStepService', () => {
    it('ignores repeated mappings and completes Step Into at a distinct statement', async () => {
        const service = new SourceStepService({ maxInstructions: 4, maxElapsedMs: 10, maxCandidates: 4 });
        assert.strictEqual(service.begin('into', start, 1), 'continue');
        assert.strictEqual(await service.observe(start, 1), 'continue');
        assert.strictEqual(await service.observe({ ...start, location: { ...start.location, line: 11 } }, 1), 'complete');
    });

    it('keeps Step Over inside its initial physical and inline frame', async () => {
        const service = new SourceStepService({ maxInstructions: 4, maxElapsedMs: 10, maxCandidates: 4 });
        service.begin('over', start, 1);
        assert.strictEqual(await service.observe({ ...start, physicalDepth: 1, location: { ...start.location, line: 11 } }), 'continue');
        assert.strictEqual(await service.observe({ ...start, location: { ...start.location, line: 11 } }), 'complete');
    });

    it('completes Step Out only after leaving the starting semantic frame', async () => {
        const service = new SourceStepService({ maxInstructions: 4, maxElapsedMs: 10, maxCandidates: 4 });
        service.begin('out', { ...start, inlineDepth: 1 }, 1);
        assert.strictEqual(await service.observe(start), 'complete');
    });

    it('enforces budgets and cleans up on completion or cancellation', async () => {
        let now = 0;
        let cleanupCount = 0;
        const service = new SourceStepService({ maxInstructions: 1, maxElapsedMs: 5, maxCandidates: 1 }, () => now, async () => { cleanupCount++; });
        assert.strictEqual(service.begin('into', start, 2), 'instruction-budget-exceeded');
        service.begin('into', start, 1);
        now = 6;
        assert.strictEqual(await service.observe(start), 'time-budget-exceeded');
        service.begin('into', start, 1);
        await service.cancel();
        assert.strictEqual(cleanupCount, 2);
    });

    it('counts metadata-unavailable instruction fallback stops against its budget', async () => {
        const service = new SourceStepService({ maxInstructions: 1, maxElapsedMs: 10, maxCandidates: 1 });
        service.begin('into', start, 0);

        assert.strictEqual(await service.tick(), 'continue');
        assert.strictEqual(await service.tick(), 'instruction-budget-exceeded');
    });
});