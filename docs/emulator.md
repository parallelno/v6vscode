# Emulator

Launches the `v6emul` backend, communicates over TCP using length-prefixed MessagePack, and renders output in a VS Code webview panel.

## Launcher (`src/emulator/launcher/`)

- **`v6emul-locator.ts`** — Resolves the emulator exclusively from `V6EMUL` and validates that it names an existing file. Throws `V6Error(EMULATOR_NOT_FOUND)` otherwise.
- **`v6emul-launcher.ts`** — Builds CLI arguments from a `LaunchRequest` and spawns the process via `ProcessRunner`. Always passes `--serve` and `--tcp-port`. Supports `--boot-rom`, `--rom`, `--load-addr`, `--fdd`, `--fdd-drive`, `--fdd-autoboot`, `--speed`. Server stdout, including Lua `print()` output, and tagged stderr are routed by line to the **v6emul** channel in VS Code's Output panel. Extension-client diagnostics use the separate **v6vscode** channel.

## Protocol (`src/emulator/protocol/`)

- **`ipc-commands.ts`** — `IpcCommand` enum mapping all v6emul command IDs (PING, RUN, STOP, EXIT, LOAD_ROM, MOUNT_FDD, KEY_HANDLING, GET_MEM, etc.). Typed request/response interfaces. `SPEED_VALUES` mapping from user strings to IPC integers.
- **`memory-models.ts`** — Typed request and response models for bulk reads from the emulator's linear global memory address space.
- **`ipc-codec.ts`** — `encodeRequest(cmd, data)` produces length-prefixed MessagePack buffers. `decodeResponse(buffer)` parses responses. `decodeFrameRaw(buffer)` handles the binary GET_FRAME_RAW format (width, height, ABGR pixels). `frameLength(buffer)` checks if a complete frame is available.

## Client (`src/emulator/client/`)

- **`ipc-client.ts`** — TCP client with `connect(port)`, `disconnect()`, `send(cmd, data)`, `sendRaw(cmd, data)`. Sequential request-response with a stable priority queue. Debug control and stop polling can overtake queued frame requests; the active request is never interrupted.

## Lifecycle (`src/emulator/lifecycle/`)

- **`emulator-lifecycle.ts`** — Shared owner for Run Project and debug-launch processes, the single emulator socket, and execution state. Debug launch chooses a free port and lends the same `IpcClient` to the DAP adapter and display panel. Closing the display does not terminate a debug-owned session. States: `stopped`, `launching`, `connected`, `running`; ownership is `run` or `debug`.

## Panel (`src/emulator/panel/`)

Webview-based display surface for the running emulator. Execution control remains in VS Code's standard debug toolbar.

- **`emulator-viewmodel.ts`** — Tracks panel state: `running`, `speed`, `viewMode`. Defines three display modes (`full` 768×312, `border` 544×288, `borderless` 512×256) with crop rectangles. Provides `abgrToRgba()` pixel conversion, `cropFrame()` extraction, and `processFrame()` pipeline that crops then converts a raw frame into a `PanelMessage`. Typed message types: `PanelMessage` (extension → webview) and `WebviewMessage` (webview → extension).
- **`emulator-panel.ts`** — Creates and manages a `vscode.WebviewPanel`. Generates HTML with CSP nonce, routes `WebviewMessage` from the webview to `EmulatorLifecycle`/`IpcClient`, drives a frame polling loop (~50 fps) that calls `GET_FRAME_RAW`, crops/converts via the viewmodel, and posts `PanelMessage` to the webview.
- **`emulator-settings-controller.ts`** — Shared authority for Speed and Display mode validation, emulator IPC updates, and active-project persistence.
- **`emulator-settings-panel.ts`** — Dedicated Settings editor panel for Speed and Display mode.
- **`assets/panel.html`** — Display webview shell: canvas viewport and error bar.
- **`assets/panel.css`** — VS Code themed styles using CSS variables. Pixelated canvas rendering.
- **`assets/panel.js`** — IIFE webview script. Renders frames to canvas via `putImageData`, forwards keyboard events (keyCode + action) to the extension host, handles control interactions.

