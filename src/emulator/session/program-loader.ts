import * as fs from 'fs';
import type { CommandSender } from './session-operations';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { IpcCommand } from '../protocol/ipc-commands';
import { requireProtocolOk } from '../protocol/protocol-result';
import { normalizeRun, NormalizedRun } from '../../project/model/normalized-run';
import type { V6ProjectRun } from '../../project/model/v6-project';

export type ProgramLoadPolicy = 'run-initial' | 'run-reload' | 'debug-initial' | 'debug-replace';
export interface ProgramImage { readonly run: NormalizedRun; readonly kind: 'rom' | 'fdd'; readonly bytes: readonly number[] }

/** Captures file bytes once; policy chooses LOAD_ROM versus non-resetting SET_MEM explicitly. */
export class ProgramLoader {
    constructor(private readonly read: (file: string) => Uint8Array = file => fs.readFileSync(file)) {}

    prepare(run: V6ProjectRun, policy: ProgramLoadPolicy): ProgramImage {
        const normalized = normalizeRun(run);
        const kind = normalized.executable.toLowerCase().endsWith('.fdd') ? 'fdd' : 'rom';
        if (policy === 'debug-replace' && !normalized.executable.toLowerCase().endsWith('.rom')) {
            throw new Error('Reload ROM is only available for ROM debug sessions');
        }
        const bytes = Array.from(this.read(normalized.executable));
        if (kind === 'rom' && normalized.loadAddress + bytes.length > 0x10000) { throw new RangeError('ROM image exceeds CPU memory at the selected load address'); }
        return Object.freeze({ run: normalized, kind, bytes: Object.freeze(bytes) });
    }

    async load(image: ProgramImage, policy: ProgramLoadPolicy, client: CommandSender, scope?: OperationScope): Promise<void> {
        scope?.assertCurrent();
        const command = image.kind === 'fdd' ? IpcCommand.MOUNT_FDD : policy === 'debug-replace' ? IpcCommand.SET_MEM : IpcCommand.LOAD_ROM;
        const data = image.kind === 'fdd'
            ? { data: Array.from(image.bytes), driveIdx: 0, path: image.run.executable, autoBoot: true }
            : { data: Array.from(image.bytes), addr: image.run.loadAddress, autorun: policy === 'run-initial' || policy === 'run-reload' };
        const response = await client.send(command, data, policy === 'debug-replace' ? 5000 : undefined,
            policy === 'debug-replace' ? 'critical' : undefined, scope);
        scope?.assertCurrent();
        requireProtocolOk(command, response, 'Unable to load program');
    }
}