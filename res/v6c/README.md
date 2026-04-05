# v6c

> C compiler for Intel 8080 (KR580VM80A).

## Quick Start

```bash
# compile → main.asm
v6c main.c

# assemble → main.rom // [New Releases](https://github.com/parallelno/v6asm/releases)
.\tools\v6asm main.asm

# Multi-file compilation with extra include path
v6c file1.c file2.c -o program.asm -i myheaders/

# print help
v6c -help
```


[![CI/CD](https://github.com/parallelno/v6c/actions/workflows/ci.yml/badge.svg)](https://github.com/parallelno/v6c/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

v6c is a C compiler written in Rust, targeting the Intel 8080 CPU.
It focuses on generating the fastest possible 8080 machine code
for a supported subset of the C language.

## Installation

Download the latest archive from [Releases](https://github.com/parallelno/v6c/releases), extract it, and add the directory to your `PATH`.

## Documentation

Full reference is in the [`docs/`](docs/README.md) folder:

- [User Guide](docs/user_guide.md) — Installation, CLI options, compilation workflow, C language support |
- [Type System](docs/type_system.md) — C types on the 8080 target, sizes, conversions, struct layout |
- [Standard Library](docs/stdlib.md) — C headers, runtime library functions, assembly implementations |
- [Calling Convention](docs/calling_convention.md) — Register passing, return values, global vs stack mode calling mechanics |
- [Inline Assembly](docs/inline_asm.md) — `asm { }` blocks, parameterized asm, full-body asm functions, clobber hints |
- [Architecture Overview](docs/architecture.md) — Compiler pipeline, module dependency graph, data flow |
- [Contributing Guide](docs/contributing.md) — Building from source, running tests, adding tests, project structure |

### Build from source

Requires the [Rust toolchain](https://rustup.rs/) (stable).

```bash
git clone https://github.com/parallelno/v6c.git
cd v6c
cargo build --release
```

## Tests

```bash
cargo test --workspace
```

## License

[MIT](LICENSE)
