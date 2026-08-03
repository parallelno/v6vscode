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
    const listMenu = /** @type {HTMLDivElement} */ (document.getElementById('list-menu'));
    let generation = 0;
    /** @type {any[]} */ let entries = [];
    let canMutate = false;
    let editingId = null;
    let selectedId = null;
    let adding = false;
    let submitting = false;
    let focusDraft = false;
    let draft = { name: '', addrStart: '', addrEnd: '', active: true };
    let editDraft = null;
    let menuId = null;
    let menuSource = null;
    let listMenuSource = null;

    function post(message) { vscode.postMessage({ generation, ...message }); }
    function clearInvalid(...inputs) {
        for (const input of inputs) { input.classList.remove('invalid'); input.removeAttribute('aria-describedby'); }
    }
    function invalid(input, message) {
        input.classList.add('invalid'); input.setAttribute('aria-describedby', 'live'); input.focus();
        live.textContent = message; status.textContent = message; return null;
    }
    function inputValue(name, addrStart, addrEnd, active) {
        clearInvalid(name, addrStart, addrEnd);
        if (new TextEncoder().encode(name.value).length > 1024) return invalid(name, 'Name exceeds 1024 UTF-8 bytes');
        return { name: name.value, addrStart: addrStart.value, addrEnd: addrEnd.value, active };
    }
    function visibleEntries() {
        const needle = query.value.trim().toLocaleLowerCase();
        return needle ? entries.filter(entry => entry.name.toLocaleLowerCase().includes(needle)) : entries;
    }
    function cell(text, className = '') {
        const element = document.createElement('div'); element.className = `cell ${className}`;
        element.setAttribute('role', 'gridcell'); element.textContent = text; return element;
    }
    function checkboxCell(entry) {
        const element = cell('', 'toggle');
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = entry.active;
        input.disabled = !canMutate || submitting; input.setAttribute('aria-label', `Activity for ${entry.name}`);
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('change', () => {
            if (!submitting) {
                submitting = true; input.disabled = true;
                post({ type: 'setActivity', id: entry.id, active: input.checked });
            }
        });
        element.appendChild(input); return element;
    }
    function select(id, row) {
        selectedId = id; rows.querySelector('.selected')?.classList.remove('selected'); row?.classList.add('selected');
    }
    function render() {
        const visible = visibleEntries(); rows.replaceChildren();
        if (adding) rows.appendChild(editorRow(null));
        visible.forEach(entry => rows.appendChild(entry.id === editingId ? editorRow(entry) : displayRow(entry)));
        count.textContent = `${visible.length} of ${entries.length}`;
        empty.hidden = adding || visible.length > 0;
        empty.textContent = entries.length ? 'No matching performance tests' : 'No performance tests';
    }
    function displayRow(entry) {
        const row = document.createElement('div'); row.className = `row${entry.id === selectedId ? ' selected' : ''}`;
        row.setAttribute('role', 'row'); row.tabIndex = 0; row.dataset.id = String(entry.id);
        const name = cell(entry.name, 'editable'); name.title = entry.name;
        name.setAttribute('aria-label', entry.name || 'Unnamed performance test');
        const start = cell(entry.addrStart, 'editable');
        const end = cell(entry.addrEnd, 'editable');
        start.title = entry.addrStart; end.title = entry.addrEnd;
        const stats = cell(`average cc: ${Math.round(entry.averageClockCycles)}, tests: ${entry.testCount}`, 'statistics');
        row.append(checkboxCell(entry), name, start, end, stats);
        row.addEventListener('click', () => select(entry.id, row));
        for (const editable of [name, start, end]) editable.addEventListener('dblclick', event => {
            event.stopPropagation(); if (canMutate && !submitting) {
                editingId = entry.id;
                editDraft = { name: entry.name, addrStart: entry.addrStart, addrEnd: entry.addrEnd, active: entry.active };
                closeMenus(); render();
            }
        });
        row.addEventListener('dblclick', event => {
            if (!event.target.closest?.('input') && !event.target.closest?.('.editable')) post({ type: 'reveal', id: entry.id });
        });
        row.addEventListener('contextmenu', event => { select(entry.id, row); openMenu(event, entry.id, row); });
        row.addEventListener('keydown', event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, entry.id, row);
        });
        return row;
    }
    function editorRow(entry) {
        const row = document.createElement('form'); row.className = `row${entry ? '' : ' draft'}`; row.setAttribute('role', 'row');
        const values = entry
            ? editDraft ?? { name: entry.name, addrStart: entry.addrStart, addrEnd: entry.addrEnd, active: entry.active }
            : draft;
        const activeCell = cell('', 'toggle');
        const active = document.createElement('input'); active.type = 'checkbox'; active.checked = values.active;
        active.setAttribute('aria-label', 'Activity');
        active.addEventListener('change', () => {
            if (entry && editDraft) { editDraft.active = active.checked; }
        });
        activeCell.appendChild(active);
        const name = textInput('Name', values.name); const start = textInput('Start', values.addrStart);
        const end = textInput('End', values.addrEnd);
        for (const control of [active, name.input, start.input, end.input]) {
            control.disabled = !canMutate || submitting;
        }
        row.append(activeCell, name.cell, start.cell, end.cell, cell(entry ? `average cc: ${Math.round(entry.averageClockCycles)}, tests: ${entry.testCount}` : '--', 'statistics'));
        for (const [key, input] of [['name', name.input], ['addrStart', start.input], ['addrEnd', end.input]]) {
            input.addEventListener('input', () => {
                clearInvalid(input);
                if (entry && editDraft) { editDraft[key] = input.value; } else { draft[key] = input.value; }
            });
        }
        if (!entry) {
            active.addEventListener('change', () => { draft.active = active.checked; });
        }
        row.addEventListener('submit', event => {
            event.preventDefault(); if (submitting) return;
            const input = inputValue(name.input, start.input, end.input, active.checked);
            if (!input) return;
            submitting = true;
            for (const control of row.querySelectorAll('input')) control.disabled = true;
            post(entry ? { type: 'edit', id: entry.id, input } : { type: 'add', input });
        });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); row.requestSubmit(); }
            if (event.key === 'Escape') {
                event.preventDefault(); editingId = null; editDraft = null; adding = false; submitting = false; render();
            }
        });
        setTimeout(() => { (focusDraft ? name.input : document.activeElement === document.body ? name.input : null)?.focus(); focusDraft = false; }, 0);
        return row;
    }
    function textInput(label, value) {
        const holder = cell('', 'editable'); const input = document.createElement('input');
        input.type = 'text'; input.value = value; input.maxLength = 256; input.setAttribute('aria-label', label); holder.appendChild(input);
        return { cell: holder, input };
    }
    function startAdd() {
        if (!adding) { draft = { name: '', addrStart: '', addrEnd: '', active: true }; focusDraft = true; }
        adding = true; editingId = null; closeMenus(); render();
    }
    function openMenu(event, id, source) {
        event.preventDefault(); closeListMenu(); menuId = id; menuSource = source;
        const entry = entries.find(item => item.id === id);
        menu.querySelectorAll('button').forEach(button => {
            const action = button.dataset.action;
            button.disabled = !canMutate || submitting
                || (action === 'disable' && !entry?.active)
                || (action === 'disableAll' && !entries.some(item => item.active))
                || ((action === 'delete' || action === 'deleteAll') && entries.length === 0);
        });
        placeMenu(menu, event, source); menu.querySelector('button:not([disabled])')?.focus();
    }
    function openListMenu(event, source) {
        if (event.target.closest?.('.row')) return;
        event.preventDefault(); closeMenu(); listMenuSource = source;
        listMenu.querySelectorAll('button').forEach(button => {
            const action = button.dataset.action;
            button.disabled = !canMutate || submitting
                || (action === 'disableAll' && !entries.some(item => item.active))
                || (action === 'deleteAll' && entries.length === 0);
        });
        placeMenu(listMenu, event, source); listMenu.querySelector('button:not([disabled])')?.focus();
    }
    function placeMenu(element, event, source) {
        element.hidden = false;
        element.style.left = `${Math.max(4, Math.min(event.clientX || source.getBoundingClientRect().left, window.innerWidth - 170))}px`;
        element.style.top = `${Math.max(4, Math.min(event.clientY || source.getBoundingClientRect().bottom, window.innerHeight - 150))}px`;
    }
    function closeMenu() { if (!menu.hidden) { menu.hidden = true; menuSource?.focus(); } menuId = null; menuSource = null; }
    function closeListMenu() { if (!listMenu.hidden) { listMenu.hidden = true; listMenuSource?.focus(); } listMenuSource = null; }
    function closeMenus() { closeMenu(); closeListMenu(); }
    function menuKeys(element, close, event) {
        const buttons = [...element.querySelectorAll('button:not([disabled])')]; const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
    }
    menu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; const id = menuId; closeMenu();
        if (!action || id === null || !canMutate) return;
        if (action === 'disable') post({ type: 'disable', id });
        else if (action === 'disableAll') post({ type: 'disableAll' });
        else if (action === 'delete') post({ type: 'delete', id });
        else if (action === 'deleteAll') post({ type: 'deleteAll' });
    });
    listMenu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; closeListMenu(); if (!action || !canMutate) return;
        if (action === 'add') startAdd();
        else if (action === 'disableAll') post({ type: 'disableAll' });
        else if (action === 'deleteAll') post({ type: 'deleteAll' });
    });
    menu.addEventListener('keydown', event => menuKeys(menu, closeMenu, event));
    listMenu.addEventListener('keydown', event => menuKeys(listMenu, closeListMenu, event));
    table.addEventListener('contextmenu', event => openListMenu(event, table));
    empty.addEventListener('contextmenu', event => openListMenu(event, empty));
    document.addEventListener('mousedown', event => {
        if (!menu.hidden && !menu.contains(event.target)) closeMenu();
        if (!listMenu.hidden && !listMenu.contains(event.target)) closeListMenu();
    });
    table.addEventListener('scroll', closeMenus);
    query.addEventListener('input', () => { vscode.postMessage({ type: 'persistQuery', value: query.value }); render(); });
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'beginAdd' && canMutate) startAdd();
        if (message.type === 'state') {
            status.textContent = message.message; canMutate = message.canMutate;
            document.body.classList.toggle('stale', message.state === 'loading' || message.state === 'error');
            if (message.state === 'noSession' || message.state === 'unsupported') {
                editingId = null; editDraft = null; adding = false; submitting = false;
            }
            if (message.state !== 'loading') render();
        }
        if (message.type === 'snapshot') {
            const changed = message.generation !== generation; generation = message.generation; entries = message.entries;
            if (changed) { editingId = null; editDraft = null; adding = false; closeMenus(); }
            if (editingId !== null && !entries.some(entry => entry.id === editingId)) { editingId = null; editDraft = null; }
            if (selectedId !== null && !entries.some(entry => entry.id === selectedId)) selectedId = null;
            if (editingId === null && !adding) render();
        }
        if (message.type === 'operation') {
            submitting = false; live.textContent = message.message || (message.ok ? 'Performance test updated' : 'Performance operation failed');
            if (message.ok) { editingId = null; editDraft = null; if (message.operation === 'add') adding = false; }
            render();
            if (!message.ok && message.field) {
                const label = message.field === 'addrStart' ? 'Start' : 'End';
                const input = document.querySelector(`input[aria-label="${label}"]`);
                if (input) invalid(input, message.message);
            }
        }
        if (message.type === 'dismissMenus') closeMenus();
        if (message.type === 'restoredQuery') { query.value = message.value; render(); }
    });
    vscode.postMessage({ type: 'ready' });
}());