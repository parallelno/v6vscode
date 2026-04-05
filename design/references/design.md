# v6vscode Design

## 1. Purpose

`v6vscode` is a VS Code extension that provides an integrated development environment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer.

The extension is responsible for:

1. Assembly syntax highlighting and include-path navigation.
2. Project orchestration via `*.project.json`.
3. Emulator presentation inside a VS Code webview panel.

## 2. Goals

### 2.1 Product Goals

1. Provide assembly editing support with syntax highlighting and include navigation.
2. Make project creation and emulator launch available directly inside VS Code.
3. Integrate emulator output into a dedicated VS Code webview panel.
4. Keep the user in control of the build pipeline. The extension's entry point is the project file and its reference to the executable.

### 2.2 Engineering Goals

1. Organize extension code by domain, not by feature accretion.
2. Separate pure logic from VS Code API glue wherever possible.
3. Define a strict interface around the emulator backend.
4. Make the system testable at unit, integration, and regression levels.
5. Ensure every milestone ends with updated tests and updated documentation.


## 4. Guiding Principles

### 4.1 Clear Ownership

Each subsystem must own one concern:

1. Language features own syntax highlighting and include navigation.
2. Project services own project discovery, validation, and persistence.
3. Emulator services own emulator lifecycle and panel presentation.

### 4.2 Artifact-Driven Design

The extension derives behavior from explicit files.

- `*.project.json` stores project configuration and the reference to the executable (`*.rom` or `*.fdd`).
- `*.rom` and `*.fdd` are the artifacts consumed by the emulator.

The user is in charge of the build pipeline (Makefile, shell script, VS Code task, etc.). The extension reads the project file, validates the executable path, and loads the result into the emulator.

### 4.3 Testable by Default

Path resolution, project parsing, IPC codec logic, and panel message handling must be implemented in testable modules with minimal VS Code dependencies.

## 5. Core Artifacts

### 5.1 `*.project.json`

The project file is the root configuration for the extension. It stores:

1. Project identity.
2. Executable path (`*.rom` or `*.fdd`) — the artifact the emulator loads.
3. Emulator launch preferences.

Proposed shape:

```json
{
  "$schema": "./schemas/v6.project.schema.json",
  "name": "demo",
  "run": {
    "executable": "out/demo.rom",
    "speed": "100%",
    "viewMode": "borderless"
  }
}
```

Example with a custom boot ROM and FDD executable:

```json
{
  "$schema": "./schemas/v6.project.schema.json",
  "name": "hello_c",
  "run": {
    "executable": "out/hello_c.fdd",
    "bootRom": "roms/custom_boot.bin",
    "fddReadOnly": true,
    "speed": "100%",
    "viewMode": "borderless"
  }
}
```

Notes:

- Paths are relative to the project file unless absolute.
- `${extension}` is resolved at runtime for bundled assets.
- `run.executable` points to the final `*.rom` or `*.fdd` that the emulator loads. This is the critical link between the user's build output and the extension.
- `run.bootRom` is optional. When omitted, the extension uses its bundled `res/boot/boots.bin`. The user only needs to set this field when a custom boot ROM is required.
- `run.loadAddr` is optional. Specifies the memory address where the ROM is loaded (passed to `--load-addr`). Default: `0x100`.
- `run.fddReadOnly` is optional. When `true`, the extension treats the mounted FDD image as read-only — emulator writes still happen in memory but the extension will not persist them back to disk. Default: `false`.
- The schema should be explicit and versionable.

#### 5.1.1 Create Project Command

The **V6: Create Project** command scaffolds a new **Make-based** project with a working build pipeline:

1. Prompt for a **project name**.
2. Prompt for **language**: ASM or C.
3. Prompt for **executable type**: ROM or FDD.
4. Generate the following files in the workspace:

| File | Purpose |
|------|---------|
| `<name>.project.json` | Project configuration with default `run` settings. |
| `src/main.asm` or `src/main.c` | Starter source file (language-dependent). |
| `Makefile` | Build pipeline invoking the appropriate toolchain. |

5. Show an information message: *"Project created. Build with `make` before running the emulator."*
6. Open the generated project file in the editor.

