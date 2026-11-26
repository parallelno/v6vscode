import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';
import { expect } from 'chai';

const ROOT = process.cwd();
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
        expect(script).to.include('markInvalid(input, message, live, status)');
        expect(script).to.include('bindEditKeys(row,');
        expect(script).to.include('if (!input) return');
        expect(script).to.include('editDraft[key] = input.value');
        expect(script).to.include('if (submitting || !canMutate) return');
        expect(read('src/debug/views/assets/table-controls.css')).to.include('.invalid');
    });

    it('keeps add and edit inputs, focus, and draft text across polling messages', () => {
        const timers: Array<() => void> = [];
        const messages: any[] = [];
        let focused: Element;
        class Element {
            children: Element[] = [];
            dataset: Record<string, string> = {};
            attrs = new Map<string, string>();
            handlers = new Map<string, (event: any) => void>();
            classList = { toggle() {}, remove() {} };
            className = '';
            value = '';
            disabled = false;
            textContent = '';
            constructor(readonly tagName = 'DIV') {}
            setAttribute(key: string, value: string) { this.attrs.set(key, value); }
            removeAttribute(key: string) { this.attrs.delete(key); }
            addEventListener(name: string, handler: (event: any) => void) { this.handlers.set(name, handler); }
            fire(name: string) { this.handlers.get(name)?.({ preventDefault() {}, stopPropagation() {} }); }
            focus() { if (!this.disabled) focused = this; }
            append(...nodes: Element[]) { this.children.push(...nodes); }
            appendChild(node: Element) { this.append(node); }
            replaceChildren() { if (this.all().includes(focused)) focused = body; this.children = []; }
            all(): Element[] { return this.children.flatMap(node => [node, ...node.all()]); }
            querySelectorAll(selector: string) {
                return this.all().filter(node => node.tagName.toLowerCase() === selector);
            }
            querySelector(selector: string) {
                const label = /aria-label="([^"]+)"/.exec(selector)?.[1];
                if (label) return this.all().find(node => node.attrs.get('aria-label') === label);
                if (selector.startsWith('.')) return this.all().find(node => node.className.split(' ').includes(selector.slice(1)));
                return this.querySelectorAll(selector)[0];
            }
        }
        const body = new Element('BODY'); focused = body;
        const nodes = new Map(['rows', 'query', 'count', 'status', 'empty', 'live', 'table', 'menu', 'list-menu'].map(id => [id, new Element()]));
        const rows = nodes.get('rows')!;
        let onMessage!: (event: { data: unknown }) => void;
        const send = (data: unknown) => { onMessage({ data }); timers.splice(0).forEach(run => run()); };
        const load = (source: string, globals: Record<string, unknown> = {}) => {
            const exports = {};
            const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
            vm.runInNewContext(code, { exports, ...globals });
            return exports;
        };
        // Only display-row population is stubbed; execute the actual edit and refresh handlers.
        const modules: Record<string, unknown> = {
            'keyed-rows': { KeyedRows: class {
                clear() {}
                render(parent: Element, entries: unknown[], _key: unknown, create: (entry: unknown) => Element) {
                    parent.replaceChildren(); parent.append(...entries.map(create));
                }
            } },
            menu: { closeMenu() {} },
            edit: load(read('src/webview/browser/edit.ts')),
        };
        load(script, {
            require: (file: string) => modules[path.basename(file, '.js')], TextEncoder,
            acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
            setTimeout: (callback: () => void) => timers.push(callback),
            document: { body, get activeElement() { return focused; }, getElementById: (id: string) => nodes.get(id),
                createElement: (tag: string) => new Element(tag.toUpperCase()), addEventListener() {} },
            window: { addEventListener: (_event: string, listener: typeof onMessage) => { onMessage = listener; } },
        });
        const ready = { type: 'state', state: 'running', canMutate: true };
        const entry = { id: 1, name: 'loop', addrStart: '0x100', addrEnd: '0x110', active: true, testCount: 0, averageClockCycles: 0 };
        const snapshot = (testCount: number) => send({ type: 'snapshot', generation: 1, entries: [{ ...entry, testCount }] });
        const field = (label: string) => rows.querySelector(`input[aria-label="${label}"]`)!;
        send(ready); snapshot(0); send({ type: 'beginAdd' });
        const start = field('Start'); start.focus(); start.value = 'loop_start'; start.fire('input');
        snapshot(1); send(ready); snapshot(2); send(ready);
        expect(field('Start')).to.equal(start);
        expect(focused).to.equal(start);
        expect(start.value).to.equal('loop_start');
        rows.querySelector('form')!.fire('submit');
        expect(messages.at(-1)?.input.addrStart).to.equal('loop_start');
        send({ type: 'operation', operation: 'add', ok: true });

        rows.children[0].children[3].fire('dblclick');
        const end = field('End');
        expect(focused).to.equal(end);
        end.value = 'loop_end'; end.fire('input');
        snapshot(3); send(ready);
        expect(field('End')).to.equal(end);
        expect(focused).to.equal(end);
        expect(end.value).to.equal('loop_end');
        expect(rows.querySelector('.statistics')?.textContent).to.include('tests: 3');
        send({ type: 'operation', operation: 'refresh', ok: false });
        send({ type: 'state', state: 'error', canMutate: false });
        expect(focused).to.equal(end);
        expect(end.disabled).to.equal(false);
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