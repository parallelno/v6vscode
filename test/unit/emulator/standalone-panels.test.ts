import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Standalone emulator panels', () => {
    it('keeps the Display webview free of the redundant toolbar and control messages', () => {
        const html = read('src/emulator/panel/assets/panel.html');
        const script = read('src/emulator/panel/assets/panel.js');
        for (const obsolete of ['btn-run-pause', 'btn-reset', 'sel-speed', 'sel-display']) {
            expect(html).not.to.include(obsolete);
            expect(script).not.to.include(obsolete);
        }
        for (const obsoleteMessage of ["type: 'run'", "type: 'pause'", "type: 'reset'", "type: 'setSpeed'", "type: 'setViewMode'"]) {
            expect(script).not.to.include(obsoleteMessage);
        }
    });

    it('owns Hex Viewer and Watchpoints as WebviewPanels with complete panel APIs', () => {
        for (const provider of ['src/debug/views/hex-viewer-provider.ts', 'src/debug/views/watchpoints-provider.ts']) {
            const source = read(provider);
            expect(source).to.include('createWebviewPanel(');
            expect(source).to.include('this.panel.reveal();');
            expect(source).not.to.include('this.panel.reveal(vscode.ViewColumn.Beside);');
            expect(source).not.to.include('implements vscode.WebviewViewProvider');
            for (const method of ['open()', 'close()', 'toggle()', 'isOpen()']) {
                expect(source).to.include(method);
            }
        }
    });

    it('opens standalone panels for Add and Find in Hex Viewer handoffs', () => {
        const source = read('src/debug/views/watchpoints-provider.ts');
        expect(source).to.include('this.open();');
        expect(source).to.include('this.hexViewer.open();');
        expect(source).not.to.include("executeCommand('v6.hexViewer.focus')");
    });
});