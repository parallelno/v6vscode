# v6vscode Implementation Plan

Reference: [design.md](references/design.md)

---

## 1. Project Layout

```
v6vscode/
  .vscode/
    launch.json                           # Extension host debug config
    tasks.json                            # Compile / test tasks
  src/
    extension.ts                          # Composition root only
    platform/
      logging/logger.ts                   # Output channel + structured log levels
      errors/error-codes.ts               # Typed error codes
      errors/v6-error.ts                  # Extension error class
      process/process-runner.ts           # Async child process wrapper
      files/path-service.ts              # Path resolution, ${extension} expansion
      files/workspace-service.ts         # Workspace folder access
      disposable/lifecycle.ts            # Disposable helpers
    config/
      contribution-ids.ts                # Command IDs, view IDs, setting keys
      schemas/
        v6.project.schema.json
    project/
      model/v6-project.ts               # Project config interfaces
      parsing/project-parser.ts          # Parse *.project.json
      validation/project-validator.ts    # Schema + semantic validation
      discovery/project-discovery.ts     # Find *.project.json in workspace root
      persistence/project-repository.ts  # Load/save project files
      active/active-project-service.ts   # Track selected project
    language/
      includes/include-link-provider.ts  # Ctrl+click on .include paths
      syntax/                            # Grammar registration
    emulator/
      launcher/v6emul-locator.ts        # Resolve v6emul binary path
      launcher/v6emul-launcher.ts       # Emulator process launcher
      client/ipc-client.ts              # TCP client, request-response
      protocol/ipc-codec.ts             # MessagePack encode/decode
      protocol/ipc-commands.ts          # Typed command enums and interfaces
      lifecycle/emulator-lifecycle.ts   # Launch, stop, restart orchestration
      panel/emulator-panel.ts           # Webview panel creation and message bridge
      panel/emulator-viewmodel.ts       # Typed view model for panel state
      panel/assets/
        panel.html                      # Webview shell
        panel.css                       # Webview styles
        panel.js                        # Webview script (canvas, controls, keyboard)
    commands/
      create-project-command.ts
      run-project-command.ts
    templates/
      project/                          # Starter *.project.json templates
      asm/                              # Starter *.asm source
      c/                                # Starter *.c source
      makefiles/                        # Makefile templates (asm-rom, asm-fdd, c-rom, c-fdd)
  test/
    helpers/
      mock-process-runner.ts            # Stub ProcessRunner
      mock-tcp-server.ts                # Minimal IPC test server
      mock-vscode.ts                    # Lightweight VS Code type stubs
    unit/
      platform/
      project/
      language/
      emulator/
    integration/
      index.ts                          # Extension Host test bootstrap
    regression/
    fixtures/
      projects/                         # Sample *.project.json files
      roms/                             # Stub ROM/FDD binaries
  docs/
  design/
  res/
    boot/boots.bin
    fdd/rds308.fdd
    images/icon.png
    syntaxes/devector_8080.tmLanguage.json
    v6emul/                             # Bundled emulator backend
  language-configuration.json
  tsconfig.json
  package.json
  .vscodeignore
  .eslintrc.json
  README.md
  LICENSE
```

---

## 2. Implementation Details

### 2.1 Extension Bootstrap

**`package.json`** declares:
- `activationEvents`: `workspaceContains:**/*.project.json`, `onCommand:v6.createProject`, `onCommand:v6.runProject`.
- `contributes.commands`: `v6.createProject`, `v6.runProject`.
- `contributes.languages`: language id `v6asm`, file extensions `.asm`, `.inc`, grammar path `res/syntaxes/devector_8080.tmLanguage.json`.
- `contributes.configuration`: `v6.emulatorPath` (string, optional), `v6.logLevel` (enum: error/warn/info/debug).
- `contributes.jsonValidation`: glob `*.project.json` → bundled `v6.project.schema.json`.

