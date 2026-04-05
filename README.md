  # v6vscode

VS Code extension for **Vector-06c** development — project management, syntax highlighting, and emulator integration.

## Features

- **Syntax highlighting** for Intel 8080 assembly (`.asm`, `.inc` files)
- **Include navigation** — Ctrl+click on `.include "..."` directives to jump to the included file
- **Project system** — `*.project.json` files with schema validation and auto-completion
- **Commands** — `V6: Create Project`, `V6: Run Project` (emulator integration coming soon)

## Documentation

Full reference is in the [`docs/`](docs/README.md) folder:

- [CLI Usage](docs/cli.md) — arguments, options, output artifacts
- [Assembler Syntax](docs/syntax.md) — expressions, operators, literals, symbols
- [Directives](docs/directives.md) — `.org`, `.include`, `.if`, `.loop`, `.optional`, data emission, and more
- [Macros](docs/macros.md) — `.macro` / `.endmacro`, parameters, scoping
- [Listing Format](docs/listing.md) — `.lst` column layout and expansion behavior
- [Debug Symbols](docs/symbols.md) — `.symbols.json` schema, symbol types, and naming conventions

### Build from source

Requires the [Rust toolchain](https://rustup.rs/) (stable).

```bash
git clone https://github.com/parallelno/v6asm.git
cd v6asm
cargo build --release
```

## Tests

```bash
cargo test --workspace
```

## License

[MIT](LICENSE)
