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

    // --- Keyboard forwarding ---
    // The scancode mapping sends the raw key code and action (1=press, 0=release)
    // to the extension host, which forwards to the emulator via KEY_HANDLING.
    document.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'key', scancode: e.keyCode, action: 1 });
    });

    document.addEventListener('keyup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({ type: 'key', scancode: e.keyCode, action: 0 });
    });

    // Notify the extension host that the webview is ready
    vscode.postMessage({ type: 'ready' });
})();
