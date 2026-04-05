import { expect } from 'chai';
import * as path from 'path';
import { PathService } from '../../../src/platform/files/path-service';
import { MockUri } from '../../helpers/mock-vscode';

// PathService uses vscode.Uri internally, but we can test its pure logic
// by constructing it with a MockUri that satisfies the shape.

describe('PathService', () => {
    const extensionRoot = path.join('C:', 'extensions', 'v6vscode');
    let pathService: PathService;

    beforeEach(() => {
        // PathService expects a vscode.Uri-like object with fsPath
        pathService = new PathService(MockUri.file(extensionRoot) as any);
    });

    describe('resolveExtensionPath', () => {
        it('should resolve a relative path from the extension root', () => {
            const result = pathService.resolveExtensionPath('res/boot/boots.bin');
            expect(result).to.equal(path.join(extensionRoot, 'res', 'boot', 'boots.bin'));
        });

        it('should handle nested paths', () => {
            const result = pathService.resolveExtensionPath('res/v6emul/v6emul.exe');
            expect(result).to.equal(path.join(extensionRoot, 'res', 'v6emul', 'v6emul.exe'));
        });
    });

    describe('expandTokens', () => {
        it('should replace ${extension} with extension root path', () => {
            const result = pathService.expandTokens('${extension}/res/boot/boots.bin');
            expect(result).to.equal(`${extensionRoot}/res/boot/boots.bin`);
        });

        it('should replace multiple occurrences', () => {
            const result = pathService.expandTokens('${extension}/a and ${extension}/b');
            expect(result).to.equal(`${extensionRoot}/a and ${extensionRoot}/b`);
        });

        it('should return input unchanged if no tokens present', () => {
            const result = pathService.expandTokens('some/plain/path');
            expect(result).to.equal('some/plain/path');
        });
    });

    describe('resolveRelative', () => {
        it('should resolve a relative path from a base directory', () => {
            const result = pathService.resolveRelative('/project/src', '../build/out.rom');
            expect(result).to.equal(path.resolve('/project/src', '../build/out.rom'));
        });

        it('should return absolute paths unchanged', () => {
            const abs = path.resolve('/usr/bin/v6emul');
            const result = pathService.resolveRelative('/project', abs);
            expect(result).to.equal(abs);
        });
    });
});
