import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const ROOT = process.cwd();
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
            'src/debug/views/memory-edits-panel.ts',
            'src/debug/views/performance-panel.ts',
            'src/debug/views/trace-log-panel.ts',
            'src/debug/views/scripts-panel.ts',
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

    it('owns standalone debug tools as WebviewPanels with complete panel APIs', () => {
        for (const provider of ['src/debug/views/hex-viewer-provider.ts', 'src/debug/views/memory-edits-panel.ts', 'src/debug/views/performance-panel.ts', 'src/debug/views/trace-log-panel.ts', 'src/debug/views/scripts-panel.ts', 'src/debug/views/symbols-panel.ts', 'src/debug/views/ports-provider.ts', 'src/debug/views/watchpoints-provider.ts']) {
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

    it('uses a title-bar action to add memory edits', () => {
        const manifest = JSON.parse(read('package.json'));
        const command = manifest.contributes.commands.find((item: { command: string }) => item.command === 'v6.addMemoryEdit');
        const titleActions = manifest.contributes.menus['editor/title'];
        const addAction = titleActions.find((item: { command: string }) => item.command === 'v6.addMemoryEdit');
        const refreshAction = titleActions.find((item: { command: string }) => item.command === 'v6.refreshMemoryEdits');
        expect(command).to.include({ title: 'Add Memory Edit', icon: '$(add)' });
        expect(addAction).to.include({ when: 'activeWebviewPanelId == v6.memoryEdits', group: 'navigation@1' });
        expect(refreshAction.group).to.equal('navigation@2');

        const panel = read('src/debug/views/memory-edits-panel.ts');
        const script = read('src/debug/views/assets/memory-edits.js');
        expect(panel).to.include("this.post({ type: 'beginAdd' })");
        expect(panel).not.to.include('id="add"');
        expect(script).to.include("message.type === 'beginAdd' && canMutate");
        expect(script).not.to.include('addButton');
    });

    it('routes Hex Viewer writes through MemoryEditService and exposes every Memory Edits row action', () => {
        const hexViewer = read('src/debug/views/hex-viewer-provider.ts');
        expect(hexViewer).to.include('this.memoryEdits.apply(');
        expect(hexViewer).not.to.include('this.memory.writeByte(');
        expect(hexViewer).to.include('message.previousValue');
        expect(read('src/debug/views/assets/hex-viewer.js')).to.include('previousValue: byteEdit.previousValue');

        const panel = read('src/debug/views/memory-edits-panel.ts');
        const entryMenu = panel.match(/<div id="menu".*?<\/div>/s)?.[0] ?? '';
        const tableMenu = panel.match(/<div id="list-menu".*?<\/div>/s)?.[0] ?? '';
        for (const action of [
            'copyOriginal', 'copyEntered', 'copyCurrent', 'reveal',
            'disable', 'restore', 'delete', 'deleteAndRestore', 'deleteAndRestoreAll',
        ]) {
            expect(entryMenu).to.include(`data-action="${action}"`);
        }
        for (const action of ['add', 'disable', 'disableAll', 'delete', 'deleteAll', 'deleteAndRestoreAll']) {
            expect(tableMenu).to.include(`data-action="${action}"`);
        }
        expect(panel).to.include('this.service.restoreRetaining(');
        expect(panel).to.include('this.service.deleteAndRestore(');
        expect(panel).to.include('this.service.deleteAndRestoreAll()');
        expect(panel).to.include('this.service.apply(message.globalAddr, message.value)');
        expect(panel).to.include('this.service.setActivity(message.globalAddr, message.enabled)');
        expect(panel).to.include('this.service.disableAll()');
        expect(panel).to.include('this.service.deleteAll()');
        const script = read('src/debug/views/assets/memory-edits.js');
        expect(script).to.include("button.dataset.action !== 'add' && entries.length === 0");
        expect(script).to.include("table.addEventListener('contextmenu'");
        expect(script).to.include("empty.addEventListener('contextmenu'");
        expect(script).to.include("input.type = 'checkbox'");
        expect(script).to.include('draftAddress = addressInput.value');
        expect(script).to.include('draftValue = valueInput.value');
        expect(script).to.include('addressInput.value = draftAddress');
        expect(script).to.include('valueInput.value = draftValue');
        expect(script).to.include('if (editingAddress === null && !adding) render()');
        expect(script).to.include("if (event.key === 'Enter' && !event.isComposing)");
        expect(script).to.include('row.requestSubmit()');
    });

    it('contributes the Performance panel with editing, navigation, and bulk actions', () => {
        const manifest = JSON.parse(read('package.json'));
        const titleActions = manifest.contributes.menus['editor/title'];
        expect(titleActions.find((item: { command: string }) => item.command === 'v6.addPerformance'))
            .to.include({ when: 'activeWebviewPanelId == v6.performance', group: 'navigation@1' });
        expect(titleActions.find((item: { command: string }) => item.command === 'v6.refreshPerformance'))
            .to.include({ when: 'activeWebviewPanelId == v6.performance', group: 'navigation@2' });

        const panel = read('src/debug/views/performance-panel.ts');
        const script = read('src/debug/views/assets/performance.js');
        const entryMenu = panel.match(/<div id="menu".*?<\/div>/s)?.[0] ?? '';
        const listMenu = panel.match(/<div id="list-menu".*?<\/div>/s)?.[0] ?? '';
        for (const action of ['disable', 'disableAll', 'delete', 'deleteAll']) {
            expect(entryMenu).to.include(`data-action="${action}"`);
        }
        for (const action of ['add', 'disableAll', 'deleteAll']) {
            expect(listMenu).to.include(`data-action="${action}"`);
        }
        expect(panel).to.include('this.symbols.sourceAtExactAddress(entry.addrStart)');
        expect(script).to.include("post({ type: 'setActivity', id: entry.id, active: input.checked })");
        expect(script).to.include("editable.addEventListener('dblclick'");
        expect(script).to.include("post({ type: 'reveal', id: entry.id })");
        expect(script).to.include('draft[key] = input.value');
        expect(script).to.include('if (editingId === null && !adding) render()');
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