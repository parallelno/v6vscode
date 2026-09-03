import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

describe('Symbols webview interactions', () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), 'src/debug/views/assets/symbols.js'),
        'utf8',
    );
    const providerSource = fs.readFileSync(
        path.join(process.cwd(), 'src/debug/views/symbols-panel.ts'),
        'utf8',
    );

    it('searches on input and caps committed history', () => {
        expect(source).to.include("query.addEventListener('input', sendQuery)");
        expect(source).to.include('history = history.slice(-50)');
        expect(source).to.include("event.key === 'ArrowUp'");
        expect(source).to.include("event.key === 'ArrowDown'");
    });

    it('opens the menu only from a context-menu gesture', () => {
        expect(source).not.to.include('window.setTimeout(() => openMenu');
        expect(source).to.include("event.ctrlKey || event.metaKey ? 'findHex' : 'findSource'");
        expect(source).to.include("button.addEventListener('contextmenu'");
    });

    it('provides all requested menu actions', () => {
        for (const action of ['copyName', 'copyValue', 'findSource', 'findHex']) {
            expect(providerSource).to.include(`data-action=\"${action}\"`);
        }
    });

    it('does not duplicate visible values in symbol tooltips', () => {
        expect(source).not.to.include('showTooltip');
        expect(providerSource).not.to.include('role=\"tooltip\"');
    });
});