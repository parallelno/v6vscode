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

    it('clears every session-backed panel when the emulator lifecycle stops', () => {
        const displayProvider = read('src/emulator/panel/emulator-panel.ts');
        const displayScript = read('src/emulator/panel/assets/panel.js');
        expect(displayProvider).to.include('this.postMessage(this.viewModel.makeResetMessage())');
        expect(displayScript).to.include("case 'reset':");
        expect(displayScript).to.include('ctx.clearRect(0, 0, canvas.width, canvas.height)');

        for (const provider of [
            'src/debug/views/hex-viewer-provider.ts',
            'src/debug/views/ports-provider.ts',
            'src/debug/views/hardware-statistics-provider.ts',
            'src/debug/views/watchpoints-provider.ts',
            'src/debug/views/symbols-panel.ts',
        ]) {
            const source = read(provider);
            const disconnected = source.indexOf('if (!this.lifecycle.connected)');
            const panelVisibility = source.indexOf('if (!this.panel?.visible)', disconnected);
            const viewVisibility = source.indexOf('if (!this.view?.visible)', disconnected);
            const visibility = panelVisibility >= 0 ? panelVisibility : viewVisibility;
            expect(disconnected, `${provider} has a disconnected-session branch`).to.be.at.least(0);
            expect(visibility, `${provider} clears before its visibility guard`).to.be.greaterThan(disconnected);
        }

        const symbols = read('src/debug/views/symbols-panel.ts');
        expect(symbols).to.include("if (state === 'stopped') { this.clearSession(); }");
        expect(symbols).to.include('this.symbols.clear();');

        const adapter = read('src/debug/adapter/v6-debug-adapter.ts');
        expect(adapter).to.include('this.lifecycle.disconnect();');
    });

    it('owns Hex Viewer, Symbols, Ports, and Watchpoints as WebviewPanels with complete panel APIs', () => {
        for (const provider of ['src/debug/views/hex-viewer-provider.ts', 'src/debug/views/symbols-panel.ts', 'src/debug/views/ports-provider.ts', 'src/debug/views/watchpoints-provider.ts']) {
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

    it('marks changed port cells visually and accessibly', () => {
        const script = read('src/debug/views/assets/ports.js');
        const styles = read('src/debug/views/assets/ports.css');
        expect(script).to.include("if (didChange) cell.className = 'changed'");
        expect(script).to.include("didChange ? ' (changed)' : ''");
        expect(styles).to.include('.port-grid .changed');
    });

    it('keeps port tables compact with stable fixed-size cells', () => {
        const styles = read('src/debug/views/assets/ports.css');
        expect(styles).to.include('--port-cell-size: 22px');
        expect(styles).to.include('--port-table-width: 376px');
        expect(styles).to.include('height: 20px');
        expect(styles).to.include('font-size: 11px');
    });
});