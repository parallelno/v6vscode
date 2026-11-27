import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

describe('Recorder timeline webview', () => {
    it('labels both history ranges and seeks only when the selection is committed', () => {
        const source = readFileSync(resolve(__dirname, '../../../src/debug/views/assets/recorder.js'), 'utf8');
        const actions = ['backFrame', 'backInstruction100', 'backInstruction', 'forwardInstruction', 'forwardInstruction100', 'forwardFrame'];
        const button = (action: string) => ({ dataset: { action }, textContent: action, disabled: true, title: '',
            handler: () => {}, setAttribute() {}, addEventListener(_event: string, callback: () => void) { this.handler = callback; } });
        const buttons = actions.map(button);
        const back = button(''), forward = button('');
        const outbound: unknown[] = [];
        let receive: (event: unknown) => void = () => {};
        const handlers = new Map<string, () => void>();
        const timeline = { max: '0', value: '0', disabled: true, setAttribute() {},
            addEventListener: (event: string, callback: () => void) => handlers.set(event, callback) };
        const status = { textContent: '' }, oldest = { textContent: '' }, selected = { textContent: '' };
        const elements = { timeline, status, oldest, selected, 'timeline-back': back, 'timeline-forward': forward };
        runInNewContext(source, {
            acquireVsCodeApi: () => ({ postMessage: (message: unknown) => outbound.push(message) }),
            document: { body: { dataset: { panelToken: 'recorder-token' } }, querySelectorAll: () => buttons,
                getElementById: (id: keyof typeof elements) => elements[id] },
            window: { addEventListener: (_event: string, callback: (event: unknown) => void) => { receive = callback; } },
        });
        const snapshot = { attached: true, running: false, revision: 64, frameCheckpoints: 2, frameStepsBack: 1,
            frameStepsForward: 0, instructionStepsBack: 100, instructionStepsForward: 12,
            position: { id: 9905, frameNumber: 2, pc: 0x100 },
            timeline: { instructionStart: 9000, snapshots: [{ id: 0, depth: 400, unit: 'frame' }, { id: 9905, depth: 12, unit: 'instruction' },
                { id: 10000, depth: 0, unit: 'tip' }] } };
        receive({ data: { type: 'status', snapshot, busy: false } });
        expect(buttons.map(button => button.disabled)).to.deep.equal([false, true, false, false, true, true]);
        receive({ data: { type: 'status', snapshot, busy: false, instructionJumps: true } });
        expect(buttons.map(button => button.disabled)).to.deep.equal([false, false, false, false, false, true]);
        expect(buttons[4].title).to.equal('12 available');
        expect(buttons[1].title).to.equal('100 available');
        expect(status.textContent).to.contain('PC 0x0100');
        expect(oldest.textContent).to.equal('-400 frame');
        expect(selected.textContent).to.equal('-12 instr');
        expect(timeline.max).to.equal('2');
        timeline.value = '0';
        handlers.get('input')!();
        expect(selected.textContent).to.equal('-400 frame');
        expect(outbound).to.have.length(1);
        handlers.get('change')!();
        expect(outbound[1]).to.deep.equal({ type: 'move', action: 'seek', targetId: 0, expectedRevision: 64, panelToken: 'recorder-token' });
        receive({ data: { type: 'status', snapshot, busy: false, instructionJumps: true } });
        buttons[4].handler();
        buttons[4].handler();
        expect(outbound).to.have.length(3);
        expect(outbound[2]).to.deep.equal({ type: 'move', action: 'forwardInstruction100', expectedRevision: 64, panelToken: 'recorder-token' });
        receive({ data: { type: 'status', snapshot, busy: false } });
        expect(back.title).to.equal('Step back one instruction');
        back.handler();
        expect(outbound[3]).to.include({ action: 'backInstruction', expectedRevision: 64 });
        expect(forward.disabled).to.equal(true);
        receive({ data: { type: 'status', snapshot, busy: false } });
        forward.handler();
        expect(outbound[4]).to.include({ action: 'forwardInstruction' });
        receive({ data: { type: 'status', busy: false, snapshot: { ...snapshot, revision: 65,
            position: { ...snapshot.position, id: 0 }, frameStepsBack: 0, frameStepsForward: 1 } } });
        expect(back.disabled).to.equal(true);
        expect(forward.title).to.equal('Step forward one frame');
        forward.handler();
        expect(outbound[5]).to.include({ action: 'forwardFrame', expectedRevision: 65 });
        receive({ data: { type: 'status', busy: false, snapshot: { ...snapshot,
            timeline: { ...snapshot.timeline, instructionStart: snapshot.position.id }, instructionStepsBack: 0 } } });
        back.handler();
        expect(outbound[6]).to.include({ action: 'backFrame' });
    });
});