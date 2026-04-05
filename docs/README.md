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

Composition root. Creates platform services, registers stub commands, pushes all disposables onto `context.subscriptions`.

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Override path to v6emul binary |
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |

## Commands

| Command | Title | Status |
|---------|-------|--------|
| `v6.createProject` | V6: Create Project | Stub (Phase 1) |
| `v6.runProject` | V6: Run Project | Stub (Phase 1) |

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
