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
    EventEmitter: class EventEmitter {
        constructor() {
            this.listeners = [];
            this.event = (listener) => {
                this.listeners.push(listener);
                return { dispose: () => { this.listeners = this.listeners.filter(item => item !== listener); } };
            };
        }
        fire(value) { this.listeners.forEach(listener => listener(value)); }
        dispose() { this.listeners = []; }
    },
    Uri: mockUri,
    ThemeIcon: class ThemeIcon {
        constructor(id) { this.id = id; }
    },
    TreeItem: class TreeItem {
        constructor(label, collapsibleState) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ConfigurationTarget: { Global: 1 },
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
        onDidChangeTextDocument: () => ({ dispose: () => {} }),
        onDidCloseTextDocument: () => ({ dispose: () => {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        fs: {
            readFile: async () => Buffer.from(''),
            writeFile: async () => {},
        },
    },
    window: {
        visibleTextEditors: [],
        tabGroups: { all: [] },
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
    languages: {
        registerDocumentLinkProvider: (_selector, _provider) => ({ dispose: () => {} }),
    },
    debug: {
        activeDebugSession: undefined,
        breakpoints: [],
        _breakpointListeners: [],
        onDidChangeBreakpoints: (listener) => {
            mockVscode.debug._breakpointListeners.push(listener);
            return { dispose: () => {
                mockVscode.debug._breakpointListeners = mockVscode.debug._breakpointListeners
                    .filter(item => item !== listener);
            } };
        },
        addBreakpoints: async (breakpoints) => {
            mockVscode.debug.breakpoints.push(...breakpoints);
            mockVscode.debug._breakpointListeners.forEach(listener => listener({ added: breakpoints, removed: [], changed: [] }));
        },
        removeBreakpoints: async (breakpoints) => {
            mockVscode.debug.breakpoints = mockVscode.debug.breakpoints.filter(item => !breakpoints.includes(item));
            mockVscode.debug._breakpointListeners.forEach(listener => listener({ added: [], removed: breakpoints, changed: [] }));
        },
    },
    Position: class Position {
        constructor(line, character) { this.line = line; this.character = character; }
    },
    Selection: class Selection {
        constructor(anchor, active) { this.anchor = anchor; this.active = active; }
    },
    TabInputText: class TabInputText {
        constructor(uri) { this.uri = uri; }
    },
    TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    Range: class Range {
        constructor(start, end) { this.start = start; this.end = end; }
    },
    DocumentLink: class DocumentLink {
        constructor(range, target) { this.range = range; this.target = target; }
    },
    Hover: class Hover {
        constructor(contents, range) { this.contents = contents; this.range = range; }
    },
    Location: class Location {
        constructor(uri, rangeOrPosition) {
            this.uri = uri;
            this.range = rangeOrPosition.start
                ? rangeOrPosition
                : { ...rangeOrPosition, start: rangeOrPosition, end: rangeOrPosition };
        }
    },
    SourceBreakpoint: class SourceBreakpoint {
        constructor(location, enabled = true, condition, hitCondition, logMessage) {
            this.location = location;
            this.enabled = enabled;
            this.condition = condition;
            this.hitCondition = hitCondition;
            this.logMessage = logMessage;
        }
    },
    MarkdownString: class MarkdownString {
        constructor() { this.value = ''; this.isTrusted = false; }
        appendText(value) { this.value += value; return this; }
        appendMarkdown(value) { this.value += value; return this; }
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
