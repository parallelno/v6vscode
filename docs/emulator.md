# Emulator

Launches the `v6emul` backend, communicates over TCP using length-prefixed MessagePack, and renders output in a VS Code webview panel.

## Launcher (`src/emulator/launcher/`)

- **`v6emul-locator.ts`** — Three-tier binary resolution: (1) `v6.emulatorPath` setting, (2) bundled `res/v6emul/v6emul`, (3) PATH lookup. Throws `V6Error(EMULATOR_NOT_FOUND)` if all fail.
- **`v6emul-launcher.ts`** — Builds CLI arguments from a `LaunchRequest` and spawns the process via `ProcessRunner`. Always passes `--serve` and `--tcp-port`. Supports `--boot-rom`, `--rom`, `--load-addr`, `--fdd`, `--fdd-drive`, `--fdd-autoboot`, `--speed`.

## Protocol (`src/emulator/protocol/`)

- **`ipc-commands.ts`** — `IpcCommand` enum mapping all v6emul command IDs (PING, RUN, STOP, EXIT, LOAD_ROM, MOUNT_FDD, KEY_HANDLING, GET_MEM, etc.). Typed request/response interfaces. `SPEED_VALUES` mapping from user strings to IPC integers.
- **`memory-models.ts`** — Typed request and response models for bulk reads from the emulator's linear global memory address space.
- **`ipc-codec.ts`** — `encodeRequest(cmd, data)` produces length-prefixed MessagePack buffers. `decodeResponse(buffer)` parses responses. `decodeFrameRaw(buffer)` handles the binary GET_FRAME_RAW format (width, height, ABGR pixels). `frameLength(buffer)` checks if a complete frame is available.

## Client (`src/emulator/client/`)

- **`ipc-client.ts`** — TCP client with `connect(port)`, `disconnect()`, `send(cmd, data)`, `sendRaw(cmd, data)`. Sequential request-response with a stable priority queue. Debug control and stop polling can overtake queued frame requests; the active request is never interrupted.

## Lifecycle (`src/emulator/lifecycle/`)

- **`emulator-lifecycle.ts`** — Shared owner for Run Project and debug-launch processes, the single emulator socket, and execution state. Debug launch chooses a free port and lends the same `IpcClient` to the DAP adapter and display panel. Closing the display does not terminate a debug-owned session. States: `stopped`, `launching`, `connected`, `running`; ownership is `run` or `debug`.

## Panel (`src/emulator/panel/`)

Webview-based display and control surface for the running emulator.

- **`emulator-viewmodel.ts`** — Tracks panel state: `running`, `speed`, `viewMode`. Defines three display modes (`full` 768×312, `border` 544×288, `borderless` 512×256) with crop rectangles. Provides `abgrToRgba()` pixel conversion, `cropFrame()` extraction, and `processFrame()` pipeline that crops then converts a raw frame into a `PanelMessage`. Typed message types: `PanelMessage` (extension → webview) and `WebviewMessage` (webview → extension).
- **`emulator-panel.ts`** — Creates and manages a `vscode.WebviewPanel`. Generates HTML with CSP nonce, routes `WebviewMessage` from the webview to `EmulatorLifecycle`/`IpcClient`, drives a frame polling loop (~50 fps) that calls `GET_FRAME_RAW`, crops/converts via the viewmodel, and posts `PanelMessage` to the webview.
- **`assets/panel.html`** — Webview shell: header bar (Run/Pause, Reset, Speed dropdown, Display dropdown), canvas viewport, error bar.
- **`assets/panel.css`** — VS Code themed styles using CSS variables. Pixelated canvas rendering.
- **`assets/panel.js`** — IIFE webview script. Renders frames to canvas via `putImageData`, forwards keyboard events (keyCode + action) to the extension host, handles control interactions.

During a debug launch the panel uses the lifecycle's existing connection. It does not open a second TCP client. Frame requests are low priority so continue, pause, stepping, breakpoint updates, and stop polling remain responsive.

## Hardware Statistics

`V6 Hardware Statistics` is contributed to the Run and Debug sidebar. It refreshes registers, flags, execution counters, and display state whenever the shared session pauses. While running it keeps the last snapshot and reports that values refresh on pause. The view title provides a manual refresh command. Pausing no longer opens a CPU-statistics editor tab.

## Hex Viewer

`V6 Hex Viewer` is contributed to the Run and Debug sidebar and uses the lifecycle's shared IPC connection. It provides Main RAM and negotiated RAM-disk banks as separate 64 KiB spaces. The client allocates a complete 33-space cache but reads only the selected bank interval currently visible in the virtualized grid. While running and visible, coherent backends refresh that interval once per second; non-coherent backends retain and label the last paused values.

The view requires `GET_MEM` command `93` in `GET_SERVER_INFO`. Main RAM starts at global address `0x00000`; RAM Disk 1 / Bank 0 starts at `0x10000`, and each subsequent bank occupies the next 64 KiB interval. Without command 93 the view shows an unsupported-backend state and sends no legacy per-byte requests.

When the server also advertises `SET_BYTE_GLOBAL` command `43`, double-click byte editing evaluates the submitted expression in the extension host and writes `{ addr, data }` to the same linear global address space. The client cache changes only after a successful response.

## Watchpoints

`V6 Watchpoints` is contributed to the Run and Debug sidebar and shares the lifecycle's IPC connection. It requires watchpoint schema 1, server-allocated IDs, and `DEBUG_WATCHPOINT_EDIT` command 94. Add, edit, activity toggles, delete, Disable All, and Delete All are serialized and reconciled with `DEBUG_WATCHPOINT_GET_ALL` before the UI accepts backend state.

Rows use global numeric addresses covering Main RAM and all RAM-disk banks. Hover or keyboard focus reads at most 16 bytes when `GET_MEM` is available. Find in Hex Viewer converts the global range into a typed memory space, selects that bank, and highlights the inclusive range. Ranges crossing a 64 KiB viewer bank are rejected.

## FPS Counter

While the emulator is running, a live **FPS counter** appears in the VS Code **status bar** (bottom-right). It shows the actual number of frames rendered per second (e.g., `⟡ 45 fps`). The counter hides automatically when the emulator is paused or stopped.
