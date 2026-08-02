import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';

describe('Hardware statistics webview', () => {
    const assets = path.join(process.cwd(), 'src', 'debug', 'views', 'assets');
    const script = fs.readFileSync(path.join(assets, 'hardware-statistics.js'), 'utf8');
    const styles = fs.readFileSync(path.join(assets, 'hardware-statistics.css'), 'utf8');

    it('uses only the immediate custom tooltip for palette swatches', () => {
        expect(script).not.to.include('button.title = item.tooltip');
        expect(script).to.include("button.addEventListener('mouseenter'");
    });

    it('keeps drive actions hidden in the palette context menu', () => {
        expect(script).to.include("button.dataset.action === 'edit'");
        expect(styles).to.match(/#menu button\[hidden\]\s*\{\s*display:\s*none;/);
    });

    it('submits inline palette edits to the extension host', () => {
        expect(script).to.include("post({ type: 'editPalette', index: target.index, value })");
        expect(script).to.include("if (event.key === 'Escape')");
    });

    it('uses one delayed tooltip and opens the mount dialog when a drive is clicked', () => {
        expect(script).to.include("button.title = drive.mounted ? drive.path : 'No FDD mounted'");
        expect(script).not.to.include("showTooltip(button.title");
        expect(script).to.include("post({ type: 'mountDrive', driveIdx: drive.index })");
    });

    it('shows the mounted FDD filename for either path separator', () => {
        expect(script).to.include('filePath.split(/[\\\\/]/)');
        expect(script).to.include("drive.mounted ? fileName(drive.path) : 'dismounted'");
    });
});