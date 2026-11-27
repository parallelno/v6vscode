import { CommandSender } from '../../emulator/session/session-operations';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';

export interface HistoryPosition { callerCursor: number; historyGeneration: number }
export interface ActiveCall { callerPc: number; entryPc: number; returnPc: number; traceCursor?: number | null }
export interface ActiveCallSnapshot { frames: ActiveCall[]; historyGeneration?: number }
export type CallerResult = { status: 'historyEnd'; historyGeneration: number }
    | ({ status: 'found'; callerPc: number; entrancePc: number } & HistoryPosition);

function integer(value: unknown, max: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export class FunctionHistoryClient {
    constructor(private readonly client: CommandSender) {}

    async activeCalls(): Promise<ActiveCallSnapshot> {
        const response = await this.client.send<ActiveCallSnapshot>(IpcCommand.DEBUG_ACTIVE_CALLS);
        const data = response.data;
        if (!response.ok || !Array.isArray(data?.frames) || data.frames.length > 256
            || (data.historyGeneration !== undefined && !integer(data.historyGeneration, Number.MAX_SAFE_INTEGER))
            || data.frames.some(frame => !integer(frame?.callerPc, 0xFFFF)
                || !integer(frame?.entryPc, 0xFFFF) || !integer(frame?.returnPc, 0xFFFF)
                || (frame.traceCursor != null && !integer(frame.traceCursor, 299_999)))) {
            throw new Error(response.error ?? 'Invalid active call stack response');
        }
        return data;
    }

    async caller(start: number, end: number, position?: HistoryPosition): Promise<CallerResult> {
        const response = await this.client.send<CallerResult>(IpcCommand.DEBUG_HISTORY_CALLER,
            { rangeStart: start, rangeEnd: end, ...position });
        if (!response.ok || !response.data) { throw new Error(response.error ?? 'History query failed'); }
        const data = response.data;
        if (!integer(data.historyGeneration, Number.MAX_SAFE_INTEGER)
            || (position && data.historyGeneration !== position.historyGeneration)
            || (data.status !== 'historyEnd' && (data.status !== 'found'
                || !integer(data.callerPc, 0xFFFF) || !integer(data.entrancePc, 0xFFFF)
                || (data.callerPc >= start && data.callerPc < end)
                || data.entrancePc < start || data.entrancePc >= end
                || !integer(data.callerCursor, Number.MAX_SAFE_INTEGER)
                || (position && data.callerCursor <= position.callerCursor)))) {
            throw new Error('Invalid or stale caller history response');
        }
        return data;
    }

    async successor(position: HistoryPosition): Promise<number> {
        const response = await this.client.send<{ address: number }>(IpcCommand.DEBUG_HISTORY_SUCCESSOR, position);
        if (!response.ok || !integer(response.data?.address, 0xFFFF)) {
            throw new Error(response.error ?? 'Invalid caller successor response');
        }
        return response.data!.address;
    }
}