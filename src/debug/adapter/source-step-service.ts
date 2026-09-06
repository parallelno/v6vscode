import { LogicalLocation } from './logical-location-index';

export type SourceStepKind = 'into' | 'over' | 'out';

export interface SourceStepLimits {
    maxInstructions: number;
    maxElapsedMs: number;
    maxCandidates: number;
}

export interface SourceStepState {
    location: LogicalLocation;
    physicalDepth: number;
    inlineDepth: number;
}

export type SourceStepOutcome = 'continue' | 'complete' | 'cancelled' | 'instruction-budget-exceeded' | 'time-budget-exceeded';

export class SourceStepService {
    private operation: { kind: SourceStepKind; start: SourceStepState; startedAt: number; instructions: number; candidates: number } | undefined;

    constructor(
        private readonly limits: SourceStepLimits,
        private readonly now: () => number = Date.now,
        private readonly cleanup: () => Promise<void> = async () => {},
    ) {}

    begin(kind: SourceStepKind, start: SourceStepState, candidates: number): SourceStepOutcome {
        if (candidates > this.limits.maxCandidates) { return 'instruction-budget-exceeded'; }
        this.operation = { kind, start, startedAt: this.now(), instructions: 0, candidates };
        return 'continue';
    }

    async observe(current: SourceStepState, internalInstructions = 0): Promise<SourceStepOutcome> {
        const active = this.operation;
        if (!active) { return 'cancelled'; }
        active.instructions += internalInstructions;
        if (active.instructions > this.limits.maxInstructions) { return this.finish('instruction-budget-exceeded'); }
        if (this.now() - active.startedAt > this.limits.maxElapsedMs) { return this.finish('time-budget-exceeded'); }
        if (completes(active.kind, active.start, current)) { return this.finish('complete'); }
        return 'continue';
    }

    async tick(internalInstructions = 1): Promise<SourceStepOutcome> {
        const active = this.operation;
        if (!active) { return 'cancelled'; }
        active.instructions += internalInstructions;
        if (active.instructions > this.limits.maxInstructions) { return this.finish('instruction-budget-exceeded'); }
        if (this.now() - active.startedAt > this.limits.maxElapsedMs) { return this.finish('time-budget-exceeded'); }
        return 'continue';
    }

    async cancel(): Promise<void> {
        if (!this.operation) { return; }
        this.operation = undefined;
        await this.cleanup();
    }

    get active(): boolean {
        return this.operation !== undefined;
    }

    private async finish(outcome: Exclude<SourceStepOutcome, 'continue' | 'cancelled'>): Promise<SourceStepOutcome> {
        this.operation = undefined;
        await this.cleanup();
        return outcome;
    }
}

function completes(kind: SourceStepKind, start: SourceStepState, current: SourceStepState): boolean {
    if (kind === 'into') {
        return !sameLocation(start.location, current.location)
            || current.physicalDepth !== start.physicalDepth
            || current.inlineDepth !== start.inlineDepth;
    }
    if (kind === 'over') {
        return current.physicalDepth === start.physicalDepth
            && current.inlineDepth === start.inlineDepth
            && !sameLocation(start.location, current.location);
    }
    return current.physicalDepth < start.physicalDepth
        || (current.physicalDepth === start.physicalDepth && current.inlineDepth < start.inlineDepth);
}

function sameLocation(left: LogicalLocation, right: LogicalLocation): boolean {
    return left.physicalFrameId === right.physicalFrameId
        && left.file === right.file
        && left.line === right.line
        && left.column === right.column
        && left.inlineChain.length === right.inlineChain.length
        && left.inlineChain.every((id, index) => id === right.inlineChain[index]);
}