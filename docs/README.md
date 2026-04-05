# v6vscode Documentation

## Architecture Overview

The extension is organized into layers:

### Platform Layer (`src/platform/`)

Infrastructure services with no domain logic:

- **`logging/logger.ts`** — Output channel wrapper with configurable log levels (error, warn, info, debug). Reads `v6.logLevel` setting.
- **`errors/error-codes.ts`** — Typed `ErrorCode` enum: `CONFIG_INVALID`, `EMULATOR_NOT_FOUND`, `EXECUTABLE_NOT_FOUND`, `EMULATOR_LAUNCH_FAILED`, `IPC_CONNECTION_REFUSED`, `IPC_TIMEOUT`, `IPC_DECODE_ERROR`.
- **`errors/v6-error.ts`** — `V6Error extends Error` with `code` and optional `cause`.
- **`files/path-service.ts`** — Path resolution: `${extension}` token expansion, relative-to-absolute resolution, extension-rooted paths.
- **`files/workspace-service.ts`** — Thin accessor for `vscode.workspace.workspaceFolders`.
- **`process/process-runner.ts`** — Async `spawn()` wrapper returning `{ process, exitPromise }`.
- **`disposable/lifecycle.ts`** — `toDisposable(fn)` helper and `DisposableStore` for managing multiple disposables.

### Config (`src/config/`)

- **`contribution-ids.ts`** — Centralized command IDs (`v6.createProject`, `v6.runProject`), setting keys, and output channel name.

### Extension Entry Point (`src/extension.ts`)

Composition root. Creates platform and project services, registers commands, pushes all disposables onto `context.subscriptions`. On activation, project discovery and active project resolution are available on demand.

### Project System (`src/project/`)

Discovers, parses, validates, and manages `*.project.json` files:

- **`model/v6-project.ts`** — `V6Project` and `V6ProjectRun` interfaces. `V6Project` carries the parsed config plus the source file `Uri`.
- **`parsing/project-parser.ts`** — `parse(text): unknown`. Pure JSON parse with `V6Error` wrapping on failure.
- **`validation/project-validator.ts`** — `validate(data): ValidationResult`. Manual schema check against the known shape. Returns typed `{ ok, name, run }` with defaults applied, or `{ ok: false, errors }`. Rejects unknown keys.
- **`discovery/project-discovery.ts`** — `findProjects(roots): Promise<Uri[]>`. Globs `*.project.json` at each workspace root (depth 0) via `vscode.workspace.findFiles`.
- **`persistence/project-repository.ts`** — `load(uri): Promise<V6Project>` reads, parses, validates, resolves relative paths to absolute. `save(project)` serializes back to JSON.
- **`active/active-project-service.ts`** — `resolve(): Promise<V6Project | undefined>`. Auto-selects if one project, shows QuickPick if multiple, returns `undefined` if none.

#### Project file schema

Files named `*.project.json` at the workspace root. Validated by `config/schemas/v6.project.schema.json`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Project display name |
| `run.executable` | string | yes | — | Path to ROM or FDD image |
| `run.bootRom` | string | no | bundled | Boot ROM path |
| `run.loadAddr` | string | no | `"0x100"` | Load address (hex) |
| `run.fddReadOnly` | boolean | no | `false` | Discard FDD writes on stop |
| `run.speed` | string | no | `"100%"` | Emulation speed |
| `run.viewMode` | string | no | `"borderless"` | Display mode: borderless, bordered, full |

### Language Support (`src/language/`)

- **Syntax highlighting** — Declared in `package.json` via `contributes.languages` and `contributes.grammars`. Language ID `v6asm`, file extensions `.asm` and `.inc`, grammar `source.retroasm_8080` from `res/syntaxes/devector_8080.tmLanguage.json`.
- **Language configuration** — `language-configuration.json` provides line comments (`;`), block comments (`/* */`), bracket pairs, auto-closing pairs, and surrounding pairs.
- **`includes/include-link-provider.ts`** — `DocumentLinkProvider` for Ctrl+click navigation on `.include "..."` directives. Regex: `.include\s+"([^"]+)"`. Resolves paths relative to the source file's directory.

### Emulator Launcher & IPC (`src/emulator/`)

Launches the `v6emul` backend, communicates over TCP using length-prefixed MessagePack.

#### Launcher (`launcher/`)

- **`v6emul-locator.ts`** — Three-tier binary resolution: (1) `v6.emulatorPath` setting, (2) bundled `res/v6emul/v6emul`, (3) PATH lookup. Throws `V6Error(EMULATOR_NOT_FOUND)` if all fail.
- **`v6emul-launcher.ts`** — Builds CLI arguments from a `LaunchRequest` and spawns the process via `ProcessRunner`. Always passes `--serve` and `--tcp-port`. Supports `--boot-rom`, `--rom`, `--load-addr`, `--fdd`, `--fdd-drive`, `--fdd-autoboot`, `--speed`.

