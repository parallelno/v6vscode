# Emulator

Launches the `v6emul` backend, communicates over TCP using length-prefixed MessagePack, and renders output in a VS Code webview panel.

## Launcher (`src/emulator/launcher/`)

- **`v6emul-locator.ts`** — Three-tier binary resolution: (1) `v6.emulatorPath` setting, (2) bundled `res/v6emul/v6emul`, (3) PATH lookup. Throws `V6Error(EMULATOR_NOT_FOUND)` if all fail.
- **`v6emul-launcher.ts`** — Builds CLI arguments from a `LaunchRequest` and spawns the process via `ProcessRunner`. Always passes `--serve` and `--tcp-port`. Supports `--boot-rom`, `--rom`, `--load-addr`, `--fdd`, `--fdd-drive`, `--fdd-autoboot`, `--speed`.

## Protocol (`src/emulator/protocol/`)

- **`ipc-commands.ts`** — `IpcCommand` enum mapping all v6emul command IDs (PING, RUN, STOP, EXIT, LOAD_ROM, MOUNT_FDD, KEY_HANDLING, etc.). Typed request/response interfaces. `SPEED_VALUES` mapping from user strings to IPC integers.
- **`ipc-codec.ts`** — `encodeRequest(cmd, data)` produces length-prefixed MessagePack buffers. `decodeResponse(buffer)` parses responses. `decodeFrameRaw(buffer)` handles the binary GET_FRAME_RAW format (width, height, ABGR pixels). `frameLength(buffer)` checks if a complete frame is available.

## Client (`src/emulator/client/`)

- **`ipc-client.ts`** — TCP client with `connect(port)`, `disconnect()`, `send(cmd, data)`, `sendRaw(cmd, data)`. Sequential request-response (one outstanding request). Connection timeout, request timeout, and automatic error propagation on socket close/error.

## Lifecycle (`src/emulator/lifecycle/`)

- **`emulator-lifecycle.ts`** — Orchestrates the full launch → connect → health-check → load → run / stop → exit flow. States: `stopped`, `launching`, `connected`, `running`. Retry logic for TCP connection (emulator startup delay). Emits `stateChange`, `exit`, and `error` events.

## Panel (`src/emulator/panel/`)

Webview-based display and control surface for the running emulator.

- **`emulator-viewmodel.ts`** — Tracks panel state: `running`, `speed`, `viewMode`. Defines three display modes (`full` 768×312, `border` 544×288, `borderless` 512×256) with crop rectangles. Provides `abgrToRgba()` pixel conversion, `cropFrame()` extraction, and `processFrame()` pipeline that crops then converts a raw frame into a `PanelMessage`. Typed message types: `PanelMessage` (extension → webview) and `WebviewMessage` (webview → extension).
- **`emulator-panel.ts`** — Creates and manages a `vscode.WebviewPanel`. Generates HTML with CSP nonce, routes `WebviewMessage` from the webview to `EmulatorLifecycle`/`IpcClient`, drives a frame polling loop (~50 fps) that calls `GET_FRAME_RAW`, crops/converts via the viewmodel, and posts `PanelMessage` to the webview.
- **`assets/panel.html`** — Webview shell: header bar (Run/Pause, Reset, Speed dropdown, Display dropdown), canvas viewport, error bar.
- **`assets/panel.css`** — VS Code themed styles using CSS variables. Pixelated canvas rendering.
- **`assets/panel.js`** — IIFE webview script. Renders frames to canvas via `putImageData`, forwards keyboard events (keyCode + action) to the extension host, handles control interactions.

## FPS Counter

While the emulator is running, a live **FPS counter** appears in the VS Code **status bar** (bottom-right). It shows the actual number of frames rendered per second (e.g., `⟡ 45 fps`). The counter hides automatically when the emulator is paused or stopped.
