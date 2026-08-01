# v6vscode

> VS Code extension for the **Vector-06c** (Вектор-06Ц) retro computer. Assemble, build, and run programs directly from the editor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Syntax highlighting** for Intel 8080 assembly (`.asm`, `.inc` files)
- **Include navigation** — Ctrl+click on `.include "..."` directives
- **V6: Create Project** — scaffolds a new project (source, Makefile, project config) with ASM/C and ROM/FDD options
- **V6: Run Project** — launches or hot-reloads the emulator, opens the display panel
- **v6emul tools view** — the `v6emul` Activity Bar container, also available through **View > Open View... > v6emul**, toggles Settings, Display, Hex Viewer, and Watchpoints editor panels
- **Display panel** — focused canvas display with keyboard forwarding; execution control stays in VS Code's debug toolbar
- **Emulator Settings panel** — changes and persists Speed and Display mode
- **Standalone Hex Viewer and Watchpoints** — full-size editor panels for memory inspection and watchpoint management
- **FPS counter** — live frames-per-second display in the status bar (bottom-right) while the emulator is running
- **FDD persistence** — automatically saves modified floppy disk images back to disk on stop (unless `fddReadOnly` is set)

## Quick Start

1. Install the extension from a `.vsix` file: `code --install-extension v6vscode-0.1.0.vsix`
2. Open a folder in VS Code.
3. Run **V6: Create Project** from the Command Palette (`Ctrl+Shift+P`).
4. Enter a project name, choose a language (ASM or C), and an executable type (ROM or FDD).
5. Build: `make` in the terminal.
6. Run **V6: Run Project** — the emulator launches and shows the display panel.

## Prerequisites

The extension no longer bundles any binary. The following tools must be installed separately:

| Tool | Purpose | Download |
|------|---------|----------|
| `v6emul` | Vector-06c emulator | [Releases](https://github.com/parallelno/v6emul/releases) |
| `v6asm` | Intel 8080 assembler | [Releases](https://github.com/parallelno/v6asm/releases) |
| `v6fdd` | FDD image builder | [Releases](https://github.com/parallelno/v6asm/releases) |
| `v6c` | C compiler (optional) | [Releases](https://github.com/parallelno/v6c/releases) |

After downloading, tell the extension where to find them using **one** of these methods (checked in order):

1. **VS Code setting** — set `v6.emulatorPath`, `v6.assemblerPath`, and `v6.fddToolPath` in workspace or user settings.
2. **Environment variable** — set `V6EMUL`, `V6ASM`, and `V6FDD`. `V6ASM`/`V6FDD` also control `make` because generated Makefiles use `V6ASM ?= v6asm`.
3. **PATH** — add the tools to your system `PATH` so they can be found automatically.

## Commands

| Command | Description |
|---------|-------------|
| `V6: Create Project` | Scaffold a new Vector-06c project |
| `V6: Run Project` | Build → launch → display emulator |
| `v6emul: Settings` | Toggle emulator settings |
| `v6emul: Display` | Toggle emulator display |
| `v6emul: Hex Viewer` | Toggle the standalone memory viewer |
| `v6emul: Watchpoints` | Toggle the standalone watchpoint editor |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Path to `v6emul` (overrides `V6EMUL` env var and PATH) |
| `v6.assemblerPath` | string | `""` | Path to `v6asm` (overrides `V6ASM` env var and PATH) |
| `v6.fddToolPath` | string | `""` | Path to `v6fdd` (overrides `V6FDD` env var and PATH) |
| `v6.logLevel` | enum | `"info"` | Logging level: error, warn, info, debug |

## Project File

Each project is defined by a `*.project.json` file at the workspace root:

```json
{
  "name": "demo",
  "run": {
    "executable": "out/demo.rom",
    "speed": "100%",
    "viewMode": "borderless"
  }
}
```

See [docs/README.md](docs/README.md) for the full schema and architecture details.

## Building from Source

```bash
npm install
npm run compile
```

### Packaging

```bash
npm run package          # produces v6vscode-<version>.vsix
```

## Tests

```bash
npm test                 # unit tests
npm run test:unit        # unit tests only
npm run test:regression  # regression suite
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

## License

[MIT](LICENSE)
