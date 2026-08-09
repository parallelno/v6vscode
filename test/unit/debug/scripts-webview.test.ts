import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Scripts webview contract', () => {
    const panel = read('src/debug/views/scripts-panel.ts');
    const script = read('src/debug/views/assets/scripts.js');
    const styles = read('src/debug/views/assets/scripts.css');

    it('renders the required table and ordered actions', () => {
        for (const heading of ['Compilation', 'Activity', 'Name', 'Path']) {
            expect(panel).to.include(`>${heading}</span>`);
        }
        const menu = panel.match(/<div id="menu".*?<\/div>/s)?.[0] ?? '';
        expect([...menu.matchAll(/data-action="([^"]+)"/g)].map(match => match[1])).to.deep.equal([
            'copy', 'add', 'compile', 'runOnce', 'disable', 'disableAll', 'delete', 'deleteAll',
        ]);
    });

    it('uses safe text rendering, field copy, editing, and accessible error indicators', () => {
        expect(script).not.to.include('innerHTML');
        expect(script).to.include("post({ type: 'copy', scriptId, field })");
        expect(script).to.include("editable.addEventListener('dblclick'");
        expect(script).to.include("event.key === 'Enter'");
        expect(script).to.include("event.key === 'Escape'");
        expect(script).to.include("entry.compilation.status === 'error'");
        expect(script).to.include("entry.runtime.status === 'error'");
        expect(styles).to.include('.row.error:not(.selected)');
        expect(styles).to.include('var(--vscode-errorForeground)');
    });

    it('supports wildcard filtering and independent running-state gates', () => {
        expect(script).to.include("pattern.includes('*')");
        expect(script).to.include('canRunOnce');
        expect(panel).to.include('scriptMutationsWhileRunning');
        expect(panel).to.include('scriptRunOnceWhileRunning');
        expect(panel).to.include('this.service.refreshIfChanged()');
    });
});
