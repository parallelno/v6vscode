import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { V6DebugConfigurationProvider } from '../../../src/debug/configuration/debug-configuration-provider';
import { V6DebugAdapterFactory } from '../../../src/debug/adapter/v6-debug-adapter-factory';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { artifactRepository } from '../../../src/debug/metadata/artifact-repository';
import { buildDebugIndex } from '../../../src/debug/metadata/debug-index';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('Captured project source anchor through configuration, factory and DAP', () => {
    for (const mode of ['project', 'session', 'workspace', 'none'] as const) {
        it(`captures the ${mode} anchor before an awaited launch`, async () => {
            const root = path.resolve('source-anchor-workspace');
            let project = { name: 'game', uri: vscode.Uri.file(path.join(root, 'nested', 'game.project.json')),
                run: { executable: __filename, debugArtifact: path.join(root, 'nested', 'out', 'game.elf') } };
            const selectedRoot = path.dirname(project.uri.fsPath);
            const sessionRoot = path.join(root, 'second-workspace');
            const logger = { debug() {}, info() {}, error() {} };
            const provider = new V6DebugConfigurationProvider({ resolve: async () => project } as never, logger as never);
            const config = (await provider.resolveDebugConfiguration(undefined, { type: 'v6', request: 'launch', name: 'game' }))!;
            if (mode !== 'project') { delete config.__v6SourceRoot; }
            const originalLoad = artifactRepository.load;
            const originalFolders = vscode.workspace.workspaceFolders;
            let release!: () => void;
            const lease = { assertCurrent() {}, send: async (command: IpcCommand) => ({ ok: true,
                data: command === IpcCommand.GET_REGS ? { pc: 0x100, sp: 0x200, af: 0, bc: 0, de: 0, hl: 0, m: 0 } : {} }) };
            const lifecycle = { startDebug: async () => {
                await new Promise<void>(resolve => { release = resolve; });
                return { process: { spawnResult: { exitPromise: new Promise(() => {}) } }, port: 9876 };
            }, captureSession: () => lease, serverInfo: undefined };
            const factory = new V6DebugAdapterFactory(lifecycle as never, { reveal() {} } as never, logger as never,
                { resolveExtensionPath: () => 'boot.bin' } as never, () => ({ get: () => undefined }) as never, undefined as never, undefined as never);
            try {
                (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = mode === 'none' ? undefined : [{ uri: vscode.Uri.file(root) }];
                artifactRepository.load = async () => ({ index: buildDebugIndex([
                    { address: 0x100, file: 'src/main.asm', line: 7, column: 2, isStmt: true },
                ], [], ''), metadata: undefined, validationWarning: undefined, compDir: '', version: 'test', artifactPath: '', executablePath: '' });
                const descriptor = factory.createDebugAdapterDescriptor({ id: 'source-anchor',
                    workspaceFolder: mode === 'project' || mode === 'session' ? { uri: vscode.Uri.file(sessionRoot) } : undefined,
                } as vscode.DebugSession) as unknown as { adapter: V6DebugAdapter };
                const adapter = descriptor.adapter;
                const responses: Array<{ type?: string; request_seq?: number; success?: boolean; body?: { stackFrames?: Array<{ source?: { path: string } }> } }> = [];
                const listener = adapter.onDidSendMessage(message => responses.push(message));
                const request = async (seq: number, command: string, args: unknown) => {
                    adapter.handleMessage({ type: 'request', seq, command, arguments: args });
                    for (let i = 0; i < 100 && !responses.some(message => message.request_seq === seq); i++) { await new Promise(resolve => setTimeout(resolve, 1)); }
                    const response = responses.find(message => message.request_seq === seq);
                    assert.ok(response, `Missing ${command} response`); assert.strictEqual(response.success, true);
                    return response;
                };
                const launched = request(1, 'launch', config);
                project = { ...project, uri: vscode.Uri.file(path.join(root, 'different', 'other.project.json')) };
                (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = [{ uri: vscode.Uri.file(path.join(root, 'other-workspace')) }];
                release(); await launched;
                const stack = await request(2, 'stackTrace', { threadId: 1 });
                const anchor = mode === 'project' ? selectedRoot : mode === 'session' ? sessionRoot : mode === 'workspace' ? root : '';
                assert.strictEqual(stack.body?.stackFrames?.[0].source?.path, path.join(anchor, 'src', 'main.asm'));
                listener.dispose();
                adapter.dispose();
            } finally {
                artifactRepository.load = originalLoad;
                (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = originalFolders;
            }
        });
    }
});