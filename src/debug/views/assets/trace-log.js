// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const ROW_HEIGHT = 26;
    const OVERSCAN = 8;
    const query = /** @type {HTMLInputElement} */ (document.getElementById('query'));
    const count = /** @type {HTMLSpanElement} */ (document.getElementById('count'));
    const status = /** @type {HTMLDivElement} */ (document.getElementById('status'));
    const viewport = /** @type {HTMLDivElement} */ (document.getElementById('viewport'));
    const spacer = /** @type {HTMLDivElement} */ (document.getElementById('spacer'));
    const rows = /** @type {HTMLDivElement} */ (document.getElementById('rows'));
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    /** @type {Map<number, Array<any>>} */ const windows = new Map();
    /** @type {string[]} */ let history = [];
    let historyIndex = 0;
    let draft = '';
    let generation = 0;
    let totalMatches = 0;
    let queryValid = true;
    let selectedIndex = -1;
    let requestTimer = 0;
    let lastRequest = '';
    let lastRequestedStart = 0;
    /** @type {{row:any,element:HTMLElement}|null} */ let menuTarget = null;

    query.addEventListener('input', () => {
        queryValid = true;
        query.classList.remove('invalid');
        query.removeAttribute('aria-invalid');
        vscode.postMessage({ type: 'query', value: query.value });
        persist();
    });
    query.addEventListener('keydown', event => {
        if (event.key === 'Enter' && queryValid && query.value.trim()) {
            if (history.at(-1) !== query.value) history.push(query.value);
            history = history.slice(-50);
            historyIndex = history.length;
            draft = '';
            persist();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (historyIndex === history.length) draft = query.value;
            if (historyIndex > 0) query.value = history[--historyIndex];
            sendQuery();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (historyIndex < history.length - 1) query.value = history[++historyIndex];
            else { historyIndex = history.length; query.value = draft; }
            sendQuery();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            query.value = draft || '';
            draft = '';
            historyIndex = history.length;
            sendQuery();
        }
    });

    function sendQuery() {
        query.dispatchEvent(new Event('input'));
    }
    function persist() {
        vscode.postMessage({ type: 'persist', query: query.value, history });
    }

    function visibleRange() {
        const firstVisible = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT));
        const visibleLines = Math.max(1, Math.ceil(viewport.clientHeight / ROW_HEIGHT));
        return {
            start: Math.max(0, firstVisible - OVERSCAN),
            lines: Math.min(Math.max(0, totalMatches - Math.max(0, firstVisible - OVERSCAN)), visibleLines + OVERSCAN * 2),
        };
    }

    function scheduleRequest() {
        if (!generation || !totalMatches) return;
        window.clearTimeout(requestTimer);
        requestTimer = window.setTimeout(() => {
            const range = visibleRange();
            if (!range.lines || rangeLoaded(range.start, range.lines)) return;
            const key = `${generation}:${range.start}:${range.lines}`;
            if (key === lastRequest) return;
            lastRequest = key;
            lastRequestedStart = range.start;
            vscode.postMessage({ type: 'visibleRange', generation, ...range });
        }, 50);
    }

    function rangeLoaded(start, lines) {
        for (let index = start; index < start + lines; index++) {
            if (!rowAt(index)) return false;
        }
        return true;
    }

    function rowAt(index) {
        for (const [start, entries] of windows) {
            const offset = index - start;
            if (offset >= 0 && offset < entries.length) return entries[offset];
        }
        return undefined;
    }

    function render() {
        rows.replaceChildren();
        if (!generation || !totalMatches) return;
        const range = visibleRange();
        const fragment = document.createDocumentFragment();
        for (let index = range.start; index < Math.min(totalMatches, range.start + range.lines); index++) {
            const row = rowAt(index);
            if (row) fragment.appendChild(renderRow(row));
        }
        rows.appendChild(fragment);
        scheduleRequest();
    }

    function renderRow(row) {
        const element = document.createElement('div');
        element.className = 'row';
        if (row.breakpoint) element.classList.add('breakpoint');
        if (row.index === selectedIndex) element.classList.add('selected');
        element.setAttribute('role', 'row');
        element.tabIndex = row.index === selectedIndex ? 0 : -1;
        element.style.top = `${row.index * ROW_HEIGHT}px`;
        element.dataset.index = String(row.index);

        const address = document.createElement('span');
        address.className = 'address';
        address.setAttribute('role', 'gridcell');
        const breakpoint = document.createElement('button');
        breakpoint.className = 'breakpoint-toggle';
        breakpoint.type = 'button';
        breakpoint.disabled = !row.canToggleBreakpoint;
        breakpoint.setAttribute('aria-label', `${row.breakpoint ? 'Remove' : 'Add'} breakpoint at ${row.address}`);
        breakpoint.setAttribute('aria-pressed', String(row.breakpoint));
        breakpoint.addEventListener('click', event => {
            event.stopPropagation();
            action(row, 'toggleBreakpoint');
        });
        const addressText = document.createElement('span');
        addressText.textContent = row.address;
        address.append(breakpoint, addressText);
        const listing = document.createElement('span');
        listing.className = 'listing';
        listing.setAttribute('role', 'gridcell');
        appendListing(listing, row);
        element.append(address, listing);
        element.addEventListener('click', () => selectRow(row.index, element));
        element.addEventListener('dblclick', event => {
            if (!row.sourceBacked || /** @type {HTMLElement} */ (event.target).closest('.source-link')) return;
            action(row, 'findSource');
        });
        element.addEventListener('contextmenu', event => {
            event.preventDefault();
            openMenu(event.clientX, event.clientY, row, element);
        });
        element.addEventListener('keydown', event => rowKey(event, row, element));
        return element;
    }

    function appendListing(container, row) {
        const boundaries = new Set([0, row.listing.length]);
        for (const span of [...row.highlights, ...row.links]) {
            boundaries.add(span.start);
            boundaries.add(span.start + span.length);
        }
        const sorted = [...boundaries].filter(value => value >= 0 && value <= row.listing.length).sort((a, b) => a - b);
        for (let index = 0; index < sorted.length - 1; index++) {
            const start = sorted[index];
            const end = sorted[index + 1];
            if (end <= start) continue;
            const highlight = row.highlights.find(span => span.start <= start && span.start + span.length >= end);
            const link = row.links.find(item => item.start <= start && item.start + item.length >= end);
            const part = document.createElement(link ? 'button' : 'span');
            part.className = `token-${highlight?.tokenClass || 'plain'}`;
            part.textContent = row.listing.slice(start, end);
            if (link) {
                part.classList.add('source-link');
                part.title = `Go to ${link.name}`;
                part.addEventListener('click', event => {
                    event.stopPropagation();
                    vscode.postMessage({ type: 'link', generation, index: row.index, start: link.start, length: link.length });
                });
            }
            container.appendChild(part);
        }
    }

    function selectRow(index, element) {
        selectedIndex = index;
        rows.querySelectorAll('.row').forEach(item => {
            const selected = Number(/** @type {HTMLElement} */ (item).dataset.index) === index;
            item.classList.toggle('selected', selected);
            /** @type {HTMLElement} */ (item).tabIndex = selected ? 0 : -1;
        });
        element.focus();
    }

    function rowKey(event, row, element) {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            openMenu(rect.left + 12, rect.bottom, row, element);
            return;
        }
        if (event.key === 'Enter' && row.sourceBacked) { event.preventDefault(); action(row, 'findSource'); return; }
        const page = Math.max(1, Math.floor(viewport.clientHeight / ROW_HEIGHT));
        const moves = { ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page, Home: -row.index, End: totalMatches - row.index - 1 };
        const delta = moves[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        const target = Math.max(0, Math.min(totalMatches - 1, row.index + delta));
        selectedIndex = target;
        viewport.scrollTop = target * ROW_HEIGHT;
        render();
        requestAnimationFrame(() => /** @type {HTMLElement|null} */ (rows.querySelector(`[data-index="${target}"]`))?.focus());
    }

    function openMenu(x, y, row, element) {
        closeMenu();
        menuTarget = { row, element };
        menu.hidden = false;
        const breakpoint = /** @type {HTMLButtonElement} */ (menu.querySelector('[data-action="toggleBreakpoint"]'));
        const source = /** @type {HTMLButtonElement} */ (menu.querySelector('[data-action="findSource"]'));
        breakpoint.disabled = !row.canToggleBreakpoint;
        breakpoint.setAttribute('aria-checked', String(row.breakpoint));
        source.disabled = !row.sourceBacked;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        /** @type {HTMLButtonElement|null} */ (menu.querySelector('button:not(:disabled)'))?.focus();
    }
    function closeMenu() {
        if (menu.hidden) return;
        menu.hidden = true;
        const target = menuTarget;
        menuTarget = null;
        if (target?.element.isConnected) target.element.focus();
    }
    function action(row, selectedAction) {
        vscode.postMessage({ type: 'action', generation, index: row.index, action: selectedAction });
        closeMenu();
    }

    menu.addEventListener('click', event => {
        const selectedAction = /** @type {HTMLElement} */ (event.target).dataset.action;
        if (menuTarget && selectedAction) action(menuTarget.row, selectedAction);
    });
    menu.addEventListener('keydown', event => {
        const buttons = Array.from(menu.querySelectorAll('button:not(:disabled)'));
        const current = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
        let next = -1;
        if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
        if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
    });
    document.addEventListener('mousedown', event => {
        if (!menu.hidden && !menu.contains(/** @type {Node} */ (event.target))) closeMenu();
    });
    viewport.addEventListener('scroll', () => { closeMenu(); render(); });
    new ResizeObserver(render).observe(viewport);

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'restored') {
            query.value = message.query;
            history = message.history;
            historyIndex = history.length;
        } else if (message.type === 'state') {
            status.textContent = message.message;
            status.classList.toggle('error', message.state === 'error');
            document.body.classList.toggle('loading', message.state === 'loading');
        } else if (message.type === 'queryError') {
            queryValid = !message.message;
            query.classList.toggle('invalid', !queryValid);
            query.setAttribute('aria-invalid', String(!queryValid));
            query.title = message.message || '';
        } else if (message.type === 'reset') {
            resetResult();
        } else if (message.type === 'filter') {
            closeMenu();
            generation = message.generation;
            totalMatches = message.totalMatches;
            count.textContent = totalMatches.toLocaleString();
            selectedIndex = totalMatches ? 0 : -1;
            windows.clear();
            lastRequest = '';
            viewport.scrollTop = 0;
            viewport.scrollLeft = 0;
            spacer.style.height = `${totalMatches * ROW_HEIGHT}px`;
            render();
        } else if (message.type === 'window' && message.generation === generation) {
            windows.set(message.start, message.rows);
            trimWindows();
            lastRequest = '';
            render();
        } else if (message.type === 'breakpoints' && message.generation === generation) {
            for (const value of message.values) {
                const row = rowAt(value.index);
                if (row) row.breakpoint = value.breakpoint;
            }
            render();
        } else if (message.type === 'dismissMenus') {
            closeMenu();
        }
    });

    function trimWindows() {
        const retained = [...windows.keys()]
            .sort((left, right) => Math.abs(left - lastRequestedStart) - Math.abs(right - lastRequestedStart))
            .slice(0, 3);
        for (const start of windows.keys()) if (!retained.includes(start)) windows.delete(start);
    }
    function resetResult() {
        window.clearTimeout(requestTimer);
        closeMenu();
        generation = 0;
        totalMatches = 0;
        selectedIndex = -1;
        windows.clear();
        lastRequest = '';
        count.textContent = '';
        spacer.style.height = '0';
        viewport.scrollLeft = 0;
        rows.replaceChildren();
    }

    vscode.postMessage({ type: 'ready' });
})();