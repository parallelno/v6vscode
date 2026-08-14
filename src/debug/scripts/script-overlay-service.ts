import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { ScriptOverlayItem, ScriptOverlayLimits } from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validateScriptOverlayServer } from '../../emulator/protocol/ipc-server-info';
import { decodeScriptOverlayResponse } from './script-overlay-codec';
import { ScriptService } from './script-service';

export class ScriptOverlayService extends EventEmitter {
    private readonly entries = new Map<string, ScriptOverlayItem>();
    private snapshotEntries: readonly ScriptOverlayItem[] = Object.freeze([]);
    private queue: Promise<void> = Promise.resolve();
    private refreshInFlight: Promise<readonly ScriptOverlayItem[]> | undefined;
    private generation = 0;
    private readonly overlayRemovalListener: (scriptId: number) => void;
    private readonly clearListener: () => void;
    private readonly sessionResetListener: () => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
        scripts: ScriptService,
    ) {
        super();
        this.overlayRemovalListener = scriptId => this.removeScript(scriptId);
        this.clearListener = () => this.clear();
        this.sessionResetListener = () => this.reset();
        scripts.on('overlayRemove', this.overlayRemovalListener);
        scripts.on('overlayClear', this.clearListener);
        scripts.on('sessionReset', this.sessionResetListener);
        this.scripts = scripts;
    }

    private readonly scripts: ScriptService;

    get snapshot(): readonly ScriptOverlayItem[] { return this.snapshotEntries; }
    get available(): boolean {
        try { this.requireAvailable(); return true; } catch { return false; }
    }

    refresh(): Promise<readonly ScriptOverlayItem[]> {
        if (this.refreshInFlight) { return this.refreshInFlight; }
        const refresh = this.enqueue(() => this.refreshNow());
        this.refreshInFlight = refresh;
        void refresh.finally(() => {
            if (this.refreshInFlight === refresh) { this.refreshInFlight = undefined; }
        }).catch(() => undefined);
        return refresh;
    }

    dispose(): void {
        this.scripts.removeListener('overlayRemove', this.overlayRemovalListener);
        this.scripts.removeListener('overlayClear', this.clearListener);
        this.scripts.removeListener('sessionReset', this.sessionResetListener);
        this.removeAllListeners();
    }

    private async refreshNow(): Promise<readonly ScriptOverlayItem[]> {
        const info = this.requireAvailable();
        const generation = this.generation;
        const response = await this.client.send<unknown>(IpcCommand.DEBUG_SCRIPT_OVERLAY_GET, {}, 5000, 'normal');
        const result = decodeScriptOverlayResponse(this.responseData(response), overlayLimits(info));
        if (generation !== this.generation) { throw new Error('Script overlay response belongs to an inactive connection'); }
        for (const overlay of result.overlays) { this.entries.set(key(overlay), overlay); }
        if (result.overlays.length) { this.publish(); }
        return this.snapshotEntries;
    }

    private removeScript(scriptId: number): void {
        this.generation++;
        let changed = false;
        for (const [entryKey, overlay] of this.entries) {
            if (overlay.scriptId === scriptId) { this.entries.delete(entryKey); changed = true; }
        }
        if (changed) { this.publish(); }
    }

    private clear(): void {
        this.generation++;
        if (!this.entries.size) { return; }
        this.entries.clear();
        this.publish();
    }

    private reset(): void {
        this.generation++;
        this.entries.clear();
        this.publish();
    }

    private publish(): void {
        this.snapshotEntries = Object.freeze([...this.entries.values()]
            .sort(compare)
            .map(overlay => Object.freeze({ ...overlay })));
        this.emit('change', this.snapshotEntries);
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private requireAvailable(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validateScriptOverlayServer(info);
        return info;
    }

    private responseData(response: IpcResponse<unknown>): unknown {
        if (!response.ok || response.data === undefined) {
            throw new Error(response.error ?? 'Unable to read script overlays');
        }
        return response.data;
    }
}

function overlayLimits(info: GetServerInfoResponse): ScriptOverlayLimits {
    const limits = info.capabilities.scriptOverlayLimits;
    if (!limits) { throw new Error('Script overlay limits are missing'); }
    return limits;
}

function key(overlay: ScriptOverlayItem): string {
    return `${overlay.scriptId}:${overlay.itemId}`;
}

function compare(left: ScriptOverlayItem, right: ScriptOverlayItem): number {
    return left.scriptId - right.scriptId || left.itemId - right.itemId;
}