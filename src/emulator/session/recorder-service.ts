import { IpcCommand } from '../protocol/ipc-commands';
import { decodeProtocolData } from '../protocol/protocol-result';
import { decodeRecorderMove, decodeRecorderStatus, RecorderMove } from '../protocol/recorder-models';
import type { SessionLease } from './session-coordinator';

export async function readRecorder(lease: SessionLease) {
    const command = IpcCommand.DEBUG_RECORDER_STATUS;
    const response = await lease.send(command, undefined, 5000, 'low');
    lease.assertCurrent();
    return decodeProtocolData(command, response, 'Cannot read Recorder status', decodeRecorderStatus);
}

export async function moveRecorder(lease: SessionLease, input: RecorderMove) {
    const command = IpcCommand.DEBUG_RECORDER_MOVE;
    const { action, expectedRevision } = input;
    const response = await lease.send(command, input.action === 'seek'
        ? { action, expectedRevision, targetId: input.targetId } : { action, expectedRevision }, 5000, 'critical');
    lease.assertCurrent();
    return decodeProtocolData(command, response, 'Cannot move Recorder', decodeRecorderMove);
}