(() => {
    const api = acquireVsCodeApi();
    const post = message => api.postMessage({ ...message, panelToken: document.body.dataset.panelToken });
    const disk = /** @type {HTMLSelectElement} */ (document.getElementById('disk'));
    const page = /** @type {HTMLSelectElement} */ (document.getElementById('page'));
    const mode = /** @type {HTMLSelectElement} */ (document.getElementById('mode'));
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('map'));
    const status = document.getElementById('status');
    const address = document.getElementById('address');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) { status.textContent = 'Canvas rendering is unavailable.'; return; }
    const image = context.createImageData(1024, 512);
    const pixels = new Uint32Array(image.data.buffer);
    const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    const rgba = (r, g, b) => littleEndian ? (0xff000000 | b << 16 | g << 8 | r) : (r << 24 | g << 16 | b << 8 | 255);
    const tint = (gray, red, blue) => rgba(
        gray + (((255 - gray) * red) >> 8),
        gray - ((gray * Math.max(red, blue)) >> 9),
        gray + (((255 - gray) * blue) >> 8),
    );
    let bank = 0;
    let scale = 1;
    /** @type {{ bytes: Uint8Array; reads: Uint8Array; writes: Uint8Array } | undefined} */
    let frame;
    /** @type {number | undefined} */
    let hovered;
    const hex = (value, digits) => value.toString(16).toUpperCase().padStart(digits, '0');

    function updateAddress() {
        address.textContent = !frame || hovered === undefined ? '' :
            `0x${hex(bank * 65536 + hovered, 6)} · 0x${hex(frame.bytes[hovered], 2)}`;
    }

    function draw() {
        if (!frame || document.hidden) { return; }
        const reads = mode.value !== 'w';
        const writes = mode.value !== 'r';
        for (let offset = 0; offset < 65536; offset++) {
            const tile = offset >> 13;
            const column = (offset >> 8) & 31;
            const row = 255 - (offset & 255) + (tile >> 2) * 256;
            const firstPixel = row * 1024 + (tile & 3) * 256 + column * 8;
            const bg = tile & 1 ? 32 : 44;
            const fg = column & 1 ? 208 : 154;
            const red = writes ? frame.writes[offset] : 0;
            const blue = reads ? frame.reads[offset] : 0;
            const off = tint(bg, red, blue);
            const on = tint(fg, red, blue);
            const value = frame.bytes[offset];
            for (let bit = 0; bit < 8; bit++) { pixels[firstPixel + bit] = value & (128 >> bit) ? on : off; }
        }
        context.putImageData(image, 0, 0);
        canvas.hidden = false;
        updateAddress();
    }

    function select() {
        const selected = Number(disk.value);
        document.getElementById('page-label').hidden = selected === 0;
        bank = selected === 0 ? 0 : 1 + (selected - 1) * 4 + Number(page.value);
        frame = undefined;
        canvas.hidden = true;
        status.textContent = 'Waiting for memory…';
        hovered = undefined;
        updateAddress();
        post({ type: 'select', bank });
    }

    function pixelOffset(event) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - rect.left) * 1024 / rect.width);
        const y = Math.floor((event.clientY - rect.top) * 512 / rect.height);
        if (!(x >= 0 && x < 1024 && y >= 0 && y < 512)) { return undefined; }
        return ((x >> 8) + (y >> 8) * 4) * 8192 + ((x & 255) >> 3) * 256 + 255 - (y & 255);
    }

    function zoom(factor, event) {
        const before = scale;
        scale = Math.max(0.25, Math.min(4, scale * factor));
        const viewport = canvas.parentElement;
        const x = event ? event.clientX - canvas.getBoundingClientRect().left : 0;
        const y = event ? event.clientY - canvas.getBoundingClientRect().top : 0;
        canvas.style.width = `${1024 * scale}px`;
        canvas.style.height = `${512 * scale}px`;
        if (event) {
            viewport.scrollLeft += x * (scale / before - 1);
            viewport.scrollTop += y * (scale / before - 1);
        }
        document.getElementById('zoom').textContent = `${Math.round(scale * 100)}%`;
    }

    disk.addEventListener('change', select);
    page.addEventListener('change', select);
    mode.addEventListener('change', draw);
    document.getElementById('refresh').addEventListener('click', () => post({ type: 'refresh' }));
    canvas.addEventListener('pointermove', event => { hovered = pixelOffset(event); updateAddress(); });
    canvas.addEventListener('pointerleave', () => { hovered = undefined; updateAddress(); });
    canvas.addEventListener('click', event => {
        const offset = pixelOffset(event);
        if (frame && offset !== undefined) { post({ type: 'reveal', bank, offset }); }
    });
    canvas.addEventListener('wheel', event => {
        if (!event.ctrlKey || !event.deltaY) { return; }
        event.preventDefault();
        zoom(event.deltaY < 0 ? 1.25 : 0.8, event);
    }, { passive: false });
    document.getElementById('zoom-in').addEventListener('click', () => zoom(1.25, undefined));
    document.getElementById('zoom-out').addEventListener('click', () => zoom(0.8, undefined));
    document.addEventListener('visibilitychange', draw);
    window.addEventListener('message', ({ data }) => {
        if (data.type === 'status') {
            status.textContent = data.text;
            canvas.hidden = true;
            frame = undefined;
            updateAddress();
        } else if (data.type === 'snapshot' && data.bank === bank) {
            frame = { bytes: new Uint8Array(data.bytes), reads: new Uint8Array(data.reads), writes: new Uint8Array(data.writes) };
            status.textContent = data.tracking ? '' : 'Read/write highlights require an attached debugger.';
            draw();
        }
    });
    post({ type: 'ready' });
})();