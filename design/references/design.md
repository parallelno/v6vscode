# v6vscode Design

## 1. Purpose

`v6vscode` is a VS Code extension that provides an integrated development environment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer.

The extension is responsible for:

1. Assembly syntax highlighting and include-path navigation.
2. Project orchestration via `*.project.json`.
3. Build command integration (invoking external toolchain).
4. Emulator presentation inside a VS Code webview panel.

The extension does **not** implement an assembler, C compiler, floppy image builder, or emulator core. Those are standalone external tools stored under `tools/` and invoked through adapter layers.

## 2. Goals

### 2.1 Product Goals

1. Provide assembly editing support with syntax highlighting and include navigation.
2. Make project creation, build, and run available directly inside VS Code.
3. Integrate emulator output into a dedicated VS Code webview panel.
4. Keep the user in control of the toolchain setup. The extension's entry point is the project file and its reference to the executable.

### 2.2 Engineering Goals

1. Organize extension code by domain, not by feature accretion.
2. Separate pure logic from VS Code API glue wherever possible.
3. Define strict interfaces around external tools.
4. Make the system testable at unit, integration, and regression levels.
5. Ensure every milestone ends with updated tests and updated documentation.

## 3. Non-Goals

These are explicitly excluded from the current scope:

1. Reimplement `v6c`, `v6asm`, `v6fdd`, or `v6emul` in TypeScript.
2. Parse, load, or use `*.symbols.json` for source mapping, symbol navigation, hovers, or any debug metadata purpose.
3. Control flow toolbar (run/pause/step/restart).
4. Breakpoint UI (gutter toggles, VS Code breakpoint panel integration).
5. Watchpoint UI.
6. `*.debug.json` session state persistence.
7. VS Code debug register list window integration.
8. Data line or code highlights based on symbol metadata.
9. Symbol resolving for hovers, watches, or runtime inspection.