**Generated Makefile — ASM / ROM:**

```makefile
ROM  = out/demo.rom
SRC  = src/main.asm
CPU  = i8080

$(ROM): $(SRC)
	v6asm $(SRC) -o $(ROM) -c $(CPU)
clean:
	rm -f $(ROM)
```

**Generated Makefile — ASM / FDD:**

```makefile
ROM      = out/demo.rom
FDD      = out/demo.fdd
SRC      = src/main.asm
CPU      = i8080
TEMPLATE = res/fdd/rds308.fdd

$(FDD): $(ROM)
	v6fdd $(TEMPLATE) $(FDD) $(ROM)
$(ROM): $(SRC)
	v6asm $(SRC) -o $(ROM) -c $(CPU)
clean:
	rm -f $(ROM) $(FDD)
```

**Generated Makefile — C / ROM:**

```makefile
ROM  = out/demo.rom
ASM  = out/demo.asm
SRC  = src/main.c
CPU  = i8080

$(ROM): $(ASM)
	v6asm $(ASM) -o $(ROM) -c $(CPU)
$(ASM): $(SRC)
	v6c $(SRC) -o $(ASM)
clean:
	rm -f $(ASM) $(ROM)
```

**Generated Makefile — C / FDD:**

```makefile
ROM      = out/demo.rom
ASM      = out/demo.asm
FDD      = out/demo.fdd
SRC      = src/main.c
CPU      = i8080
TEMPLATE = res/fdd/rds308.fdd

$(FDD): $(ROM)
	v6fdd $(TEMPLATE) $(FDD) $(ROM)
$(ROM): $(ASM)
	v6asm $(ASM) -o $(ROM) -c $(CPU)
$(ASM): $(SRC)
	v6c $(SRC) -o $(ASM)
clean:
	rm -f $(ASM) $(ROM) $(FDD)
```

The generated project file uses sensible defaults (`speed: "100%"`, `viewMode: "borderless"`).

## 6. External Tools

### 6.1 `v6emul` — Emulator Backend (Extension-Managed)

The extension directly manages only the emulator backend.

