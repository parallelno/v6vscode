import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

describe('Memory Display webview', () => {
    it('draws bits most-significant first and maps scaled clicks at tile boundaries', () => {
        const source = readFileSync(resolve(__dirname, '../../../src/debug/views/assets/memory-display.js'), 'utf8');
        const makeElement = () => ({ value: '', hidden: false, textContent: '', handlers: new Map<string, (event?: unknown) => void>(),
            addEventListener(name: string, handler: (event?: unknown) => void) { this.handlers.set(name, handler); } });
        const pixels = new Uint8ClampedArray(1024 * 512 * 4);
        const map = Object.assign(makeElement(), {
            getContext: () => ({ createImageData: () => ({ data: pixels }), putImageData() {} }),
            getBoundingClientRect: () => ({ left: 10, top: 20, width: 512, height: 256 }),
        });
        const elements = new Map(['disk', 'page', 'mode', 'status', 'address', 'zoom-in', 'zoom-out', 'refresh', 'page-label']
            .map(id => [id, makeElement()]));
        elements.set('map', map);
        const outbound: unknown[] = [];
        let receive: (event: unknown) => void = () => {};
        runInNewContext(source, {
            acquireVsCodeApi: () => ({ postMessage: (message: unknown) => outbound.push(message) }),
            document: { body: { dataset: { panelToken: 'map' } }, hidden: false, addEventListener() {},
                getElementById: (id: string) => elements.get(id) },
            window: { addEventListener: (_event: string, handler: (event: unknown) => void) => { receive = handler; } },
        });
        const bytes = new Uint8Array(65536);
        bytes[65535] = 0x80;
        receive({ data: { type: 'snapshot', bank: 0, tracking: true, bytes: bytes.buffer,
            reads: new ArrayBuffer(65536), writes: new ArrayBuffer(65536) } });
        const finalBytePixel = (256 * 1024 + 1016) * 4;
        expect(pixels[finalBytePixel]).to.be.greaterThan(pixels[finalBytePixel + 4]);
        const click = (x: number, y: number) => map.handlers.get('click')!({ clientX: 10 + x / 2, clientY: 20 + y / 2 });
        click(0, 255);
        click(256, 255);
        click(0, 511);
        click(1023, 256);
        click(1024, 256);
        expect(outbound.slice(1).map(message => (message as { offset: number }).offset)).to.deep.equal([0, 8192, 32768, 65535]);
        map.handlers.get('pointermove')!({ clientX: 521.5, clientY: 148 });
        expect(elements.get('address')!.textContent).to.equal('0x00FFFF · 0x80');
    });
});