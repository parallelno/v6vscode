import { expect } from 'chai';
import { decodeRecorderMove, decodeRecorderMoveInput, decodeRecorderStatus, RECORDER_ACTIONS } from '../../../src/emulator/protocol/recorder-models';

describe('Recorder protocol', () => {
    const status = {
        attached: true, running: false, revision: 10, frameCheckpoints: 2,
        frameStepsBack: 1, frameStepsForward: 1, instructionStepsBack: 1, instructionStepsForward: 2,
        position: { id: 40, pc: 0x100, frameNumber: 5, atFrameCheckpoint: false, atRecordedTip: false },
        timeline: { oldest: 1, newest: 45, instructionStart: 37, frameTicks: [1, 42], instructionTicks: [37, 40, 41, 45] },
    };

    it('decodes all actions and keeps counts independent of sampled ticks', () => {
        for (const action of RECORDER_ACTIONS) {
            expect(decodeRecorderMoveInput({ action, expectedRevision: 10 })).to.deep.equal({ action, expectedRevision: 10 });
        }
        expect(decodeRecorderStatus(status)).to.deep.equal(status);
        expect(decodeRecorderMove({ moved: true, status, stopSequence: 23 }).stopSequence).to.equal(23);
        expect(decodeRecorderMove({ moved: false, status }).stopSequence).to.equal(undefined);
    });

    it('rejects invalid positions, tick ordering, counts, and move replies', () => {
        expect(() => decodeRecorderMoveInput({ action: 'clear', expectedRevision: 10 })).to.throw();
        expect(() => decodeRecorderMoveInput({ action: 'backFrame', expectedRevision: -1 })).to.throw();
        expect(() => decodeRecorderStatus({ ...status, position: { ...status.position, id: 46 } })).to.throw();
        expect(() => decodeRecorderStatus({ ...status, timeline: { ...status.timeline, frameTicks: [42, 1] } })).to.throw();
        expect(() => decodeRecorderStatus({ ...status, instructionStepsBack: 999 })).to.throw();
        expect(() => decodeRecorderMove({ moved: true, status })).to.throw();
        expect(() => decodeRecorderMove({ moved: false, status, stopSequence: 0 })).to.throw();
    });
});