**`extension.ts`** (`activate`):
1. Create `Logger` with configured log level.
2. Create platform services: `PathService`, `WorkspaceService`, `ProcessRunner`.
3. Create domain services: `ProjectDiscovery`, `ProjectRepository`, `ActiveProjectService`, `V6emulLocator`, `EmulatorLauncher`, `EmulatorLifecycle`.
4. Register commands: `v6.createProject` → `CreateProjectCommand`, `v6.runProject` → `RunProjectCommand`.
5. Register language contributions (grammar is declared in `package.json`; `IncludeLinkProvider` registered as a `DocumentLinkProvider`).
6. Push all disposables onto `context.subscriptions`.

### 2.2 Platform Layer

**`logger.ts`** — Wraps `vscode.window.createOutputChannel`. Exposes `error()`, `warn()`, `info()`, `debug()`. Checks configured log level before writing.

**`error-codes.ts`** — String enum of all error codes: `CONFIG_INVALID`, `EMULATOR_NOT_FOUND`, `EXECUTABLE_NOT_FOUND`, `EMULATOR_LAUNCH_FAILED`, `IPC_CONNECTION_REFUSED`, `IPC_TIMEOUT`, `IPC_DECODE_ERROR`.

**`v6-error.ts`** — `V6Error extends Error` with `code: ErrorCode` and optional `cause`.

**`process-runner.ts`** — `spawn()` wrapper returning `{ process, exitPromise }`. Handles stdout/stderr capture and kill. No shell — direct executable launch.

**`path-service.ts`** — Resolves `${extension}` to `context.extensionUri`. Resolves relative paths from project file directory. Normalizes slashes.

**`workspace-service.ts`** — Thin wrapper over `vscode.workspace.workspaceFolders`. Provides `getRootUris()` for multi-root support.

**`lifecycle.ts`** — `toDisposable(fn)` helper. `DisposableStore` for collecting multiple disposables.

### 2.3 Project Domain

**`v6-project.ts`** — Interfaces:
```ts
interface V6ProjectRun {
  executable: string;
  bootRom?: string;
  loadAddr?: string;
  fddReadOnly?: boolean;
  speed?: string;
  viewMode?: string;
}
interface V6Project {
  name: string;
  run: V6ProjectRun;
  uri: vscode.Uri;        // file location (resolved at load time)
}
```

**`v6.project.schema.json`** — JSON Schema for `*.project.json`. Enforces `name` (string, required), `run` (object, required), `run.executable` (string, required). Optional fields with defaults: `speed` ("100%"), `viewMode` ("borderless"), `loadAddr` ("0x100"), `fddReadOnly` (false).

**`project-parser.ts`** — `parse(text: string): unknown` — JSON parse with error wrapping. Pure function, no VS Code dependency.

**`project-validator.ts`** — Validates parsed JSON against the schema. Returns typed `V6Project` or array of `ValidationError`. Uses a lightweight schema check (no heavy ajv dependency — manual validation against known shape).

**`project-discovery.ts`** — `findProjects(roots: vscode.Uri[]): Promise<vscode.Uri[]>`. Globs `*.project.json` at each workspace root (depth 0). Uses `vscode.workspace.findFiles` with `RelativePattern`.

**`project-repository.ts`** — `load(uri)`: reads file, parses, validates, resolves paths. `save(project)`: serializes to JSON, writes file.

**`active-project-service.ts`** — Holds the active `V6Project`. If multiple projects found, shows `vscode.window.showQuickPick`. If one project, auto-selects. If none, returns `undefined`.

### 2.4 Language Domain

**Syntax highlighting** — Declared in `package.json` (`contributes.grammars`). Points to existing `res/syntaxes/devector_8080.tmLanguage.json`. No runtime code needed.

**`include-link-provider.ts`** — Implements `vscode.DocumentLinkProvider`. Regex scans for `.include "..."` directives. Resolves paths relative to the source file directory.

### 2.5 Emulator Launcher

**`v6emul-locator.ts`** — Resolves path in order: (1) `v6.emulatorPath` setting, (2) `res/v6emul/v6emul` bundled path, (3) `which`/`where` lookup on PATH. Validates the resolved file exists and is executable. Returns absolute path or throws `V6Error(EMULATOR_NOT_FOUND)`.

