export function clearInvalid(...inputs: HTMLElement[]): void {
    for (const input of inputs) { input.classList.remove('invalid'); input.removeAttribute('aria-describedby'); }
}

export function invalid(input: HTMLElement, message: string, live: HTMLElement, status: HTMLElement): null {
    input.classList.add('invalid'); input.setAttribute('aria-describedby', 'live'); input.focus();
    live.textContent = message; status.textContent = message;
    return null;
}

/** Feature submit/cancel policies stay local; IME Enter must never submit. */
export function bindEditKeys(form: HTMLFormElement, cancel: () => void): void {
    form.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
}