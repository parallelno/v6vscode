# Compatibility and dependency gates

## VS Code API floor

The extension requires **1.90.0**. The hover path uses `DebugStackFrame` and
`debug.activeStackItem`; integration also observes `debug.onDidChangeActiveStackItem`.
These are absent from the stable 1.89 declarations and present in 1.90:

- https://github.com/microsoft/vscode/blob/1.89.0/src/vscode-dts/vscode.d.ts
- https://github.com/microsoft/vscode/blob/1.90.0/src/vscode-dts/vscode.d.ts

`@types/vscode` is pinned exactly to the declared floor, so ordinary compilation
checks production and integration code against that API rather than a newer
version admitted by a caret range. Raise both intentionally when adopting APIs.

From the repository root (`C:\Work\Programming\v6vscode`):

1. `npm run ci` checks host/API-floor compilation, browser-shared ESM compilation,
   every shipped browser entry point through `npm run check:browser`,
   lint, deterministic unit tests (including boundaries/manifest), and regressions.
2. `npm run test:integration:minimum` downloads/runs the declared floor.
3. `npm run test:integration` uses current stable (or `V6_VSCODE_VERSION`).
4. `npm run test:integration:packaged` tests installed VSIX resources, including
   CSP-restricted numeric/matcher/address ESM execution and the actual Scripts and
   Memory Edits entry points with their relative imports. Pass `--minimum` directly to the compiled
   runner after packaging to combine packaged and minimum testing.

Live debugger tests require `V6EMUL`; startup/resource smoke runs without it.
Network access is needed for uncached VS Code downloads. These explicit lanes
are not silently part of `npm run ci`.

## Import and manifest checks

The TypeScript-AST test scans production imports/exports and literal
require/dynamic imports. It distinguishes type-only relationships from runtime
edges, rejects new core-to-view dependencies, prohibits runtime VS Code imports
in pure metadata/codecs/shared modules, and prohibits Node/VS Code imports in
browser-safe shared modules. Debugger policy owners depend on narrow display and
feedback ports; the four former adapter-to-panel exceptions were removed in R14.
No core-to-panel edge is allowed. This is an incremental gate, not a claim that all existing
architecture debt has been removed.

Manifest tests check command/menu IDs, settings constants, debugger type, API
floor/type pin/lockfile agreement and shipped browser resource rules. Internal
commands need not be contributed to the Command Palette. Tests fail on duplicate
or unknown contributed/menu commands instead of silently accepting drift.

## Browser build boundary

`tsconfig.browser-shared.json` emits strict, browser-safe shared TypeScript into
`out/webview/` as ESM. Host consumers import the same source for CommonJS output.
The browser-only `tsconfig.browser.json` checks all ten asset JavaScript entry
points with DOM/ES2022 libraries and `types: []`; it does not emit or admit Node
globals. `src/webview/vscode-webview.d.ts` describes the isolated VS Code webview
API. JavaScript checking is incremental (`strict: false`), not an assertion of
fully typed message payloads or null-safe generated markup. No blanket browser
type suppressions are permitted. Panel infrastructure remains separate roadmap work.