**`v6emul-launcher.ts`** — Builds CLI args from `LaunchRequest`:
```ts
interface LaunchRequest {
  emulatorPath: string;
  romPath?: string;
  loadAddr?: string;
  bootRomPath: string;     // default: bundled res/boot/boots.bin
  speed: number;           // IPC value 0–5
  tcpPort: number;
}
```
Calls `process-runner.ts` with the constructed argv. Returns `EmulatorProcess { process, port }`.

### 2.6 IPC Layer

**`ipc-commands.ts`** — Enum of command IDs used by the extension. Typed request/response interfaces per command.

**`ipc-codec.ts`** — `encode(cmd, data): Buffer` — length-prefixed MessagePack. `decode(buffer): { ok, data?, error? }` — reads length prefix, decodes MessagePack payload. `decodeFrameRaw(buffer): { width, height, pixels }` — special path for GET_FRAME_RAW binary response.

**`ipc-client.ts`** — TCP client. `connect(port)`, `disconnect()`, `send(cmd, data): Promise<Response>`. Request-response correlation: one outstanding request at a time (sequential, no multiplexing). Reconnect logic on connection drop. Timeout per request.

### 2.7 Emulator Lifecycle

**`emulator-lifecycle.ts`** — Coordinates launch → connect → run → stop → exit flow:
1. `start(project)`: locate binary → build `LaunchRequest` → launch process → TCP connect → PING health check → LOAD_ROM or MOUNT_FDD → RUN.
2. `stop()`: STOP → EXIT → wait for process exit → cleanup.
3. `restart()`: stop → start.
4. Exposes state: `running`, `connected`, `process`.
5. On emulator process unexpected exit → emit error event → panel shows error message.

### 2.8 Emulator Panel

**`emulator-panel.ts`** — Creates `vscode.WebviewPanel`. Manages panel lifecycle (open, close, dispose). Routes typed messages between webview and `EmulatorLifecycle`:
- Webview → extension: `{ type: 'run' }`, `{ type: 'pause' }`, `{ type: 'reset' }`, `{ type: 'setSpeed', value }`, `{ type: 'setViewMode', value }`, `{ type: 'key', scancode, action }`.
- Extension → webview: `PanelMessage` types from design §9.5.

**`emulator-viewmodel.ts`** — Tracks panel-side state: `running`, `speed`, `viewMode`. Produces `PanelMessage` objects from IPC responses. Applies display mode cropping to raw frame data before sending to webview.

**`panel.html` / `panel.js` / `panel.css`** — Webview assets:
- `<canvas>` element for frame rendering. Receives `ImageData` from cropped ABGR pixels (converted to RGBA).
- Header bar with Run/Pause button, Reset button, Speed dropdown, Display Mode dropdown.
- Keyboard event listeners → post `key` messages to extension host.
- Frame rendering loop driven by incoming `frame` messages.

### 2.9 Commands

**`create-project-command.ts`** — Implements the V6: Create Project flow (design §5.1.1):
1. `showInputBox` for project name (validate: non-empty, filesystem-safe).
2. `showQuickPick` for language: ASM / C.
3. `showQuickPick` for executable type: ROM / FDD.
4. Generate files from templates (project JSON, source file, Makefile).
5. Show info message. Open project file in editor.

**`run-project-command.ts`** — Implements the V6: Run Project flow:
1. Get active project from `ActiveProjectService`.
2. Validate executable file exists.
3. If emulator already running for this project → reload (LOAD_ROM or MOUNT_FDD) without restarting.
4. If no emulator running → launch via `EmulatorLifecycle.start()`.
5. Open or reveal the emulator panel.

### 2.10 FDD Persistence

When the emulator is stopped or the panel is closed:
- If `fddReadOnly` is `true` → skip, discard in-memory writes.
- If `fddReadOnly` is `false` → poll `GET_FDD_INFO` for each mounted drive. If `updated` is `true` → export image via `GET_FDD_IMAGE` → write to the file referenced by `run.executable` → `RESET_UPDATE_FDD`.

