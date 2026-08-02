// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    const content = /** @type {HTMLElement} */ (document.getElementById('content'));
    const mainStats = /** @type {HTMLElement} */ (document.getElementById('main-stats'));
    const palette = /** @type {HTMLElement} */ (document.getElementById('palette'));
    const ramDisk = /** @type {HTMLElement} */ (document.getElementById('ram-disk'));
    const fdc = /** @type {HTMLElement} */ (document.getElementById('fdc'));
    const tooltip = /** @type {HTMLElement} */ (document.getElementById('tooltip'));
    const menu = /** @type {HTMLElement} */ (document.getElementById('menu'));
    const live = /** @type {HTMLElement} */ (document.getElementById('live'));
    let generation = 0;
    let canMutate = false;
    let model = null;
    let menuTarget = null;

    function post(message) { vscode.postMessage({ generation, ...message }); }
    function propertyList(target, rows) {
        target.replaceChildren();
        rows.forEach(row => {
            const term = document.createElement('dt'); term.textContent = row.label;
            const value = document.createElement('dd'); value.textContent = row.value; value.title = row.value;
            target.append(term, value);
        });
    }
    function render() {
        if (!model) { content.hidden = true; return; }
        content.hidden = false;
        propertyList(mainStats, model.rows);
        palette.replaceChildren(...model.palette.map(item => {
            const button = document.createElement('button'); button.className = 'swatch'; button.style.setProperty('--swatch', item.rgb);
            button.setAttribute('role', 'gridcell'); button.setAttribute('aria-label', item.tooltip);
            button.addEventListener('mouseenter', event => showTooltip(item.tooltip, event.clientX, event.clientY, button));
            button.addEventListener('mouseleave', hideTooltip); button.addEventListener('focus', () => showTooltip(item.tooltip, button.getBoundingClientRect().left, button.getBoundingClientRect().bottom, button)); button.addEventListener('blur', hideTooltip);
            button.addEventListener('contextmenu', event => openMenu(event, { kind: 'palette', index: item.index, hwColor: item.hwColor, element: button }));
            button.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { kind: 'palette', index: item.index, hwColor: item.hwColor, element: button }); });
            return button;
        }));
        propertyList(ramDisk, [
            { label: 'Index', value: model.ramDisk.index }, { label: 'RAM Mode', value: model.ramDisk.ramMode },
            { label: 'RAM Page', value: model.ramDisk.ramPage }, { label: 'Stack Mode', value: model.ramDisk.stackMode },
            { label: 'Stack Page', value: model.ramDisk.stackPage },
        ]);
        fdc.replaceChildren();
        propertyList(fdc, [{ label: 'Selected Drive', value: model.selectedDrive }]);
        model.drives.forEach(drive => {
            const term = document.createElement('dt'); term.textContent = drive.label;
            const value = document.createElement('dd'); const button = document.createElement('button');
            button.textContent = drive.mounted ? fileName(drive.path) : 'dismounted'; button.title = drive.mounted ? drive.path : 'No FDD mounted';
            button.setAttribute('aria-label', `${drive.label}: ${button.textContent}. ${button.title}`);
            button.addEventListener('click', () => { if (canMutate) post({ type: 'mountDrive', driveIdx: drive.index }); });
            button.addEventListener('contextmenu', event => openMenu(event, { kind: 'drive', index: drive.index, mounted: drive.mounted, element: button }));
            button.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, { kind: 'drive', index: drive.index, mounted: drive.mounted, element: button }); });
            value.appendChild(button); fdc.append(term, value);
        });
        renderPorts('in'); renderPorts('out');
    }
    function fileName(filePath) { return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath; }
    function renderPorts(direction) {
        const target = /** @type {HTMLElement} */ (document.getElementById(`ports-${direction}`)); target.replaceChildren();
        const error = model?.portErrors?.[direction]; const bytes = model?.ports?.[direction];
        if (error) { const message = document.createElement('div'); message.className = 'port-error'; message.textContent = error; target.appendChild(message); return; }
        if (!bytes) { target.textContent = 'Expand while paused to load port history'; return; }
        const grid = document.createElement('div'); grid.className = 'port-grid'; grid.setAttribute('role', 'grid');
        grid.appendChild(heading('')); for (let column = 0; column < 16; column++) grid.appendChild(heading(column.toString(16).toUpperCase()));
        bytes.forEach((value, index) => {
            if (index % 16 === 0) grid.appendChild(heading((index >> 4).toString(16).toUpperCase()));
            const cell = document.createElement('span'); const port = `0x${index.toString(16).toUpperCase().padStart(2, '0')}`; const byte = `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
            cell.textContent = byte.slice(2); cell.title = `Port ${port}: ${byte}`; cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', cell.title); grid.appendChild(cell);
        });
        target.appendChild(grid);
    }
    function heading(text) { const cell = document.createElement('span'); cell.className = 'heading'; cell.textContent = text; cell.setAttribute('role', 'columnheader'); return cell; }
    document.querySelectorAll('.disclosure').forEach(button => button.addEventListener('click', () => {
        const direction = button.dataset.direction; const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded)); const target = /** @type {HTMLElement} */ (document.getElementById(`ports-${direction}`)); target.hidden = !expanded;
        post({ type: 'setPortsExpanded', direction, expanded }); if (expanded) renderPorts(direction);
    }));
    function showTooltip(text, x, y, element) { tooltip.textContent = text; tooltip.hidden = false; tooltip.style.left = `${Math.max(8, Math.min(x, innerWidth - tooltip.offsetWidth - 8))}px`; tooltip.style.top = `${Math.max(8, Math.min(y + 8, innerHeight - tooltip.offsetHeight - 8))}px`; element.setAttribute('aria-describedby', 'tooltip'); }
    function hideTooltip() { tooltip.hidden = true; document.querySelectorAll('[aria-describedby="tooltip"]').forEach(element => element.removeAttribute('aria-describedby')); }
    function openMenu(event, target) {
        event.preventDefault(); hideTooltip(); menuTarget = target;
        menu.querySelectorAll('button').forEach(button => { const paletteAction = button.dataset.action === 'copy' || button.dataset.action === 'edit' || button.dataset.action === 'paste'; button.hidden = target.kind === 'palette' ? !paletteAction : paletteAction; button.disabled = button.dataset.action === 'copy' ? false : !canMutate || (button.dataset.action === 'dismount' && !target.mounted); });
        menu.hidden = false; menu.style.left = `${Math.max(4, Math.min(event.clientX || 12, innerWidth - 120))}px`; menu.style.top = `${Math.max(4, Math.min(event.clientY || 12, innerHeight - 100))}px`; menu.querySelector('button:not([hidden])')?.focus();
    }
    function closeMenu(restoreFocus = true) { if (menu.hidden) return; menu.hidden = true; if (restoreFocus) menuTarget?.element?.focus(); menuTarget = null; }
    function startPaletteEdit(target) {
        if (!canMutate) return;
        const input = document.createElement('input'); input.className = 'palette-editor'; input.type = 'text'; input.value = `0x${target.hwColor.toString(16).toUpperCase().padStart(2, '0')}`;
        input.setAttribute('aria-label', `Edit palette ${target.index} hardware color`); input.spellcheck = false;
        let finished = false;
        const finish = submit => {
            if (finished) return; finished = true;
            const value = input.value; input.replaceWith(target.element); target.element.focus();
            if (submit) post({ type: 'editPalette', index: target.index, value });
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); finish(true); }
            if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        target.element.replaceWith(input); input.focus(); input.select();
    }
    menu.addEventListener('click', event => { const action = event.target?.dataset?.action; const target = menuTarget; closeMenu(action !== 'edit'); if (!target || !action) return; if (action === 'copy') post({ type: 'copyPalette', index: target.index }); if (action === 'edit') startPaletteEdit(target); if (action === 'paste') post({ type: 'pastePalette', index: target.index }); if (action === 'mount') post({ type: 'mountDrive', driveIdx: target.index }); if (action === 'dismount') post({ type: 'dismountDrive', driveIdx: target.index }); });
    menu.addEventListener('keydown', event => { const buttons = [...menu.querySelectorAll('button:not([hidden]):not(:disabled)')]; const index = buttons.indexOf(document.activeElement); if (event.key === 'Escape') { event.preventDefault(); closeMenu(); } if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } });
    document.addEventListener('mousedown', event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); }); window.addEventListener('blur', closeMenu); window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'reset') { generation = message.generation; model = null; content.hidden = true; closeMenu(); hideTooltip(); }
        if (message.type === 'snapshot') { model = message.model; generation = model.generation; closeMenu(); render(); }
        if (message.type === 'state') { status.textContent = message.message; canMutate = message.canMutate; }
        if (message.type === 'operation') { live.textContent = message.message; }
    });
    vscode.postMessage({ type: 'ready' });
}());