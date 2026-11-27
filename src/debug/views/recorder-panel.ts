import * as vscode from 'vscode';
import { SessionCoordinator, SessionLease } from '../../emulator/session/session-coordinator';
import { decodeRecorderMoveInput, RecorderMove, RecorderStatus, supportsRecorder } from '../../emulator/protocol/recorder-models';
import { moveRecorder, readRecorder } from '../../emulator/session/recorder-service';
import { ProtocolError } from '../../emulator/protocol/protocol-result';
import { PanelHost } from '../../platform/webview/panel-host';
import { webviewDocument } from '../../platform/webview/webview-document';

export const CMD_REFRESH_RECORDER = 'v6.refreshRecorder';
type Message = { type: 'ready' } | ({ type: 'move' } & RecorderMove);

function decodeMessage(value: unknown): Message | undefined {
    const msg = value as { type?: unknown } | undefined;
    if (msg?.type === 'ready') { return { type: 'ready' }; }
    if (msg?.type === 'move') {
        try { return { type: 'move', ...decodeRecorderMoveInput(value) }; } catch { return undefined; }
    }
    return undefined;
}

export class RecorderPanel implements vscode.Disposable {
    private readonly host: PanelHost<Message>;
    private status?: RecorderStatus;
    private lease?: SessionLease;
    private inFlight = false;
    private refreshRequest = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private readonly changed = () => { void this.refresh(); };

    constructor(uri: vscode.Uri, private readonly lifecycle: SessionCoordinator,
        private readonly debugMove: (input: RecorderMove, assertCurrent: () => void) => Promise<RecorderStatus>,
        openChanged: (open: boolean) => void) {
        this.host = new PanelHost(uri, 'v6.recorder', 'Recorder', {
            document: (webview, assets, token) => webviewDocument(webview, assets, {
                title: 'Recorder', asset: 'recorder', token, body: `
<p id="status" role="status">Connecting to Recorder…</p>
<div class="timeline-row" role="group" aria-label="Snapshot scrollbar">
<button id="timeline-back" class="timeline-arrow" aria-label="Previous snapshot" disabled>◀</button>
<input id="timeline" type="range" min="0" max="0" value="0" step="1" aria-label="Recorded snapshot" disabled>
<button id="timeline-forward" class="timeline-arrow" aria-label="Next snapshot" disabled>▶</button>
</div>
<div class="bounds"><span id="oldest" title="Oldest snapshot">—</span><output id="selected" for="timeline">—</output><span title="Newest snapshot">0</span></div>
<div class="controls" role="group" aria-label="Recorder navigation">
<button data-action="backFrame" disabled>Back Frame</button>
<button data-action="backInstruction100" disabled>Back 100 Instructions</button>
<button data-action="backInstruction" disabled>Back Instruction</button>
<button data-action="forwardInstruction" disabled>Forward Instruction</button>
<button data-action="forwardInstruction100" disabled>Forward 100 Instructions</button>
<button data-action="forwardFrame" disabled>Forward Frame</button>
</div>`,
            }),
            decode: decodeMessage, message: async msg => msg.type === 'ready' ? this.refresh() : this.move(msg),
            visibility: visible => { if (visible) { void this.refresh(); } else { this.stopPolling(); } },
            closed: () => { this.stopPolling(); this.status = undefined; this.lease = undefined; },
            failed: error => this.publish(error instanceof Error ? error.message : String(error)),
        }, openChanged);
        lifecycle.on('stateChange', this.changed);
    }

    toggle(): void { if (this.host.panel) { this.host.close(); } else { this.host.open(); } }
    dispose(): void { this.stopPolling(); this.lifecycle.removeListener('stateChange', this.changed); this.host.dispose(); }

    private publish(error?: string): void {
        this.host.post({ type: 'status', snapshot: this.status, busy: this.inFlight, error,
            instructionJumps: this.lifecycle.serverInfo?.capabilities.recorderInstructionJumps100 === true });
    }

    private stopPolling(): void { clearTimeout(this.timer); this.timer = undefined; }

    async refresh(): Promise<void> {
        this.stopPolling();
        if (!this.host.visible || this.inFlight) { return; }
        const request = ++this.refreshRequest;
        const current = this.host.capture();
        if (!this.lifecycle.connected || !supportsRecorder(this.lifecycle.serverInfo)) {
            this.status = undefined;
            this.lease = undefined;
            this.publish(this.lifecycle.connected ? 'This v6emul build does not support Recorder.' : 'No active emulator session.');
            return;
        }
        let lease: SessionLease | undefined;
        try {
            lease = this.lifecycle.captureSession();
            const status = await readRecorder(lease);
            if (!current() || !this.host.visible || this.inFlight || request !== this.refreshRequest) { return; }
            if (this.lease?.key === lease.key && this.status && status.revision < this.status.revision) { return; }
            this.status = status;
            this.lease = lease;
            this.publish();
            this.stopPolling();
            this.timer = setTimeout(this.changed, status.running ? 500 : 1000);
        } catch (error) {
            if (!current() || request !== this.refreshRequest || this.inFlight) { return; }
            try { lease?.assertCurrent(); } catch { return; }
            this.status = undefined;
            this.publish(error instanceof Error ? error.message : String(error));
            if (this.host.visible && this.lifecycle.connected) { this.timer = setTimeout(this.changed, 1000); }
        }
    }

    private async move(input: RecorderMove): Promise<void> {
        const lease = this.lease;
        const jump = input.action === 'backInstruction100' || input.action === 'forwardInstruction100';
        if (!lease || !this.host.visible || this.inFlight || !this.status?.attached || this.status.running
            || (input.action === 'seek' && (this.lifecycle.serverInfo?.capabilities.recorderSeek !== true
                || !this.status.timeline?.snapshots?.some(snapshot => snapshot.id === input.targetId)))
            || (jump && this.lifecycle.serverInfo?.capabilities.recorderInstructionJumps100 !== true)
            || input.expectedRevision !== this.status.revision || !supportsRecorder(this.lifecycle.serverInfo)) {
            this.publish();
            return;
        }
        const current = this.host.capture();
        const assertCurrent = () => {
            lease.assertCurrent();
            if (!current() || !this.host.visible) { throw new Error('Recorder panel is no longer active'); }
        };
        this.inFlight = true;
        this.refreshRequest++;
        this.stopPolling();
        this.publish();
        let errorText: string | undefined;
        try {
            assertCurrent();
            let status: RecorderStatus;
            const mode = this.lifecycle.connectionSnapshot.mode;
            if (mode === 'debug' || mode === 'attach') {
                status = await this.debugMove(input, assertCurrent);
            } else {
                const result = await moveRecorder(lease, input);
                if (result.moved) { this.lifecycle.notifyPositionChange(lease); }
                status = result.status;
            }
            assertCurrent();
            this.status = status;
        } catch (error) {
            if (current()) {
                this.status = undefined;
                if (!(error instanceof ProtocolError && error.reason === 'stale_revision')) {
                    errorText = error instanceof Error ? error.message : String(error);
                }
            }
        } finally {
            this.inFlight = false;
            if (current()) { this.publish(errorText); }
            if (!current() || !errorText) { await this.refresh(); }
            else if (this.host.visible) { this.timer = setTimeout(this.changed, 1000); }
        }
    }
}