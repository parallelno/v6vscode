// Bootstrap ts-node with the test-specific tsconfig
process.env.TS_NODE_PROJECT = 'tsconfig.test.json';
require('ts-node/register');

// Provide a mock 'vscode' module for unit tests running outside Extension Host
const path = require('path');
const Module = require('module');

const mockUri = {
    file: (fsPath) => ({ scheme: 'file', fsPath }),
    joinPath: (base, ...segments) => ({ scheme: 'file', fsPath: path.join(base.fsPath, ...segments) }),
};

const mockVscode = {
    Uri: mockUri,
    RelativePattern: class RelativePattern {
        constructor(base, pattern) {
            this.base = base;
            this.pattern = pattern;
        }
    },
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: (_section) => ({
            get: (_key, defaultValue) => defaultValue,
        }),
        findFiles: async () => [],
        fs: {
            readFile: async () => Buffer.from(''),
            writeFile: async () => {},
        },
    },
    window: {
        createOutputChannel: (_name) => ({
            appendLine: () => {},
            dispose: () => {},
        }),
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
    },
    commands: {
        registerCommand: (_id, _handler) => ({ dispose: () => {} }),
    },
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') {
        return 'vscode';
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._cache;
require.cache['vscode'] = {
    id: 'vscode',
    filename: 'vscode',
    loaded: true,
    exports: mockVscode,
};
