import { AsmFunctionIndex, AsmFunctionRegion } from '../metadata/asm-function-index';
import { FunctionHistoryClient, HistoryPosition } from '../session/function-history-client';

export interface FunctionHistoryFrame {
    region?: AsmFunctionRegion;
    pc: number;
    name?: string;
    caller?: HistoryPosition;
}

/** Collect raw region occurrences, then erase completed excursions by identity. */
export async function reconstructFunctionChain(
    index: AsmFunctionIndex, history: FunctionHistoryClient, pc: number,
    assertCurrent: () => void,
): Promise<FunctionHistoryFrame[]> {
    const raw: FunctionHistoryFrame[] = [];
    let position: HistoryPosition | undefined;
    let region = index.at(pc);
    while (region) {
        if (raw.length >= 4096) { throw new Error('Caller history exceeds reconstruction budget'); }
        assertCurrent();
        const result = await history.caller(region.start, region.end, position);
        assertCurrent();
        const entry = result.status === 'found'
            ? region.entries.find(candidate => candidate.address === result.entrancePc) : undefined;
        raw.push({ region, pc, name: entry?.name,
            caller: result.status === 'found'
                ? { callerCursor: result.callerCursor, historyGeneration: result.historyGeneration } : undefined });
        if (result.status === 'historyEnd') { break; }
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