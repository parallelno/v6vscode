import { EventEmitter } from 'events';
import { expect } from 'chai';
import { ScriptOverlayService } from '../../../src/debug/scripts/script-overlay-service';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

class FakeLifecycle extends EventEmitter {
    connected = true;
    serverInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test',
        commands: [IpcCommand.DEBUG_SCRIPT_OVERLAY_GET],
        capabilities: {
            debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1,
            scriptOverlaySchema: 1, scriptOverlayRetained: true, scriptOverlayConsumesUpdates: true,
            scriptOverlayVectorScreenCoords: true, scriptOverlayColorFormat: 'RRGGBBAA',
            scriptOverlayLimits: {
                maxItemsPerScript: 4, maxItemsTotal: 8, maxTextBytes: 32, maxCoordinateMagnitude: 1000,
            },
        },
    };
}

describe('ScriptOverlayService', () => {
    it('merges consuming deltas, retains empty responses, and reconciles script removal', async () => {
        const lifecycle = new FakeLifecycle();
        const scripts = new EventEmitter();
        const responses = [
            { overlays: [{
                scriptId: 2, itemId: 1, vectorScreenCoords: true, x: 1, y: 2,
                color: 0xFFFFFFFF, type: 'text', text: 'first',
            }] },
            { overlays: [] },
            { overlays: [{
                scriptId: 2, itemId: 1, vectorScreenCoords: true, x: 3, y: 4,
                color: 0x00FF00FF, type: 'rect', width: 5, height: 6, filled: false,
            }] },
        ];
        const client = {
            send: async (command: IpcCommand) => {
                expect(command).to.equal(IpcCommand.DEBUG_SCRIPT_OVERLAY_GET);
                return { ok: true, data: responses.shift() };
            },
        };
        const service = new ScriptOverlayService(lifecycle as any, client as any, scripts as any);

        await service.refresh();
        await service.refresh();
        expect(service.snapshot).to.have.length(1);
        await service.refresh();
        expect(service.snapshot[0]).to.include({ type: 'rect', x: 3, y: 4 });
        scripts.emit('overlayRemove', 2);
        expect(service.snapshot).to.deep.equal([]);
        service.dispose();
    });

    it('clears its retained cache when ScriptService resets the session', async () => {
        const lifecycle = new FakeLifecycle();
        const scripts = new EventEmitter();
        const client = { send: async () => ({ ok: true, data: { overlays: [{
            scriptId: 1, itemId: 1, vectorScreenCoords: false, x: 0, y: 0,
            color: 0xFFFFFFFF, type: 'text', text: 'cached',
        }] } }) };
        const service = new ScriptOverlayService(lifecycle as any, client as any, scripts as any);
        await service.refresh();
        scripts.emit('sessionReset');
        expect(service.snapshot).to.deep.equal([]);
        service.dispose();
    });

    it('does not expose overlay support without the independent capability contract', () => {
        const lifecycle = new FakeLifecycle();
        lifecycle.serverInfo = {
            ...lifecycle.serverInfo,
            commands: [],
        };
        const service = new ScriptOverlayService(lifecycle as any, {} as any, new EventEmitter() as any);
        expect(service.available).to.equal(false);
        service.dispose();
    });

    it('keeps the retained cache while Display panels close and reopen', async () => {
        const lifecycle = new FakeLifecycle();
        const scripts = new EventEmitter();
        const client = { send: async () => ({ ok: true, data: { overlays: [{
            scriptId: 1, itemId: 1, vectorScreenCoords: false, x: 0, y: 0,
            color: 0xFFFFFFFF, type: 'text', text: 'retained',
        }] } }) };
        const service = new ScriptOverlayService(lifecycle as any, client as any, scripts as any);
        await service.refresh();
        expect(service.snapshot).to.have.length(1);
        expect(service.snapshot[0]).to.include({ type: 'text', text: 'retained' });
        service.dispose();
    });

    it('rejects an in-flight delta after script removal invalidates the cache generation', async () => {
        const lifecycle = new FakeLifecycle();
        const scripts = new EventEmitter();
        let respond: ((value: unknown) => void) | undefined;
        const client = {
            send: async () => new Promise(resolve => { respond = resolve; }),
        };
        const service = new ScriptOverlayService(lifecycle as any, client as any, scripts as any);
        const refresh = service.refresh();
        await Promise.resolve();
        scripts.emit('overlayRemove', 2);
        respond!({ ok: true, data: { overlays: [{
            scriptId: 2, itemId: 1, vectorScreenCoords: true, x: 1, y: 2,
            color: 0xFFFFFFFF, type: 'text', text: 'stale',
        }] } });
        await expectRejected(refresh, 'inactive connection');
        expect(service.snapshot).to.deep.equal([]);
        service.dispose();
    });
});

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
    try {
        await promise;
        expect.fail('Expected promise to reject');
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.contain(message);
    }
}
