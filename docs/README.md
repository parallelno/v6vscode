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

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Override path to v6emul binary |
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |

## Commands

| Command | Title | Status |
|---------|-------|--------|
| `v6.createProject` | V6: Create Project | Stub |
| `v6.runProject` | V6: Run Project | Resolves active project |

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
