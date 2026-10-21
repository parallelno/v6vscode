import type { CommandSender } from '../../emulator/session/session-operations';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import { requireProtocolOk } from '../../emulator/protocol/protocol-result';
import { StopRecord } from '../../emulator/protocol/debug-models';
import { StopMonitor } from './stop-monitor';

export interface ExecutionContext {
    client: CommandSender;
    records: boolean;
    assertCurrent(): void;
}
export interface ExecutionHooks {
    prepare(): Promise<void>;
    synchronize(): Promise<void>;
    invalidate(): void;
    running(value: boolean): void;
    continued(): void;
    stopped(record?: StopRecord): Promise<void>;
    refresh(): Promise<void>;
    clearException(): void;
}

/** Owns acknowledged control sequencing and stop polling, independent of DAP messages. */
export class ExecutionController {
    state: 'idle' | 'running' | 'paused' | 'disconnected' = 'idle';
    pendingPause = false;
    pendingStep = false;
    lastStopSequence: number | undefined;
    private readonly monitor = new StopMonitor();

    constructor(private readonly context: () => ExecutionContext, private readonly hooks: ExecutionHooks) {}

    private capture(): ExecutionContext & { scope: OperationScope } {
        const context = this.context();
        context.assertCurrent();
        const scope: OperationScope = { key: context.client, assertCurrent: context.assertCurrent };
        return { ...context, scope };
    }

    private async send(context: ExecutionContext & { scope: OperationScope }, command: IpcCommand, fallback: string, data?: unknown): Promise<void> {
        context.assertCurrent();
        const response = await context.client.send(command, data, 5000, 'critical', context.scope);
        context.assertCurrent();
        requireProtocolOk(command, response, fallback);
    }

    async baseline(context = this.capture()): Promise<void> {
        this.hooks.clearException();
        if (!context.records) { return; }
        const record = await this.monitor.read(context.client);
        context.assertCurrent();
        this.lastStopSequence = record.sequence;
    }

    async run(): Promise<void> {
        const context = this.capture();
        await this.hooks.synchronize();
        context.assertCurrent();
        await this.baseline(context);
        this.hooks.invalidate();
        this.pendingPause = false;
        this.pendingStep = false;
        await this.send(context, IpcCommand.RUN, 'Emulator run failed');
        this.state = 'running';
        this.hooks.running(true);
        this.hooks.continued();
        this.startPoll();
    }

    async pause(): Promise<void> {
        const context = this.capture();
        await this.send(context, IpcCommand.STOP, 'Emulator stop failed');
        this.pendingPause = true;
        this.hooks.running(false);
        this.startPoll();
    }

    async singleStep(): Promise<void> {
        const context = this.capture();
        await this.baseline(context);
        await this.send(context, IpcCommand.EXECUTE_INSTR, 'Instruction step failed');
        this.hooks.invalidate();
        this.hooks.continued();
        this.state = 'paused';
        this.hooks.running(false);
        const record = context.records ? await this.monitor.read(context.client) : undefined;
        context.assertCurrent();
        if (record && record.sequence !== this.lastStopSequence) {
            this.lastStopSequence = record.sequence;
            await this.hooks.stopped(record);
        } else if (!context.records) { await this.hooks.stopped(); }
    }

    startPoll(): void {
        const context = this.capture();
        this.monitor.start(context.client, () => ({ records: context.records, sequence: this.lastStopSequence, pauseRequested: this.pendingPause }), async record => {
            context.assertCurrent();
            this.state = 'paused';
            this.hooks.running(false);
            if (record) { this.lastStopSequence = record.sequence; }
            await this.hooks.stopped(record);
        });
    }

    stopPoll(): void { this.monitor.stop(); }

    async restart(kind: 'restart' | 'reset' | 'reload', reload?: () => Promise<void>): Promise<void> {
        const context = this.capture();
        const resume = this.state === 'running';
        this.stopPoll();
        await this.hooks.prepare();
        context.assertCurrent();
        this.pendingPause = false; this.pendingStep = false;
        this.hooks.invalidate();
        if (kind !== 'restart') {
            await this.send(context, IpcCommand.STOP, 'Emulator stop failed');
            this.state = 'paused'; this.hooks.running(false);
            await this.send(context, IpcCommand.RESET, 'Emulator reset failed');
        }
        if (kind !== 'reset') { await this.send(context, IpcCommand.RESTART, 'Emulator restart failed'); }
        if (kind === 'reload') {
            await reload?.(); context.assertCurrent();
            await this.send(context, IpcCommand.DEBUG_RESET, 'Debugger reset failed', { resetRecorder: true });
        }
        this.state = 'paused'; this.hooks.running(false);
        if (resume || kind === 'reload') { await this.run(); }
        else { await this.hooks.refresh(); }
    }

    async resumeLogpoint(): Promise<boolean> {
        const context = this.capture();
        await this.baseline(context);
        this.hooks.invalidate();
        try { await this.send(context, IpcCommand.RUN, 'Logpoint automatic resume failed'); }
        catch { context.assertCurrent(); this.state = 'paused'; this.hooks.running(false); return false; }
        this.state = 'running'; this.hooks.running(true); this.startPoll();
        return true;
    }
}