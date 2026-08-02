// @ts-check
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    const query = /** @type {HTMLInputElement} */ (document.getElementById('query'));
    const matchCase = /** @type {HTMLButtonElement} */ (document.getElementById('match-case'));
    const wholeWord = /** @type {HTMLButtonElement} */ (document.getElementById('whole-word'));
    const status = /** @type {HTMLDivElement} */ (document.getElementById('status'));
    const list = /** @type {HTMLDivElement} */ (document.getElementById('list'));
    const menu = /** @type {HTMLDivElement} */ (document.getElementById('menu'));
    /** @type {Array<{id:string,name:string,value:string,canFindSource:boolean}>} */
    let items = [];
    /** @type {string[]} */ let history = [];
    let historyIndex = 0;
    let draft = '';
    let total = 0;
    let renderGeneration = 0;
    /** @type {{id:string,element:HTMLButtonElement}|null} */ let menuTarget = null;

    function enabled(button) { return button.getAttribute('aria-pressed') === 'true'; }
    function setEnabled(button, value) {
        button.setAttribute('aria-pressed', String(value));
        button.classList.toggle('active', value);
    }
    function sendQuery() {
        closeMenu();
        vscode.postMessage({ type: 'query', value: query.value, matchCase: enabled(matchCase), wholeWord: enabled(wholeWord) });
        persist();
    }
    function persist() {
        vscode.postMessage({ type: 'persist', query: query.value, history, matchCase: enabled(matchCase), wholeWord: enabled(wholeWord) });
    }

    query.addEventListener('input', sendQuery);
    query.addEventListener('keydown', event => {
        if (event.key === 'Enter' && query.value.trim()) {
            if (history.at(-1) !== query.value) history.push(query.value);
            history = history.slice(-50); historyIndex = history.length; draft = ''; persist();
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
            event.preventDefault(); query.value = draft || ''; draft = ''; historyIndex = history.length; sendQuery();
        }
    });
    for (const button of [matchCase, wholeWord]) {
        button.addEventListener('click', () => { setEnabled(button, !enabled(button)); sendQuery(); });
    }

    function render() {
        const generation = ++renderGeneration;
        list.replaceChildren();
        let offset = 0;
        const appendBatch = () => {
            if (generation !== renderGeneration) return;
            const fragment = document.createDocumentFragment();
            for (const item of items.slice(offset, offset + 200)) fragment.appendChild(createItem(item));
            list.appendChild(fragment); offset += 200;
            if (offset < items.length) requestAnimationFrame(appendBatch);
        };
        appendBatch();
    }

    function createItem(item) {
        const button = document.createElement('button');
        button.className = 'symbol'; button.type = 'button'; button.setAttribute('role', 'listitem');
        const name = document.createElement('span'); name.className = 'name'; name.textContent = item.name;
        const value = document.createElement('span'); value.className = 'value'; value.textContent = item.value;
        button.append(name, value);
        button.addEventListener('dblclick', event => {
            event.preventDefault(); closeMenu();
            action(item.id, event.ctrlKey || event.metaKey ? 'findHex' : 'findSource');
        });
        button.addEventListener('contextmenu', event => {
            event.preventDefault(); openMenu(event.clientX, event.clientY, item, button);
        });
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); action(item.id, 'findSource'); }
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault(); const rect = button.getBoundingClientRect(); openMenu(rect.left + 12, rect.bottom, item, button);
            }
        });
        return button;
    }

    function openMenu(x, y, item, element) {
        closeMenu(); menuTarget = { id: item.id, element }; menu.hidden = false;
        const source = /** @type {HTMLButtonElement} */ (menu.querySelector('[data-action="findSource"]'));
        source.disabled = !item.canFindSource;
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
        /** @type {HTMLButtonElement|null} */ (menu.querySelector('button:not(:disabled)'))?.focus();
    }
    function closeMenu() {
        if (menu.hidden) return;
        menu.hidden = true; const target = menuTarget; menuTarget = null;
        if (target?.element.isConnected) target.element.focus();
    }
    function action(id, selectedAction) { vscode.postMessage({ type: 'action', id, action: selectedAction }); closeMenu(); }

    menu.addEventListener('click', event => {
        const selectedAction = /** @type {HTMLElement} */ (event.target).dataset.action;
        if (menuTarget && selectedAction) action(menuTarget.id, selectedAction);
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
    document.addEventListener('mousedown', event => { if (!menu.hidden && !menu.contains(/** @type {Node} */ (event.target))) closeMenu(); });
    list.addEventListener('scroll', closeMenu);

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'restored') {
            query.value = message.query; history = message.history; historyIndex = history.length;
            setEnabled(matchCase, message.matchCase); setEnabled(wholeWord, message.wholeWord);
        } else if (message.type === 'state') {
            status.textContent = message.message;
            document.body.classList.toggle('loading', message.state === 'loading');
        } else if (message.type === 'results') {
            closeMenu(); items = message.items; total = message.total;
            status.textContent = message.error || (items.length === 0 ? 'No matching symbols' : `${items.length} of ${total} symbols`);
            status.classList.toggle('error', !!message.error); render();
        }
    });

    vscode.postMessage({ type: 'ready' });
})();