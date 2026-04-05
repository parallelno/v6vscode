# v6vscode

> VS Code extension for the **Vector-06c** (Вектор-06Ц) retro computer. Assemble, build, and run programs directly from the editor.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Syntax highlighting** for Intel 8080 assembly (`.asm`, `.inc` files)
- **Include navigation** — Ctrl+click on `.include "..."` directives
- **V6: Create Project** — scaffolds a new project (source, Makefile, project config) with ASM/C and ROM/FDD options
- **V6: Run Project** — launches or hot-reloads the emulator, opens the display panel
- **Emulator panel** — webview with canvas display, Run/Pause, Reset, Speed, Display Mode controls, keyboard forwarding
- **FDD persistence** — automatically saves modified floppy disk images back to disk on stop (unless `fddReadOnly` is set)

## Quick Start

1. Open a folder in VS Code.
2. Run **V6: Create Project** from the Command Palette (`Ctrl+Shift+P`).
3. Enter a project name, choose a language (ASM or C), and an executable type (ROM or FDD).
4. Build: `make` in the terminal.
5. Run **V6: Run Project** — the emulator launches and shows the display panel.

## Commands

| Command | Description |
|---------|-------------|
| `V6: Create Project` | Scaffold a new Vector-06c project |
| `V6: Run Project` | Build → launch → display emulator |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Override path to `v6emul` binary |
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

## Tests

```bash
npm test                 # unit tests
npm run test:unit        # unit tests only
npm run test:regression  # regression suite
```

## Documentation

Full developer documentation is in [`docs/`](docs/README.md).

## License

[MIT](LICENSE)
