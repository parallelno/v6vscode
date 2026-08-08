import { expect } from 'chai';
import * as vscode from 'vscode';
import { VsCodeSourceLineService } from '../../../src/language/source-line-service';

describe('Source line service', () => {
    it('returns the current document line and version', async () => {
        const service = new VsCodeSourceLineService(async uri => ({
            uri,
            version: 7,
            lineCount: 2,
            lineAt: line => ({ text: ['mvi a, 1', 'ret'][line] }),
        }));

        const line = await service.read(
            { file: 'src/main.asm', line: 2, column: 1, isStmt: true },
            'C:\\project',
        );

        expect(line).to.deep.include({ line: 2, text: 'ret', version: '7' });
        expect(line?.sourceId).to.equal(vscode.Uri.file('C:\\project\\src\\main.asm').toString());
        service.dispose();
    });

    it('rejects invalid and out-of-range debug lines', async () => {
        const service = new VsCodeSourceLineService(async uri => ({
            uri,
            version: 1,
            lineCount: 1,
            lineAt: () => ({ text: 'ret' }),
        }));
        const location = { file: 'main.asm', line: 0, column: 1, isStmt: true };

        expect(await service.read(location, 'C:\\project')).to.equal(undefined);
        expect(await service.read({ ...location, line: 2 }, 'C:\\project')).to.equal(undefined);
        service.dispose();
    });

    it('refreshes cached lines when the dirty document version changes', async () => {
        let version = 1;
        let text = 'nop';
        const service = new VsCodeSourceLineService(async uri => ({
            uri,
            version,
            lineCount: 1,
            lineAt: () => ({ text }),
        }));
        const location = { file: 'main.asm', line: 1, column: 1, isStmt: true };

        expect((await service.read(location, 'C:\\project'))?.text).to.equal('nop');
        version = 2;
        text = 'ret';
        expect((await service.read(location, 'C:\\project'))?.text).to.equal('ret');
        service.dispose();
    });

    it('bounds cached source lines', async () => {
        let reads = 0;
        const service = new VsCodeSourceLineService(async uri => ({
            uri,
            version: 1,
            lineCount: 3,
            lineAt: line => { reads++; return { text: String(line) }; },
        }), 2);
        const location = { file: 'main.asm', line: 1, column: 1, isStmt: true };

        await service.read(location, 'C:\\project');
        await service.read({ ...location, line: 2 }, 'C:\\project');
        await service.read({ ...location, line: 3 }, 'C:\\project');
        await service.read(location, 'C:\\project');

        expect(reads).to.equal(4);
        service.dispose();
    });

    it('uses case-insensitive source identities on Windows', async function () {
        if (process.platform !== 'win32') { this.skip(); }
        let reads = 0;
        const service = new VsCodeSourceLineService(async uri => ({
            uri,
            version: 1,
            lineCount: 1,
            lineAt: () => { reads++; return { text: 'ret' }; },
        }));
        const location = { file: 'src\\main.asm', line: 1, column: 1, isStmt: true };

        await service.read(location, 'C:\\Project');
        await service.read(location, 'c:\\project');

        expect(reads).to.equal(1);
        service.dispose();
    });
});