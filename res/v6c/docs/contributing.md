# Contributing Guide

## Building from Source

```bash
cargo build --release
```

- **Edition:** Rust 2021
- **Dependencies:** None (pure Rust, zero crates)
- **Binary:** `target/release/v6c.exe` (Windows) or `target/release/v6c` (Linux/macOS)

## Project Structure

```
v6c/
├── src/                    # Compiler source (~25k lines Rust)
│   ├── main.rs             # Driver, CLI, pipeline orchestration
│   ├── lexer.rs            # Tokenizer
│   ├── preproc.rs          # C preprocessor
│   ├── parser.rs           # Recursive-descent parser → AST
│   ├── ast.rs              # AST node definitions
│   ├── types.rs            # Type system
│   ├── ir.rs               # IR definitions
│   ├── ir_gen.rs           # AST → IR lowering
│   ├── ir_opt.rs           # IR optimization passes (largest module)
│   ├── callgraph.rs        # Call-graph analysis, static allocation
│   ├── codegen.rs          # IR → 8080 assembly
│   ├── regalloc.rs         # Register allocator
│   ├── peephole.rs         # Peephole optimizer
│   ├── emit.rs             # Assembly text emitter
│   └── runtime.rs          # Runtime library embedding
├── runtime/                # Hand-written 8080 assembly runtime (~3.3k lines)
├── include/                # C standard library headers
├── tests/                  # Integration tests & benchmarks
├── tools/                  # External tools (v6asm, v6emul, c8080)
├── scripts/                # Test harness scripts
└── docs/                   # Documentation
```

See [Architecture Overview](architecture.md) for the compilation pipeline and module dependency graph.

## Running Tests

### Rust Integration Tests

```bash
# Run all tests
cargo test

# Run specific test suites
cargo test --test execution          # end-to-end ROM execution
cargo test --test asm_inline         # inline assembly tests
cargo test --test optimization_small # small optimization checks
```

### Optimization Unit Checks (PowerShell)

```powershell
# Full optimization test suite
scripts/run_optimization_unit_checks.ps1

# Small/fast optimization checks
scripts/run_optimization_unit_checks.ps1 -UseSmall

# With ROM execution via v6emul
scripts/run_optimization_unit_checks.ps1 -RunExecution

# Filter to specific tests
scripts/run_optimization_unit_checks.ps1 -Filter "const_fold"
```

Script parameters:

| Flag | Description |
|------|-------------|
| `-Filter` | Run only tests matching a pattern |
| `-RequireV6asm` | Fail if v6asm is not available |
| `-AllowAsmFailure` | Don't fail on assembly errors |
| `-UseSmall` | Use `tests/unit/optimization_small/` directory |
| `-RunExecution` | Execute ROMs with v6emul after assembly |
| `-RunCycles` | Cycle limit for v6emul execution |

### Manual Test Pipeline

```bash
# Compile a test file
cargo run -- tests/unit/arith.c -o temp/arith.asm -l temp/arith.lst

# Assemble
tools/v6asm/v6asm.exe temp/arith.asm

# Execute and verify (HL=0000 means all checks passed)
tools/v6emul/v6emul.exe --rom temp/arith.rom --load-addr 0x100 --halt-exit --dump-cpu --run-cycles 1000000
```

## External Tools

Pre-built executables in the `tools/` directory:

| Tool | Path | Purpose |
|------|------|---------|
| v6asm | `tools/v6asm/v6asm.exe` | Intel 8080 assembler for Vector 06C |
| v6emul | `tools/v6emul/v6emul.exe` | Vector 06C emulator (headless test mode) |
| c8080 | `tools/c8080/c8080.exe` | Reference C compiler (for comparison) |

Tests skip tool-dependent steps with a warning if a tool is missing.

## Adding Tests

### Unit Tests (C files)

Test C programs communicate results via `main()` return value:
- `return 0` → all checks passed
- `return N` → check number N failed

```c
// tests/unit/example.c
int add(int a, int b) { return a + b; }

int main() {
    if (add(2, 3) != 5) return 1;
    if (add(-1, 1) != 0) return 2;
    return 0;
}
```

### Optimization Tests

Place in `tests/unit/optimization/` (one C file per optimization family). Follow the pattern:
- Global output variables for ASM inspection
- Positive cases (optimization should fire)
- Negative cases (optimization must not fire)
- Safety/edge cases

See [Testing](testing.md) for full coverage details.

### Inline Assembly Tests

Place in `tests/unit/asm/<category>/`. Existing categories: `full_body/`, `loop/`, `param/`, `raw/`, `selfmod/`.

## Benchmarks

| Benchmark | File | Purpose |
|-----------|------|---------|
| Sieve of Eratosthenes | `tests/sieve.c` | Loop-heavy, array access |
| Dhrystone | `tests/dhrystone.c` | Integer, function calls, branches |
| Fannkuch | `tests/fannkuch.c` | Array manipulation, permutations |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `V6C_OPT_PROFILE` | Optimization profile: `default` or `benchmark` |
