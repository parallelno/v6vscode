# v6c Documentation Hub

**v6c** is a C compiler written in Rust targeting the Intel 8080 CPU, designed for the Vector 06C computer. It prioritizes generating the fastest possible 8080 machine code for a supported C subset.

> **Version:** 0.1.0 | **Language:** Rust 2021 edition | **Target:** Intel 8080 / Vector 06C | **Assembler:** [v6asm](https://github.com/parallelno/v6asm)

---

## Table of Contents

### Core Documentation

| # | Document | Description |
|---|----------|-------------|
| 1 | [Architecture Overview](architecture.md) | Compiler pipeline, module dependency graph, data flow |
| 2 | [User Guide](user_guide.md) | Installation, CLI options, compilation workflow, C language support |
| 3 | [Lexer & Preprocessor](lexer_preprocessor.md) | Tokenization, C preprocessor, macro expansion |
| 4 | [Parser & AST](parser_ast.md) | Recursive-descent parser, AST node definitions, supported C grammar |
| 5 | [Type System](type_system.md) | C types on the 8080 target, sizes, conversions, struct layout |
| 6 | [IR Design](ir.md) | Three-address code IR, virtual registers, width tags, instruction set |
| 7 | [IR Optimization Passes](ir_optimization.md) | All optimization passes: constant folding, DCE, CSE, inlining, loop optimizations, etc. |
| 8 | [Call Graph & Memory Model](callgraph_memory.md) | Static allocation, call-graph analysis, global vs stack mode, function effects |
| 9 | [Code Generator](codegen.md) | IR → 8080 assembly translation, pattern matching, instruction selection |
| 10 | [Register Allocator](regalloc.md) | Demand-driven register allocation, spill/reload, rematerialization |
| 11 | [Peephole Optimizer](peephole.md) | Assembly-level pattern-matched rewriting rules |
| 12 | [Emitter & Runtime](emitter_runtime.md) | Assembly output, listing generation, CRT0, runtime library routines |
| 13 | [Calling Convention](calling_convention.md) | Register passing, return values, global vs stack mode calling mechanics |
| 14 | [Inline Assembly](inline_asm.md) | `asm { }` blocks, parameterized asm, full-body asm functions, clobber hints |
| 15 | [Standard Library](stdlib.md) | C headers, runtime library functions, assembly implementations |
| 16 | [Testing](testing.md) | Test pipeline, unit tests, execution tests, benchmarks, test harness |
| 17 | [Contributing Guide](contributing.md) | Building from source, running tests, adding tests, project structure |

### Design Documents

| # | Document | Description |
|---|----------|-------------|
| 18 | [Project Plan](design/plan.md) | Master plan: audit, design decisions, implementation phases, performance targets |
| 19 | [Inline Assembly Design](design/design_inline_asm.md) | Full design specification for inline assembly support |
| 20 | [Inline Assembly Examples](design/design_inline_asm_examples.md) | Clobber hint examples and overhead comparison |
| 21 | [Execution Test Plan](design/plan_execution_tests_2026-03-31.md) | Plan for v6emul-based ROM execution verification |
| 22 | [Optimization Unit Test Plan](design/plan_optimization_unit_tests_2026-03-27.md) | Policy and coverage matrix for optimization unit tests |

### Future / Planned Work

| # | Document | Description | Status |
|---|----------|-------------|--------|
| 23 | [Optimization Improvement Plan](design/future_designs/plan_optimization_2026-03-27.md) | Prioritized roadmap for c8080-inspired optimizations | **Planned** |
| 24 | [Optimization Report](design/future_designs/report_optimization_2026-03-30.md) | Detailed analysis of generated code with 15 improvement proposals | **Planned** |

---

## Quick Reference

### Compiler Pipeline

```
Source (.c) → Preprocessor → Lexer → Parser → AST → IR Gen → IR Optimizer → Call Graph → Code Gen → Peephole → Emitter → Assembly (.asm)
```

### Project Layout

```
v6c/
├── src/                    # Compiler source (Rust, ~25k lines)
│   ├── main.rs             # Driver, CLI, pipeline orchestration
│   ├── lexer.rs            # Tokenizer
│   ├── preproc.rs          # C preprocessor
│   ├── parser.rs           # Recursive-descent parser → AST
│   ├── ast.rs              # AST node definitions
│   ├── types.rs            # Type system
│   ├── ir.rs               # IR definitions
│   ├── ir_gen.rs           # AST → IR lowering
│   ├── ir_opt.rs           # IR optimization passes
│   ├── callgraph.rs        # Call-graph analysis, static allocation
│   ├── codegen.rs          # IR → 8080 assembly
│   ├── regalloc.rs         # Register allocator
│   ├── peephole.rs         # Peephole optimizer
│   ├── emit.rs             # Assembly text emitter
│   └── runtime.rs          # Runtime library embedding
├── runtime/                # Hand-written 8080 assembly runtime (~3.3k lines)
├── include/                # C standard library headers
├── tests/                  # Integration tests & benchmarks
│   ├── unit/               # Per-feature C test files
│   ├── sieve.c             # Sieve of Eratosthenes benchmark
│   ├── dhrystone.c         # Dhrystone benchmark
│   └── fannkuch.c          # Fannkuch benchmark
├── tools/                  # External tools (v6asm, v6emul, c8080)
├── scripts/                # Test harness scripts
└── docs/                   # This documentation
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Static allocation (global mode) as default | Eliminates ~20 cycles/variable access on 8080 (no frame pointer) |
| Register calling convention | First args in HL/DE/A; avoids memory round-trips |
| Three-address code IR | Enables standard optimization passes |
| Assembly runtime library | 2–4× speedup for math-heavy code vs C-implemented libraries |
| Peephole optimizer on assembly | High value, low complexity |
| Zero external dependencies | Pure Rust, no crates |