### 2.11 Testing

Reference: design §13.

**Framework** — Mocha + Chai. All tests run via `npm run test`. Three test tiers with separate directories under `test/`.

**Test configuration** — `.mocharc.yml` at workspace root:
```yaml
require: ts-node/register
spec: test/unit/**/*.test.ts
timeout: 5000
```
Additional npm scripts for each tier:
```json
"test":             "npm run test:unit && npm run test:integration",
"test:unit":        "mocha 'test/unit/**/*.test.ts'",
"test:integration": "node ./node_modules/@vscode/test-electron/out/runTest.js",
"test:regression":  "mocha 'test/regression/**/*.test.ts'"
```

**Unit tests** (`test/unit/`) — Pure logic, no VS Code API. Fast, run without Extension Development Host.

| Directory | What is tested |
|-----------|----------------|
| `test/unit/platform/` | `PathService` path resolution and `${extension}` expansion, `V6Error` construction, `DisposableStore` cleanup |
| `test/unit/project/` | `project-parser.ts` round-trip, `project-validator.ts` accept/reject cases (missing fields, invalid types, unknown keys), schema defaults application |
| `test/unit/language/` | `IncludeLinkProvider` regex matching, relative path resolution from source file directory |
| `test/unit/emulator/` | `ipc-codec.ts` encode/decode round-trip, `GET_FRAME_RAW` binary decode, CLI argument construction in `v6emul-launcher.ts`, `v6emul-locator.ts` resolution order, `emulator-viewmodel.ts` state transitions, display mode crop rect calculation, ABGR→RGBA byte reorder |

Test file naming convention: `<module>.test.ts` (e.g., `test/unit/project/project-parser.test.ts`).

**Mocks and helpers** (`test/helpers/`):
- `mock-process-runner.ts` — Stub `ProcessRunner` returning a controllable fake `ChildProcess`. Used by launcher and lifecycle tests.
- `mock-tcp-server.ts` — Minimal TCP server that speaks the length-prefixed MessagePack wire protocol. Accepts connections, responds to canned commands. Used by IPC integration tests.
- `mock-vscode.ts` — Lightweight stubs for `vscode.Uri`, `vscode.workspace`, `vscode.window` used in unit tests that need VS Code types but not the Extension Development Host.

**Integration tests** (`test/integration/`) — Run inside `@vscode/test-electron` Extension Development Host. Cover service boundaries:
- IPC handshake against `mock-tcp-server`.
- Project discovery across workspace folders (uses fixture workspace).
- Emulator launch with mocked process runner — verifies lifecycle state transitions.
- Command registration — verifies `v6.createProject` and `v6.runProject` are registered after activation.

Integration test entry point: `test/integration/index.ts` bootstraps Mocha inside the Extension Development Host, globs `test/integration/**/*.test.ts`.

**Regression tests** (`test/regression/`) — Capture edge cases that are likely to break:
- Multiple `*.project.json` files in workspace root.
- Missing `v6emul` binary at launch time.
- Missing executable artifact referenced in project file.
- Emulator TCP connection refused / timeout / unexpected disconnect.
- Panel close and reopen without restarting emulator.
- `fddReadOnly: true` skips FDD persistence entirely.

**Fixtures** (`test/fixtures/`):
- `test/fixtures/projects/` — Sample `*.project.json` covering: minimal valid, all-fields, missing required fields, invalid types, unknown keys.
- `test/fixtures/roms/` — Stub ROM and FDD binary files (minimal valid headers, small size).

**Definition of done** — Every implementation phase must end with:
1. Unit tests added or updated for changed modules.
2. Regression tests added or updated for new edge cases.
3. All tests passing (`npm run test`).
4. Documentation updated in `docs/`.
5. Root `README.md` updated if user-facing behavior changed.

---

## 3. Dependencies

