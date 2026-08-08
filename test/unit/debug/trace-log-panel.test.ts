import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Trace Log panel', () => {
    const panel = read('src/debug/views/trace-log-panel.ts');
    const script = read('src/debug/views/assets/trace-log.js');
    const styles = read('src/debug/views/assets/trace-log.css');

    it('contributes toggle and title refresh commands after Performance', () => {
        const manifest = JSON.parse(read('package.json'));
        expect(manifest.contributes.commands.find((item: { command: string }) => item.command === 'v6emul.toggleTraceLog'))
            .to.include({ title: 'Trace Log', category: 'v6emul' });
        expect(manifest.contributes.commands.find((item: { command: string }) => item.command === 'v6.refreshTraceLog'))
            .to.include({ title: 'Refresh Trace Log', icon: '$(refresh)' });
        expect(manifest.contributes.menus['editor/title'].find((item: { command: string }) => item.command === 'v6.refreshTraceLog'))
            .to.include({ when: 'activeWebviewPanelId == v6.traceLog', group: 'navigation' });

        const launcher = read('src/emulator/panel/emulator-panel-launcher-view.ts');
        expect(launcher.indexOf("label: 'Trace Log'")).to.be.greaterThan(launcher.indexOf("label: 'Performance'"));
        expect(launcher.indexOf("label: 'Trace Log'")).to.be.lessThan(launcher.indexOf("label: 'Symbols'"));
    });

    it('uses shared language presentation with exact-source fallback', () => {
        expect(panel).to.include('this.symbols.sourceAtExactAddress(address)');
        expect(panel).to.include('this.presentation.presentSourceLine(source, this.sourceContext)');
        expect(panel).to.include('presented ?? this.presentation.presentStandaloneLine(instruction)');
        expect(panel).to.include('this.symbolLinks.resolve(row.view.listing, { start, length }, this.sourceContext)');
        expect(panel).not.to.include('innerHTML');
    });

    it('keeps protocol and breakpoint ownership outside the webview', () => {
        expect(panel).to.include('new vscode.SourceBreakpoint(');
        expect(panel).to.include('vscode.debug.addBreakpoints(');
        expect(panel).to.include('vscode.debug.removeBreakpoints(');
        expect(panel).not.to.include('DEBUG_BREAKPOINT_');
        expect(script).not.to.include('DEBUG_TRACE_LOG_');
        expect(script).to.include("type: 'action', generation, index: row.index");
        expect(script).to.include("type: 'link', generation, index: row.index");
    });

    it('virtualizes all results with bounded rows and three retained windows', () => {
        expect(script).to.include('const ROW_HEIGHT = 26');
        expect(script).to.include('const OVERSCAN = 8');
        expect(script).to.include('totalMatches * ROW_HEIGHT');
        expect(script).to.include('.slice(0, 3)');
        expect(script).to.include('window.setTimeout(() =>');
        expect(script).to.include('}, 50)');
        expect(script).to.include('new ResizeObserver(render)');
        expect(styles).to.include('position: absolute');
        expect(styles).to.include('--trace-row-height: 26px');
    });

    it('renders listings as text and preserves valid query history behavior', () => {
        expect(script).to.include('part.textContent = row.listing.slice(start, end)');
        expect(script).not.to.include('innerHTML');
        expect(script).to.include("query.addEventListener('input'");
        expect(script).to.include("event.key === 'ArrowUp'");
        expect(script).to.include("event.key === 'ArrowDown'");
        expect(script).to.include('history = history.slice(-50)');
        expect(script).to.include('queryValid && query.value.trim()');
    });
});