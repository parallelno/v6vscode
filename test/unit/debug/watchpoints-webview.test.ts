import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

describe('Watchpoints webview editing', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../../../src/debug/views/assets/watchpoints.js'),
        'utf8',
    );

    it('cancels Escape edits before submit and deferred focus-out handling', () => {
        expect(source).to.include('if (canceled || submitting) return;');
        expect(source).to.match(/if \(event\.key === 'Escape'\) \{[\s\S]*?canceled = true;[\s\S]*?render\(\);\s*\}/);
        expect(source).to.include('if (!canceled && !row.contains(document.activeElement)) row.requestSubmit();');
    });

    it('uses only the custom preview tooltip for display rows', () => {
        expect(source).not.to.include('address.title = entry.globalAddr');
        expect(source).to.include("row.addEventListener('mouseenter', event => schedulePreview");
    });

    it('opens bulk actions from empty table space without replacing row menus', () => {
        expect(source).to.include("table.addEventListener('contextmenu'");
        expect(source).to.include("!event.target.closest('.row')) openMenu(event, null);");
        expect(source).to.include("row.addEventListener('contextmenu', event => openMenu(event, entry.id))");
    });

    it('disables bulk mutation actions when there are no watchpoints', () => {
        expect(source).to.include('const noEntries = entries.length === 0;');
        expect(source).to.include("id === null && noEntries && ['disableAll', 'deleteAll'].includes(action)");
    });
});