| Package | Purpose |
|---------|---------|
| `@vscode/vscode` (devDependency) | Extension host types |
| `@msgpack/msgpack` | MessagePack encode/decode for IPC |
| `mocha` + `chai` (devDependency) | Test framework |
| `@vscode/test-electron` (devDependency) | Integration test runner |
| `eslint` + `@typescript-eslint/*` (devDependency) | Linting |

No other runtime dependencies. Keep the dependency tree minimal.

---

## 4. Implementation Phases

### Phase 1 — Project Skeleton and Platform ✅

**Goal:** Buildable, testable extension that activates and registers commands. No emulator yet.

- [x] **1.1 Initialize `package.json`** — `npm init`, add `vscode` engine, extension entry point, activation events, eslint config.
- [x] **1.2 Platform layer** — `logger.ts`, `error-codes.ts`, `v6-error.ts`, `path-service.ts`, `workspace-service.ts`, `lifecycle.ts`.
- [x] **1.3 `contribution-ids.ts`** — centralized command IDs, setting keys, view IDs.
- [x] **1.4 Extension composition root** — `extension.ts` with `activate` / `deactivate`. Construct logger, register stub commands.
- [x] **1.5 Build and launch config** — `.vscode/launch.json`, `.vscode/tasks.json`, verify extension loads in Extension Development Host.
- [x] **1.6 Unit tests for platform** — `PathService` path resolution, `V6Error` construction.
- [x] **1.7 Milestone exit** — regression test baseline (empty suite runs), all tests passing (`npm run test`).
- [x] **1.8 Update `docs/`with platform layer overview.

### Phase 2 — Project System ✅

**Goal:** Extension discovers, parses, validates, and selects `*.project.json` files.

- [x] **2.1 JSON Schema** — `v6.project.schema.json` with all fields, defaults, enums.
- [x] **2.2 Project model and parser** — `v6-project.ts` interfaces, `project-parser.ts`.
- [x] **2.3 Project validator** — `project-validator.ts`, validate against schema, return typed errors.
- [x] **2.4 Project discovery** — `project-discovery.ts`, glob `*.project.json` at workspace root.
- [x] **2.5 Project repository** — `project-repository.ts`, load/save cycle.
- [x] **2.6 Active project service** — `active-project-service.ts`, QuickPick if multiple, auto-select if one.
- [x] **2.7 Wire into extension.ts** — project discovery runs on activation, active project resolves on demand.
- [x] **2.8 Unit tests** — parser round-trip, validator accept/reject cases, discovery with fixture workspace.
- [x] **2.9 Milestone exit** — regression tests (invalid project files, missing required fields, multiple projects in workspace root), all tests passing.
- [x] **2.10 Update `docs/` with project system overview.

### Phase 3 — Language Support ✅

**Goal:** Syntax highlighting works. Include-path Ctrl+click navigation works.

- [x] **3.1 Grammar registration** — `package.json` contributes grammar for `v6asm` language. Map `.asm`, `.inc` extensions.
- [x] **3.2 Language configuration** — verify existing `language-configuration.json` covers comment toggles, brackets, auto-close.
- [x] **3.3 Include link provider** — `include-link-provider.ts`, register as `DocumentLinkProvider`. Regex: `.include\s+"([^"]+)"`.
- [x] **3.4 Unit tests** — include link regex matching, path resolution from source file dir.
- [x] **3.5 Milestone exit** — regression tests (malformed include paths, missing target files), all tests passing.
- [x] **3.6 Update `docs/` with language support notes, update `README.md` (syntax highlighting and navigation are user-facing).


### Phase 4 — Emulator Launcher and IPC ✅

**Goal:** Extension can launch `v6emul`, connect via TCP, and exchange commands.