#### Protocol (`protocol/`)

- **`ipc-commands.ts`** — `IpcCommand` enum mapping all v6emul command IDs (PING, RUN, STOP, EXIT, LOAD_ROM, MOUNT_FDD, KEY_HANDLING, etc.). Typed request/response interfaces. `SPEED_VALUES` mapping from user strings to IPC integers.
- **`ipc-codec.ts`** — `encodeRequest(cmd, data)` produces length-prefixed MessagePack buffers. `decodeResponse(buffer)` parses responses. `decodeFrameRaw(buffer)` handles the binary GET_FRAME_RAW format (width, height, ABGR pixels). `frameLength(buffer)` checks if a complete frame is available.

#### Client (`client/`)

- **`ipc-client.ts`** — TCP client with `connect(port)`, `disconnect()`, `send(cmd, data)`, `sendRaw(cmd, data)`. Sequential request-response (one outstanding request). Connection timeout, request timeout, and automatic error propagation on socket close/error.

#### Lifecycle (`lifecycle/`)

- **`emulator-lifecycle.ts`** — Orchestrates the full launch → connect → health-check → load → run / stop → exit flow. States: `stopped`, `launching`, `connected`, `running`. Retry logic for TCP connection (emulator startup delay). Emits `stateChange`, `exit`, and `error` events.

### Emulator Panel (`src/emulator/panel/`)

Webview-based display and control surface for the running emulator.

- **`emulator-viewmodel.ts`** — Tracks panel state: `running`, `speed`, `viewMode`. Defines three display modes (`full` 768×312, `border` 544×288, `borderless` 512×256) with crop rectangles. Provides `abgrToRgba()` pixel conversion, `cropFrame()` extraction, and `processFrame()` pipeline that crops then converts a raw frame into a `PanelMessage`. Typed message types: `PanelMessage` (extension → webview) and `WebviewMessage` (webview → extension).
- **`emulator-panel.ts`** — Creates and manages a `vscode.WebviewPanel`. Generates HTML with CSP nonce, routes `WebviewMessage` from the webview to `EmulatorLifecycle`/`IpcClient`, drives a frame polling loop (~50 fps) that calls `GET_FRAME_RAW`, crops/converts via the viewmodel, and posts `PanelMessage` to the webview.
- **`assets/panel.html`** — Webview shell: header bar (Run/Pause, Reset, Speed dropdown, Display dropdown), canvas viewport, error bar.
- **`assets/panel.css`** — VS Code themed styles using CSS variables. Pixelated canvas rendering.
- **`assets/panel.js`** — IIFE webview script. Renders frames to canvas via `putImageData`, forwards keyboard events (keyCode + action) to the extension host, handles control interactions.

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Override path to v6emul binary |
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `v6.createProject` | V6: Create Project | Scaffolds a new project with source file, Makefile, and project JSON |
| `v6.runProject` | V6: Run Project | Validates executable, launches or hot-reloads emulator, opens panel |

### V6: Create Project

Three-step interactive flow:

1. **Project name** — `showInputBox` with validation (non-empty, filesystem-safe, max 100 chars).
2. **Language** — `showQuickPick`: ASM (Intel 8080 assembly) or C (via v6c compiler).
3. **Executable type** — `showQuickPick`: ROM (direct binary) or FDD (floppy disk image).

Generated files in workspace root:

| File | Purpose |
|------|---------|
| `<name>.project.json` | Project configuration |
| `Makefile` | Build recipe (one of 4 variants: asm-rom, asm-fdd, c-rom, c-fdd) |
| `main.asm` or `main.c` | Starter source file |
| `out/` | Output directory for build artifacts |

Templates live in `src/templates/` and use `{{key}}` placeholder expansion.

### V6: Run Project

1. Resolves the active project via `ActiveProjectService` (auto-selects if one, QuickPick if multiple).
2. Validates the executable file exists on disk. Throws `V6Error(EXECUTABLE_NOT_FOUND)` if missing.
3. If the emulator is already running — hot-reloads the executable via `LOAD_ROM` or `MOUNT_FDD` IPC commands without restarting the emulator process.
4. If no emulator is running — launches via `EmulatorLifecycle.start()`.
5. Reveals or creates the emulator webview panel.

### FDD Persistence

When the emulator stops (or the panel closes), if the loaded executable is a `.fdd` file:

- If `fddReadOnly` is `true` → skip entirely, discard in-memory writes.
- If `fddReadOnly` is `false` → `GET_FDD_INFO` checks if the drive is mounted and updated → `GET_FDD_IMAGE` exports the disk image → write to disk → `RESET_UPDATE_FDD`.

This is wired into `EmulatorLifecycle.stop()` via an `onBeforeStop` hook in `extension.ts`.

## Building

```bash
npm install
npm run compile
```

## Testing

```bash
npm test              # unit tests
npm run test:unit     # unit tests only
npm run test:regression  # regression suite
```
