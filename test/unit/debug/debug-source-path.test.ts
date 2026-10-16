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

    it('does not reinterpret drive-qualified or UNC paths without a workspace match', () => {
        const drivePath = 'Z:\\missing\\main.asm';
        const uncPath = '\\\\server\\share\\main.asm';
        expect(resolveDebugSourcePath(drivePath, projectRoot)).to.equal(path.normalize(drivePath));
        expect(resolveDebugSourcePath(uncPath, projectRoot)).to.equal(path.normalize(uncPath));
    });

    it('prefers the workspace copy of a source recorded at a foreign build site', () => {
        const workspaceFile = path.join(projectRoot, 'engine', 'common', 'v6_consts.asm');
        fs.mkdirSync(path.dirname(workspaceFile), { recursive: true });
        fs.writeFileSync(workspaceFile, 'nop\n');
        const buildSitePath = 'Q:\\build-site\\v6gel\\engine\\common\\v6_consts.asm';
        expect(resolveDebugSourcePath(buildSitePath, projectRoot)).to.equal(path.normalize(workspaceFile));
    });

    it('prefers the workspace copy even when the compiled-site file exists', () => {
        const buildSite = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-build-site-'));
        try {
            const buildSiteFile = path.join(buildSite, 'v6gel', 'engine', 'common', 'v6_consts.asm');
            fs.mkdirSync(path.dirname(buildSiteFile), { recursive: true });
            fs.writeFileSync(buildSiteFile, 'built\n');
            const workspaceFile = path.join(projectRoot, 'engine', 'common', 'v6_consts.asm');
            fs.mkdirSync(path.dirname(workspaceFile), { recursive: true });
            fs.writeFileSync(workspaceFile, 'workspace\n');
            expect(resolveDebugSourcePath(buildSiteFile, projectRoot)).to.equal(path.normalize(workspaceFile));
        } finally {
            fs.rmSync(buildSite, { recursive: true, force: true });
        }
    });

    it('prefers the longest matching suffix when the nesting is ambiguous', () => {
        const deep = path.join(projectRoot, 'engine', 'common', 'v6_consts.asm');
        fs.mkdirSync(path.dirname(deep), { recursive: true });
        fs.writeFileSync(deep, 'deep\n');
        const shallow = path.join(projectRoot, 'common', 'v6_consts.asm');
        fs.mkdirSync(path.dirname(shallow), { recursive: true });
        fs.writeFileSync(shallow, 'shallow\n');
        const buildSitePath = 'Q:\\build-site\\v6gel\\engine\\common\\v6_consts.asm';
        expect(resolveDebugSourcePath(buildSitePath, projectRoot)).to.equal(path.normalize(deep));
    });

    it('falls back to the compiled-site path when the workspace has no matching source', () => {
        const buildSitePath = 'Q:\\build-site\\v6gel\\docs\\notes.txt';
        expect(resolveDebugSourcePath(buildSitePath, projectRoot)).to.equal(path.normalize(buildSitePath));
    });

    it('resolves generated asset paths from the build directory into the workspace', () => {
        const asset = path.join(projectRoot, 'build', '09_sprite_frame_no_vsync', 'sprites', 'asm', 'knight_meta.asm');
        fs.mkdirSync(path.dirname(asset), { recursive: true });
        fs.writeFileSync(asset, 'nop\n');
        const buildSitePath = 'Q:\\build-site\\v6gel\\build\\09_sprite_frame_no_vsync\\sprites\\asm\\knight_meta.asm';
        expect(resolveDebugSourcePath(buildSitePath, projectRoot)).to.equal(path.normalize(asset));
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