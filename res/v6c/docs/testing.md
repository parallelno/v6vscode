# Testing

v6c has a multi-layered testing strategy: Rust integration tests, standalone C test files compiled by comparison scripts, and benchmark programs.

## Test Pipeline

```
source.c ──v6c──► source.asm ──v6asm──► source.rom ──v6emul──► result
    │                  │                     │                    │
 compile           assemble              execute              verify
 (Rust tests)      (v6asm.exe)          (v6emul.exe)        (HL == 0)
```

> **Full execution test plan:** [design/plan_execution_tests_2026-03-31.md](design/plan_execution_tests_2026-03-31.md)

## Test Convention

Test C programs communicate results via `main()` return value:
- `return 0` → all checks passed
- `return N` → check number N failed

The v6emul emulator's `--halt-exit --dump-cpu` mode prints the HL register on halt. The test harness parses `H=XX L=XX` and asserts `HL == 0x0000`.

## Rust Integration Tests

Located in [tests/](../tests/):

### `execution.rs`

End-to-end execution pipeline:
1. Discovers all `.c` files under test directories
2. Compiles with v6c → `.asm`
3. Assembles with v6asm → `.rom`
4. Executes with v6emul (`--halt-exit --dump-cpu --run-cycles 1000000`)
5. Parses CPU dump output
6. Asserts `HL == 0`

### `asm_inline.rs`

Tests inline assembly features:
1. Compiles each `.c` file under `tests/unit/asm/<subfolder>/`
2. Validates with v6asm (assembly succeeds)
3. Checks for expected assembly patterns in output (e.g., `DAD D` in add)

Covers 5 categories across 23 test files:
- `full_body/` — Full-body asm functions (8 tests)
- `loop/` — Asm in loops (4 tests)
- `param/` — Parameterized asm blocks (5 tests)
- `raw/` — Raw asm blocks (4 tests)
- `selfmod/` — Self-modifying code patterns (2 tests)

### `optimization_small.rs`

Wrapper that invokes the PowerShell optimization test script:
```rust
scripts/run_optimization_unit_checks.ps1 -UseSmall
```

## Unit Test Files

### Arithmetic & Control Flow

| File | Tests |
|------|-------|
| [tests/unit/arith.c](../tests/unit/arith.c) | Basic `add` and `mul` functions |
| [tests/unit/loop.c](../tests/unit/loop.c) | `while` and `for` loops (sum 1..10 = 55) |

### Optimization Tests

Located in [tests/unit/optimization/](../tests/unit/optimization/) — 15 C files covering every optimization pass:

| File | Optimization Tested |
|------|-------------------|
| `opt_ir_const_fold.c` | Constant folding & propagation |
| `opt_ir_lsf.c` | Load/store forwarding |
| `opt_ir_narrow.c` | Byte narrowing |
| `opt_ir_strength.c` | Strength reduction |
| `opt_ir_dce.c` | Dead-code elimination |
| `opt_ir_cse.c` | Common sub-expression elimination |
| `opt_ir_jump_thread.c` | Jump threading |
| `opt_ir_loop.c` | Loop invariant code motion, induction vars, unrolling |
| `opt_ir_inline_specialize.c` | Function inlining & specialization |
| `opt_codegen_compact_cfg.c` | CFG compaction (jump chains, jump-to-next-label) |
| `opt_codegen_fastpaths.c` | Codegen fast paths (mul by 0/1/2/3/4/8, div by 1, etc.) |
| `opt_regalloc_pressure.c` | Register allocation under pressure |
| `opt_peephole_ctrl.c` | Peephole control-flow rules |
| `opt_peephole_data.c` | Peephole data-movement rules |
| `opt_pipeline_mixed.c` | Combined pass interaction |

> **Coverage matrix:** [design/plan_optimization_unit_tests_2026-03-27.md](design/plan_optimization_unit_tests_2026-03-27.md)

Each test file follows this structure:
1. One `main(void)` function
2. Global output variables for post-build inspection
3. Positive, negative, and safety test cases
4. Deterministic constants (no UB)

### Small Optimization Tests

Located in [tests/unit/optimization_small/](../tests/unit/optimization_small/) — 12 smaller C files for lightweight checking:

`opt_small_const_fold.c`, `opt_small_cse.c`, `opt_small_curly_cfg_compact.c`, `opt_small_dead_branch.c`, `opt_small_dead_store_elimination.c`, `opt_small_empty.c`, `opt_small_inline_specialize.c`, `opt_small_jump_thread.c`, `opt_small_loop_unroll.c`, `opt_small_narrowing.c`, `opt_small_remove_redundant_moves.c`, `opt_small_strength_reduction.c`

### Inline Assembly Tests

Located in [tests/unit/asm/](../tests/unit/asm/) — 23 C files across 5 subdirectories (see `asm_inline.rs` above).

## Benchmarks

| Benchmark | File | Description |
|-----------|------|-------------|
| Sieve of Eratosthenes | [tests/sieve.c](../tests/sieve.c) | Primes up to 8190; Phase 1 end-to-end test |
| Dhrystone | [tests/dhrystone.c](../tests/dhrystone.c) | Integer benchmark: arithmetic, comparisons, function calls |
| Fannkuch | [tests/fannkuch.c](../tests/fannkuch.c) | Permutation benchmark: array manipulation |

## Test Harness Script

[scripts/run_optimization_unit_checks.ps1](../scripts/run_optimization_unit_checks.ps1) (~259 lines):

### Parameters

| Flag | Description |
|------|-------------|
| `-Filter` | Run only tests matching a pattern |
| `-RequireV6asm` | Fail if v6asm is not available |
| `-AllowAsmFailure` | Don't fail on assembly errors |
| `-UseSmall` | Use `optimization_small/` directory instead |
| `-RunExecution` | Execute ROMs with v6emul after assembly |
| `-RunCycles` | Cycle limit for v6emul execution |

### Pipeline Per Test

1. Validate C source has `int main(...)` and `return`
2. Compile: `cargo run -- <file> -o <asm> --lst <lst>`
3. Validate `.asm` has `.ORG` and `HLT`
4. (Optional) Assemble with v6asm
5. (Optional) Execute with v6emul, parse HL register

### Output

Reports per-test pass/fail with summary:
```
[PASS] opt_small_const_fold.c     Compiled | Assembled | Executed (HL=0000)
[FAIL] opt_small_broken.c         Compiled | Assembled | Executed (HL=0003)
```

## External Tools

All tools are pre-built executables in the [tools/](../tools/) directory:

| Tool | Path | Purpose |
|------|------|---------|
| v6asm | `tools/v6asm/v6asm.exe` | Intel 8080 assembler for Vector 06C |
| v6emul | `tools/v6emul/v6emul.exe` | Vector 06C emulator (headless test mode) |
| c8080 | `tools/c8080/c8080.exe` | Reference C compiler (for comparison) |

The test runner checks for tool availability and skips steps with warnings if a tool is missing.
