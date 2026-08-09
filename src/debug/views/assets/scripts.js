// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const query = /** @type {HTMLInputElement} */ (document.getElementById('query'));
    const count = document.getElementById('count');
    const status = document.getElementById('status');
    const rows = document.getElementById('rows');
    const empty = document.getElementById('empty');
    const live = document.getElementById('live');
    const table = document.getElementById('table');
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    let generation = 0;
    /** @type {any[]} */ let entries = [];
    let canMutate = false;
    let canRunOnce = false;
    let maxNameBytes = 0;
    let maxPathBytes = 0;
    let editingId = null;
    let selectedId = null;
    let adding = false;
    let submitting = false;
    let focusDraft = false;
    let draft = { name: '', path: '', active: true };
    let editDraft = null;
    let menuId = null;
    let menuField = null;
    let menuSource = null;

    function post(message) { vscode.postMessage({ generation, ...message }); }
    function clearInvalid(...inputs) {
        for (const input of inputs) { input.classList.remove('invalid'); input.removeAttribute('aria-describedby'); }
    }
    function invalid(input, message) {
        input.classList.add('invalid'); input.setAttribute('aria-describedby', 'live'); input.focus();
        live.textContent = message; status.textContent = message; return null;
    }
    function inputValue(name, path, active) {
        clearInvalid(name, path);
        if (!name.value.length) return invalid(name, 'Name must not be empty');
        if (maxNameBytes && new TextEncoder().encode(name.value).length > maxNameBytes) {
            return invalid(name, `Name exceeds ${maxNameBytes} UTF-8 bytes`);
        }
        const wirePath = path.value.replaceAll('\\', '/');
        if (!/^(?:[A-Za-z]:\/|\/(?!\/)|\/\/[^/]+\/[^/]+)/.test(wirePath)) {
            return invalid(path, 'Path must be absolute');
        }
        if (maxPathBytes && new TextEncoder().encode(wirePath).length > maxPathBytes) {
            return invalid(path, `Path exceeds ${maxPathBytes} UTF-8 bytes`);
        }
        return { name: name.value, path: wirePath, active };
    }
    function matches(name, value) {
        const pattern = value.trim().slice(0, 256).toLocaleLowerCase();
        const candidate = name.toLocaleLowerCase();
        if (!pattern) return true;
        if (!pattern.includes('*')) return candidate.includes(pattern);
        const escaped = pattern.replace(/\*+/g, '*').split('*')
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp(`^${escaped}$`, 'u').test(candidate);
    }
    function visibleEntries() { return entries.filter(entry => matches(entry.name, query.value)); }
    function cell(text, className = '', field = '') {
        const element = document.createElement('div'); element.className = `cell ${className}`;
        element.setAttribute('role', 'gridcell'); element.textContent = text;
        if (field) element.dataset.field = field;
        return element;
    }
    function failure(entry) {
        if (entry.compilation.status === 'error') return { kind: 'Compilation', text: entry.compilation.error };
        if (entry.runtime.status === 'error') return { kind: 'Runtime', text: entry.runtime.error };
        return null;
    }
    function compilationCell(entry) {
        const problem = failure(entry);
        const text = entry.compilation.status === 'compiled' ? '$(check)' : '$(error)';
        const element = cell(text, 'compilation', 'compilation');
        element.textContent = entry.compilation.status === 'compiled' ? '✓' : '✕';
        element.title = problem ? `${problem.kind} error: ${problem.text}` : 'Compiled Successfully';
        element.setAttribute('aria-label', element.title); return element;
    }
    function checkboxCell(entry) {
        const element = cell('', 'toggle', 'activity');
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = entry.active;
        input.disabled = !canMutate || submitting; input.title = entry.active ? 'Enabled' : 'Disabled';
        input.setAttribute('aria-label', `${entry.active ? 'Enabled' : 'Disabled'}: ${entry.name}`);
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('change', () => {
            if (!submitting) { submitting = true; input.disabled = true; post({ type: 'setActivity', scriptId: entry.scriptId, active: input.checked }); }
        });
        element.appendChild(input); return element;
    }
    function select(id, row) {
        selectedId = id; rows.querySelector('.selected')?.classList.remove('selected'); row?.classList.add('selected');
    }
    function render() {
        const visible = visibleEntries(); rows.replaceChildren();
        if (adding) rows.appendChild(editorRow(null));
        visible.forEach(entry => rows.appendChild(entry.scriptId === editingId ? editorRow(entry) : displayRow(entry)));
        count.textContent = `${visible.length} of ${entries.length}`;
        empty.hidden = adding || visible.length > 0;
        empty.textContent = entries.length ? 'No matching scripts' : 'No scripts';
    }
    function displayRow(entry) {
        const problem = failure(entry);
        const row = document.createElement('div');
        row.className = `row${entry.scriptId === selectedId ? ' selected' : ''}${problem ? ' error' : ''}`;
        row.setAttribute('role', 'row'); row.tabIndex = 0; row.dataset.id = String(entry.scriptId);
        const name = cell(entry.name, 'editable', 'name'); name.title = entry.name;
        const path = cell(entry.path, 'editable', 'path'); path.title = entry.path;
        row.append(compilationCell(entry), checkboxCell(entry), name, path);
        row.addEventListener('click', () => select(entry.scriptId, row));
        for (const editable of [name, path]) editable.addEventListener('dblclick', event => {
            event.stopPropagation(); if (canMutate && !submitting) {
                editingId = entry.scriptId; editDraft = { name: entry.name, path: entry.path, active: entry.active };
                closeMenu(); render();
            }
        });
        row.addEventListener('contextmenu', event => openMenu(event, entry.scriptId, event.target?.dataset?.field ?? 'name', row));
        row.addEventListener('keydown', event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, entry.scriptId, 'name', row);
        });
        return row;
    }
    function editorRow(entry) {
        const row = document.createElement('form'); row.className = `row${entry ? '' : ' draft'}`; row.setAttribute('role', 'row');
        const values = entry ? editDraft ?? { name: entry.name, path: entry.path, active: entry.active } : draft;
        const activeCell = cell('', 'toggle');
        const active = document.createElement('input'); active.type = 'checkbox'; active.checked = values.active;
        active.setAttribute('aria-label', 'Activity'); activeCell.appendChild(active);
        const name = textInput('Name', values.name); const path = textInput('Path', values.path);
        for (const control of [active, name.input, path.input]) control.disabled = !canMutate || submitting;
        row.append(cell(entry ? (entry.compilation.status === 'compiled' ? '✓' : '✕') : '—', 'compilation'), activeCell, name.cell, path.cell);
        for (const [key, input] of [['name', name.input], ['path', path.input]]) input.addEventListener('input', () => {
            clearInvalid(input); if (entry && editDraft) editDraft[key] = input.value; else draft[key] = input.value;
        });
        active.addEventListener('change', () => {
            if (entry && editDraft) editDraft.active = active.checked; else draft.active = active.checked;
        });
        row.addEventListener('submit', event => {
            event.preventDefault(); if (submitting) return;
            const input = inputValue(name.input, path.input, active.checked); if (!input) return;
            submitting = true; for (const control of row.querySelectorAll('input')) control.disabled = true;
            post(entry ? { type: 'edit', scriptId: entry.scriptId, input } : { type: 'add', input });
        });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); row.requestSubmit(); }
            if (event.key === 'Escape') { event.preventDefault(); editingId = null; editDraft = null; adding = false; submitting = false; render(); }
        });
        setTimeout(() => { if (focusDraft) { name.input.focus(); focusDraft = false; } }, 0);
        return row;
    }
    function textInput(label, value) {
        const holder = cell('', 'editable'); const input = document.createElement('input');
        input.type = 'text'; input.value = value; input.setAttribute('aria-label', label); holder.appendChild(input);
        return { cell: holder, input };
    }
    function startAdd() {
        if (!canMutate) return;
        if (!adding) { draft = { name: '', path: '', active: true }; focusDraft = true; }
        adding = true; editingId = null; editDraft = null; closeMenu(); render();
    }
    function openMenu(event, id, field, source) {
        event.preventDefault(); menuId = id; menuField = field; menuSource = source;
        const entry = entries.find(item => item.scriptId === id);
        menu.querySelectorAll('button').forEach(button => {
            const action = button.dataset.action;
            const rowAction = ['copy', 'compile', 'runOnce', 'disable', 'delete'].includes(action);
            button.disabled = submitting
                || (rowAction && !entry)
                || (action === 'add' && !canMutate)
                || (['compile', 'disable', 'disableAll', 'delete', 'deleteAll'].includes(action) && !canMutate)
                || (action === 'runOnce' && (!canRunOnce || entry?.compilation.status !== 'compiled'))
                || (action === 'disable' && !entry?.active)
                || (action === 'disableAll' && !entries.some(item => item.active))
                || (action === 'deleteAll' && entries.length === 0);
        });
        menu.hidden = false;
        const rect = source.getBoundingClientRect();
        menu.style.left = `${Math.max(4, Math.min(event.clientX || rect.left, window.innerWidth - 180))}px`;
        menu.style.top = `${Math.max(4, Math.min(event.clientY || rect.bottom, window.innerHeight - 240))}px`;
        menu.querySelector('button:not([disabled])')?.focus();
    }
    function closeMenu() { if (!menu.hidden) { menu.hidden = true; menuSource?.focus(); } menuId = null; menuField = null; menuSource = null; }
    menu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; const scriptId = menuId; const field = menuField; closeMenu();
        if (!action) return;
        if (action === 'add') startAdd();
        else if (action === 'disableAll') post({ type: 'disableAll' });
        else if (action === 'deleteAll') post({ type: 'deleteAll' });
        else if (scriptId !== null && action === 'copy') post({ type: 'copy', scriptId, field });
        else if (scriptId !== null && action === 'compile') post({ type: 'compile', scriptId });
        else if (scriptId !== null && action === 'runOnce') post({ type: 'runOnce', scriptId });
        else if (scriptId !== null && action === 'disable') post({ type: 'disable', scriptId });
        else if (scriptId !== null && action === 'delete') post({ type: 'delete', scriptId });
    });
    menu.addEventListener('keydown', event => {
        const buttons = [...menu.querySelectorAll('button:not([disabled])')]; const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
    });
    table.addEventListener('contextmenu', event => {
        if (!event.target.closest?.('.row')) openMenu(event, null, null, table);
    });
    empty.addEventListener('contextmenu', event => openMenu(event, null, null, empty));
    document.addEventListener('mousedown', event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); });
    table.addEventListener('scroll', closeMenu);
    query.addEventListener('input', () => { vscode.postMessage({ type: 'persistQuery', value: query.value }); render(); });
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'beginAdd') startAdd();
        if (message.type === 'state') {
            status.textContent = message.message; canMutate = message.canMutate; canRunOnce = message.canRunOnce;
            document.body.classList.toggle('stale', message.state === 'loading' || message.state === 'error');
            if (message.state === 'noSession' || message.state === 'unsupported') {
                editingId = null; editDraft = null; adding = false; submitting = false;
            }
            if (message.state !== 'loading') render();
        }
        if (message.type === 'snapshot') {
            const changed = message.generation !== generation;
            generation = message.generation; entries = message.entries;
            maxNameBytes = message.maxNameBytes; maxPathBytes = message.maxPathBytes;
            if (changed) { editingId = null; editDraft = null; adding = false; closeMenu(); }
            if (editingId !== null && !entries.some(entry => entry.scriptId === editingId)) { editingId = null; editDraft = null; }
            if (selectedId !== null && !entries.some(entry => entry.scriptId === selectedId)) selectedId = null;
            if (editingId === null && !adding) render();
        }
        if (message.type === 'operation') {
            submitting = false; live.textContent = message.message || (message.ok ? 'Script updated' : 'Script operation failed');
            if (message.ok) { editingId = null; editDraft = null; if (message.operation === 'add') adding = false; }
            render();
            if (!message.ok && message.field) {
                const input = document.querySelector(`input[aria-label="${message.field === 'name' ? 'Name' : 'Path'}"]`);
                if (input) invalid(input, message.message);
            }
        }
        if (message.type === 'dismissMenus') closeMenu();
        if (message.type === 'restoredQuery') { query.value = message.value; render(); }
    });
    vscode.postMessage({ type: 'ready' });
}());
