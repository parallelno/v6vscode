// @ts-check
// Webview script for the Vector-06C emulator panel.
// Communicates with the extension host via vscode.postMessage / message events.

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
    const ctx = canvas.getContext('2d');
    const viewport = /** @type {HTMLDivElement} */ (document.getElementById('viewport'));
    const btnRunPause = /** @type {HTMLButtonElement} */ (document.getElementById('btn-run-pause'));
    const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset'));
    const selSpeed = /** @type {HTMLSelectElement} */ (document.getElementById('sel-speed'));
    const selDisplay = /** @type {HTMLSelectElement} */ (document.getElementById('sel-display'));
    const errorBar = /** @type {HTMLDivElement} */ (document.getElementById('error-bar'));

    let isRunning = false;
    let isWebviewFocused = document.hasFocus();

    function resizeScreen() {
        const aspectRatio = 4 / 3;
        const viewportWidth = viewport.clientWidth;
        const viewportHeight = viewport.clientHeight;
        const width = Math.min(viewportWidth, viewportHeight * aspectRatio);
        const height = width / aspectRatio;

        canvas.style.width = `${Math.floor(width)}px`;
        canvas.style.height = `${Math.floor(height)}px`;
    }

    new ResizeObserver(resizeScreen).observe(viewport);

    // --- Message handling from extension host ---
    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'frame':
                renderFrame(msg.width, msg.height, msg.pixels);
                break;
            case 'status':
                updateStatus(msg.running, msg.speed, msg.viewMode);
                break;
            case 'error':
                showError(msg.message);
                break;
        }
    });

    // --- Frame rendering ---
    function renderFrame(width, height, pixels) {
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        resizeScreen();
        // pixels arrives as Uint8Array via structured clone — wrap directly as ImageData
        const clamped = new Uint8ClampedArray(pixels.buffer || pixels);
        const imageData = new ImageData(clamped, width, height);
        ctx.putImageData(imageData, 0, 0);
        hideError();
    }

    // --- Status update ---
    function updateStatus(running, speed, viewMode) {
        isRunning = running;
        btnRunPause.textContent = running ? '\u23F8' : '\u25B6';
        btnRunPause.title = running ? 'Pause' : 'Run';
        selSpeed.value = speed;
        selDisplay.value = viewMode;
    }

    // --- Error display ---
    function showError(message) {
        errorBar.textContent = message;
        errorBar.classList.remove('hidden');
    }

    function hideError() {
        errorBar.classList.add('hidden');
    }

    // --- Controls ---
    btnRunPause.addEventListener('click', () => {
        vscode.postMessage({ type: isRunning ? 'pause' : 'run' });
    });

    btnReset.addEventListener('click', () => {
        vscode.postMessage({ type: 'reset' });
    });

    selSpeed.addEventListener('change', () => {
        vscode.postMessage({ type: 'setSpeed', value: selSpeed.value });
    });

    selDisplay.addEventListener('change', () => {
        vscode.postMessage({ type: 'setViewMode', value: selDisplay.value });
    });

    window.addEventListener('focus', () => {
        isWebviewFocused = true;
    });

    window.addEventListener('blur', () => {
        isWebviewFocused = false;
    });

    // --- Keyboard forwarding ---
    // The selected emulator webview sends the raw key code and action
    // (1=press, 0=release) to the extension host via KEY_HANDLING.
    document.addEventListener('keydown', (e) => {
        if (!isWebviewFocused || isInteractiveControl(document.activeElement)) {
            return;
        }
        const scancode = getEmulatorKeyCode(e);
        if (scancode === undefined) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'key', scancode, action: 1 });
    });

    document.addEventListener('keyup', (e) => {
        if (!isWebviewFocused || isInteractiveControl(document.activeElement)) {
            return;
        }
        const scancode = getEmulatorKeyCode(e);
        if (scancode === undefined) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'key', scancode, action: 0 });
    });

    function isInteractiveControl(element) {
        return element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement;
    }

    /** @type {Record<string, number>} */
    const emulatorKeyCodes = {
        KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45,
        KeyF: 0x46, KeyG: 0x47, KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4A,
        KeyK: 0x4B, KeyL: 0x4C, KeyM: 0x4D, KeyN: 0x4E, KeyO: 0x4F,
        KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52, KeyS: 0x53, KeyT: 0x54,
        KeyU: 0x55, KeyV: 0x56, KeyW: 0x57, KeyX: 0x58, KeyY: 0x59,
        KeyZ: 0x5A,
        Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
        Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
        Space: 0x20, Minus: 0xBD, Equal: 0xBB, BracketLeft: 0xDB, BracketRight: 0xDD,
        Backslash: 0xDC, Semicolon: 0xBA, Quote: 0xDE, Backquote: 0xC0,
        Comma: 0xBC, Period: 0xBE, Slash: 0xBF,
        F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
        F7: 0x76, F8: 0x77, F11: 0x7A, F12: 0x7B,
        Tab: 0x09, Enter: 0x0D, NumpadEnter: 0x0D, Backspace: 0x08, Escape: 0x1B,
        ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
        ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA2,
        MetaLeft: 0x5B, AltLeft: 0xA4, AltRight: 0xA5,
    };

    function getEmulatorKeyCode(event) {
        return emulatorKeyCodes[event.code];
    }

    // Notify the extension host that the webview is ready
    vscode.postMessage({ type: 'ready' });
})();