- Location: `res/v6emul/` (bundled with the extension).
- Purpose: Headless Vector-06C emulator. Runs as a TCP IPC server.
- CLI: `v6emul --serve [--rom <path>] [--load-addr <addr>] [--boot-rom <path>] [--speed <speed>] [--tcp-port <port>]`
- `--boot-rom` loads the boot ROM (e.g. `res/boot/boots.bin`) that the hardware executes before handing off to the user program.
- Protocol: Length-prefixed MessagePack over TCP loopback. See [Section 10](#10-emulator-ipc-protocol).

### 6.2 Emulator Discovery

Resolution order:

1. Explicit path from extension settings (if configured by the user).
2. Bundled path under `res/v6emul/` inside the extension.
3. User `PATH` fallback.

The extension should validate emulator presence early and produce actionable error messages.

### 6.3 User-Side Build Tools (Reference)

These tools are part of the Vector-06C toolchain but are **not** bundled with or invoked by the extension. The user downloads them separately and integrates them into their own build pipeline:

- **`v6asm`** — Two-pass Intel 8080/Z80 assembler. Releases: https://github.com/parallelno/v6asm/releases
- **`v6fdd`** — FDD image builder. Creates it from a template and content files. Releases: https://github.com/parallelno/v6asm/releases
- **`v6c`** — C compiler. Compiles C source to Intel 8080 assembly. Releases: https://github.com/parallelno/v6c/releases

## 7. Proposed Repository Layout

Layout rules:

1. `extension.ts` is the composition root — construct services, register contributions, dispose. No business logic.
2. VS Code API usage pushed to the edges. Parsing and model code never depends on webview or panel code.
3. All external process launching (emulator) is centralized under `src/emulator/`.
4. Shared path and workspace utilities live under `src/platform/`, not duplicated per feature.

## 8. Module Architecture

### 8.1 Extension Composition Root

`src/extension.ts` must only:

1. Construct services.
2. Register VS Code contributions (commands, providers, panels).
3. Dispose resources on deactivation.

It must not contain project logic, parsing, process invocation, or emulator session management.

### 8.2 Project Domain

Responsibilities:

1. Discover `*.project.json` files in the workspace root (no recursive search).
2. Parse and validate project files against the JSON schema.
3. Resolve relative and `${extension}`-bundled paths.
4. Expose the active project selection service (prompt user if multiple projects exist).
5. Persist updates when commands create or edit project files.

### 8.3 Emulator Launcher Domain

The emulator launcher manages `v6emul` process discovery and lifecycle:

1. Binary discovery via `v6emul-locator.ts`.
2. CLI argument construction from project `run` settings.
3. Process execution via `process-runner.ts`.
4. Version probing.

```ts
interface EmulatorLauncher {
  launch(request: LaunchRequest): Promise<EmulatorProcess>;
  getVersion(): Promise<string>;
}
```

The launcher shields the rest of the system from v6emul CLI changes and process details.

### 8.4 Language Domain

Responsibilities:

1. Register `res/syntaxes/devector_8080.tmLanguage.json` for syntax highlighting.
2. Provide include-path navigation (Ctrl+click on `.include` directives resolves from source text).

Navigation strategy:

- Include links are resolved directly from source text — no build required.
- Label and constant navigation is a future feature. Not in current scope.

### 8.5 Emulator Domain

The emulator domain is the center of the runtime experience.

Responsibilities:

1. Launch `v6emul` process in `--serve` mode.
2. Manage TCP IPC connection lifecycle.
3. Send commands, receive responses.
4. Present video frames in a webview panel.
5. Provide panel controls: run/pause, restart, speed, display mode.

The panel is a **consumer** of emulator state, not a source of truth. It uses a typed message bridge and a view model.

## 9. Emulator Panel Design

### 9.1 Responsibilities

The emulator panel provides:

1. Video output — rendered frame from the emulator.
2. Runtime controls — run/pause, reset, speed, display mode.
3. Keyboard input forwarding to the emulator.

### 9.2 Layout

The panel contains exactly two areas, top to bottom:

1. **Header bar** — a single row of controls:
   - Run / Pause toggle button.
   - Restart button.
   - Speed selector (dropdown or cycle button, values per §9.4).
   - Display mode selector (`full`, `border`, `borderless`; see §9.4).
2. **Frame viewport** — fills the remaining panel area. Renders the emulator video output via `GET_FRAME_RAW`.

No other UI elements are present in the panel.

### 9.3 Boundaries

The panel must not:

1. Own emulator process lifecycle decisions independently.
2. Contain business logic that belongs in services.

### 9.4 Display Mode

The display mode controls which portion of the emulator frame is shown in the panel. The emulator always sends a full 768 × 312 ABGR frame via `GET_FRAME_RAW`. The extension crops the frame before rendering.

**Frame geometry (MODE_512 pixel units):**

| Region | Value |
|--------|-------|
| Full frame | 768 × 312 |
| Active area | 512 × 256 |
| Border left / right | 128 px each |
| Border top (vsync 24 + vblank 16) | 40 scanlines |
| Border bottom (vblank) | 16 scanlines |
| Visible border (reduced) | 16 px per side |

**Display modes:**

| UI Label | Crop rectangle (x, y, w, h) | Description |
|----------|------------------------------|-------------|
| `full` | 0, 0, 768, 312 | Original frame, original aspect. |
| `border` | 112, 24, 544, 288 | Active area + 16 px visible border on each side. 4 x 3 aspect. |
| `borderless` | 128, 40, 512, 256 | Active area only — no borders. 4 x 3 aspect. |

Notes:
- The `viewMode` field in `*.project.json` stores the user's preference (`full`, `border`, `borderless`). Default: `borderless`.

### 9.5 View Model

The webview receives typed messages:

```ts
type PanelMessage =
  | { type: 'frame'; width: number; height: number; pixels: Uint8Array }
  | { type: 'status'; running: boolean; speed: string }
  | { type: 'error'; message: string };
```

### 9.6 Speed Control

Speed values map to `SET_CPU_SPEED` IPC command:

| UI Label | IPC Value | Behavior |
|----------|-----------|----------|
| 1% | 0 | Extreme slow motion |
| 20% | 1 | Slow |
| 50% | 2 | Half speed |
| 100% | 3 | Normal (50 fps PAL) |
| 200% | 4 | Double speed |
| Max | 5 | No frame delay |

Notes:
- The `speed` field in `*.project.json` stores the user's preference (`1%`, `20%`, `50%`, `100%`, `200%`, `max`). Default: `100%`.

## 10. Emulator IPC Protocol

### 10.1 Wire Format

Length-prefixed MessagePack over TCP loopback (`127.0.0.1`).

```
[4 bytes: uint32_t payload length, little-endian] [N bytes: MessagePack payload]
```

Request: `{"cmd": <int>, "data": {...}}`
Response: `{"ok": true, "data": {...}}` or `{"ok": false, "error": "description"}`

### 10.2 Frame Transport

For high-throughput frame streaming, `GET_FRAME_RAW` (cmd -4) bypasses MessagePack:

```
[4 bytes: payloadLen] [4 bytes: width] [4 bytes: height] [pixels: raw ABGR]
```

Frame: 768 × 312 × 4 bytes = 958,464 bytes. At 50 fps: ~48 MB/s (TCP loopback headroom: ~700 MB/s).

### 10.3 Commands Used by the Extension

The extension uses the following IPC command subset in the current scope:

#### Connection

| cmd | Name | Purpose |
|-----|------|---------|
| -1 | PING | Health check |
| 4 | EXIT | Shut down emulator |

#### Emulation Control

| cmd | Name | Purpose |
|-----|------|---------|
| 1 | RUN | Resume execution |
| 2 | STOP | Pause execution |
| 3 | IS_RUNNING | Query execution state |
| 5 | RESET | Reboot with ROM |
| 6 | RESTART | Reboot without ROM |
| 42 | SET_CPU_SPEED | Speed control (values 0–5) |

#### Frame

| cmd | Name | Purpose |
|-----|------|---------|
| -4 | GET_FRAME_RAW | Raw ABGR frame (high throughput) |

#### CPU State

| cmd | Name | Purpose |
|-----|------|---------|
| 11 | GET_REGS | All registers: cc, pc, sp, af, bc, de, hl, ints, m |
| 12 | GET_REG_PC | Current program counter |

#### Memory

| cmd | Name | Purpose |
|-----|------|---------|
| 14 | GET_BYTE_RAM | Read single byte |
| 16 | GET_MEM_STRING_GLOBAL | Read memory block |
| 40 | SET_MEM | Write bytes |

#### Hardware Status

| cmd | Name | Purpose |
|-----|------|---------|
| 43 | GET_HW_MAIN_STATS | Full hardware stats (cc, raster, frame, display mode, palette, etc.) |

#### ROM / FDD Loading

| cmd | Name | Purpose |
|-----|------|---------|
| 89 | LOAD_ROM | Stop, write ROM bytes to RAM at addr, restart, optionally autorun |
| 90 | MOUNT_FDD | Mount FDD image on drive, optionally reset + boot |
| 24 | GET_FDD_INFO | FDD status (path, updated, reads, writes, mounted) |
| 25 | GET_FDD_IMAGE | Export full 820 KB disk image from drive |
| 47 | RESET_UPDATE_FDD | Clear FDD dirty flag after save |

`LOAD_ROM` is the primary way to push a rebuilt ROM into a running emulator without restarting the process. `MOUNT_FDD` replaces the lower-level `LOAD_FDD` (cmd 46) for the extension's use — it handles padding, mounting, and optional boot in one call.

**FDD persistence workflow** (save/discard modified disks):

When `fddReadOnly` is `true`, the extension skips the entire workflow — in-memory writes are discarded when the emulator exits.

When `fddReadOnly` is `false` (default):

1. Poll `GET_FDD_INFO` — check the `updated` field for unsaved writes.
2. Export via `GET_FDD_IMAGE` → write to file → `RESET_UPDATE_FDD`.

#### Keyboard

| cmd | Name | Purpose |
|-----|------|---------|
| 45 | KEY_HANDLING | Send key press/release |

## 11. Configuration Model

### 11.1 Extension Settings

Global extension settings cover environment-level configuration only:

1. Optional override path for `v6emul`.
2. Logging verbosity.
3. Default emulator preferences that are not project-specific.

Project-specific behavior belongs in `*.project.json`, not global settings.

### 11.2 Schema and Validation

Provide a JSON schema for `*.project.json`.

Validation runs:

1. At file load time.
2. Before emulator launch.

Invalid configuration produces structured diagnostics surfaced in VS Code.

## 12. Observability and Diagnostics

### 12.1 Logging

Structured log output to a dedicated VS Code output channel. Log levels: error, warn, info, debug.

### 12.2 Error Classification

Failures are classified into:

1. Configuration errors — missing or invalid project settings.
2. Missing emulator — `v6emul` binary not found.
3. Missing executable — `run.executable` artifact does not exist at launch time.
4. Emulator errors — launch failure, connection refused, IPC timeout.

This classification enables consistent UX and testable error paths.

## 13. Testing Strategy

The system must have a comprehensive test suite. This is a design requirement.

### 13.1 Unit Tests

Cover pure logic modules:

1. Project parsing and validation.
2. Path resolution and `${extension}` expansion.
3. Emulator CLI argument construction.
4. IPC codec encode/decode.
5. Panel view model state transitions.

### 13.2 Integration Tests

Cover service boundaries:

1. Emulator IPC handshake against a mock TCP server.
2. Project discovery across multiple workspace folders.
3. Emulator launch with mocked process runner.

### 13.3 Regression Tests

Capture likely-to-break behavior:

1. Multiple `*.project.json` selection.
2. Missing `v6emul` binary at launch.
3. Missing executable artifact at launch.
4. Emulator connection failure and recovery.
5. Panel close and reopen.

### 13.4 Test Infrastructure

- Framework: Mocha + Chai.
- Fixtures: `test/fixtures/` with sample project files and ROM stubs.
- Mocks: helpers for process runner, file system, IPC server.
- CI: `npm run test` runs all suites.

### 13.5 Milestone Definition of Done

Every milestone must end with:

1. Unit tests added or updated.
2. Regression tests added or updated.
3. All tests passing.
4. Documentation updated in `docs/`.
5. Root `README.md` updated if user-facing behavior changed.

## 14. Future Plans

The following features are explicitly out of scope for the current phase.
They will be designed and implemented as separate efforts once the core extension is stable.
They are listed here to ensure the project architecture is designed to be easily extensible to accommodate these capabilities in the future.

1. **Debug symbols** — `*.symbols.json` parsing, address-to-source mapping, source-to-address mapping.
2. **Symbol navigation** — Ctrl+click on labels and constants to jump to definitions.
3. **Code and data highlights** — data directive read/write highlighting, instruction opcode tooltips.
4. **Symbol resolving** — hovers, watches, and runtime value inspection.
5. **Control flow toolbar** — run/pause/step into/step over/step frame/restart.
6. **Breakpoint UI** — VS Code breakpoint panel integration, gutter toggles, breakpoint-capable line resolution.
7. **Watchpoint UI** — memory watchpoints with VS Code integration.
8. **`*.debug.json`** — session state persistence for breakpoints, watchpoints, and debugger preferences.
9. **Debug register list** — VS Code debug Variables panel showing CPU registers.
10. **ROM hot-reload** — recompile on save and apply memory diff patch.

## 15. Risks and Countermeasures

### 15.1 Architecture Drift

**Risk**: Extension grows into a monolith mixing concerns.
**Countermeasure**: Keep `extension.ts` as composition root only. Review imports across domains. Reject convenience imports that cross boundaries.

### 15.2 IPC Performance

**Risk**: Frame streaming saturates the event loop.
**Countermeasure**: Use `GET_FRAME_RAW` for binary transport. Throttle frame requests to match display rate. Measure and tune in hardening.

### 15.3 UI Logic Capturing Core Behavior

**Risk**: Emulator panel accumulates business logic.
**Countermeasure**: Panel is a passive view. Business logic lives in services with tests. Exchange typed messages only.