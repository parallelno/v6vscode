# BS Code Extension

This repository contains a VS Code extension with key features: a two-pass Intel 8080/Z80 assembler, a Vector 06c emulator, and a debugger, along with quality of life VS Code functionality to improve the Vector 06c development process.

## Quick Start

- Open the project folder in VS Code.
- Run **Devector: Create Project** command or a context menu in Explorer to create a new Vector 06c template project.
- Build with **Devector: Compile Project** command or a context menu in Explorer.
- Press **F5** to launch and debug in the emulator or the **Run Project (F5)** command or a context menu in Explorer.

Tips:
- If the emulator panel was closed, you may be prompted for the RAM disk image path.
- With multiple projects, **Devector: Compile Project** and **F5** will ask which project to build/run.

## Compile options

- **Devector: Compile Project** extension command compiles only the main project (no dependencies).
- **Devector: Compile Dependencies** extension command compiles only the projects found in `dependentProjectsDir`, skipping the main project.
- The `Compile and Run` launch config mirrors this: it builds the main project only, while `Compile Dependencies` is available as a separate launch entry for dependency-only builds.

## Context menu in Explorer

- Right-click in the Explorer to access **Devector: Create Project**, **Compile Project**, **Compile Dependencies**, and **Run Project (F5)**. These mirror the command palette entries but are quicker when you are already browsing project files.

## Project Artifacts

- `<project_name>.project.json` — project settings.
- `<project_name>.debug.json` — debug metadata (tokens, labels, consts, breakpoints).
- `<project_name>.rom` — Vector 06c executable loaded by the emulator.
- `<project_name>.ram_disk.bin` — RAM disk image (all eight supported disks).
- `<name>.fdd` — floppy disk image (usually 820 KB). Add `"fddPath": "./out/<your_fdd_name>.fdd"` to settings to auto-load it on the next run.
  - If `fddContentPath` project setting is set, a new FDD image is rebuilt at `fddPath` on each successful ROM compile using that folder’s files (recursively).

## Project Configuration

All projects start with creating a `.project.json` file that declares the project name, entry ASM file, output ROM path, and any optional emulator settings. It's an entry point for all extention command. Generate a fresh project file with **Devector: Create Project**.

