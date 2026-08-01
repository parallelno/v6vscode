// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const rows = document.getElementById('rows');
    const empty = document.getElementById('empty');
    const live = document.getElementById('live');
    const preview = /** @type {HTMLDivElement} */ (document.getElementById('preview'));
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    let generation = 0;
    let entries = [];
    let canMutate = false;
    let editingId = null;
    let menuId = null;
    let previewTimer = 0;
    let previewId = null;

    function post(message) { vscode.postMessage({ generation, ...message }); }
    function hex(value, width) { return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`; }
    function globalAddress(value) { return hex(value, 6); }
    function watchpointValue(entry) { return hex(entry.value, entry.type === 'WORD' ? 4 : 2); }
    function render() {
        rows.replaceChildren();
        empty.hidden = entries.length > 0 || editingId === 'new';
        if (editingId === 'new') rows.appendChild(editorRow(null));
        entries.forEach(entry => rows.appendChild(editingId === entry.id ? editorRow(entry) : displayRow(entry)));
    }
    function displayRow(entry) {
        const row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'row'); row.tabIndex = 0; row.dataset.id = String(entry.id);
        const activity = cell('activity');
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.active; checkbox.disabled = !canMutate; checkbox.setAttribute('aria-label', entry.active ? 'Enabled' : 'Disabled');
        checkbox.addEventListener('change', () => post({ type: 'edit', candidate: { ...entry, active: checkbox.checked } })); activity.append(checkbox, document.createTextNode(entry.active ? 'Enabled' : 'Disabled'));
        const address = cell('address'); address.textContent = globalAddress(entry.globalAddr); address.title = address.textContent;
        const access = cell(); access.textContent = ({ R: 'Read', W: 'Write', RW: 'Read/Write' })[entry.access];
        const condition = cell(); condition.textContent = entry.condition;
        const value = cell('value'); value.textContent = watchpointValue(entry);
        const type = cell(); type.textContent = entry.type;
        const length = cell(); length.textContent = String(entry.len);
        const comment = cell(); comment.textContent = entry.comment; comment.title = entry.comment;
        row.append(activity, address, access, condition, value, type, length, comment);
        row.addEventListener('dblclick', () => { if (canMutate) { editingId = entry.id; closeMenu(); render(); } });
        row.addEventListener('contextmenu', event => openMenu(event, entry.id));
        row.addEventListener('mouseenter', event => schedulePreview(entry.id, row, event.clientX, event.clientY));
        row.addEventListener('mouseleave', closePreview);
        row.addEventListener('focus', () => schedulePreview(entry.id, row, row.getBoundingClientRect().left, row.getBoundingClientRect().bottom));
        row.addEventListener('blur', closePreview);
        row.addEventListener('keydown', event => { if (event.key === 'Enter' && canMutate) { editingId = entry.id; render(); } if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, entry.id); });
        return row;
    }
    function editorRow(entry) {
        const row = document.createElement('form'); row.className = 'row'; row.setAttribute('role', 'row');
        const active = input('checkbox', entry?.active ?? true, 'Activity');
        const address = input('text', entry ? globalAddress(entry.globalAddr) : '0x000000', 'Global Address');
        const access = select(['R', 'W', 'RW'], entry?.access ?? 'RW', 'Access');
        const conditionSelect = select(['ANY', 'EQU', 'NOT_EQU', 'LESS', 'LESS_EQU', 'GREATER', 'GREATER_EQU'], entry?.condition ?? 'ANY', 'Condition');
        const value = input('text', entry ? watchpointValue(entry) : '0x00', 'Value');
        const type = select(['LEN', 'WORD'], entry?.type ?? 'LEN', 'Type');
        const length = input('number', entry?.len ?? 1, 'Length'); length.min = '1'; length.max = '65535';
        const comment = input('text', entry?.comment ?? '', 'Comment');
        address.addEventListener('blur', () => normalizeNumericInput(address, 6));
        value.addEventListener('blur', () => normalizeNumericInput(value, type.value === 'WORD' ? 4 : 2));
        type.addEventListener('change', () => normalizeNumericInput(value, type.value === 'WORD' ? 4 : 2));
        row.append(wrap(active, 'activity'), wrap(address, 'address'), wrap(access), wrap(conditionSelect), wrap(value, 'value'), wrap(type), wrap(length), wrap(comment));
        row.addEventListener('submit', event => {
            event.preventDefault();
            try {
                const candidate = {
                    globalAddr: parseNumber(address.value), len: Number(length.value), value: parseNumber(value.value),
                    access: access.value, condition: conditionSelect.value, type: type.value,
                    active: active.checked, comment: comment.value,
                };
                post(entry ? { type: 'edit', candidate: { id: entry.id, ...candidate } } : { type: 'add', candidate });
            } catch (error) { announce(error instanceof Error ? error.message : String(error)); }
        });
        row.addEventListener('keydown', event => { if (event.key === 'Escape') { editingId = null; render(); } });
        setTimeout(() => address.focus(), 0);
        return row;
    }
    function cell(className = '') { const element = document.createElement('div'); element.className = `cell ${className}`; element.setAttribute('role', 'gridcell'); return element; }
    function wrap(control, className = '') { const element = cell(className); element.appendChild(control); return element; }
    function input(type, value, label) { const element = document.createElement('input'); element.type = type; if (type === 'checkbox') element.checked = Boolean(value); else element.value = String(value); element.setAttribute('aria-label', label); return element; }
    function select(values, selected, label) { const element = document.createElement('select'); element.setAttribute('aria-label', label); values.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; option.selected = value === selected; element.appendChild(option); }); return element; }
    function parseNumber(text) { const value = text.trim(); let parsed; if (/^\$[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(1), 16); else if (/^0x[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(2), 16); else if (/^[0-9a-f]+h$/i.test(value)) parsed = parseInt(value.slice(0, -1), 16); else if (/^[0-9]+$/.test(value)) parsed = parseInt(value, 10); else throw new Error(`Invalid number: ${text}`); return parsed; }
    function normalizeNumericInput(control, width) {
        try { control.value = hex(parseNumber(control.value), width); } catch { /* validation reports on submit */ }
    }
    function announce(message) { live.textContent = message; }
    function schedulePreview(id, row, x, y) {
        closePreview(); previewId = id; previewTimer = window.setTimeout(() => {
            row.setAttribute('aria-describedby', 'preview');
            preview.textContent = 'Reading memory...'; preview.hidden = false;
            preview.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 300))}px`;
            preview.style.top = `${Math.max(8, Math.min(y + 8, window.innerHeight - 70))}px`;
            post({ type: 'preview', id });
        }, 150);
    }
    function closePreview() {
        if (previewTimer) window.clearTimeout(previewTimer);
        previewTimer = 0; previewId = null; preview.hidden = true;
        rows.querySelectorAll('[aria-describedby="preview"]').forEach(row => row.removeAttribute('aria-describedby'));
    }
    function openMenu(event, id) {
        event.preventDefault(); menuId = id; const entry = entries.find(item => item.id === id);
        menu.querySelectorAll('button').forEach(button => {
            const action = button.dataset.action;
            button.hidden = id === null ? ['reveal', 'toggle', 'delete'].includes(action) : ['add', 'disableAll', 'deleteAll'].includes(action);
            button.disabled = !canMutate && action !== 'reveal';
            if (action === 'toggle' && entry) button.textContent = entry.active ? 'Disable' : 'Enable';
        });
        menu.hidden = false; menu.style.left = `${event.clientX}px`; menu.style.top = `${event.clientY}px`; menu.querySelector('button:not([hidden])')?.focus();
    }
    function closeMenu() { menu.hidden = true; menuId = null; }
    menu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; const entry = entries.find(item => item.id === menuId); closeMenu();
        if (action === 'add') { editingId = 'new'; render(); }
        if (action === 'reveal' && entry) post({ type: 'reveal', id: entry.id });
        if (action === 'toggle' && entry) post({ type: 'edit', candidate: { ...entry, active: !entry.active } });
        if (action === 'delete' && entry) post({ type: 'delete', id: entry.id });
        if (action === 'disableAll') post({ type: 'disableAll' });
        if (action === 'deleteAll') post({ type: 'deleteAll' });
    });
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    empty.addEventListener('contextmenu', event => openMenu(event, null));
    empty.addEventListener('keydown', event => { if (event.key === 'Enter' && canMutate) { editingId = 'new'; render(); } });
    document.addEventListener('click', event => { if (!menu.contains(event.target)) closeMenu(); });
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'state') { status.textContent = message.message; canMutate = message.canMutate; render(); }
        if (message.type === 'snapshot') { generation = message.generation; entries = message.entries; if (editingId !== 'new' && !entries.some(entry => entry.id === editingId)) editingId = null; render(); }
        if (message.type === 'operation') {
            if (message.operation === 'beginAdd') { editingId = 'new'; render(); }
            else if (message.ok) { editingId = null; render(); announce(`${message.operation} completed`); }
            else announce(message.message);
        }
        if (message.type === 'preview' && message.id === previewId) { preview.textContent = message.text; }
    });
    vscode.postMessage({ type: 'ready' });
})();