During a debug launch the panel uses the lifecycle's existing connection. It does not open a second TCP client. Frame requests are low priority so continue, pause, stepping, breakpoint updates, and stop polling remain responsive.

Using the debug toolbar's **Stop** control, including its **Alt+Disconnect** variant, clears all connection-backed panel state immediately, including retained hidden webviews. Display clears its last frame; Symbols, Hex Viewer, Memory Edits, Performance, Trace Log, Scripts, Ports, Watchpoints, and Hardware Statistics clear their tables, caches, selections, and pending UI. Memory-edit, CodePerf, and script records remain owned by the emulator process and are fetched again after reconnect. Settings retains active-project defaults because they are project configuration rather than emulator-session state.

## Hardware Statistics

`V6 Hardware Statistics` is a webview contributed to the Run and Debug sidebar. From one coherent paused-state snapshot it displays timing, raster/display state, the 16-color hardware palette, RAM-disk mapping, and all four FDD drives. Last Run is normalized from consecutive total-cycle snapshots so debugger instruction steps are included. Palette swatches support Copy, inline Edit, and Paste through host-side byte validation. Drive menus support mount, replace, and dismount, including Save/Discard/Cancel handling for dirty images.

The panel requires hardware-statistics schema 1, commands `96..98`, and the corresponding palette/FDD capabilities. It refreshes on pause and by the view-title Refresh command. While running it retains the last snapshot and reports that values refresh on pause.

## Ports

`Ports` is a standalone editor panel opened from the `v6emul` view container or Command Palette. While visible and paused, `PortsService` fetches both `GET_IO_PORTS_IN_DATA` and `GET_IO_PORTS_OUT_DATA`. Each response contains `{ bytes }` as a 256-byte MessagePack binary payload and is validated before display as a 16 by 16 table.

After the first accepted snapshot, each update compares all bytes with the immediately previous accepted snapshot. Changed cells receive a distinct highlight and an accessible `(changed)` label. Hidden or running panels send no requests; stale responses from an ended session are discarded.

## Hex Viewer

`Hex Viewer` is a standalone editor panel opened from the `v6emul` view container or Command Palette and uses the lifecycle's shared IPC connection. It provides Main RAM and negotiated RAM-disk banks as separate 64 KiB spaces. The client allocates a complete 33-space cache but reads only the selected bank interval currently visible in the virtualized grid. While running and visible, coherent backends refresh that interval once per second; non-coherent backends retain and label the last paused values.

The view requires `GET_MEM` command `93` in `GET_SERVER_INFO`. Main RAM starts at global address `0x00000`; RAM Disk 1 / Bank 0 starts at `0x10000`, and each subsequent bank occupies the next 64 KiB interval. Without command 93 the view shows an unsupported-backend state and sends no legacy per-byte requests.

When the server advertises memory-edit schema 1, double-click byte editing evaluates the submitted expression in the extension host and submits a complete `DEBUG_MEMORY_EDIT_ADD` record at the same linear global address. The shared service refreshes `DEBUG_MEMORY_EDIT_GET_ALL`, and the client cache changes only to the acknowledged current value.

## Memory Edits

`Memory Edits` is a standalone editor panel opened from the `v6emul` view container or Command Palette. It lists the emulator's complete tracked byte-edit collection in global-address order with Original, Entered, Current, Activity, and Auto-update columns. The Add button opens stable empty Address and Entered fields; Enter submits the new record. Search filters Current using decimal or `$NN`, `0xNN`, and `NNh` byte forms. Values, Activity, and Auto-update can be changed inline. Entry menus provide Disable, clipboard, typed Hex Viewer navigation, and delete/restore actions. Right-clicking blank list space opens Add, Disable, Disable All, Delete, Delete All, and Delete and Restore All actions.

