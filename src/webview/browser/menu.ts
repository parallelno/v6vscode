export function placeMenu(element: HTMLElement, event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    source: HTMLElement, width: number, height: number): void {
    element.hidden = false;
    const rect = source.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(event.clientX || rect.left, window.innerWidth - width))}px`;
    element.style.top = `${Math.max(4, Math.min(event.clientY || rect.bottom, window.innerHeight - height))}px`;
    element.querySelector<HTMLButtonElement>('button:not([disabled]):not([hidden])')?.focus();
}

export function closeMenu(element: HTMLElement, source: HTMLElement | null): void {
    if (!element.hidden) { element.hidden = true; source?.focus(); }
}

export function menuKeys(element: HTMLElement, close: () => void, event: KeyboardEvent): void {
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not([hidden])'));
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!buttons.length) { return; }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') { next = (index + 1) % buttons.length; }
    if (event.key === 'ArrowUp') { next = (index - 1 + buttons.length) % buttons.length; }
    if (event.key === 'Home') { next = 0; }
    if (event.key === 'End') { next = buttons.length - 1; }
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
}