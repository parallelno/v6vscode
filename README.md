# v6vscode

> VS Code extension for the **Vector-06c** (Вектор-06Ц) retro computer. Assemble, build, and run programs directly from the editor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Syntax highlighting** for Intel 8080 assembly (`.asm`, `.inc` files)
- **Include navigation** — Ctrl+click on `.include "..."` directives
- **V6: Create Project** — scaffolds a new project (source, Makefile, project config) with ASM/C and ROM/FDD options
- **V6: Run Project** — launches or hot-reloads the emulator, opens the display panel
- **v6emul tools view** — the `v6emul` Activity Bar container, also available through **View > Open View... > v6emul**, toggles Settings, Display, Hex Viewer, Memory Edits, Performance, Trace Log, Scripts, Symbols, Ports, and Watchpoints editor panels
- **Display panel** — focused canvas display with keyboard forwarding; execution control stays in VS Code's debug toolbar
- **Emulator Settings panel** — changes and persists Speed and Display mode
- **Standalone debug tools** — full-size Hex Viewer, Memory Edits, Performance, Trace Log, Scripts, Symbols, Ports, and Watchpoints editor panels
- **FPS counter** — live frames-per-second display in the status bar (bottom-right) while the emulator is running
- **FDD persistence** — automatically saves modified floppy disk images back to disk on stop (unless `fddReadOnly` is set)

## Quick Start

1. Install the extension
2. Open a folder in VS Code.
3. Run **V6: Create Project** from the Command Palette (`Ctrl+Shift+P`).
4. Enter a project name, choose a language (ASM or C), and an executable type (ROM or FDD).
5. Build: `make` in the terminal.
6. Run **V6: Run Project** — the emulator launches and shows the display panel.

## Prerequisites

The following tools must be installed separately:

| Tool | Purpose | Download |
|------|---------|----------|
| `v6emul` | Vector-06c emulator | [Releases](https://github.com/parallelno/v6emul/releases) |
| `v6asm` (Optional) | Intel 8080 assembler | [Releases](https://github.com/parallelno/v6asm/releases) |
| `v6fdd` (Optional) | FDD image builder | [Releases](https://github.com/parallelno/v6asm/releases) |
| `v6clang` (Optional) | C compiler | [Releases](https://github.com/parallelno/v6clang/releases) |

- Set `V6EMUL` env var to the full path of the executable.
- (Optional) Set `V6ASM` env var to the full path of the executable.
- (Optional) Set `V6FDD` env var to the full path of the executable.
- (Optional) Set `V6CLANG` env var to the full path of the executable.

`v6asm`, `v6fdd`, `v6clang` and corresponding env var setup only required by the teplate Makefiles.
These tools enables entended debugging funtionality in this entention.

## Commands

| Command | Description |
|---------|-------------|
| `V6: Create Project` | Scaffold a new Vector-06c project |
| `V6: Run Project` | Build → launch → display emulator |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `v6.logLevel` | enum | `"info"` | Logging level: error, warn, info, debug |

## Project File

Each project is defined by a `*.project.json` file at the workspace root:

```json
{
  "name": "demo",
  "run": {
    "executable": "out/demo.rom",
    "debugArtifact": "out/demo.elf",
    "speed": "100%",
    "viewMode": "borderless"
  }
}
```

Generated C projects use `-O0 -g` and create this companion ELF for source-level C debugging. See [docs/README.md](docs/README.md) for the full schema, supported C metadata, and architecture details.

## Building from Source

```bash
npm install
npm run compile
```

## Documentation

Full developer documentation is in [`docs/`](docs/README.md):

- [Architecture](docs/architecture.md) — platform layer, configuration, entry point
- [Project System](docs/project-system.md) — discovery, parsing, validation, `*.project.json` schema
- [Language Support](docs/language-support.md) — syntax highlighting, include navigation
- [Emulator](docs/emulator.md) — launcher, IPC protocol, lifecycle, webview panel
- [Commands](docs/commands.md) — Create Project, Run Project, FDD persistence
- [Settings and Error UX](docs/settings.md) — configuration, error notifications
- [Development](docs/development.md) — building, packaging, testing
- [Publishing](docs/publishing.md) — accounts, Entra ID setup, release gates, and the publish script

## License

[MIT](LICENSE)