These features are planned for the future and will be designed separately once the core extension is stable. See [Section 15: Future Plans](#15-future-plans).

## 4. Guiding Principles

### 4.1 Clear Ownership

Each subsystem must own one concern:

1. Language features own syntax highlighting and include navigation.
2. Project services own project discovery, validation, and persistence.
3. Build services own tool invocation and build orchestration.
4. Emulator services own emulator lifecycle and panel presentation.

### 4.2 Artifact-Driven Design

The extension derives behavior from explicit files.

- `*.project.json` stores project configuration and the reference to the executable (`*.rom` or `*.fdd`).
- `*.rom` and `*.fdd` are the build artifacts consumed by the emulator.

The user is in charge of setting up the toolchain. The extension reads the project file, invokes the configured build steps, and loads the resulting executable into the emulator.

### 4.3 Testable by Default

Path resolution, project parsing, tool argument construction, IPC codec logic, and panel message handling must be implemented in testable modules with minimal VS Code dependencies.

## 5. Core Artifacts

### 5.1 `*.project.json`

The project file is the root of all extension workflows: build, run, and emulate. It stores:

1. Project identity.
2. Entry source file for the build toolchain.
3. Output executable path (`*.rom` or `*.fdd`).
4. Build toolchain configuration.
5. Optional FDD generation settings.
6. Emulator launch preferences.

Proposed shape:

```json
{
  "$schema": "./schemas/v6.project.schema.json",
  "name": "demo",
  "build": {
    "entry": "src/main.asm",
    "rom": "out/demo.rom",
    "cpu": "i8080",
    "romAlign": 2,
    "listing": true
  },
  "disk": {
    "enabled": false,
    "template": "${extension}/res/fdd/rds308.fdd",
    "output": "out/demo.fdd",
    "content": ["out/demo.rom"]
  },
  "run": {
    "executable": "out/demo.rom",
    "bootRom": "${extension}/res/boot/boots.bin",
    "speed": "1x",
    "viewMode": "fit"
  }
}
```

Notes:

- Paths are relative to the project file unless absolute.
- `${extension}` is resolved at runtime for bundled assets.
- `run.executable` points to the final `*.rom` or `*.fdd` that the emulator loads. This is the critical link.
- The schema should be explicit and versionable.

### 5.2 Toolchains

The user configures the build toolchain. The extension supports two paths:

```
When C source:   C (v6c) -> ASM (v6asm) -> ROM -> (if needed, v6fdd) -> FDD
When ASM source: ASM (v6asm) -> ROM -> (if needed, v6fdd) -> FDD
```

The extension does not enforce a specific toolchain. It invokes the steps defined in the project file. The entry point is always the project file and its reference to the executable.

### 5.3 `*.rom`

The Vector-06C executable binary produced by `v6asm`. Loaded into emulator memory at a configurable address (default `0x0000`).

### 5.4 `*.fdd`

A floppy disk image (820 KB). Built by `v6fdd` from a template and project outputs. When present and configured, the emulator boots from FDD instead of loading ROM directly.

## 6. System Context

```
Source files in workspace (.asm, .c)
  -> language services (syntax highlight, include navigation)
  -> project discovery (*.project.json)
  -> build orchestration (v6c -> v6asm -> v6fdd)
  -> .rom / .fdd artifacts
  -> emulator launch (v6emul --serve)
  -> IPC client <-> emulator backend
  -> webview panel (frame rendering, speed control, memory dump)
```

## 7. External Tools

All tools are external executables stored under `tools/`. The extension wraps each through an adapter so the rest of the codebase depends on stable TypeScript interfaces, not process details.

### 7.1 `v6c` — C Compiler

- Location: `tools/v6c/`
- Purpose: Compiles C source to Intel 8080 assembly.
- Input: `*.c`
- Output: `*.asm`

### 7.2 `v6asm` — Assembler

- Location: `tools/v6asm/`
- Purpose: Two-pass Intel 8080/Z80 assembler. Compiles `*.asm` to `*.rom`.
- CLI: `v6asm <source.asm> -o <out.rom> [-c i8080|z80] [-a <align>] [-l]`
- Output: `*.rom`, optionally `*.lst` (listing file).

### 7.3 `v6fdd` — FDD Image Builder

- Location: `tools/v6fdd/`
- Purpose: Creates FDD disk images from a template and project artifacts.
- Input: template `*.fdd` + content files (ROM, bin, etc.)
- Output: `*.fdd` (819,200 bytes: 2 sides × 82 tracks × 5 sectors × 1024 bytes)

### 7.4 `v6emul` — Emulator Backend

- Location: `tools/v6emul/`
- Purpose: Headless Vector-06C emulator. Runs as a TCP IPC server.
- CLI: `v6emul --serve [--rom <path>] [--load-addr <addr>] [--boot-rom <path>] [--speed <speed>] [--tcp-port <port>]`
- `--boot-rom` loads the boot ROM (e.g. `res/boot/boots.bin`) that the hardware executes before handing off to the user program.
- Protocol: Length-prefixed MessagePack over TCP loopback. See [Section 11](#11-emulator-ipc-protocol).

### 7.5 Tool Discovery

Resolution order:

1. Explicit path from extension settings (if configured by the user).
2. Bundled path under `tools/` inside the extension.
3. User `PATH` fallback.

The extension should validate tool presence early and produce actionable error messages.

## 8. Proposed Repository Layout

```
v6vscode/
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
      discovery/project-discovery.ts     # Find *.project.json in workspace
      persistence/project-repository.ts  # Load/save project files
      active/active-project-service.ts   # Track selected project
    tools/
      common/tool-locator.ts             # Resolve tool binary path
      v6c/v6c-adapter.ts                 # C compiler adapter
      v6asm/v6asm-adapter.ts             # Assembler adapter
      v6fdd/v6fdd-adapter.ts             # FDD builder adapter
      v6emul/v6emul-launcher.ts          # Emulator process launcher
    build/
      pipeline/build-pipeline.ts         # Orchestrate: validate -> compile -> verify -> disk
      diagnostics/diagnostic-mapper.ts   # Map tool stderr to VS Code diagnostics
    language/
      includes/include-link-provider.ts  # Ctrl+click on .include paths
      syntax/                            # Grammar registration
    emulator/
      client/ipc-client.ts              # TCP client, request-response
      protocol/ipc-codec.ts             # MessagePack encode/decode
      protocol/ipc-commands.ts          # Typed command enums and interfaces
      lifecycle/emulator-lifecycle.ts   # Launch, stop, restart orchestration
      panel/emulator-panel.ts           # Webview panel creation and message bridge
      panel/emulator-viewmodel.ts       # Typed view model for panel state
      panel/assets/                     # Webview HTML/CSS/JS
    commands/
      create-project-command.ts
      build-project-command.ts
      run-project-command.ts
    templates/
      project/                          # Starter *.project.json
      asm/                              # Starter *.asm
  test/
    unit/
      platform/
      project/
      tools/
      build/
      language/
      emulator/
    integration/
    regression/
    fixtures/
  docs/
  design/
  res/
    boot/boots.bin
    fdd/rds308.fdd
    images/icon.png
    syntaxes/devector_8080.tmLanguage.json
  tools/
    v6c/
    v6asm/
    v6fdd/
    v6emul/
```

Layout rules:

1. `extension.ts` is the composition root — construct services, register contributions, dispose. No business logic.
2. VS Code API usage pushed to the edges. Parsing and model code never depends on webview or panel code.
3. All external process launching is centralized under `src/tools/`.
4. Shared path and workspace utilities live under `src/platform/`, not duplicated per feature.

## 9. Module Architecture

### 9.1 Extension Composition Root

`src/extension.ts` must only:

1. Construct services.
2. Register VS Code contributions (commands, providers, panels).
3. Dispose resources on deactivation.

It must not contain project logic, parsing, process invocation, or emulator session management.

### 9.2 Project Domain

Responsibilities:

1. Discover `*.project.json` files in the workspace.
2. Parse and validate project files against the JSON schema.
3. Resolve relative and `${extension}`-bundled paths.
4. Expose the active project selection service (prompt user if multiple projects exist).
5. Persist updates when commands create or edit project files.

Key interfaces:

```ts
interface ProjectDiscovery {
  findProjects(): Promise<ProjectFile[]>;
}

interface ProjectRepository {
  load(uri: vscode.Uri): Promise<V6Project>;
  save(project: V6Project): Promise<void>;
}

interface ActiveProjectService {
  getActiveProject(): Promise<V6Project | undefined>;
}
```

### 9.3 Tool Adapter Domain

Each external tool gets its own adapter with:

1. Binary discovery via `tool-locator.ts`.
2. CLI argument construction.
3. Process execution via `process-runner.ts`.
4. Structured result mapping (parse stdout/stderr into typed objects).
5. Version probing.

```ts
interface AssemblerAdapter {
  assemble(request: AssembleRequest): Promise<AssembleResult>;
  getVersion(): Promise<string>;
}

interface DiskBuilderAdapter {
  buildDisk(request: BuildDiskRequest): Promise<BuildDiskResult>;
}

interface EmulatorLauncher {
  launch(request: LaunchRequest): Promise<EmulatorProcess>;
}
```

These adapters shield the rest of the system from CLI flag changes and process details.

### 9.4 Build Pipeline Domain

The build pipeline owns the sequence:

1. Resolve active project.
2. Validate project paths and toolchain configuration.
3. Run `v6c` (if C source entry).
4. Run `v6asm`.
5. Verify `*.rom` existence.
6. Optionally run `v6fdd` to produce `*.fdd`.
7. Publish build diagnostics.

Build results are structured objects, never raw terminal text passed around.

### 9.5 Language Domain

Responsibilities:

1. Register `res/syntaxes/devector_8080.tmLanguage.json` for syntax highlighting.
2. Provide include-path navigation (Ctrl+click on `.include` directives resolves from source text).

Navigation strategy:

- Include links are resolved directly from source text — no build required.
- Label and constant navigation is a future feature. Not in current scope.

### 9.6 Emulator Domain

The emulator domain is the center of the runtime experience.

Responsibilities:

1. Launch `v6emul` process in `--serve` mode.
2. Manage TCP IPC connection lifecycle.
3. Send commands, receive responses.
4. Present video frames in a webview panel.
5. Provide panel controls: run/pause, restart, speed, memory dump.

The panel is a **consumer** of emulator state, not a source of truth. It uses a typed message bridge and a view model.

## 10. Emulator Panel Design

### 10.1 Responsibilities

The emulator panel provides:

1. Video output — rendered frame from the emulator.
2. Runtime controls — run, pause, restart, speed selection.
3. Hardware status summary — frame number, speed percentage, display mode.
4. Memory dump — 16×16 hex dump with optional PC tracking, address navigation.
5. Keyboard input forwarding to the emulator.

### 10.2 Boundaries

The panel must not:

1. Own emulator process lifecycle decisions independently.
2. Contain business logic that belongs in services.

### 10.3 View Model

The webview receives typed messages:

```ts
type PanelMessage =
  | { type: 'frame'; width: number; height: number; pixels: Uint8Array }
  | { type: 'status'; running: boolean; speed: string; frameNum: number; speedPercent: number }
  | { type: 'memory'; start: number; bytes: number[]; pc?: number }
  | { type: 'hwStats'; cc: number; rasterLine: number; rasterPixel: number;
      displayMode: number; scrollVert: number; rusLat: boolean;
      inte: boolean; hlta: boolean; palette: number[] }
  | { type: 'error'; message: string };
```

### 10.4 Speed Control

Speed values map to `SET_CPU_SPEED` IPC command:

| UI Label | IPC Value | Behavior |
|----------|-----------|----------|
| 1% | 0 | Extreme slow motion |
| 20% | 1 | Slow |
| 50% | 2 | Half speed |
| 100% | 3 | Normal (50 fps PAL) |
| 200% | 4 | Double speed |
| Max | 5 | No frame delay |

### 10.5 Memory Dump

The memory dump panel streams a 16×16 hex dump. Features:

- Follow PC mode — automatically tracks the current program counter.
- Manual mode — freeze on a specific address.
- Address input — hex or decimal.
- Navigation buttons: ±0x10, ±0x100.
- ASCII column alongside hex bytes.

Uses `GET_BYTE_RAM` (cmd 14) and `GET_MEM_STRING_GLOBAL` (cmd 16) for reads.

## 11. Emulator IPC Protocol

### 11.1 Wire Format

Length-prefixed MessagePack over TCP loopback (`127.0.0.1`).

```
[4 bytes: uint32_t payload length, little-endian] [N bytes: MessagePack payload]
```

Request: `{"cmd": <int>, "data": {...}}`
Response: `{"ok": true, "data": {...}}` or `{"ok": false, "error": "description"}`

### 11.2 Frame Transport

For high-throughput frame streaming, `GET_FRAME_RAW` (cmd -4) bypasses MessagePack:

```
[4 bytes: payloadLen] [4 bytes: width] [4 bytes: height] [pixels: raw ABGR]
```

Frame: 768 × 312 × 4 bytes = 958,464 bytes. At 50 fps: ~48 MB/s (TCP loopback headroom: ~700 MB/s).

### 11.3 Commands Used by the Extension

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

1. Poll `GET_FDD_INFO` — check the `updated` field for unsaved writes.
2. Export via `GET_FDD_IMAGE` — returns the full 819,200-byte image.
3. Save to file (client-side).
4. Clear dirty flag via `RESET_UPDATE_FDD`.

#### Keyboard

| cmd | Name | Purpose |
|-----|------|---------|
| 45 | KEY_HANDLING | Send key press/release |

## 12. Configuration Model

### 12.1 Extension Settings

Global extension settings cover environment-level configuration only:

1. Optional override paths for tools (`v6c`, `v6asm`, `v6fdd`, `v6emul`).
2. Logging verbosity.
3. Default emulator preferences that are not project-specific.

Project-specific behavior belongs in `*.project.json`, not global settings.

### 12.2 Schema and Validation

Provide a JSON schema for `*.project.json`.

Validation runs:

1. At file load time.
2. Before build or run.

Invalid configuration produces structured diagnostics surfaced in VS Code.

## 13. Observability and Diagnostics

### 13.1 Logging

Structured log output to a dedicated VS Code output channel. Log levels: error, warn, info, debug.

### 13.2 Build Diagnostics

Assembler stderr is parsed and mapped to VS Code diagnostic entries (file, line, severity, message) displayed in the Problems panel.

### 13.3 Error Classification

Tool failures are classified into:

1. Configuration errors — missing or invalid project settings.
2. Missing executable — tool binary not found.
3. Build failures — non-zero exit from assembler or compiler.
4. Artifact missing — expected output file not produced.
5. Emulator errors — launch failure, connection refused, IPC timeout.

This classification enables consistent UX and testable error paths.

## 14. Testing Strategy

The system must have a comprehensive test suite. This is a design requirement.

### 14.1 Unit Tests

Cover pure logic modules:

1. Project parsing and validation.
2. Path resolution and `${extension}` expansion.
3. Tool CLI argument construction.
4. Build diagnostic parsing.
5. IPC codec encode/decode.
6. Panel view model state transitions.

### 14.2 Integration Tests

Cover service boundaries:

1. Build pipeline with mocked process runner.
2. Emulator IPC handshake against a mock TCP server.
3. Project discovery across multiple workspace folders.

### 14.3 Regression Tests

Capture likely-to-break behavior:

1. Multiple `*.project.json` selection.
2. Missing tool binary on build.
3. Missing output artifact after build.
4. Emulator connection failure and recovery.
5. Panel close and reopen.

### 14.4 Test Infrastructure

- Framework: Mocha + Chai.
- Fixtures: `test/fixtures/` with sample project files and ROM stubs.
- Mocks: helpers for process runner, file system, IPC server.
- CI: `npm run test` runs all suites.

### 14.5 Milestone Definition of Done

Every milestone must end with:

1. Unit tests added or updated.
2. Regression tests added or updated.
3. All tests passing.
4. Documentation updated in `docs/`.
5. Root `README.md` updated if user-facing behavior changed.

## 15. Future Plans

The following features are explicitly **outside the current scope**. They will be designed and implemented as separate efforts once the core extension is stable:

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

## 16. Risks and Countermeasures

### 16.1 Architecture Drift

**Risk**: Extension grows into a monolith mixing concerns.
**Countermeasure**: Keep `extension.ts` as composition root only. Review imports across domains. Reject convenience imports that cross boundaries.

### 16.2 Tool Contract Changes

**Risk**: External tool CLI or output format changes break adapters.
**Countermeasure**: Typed adapter request/response objects. Normalize tool output immediately. Adapter-level tests verify expected behavior.

### 16.3 IPC Performance

**Risk**: Frame streaming saturates the event loop.
**Countermeasure**: Use `GET_FRAME_RAW` for binary transport. Throttle frame requests to match display rate. Measure and tune in hardening.

### 16.4 UI Logic Capturing Core Behavior

**Risk**: Emulator panel accumulates business logic.
**Countermeasure**: Panel is a passive view. Business logic lives in services with tests. Exchange typed messages only.

## 17. Summary

The extension is organized around two stable foundations:

1. **`*.project.json`** — explicit project configuration and executable reference.
2. **External tools** — `v6c`, `v6asm`, `v6fdd`, `v6emul` wrapped through clean adapter layers.

The user is in charge of their toolchain. The extension's job is to provide a clean project model, invoke the right tools, and render the emulator output. Everything else — syntax highlighting, include navigation, build diagnostics — supports that core loop.

The current scope deliberately excludes debug infrastructure (symbols, breakpoints, watchpoints, control flow, registers). This keeps the initial implementation focused on a solid, testable foundation that can be extended cleanly.