### Example `.project.json`

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
  "settings": {
    "speed": "max",
    "viewMode": "noBorder",
    "ramDiskPath": "out\\prg.ram_disk.bin"
  }
}
```

### Fields

- **name**: Project name.
- **asmPath**: Entry assembly file to compile (e.g., `prg_main.asm`).
- **debugPath**: (Optional) Path for the generated debug metadata (e.g., `prg.debug.json`).
- **romPath**: (Optional) Output ROM path (e.g., `out\\prg.rom`).
- **fddPath**: (Optional) FDD image to boot; takes precedence over `romPath` when valid.
- **fddContentPath**: (Optional) Folder whose files are packed into a fresh FDD image at `fddPath` after each successful ROM compile. Paths are resolved relative to the project file unless absolute; files are added recursively.
- **fddTemplatePath**: (Optional) Template FDD image to start from when building the output at `fddPath`. If it contains the `"rds308.fdd"` string, the built-in template (comes with this extension) is used; other values resolve relative to the project file unless absolute.
- **romAlign**: Optional ROM size alignment in bytes (e.g., `2` to force even length).
- **dependentProjectsDir**: (Optional) Directory containing dependent `*.project.json` files. Paths resolved relative to the current project file unless absolute. Use **Devector: Compile Dependencies** command or a context menu in Explorer to compile every `*.project.json` in that directory in alphabetical order.
- **cpu**: (Optional) Target CPU for the assembler: `"i8080"` (default) or `"z80"`. Z80 mode accepts only the i8080-compatible subset of Z80 mnemonics (e.g., `LD`, `ADD A,`, `JP`, `CALL`, port I/O forms like `OUT (N),A`). IX/IY and other Z80-only extensions are intentionally not supported.
- **settings**: (Optional) Per-project emulator preferences (see below).

### Settings

- **speed**: (Optional) Initial emulation speed (`0.1`, `1`, `2`, `4`, `8`, or `"max"`). `"max"` removes frame pacing. video/audio quality degrade in favor of performance.
- **viewMode**: (Optional) Emulator viewport mode (`"border"`, `"noBorder"`).
- **ramDiskPath**: (Optional) RAM disk image path for persistence across emulator restarts.
- **ramDiskClearAfterRestart**: (Optional) Clear RAM disk data on emulator restart.
- **fddIdx**: (Optional): Floppy drive index to load fdd (0-3).
- **autoBoot**: (Optional): Automatically boot FDD if pfddPath is set.
- **fddReadOnly**: (Optional): Open FDD in read-only mode.
- **romHotReload**: (Optional): When `true`, saving any included `.asm` file triggers a background recompilation of the main project (excluding `dependentProjectsDir`) and applies a memory diff patch. The system automatically adjusts the PC (Program Counter) register to maintain execution flow: it captures the PC and nearby labels (within 100 bytes) before recompilation, then after recompilation, it matches label addresses and adjusts the PC by the same offset to preserve the execution position. This helps prevent disruption when code before the execution point changes size.


## VS Code editor helpers

The bundled extension exposes a veriaty quality-of-life helpers whenever you edit `.asm` sources in VS Code:

- **Navigation for includes**: hold `Ctrl` (or `Cmd` on macOS) to underline the path in the ASM '.include' directive, any label or a constant and click it to open the target file.
- **Navigation for consts and global labels**: hold `Ctrl` (or `Cmd` on macOS) to underline the constant or any label and click it to open navigate it. Please keep in mind it uses the debug metadata gathered from the last compilation. If you don't get the navigation, compile the project.
- **Syntax highlight**: ASM code uses a refined, color scheme inspired by the Retor-Assembler that cleanly differentiates constants, labels, instructions, and comments, making long sessions easier on the eyes and faster to parse. Make sure you select the **ASM** language in the bottom panel.
- **Breakpoint handling**: Click the left gutter to toggle breakpoints. All active and disabled breakpoints appear in the **BREAKPOINTS** panel. Adding breakpoints in the editor available only within the **ASM** language that comes with this extension. Make sure it is selected in the bottom panel. Breakpoint gutter respects only meaningful lines (labels/instructions) and ignores comments, .byte, .include, etc.

## Emulator panel controls

This is the emulator main panel. You will see it when you start the emulation pressing F5 or with **Run Project (F5)** and chosing one of the available launch configuration. That panel includes the debug toolbar, a rendered frame, hardware statistics, and the memory dump. It provides realtime data to monitor execution, memory, and performance while you debug.

### Debug Toobar

The execution flow can be controlled via the standard VS Code debug toolbar as well as the extended toolbar in the emulator panel:

- **Run / Pause**: to pause and continue the hardware simulation.
- **Step Over**: it runs until the next instruction completes helping to step over the subroutines or conditional branches but honoring breakpoints along the path.
- **Step Into**: a classic single-instruction step, halting immediately after execution.
- **Step Out**: a placeholder. Not implemented yet.
- **Step Frame**: stops the emulator, runs one full frame with no breaks, and leaves execution paused for inspection.
- **Step 256**: runs 256 single-instruction steps in succession so you can advance through short loops faster without resuming full speed.
- **Restart**: stops the hardware, resets/restarts the HW and loads and runs the ROM or FDD image depending on the availability.
- **Speed**: dropdown allows you to control the emulation speed with the following options:
  - **0.1x** - Run at 1/10th normal speed (slow motion for debugging)
  - **1x** - Normal speed (default, 60 FPS)
  - **2x** - 2x normal speed
  - **4x** - 4x normal speed
  - **8x** - 8x normal speed
  - **Max** - Run as fast as possible with no frame delay (video and audio quality degrade in favor of performance)
- **Clear RAM Disk After Restart**: empties the RAM disk memory every restart. Convinient for testing.

## Extra VS Code editor helpers
Additional editor helpers are available while debugging is paused.

### Hover hints on labels/consts showing current values
When you hover over any label or named constant in an `.asm` file, the extension shows a tooltip with both the hexadecimal and decimal value. The hint data comes directly from the ROM’s `.debug.json` metadata, so it works for symbols introduced through `.include` chains as well. This is handy for confirming the current address/value of a label without opening the token file or dumping registers.

### Instruction hover shows opcode bytes and decoded operands
When you hover over an assembled instruction (the mnemonic and register portion of the line—not the immediate literal) the extension reads the underlying opcode bytes from the paused emulator, disassembles the operands, and shows the resolved value alongside the backing memory bytes. Example:

### Currently executed line highlight
When execution pauses, the executing code line in the editor receives a translucent green highlight with a HW states. If no source mapping is available, the debugger highlights the last line in yellow printing the opcode executed.

### Data directives highlight reads/writes with tooltips for live memory.
Data directives (`DB`/`.byte`, `DW`/`.word`). The specific values are highlighted while paused (blue for reads, red for writes). Hovering a highlighted value shows the live memory at that address (hex + decimal) from the paused emulator.

### Live breakpoints synced to the paused emulator
Adding, removing, or toggling breakpoints in the open ASM file syncs immediately to the running emulator.

## Memory Dump panel
The emulator view now embeds a **Memory Dump** panel under the frame preview. It streams a 16x16 hexdump that automatically tracks the current PC (both the hex bytes and ASCII column highlight the byte that will execute next). Uncheck **Follow PC** to freeze the window on a specific address, type any hex/decimal start value, or use the +/-0x10 and +/-0x100 buttons plus **Refresh** to nudge through RAM manually.

## Dev's Pit

### Using VSC devcontainers

For dev container setup and usage see the dedicated file: [.devcontainer/README.md](.devcontainer/README.md)

### How to Compile this Extentsion

- Compile TypeScript:

```pwsh
npm run compile
```

### How to Test the extension in the VS Code

- Select the `Launch Extension` in the debug launch list and press F5

### Tests Suits

To run all tests:
```pwsh
npm run test
```

#### Exclusive Tests

* i8080 CPU test:

```pwsh
npm run test-emulator
```
Or launch the `npm: test-emulator` config.

* Assembler Directive Tests:
```pwsh
npm run test-directives
```
Or launch the `npm: test-directives` config.

### Performance Profiling

You can print per-frame timing breakdowns from the emulator and extension by enabling the built-in profiler via environment variables (e.g., in `.vscode/launch.json` under `env`):

```jsonc
  "configurations": [
    {
      "name": "Launch Extension",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "preLaunchTask": "npm: compile",
      "env": {
        "VECTOR_PROFILE": "0",
        "VECTOR_PROFILE_RATE": "250"
      },
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "${workspaceFolder}/temp/project"
      ]
    },
