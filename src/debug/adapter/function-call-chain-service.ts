import { AsmFunctionIndex, AsmFunctionRegion } from '../metadata/asm-function-index';
import { ActiveCall, ActiveCallSnapshot, FunctionHistoryClient, HistoryPosition } from '../session/function-history-client';

export interface FunctionHistoryFrame {
    region?: AsmFunctionRegion;
    pc: number;
    name?: string;
    caller?: HistoryPosition;
    returnPc?: number;
}

/** Each record is an activation, so recursion and unannotated callers are preserved. */
export function activeFunctionChain(index: AsmFunctionIndex | undefined, calls: readonly ActiveCall[], pc: number,
    resolveName: (pc: number) => string | undefined): FunctionHistoryFrame[] {
    const chain: FunctionHistoryFrame[] = [];
    for (const call of calls) {
        const region = index?.at(pc);
        const entry = region?.entries.find(candidate => candidate.address === call.entryPc);
        chain.push({ pc, region, name: entry?.name ?? resolveName(pc) ?? resolveName(call.entryPc), returnPc: call.returnPc });
        pc = call.callerPc;
    }
    chain.push({ pc, region: index?.at(pc), name: resolveName(pc) });
    return chain;
}

/** Infer logical calls only within each physical activation. A real call is
 * a hard boundary, including when both activations have the same region. */
export async function hybridFunctionChain(index: AsmFunctionIndex, history: FunctionHistoryClient,
    snapshot: ActiveCallSnapshot, pc: number, resolveName: (pc: number) => string | undefined,
    assertCurrent: () => void): Promise<FunctionHistoryFrame[]> {
    const { frames: calls, historyGeneration } = snapshot;
    const physical = activeFunctionChain(index, calls, pc, resolveName);
    if (calls.length && historyGeneration === undefined) { return physical; }
    const chain: FunctionHistoryFrame[] = [];
    const budget = { remaining: 128 };
    let position: HistoryPosition | undefined;
    for (const [depth, frame] of physical.entries()) {
        const call = calls[depth];
        const limit = call?.traceCursor;
        // A null anchor predates the entire retained trace. We can still
        // recover newer excursions but cannot scan the older activation.
        if (frame.region && (!call || limit !== undefined) && budget.remaining > 0) {
            const segment = await reconstructFunctionChain(index, history, frame.pc, assertCurrent,
                { position, before: limit ?? undefined, historyGeneration, budget });
            const last = segment.at(-1);
            if (!call) { chain.push(...segment); return chain; }
            const owner = index.at(call.entryPc);
            const entryName = resolveName(call.entryPc);
            if (last && (owner ? last.region === owner : last.pc === call.entryPc
                || (entryName !== undefined && resolveName(last.pc) === entryName))) {
                // A logical caller uses its observed transfer site; its Step Out
                // still uses the actual return word pushed by the hardware call.
                chain.push(...segment.slice(0, -1), { ...last, caller: undefined,
                    name: owner?.entries.find(entry => entry.address === call.entryPc)?.name ?? last.name ?? frame.name,
                    returnPc: call.returnPc });
            } else { chain.push(frame); }
        } else { chain.push(frame); }
        if (!call) { break; }
        if (typeof limit !== 'number' || historyGeneration === undefined) {
            chain.push(...physical.slice(depth + 1));
            break;
        }
        position = { callerCursor: limit, historyGeneration };
    }
    return chain;
}

/** Collect raw region occurrences, then erase completed excursions by identity. */
export async function reconstructFunctionChain(
    index: AsmFunctionIndex, history: FunctionHistoryClient, pc: number,
    assertCurrent: () => void,
    options: { position?: HistoryPosition; before?: number; historyGeneration?: number; budget?: { remaining: number } } = {},
): Promise<FunctionHistoryFrame[]> {
    const raw: FunctionHistoryFrame[] = [];
    let position = options.position;
    let region = index.at(pc);
    while (region) {
        if (raw.length >= 4096) { throw new Error('Caller history exceeds reconstruction budget'); }
        if (options.budget && options.budget.remaining-- <= 0) { throw new Error('Caller history exceeds reconstruction budget'); }
        assertCurrent();
        const result = await history.caller(region.start, region.end, position);
        assertCurrent();
        if (options.historyGeneration !== undefined && result.historyGeneration !== options.historyGeneration) {
            throw new Error('Inactive caller history');
        }
        const found = result.status === 'found' && (options.before === undefined || result.callerCursor < options.before);
        const entry = found
            ? region.entries.find(candidate => candidate.address === result.entrancePc) : undefined;
        raw.push({ region, pc, name: entry?.name,
            caller: found
                ? { callerCursor: result.callerCursor, historyGeneration: result.historyGeneration } : undefined });
        if (!found) { break; }
        position = { callerCursor: result.callerCursor, historyGeneration: result.historyGeneration };
        pc = result.callerPc;
        region = index.at(pc);
        if (!region) { raw.push({ pc }); }
    }
    const chain: FunctionHistoryFrame[] = [];
    for (const frame of raw) {
        const duplicate = frame.region ? chain.findIndex(item => item.region?.id === frame.region!.id) : -1;
        if (duplicate < 0) { chain.push(frame); }
        else {
            const newer = chain[duplicate];
            chain.splice(duplicate, chain.length - duplicate, { ...frame, pc: newer.pc });
        }
    }
    return chain;
}