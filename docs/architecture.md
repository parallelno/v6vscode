# Architecture Overview

The extension is organized into layers: platform infrastructure, configuration, and the composition root.

## Platform Layer (`src/platform/`)

Infrastructure services with no domain logic:

- **`logging/logger.ts`** — Output channel wrapper with configurable log levels (error, warn, info, debug). Reads `v6.logLevel` setting.
- **`errors/error-codes.ts`** — Typed `ErrorCode` enum: `CONFIG_INVALID`, `EMULATOR_NOT_FOUND`, `EXECUTABLE_NOT_FOUND`, `EMULATOR_LAUNCH_FAILED`, `IPC_CONNECTION_REFUSED`, `IPC_TIMEOUT`, `IPC_DECODE_ERROR`.
- **`errors/v6-error.ts`** — `V6Error extends Error` with `code` and optional `cause`.
- **`files/path-service.ts`** — Path resolution: `${extension}` token expansion, relative-to-absolute resolution, extension-rooted paths.
- **`files/workspace-service.ts`** — Thin accessor for `vscode.workspace.workspaceFolders`.
- **`process/process-runner.ts`** — Async `spawn()` wrapper returning `{ process, exitPromise }`.
- **`disposable/lifecycle.ts`** — `toDisposable(fn)` helper and `DisposableStore` for managing multiple disposables.

## Config (`src/config/`)

- **`contribution-ids.ts`** — Centralized command IDs (`v6.createProject`, `v6.runProject`), setting keys, and output channel name.

## Extension Entry Point (`src/extension.ts`)

Composition root. Creates platform and project services, registers commands, pushes all disposables onto `context.subscriptions`. On activation, project discovery and active project resolution are available on demand.

## Debug Session Boundary

`EmulatorLifecycle` is the shared process/socket owner for ordinary runs and debug launches. `V6DebugAdapter` borrows the lifecycle's `IpcClient`; `EmulatorPanel` renders frames through that same client. `IpcClient` serializes requests and orders queued work by priority, with debugger control above telemetry and display frames.

```mermaid
flowchart LR
	DAP[V6 Debug Adapter] --> Lifecycle[Emulator Lifecycle]
	Panel[Emulator Panel] --> Lifecycle
	Stats[Hardware Statistics] --> Lifecycle
	Hex[Hex Viewer] --> Lifecycle
	Hex --> Memory[Memory Service]
	Memory --> Client
	Lifecycle --> Client[Prioritized IpcClient]
	Client --> Emulator[v6emul single-client server]
```

Source debugging loads a final companion ELF through `debug-artifact-loader.ts`. The immutable debug index maps source lines to CPU addresses and CPU addresses back to source locations. ROM/ELF byte mismatches fail metadata loading before source breakpoints can be verified.

The Hex Viewer is a Run and Debug `WebviewView`. `MemoryService` validates negotiated bank-aware read capabilities, owns a complete validity-tracked cache for Main RAM and 32 RAM-disk banks, and requests only the selected bank's visible interval. `DebugSymbolService` exposes validated metadata for symbol search and exact source navigation without coupling the view to the DAP adapter. `HexViewerProvider` owns session orchestration, persistence, clipboard access, and webview message validation; browser assets own virtualization and keyboard interaction.
