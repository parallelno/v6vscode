// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const status = /** @type {HTMLElement} */ (document.getElementById('status'));
    let generation = 0;
    let model = null;

    function heading(text, role) {
        const cell = document.createElement('span');
        cell.className = 'heading'; cell.textContent = text; cell.setAttribute('role', role);
        return cell;
    }

    function renderDirection(direction) {
        const target = /** @type {HTMLElement} */ (document.getElementById(`ports-${direction}`));
        target.replaceChildren();
        const error = model?.errors?.[direction];
        if (error) {
            const message = document.createElement('div'); message.className = 'error'; message.textContent = error;
            target.appendChild(message); return;
        }
        const bytes = model?.ports?.[direction];
        if (!bytes) { target.textContent = 'No snapshot'; return; }
        const changed = new Set(model?.changed?.[direction] || []);
        const grid = document.createElement('div'); grid.className = 'port-grid'; grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', `${direction === 'in' ? 'In' : 'Out'} port values`);
        grid.appendChild(heading('', 'columnheader'));
        for (let column = 0; column < 16; column++) grid.appendChild(heading(column.toString(16).toUpperCase(), 'columnheader'));
        bytes.forEach((value, index) => {
            if (index % 16 === 0) grid.appendChild(heading((index >> 4).toString(16).toUpperCase(), 'rowheader'));
            const port = `0x${index.toString(16).toUpperCase().padStart(2, '0')}`;
            const byte = `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
            const cell = document.createElement('span'); cell.textContent = byte.slice(2); cell.setAttribute('role', 'gridcell');
            const didChange = changed.has(index);
            if (didChange) cell.className = 'changed';
            cell.title = `Port ${port}: ${byte}${didChange ? ' (changed)' : ''}`;
            cell.setAttribute('aria-label', cell.title);
            grid.appendChild(cell);
        });
        target.appendChild(grid);
    }

    function render() { renderDirection('in'); renderDirection('out'); }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'reset') { generation = message.generation; model = null; render(); }
        if (message.type === 'snapshot') { model = message.model; generation = model.generation; render(); }
        if (message.type === 'state') status.textContent = message.message;
    });
    vscode.postMessage({ type: 'ready' });
}());