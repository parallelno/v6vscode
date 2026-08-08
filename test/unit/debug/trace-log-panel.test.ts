import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { TraceLogPanel } from '../../../src/debug/views/trace-log-panel';

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
        expect(panel).to.include('row.presentation.text,');
        expect(panel).to.include('{ start: originalStart, length }');
        expect(panel).not.to.include('innerHTML');
    });

    it('keeps protocol and breakpoint ownership outside the webview', () => {
        expect(panel).to.include('new vscode.SourceBreakpoint(');
        expect(panel).to.include('vscode.debug.addBreakpoints(');
        expect(panel).to.include('vscode.debug.removeBreakpoints(');
        expect(panel).not.to.include('this.service.entry(index)');
        expect(panel).to.include('canToggleBreakpoint: sourceBacked');
        expect(panel).not.to.include('DEBUG_BREAKPOINT_');
        expect(script).not.to.include('DEBUG_TRACE_LOG_');
        expect(script).to.include("type: 'action', generation, index: row.index");
        expect(script).to.include("type: 'link', generation, index: row.index");
        expect(script).to.include("action(row, 'toggleBreakpoint')");
        expect(script).to.include("breakpoint.className = 'breakpoint-toggle'");
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
        expect(styles).to.include('#spacer { position: relative; min-width: 100%; }');
        expect(script).to.include('viewport.scrollLeft = 0');
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

    it('matches the registered editor token colors and removes source indentation', () => {
        const manifest = JSON.parse(read('package.json'));
        const rules = manifest.contributes.configurationDefaults['editor.tokenColorCustomizations'].textMateRules;
        const color = (scope: string) => rules.find((rule: { scope: string | string[] }) =>
            Array.isArray(rule.scope) ? rule.scope.includes(scope) : rule.scope === scope).settings.foreground;
        expect(styles).to.include(`.token-line-comment { color: ${color('comment.line.v6vscode_8080')}; }`);
        expect(styles).to.include(`.token-global-label { color: ${color('keyword.globallabel.v6vscode_8080')}; }`);
        expect(styles).to.include(`.token-local-label { color: ${color('keyword.locallabel.v6vscode_8080')}; }`);
        expect(styles).to.include(`.token-constant { color: ${color('keyword.constantslabel.v6vscode_8080')}; }`);
        expect(styles).to.include(`.token-instruction { color: ${color('keyword.instruction.v6vscode_8080')}; }`);
        expect(styles).to.include(`.token-register { color: ${color('keyword.register.v6vscode_8080')}; }`);
        expect(panel).to.include('leadingWhitespaceLength(presentation.text)');
        expect(panel).to.include('presentation.text.slice(listingOffset)');
        expect(panel).to.include('shiftRanges(presentation.highlights, listingOffset)');
    });

    it('adds and removes a source breakpoint from retained row data without a service cache entry', async () => {
        const debug = vscode.debug as typeof vscode.debug & { breakpoints: vscode.Breakpoint[] };
        debug.breakpoints.splice(0);
        const service = { activeFilter: { generation: 7 }, setVisible: () => {} };
        const instance = new TraceLogPanel(
            vscode.Uri.file(ROOT),
            { on: () => {}, removeListener: () => {} } as never,
            service as never,
            {} as never,
            {} as never,
            {} as never,
            { getActiveProject: () => undefined } as never,
            {} as never,
            { error: () => {} } as never,
        );
        const host = instance as unknown as {
            projectRoot: string;
            rows: Map<number, unknown>;
            runAction(index: number, action: string): Promise<void>;
        };
        host.projectRoot = ROOT;
        host.rows.set(3, {
            address: 0x1234,
            listingOffset: 0,
            source: { file: 'src/main.asm', line: 4, column: 1, isStmt: true },
            presentation: { text: 'nop', highlights: [], links: [] },
            view: {
                index: 3, address: '0x1234', listing: 'nop', highlights: [], links: [],
                sourceBacked: true, breakpoint: false, canToggleBreakpoint: true,
            },
        });

        await host.runAction(3, 'toggleBreakpoint');
        expect(debug.breakpoints).to.have.length(1);
        expect((debug.breakpoints[0] as vscode.SourceBreakpoint).location.range.start.line).to.equal(3);

        await host.runAction(3, 'toggleBreakpoint');
        expect(debug.breakpoints).to.be.empty;
        instance.dispose();
    });
});