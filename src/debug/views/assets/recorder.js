/* global acquireVsCodeApi */
(() => {
    const vscode = acquireVsCodeApi();
    const panelToken = document.body.dataset.panelToken;
    const timeline = /** @type {HTMLInputElement} */ (document.getElementById('timeline'));
    const label = document.getElementById('status');
    const oldest = document.getElementById('oldest');
    const selected = document.getElementById('selected');
    const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('button[data-action]')]);
    const back = /** @type {HTMLButtonElement} */ (document.getElementById('timeline-back'));
    const forward = /** @type {HTMLButtonElement} */ (document.getElementById('timeline-forward'));
    const controls = {
        backFrame: { key: 'frameStepsBack', steps: 1 }, backInstruction100: { key: 'instructionStepsBack', steps: 100 },
        backInstruction: { key: 'instructionStepsBack', steps: 1 }, forwardInstruction: { key: 'instructionStepsForward', steps: 1 },
        forwardInstruction100: { key: 'instructionStepsForward', steps: 100 }, forwardFrame: { key: 'frameStepsForward', steps: 1 },
    };
    let snapshot;

    let pendingSelection;
    let busy = false;

    function stepAction(direction) {
        const start = snapshot?.timeline?.instructionStart;
        const id = snapshot?.position?.id;
        const instruction = direction === 'back' ? 'backInstruction' : 'forwardInstruction';
        const frame = direction === 'back' ? 'backFrame' : 'forwardFrame';
        if (start != null && id != null && id >= start && snapshot[controls[instruction].key] > 0) { return instruction; }
        return frame;
    }

    function lockNavigation() {
        timeline.disabled = back.disabled = forward.disabled = true;
        buttons.forEach(button => { button.disabled = true; });
    }

    function move(action) {
        pendingSelection = undefined;
        lockNavigation();
        vscode.postMessage({ type: 'move', action, expectedRevision: snapshot.revision, panelToken });
    }

    function depth(position) {
        if (!position) { return '—'; }
        if (position.unit === 'tip') { return '0'; }
        return `${-position.depth} ${position.unit === 'instruction' ? 'instr' : 'frame'}`;
    }

    timeline.addEventListener('input', () => {
        const position = snapshot?.timeline?.snapshots?.[Number(timeline.value)];
        if (!position || timeline.disabled) { return; }
        pendingSelection = { targetId: position.id, expectedRevision: snapshot.revision };
        selected.textContent = depth(position);
        timeline.setAttribute('aria-valuetext', depth(position));
    });
    timeline.addEventListener('change', () => {
        const choice = pendingSelection;
        pendingSelection = undefined;
        if (!choice || busy || timeline.disabled || choice.targetId === snapshot?.position?.id) { return; }
        lockNavigation();
        vscode.postMessage({ type: 'move', action: 'seek', ...choice, panelToken });
    });

    window.addEventListener('message', ({ data }) => {
        if (data?.type !== 'status') { return; }
        const changed = snapshot?.revision !== data.snapshot?.revision || !data.snapshot;
        snapshot = data.snapshot;
        busy = data.busy;
        if (changed || busy) { pendingSelection = undefined; }
        const p = snapshot?.position;
        label.textContent = data.error ?? (!snapshot?.attached ? 'Recorder requires an attached debugger.' : snapshot.running
            ? 'Recording — pause to navigate.' : !p ? 'No recorded position.' :
                `Frame ${p.frameNumber} · PC 0x${p.pc.toString(16).padStart(4, '0')} · ${snapshot.frameCheckpoints} frame checkpoints`);
        buttons.forEach(button => {
            const { key, steps } = controls[button.dataset.action];
            const count = Math.min(snapshot?.[key] ?? 0, steps);
            const unsupported = steps > 1 && !data.instructionJumps;
            button.disabled = data.busy || !snapshot?.attached || snapshot.running || count === 0 || unsupported;
            button.title = unsupported ? 'Requires a newer v6emul build' : `${count} available`;
            button.setAttribute('aria-label', `${button.textContent}: ${button.title}`);
        });
        const snapshots = snapshot?.timeline?.snapshots ?? [];
        timeline.max = String(Math.max(0, snapshots.length - 1));
        timeline.disabled = busy || !snapshot?.attached || snapshot.running || snapshots.length < 2;
        timeline.title = snapshot?.attached && !snapshot.running && !snapshot.timeline?.snapshots
            ? 'Snapshot scrolling requires a newer v6emul build' : '';
        for (const { button, direction } of [{ button: back, direction: 'back' }, { button: forward, direction: 'forward' }]) {
            const action = stepAction(direction);
            button.disabled = busy || !snapshot?.attached || snapshot.running || !snapshot.position || !(snapshot[controls[action].key] > 0);
            button.title = `Step ${direction} one ${action.endsWith('Instruction') ? 'instruction' : 'frame'}`;
            button.setAttribute('aria-label', button.title);
        }
        oldest.textContent = depth(snapshots[0]);
        if (!pendingSelection) {
            const index = snapshots.findIndex(position => position.id === p?.id);
            timeline.value = String(Math.max(0, index));
            selected.textContent = depth(snapshots[index]);
            timeline.setAttribute('aria-valuetext', selected.textContent);
        }
    });
    buttons.forEach(button => button.addEventListener('click', () => {
        if (!snapshot || button.disabled) { return; }
        move(button.dataset.action);
    }));
    back.addEventListener('click', () => { if (!back.disabled) { move(stepAction('back')); } });
    forward.addEventListener('click', () => { if (!forward.disabled) { move(stepAction('forward')); } });
    vscode.postMessage({ type: 'ready', panelToken });
})();