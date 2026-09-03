import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveDebugSourcePath } from '../../../src/debug/metadata/debug-source-path';

describe('resolveDebugSourcePath', () => {
    let projectRoot: string;
    let sourcePath: string;

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-source-path-'));
        sourcePath = path.join(projectRoot, 'src', 'main.asm');
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, 'nop\n');
    });

    afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    it('keeps an existing absolute source path', () => {
        expect(resolveDebugSourcePath(sourcePath, projectRoot)).to.equal(path.normalize(sourcePath));
    });

    it('resolves a relative DWARF path from the project root', () => {
        expect(resolveDebugSourcePath('src/main.asm', projectRoot)).to.equal(sourcePath);
    });

    it('treats a single-rooted DWARF path as project-relative when it is not a real absolute file', () => {
        expect(resolveDebugSourcePath('/src/main.asm', projectRoot)).to.equal(sourcePath);
        expect(resolveDebugSourcePath('\\src\\main.asm', projectRoot)).to.equal(sourcePath);
    });

    it('does not reinterpret drive-qualified or UNC paths', () => {
        const drivePath = 'Z:\\missing\\main.asm';
        const uncPath = '\\\\server\\share\\main.asm';
        expect(resolveDebugSourcePath(drivePath, projectRoot)).to.equal(path.normalize(drivePath));
        expect(resolveDebugSourcePath(uncPath, projectRoot)).to.equal(path.normalize(uncPath));
    });

    it('is shared by source navigation and DAP stack frames', () => {
        const root = process.cwd();
        for (const relativePath of [
            'src/debug/views/debug-source-navigation.ts',
            'src/debug/adapter/v6-debug-adapter.ts',
        ]) {
            expect(fs.readFileSync(path.join(root, relativePath), 'utf8')).to.include('resolveDebugSourcePath(');
        }
        for (const relativePath of [
            'src/debug/views/symbols-panel.ts',
            'src/debug/views/hex-viewer-provider.ts',
        ]) {
            expect(fs.readFileSync(path.join(root, relativePath), 'utf8')).to.include('revealDebugSource(');
        }
    });
});