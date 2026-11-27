// @ts-check

/** @typedef {import('../scripts-messages').ScriptHelpPreview} Preview */
/** @typedef {'examples' | 'intrinsics'} Catalog */

/** @param {(message: {type: 'openHelp'} | {type: 'useHelpItem', catalog: Catalog, id: string}) => void} post */
export function bindScriptHelp(post) {
    const toggles = {
        examples: document.getElementById('examples-toggle'),
        intrinsics: document.getElementById('intrinsics-toggle'),
    };
    const popup = document.getElementById('catalog');
    const search = /** @type {HTMLInputElement} */ (document.getElementById('catalog-search'));
    const items = document.getElementById('catalog-items');
    const preview = document.getElementById('catalog-preview');
    const notice = document.getElementById('help-notice');
    /** @type {Record<Catalog, readonly Preview[]>} */
    let catalogs = { examples: [], intrinsics: [] };
    /** @type {Catalog | undefined} */
    let opened;
    /** @type {HTMLButtonElement[]} */
    let buttons = [];

    function close(restoreFocus = false) {
        if (!opened) return;
        const opener = toggles[opened];
        opener.setAttribute('aria-expanded', 'false');
        opened = undefined;
        popup.hidden = true;
        if (restoreFocus) opener.focus();
    }

    /** @param {Preview} item @param {HTMLButtonElement} button */
    function show(item, button) {
        for (const option of buttons) option.classList.toggle('previewed', option === button);
        const title = document.createElement('strong');
        title.textContent = item.label;
        const details = document.createElement('p');
        details.textContent = item.help;
        preview.replaceChildren(title, details);
    }

    function render() {
        if (!opened) return;
        const catalog = opened;
        const terms = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        items.replaceChildren();
        preview.replaceChildren();
        buttons = [];
        let previousGroup;
        let firstItem;
        for (const item of catalogs[catalog]) {
            const searchable = `${item.group} ${item.label} ${item.help}`.toLocaleLowerCase();
            if (!terms.every(term => searchable.includes(term))) continue;
            if (catalog === 'intrinsics' && item.group !== previousGroup) {
                const heading = document.createElement('h3');
                heading.textContent = item.group;
                items.append(heading);
                previousGroup = item.group;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.setAttribute('aria-describedby', preview.id);
            for (const event of ['focus', 'pointerenter']) button.addEventListener(event, () => show(item, button));
            button.addEventListener('click', () => {
                close(true);
                post({ type: 'useHelpItem', catalog, id: item.id });
            });
            firstItem ??= item;
            buttons.push(button);
            items.append(button);
        }
        if (firstItem) show(firstItem, buttons[0]);
        else items.textContent = 'No matching items';
    }

    for (const key of /** @type {Catalog[]} */ (Object.keys(toggles))) {
        const toggle = toggles[key];
        toggle.addEventListener('click', () => {
            if (opened === key) { close(true); return; }
            close();
            opened = key;
            toggle.setAttribute('aria-expanded', 'true');
            popup.hidden = false;
            search.value = '';
            search.setAttribute('aria-label', `Search ${key}`);
            render();
            search.focus();
        });
    }
    search.addEventListener('input', render);
    popup.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
        const index = buttons.findIndex(button => button === document.activeElement);
        if (event.key === 'Enter' && event.target === search && buttons.length) {
            event.preventDefault(); buttons[0].click();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (event.key === 'ArrowUp' && index === 0) search.focus();
            else buttons[index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
                : Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
        }
    });
    document.addEventListener('pointerdown', event => {
        if (event.target instanceof Node && !popup.contains(event.target)
            && !Object.values(toggles).some(button => button.contains(/** @type {Node} */ (event.target)))) close();
    });
    document.getElementById('script-guide').addEventListener('click', () => post({ type: 'openHelp' }));
    return {
        close,
        /** @param {typeof catalogs} value */
        update(value) { catalogs = value; render(); },
        /** @param {string} message */
        notice(message) { notice.textContent = message; },
    };
}
