import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Performance webview contract', () => {
    const panel = read('src/debug/views/performance-panel.ts');
    const script = read('src/debug/views/assets/performance.js');
    const styles = read('src/debug/views/assets/performance.css');

    it('renders the specified table and statistics without HTML injection', () => {
        for (const heading of ['Activity', 'Name', 'Start', 'End', 'Statistics']) {
            expect(panel).to.include(`>${heading}</span>`);
        }
        expect(script).to.include('average cc: ${Math.round(entry.averageClockCycles)}, tests: ${entry.testCount}');
        expect(script).to.include("name.title = entry.name");
        expect(script).not.to.include('activity-label');
        expect(script).not.to.include("entry.active ? 'Active' : 'Disabled'");
        expect(script).not.to.include('innerHTML');
    });

    it('separates activity, editing, and source-navigation gestures', () => {
        expect(script).to.include("input.addEventListener('click', event => event.stopPropagation())");
        expect(script).to.include("post({ type: 'setActivity', id: entry.id, active: input.checked })");
        expect(script).to.include("editable.addEventListener('dblclick'");
        expect(script).to.include("post({ type: 'reveal', id: entry.id })");
        expect(script).to.include("active.type = 'checkbox'");
    });

    it('keeps invalid drafts open with accessible field-level errors', () => {
        expect(script).to.include("input.classList.add('invalid')");
        expect(script).to.include("input.setAttribute('aria-describedby', 'live')");
        expect(script).to.include('if (!input) return');
        expect(script).to.include('editDraft[key] = input.value');
        expect(script).to.include('control.disabled = !canMutate || submitting');
        expect(styles).to.include('.invalid');
    });

    it('submits and renders address expressions without evaluating them in the webview', () => {
        expect(script).to.include('addrStart: addrStart.value, addrEnd: addrEnd.value');
        expect(script).to.include("cell(entry.addrStart, 'editable')");
        expect(script).to.include("cell(entry.addrEnd, 'editable')");
        expect(script).to.include('start.title = entry.addrStart; end.title = entry.addrEnd');
        expect(script).to.include("message.field === 'addrStart' ? 'Start' : 'End'");
        expect(script).not.to.include('function parseAddress');
    });

    it('uses compact activity and name tracks with wider address columns', () => {
        expect(styles).to.include('minmax(31px, .3fr)');
        expect(styles).to.include('minmax(63px, .7fr)');
        expect(styles.match(/minmax\(92px, \.85fr\)/g)).to.have.length(2);
        expect(styles).to.include('justify-content: center');
    });

    it('keeps menu actions ordered and dismisses menus when the panel hides', () => {
        const rowMenu = panel.match(/<div id="menu".*?<\/div>/s)?.[0] ?? '';
        const listMenu = panel.match(/<div id="list-menu".*?<\/div>/s)?.[0] ?? '';
        expect([...rowMenu.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]))
            .to.deep.equal(['disable', 'disableAll', 'delete', 'deleteAll']);
        expect([...listMenu.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]))
            .to.deep.equal(['add', 'disableAll', 'deleteAll']);
        expect(panel).to.include("this.post({ type: 'dismissMenus' })");
        expect(script).to.include("message.type === 'dismissMenus'");
    });
});