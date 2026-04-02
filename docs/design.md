# v6code — Design Document

**v6code** is a VS Code extension that provides a complete development environment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer built around the Intel 8080 (KR580VM80A) CPU.

The extension integrates an assembler, floppy-disk image builder, and a headless emulator backend into a single editing + debugging workflow inside VS Code.

---

## Table of Contents

1. [Goals](#1-goals)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Project Structure](#3-project-structure)
4. [External Tools](#4-external-tools)
5. [Extension Capabilities](#5-extension-capabilities)
   - 5.1 [Language Support](#51-language-support)
   - 5.2 [Commands](#52-commands)
   - 5.3 [Project System](#53-project-system)
   - 5.4 [Compilation Pipeline](#54-compilation-pipeline)
   - 5.5 [Emulator Integration](#55-emulator-integration)
   - 5.6 [Debug Features](#56-debug-features)
   - 5.7 [Editor Helpers](#57-editor-helpers)
6. [IPC Protocol](#6-ipc-protocol)
7. [Bundled Resources](#7-bundled-resources)
8. [Build & Development](#8-build--development)
9. [Testing](#9-testing)

---

## 1. Goals

| # | Goal |
|---|------|
| G1 | Provide rich assembly language editing (syntax highlighting, navigation, hover hints) for Intel 8080 / Z80 subset sources. |
| G2 | One-click project scaffolding, compilation, and emulation from inside VS Code. |
| G3 | Integrate a cycle-accurate Vector-06C emulator into VS Code as a webview panel with full debug controls. |
| G4 | Expose emulator debug state (registers, breakpoints, watchpoints, memory) through standard VS Code debug interfaces. |
| G5 | Support floppy-disk image creation from project artifacts for loading programs that require FDD boot. |
| G6 | Enable hot-reload — save an `.asm` file during a debug session and have the ROM patched in-place without a full restart. |

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          VS Code (Host)                              │
│                                                                      │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │  Language    │  │  Extension      │  │  Webview Panel           │ │
│  │  Provider    │  │  Commands       │  │  (Emulator Display)      │ │
│  │  (ASM)       │  │  (compile/run)  │  │  frame, toolbar, memdump│ │
│  └──────┬──────┘  └──────┬──────────┘  └────────────┬─────────────┘ │
│         │                │                           │               │
│         │   ┌────────────┴───────────────────────────┘               │
│         │   │        Extension Host (TypeScript)                     │
│         │   │                                                        │
└─────────┼───┼────────────────────────────────────────────────────────┘
          │   │
          │   │  spawns / invokes CLI
          │   │
    ┌─────┴───┴──────────────────────────────────────────┐
    │              External Tool Processes                 │
    │                                                     │
    │  ┌─────────┐   ┌─────────┐   ┌──────────────────┐ │
    │  │ v6asm   │   │ v6fdd   │   │ v6emul           │ │
    │  │ (CLI)   │   │ (CLI)   │   │ (TCP IPC server) │ │
    │  └─────────┘   └─────────┘   └──────────────────┘ │
    └─────────────────────────────────────────────────────┘
```

**Data flow:**

1. User edits `.asm` files → language provider offers syntax highlighting, navigation, hover hints.
2. User triggers **Compile** → extension spawns `v6asm` with project settings → produces `.rom` + `.debug.json`.
3. If FDD is configured → extension spawns `v6fdd` → produces `.fdd` image from a template + project artifacts.
4. User triggers **Run (F5)** → extension starts `v6emul --serve` → connects over TCP loopback → streams frames into a webview panel.
5. Debug actions (step, breakpoints, register reads) flow as MessagePack IPC commands to `v6emul`.

---

## 3. Project Structure

```
v6vscode/
├── docs/                       # Documentation
│   ├── references/             # Reference materials
|   | ├── old_implementation.md       # Prior implementation reference
|   | ├── design_prompt.md            # Original design brief
|   └── design.md               # This file
├── src/                        # Extension TypeScript source
├── out/                        # Compiled JS (gitignored)
├── res/
│   ├── boot/                   # Boot ROMs (boot.bin, boots.bin)
│   ├── fdd/                    # Template FDD image (rds308.fdd)
│   ├── images/                 # Extension icon (icon.png)
│   └── syntaxes/               # TextMate grammar
│       └── devector_8080.tmLanguage.json
├── tools/
│   ├── v6asm/                  # Assembler binary + docs
│   ├── v6fdd/                  # FDD image builder binary + docs
│   └── v6emul/                 # Emulator binary + docs
├── temp/
│   ├── project/                # Sample/test project workspace
│   └── references/             # Reference materials
├── language-configuration.json # VS Code language config (comments, brackets)
├── tsconfig.json               # TypeScript compiler config
└── LICENSE
```

---

## 4. External Tools

### 4.1 v6asm — Assembler

| Item | Detail |
|------|--------|
| Location | `tools/v6asm/` |
| Language | standalone CLI executable |
| Input | `.asm` source file |
| Output | `.rom` binary, `.debug.json` metadata, optional `.lst` listing |
| CPU modes | Intel 8080 (default), Z80 compatibility subset (`--cpu z80`) |

**Key CLI flags:**

```
v6asm <source.asm> [-o <path>] [--cpu i8080|z80] [--rom-align <n>] [--lst] [-q] [-v]
v6asm --init <name>        # scaffold a starter .asm file
```

**Assembler features:** two-pass assembly, rich expression engine (arithmetic, bitwise, logical, comparison operators), directives (`.org`, `.include`, `.incbin`, `.macro`/`.endmacro`, `.if`/`.endif`, `.loop`/`.endloop`, `.optional`/`.endoptional`, `.byte`/`.word`/`.dword`, `.text`, `.encoding`, `.align`, `.storage`, `.var`, `.print`, `.error`, `.setting`, `.filesize`), local and global labels, constants (`=`, `EQU`), mutable variables (`.var`), up to 16 levels of nested includes, up to 32 levels of nested macros.

**Debug metadata (`.debug.json`):** contains tokens, labels, constants, and breakpoint line mappings consumed by the extension for navigation, hover hints, and breakpoint gutter logic.

### 4.2 v6fdd — FDD Image Builder

| Item | Detail |
|------|--------|
| Location | `tools/v6fdd/` |
| Input | template FDD image + project artifact files |
| Output | `.fdd` floppy disk image (819,200 bytes: 2 sides × 82 tracks × 5 sectors × 1024 bytes) |

Creates a bootable floppy disk image by starting from a template (e.g., `rds308.fdd`) and injecting project artifacts (`.rom`, `.bin`, etc.) into the disk file system. Used when the project's `fddContentPath` is configured.

### 4.3 v6emul — Emulator Backend

| Item | Detail |
|------|--------|
| Location | `tools/v6emul/` |
| Language | C++20 |
| IPC | TCP loopback (`127.0.0.1`), length-prefixed MessagePack |
| Default port | `9876` |

**Architecture:**

| Library | Role |
|---------|------|
| `v6utils` | Shared types, JSON helpers, file I/O |
| `v6core` | Full emulation engine (CPU, Memory, Display, IO, Audio, FDC, Debug) |
| `v6ipc` | TCP transport + MessagePack protocol |
| `app` | CLI entry point wiring IPC ↔ core |

**Emulated hardware:**

| Component | Description |
|-----------|-------------|
| CPU | Intel 8080 (KR580VM80A) @ 3 MHz, machine-cycle accurate |
| Memory | 64 KB main RAM + 8 × 256 KB RAM disks + ROM overlay |
| Display | Cycle-accurate PAL scanline rasterizer, 768 × 312 framebuffer, 50 fps |
| FDC | WD1793 (KR1818WG93), up to 4 floppy drives |
| Sound | AY-3-8910 + i8253 timer + beeper |
| I/O | 8255 PPI, 16-color palette, keyboard scan matrix |

**Threading:** Two threads — emulation thread (single-threaded hot path, owns all mutable state) and main thread (TCP server loop). Communication via `TQueue<T>` (mutex + condition variable).

**Server CLI:**

```
v6emul --serve [--rom <path>] [--load-addr <addr>] [--speed <speed>] [--tcp-port <port>]
```

---

## 5. Extension Capabilities

### 5.1 Language Support

**Language ID:** `asm` (Retro Assembler 8080)

**TextMate Grammar:** `res/syntaxes/devector_8080.tmLanguage.json`

Scopes provided:

| Scope | Pattern |
|-------|---------|
| `string.quoted.double` | `"..."` string literals |
| `string.quoted.single` | `'.'` character literals |
| `keyword.constantslabel` | `ALL_CAPS_IDENTIFIERS` |
| `keyword.globallabel` | `label:` at line start |
| `keyword.locallabel` | `@name` local labels |
| `keyword.directive` | `.org`, `.include`, `.macro`, etc. |
| `keyword.keyword` | `auto`, `true`, `false` |
| `keyword.instruction` | 8080 mnemonics (`MVI`, `LDA`, `JMP`, etc.) |
| `keyword.register` | `A`, `B`, `C`, `D`, `E`, `H`, `L`, `M`, `SP`, `PSW` |
| `comment.line` | `;` and `//` comments |
| `comment.block` | `/* ... */` multi-line comments |
| `constant.numeric` | Decimal, hex (`$`, `0x`), binary (`%`, `0b`, `b`) |
| `keyword.operator` | Arithmetic, bitwise, logical operators |

**Language Configuration** (`language-configuration.json`):
- Line comment: `;`
- Block comment: `/* ... */`

### 5.2 Commands

All commands are available from the Command Palette and the Explorer context menu.

| Command | Description |
|---------|-------------|
| **Devector: Create Project** | Scaffolds a new `.project.json` and starter `.asm` from templates. |
| **Devector: Compile Project** | Compiles the main project's entry `.asm` file via `v6asm`. Produces `.rom` and `.debug.json`. If `fddContentPath` is set, also runs `v6fdd` to rebuild the FDD image. |
| **Devector: Compile Dependencies** | Compiles all `*.project.json` found in the `dependentProjectsDir` directory (alphabetical order), skipping the main project. |
| **Run Project (F5)** | Compiles (if needed), launches `v6emul`, and opens the emulator webview panel. Uses VS Code launch configurations. |

When multiple `*.project.json` files exist in the workspace, compile and run commands prompt the user to select which project to target.

### 5.3 Project System

All project configuration lives in `<name>.project.json` files.

**Example:**

```json
{
  "name": "prg",
  "asmPath": "prg_main.asm",
  "debugPath": "prg.debug.json",
  "romPath": "out\\prg.rom",
  "fddPath": "out\\prg.fdd",
  "fddContentPath": "assets\\fdd_contents",
  "fddTemplatePath": "rds308.fdd",
  "romAlign": 2,
  "dependentProjectsDir": "deps",
  "cpu": "i8080",
  "settings": {
    "speed": "max",
    "viewMode": "noBorder",
    "ramDiskPath": "out\\prg.ram_disk.bin"
  }
}
```

**Project fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Project name |
| `asmPath` | yes | Entry assembly source file |
| `debugPath` | no | Output path for `.debug.json` metadata |
| `romPath` | no | Output ROM path |
| `fddPath` | no | FDD image path (takes precedence over `romPath` when valid) |
| `fddContentPath` | no | Folder whose files are packed into the FDD image at `fddPath` after each successful compile |
| `fddTemplatePath` | no | Template FDD to start from; `"rds308.fdd"` resolves to the built-in template |
| `romAlign` | no | ROM size alignment in bytes |
| `dependentProjectsDir` | no | Directory containing dependent `*.project.json` files |
| `cpu` | no | Target CPU: `"i8080"` (default) or `"z80"` |
| `settings` | no | Per-project emulator preferences (see below) |

**Emulator settings (nested):**

| Field | Description |
|-------|-------------|
| `speed` | Initial speed: `0.1`, `1`, `2`, `4`, `8`, or `"max"` |
| `viewMode` | `"border"` or `"noBorder"` |
| `ramDiskPath` | RAM disk image path for persistence |
| `ramDiskClearAfterRestart` | Clear RAM disk on restart |
| `fddIdx` | Floppy drive index (0–3) |
| `autoBoot` | Auto-boot FDD if `fddPath` is set |
| `fddReadOnly` | Open FDD in read-only mode |
| `romHotReload` | Live-patch ROM on save (see §5.6) |

**Project artifacts:**

| File | Description |
|------|-------------|
| `<name>.project.json` | Project configuration |
| `<name>.debug.json` | Debug metadata (tokens, labels, consts, breakpoints) |
| `<name>.rom` | Compiled ROM binary |
| `<name>.ram_disk.bin` | RAM disk image (8 × 256 KB) |
| `<name>.fdd` | Floppy disk image (820 KB) |

### 5.4 Compilation Pipeline

```
                    ┌─────────────┐
   .asm sources ──▶ │   v6asm     │ ──▶ .rom + .debug.json [+ .lst]
                    └─────────────┘
                           │
                    (if fddContentPath set)
                           ▼
                    ┌─────────────┐
   template.fdd ──▶ │   v6fdd     │ ──▶ .fdd
   + rom/bin files  └─────────────┘
```

1. The extension reads the active `.project.json`.
2. Spawns `v6asm` with the entry `asmPath`, `--output`, `--cpu`, and `--rom-align` flags derived from project settings.
3. On success, parses the generated `.debug.json` into memory for navigation, hover hints, and breakpoint address mapping.
4. If `fddContentPath` is set, spawns `v6fdd` with the template FDD and content directory to produce the `.fdd` image.
5. Diagnostics (errors, warnings) from `v6asm` are surfaced as VS Code Problems.

### 5.5 Emulator Integration

The emulator runs as a **webview panel** inside VS Code.

**Lifecycle:**

1. Extension spawns `v6emul --serve --rom <path> --load-addr <addr> [--speed <speed>] [--tcp-port <port>]`.
2. Extension connects to `127.0.0.1:<port>` via TCP.
3. Extension sends `DEBUG_ATTACH` to enable the debug subsystem.
4. Frame streaming loop: extension sends `GET_FRAME_RAW` at ~50 fps, receives raw ABGR pixel data (768 × 312 × 4 = 958,464 bytes per frame), and renders into the webview `<canvas>`.
5. Hardware stats are polled periodically via `GET_HW_MAIN_STATS` for speed %, palette state, and display mode.
6. On panel close or session end, extension sends `EXIT` command, which terminates `v6emul`.

**Webview panel contents:**

| Section | Description |
|---------|-------------|
| Debug toolbar | Run/Pause, Step Over, Step Into, Step Frame, Step 256, Restart, Speed dropdown, Clear RAM Disk toggle |
| Frame display | Rendered emulator frame (768 × 312 scaled to fill panel) |
| Hardware stats | Cycle count, raster position, frame number, display mode, speed %, palette |
| Memory dump | 16×16 hex dump tracking the current PC, with Follow PC toggle, address input, navigation buttons |

**Speed control** maps to `SET_CPU_SPEED` IPC command:

| UI Label | IPC value |
|----------|-----------|
| 0.1× | 0 (1%) |
| 1× | 3 (100%) |
| 2× | 4 (200%) |
| Max | 5 (max) |

### 5.6 Debug Features

The extension integrates with VS Code's standard debug interfaces.

#### Registers

CPU registers are exposed in the **Variables** / **Registers** panel during a debug session:

| Register | Description |
|----------|-------------|
| PC | Program Counter (16-bit) |
| SP | Stack Pointer (16-bit) |
| AF | Accumulator + Flags |
| BC, DE, HL | General-purpose register pairs |
| Flags | Z, S, P, CY, AC (individual flag bits) |

Retrieved via IPC command `GET_REGS` (cmd 11).

#### Breakpoints

- **Gutter breakpoints:** Click the left gutter in an `.asm` file to toggle breakpoints. The extension filters out non-meaningful lines (comments, directives like `.byte`, `.include`).
- **Breakpoints panel:** All active and disabled breakpoints appear in VS Code's BREAKPOINTS panel.
- **Live sync:** Adding, removing, or toggling breakpoints syncs immediately to the running emulator via `DEBUG_BREAKPOINT_ADD` / `DEBUG_BREAKPOINT_DEL` / `DEBUG_BREAKPOINT_SET_STATUS` IPC commands.
- **Address mapping:** The extension translates editor line numbers to memory addresses using the `.debug.json` metadata.

#### Watchpoints

Memory read/write monitoring via `DEBUG_WATCHPOINT_ADD` / `DEBUG_WATCHPOINT_DEL` commands.

#### Execution Control

| Action | VS Code mapping | IPC command |
|--------|----------------|-------------|
| Run / Continue | F5 / Play | `RUN` (1) |
| Pause | Pause | `STOP` (2) |
| Step Over | F10 | custom (runs until next instruction, honoring breakpoints) |
| Step Into | F11 | `EXECUTE_INSTR` (7) |
| Step Frame | — (toolbar button) | `EXECUTE_FRAME_NO_BREAKS` (9) |
| Step 256 | — (toolbar button) | 256 × `EXECUTE_INSTR` |
| Restart | Ctrl+Shift+F5 | `RESET` (5) or `RESTART` (6) |

#### Currently Executed Line Highlight

When execution pauses, the source line mapped to the current PC gets a translucent green highlight with hardware state annotations. If no source mapping exists, the last line is highlighted in yellow with the raw opcode.

#### Data Directive Highlighting

While paused, data directives (`DB`/`.byte`, `DW`/`.word`) are highlighted:
- **Blue** for memory reads
- **Red** for memory writes

Hovering shows the live memory value (hex + decimal) at that address from the paused emulator.

#### Hot Reload (`romHotReload`)

When enabled in project settings:

1. Saving any `.asm` file included in the project triggers a background recompilation (main project only).
2. The extension computes a memory diff between the old and new ROM.
3. The diff is applied as a patch via `SET_MEM` IPC commands.
4. The PC register is adjusted to maintain execution flow: the extension captures the PC and nearby labels (within 100 bytes) before recompilation, then after recompilation matches label addresses and adjusts the PC by the same offset.

### 5.7 Editor Helpers

| Feature | Trigger | Data Source |
|---------|---------|-------------|
| **Include navigation** | Ctrl+Click on `.include "path"` | File system path resolution |
| **Label/constant navigation** | Ctrl+Click on any label or constant | `.debug.json` metadata from last compilation |
| **Hover: label/constant values** | Mouse hover on label or constant | `.debug.json` (hex + decimal display) |
| **Hover: instruction opcodes** | Mouse hover on instruction mnemonic | Live emulator state (opcode bytes + decoded operands) |
| **Syntax highlighting** | Automatic for `ASM` language | TextMate grammar |
| **Breakpoint gutter** | Click gutter | `.debug.json` (meaningful lines only) |

---

## 6. IPC Protocol

Communication between the extension and `v6emul` uses **TCP loopback** with **length-prefixed MessagePack** framing.

### Wire Format

```
[4 bytes: uint32_t payload length, little-endian] [N bytes: MessagePack payload]
```

### Request

```json
{ "cmd": <int>, "data": { ... } }
```

### Response

```json
{ "ok": true, "data": { ... } }
```

Error response:

```json
{ "ok": false, "error": "description" }
```

### Command Categories

| Category | cmd range | Examples |
|----------|-----------|---------|
| Pseudo-commands (IPC layer) | negative | `PING` (−1), `GET_FRAME` (−3), `GET_FRAME_RAW` (−4) |
| Emulation control | 1–9, 42, 49 | `RUN`, `STOP`, `RESET`, `RESTART`, `EXECUTE_INSTR`, `SET_CPU_SPEED` |
| CPU state | 10–12 | `GET_CC`, `GET_REGS`, `GET_REG_PC` |
| Memory access | 13–18, 40–41 | `GET_BYTE_RAM`, `SET_MEM`, `GET_STACK_SAMPLE` |
| Display | 19, 27, 36–39 | `GET_DISPLAY_DATA`, `GET_SCROLL_VERT` |
| I/O & palette | 29–35 | `GET_IO_PORTS`, `GET_IO_PALETTE` |
| Memory mapping | 20–22, 44 | `GET_MEMORY_MAPPING`, `IS_MEMROM_ENABLED` |
| Hardware stats | 43 | `GET_HW_MAIN_STATS` |
| FDC / floppy | 23–25, 46–47 | `GET_FDC_INFO`, `LOAD_FDD`, `GET_FDD_IMAGE` |
| Keyboard | 45 | `KEY_HANDLING` |
| Debug: breakpoints | 58–66 | `DEBUG_BREAKPOINT_ADD`, `DEBUG_BREAKPOINT_GET_ALL` |
| Debug: watchpoints | 67–71 | `DEBUG_WATCHPOINT_ADD`, `DEBUG_WATCHPOINT_GET_ALL` |
| Debug: memory edits | 72–76 | `DEBUG_MEMORY_EDIT_ADD`, `DEBUG_MEMORY_EDIT_DEL` |
| Debug: code perf | 77–81 | `DEBUG_CODE_PERF_ADD`, `DEBUG_CODE_PERF_GET` |
| Debug: Lua scripts | 82–86 | `DEBUG_SCRIPT_ADD`, `DEBUG_SCRIPT_GET_ALL` |
| Debug: recorder | 52–58 | `DEBUG_RECORDER_RESET`, `DEBUG_RECORDER_PLAY_FORWARD` |
| Debug: trace log | 87–88 | `DEBUG_TRACE_LOG_ENABLE`, `DEBUG_TRACE_LOG_DISABLE` |
| Debug: other | 50–51 | `DEBUG_ATTACH`, `DEBUG_RESET` |

### GET_FRAME_RAW (High-Throughput Frame Streaming)

Bypasses MessagePack for performance:

```
[4 bytes: payloadLen] [4 bytes: width] [4 bytes: height] [payloadLen−8 bytes: raw ABGR pixels]
```

- 768 × 312 × 4 = 958,464 bytes per frame
- At 50 fps: ~48 MB/s (TCP loopback headroom: ~700 MB/s)

---

## 7. Bundled Resources

| Resource | Path | Description |
|----------|------|-------------|
| Extension icon | `res/images/icon.png` | VS Code marketplace and sidebar icon |
| TextMate grammar | `res/syntaxes/devector_8080.tmLanguage.json` | Syntax highlighting for 8080/Z80 assembly |
| Language config | `language-configuration.json` | Comment tokens and bracket pairs |
| Boot ROM (32 KB) | `res/boot/boot.bin` | Universal bootloader v4.5 by TIMSoft |
| Boot ROM (2 KB) | `res/boot/boots.bin` | Compact bootloader v3.0 by TIMSoft |
| Template FDD | `res/fdd/rds308.fdd` | Base floppy image used when `fddTemplatePath` contains `"rds308.fdd"` |

---

## 8. Build & Development

### Prerequisites

- **Node.js** (LTS)
- **npm**
- **TypeScript** (via npm)

### Compile the Extension

```pwsh
npm run compile
```

TypeScript config: `tsconfig.json` — targets ES2019, CommonJS modules, strict mode, source maps.

### Launch for Development

Select **Launch Extension** in the VS Code debug launch list and press **F5**. This opens a new Extension Development Host window with the extension loaded.

The launch configuration opens `temp/project` as the test workspace.

### Performance Profiling

Set environment variables in `.vscode/launch.json`:

```json
"env": {
  "VECTOR_PROFILE": "0",
  "VECTOR_PROFILE_RATE": "250"
}
```

---

## 9. Testing

### Extension Tests

```pwsh
npm run test            # all tests
npm run test-emulator   # i8080 CPU instruction tests
npm run test-directives # assembler directive tests
```

### Emulator Tests (C++)

Build and run via CMake:

```bash
cmake --build --preset release
ctest --test-dir build/release --build-config Release
```

Test suites: `cpu_tests`, `memory_tests`, `integration_tests`, `determinism_tests`, `ipc_tests`, `e2e_tests`, `golden_test_port`, `golden_test_arith`.

Golden tests run `v6emul --halt-exit` on test ROMs and compare stdout against expected output files.
