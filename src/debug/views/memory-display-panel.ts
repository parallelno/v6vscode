import type * as vscode from 'vscode';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import type { SessionCoordinator, SessionLease } from '../../emulator/session/session-coordinator';
import { PanelHost } from '../../platform/webview/panel-host';
import { webviewDocument } from '../../platform/webview/webview-document';
import { globalAddressMemoryLocation, MEMORY_BANK_SIZE, RAM_DISK_BANK_COUNT, RAM_DISK_COUNT } from '../../shared/memory-space';
import type { MemoryNavigation } from './navigation-ports';

const ENABLE = IpcCommand.DEBUG_MEMORY_DISPLAY_ENABLE;
const SNAPSHOT = IpcCommand.DEBUG_MEMORY_DISPLAY_SNAPSHOT;
const SAMPLE_DELAY_MS = 100;
const KEEPALIVE_MS = 750;

type Message = { type: 'ready' } | { type: 'refresh' } | { type: 'select'; bank: number } | { type: 'reveal'; bank: number; offset: number };

function decode(value: unknown): Message | undefined {
    const { type, bank, offset } = value as Record<string, unknown>;
    if (type === 'ready' || type === 'refresh') { return { type }; }
    if (typeof bank !== 'number' || !Number.isInteger(bank) || bank < 0 || bank > RAM_DISK_COUNT * RAM_DISK_BANK_COUNT) { return; }
    if (type === 'select') { return { type, bank }; }
    if (type === 'reveal' && typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && offset < MEMORY_BANK_SIZE) {
        return { type, bank, offset };
    }
}

function bankBuffer(value: unknown): ArrayBuffer {
    if (!(value instanceof Uint8Array) || value.length !== MEMORY_BANK_SIZE) { throw new Error('Invalid memory snapshot'); }
    // Send only this field, not the whole backing IPC frame.
    return Uint8Array.from(value).buffer;
}

export class MemoryDisplayPanel implements vscode.Disposable {
    private readonly host: PanelHost<Message>;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private active = false;
    private busy = false;
    private bank = 0;
    private revision = 0;
    private dirty = true;
    private lease: SessionLease | undefined;

    constructor(extensionUri: vscode.Uri, private readonly lifecycle: SessionCoordinator,
        private readonly hex: MemoryNavigation, onOpen: (open: boolean) => void) {
        this.host = new PanelHost(extensionUri, 'v6.memoryDisplay', 'Memory Display', {
            document: (webview, assets, token) => webviewDocument(webview, assets, {
                title: 'Memory Display', asset: 'memory-display', token, body: `
<div class="toolbar">
    <label>Memory <select id="disk"><option value="0">Main RAM</option>${Array.from({ length: RAM_DISK_COUNT }, (_, i) => `<option value="${i + 1}">RAM Disk ${i + 1}</option>`).join('')}</select></label>
    <label id="page-label" hidden>Page <select id="page">${Array.from({ length: RAM_DISK_BANK_COUNT }, (_, i) => `<option>${i}</option>`).join('')}</select></label>
    <label>Highlight <select id="mode"><option value="rw">Reads and writes</option><option value="r">Reads</option><option value="w">Writes</option></select></label>
    <button id="zoom-out" aria-label="Zoom out">−</button><output id="zoom">100%</output><button id="zoom-in" aria-label="Zoom in">+</button>
    <button id="refresh">Refresh</button>
</div>
<p class="help">Blue: reads · Red: writes · Brighter: more recent · Ctrl+wheel: zoom · Click a byte to open Hex Viewer</p>
<output id="status" aria-live="polite"></output><output id="address"></output>
<div class="viewport"><canvas id="map" width="1024" height="512" aria-label="Memory bit map" hidden></canvas></div>`,
            }),
            decode,
            message: async message => this.handle(message),
            visibility: visible => this.setActive(visible),
            closed: () => this.setActive(false),
            failed: error => this.status(String(error)),
        }, onOpen);
    }

    toggle(): void { if (this.host.panel) { this.host.close(); } else { this.host.open(); } }
    dispose(): void { this.host.dispose(); }

    private handle(message: Message): void {
        if (message.type === 'ready') { this.bank = 0; this.setActive(this.host.visible); return; }
        if (message.type === 'refresh') { this.invalidate(); return; }
        if (message.type === 'select') { this.bank = message.bank; this.invalidate(); return; }
        if (!this.host.visible || message.bank !== this.bank || !this.lease?.connected) { return; }
        const { space, offset } = globalAddressMemoryLocation(message.bank * MEMORY_BANK_SIZE + message.offset);
        this.hex.revealRange(space, offset, offset);
        this.hex.open();
    }

    private setActive(active: boolean): void {
        if (this.active === active) { return; }
        this.active = active;
        if (active) {
            this.lifecycle.on('stateChange', this.invalidate);
            this.status('Waiting for memory…');
        } else {
            this.lifecycle.off('stateChange', this.invalidate);
            const lease = this.lease;
            this.lease = undefined;
            if (lease?.connected) { void lease.send(ENABLE, { enabled: false }, 1500, 'low').catch(() => {}); }
        }
        this.invalidate();
    }

    private readonly invalidate = (): void => {
        this.revision++;
        this.dirty = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.active && !this.busy) { void this.sample(); }
    };

    private async sample(): Promise<void> {
        if (!this.active || this.busy) { return; }
        const { serverInfo } = this.lifecycle;
        if (!this.lifecycle.connected || !serverInfo) { this.status('Start or attach to v6emul to view memory.'); return; }
        if (serverInfo.capabilities.memoryDisplaySchema !== 1 || !serverInfo.commands.includes(ENABLE) || !serverInfo.commands.includes(SNAPSHOT)) {
            this.status('Memory Display requires a newer v6emul with memory display schema 1.'); return;
        }
        const revision = this.revision;
        const bank = this.bank;
        const snapshot = this.dirty || this.lifecycle.running;
        this.busy = true;
        try {
            const lease = this.lifecycle.captureSession();
            this.lease = lease;
            const response = await (snapshot
                ? lease.send<{ bank: number; bytes: unknown; reads: unknown; writes: unknown }>(SNAPSHOT, { bank }, 1500, 'low')
                : lease.send(ENABLE, { enabled: true }, 1500, 'low'));
            if (!this.active || revision !== this.revision) { return; }
            if (!response.ok) { throw new Error(response.error ?? 'Memory Display request failed'); }
            if (snapshot) {
                const data = response.data as { bank: number; bytes: unknown; reads: unknown; writes: unknown } | undefined;
                if (data?.bank !== bank) { throw new Error('Unexpected memory snapshot bank'); }
                this.host.post({ type: 'snapshot', bank, bytes: bankBuffer(data.bytes), reads: bankBuffer(data.reads), writes: bankBuffer(data.writes),
                    tracking: this.lifecycle.connectionSnapshot.debuggerAttached });
            }
            this.dirty = false;
        } catch (error) {
            if (this.active && revision === this.revision) {
                this.dirty = true;
                this.status(error instanceof Error ? error.message : 'Memory Display request failed');
            }
        } finally {
            this.busy = false;
            if (this.active) {
                const delay = revision !== this.revision ? 0 : this.lifecycle.running ? SAMPLE_DELAY_MS : KEEPALIVE_MS;
                this.timer = setTimeout(() => { this.timer = undefined; void this.sample(); }, delay);
            }
        }
    }

    private status(text: string): void { this.host.post({ type: 'status', text }); }
}