import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { revealDebugSource } from '../../../src/debug/views/debug-source-navigation';

describe('revealDebugSource', () => {
    const vscodeApi = vscode as any;
    let projectRoot: string;
    let sourcePath: string;
    let sourceUri: any;
    let document: any;
    let editor: any;
    let openCalls: any[];
    let showCalls: any[][];

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-source-navigation-'));
        sourcePath = path.join(projectRoot, 'src', 'main.asm');
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, 'first\nsecond\n');
        sourceUri = vscode.Uri.file(sourcePath);
        document = {
            uri: sourceUri,
            lineCount: 2,
            lineAt: (line: number) => ({ text: line === 0 ? 'first' : 'second' }),
        };
        editor = {
            document,
            viewColumn: 2,
            selection: undefined,
            revealRange: () => {},
        };
        openCalls = [];
        showCalls = [];
        vscodeApi.window.visibleTextEditors = [];
        vscodeApi.window.tabGroups = { all: [] };
        vscodeApi.workspace.openTextDocument = async (uri: any) => {
            openCalls.push(uri);
            return document;
        };
        vscodeApi.window.showTextDocument = async (...args: any[]) => {
            showCalls.push(args);
            return editor;
        };
    });

    afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    it('focuses the existing visible editor without reopening its document', async () => {
        vscodeApi.window.visibleTextEditors = [editor];

        await revealDebugSource({ file: sourcePath, line: 2, column: 2, isStmt: true }, projectRoot);

        expect(openCalls).to.deep.equal([]);
        expect(showCalls).to.deep.equal([[document, 2, false]]);
        expect(editor.selection.anchor).to.include({ line: 1, character: 1 });
    });

    it('reveals an inactive open tab in its existing editor group', async () => {
        vscodeApi.window.tabGroups.all = [{
            viewColumn: 3,
            tabs: [{ input: new vscodeApi.TabInputText(sourceUri) }],
        }];

        await revealDebugSource({ file: sourcePath, line: 1, column: 1, isStmt: true }, projectRoot);

        expect(openCalls).to.deep.equal([sourceUri]);
        expect(showCalls[0][1]).to.deep.equal({ viewColumn: 3, preserveFocus: false });
    });

    it('opens a preview only when the source file is not already open', async () => {
        await revealDebugSource({ file: sourcePath, line: 1, column: 1, isStmt: true }, projectRoot);

        expect(openCalls).to.deep.equal([sourceUri]);
        expect(showCalls[0][1]).to.deep.equal({ preview: true });
    });
});