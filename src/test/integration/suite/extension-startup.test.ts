import * as assert from 'assert';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

suite('Language presentation startup', () => {
    test('activates with the installed grammar and Oniguruma WASM', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode');
        assert.ok(extension, 'The v6vscode extension should be installed.');

        await extension.activate();
        assert.strictEqual(extension.isActive, true);

        await vscode.workspace.fs.stat(vscode.Uri.joinPath(
            extension.extensionUri,
            'res',
            'syntaxes',
            'v6vscode_8080.tmLanguage.json',
        ));
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(
            extension.extensionUri,
            'node_modules',
            'vscode-oniguruma',
            'release',
            'onig.wasm',
        ));

        if (process.env.V6_EXPECT_PACKAGED === 'true') {
            const sourceRoot = path.resolve(process.env.V6_EXTENSION_ROOT!).toLowerCase();
            assert.notStrictEqual(path.resolve(extension.extensionPath).toLowerCase(), sourceRoot);
        }
    });
});