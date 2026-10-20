import type { CommandSender } from '../../emulator/session/session-operations';
import { IpcCommand, IsRunningResponse } from '../../emulator/protocol/ipc-commands';
import { decodeStopRecord, StopRecord } from '../../emulator/protocol/debug-models';
import { requireProtocolOk } from '../../emulator/protocol/protocol-result';

export interface StopObservation {
    records: boolean;
    sequence?: number;
    pauseRequested: boolean;
}

/** Non-overlapping polling; invalidated awaits cannot publish or schedule another poll. */
export class StopMonitor {
    private revision = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly interval = 20) {}

    stop(): void {
        this.revision++;
        if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    }

    async read(client: CommandSender): Promise<StopRecord> {
        const response = await client.send(IpcCommand.GET_STOP_RECORD, undefined, 5000, 'critical');
        const envelope = requireProtocolOk(IpcCommand.GET_STOP_RECORD, response, 'Unable to read emulator stop record');
        return decodeStopRecord(envelope.data);
    }

    start(client: CommandSender, observation: () => StopObservation,
        stopped: (record?: StopRecord) => Promise<void>, failed: (error: unknown) => void = () => {}): void {
        this.stop();
        const revision = this.revision;
        const current = () => revision === this.revision;
        const schedule = () => { if (current()) { this.timer = setTimeout(() => { void poll(); }, this.interval); } };
        const poll = async () => {
            this.timer = undefined;
            if (!current()) { return; }
            try {
                const response = await client.send<IsRunningResponse>(IpcCommand.IS_RUNNING, undefined, 5000, 'critical');
                if (!current()) { return; }
                if (response.ok && response.data?.isRunning === false) {
                    const state = observation();
                    const record = state.records ? await this.read(client) : undefined;
                    if (!current()) { return; }
                    if (record && record.sequence === observation().sequence) {
                        if (!observation().pauseRequested) { schedule(); return; }
                        this.stop();
                        await stopped();
                    } else {
                        this.stop();
                        await stopped(record);
                    }
                    return;
                }
                schedule();
            } catch (error) { if (current()) { this.stop(); failed(error); } }
        };
        schedule();
    }
}