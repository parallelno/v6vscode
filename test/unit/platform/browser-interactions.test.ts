import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';

describe('Browser interaction behavior', () => {
    function load(name: string, globals: Record<string, unknown> = {}): any {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/webview/browser', `${name}.ts`), 'utf8');
        const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
        const exports = {};
        vm.runInNewContext(compiled, { exports, ...globals });
        return exports;
    }

    it('wraps enabled menu navigation, handles edges/Escape, and restores focus', () => {
        const document = { activeElement: null as unknown };
        const buttons = [0, 1].map(index => ({ focus() { document.activeElement = buttons[index]; } }));
        const menu = { hidden: true, style: { left: '', top: '' }, querySelector: () => buttons[0], querySelectorAll: () => buttons };
        let focus = 0;
        const source = { focus() { focus++; }, getBoundingClientRect: () => ({ left: 90, bottom: 90 }) };
        const { placeMenu, closeMenu, menuKeys } = load('menu', { document, window: { innerWidth: 100, innerHeight: 100 } });
        placeMenu(menu, { clientX: 99, clientY: 99 }, source, 20, 30);
        assert.strictEqual(menu.style.left, '80px'); assert.strictEqual(menu.style.top, '70px');
        const key = (key: string) => menuKeys(menu, () => closeMenu(menu, source), { key, preventDefault() {} });
        key('ArrowUp'); assert.strictEqual(document.activeElement, buttons[1]);
        key('ArrowDown'); assert.strictEqual(document.activeElement, buttons[0]);
        key('End'); assert.strictEqual(document.activeElement, buttons[1]);
        key('Home'); assert.strictEqual(document.activeElement, buttons[0]);
        key('Escape'); assert.strictEqual(menu.hidden, true); assert.strictEqual(focus, 1);
        menu.querySelectorAll = () => []; key('ArrowDown');
    });

    it('does not submit IME Enter and preserves accessible inline errors and Escape cancellation', () => {
        let handler!: (event: any) => void; let submits = 0; let cancels = 0; let focused = 0;
        const { bindEditKeys, invalid, clearInvalid } = load('edit');
        bindEditKeys({ addEventListener: (_name: string, callback: typeof handler) => { handler = callback; }, requestSubmit: () => { submits++; } }, () => { cancels++; });
        handler({ key: 'Enter', isComposing: true }); assert.strictEqual(submits, 0);
        handler({ key: 'Enter', isComposing: false, preventDefault() {} });
        handler({ key: 'Escape', preventDefault() {} }); assert.strictEqual(submits, 1); assert.strictEqual(cancels, 1);
        const classes = new Set<string>(); const attrs = new Map<string, string>();
        const input = { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
            setAttribute: (key: string, value: string) => attrs.set(key, value), removeAttribute: (key: string) => attrs.delete(key), focus: () => { focused++; } };
        const live = { textContent: '' }; const status = { textContent: '' };
        assert.strictEqual(invalid(input, 'bad value', live, status), null);
        assert.strictEqual(live.textContent, 'bad value'); assert.strictEqual(attrs.get('aria-describedby'), 'live'); assert.strictEqual(focused, 1);
        clearInvalid(input); assert.strictEqual(classes.size, 0); assert.strictEqual(attrs.size, 0);
    });

    it('caps exact history, avoids adjacent duplicates, rejects invalid commits and restores the draft', () => {
        const { QueryHistory } = load('query-history'); const history = new QueryHistory(2);
        history.key('Enter', 'one'); history.key('Enter', 'one'); history.key('Enter', 'two'); history.key('Enter', 'invalid', false);
        assert.strictEqual(JSON.stringify(history.values), '["one","two"]');
        assert.strictEqual(history.key('ArrowUp', 'draft').value, 'two');
        assert.strictEqual(history.key('ArrowUp', 'two').value, 'one');
        history.key('ArrowDown', 'one'); assert.strictEqual(history.key('ArrowDown', 'two').value, 'draft');
        history.key('Enter', 'three'); assert.strictEqual(JSON.stringify(history.values), '["two","three"]');
        history.key('ArrowUp', 'draft2'); assert.strictEqual(history.key('Escape', 'three').value, 'draft2');
    });

    it('reuses unchanged keyed rows, replaces changed rows, reorders and removes absent rows', () => {
        const { KeyedRows } = load('keyed-rows'); const renderer = new KeyedRows(); let created = 0;
        const parent = { children: [] as any[], insertBefore(row: any, before: any) {
            const old = this.children.indexOf(row); if (old >= 0) this.children.splice(old, 1);
            this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, row);
        } };
        const create = (entry: { id: number; name: string }) => {
            created++; const row = { entry, remove() { const index = parent.children.indexOf(row); if (index >= 0) parent.children.splice(index, 1); } }; return row;
        };
        const entries = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }];
        renderer.render(parent, entries, (entry: typeof entries[0]) => entry.id, create);
        const first = parent.children[0]; renderer.render(parent, entries, (entry: typeof entries[0]) => entry.id, create);
        assert.strictEqual(created, 2); assert.strictEqual(parent.children[0], first);
        renderer.render(parent, [entries[1], entries[0]], (entry: typeof entries[0]) => entry.id, create);
        assert.strictEqual(parent.children[1], first); assert.strictEqual(created, 2);
        renderer.render(parent, [{ id: 1, name: 'changed' }], (entry: typeof entries[0]) => entry.id, create);
        assert.strictEqual(created, 3); assert.strictEqual(parent.children.length, 1); assert.notStrictEqual(parent.children[0], first);
    });
});