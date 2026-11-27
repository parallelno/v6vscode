import { expect } from 'chai';
import { EventEmitter } from 'events';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import vscode = require('vscode');
import { ScriptsPanel } from '../../../src/debug/views/scripts-panel';
import { scriptExamples } from '../../../src/debug/scripts/script-help';
import type { ScriptInput } from '../../../src/emulator/protocol/debug-models';
import type { ScriptsWebviewMessage } from '../../../src/debug/views/scripts-messages';

describe('Scripts panel example actions', () => {
    it('copies on activation, does not save on cancel, adds on OK, and never overwrites', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'v6-script-example-'));
        const project = { projectPath: path.join(dir, 'demo.project.json'), executable: path.join(dir, 'demo.rom') };
        const lifecycle = Object.assign(new EventEmitter(), {
            sessionProject: project, running: false, captureSession: () => ({ assertCurrent() {} }),
        });
        const added: ScriptInput[] = [];
        const copied: string[] = [];
        const errors: string[] = [];
        const service = Object.assign(new EventEmitter(), {
            available: true, sessionGeneration: 1, add: async (input: ScriptInput) => { added.push(input); },
        });
        const mock = vscode as unknown as { env: typeof vscode.env; window: typeof vscode.window; workspace: typeof vscode.workspace };
        const { env, window, workspace } = mock;
        let answer: string | undefined;
        let detail: string | undefined;
        Object.assign(mock, {
            env: { clipboard: { writeText: async (value: string) => { copied.push(value); } } },
            workspace: { ...workspace, isTrusted: true },
            window: { ...window, showWarningMessage: async (_message: string, options: { detail: string }) => {
                detail = options.detail;
                return answer;
            }, showErrorMessage: async (message: string) => { errors.push(message); } },
        });
        const panel = new ScriptsPanel(vscode.Uri.file(dir), lifecycle as any, service as any, {} as any,
            { error: (message: string) => { errors.push(message); } } as any);
        const example = scriptExamples[0];
        const destination = path.join(dir, example.filename);
        const send = (message: ScriptsWebviewMessage) => (panel as any).handleMessage(message) as Promise<void>;
        const activate = () => send({ type: 'useHelpItem', generation: 1, catalog: 'examples', id: example.id });
        try {
            await send({ type: 'useHelpItem', generation: 1, catalog: 'intrinsics', id: 'GetPC' });
            await activate();
            expect(copied).to.deep.equal(['GetPC()', example.code]);
            expect(detail).to.include(destination);
            expect(added).to.deep.equal([]);
            expect(await readFile(destination).catch((error: NodeJS.ErrnoException) => error.code)).to.equal('ENOENT');
            answer = 'OK';
            await activate();
            expect(await readFile(destination, 'utf8')).to.equal(example.code);
            expect(added).to.deep.equal([{ name: example.label, path: destination.replace(/\\/g, '/'), active: false }]);
            await activate();
            expect(added).to.have.length(1);
            expect(errors).to.have.length(1);
        } finally {
            panel.dispose();
            Object.assign(mock, { env, window, workspace });
            await rm(dir, { recursive: true, force: true });
        }
    });
});