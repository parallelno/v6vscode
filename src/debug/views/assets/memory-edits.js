// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const addButton = /** @type {HTMLButtonElement} */ (document.getElementById('add'));
    const query = /** @type {HTMLInputElement} */ (document.getElementById('query'));
    const count = document.getElementById('count');
    const status = document.getElementById('status');
    const rows = document.getElementById('rows');
    const empty = document.getElementById('empty');
    const live = document.getElementById('live');
    const table = document.getElementById('table');
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    const listMenu = /** @type {HTMLDivElement} */ (document.getElementById('list-menu'));
    const SEARCH_TOOLTIP = query.title;
    let generation = 0;
    /** @type {any[]} */ let entries = [];
    let filterValue = null;
    let canMutate = false;
    let canRestore = false;
    let editingAddress = null;
    let selectedAddress = null;
    let adding = false;
    let draftAddress = '';
    let draftValue = '';
    let focusDraft = false;
    let submitting = false;
    let menuAddress = null;
    let menuSource = null;
    let listMenuSource = null;

    function post(message) { vscode.postMessage({ generation, ...message }); }
    function hex(value, width) { return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`; }
    function parseByte(text) {
        const value = text.trim(); let parsed;
        if (/^[0-9]+$/.test(value)) parsed = parseInt(value, 10);
        else if (/^\$[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(1), 16);
        else if (/^0x[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(2), 16);
        else if (/^[0-9a-f]+h$/i.test(value)) parsed = parseInt(value.slice(0, -1), 16);
        else throw new Error('Enter a byte as decimal, $NN, 0xNN, or NNh');
        if (parsed > 255) throw new Error('Byte value must be in the range 0..255');
        return parsed;
    }
    function parseAddress(text) {
        const value = text.trim(); let parsed;
        if (/^[0-9]+$/.test(value)) parsed = parseInt(value, 10);
        else if (/^\$[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(1), 16);
        else if (/^0x[0-9a-f]+$/i.test(value)) parsed = parseInt(value.slice(2), 16);
        else if (/^[0-9a-f]+h$/i.test(value)) parsed = parseInt(value.slice(0, -1), 16);
        else throw new Error('Enter an address as decimal, $NN, 0xNN, or NNh');
        if (!Number.isSafeInteger(parsed)) throw new Error('Address is outside the supported range');
        return parsed;
    }
    function addressTitle(globalAddr) {
        const space = Math.floor(globalAddr / 0x10000); const offset = globalAddr % 0x10000;
        if (space === 0) return `Main RAM / ${hex(offset, 4)}`;
        const index = space - 1;
        return `RAM Disk ${Math.floor(index / 4) + 1} / Bank ${index % 4} / ${hex(offset, 4)}`;
    }
    function visibleEntries() { return filterValue === null ? entries : entries.filter(entry => entry.currentValue === filterValue); }
    function selectAddress(globalAddr, row) {
        selectedAddress = globalAddr;
        rows.querySelector('.selected')?.classList.remove('selected');
        row?.classList.add('selected');
    }
    function render() {
        const visible = visibleEntries(); rows.replaceChildren();
        if (adding) rows.appendChild(addRow());
        visible.forEach(entry => rows.appendChild(entry.globalAddr === editingAddress ? editorRow(entry) : displayRow(entry)));
        count.textContent = `${visible.length} of ${entries.length}`;
        empty.hidden = adding || visible.length > 0;
        empty.textContent = entries.length ? 'No matching memory edits' : 'No memory edits';
        addButton.disabled = !canMutate;
    }
    function cell(text, className = '') {
        const element = document.createElement('div'); element.className = `cell ${className}`;
        element.setAttribute('role', 'gridcell'); element.textContent = text; return element;
    }
    function checkboxCell(checked, label, onChange, className = '', mutable = true) {
        const element = cell('', `toggle ${className}`);
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
        input.disabled = !canMutate || !mutable; input.setAttribute('aria-label', label);
        input.addEventListener('change', () => onChange(input.checked));
        element.appendChild(input); return element;
    }
    function startAdd() {
        if (!adding) { draftAddress = ''; draftValue = ''; focusDraft = true; }
        adding = true; closeListMenu(); render();
    }
    function cancelAdd() { adding = false; draftAddress = ''; draftValue = ''; focusDraft = false; }
    function displayRow(entry) {
        const row = document.createElement('div'); row.className = `row${entry.globalAddr === selectedAddress ? ' selected' : ''}`; row.setAttribute('role', 'row');
        row.tabIndex = 0; row.dataset.address = String(entry.globalAddr);
        const address = cell(hex(entry.globalAddr, 6), 'address'); address.title = addressTitle(entry.globalAddr);
        const original = cell(hex(entry.originalValue, 2));
        const entered = cell(hex(entry.enteredValue, 2), 'entered');
        const current = cell(hex(entry.currentValue, 2), entry.currentValue === entry.enteredValue ? '' : 'changed');
        const activity = checkboxCell(entry.active, `Activity for ${hex(entry.globalAddr, 6)}`, enabled => {
            if (!submitting) { submitting = true; post({ type: 'setActivity', globalAddr: entry.globalAddr, enabled }); }
        }, 'activity');
        const auto = cell(entry.active && entry.readonly ? 'On' : 'Off', 'auto');
        row.append(address, original, entered, current, activity, auto);
        row.addEventListener('click', () => selectAddress(entry.globalAddr, row));
        entered.addEventListener('dblclick', () => { if (canMutate) { editingAddress = entry.globalAddr; closeMenu(); render(); } });
        auto.addEventListener('dblclick', () => {
            if (canMutate && !submitting) {
                submitting = true;
                post({ type: 'setAutoUpdate', globalAddr: entry.globalAddr, enabled: !(entry.active && entry.readonly) });
            }
        });
        row.addEventListener('contextmenu', event => { selectAddress(entry.globalAddr, row); openMenu(event, entry.globalAddr, row); });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' && canMutate) { editingAddress = entry.globalAddr; render(); }
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, entry.globalAddr, row);
        });
        return row;
    }
    function addRow() {
        const row = document.createElement('form'); row.className = 'row draft'; row.setAttribute('role', 'row');
        const addressCell = document.createElement('div'); addressCell.className = 'cell address'; addressCell.setAttribute('role', 'gridcell');
        const addressInput = document.createElement('input'); addressInput.type = 'text'; addressInput.value = draftAddress; addressInput.placeholder = 'Global address'; addressInput.setAttribute('aria-label', 'Global address');
        addressInput.addEventListener('input', () => { draftAddress = addressInput.value; });
        addressCell.appendChild(addressInput);
        const valueCell = document.createElement('div'); valueCell.className = 'cell entered'; valueCell.setAttribute('role', 'gridcell');
        const valueInput = document.createElement('input'); valueInput.type = 'text'; valueInput.value = draftValue; valueInput.placeholder = 'Byte'; valueInput.setAttribute('aria-label', 'Entered value');
        valueInput.addEventListener('input', () => { draftValue = valueInput.value; });
        valueCell.appendChild(valueInput);
        row.append(addressCell, cell('--'), valueCell, cell('--'), checkboxCell(true, 'Activity', () => {}, 'activity', false), cell('Off', 'auto'));
        row.addEventListener('submit', event => {
            event.preventDefault(); if (submitting) return;
            let globalAddr; let value;
            try {
                globalAddr = parseAddress(addressInput.value);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                addressInput.classList.add('invalid'); addressInput.setAttribute('aria-invalid', 'true'); addressInput.title = message;
                addressInput.focus(); live.textContent = message; return;
            }
            try {
                value = parseByte(valueInput.value);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                valueInput.classList.add('invalid'); valueInput.setAttribute('aria-invalid', 'true'); valueInput.title = message;
                valueInput.focus(); live.textContent = message; return;
            }
            submitting = true; post({ type: 'add', globalAddr, value });
        });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault(); row.requestSubmit();
            }
            if (event.key === 'Escape') { event.preventDefault(); cancelAdd(); submitting = false; render(); }
        });
        if (focusDraft) { focusDraft = false; setTimeout(() => addressInput.focus(), 0); }
        return row;
    }
    function editorRow(entry) {
        const row = document.createElement('form'); row.className = 'row'; row.setAttribute('role', 'row');
        row.append(cell(hex(entry.globalAddr, 6), 'address'), cell(hex(entry.originalValue, 2)));
        const entered = document.createElement('div'); entered.className = 'cell entered'; entered.setAttribute('role', 'gridcell');
        const input = document.createElement('input'); input.type = 'text'; input.value = hex(entry.enteredValue, 2);
        input.setAttribute('aria-label', `Entered value for ${hex(entry.globalAddr, 6)}`); entered.appendChild(input);
        const activity = checkboxCell(entry.active, `Activity for ${hex(entry.globalAddr, 6)}`, enabled => {
            if (!submitting) { submitting = true; post({ type: 'setActivity', globalAddr: entry.globalAddr, enabled }); }
        }, 'activity');
        row.append(entered, cell(hex(entry.currentValue, 2)), activity, cell(entry.active && entry.readonly ? 'On' : 'Off', 'auto'));
        row.addEventListener('submit', event => {
            event.preventDefault(); if (submitting) return;
            try {
                const value = parseByte(input.value); submitting = true;
                input.classList.remove('invalid'); input.removeAttribute('aria-invalid');
                post({ type: 'setEntered', globalAddr: entry.globalAddr, value });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                input.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); input.title = message; input.focus();
                live.textContent = message;
            }
        });
        row.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); editingAddress = null; submitting = false; render(); }
        });
        row.addEventListener('focusout', () => setTimeout(() => {
            if (editingAddress === entry.globalAddr && !row.contains(document.activeElement)) row.requestSubmit();
        }, 0));
        setTimeout(() => { input.focus(); input.select(); }, 0); return row;
    }
    function openMenu(event, globalAddr, source) {
        event.preventDefault(); closeListMenu(); menuAddress = globalAddr; menuSource = source;
        menu.querySelectorAll('button').forEach(button => {
            const action = button.dataset.action;
            button.disabled = ['restore', 'deleteAndRestoreAll'].includes(action)
                ? !canRestore : ['disable', 'delete', 'deleteAndRestore'].includes(action) && !canMutate;
        });
        menu.hidden = false;
        menu.style.left = `${Math.max(4, Math.min(event.clientX || source.getBoundingClientRect().left, window.innerWidth - 190))}px`;
        menu.style.top = `${Math.max(4, Math.min(event.clientY || source.getBoundingClientRect().bottom, window.innerHeight - 270))}px`;
        menu.querySelector('button')?.focus();
    }
    function closeMenu() { if (menu.hidden) return; menu.hidden = true; menuSource?.focus(); menuAddress = null; menuSource = null; }
    function openListMenu(event, source) {
        if (event.target.closest?.('.row')) return;
        event.preventDefault(); closeMenu(); listMenuSource = source;
        if (!entries.some(entry => entry.globalAddr === selectedAddress)) {
            const fallbackAddress = entries[0]?.globalAddr ?? null;
            selectAddress(fallbackAddress, fallbackAddress === null ? null : rows.querySelector(`[data-address="${fallbackAddress}"]`));
        }
        listMenu.querySelectorAll('button').forEach(button => {
            button.disabled = !canMutate || (button.dataset.action !== 'add' && entries.length === 0);
        });
        listMenu.hidden = false;
        listMenu.style.left = `${Math.max(4, Math.min(event.clientX || source.getBoundingClientRect().left, window.innerWidth - 150))}px`;
        listMenu.style.top = `${Math.max(4, Math.min(event.clientY || source.getBoundingClientRect().bottom, window.innerHeight - 200))}px`;
        listMenu.querySelector('button:not([disabled])')?.focus();
    }
    function closeListMenu() { if (listMenu.hidden) return; listMenu.hidden = true; listMenuSource?.focus(); listMenuSource = null; }
    menu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; const globalAddr = menuAddress; closeMenu();
        if (globalAddr === null || !action) return;
        const fields = { copyOriginal: 'originalValue', copyEntered: 'enteredValue', copyCurrent: 'currentValue' };
        if (fields[action]) post({ type: 'copy', globalAddr, field: fields[action] });
        else if (action === 'reveal') post({ type: 'reveal', globalAddr });
        else if (action === 'disable' && canMutate) post({ type: 'disable', globalAddr });
        else if (action === 'restore' && canRestore) post({ type: 'restore', globalAddr });
        else if (action === 'delete' && canMutate) post({ type: 'delete', globalAddr });
        else if (action === 'deleteAndRestore' && canMutate) post({ type: 'deleteAndRestore', globalAddr });
        else if (action === 'deleteAndRestoreAll' && canRestore) post({ type: 'deleteAndRestoreAll' });
    });
    menu.addEventListener('keydown', event => {
        const buttons = [...menu.querySelectorAll('button:not([disabled])')]; const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
    });
    listMenu.addEventListener('click', event => {
        const action = event.target?.dataset?.action; const globalAddr = selectedAddress; closeListMenu();
        if (!action || !canMutate) return;
        if (action === 'add') startAdd();
        else if (globalAddr !== null && action === 'disable') post({ type: 'disable', globalAddr });
        else if (action === 'disableAll') post({ type: 'disableAll' });
        else if (globalAddr !== null && action === 'delete') post({ type: 'delete', globalAddr });
        else if (action === 'deleteAll') post({ type: 'deleteAll' });
        else if (action === 'deleteAndRestoreAll') post({ type: 'deleteAndRestoreAll' });
    });
    listMenu.addEventListener('keydown', event => {
        const buttons = [...listMenu.querySelectorAll('button:not([disabled])')]; const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); closeListMenu(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
    });
    addButton.addEventListener('click', () => { if (canMutate) startAdd(); });
    table.addEventListener('contextmenu', event => openListMenu(event, table));
    empty.addEventListener('contextmenu', event => openListMenu(event, empty));
    document.addEventListener('mousedown', event => {
        if (!menu.hidden && !menu.contains(event.target)) closeMenu();
        if (!listMenu.hidden && !listMenu.contains(event.target)) closeListMenu();
    });
    table.addEventListener('scroll', () => { closeMenu(); closeListMenu(); });
    query.addEventListener('input', () => {
        try {
            filterValue = query.value.trim() ? parseByte(query.value) : null;
            query.classList.remove('invalid'); query.removeAttribute('aria-invalid'); query.title = SEARCH_TOOLTIP;
            vscode.postMessage({ type: 'persistQuery', value: query.value }); render();
        } catch (error) {
            query.classList.add('invalid'); query.setAttribute('aria-invalid', 'true');
            query.title = error instanceof Error ? error.message : String(error);
        }
    });
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'state') {
            status.textContent = message.message; canMutate = message.canMutate; canRestore = message.canRestore;
            if (!canMutate) { editingAddress = null; cancelAdd(); submitting = false; render(); }
        }
        if (message.type === 'snapshot') {
            const changed = message.generation !== generation; generation = message.generation; entries = message.entries;
            if (changed) { editingAddress = null; closeMenu(); closeListMenu(); }
            if (editingAddress !== null && !entries.some(entry => entry.globalAddr === editingAddress)) editingAddress = null;
            if (selectedAddress !== null && !entries.some(entry => entry.globalAddr === selectedAddress)) selectedAddress = null;
            if (editingAddress === null && !adding) render();
        }
        if (message.type === 'operation') {
            submitting = false; live.textContent = message.message || (message.ok ? 'Memory edit updated' : 'Memory edit failed');
            if (message.ok) { editingAddress = null; if (message.operation === 'add') cancelAdd(); } render();
        }
        if (message.type === 'restoredQuery') {
            query.value = message.value; query.dispatchEvent(new Event('input'));
        }
    });
    vscode.postMessage({ type: 'ready' });
}());