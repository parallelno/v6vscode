import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import { scriptExamples, scriptIntrinsics } from '../../../src/debug/scripts/script-help';

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('Scripts webview contract', () => {
    const panel = read('src/debug/views/scripts-panel.ts');
    const script = read('src/debug/views/assets/scripts.js');
    const styles = read('src/debug/views/assets/scripts.css');

    it('ships searchable help, all grouped intrinsics, and distinct example files', () => {
        const help = read('src/debug/views/assets/script-help.js');
        for (const id of ['examples-toggle', 'intrinsics-toggle', 'catalog-search', 'catalog-preview', 'script-guide']) {
            expect(panel).to.include(`id="${id}"`);
        }
        expect(script).to.include("from './script-help.js'");
        expect(help).to.include("['focus', 'pointerenter']");
        expect(help).to.include("event.key === 'Enter'");
        expect(help).not.to.include('innerHTML');
        expect(new Set(scriptIntrinsics.map(entry => entry.group)).size).to.equal(6);
        expect(scriptIntrinsics.map(entry => entry.id)).to.have.members([
            'GetCC', 'GetPC', 'GetSP', 'GetMachineCycles', 'GetOpcode', 'GetPSW', 'GetBC', 'GetDE', 'GetHL',
            'GetA', 'GetF', 'GetB', 'GetC', 'GetD', 'GetE', 'GetH', 'GetL', 'GetFlagS', 'GetFlagZ', 'GetFlagAC',
            'GetFlagP', 'GetFlagC', 'GetINTE', 'GetIFF', 'GetHLTA', 'GetByteGlobal', 'GetLabelAddr', 'Break', 'DrawText', 'DrawRect',
        ]);
        expect(new Set(scriptExamples.map(entry => entry.filename)).size).to.equal(7);
        expect(scriptExamples.every(entry => /^v6-[a-z-]+\.lua$/.test(entry.filename) && entry.code && entry.help)).to.equal(true);
    });

    it('renders the required table and ordered actions', () => {
        for (const heading of ['Compilation', 'Activity', 'Use ELF Symbols', 'Name', 'Path']) {
            expect(panel).to.include(`>${heading}</span>`);
        }
        const menu = panel.match(/<div id="menu".*?<\/div>/s)?.[0] ?? '';
        expect([...menu.matchAll(/data-action="([^"]+)"/g)].map(match => match[1])).to.deep.equal([
            'copy', 'add', 'compile', 'runOnce', 'disable', 'disableAll', 'delete', 'deleteAll',
        ]);
    });

    it('exposes the persisted ELF option in display and draft rows', () => {
        expect(script).to.include('checkboxCell(entry, true)');
        expect(script).to.include("symbols.setAttribute('aria-label', 'Use ELF Symbols')");
        expect(script).to.include("type: 'setDebugSymbols', scriptId: entry.scriptId, enabled: input.checked");
        expect(script).to.include('useDebugSymbols: false');
        expect(script).to.include('active.checked, symbols.checked');
        expect(panel).to.include('useDebugSymbols: message.enabled');
    });

    it('uses safe text rendering, field copy, editing, and accessible error indicators', () => {
        expect(script).not.to.include('innerHTML');
        expect(script).to.include("post({ type: 'copy', scriptId, field })");
        expect(script).to.include("editable.addEventListener('dblclick'");
        expect(script).to.include('bindEditKeys(row,');
        expect(script).to.include('markInvalid(input, message, live, status)');
        expect(script).to.include("entry.compilation.status === 'error'");
        expect(script).to.include("entry.runtime.status === 'error'");
        expect(styles).to.include('.row.error:not(.selected)');
        expect(styles).to.include('var(--vscode-errorForeground)');
    });

    it('supports wildcard filtering and independent running-state gates', () => {
        expect(script).to.include("import { matchesScriptName } from '../../../../out/webview/script-name-match.js'");
        expect(script).to.include('matchesScriptName(entry.name, query.value)');
        expect(script).not.to.include('function matches(');
        expect(script).to.include('canRunOnce');
        expect(panel).to.include('scriptMutationsWhileRunning');
        expect(panel).to.include('scriptRunOnceWhileRunning');
        expect(panel).to.include('this.service.refreshIfChanged()');
    });
});
