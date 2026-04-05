# Architecture Overview

## Compiler Pipeline

v6c processes C source through a linear sequence of stages, each represented by a dedicated Rust module:

```
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│ Preproc   │─▶│  Lexer    │──▶│  Parser   │─▶│  IR Gen   │──▶│  IR Opt   │
│ preproc.rs│   │ lexer.rs  │   │ parser.rs │   │ ir_gen.rs │   │ ir_opt.rs │
└───────────┘   └───────────┘   └───────────┘   └───────────┘   └───────────┘
                                                                       │
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌────────────┐         │
│  Emitter  │◀──│ Peephole  │◀─│ Code Gen  │◀─│ Call Graph │◀────────┘
│  emit.rs  │   │peephole.rs│   │ codegen.rs│   │callgraph.rs│
└───────────┘   └───────────┘   └───────────┘   └────────────┘
      │
      ▼
  .asm / .lst
```

### Stage Summary

| Stage | Module | Input | Output | Lines |
|-------|--------|-------|--------|------:|
| Preprocessor | [preproc.rs](../src/preproc.rs) | Raw source text | Expanded source text | 2,242 |
| Lexer | [lexer.rs](../src/lexer.rs) | Expanded source text | `Vec<Token>` | 1,431 |
| Parser | [parser.rs](../src/parser.rs) | Token stream | `Program` (AST) | 3,081 |
| IR Generation | [ir_gen.rs](../src/ir_gen.rs) | AST `Program` | `IrProgram` | 2,901 |
| IR Optimization | [ir_opt.rs](../src/ir_opt.rs) | `IrProgram` (mutable) | `IrProgram` (optimized) | 4,661 |
| Call Graph Analysis | [callgraph.rs](../src/callgraph.rs) | `IrProgram` | `CallGraphAnalysis` | 1,089 |
| Code Generator | [codegen.rs](../src/codegen.rs) | `IrProgram` + `CallGraphAnalysis` | `Vec<String>` (asm lines) | 3,145 |
| Peephole Optimizer | [peephole.rs](../src/peephole.rs) | `Vec<String>` (asm lines) | `Vec<String>` (optimized) | 1,706 |
| Emitter | [emit.rs](../src/emit.rs) | Asm lines | `.asm` and `.lst` files | 725 |

**Total source:** ~24,900 lines of Rust across 15 modules.

## Module Dependency Graph

```
main.rs ───┬──▶ preproc.rs      (standalone)
           ├──▶ lexer.rs        (standalone)
           ├──▶ parser.rs  ───▶ ast.rs ──▶ types.rs
           │                ───▶ lexer.rs
           ├──▶ ir_gen.rs  ───▶ ast.rs
           │                ───▶ ir.rs ───▶ types.rs
           │                ───▶ types.rs
           ├──▶ ir_opt.rs  ───▶ ir.rs
           ├──▶ callgraph.rs ─▶ ir.rs
           │                 ─▶ regalloc.rs ──▶ ir.rs
           │                 ─▶ types.rs
           ├──▶ codegen.rs ──▶ callgraph.rs
           │                ──▶ ir.rs
           │                ──▶ regalloc.rs
           │                ──▶ types.rs
           ├──▶ peephole.rs    (standalone)
           └──▶ emit.rs    ──▶ runtime.rs  (standalone)
```

**Leaf modules** (no sibling imports): `lexer.rs`, `preproc.rs`, `types.rs`, `peephole.rs`, `runtime.rs`.

## Driver: main.rs

The compiler driver ([main.rs](../src/main.rs), 1,201 lines) orchestrates the pipeline:

### Single-file mode
```rust
compile_source(source, filename, opts)
    → preprocess → tokenize → parse → generate IR → optimize IR
    → analyze call graph → generate code → peephole optimize
    → emit .asm (+ optional .lst)
```

### Multi-file mode
```rust
compile_multi(files, opts)
    → for each file: preprocess → tokenize → parse → generate IR
    → merge_ir (deduplicate globals/functions)
    → optimize IR → analyze call graph → generate code
    → peephole optimize → emit
```

### CLI Options

| Flag | Description |
|------|-------------|
| `-o <path>` | Output assembly file path |
| `--lst <path>` | Output listing file path |
| `--no-lst` | Suppress listing generation |
| `-I <dir>` | Add include search path |

System include paths are resolved relative to the compiler executable (`../include/`).

## Data Flow Types

| Type | Module | Description |
|------|--------|-------------|
| `Token` / `TokenKind` | `lexer.rs` | Lexical tokens with ~100 variants |
| `Program` | `ast.rs` | Translation unit: `Vec<TopLevel>` + enum constants |
| `Expr` / `Stmt` / `TopLevel` | `ast.rs` | AST nodes with `SourceLocation` |
| `CType` | `types.rs` | C type representation |
| `IrProgram` | `ir.rs` | IR program: globals + functions + strings |
| `IrFunction` | `ir.rs` | Function: params, locals, body (`Vec<IrInstr>`), flags |
| `IrOp` | `ir.rs` | ~30 IR operation variants |
| `VReg` | `ir.rs` | Virtual register: `{ id, width }` |
| `CallGraphAnalysis` | `callgraph.rs` | Call graph + memory allocations + function effects |
| `RegAllocator` | `regalloc.rs` | Physical register tracker state |

## Multi-File Compilation

The `merge_ir()` function combines multiple `IrProgram` instances:
- Functions with the same name are deduplicated (last definition wins)
- Globals are merged; duplicate names retain the initialized version
- String literals are concatenated
- All functions and globals are available for cross-module reference

After merging, the optimization and code generation stages operate on the unified program.
