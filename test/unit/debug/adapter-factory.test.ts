import { expect } from 'chai';
import * as vscode from 'vscode';
import { V6DebugAdapterFactory, registerDebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter-factory';

describe('V6DebugAdapterFactory adapter lifecycle', () => {
    function makeFactory(): V6DebugAdapterFactory {
        return new V6DebugAdapterFactory(
            {} as any,
            {} as any,
            { error: () => {}, info: () => {} } as any,
            {} as any,
            () => ({ get: () => undefined }) as any,
            {} as any,
            {} as any,
        );
    }

    function terminate(sessionId: string): void {
        for (const listener of (vscode.debug as any)._terminateListeners) {
            listener({ id: sessionId, type: 'v6' });
        }
    }

    it('creates an inline adapter per session', () => {
        const factory = makeFactory();
        const descriptor = factory.createDebugAdapterDescriptor({ id: 's1' } as any);
        expect(descriptor).to.be.instanceOf(vscode.DebugAdapterInlineImplementation);
    });

    it('clears the active adapter when its session terminates', () => {
        const factory = makeFactory();
        factory.createDebugAdapterDescriptor({ id: 's1' } as any);
        expect((factory as any).activeAdapter).to.not.equal(undefined);

        factory.handleSessionTerminated({ id: 's1' } as any);

        expect((factory as any).activeAdapter).to.equal(undefined);
        expect(() => factory.reset()).to.throw('No active V6 debug session');
    });

    it('keeps the newest session adapter while an older one terminates', () => {
        const factory = makeFactory();
        factory.createDebugAdapterDescriptor({ id: 's1' } as any);
        const second = factory.createDebugAdapterDescriptor({ id: 's2' } as any);

        factory.handleSessionTerminated({ id: 's1' } as any);

        expect((factory as any).activeAdapter).to.equal((second as any).adapter);

        factory.handleSessionTerminated({ id: 's2' } as any);

        expect((factory as any).activeAdapter).to.equal(undefined);
    });

    it('ignores termination of sessions it does not own', () => {
        const factory = makeFactory();
        const first = factory.createDebugAdapterDescriptor({ id: 's1' } as any);

        factory.handleSessionTerminated({ id: 'unrelated-session' } as any);

        expect((factory as any).activeAdapter).to.equal((first as any).adapter);
    });

    it('wires session termination through registerDebugAdapter', () => {
        const subscriptions: { dispose(): void }[] = [];
        const context = { subscriptions } as unknown as vscode.ExtensionContext;
        const before = (vscode.debug as any)._terminateListeners.length;

        registerDebugAdapter(
            context,
            {} as any,
            {} as any,
            { error: () => {}, info: () => {} } as any,
            {} as any,
            () => ({ get: () => undefined }) as any,
            {} as any,
            {} as any,
            {} as any,
        );

        expect((vscode.debug as any)._terminateListeners.length).to.equal(before + 1);
        expect(subscriptions.length).to.be.greaterThan(0);

        for (const subscription of subscriptions) { subscription.dispose(); }
    });
});