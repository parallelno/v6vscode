# Compatibility and dependency gates

## VS Code compatibility floor

The extension requires **1.100.0**. The declared floor is the newer of two
independent constraints:

- **API floor — 1.90.0.** The hover path uses `DebugStackFrame` and
  `debug.activeStackItem`; integration also observes
  `debug.onDidChangeActiveStackItem`. These are absent from the stable 1.89
  declarations and present in 1.90:
  - https://github.com/microsoft/vscode/blob/1.89.0/src/vscode-dts/vscode.d.ts
  - https://github.com/microsoft/vscode/blob/1.90.0/src/vscode-dts/vscode.d.ts
- **Release-verification runtime — 1.100.0.** The minimum lane runs the
  integration suites inside the VS Code extension host, whose Node version is
  fixed by the VS Code build. The test runner (Mocha 12) requires
  `^20.19.0 || >=22.12.0`. VS Code 1.99 and older ship Node 20.18 or older and
  cannot load it; 1.100.0 is the first release with Node 20.19.0.

`@types/vscode` is pinned exactly to the declared floor, so ordinary compilation
checks production and integration code against that API rather than a newer
version admitted by a caret range. Raise both intentionally when adopting APIs
or when the verification toolchain raises the runtime floor.

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

Live debugger tests require `V6EMUL`. Network access is needed for uncached VS Code downloads. These explicit lanes
are not silently part of `npm run ci`.

The release lane is **`npm run verify:release`**: unlike standalone smoke, it
requires V6EMUL, cleans stale output, runs CI/typecheck/package, tests the shipped
VSIX on current and minimum VS Code with zero pending tests, then runs mandatory
live conformance. See [shared owners and release setup](architecture-owners.md)
for the trusted self-hosted workflow prerequisites and report/approval contract.

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
type suppressions are permitted. `tsconfig.browser-ui.json` separately emits strict
DOM-only browser helpers into `out/webview/ui/`, with host/test builds excluding
those browser sources. Packaged tests execute the actual Scripts, Performance and
Memory Edits entry points and their relative shared/UI imports under CSP.

Performance/Memory Edits panel-host tests cover document tokens, ready-once,
visibility/disposal and malformed input; refresh tests prove coalescing and scoped
publication. Browser helper behavioral tests cover keyboard/focus, IME submission,
inline errors and history/drafts. Project/program tests check schema/default parity,
complete hexadecimal addresses, Run/Debug load policies and active-save publication.

## Path-policy boundary checks

The host-free `test:core` lane exercises include parsing/base resolution,
deterministic DWARF existence-probe order/fallback, metadata matching ambiguity,
local file keys, explicit project roots and injected source scanning. The import
gate prohibits runtime host adapters in pure include/path/context modules.
Provider tests cover URI/range projection and editor navigation; integration uses
the registered `vscode.executeLinkProvider` (including the declared minimum), definitions
and hover commands. The integration workspace has two folders, with the second
nested under the first; a real second-folder project launched from the first
folder verifies DAP/source navigation agreement. Ordinary project discovery keeps
its root-level `*.project.json` policy; tests do not add recursive search.

Windows runs characterize current drive/UNC/native separator behavior. Conditional
POSIX vectors are present but Windows results are not a claim of native Linux
filesystem or VS Code verification. No generic source-remapping cache, strict
file-kind check, URI canonicalizer or new include fallback was added.