```

- `VECTOR_PROFILE`: set to `1` to enable logging. Leave at `0` (default) to disable.
- `VECTOR_PROFILE_RATE`: sampling stride for instruction-level timing. Smaller numbers sample more often (e.g., `64`), larger numbers (e.g., `500`) reduce sampling overhead but make per-bucket estimates coarser.
- (Optional) `VECTOR_PROFILE_REPORT`: frames between log lines; defaults to `50` when unset.

When enabled, the console prints lines like `f=740ms ohead=12ms disp=... cpu=... aud=... dbg=...`, where `ohead` approximates time spent outside the emulated instruction execution (extension/UI overhead) for that reporting window.

## Tools

### FDD utility CLI

The FDD utility tool is a command-line tool that reads and writes FDD images, and adds files to the image. It is useful for creating custom FDD images for the Vector 06c emulator.

```pwsh
npm run compile # make sure out/tools/fddutil.js exists
node .\out\tools\fddutil.js -h
node .\out\tools\fddutil.js -r .\res\fdd\rds308.fdd -i file1.com -i file2.dat -o mydisk.fdd
```

Key switches:

- `-t <file>` optional template disk image (Commonly FDD image with a boot sector and the OS of your choice).
- `-i <file>` adds a host file into the image; repeat the flag for each additional file.
- `-o <file>` writes the resulting `.fdd` image.
- `-h` prints the usage summary.


Options:
- `--input <file>` (required) path to the `.asm` source.
- `--output <file>` (required) path to write the assembled ROM.
- `--debug <file>` optional path for the `.debug.json` metadata.
- `--origin <addr>` optional start address (`.org`) override in decimal, `0x`, or `$` hex.
- `--encoding <ascii|screencodecommodore>` optional default `.encoding` for `.text`.
- `--case <mixed|lower|upper>` optional case mode for screencode/ASCII.
- `--printTokens` optional flag to dump labels and constants to stdout after assembly.
- `-h`, `--help` show usage.