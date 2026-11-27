import { expectRecord } from '../../shared/validation';
import { GetServerInfoResponse, IpcCommand } from './ipc-commands';
import { supportsStopRecords } from './ipc-server-info';

export const RECORDER_ACTIONS = ['backFrame', 'backInstruction100', 'backInstruction',
    'forwardInstruction', 'forwardInstruction100', 'forwardFrame'] as const;
export type RecorderAction = typeof RECORDER_ACTIONS[number];
export type RecorderMove = { action: RecorderAction; expectedRevision: number }
    | { action: 'seek'; expectedRevision: number; targetId: number };

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
        throw new Error('Invalid Recorder integer');
    }
    return value;
}

function flag(value: unknown): boolean {
    if (typeof value !== 'boolean') { throw new Error('Invalid Recorder flag'); }
    return value;
}

export function decodeRecorderMoveInput(value: unknown): RecorderMove {
    const { action, expectedRevision, targetId } = expectRecord(value, 'Recorder action');
    if (action === 'seek') { return { action, expectedRevision: integer(expectedRevision), targetId: integer(targetId) }; }
    const match = RECORDER_ACTIONS.find(item => item === action);
    if (!match) { throw new Error('Unknown Recorder action'); }
    return { action: match, expectedRevision: integer(expectedRevision) };
}

export function supportsRecorder(info: GetServerInfoResponse | undefined): boolean {
    return !!info && info.capabilities.recorderSchema === 1 && supportsStopRecords(info)
        && info.capabilities.recorderLimits?.maxFrameCheckpoints === 3000
        && info.capabilities.recorderLimits?.maxInstructionSteps === 1000
        && [IpcCommand.DEBUG_RECORDER_STATUS, IpcCommand.DEBUG_RECORDER_MOVE].every(cmd => info.commands.includes(cmd));
}

function decodePosition(value: unknown) {
    const p = expectRecord(value, 'Recorder position');
    return { id: integer(p.id), pc: integer(p.pc, 65535), frameNumber: integer(p.frameNumber),
        atFrameCheckpoint: flag(p.atFrameCheckpoint), atRecordedTip: flag(p.atRecordedTip) };
}

function decodeTimeline(value: unknown, id: number) {
    const t = expectRecord(value, 'Recorder timeline');
    const oldest = integer(t.oldest), newest = integer(t.newest);
    const instructionStart = t.instructionStart === null ? null : integer(t.instructionStart);
    if (oldest > id || id > newest || (instructionStart !== null && (instructionStart < oldest || instructionStart > newest))) {
        throw new Error('Invalid Recorder timeline range');
    }
    const ticks = (raw: unknown, maximum: number, start: number) => {
        if (!Array.isArray(raw) || raw.length > maximum) { throw new Error('Invalid Recorder ticks'); }
        let previous = start - 1;
        return Array.from(raw, value => {
            const tick = integer(value, newest);
            if (tick <= previous) { throw new Error('Recorder ticks must increase within the retained range'); }
            return previous = tick;
        });
    };
    const instructionTicks = ticks(t.instructionTicks, 201, instructionStart ?? oldest);
    if (instructionStart === null ? instructionTicks.length !== 0 : instructionTicks[0] !== instructionStart) {
        throw new Error('Invalid Recorder instruction endpoint');
    }
    let snapshots: Array<{ id: number; depth: number; unit: 'frame' | 'instruction' | 'tip' }> | undefined;
    if (t.snapshots !== undefined) {
        if (!Array.isArray(t.snapshots) || t.snapshots.length === 0 || t.snapshots.length > 5002) {
            throw new Error('Invalid Recorder snapshot list');
        }
        let previous = oldest - 1;
        snapshots = Array.from(t.snapshots, entry => {
            if (!Array.isArray(entry) || entry.length !== 3) { throw new Error('Invalid Recorder snapshot'); }
            const target = integer(entry[0], newest);
            const unit = entry[2];
            if (target <= previous || (unit !== 'frame' && unit !== 'instruction' && unit !== 'tip')
                || (unit === 'tip') !== (target === newest)) { throw new Error('Invalid Recorder snapshot order or unit'); }
            previous = target;
            return { id: target, depth: integer(entry[1], unit === 'tip' ? 0 : unit === 'frame' ? 3000 : 1000), unit };
        });
        if (snapshots[0].id !== oldest || previous !== newest || !snapshots.some(snapshot => snapshot.id === id)) {
            throw new Error('Recorder snapshot list is missing a required position');
        }
    }
    return { oldest, newest, instructionStart, frameTicks: ticks(t.frameTicks, 301, oldest), instructionTicks,
        ...(snapshots ? { snapshots } : {}) };
}

export function decodeRecorderStatus(value: unknown) {
    const s = expectRecord(value, 'Recorder status');
    const attached = flag(s.attached);
    if (!attached && (s.position !== null || s.timeline !== null)) { throw new Error('Detached Recorder contains history'); }
    const position = attached ? decodePosition(s.position) : null;
    const timeline = position ? decodeTimeline(s.timeline, position.id) : null;
    const frameCheckpoints = integer(s.frameCheckpoints, 3000);
    const frameStepsBack = integer(s.frameStepsBack, frameCheckpoints);
    const frameStepsForward = integer(s.frameStepsForward, frameCheckpoints);
    const instructionStepsBack = integer(s.instructionStepsBack, 1000);
    const instructionStepsForward = integer(s.instructionStepsForward, 1000);
    if (frameStepsBack + frameStepsForward + Number(position?.atFrameCheckpoint ?? false) !== frameCheckpoints
        || instructionStepsBack + instructionStepsForward > 1000
        || (!attached && (frameCheckpoints || instructionStepsBack || instructionStepsForward))) {
        throw new Error('Inconsistent Recorder navigation counts');
    }
    return { attached, running: flag(s.running), revision: integer(s.revision), frameCheckpoints,
        frameStepsBack, frameStepsForward, instructionStepsBack, instructionStepsForward, position, timeline };
}

export type RecorderStatus = ReturnType<typeof decodeRecorderStatus>;

export function decodeRecorderMove(value: unknown) {
    const r = expectRecord(value, 'Recorder move');
    const moved = flag(r.moved);
    if (moved !== (r.stopSequence !== undefined)) { throw new Error('Invalid Recorder stop sequence'); }
    return { moved, status: decodeRecorderStatus(r.status), stopSequence: moved ? integer(r.stopSequence) : undefined };
}