- [x] **4.1 `process-runner.ts`** — async child process wrapper with kill and exit handling.
- [x] **4.2 `v6emul-locator.ts`** — three-tier binary discovery.
- [x] **4.3 `v6emul-launcher.ts`** — CLI argument construction, launch via `ProcessRunner`.
- [x] **4.4 `ipc-commands.ts`** — command enum, typed request/response interfaces.
- [x] **4.5 `ipc-codec.ts`** — MessagePack encode/decode, GET_FRAME_RAW binary decode.
- [x] **4.6 `ipc-client.ts`** — TCP connect, send/receive, timeout, reconnect on drop.
- [x] **4.7 `emulator-lifecycle.ts`** — launch → connect → ping → load → run / stop → exit flow.
- [x] **4.8 Unit tests** — codec encode/decode round-trip, CLI argument construction, locator resolution order.
- [x] **4.9 Integration test** — IPC handshake against mock TCP server.
- [x] **4.10 Milestone exit** — regression tests (missing v6emul binary, connection refused, IPC timeout, unexpected disconnect), all tests passing.
- [x] **4.11 Update `docs/` with IPC protocol and launcher details.

### Phase 5 — Emulator Panel ✅

**Goal:** Webview panel renders frames, controls emulation, forwards keyboard input.

- [x] **5.1 Webview assets** — `panel.html`, `panel.css`, `panel.js`. Canvas element, header bar with controls.
- [x] **5.2 `emulator-panel.ts`** — WebviewPanel creation, message bridge, CSP nonce.
- [x] **5.3 `emulator-viewmodel.ts`** — state tracking, frame cropping per display mode, PanelMessage production.
- [x] **5.4 Frame rendering** — ABGR → RGBA conversion, crop to display mode rect, post to canvas.
- [x] **5.5 Header controls** — Run/Pause, Reset, Speed dropdown, Display Mode dropdown. Wire to IPC commands.
- [x] **5.6 Keyboard forwarding** — webview key listeners → `KEY_HANDLING` IPC. Scancode mapping.
- [x] **5.7 Unit tests** — viewmodel state transitions, display mode crop rect calculation, ABGR→RGBA conversion.
- [x] **5.8 Milestone exit** — regression tests (panel close/reopen without restart, display mode switch mid-run), all tests passing.
- [x] **5.9 Update `docs/` with panel architecture.

### Phase 6 — Commands and Create Project ✅

**Goal:** V6: Create Project scaffolds files. V6: Run Project launches the full flow.

- [x] **6.1 `run-project-command.ts`** — resolve active project → validate executable → launch or reload emulator → open panel.
- [x] **6.2 `create-project-command.ts`** — prompts → generate project JSON, source, Makefile from templates.
- [x] **6.3 Templates** — project JSON template, 4 Makefile variants, starter ASM source, starter C source.
- [x] **6.4 FDD persistence** — on stop/close, check `fddReadOnly`, poll/export/save workflow.
- [x] **6.5 Unit tests** — command argument validation, template file generation, FDD persistence with `fddReadOnly` true/false.
- [x] **6.6 Regression tests** — missing emulator, missing executable, multiple projects, panel close/reopen, `fddReadOnly` skip.
- [x] **6.7 Milestone exit** — all tests passing.
- [x] **6.8 Update `docs/` with command usage, update `README.md` (Create Project and Run Project are user-facing).

### Phase 7 — Polish and Packaging

**Goal:** Extension is ready for `.vsix` packaging and end-to-end use.

- [ ] **7.1 `.vscodeignore`** — exclude `test/`, `design/`, `temp/`, `docs/`, source maps in release builds.
- [ ] **7.2 Extension settings** — `v6.emulatorPath`, `v6.logLevel` wired and validated.
- [ ] **7.3 Error UX** — all `V6Error` codes surface as user-friendly notifications with suggested actions.
- [ ] **7.4 README** — user-facing documentation: install, create project, build, run.
- [ ] **7.5 CI script** — `npm run test` runs unit + integration + regression. `npm run package` produces `.vsix`.
- [ ] **7.6 End-to-end verification** — install `.vsix`, create ASM/ROM project, build with `make`, run in panel, verify frame rendering and keyboard input.
- [ ] **7.7 Milestone exit** — unit and regression tests updated for settings and error UX, all tests passing.
- [ ] **7.8 `docs/` finalized, `README.md` finalized.