Auto-update maps to an active readonly server record and protects the entered value from emulated CPU writes. **Restore Original** is available while paused or running: it invokes `DEBUG_MEMORY_EDIT_RESTORE`, then recreates the row as inactive. **Delete Entry** removes tracking without changing memory; **Delete and Restore** invokes the same restore request without recreating the row. While running, Current may change again after restoration because the retained row is inactive. Records and their server-captured originals survive reset, restart, ROM loading, and TCP reconnect, and are cleared when the emulator process exits.

## Performance

`Performance` is a standalone editor panel for server-owned CodePerf ranges and sampled timing statistics. It searches by name, edits 16-bit start/end addresses, toggles collection activity, and displays `average cc: N, tests: M`. Visible panels refresh the complete ID-ordered collection once per second. Mutations are serialized and reconciled with the authoritative collection before the UI accepts them; source navigation resolves the acknowledged start address through loaded ELF/DWARF metadata.

The panel requires CodePerf schema 1 with `codePerfServerAllocatedIds`, `codePerfEdit`, and `codePerfMutationsWhileRunning` set to true. The server must advertise limits for the 65536-address space, UTF-8 name bytes, live records, and test count, plus commands `79..83`, `101` (`DEBUG_CODE_PERF_GET_ALL`), and `102` (`DEBUG_CODE_PERF_EDIT`). Records, IDs, and completed statistics survive reset, restart, ROM loading, and reconnect while the same debugger instance remains alive; destroying it starts a new collection lifetime.

## Trace Log

`Trace Log` is a standalone paused-only editor panel backed by server-side immutable filters. A valid address/instruction glob creates one opaque filter ID; scrolling requests aligned windows through commands `103` (`DEBUG_TRACE_LOG_FILTER`) and `104` (`DEBUG_TRACE_LOG_WINDOW`). Both the extension host and webview retain at most three 512-row windows, while fixed-height virtualization gives the scrollbar the complete advertised result length.

Rows contain only a 16-bit address, instruction bytes, and v6emul's undecorated instruction. When the active debug artifact has an exact address mapping, the host replaces the listing with that complete source line and applies the shared TextMate highlighting and source-symbol links. Resume, hide, disconnect, filter replacement, or stale response generation clears the active result. The server must advertise trace-log schema 1, filter/window capabilities, and positive capacity, line, and UTF-8 pattern limits.

## Scripts

`Scripts` is a standalone editor panel for server-owned Lua scripts loaded from absolute server-local paths. It filters Name with case-insensitive substring or `*` glob semantics, edits Name and Path inline, toggles requested Activity, and exposes Compile, Run Once, Disable, Disable All, Delete, and Delete All. Compilation or runtime failures color the row with the VS Code error foreground while retaining icon and tooltip indicators.

`ScriptService` validates script schema 1, commands `84..88` and `105..109`, snapshots, runtime states, collection revisions, portable generic paths, and advertised limits. Mutation snapshots are applied directly; visible panels poll the lightweight update revision and fetch the complete ascending-ID collection only when needed. Mutations and Run Once are gated independently while emulation runs.

## Watchpoints

`Watchpoints` is a standalone editor panel opened from the `v6emul` view container or Command Palette and shares the lifecycle's IPC connection. It requires watchpoint schema 1, server-allocated IDs, and `DEBUG_WATCHPOINT_EDIT` command 94. Add, edit, activity toggles, delete, Disable All, and Delete All are serialized and reconciled with `DEBUG_WATCHPOINT_GET_ALL` before the UI accepts backend state.

Rows use global numeric addresses covering Main RAM and all RAM-disk banks. Hover or keyboard focus reads at most 16 bytes when `GET_MEM` is available. Find in Hex Viewer converts the global range into a typed memory space, selects that bank, and highlights the inclusive range. Ranges crossing a 64 KiB viewer bank are rejected.

## FPS Counter

While the emulator is running, a live **FPS counter** appears in the VS Code **status bar** (bottom-right). It shows the actual number of frames rendered per second (e.g., `⟡ 45 fps`). The counter hides automatically when the emulator is paused or stopped.
