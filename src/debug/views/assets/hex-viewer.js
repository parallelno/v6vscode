// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const ROW_HEIGHT = 24;
    const ROW_COUNT = 4096;
    const OVERSCAN = 8;
    const SEARCH_TOOLTIP = 'Enter a decimal address; a hexadecimal address as 0x100, 100h, or $100; a Main RAM symbol; or an inclusive range such as 11-14 or $100..$1FF. Results update while you type.';
    const query = /** @type {HTMLInputElement} */ (document.getElementById('query'));
    const spaceSelect = /** @type {HTMLSelectElement} */ (document.getElementById('space'));
    const status = /** @type {HTMLDivElement} */ (document.getElementById('status'));
    const viewport = /** @type {HTMLDivElement} */ (document.getElementById('viewport'));
    const rows = /** @type {HTMLDivElement} */ (document.getElementById('rows'));
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    /** @type {Map<string, { values: Uint8Array, valid: Uint8Array }>} */
    const cache = new Map();
    /** @type {Array<{name:string,address:number,size:number}>} */
    let symbols = [];
    const sourceAddresses = new Set();
    /** @type {any} */ let selectedSpace = { kind: 'main' };
    /** @type {Array<{space:any,label:string}>} */ let spaces = [];
    let highlightStart = -1;
    let highlightEnd = -1;
    let history = [];
    let historyIndex = 0;
    let draft = '';
    /** @type {{target:'byte'|'symbol',value:string,address:number,space:any,element:HTMLElement}|null} */
    let menuTarget = null;
    let lastVisibleKey = '';

    const key = (space) => space.kind === 'main' ? 'main' : `ramDisk:${space.disk}:${space.bank}`;
    function bankCache() {
        const cacheKey = key(selectedSpace);
        let bank = cache.get(cacheKey);
        if (!bank) {
            bank = { values: new Uint8Array(0x10000), valid: new Uint8Array(0x10000) };
            cache.set(cacheKey, bank);
        }
        return bank;
    }

    function render() {
        if (document.body.classList.contains('session-empty')) {
            rows.replaceChildren();
            return;
        }
        const firstVisible = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT));
        const visibleCount = Math.max(1, Math.ceil(viewport.clientHeight / ROW_HEIGHT));
        const lastVisible = Math.min(ROW_COUNT - 1, firstVisible + visibleCount - 1);
        const firstRender = Math.max(0, firstVisible - OVERSCAN);
        const lastRender = Math.min(ROW_COUNT - 1, lastVisible + OVERSCAN);
        const bank = bankCache();
        rows.replaceChildren();
        for (let rowIndex = firstRender; rowIndex <= lastRender; rowIndex++) {
            rows.appendChild(renderRow(rowIndex, bank));
        }
        const visibleKey = `${key(selectedSpace)}:${firstVisible}:${lastVisible}`;
        if (visibleKey !== lastVisibleKey) {
            lastVisibleKey = visibleKey;
            vscode.postMessage({ type: 'visibleRange', space: selectedSpace, offset: firstVisible * 16, length: (lastVisible - firstVisible + 1) * 16 });
        }
    }

    function renderRow(rowIndex, bank) {
        const row = document.createElement('div');
        row.className = 'row'; row.setAttribute('role', 'row'); row.style.top = `${rowIndex * ROW_HEIGHT}px`;
        const offset = rowIndex * 16;
        const address = document.createElement('span'); address.className = 'address'; address.textContent = offset.toString(16).toUpperCase().padStart(4, '0'); row.appendChild(address);
        const byteGroup = document.createElement('span'); byteGroup.className = 'bytes';
        for (let column = 0; column < 16; column++) {
            const byteAddress = offset + column;
            const button = document.createElement('button'); button.className = 'byte'; button.setAttribute('role', 'gridcell'); button.tabIndex = -1;
            button.textContent = bank.valid[byteAddress] ? bank.values[byteAddress].toString(16).toUpperCase().padStart(2, '0') : '--';
            if (byteAddress >= highlightStart && byteAddress <= highlightEnd) button.classList.add('match');
            const char = bank.valid[byteAddress] ? character(bank.values[byteAddress]) : '.';
            button.title = `Address: 0x${byteAddress.toString(16).toUpperCase().padStart(4, '0')}, char: ${char}`;
            button.addEventListener('mouseenter', () => row.classList.add('hovered'));
            button.addEventListener('mouseleave', () => row.classList.remove('hovered'));
            button.addEventListener('contextmenu', event => openMenu(event, { target: 'byte', value: button.textContent || '', address: byteAddress, space: selectedSpace, element: button }));
            button.addEventListener('keydown', event => byteKey(event, byteAddress));
            byteGroup.appendChild(button);
        }
        row.appendChild(byteGroup);
        const symbolGroup = document.createElement('span'); symbolGroup.className = 'symbols';
        symbols.filter(symbol => symbol.address >= offset && symbol.address < offset + 16).forEach(symbol => {
            const button = document.createElement('button'); button.className = 'symbol'; button.textContent = symbol.name;
            button.title = `Address: 0x${symbol.address.toString(16).toUpperCase().padStart(4, '0')}`;
            button.addEventListener('click', () => {
                query.value = symbol.name;
                highlightStart = symbol.address;
                highlightEnd = Math.min(0xFFFF, symbol.address + Math.max(1, symbol.size) - 1);
                query.classList.remove('invalid');
                query.title = SEARCH_TOOLTIP;
                persist();
                render();
            });
            button.addEventListener('contextmenu', event => openMenu(event, { target: 'symbol', value: symbol.name, address: symbol.address, space: selectedSpace, element: button }));
            symbolGroup.appendChild(button);
        });
        row.appendChild(symbolGroup); return row;
    }

    function character(value) { if (value === 0x20) return 'space'; return value >= 0x21 && value <= 0x7E ? String.fromCharCode(value) : '.'; }
    function byteKey(event, address) {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') { event.preventDefault(); event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })); return; }
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16, PageUp: -16 * Math.floor(viewport.clientHeight / ROW_HEIGHT), PageDown: 16 * Math.floor(viewport.clientHeight / ROW_HEIGHT) };
        const delta = moves[event.key]; if (delta === undefined) return; event.preventDefault(); navigateFocus(Math.max(0, Math.min(0xFFFF, address + delta)));
    }
    function navigateFocus(address) { viewport.scrollTop = Math.floor(address / 16) * ROW_HEIGHT; render(); requestAnimationFrame(() => rows.querySelectorAll('.byte')[address % 16 + OVERSCAN * 16]?.focus()); }

    function openMenu(event, target) {
        event.preventDefault(); menuTarget = target; menu.hidden = false; menu.style.left = `${Math.min(event.clientX, window.innerWidth - 150)}px`; menu.style.top = `${Math.min(event.clientY, window.innerHeight - 70)}px`;
        const source = /** @type {HTMLButtonElement} */ (menu.querySelector('[data-action="source"]')); source.disabled = target.space.kind !== 'main' || !sourceAddresses.has(target.address);
        /** @type {HTMLButtonElement} */ (menu.querySelector('button')).focus();
    }
    function closeMenu() { if (menu.hidden) return; menu.hidden = true; menuTarget?.element.focus(); menuTarget = null; }
    menu.addEventListener('click', event => { const action = /** @type {HTMLElement} */ (event.target).dataset.action; if (!menuTarget || !action) return; if (action === 'copy') vscode.postMessage({ type: 'copy', target: menuTarget.target, value: menuTarget.value, address: menuTarget.address, space: menuTarget.space }); else vscode.postMessage({ type: 'findSource', address: menuTarget.address, space: menuTarget.space }); closeMenu(); });
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeMenu(); } });
    document.addEventListener('mousedown', event => { if (!menu.hidden && !menu.contains(/** @type {Node} */(event.target))) closeMenu(); });

    query.addEventListener('input', () => { vscode.postMessage({ type: 'query', value: query.value }); persist(); });
    query.addEventListener('keydown', event => {
        if (event.key === 'Enter' && query.value.trim()) { if (history.at(-1) !== query.value) history.push(query.value); history = history.slice(-50); historyIndex = history.length; draft = ''; persist(); }
        if (event.key === 'ArrowUp') { event.preventDefault(); if (historyIndex === history.length) draft = query.value; if (historyIndex > 0) query.value = history[--historyIndex]; vscode.postMessage({ type: 'query', value: query.value }); }
        if (event.key === 'ArrowDown') { event.preventDefault(); if (historyIndex < history.length - 1) query.value = history[++historyIndex]; else { historyIndex = history.length; query.value = draft; } vscode.postMessage({ type: 'query', value: query.value }); }
    });
    spaceSelect.addEventListener('change', () => { selectedSpace = spaces[spaceSelect.selectedIndex]?.space || { kind: 'main' }; lastVisibleKey = ''; symbols = []; vscode.postMessage({ type: 'selectSpace', space: selectedSpace }); persist(); render(); });
    viewport.addEventListener('scroll', () => { closeMenu(); render(); });
    new ResizeObserver(render).observe(viewport);
    function persist() { vscode.postMessage({ type: 'persist', space: selectedSpace, query: query.value, history }); }

    function resetSession() {
        closeMenu();
        cache.clear();
        symbols = [];
        sourceAddresses.clear();
        spaces = [];
        highlightStart = -1;
        highlightEnd = -1;
        lastVisibleKey = '';
        rows.replaceChildren();
        spaceSelect.replaceChildren();
        document.body.classList.add('session-empty');
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'state') {
            status.textContent = message.message;
            if (message.state === 'unsupported' || message.state === 'ready' || message.state === 'running' || message.state === 'stale') {
                document.body.classList.remove('session-empty');
            }
        }
        if (message.type === 'reset') resetSession();
        if (message.type === 'spaces') { document.body.classList.remove('session-empty'); spaces = message.spaces; selectedSpace = message.selected; spaceSelect.replaceChildren(...spaces.map(item => { const option = document.createElement('option'); option.textContent = item.label; return option; })); spaceSelect.selectedIndex = Math.max(0, spaces.findIndex(item => key(item.space) === key(selectedSpace))); lastVisibleKey = ''; render(); }
        if (message.type === 'memory' && key(message.space) === key(selectedSpace)) { if (document.body.classList.contains('session-empty')) return; const bank = bankCache(); bank.values.set(new Uint8Array(message.values), message.offset); bank.valid.set(new Uint8Array(message.valid), message.offset); symbols = message.symbols; sourceAddresses.clear(); message.sourceAddresses.forEach(address => sourceAddresses.add(address)); render(); }
        if (message.type === 'navigate') { highlightStart = message.start; highlightEnd = message.end; viewport.scrollTop = Math.floor(message.start / 16) * ROW_HEIGHT; lastVisibleKey = ''; render(); }
        if (message.type === 'clearHighlight') { highlightStart = -1; highlightEnd = -1; render(); }
        if (message.type === 'queryError') { query.classList.toggle('invalid', !!message.message); query.title = message.message || SEARCH_TOOLTIP; }
        if (message.type === 'restored') { selectedSpace = message.space; query.value = message.query; history = message.history; historyIndex = history.length; draft = ''; }
    });
    vscode.postMessage({ type: 'ready' }); render();
})();