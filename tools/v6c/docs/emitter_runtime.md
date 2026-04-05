# Emitter & Runtime Library

## Emitter (`emit.rs`)

**Lines:** 725 | **Input:** Assembly text lines | **Output:** `.asm` and `.lst` files

The emitter writes the final assembly output compatible with the **v6asm** assembler, targeting the Vector 06C computer (ORG `0x100`).

### Assembly Output

```rust
pub fn emit_asm(code_lines: &[String], output_path: &str)
```

`build_full_asm()` assembles the final output:

1. **CRT0 header** — startup code: `ORG 0x100`, disable interrupts, set SP, call `main`, `HLT`
2. **Compiler-generated code** — the optimized assembly from codegen + peephole
3. **Runtime library routines** — only those referenced by the generated code

### Listing Output

```rust
pub fn emit_lst(code_lines: &[String], output_path: &str, source_lines: &[String])
```

Generates a listing file with columns:
- Address (hex)
- Machine code bytes (hex)
- Source/assembly text

Uses a two-pass approach:
1. **Pass 1:** Resolve label addresses
2. **Pass 2:** Encode instructions and emit listing rows

`encode_8080_instruction()` provides a full Intel 8080 opcode encoder (for the byte column only — actual assembly is done by v6asm).

### Expression Evaluator

`eval_expr()` handles simple address arithmetic in labels (e.g., `* + 1`, `label + 2`) for the listing's address resolution.

---

## Runtime Library (`runtime.rs`)

**Lines:** 263

The runtime module embeds all `runtime/*.asm` files as string constants and selectively includes them based on actual usage.

### Selective Inclusion

```rust
pub fn collect_runtime(code_lines: &[String]) → String
```

1. Scans all generated code lines for `CALL` and `JMP` references to runtime symbols
2. Resolves transitive dependencies (e.g., `stdlib` depends on `__mul16`)
3. Returns the concatenated assembly text of all needed runtime modules

### Module Descriptors

Each runtime module is described by:

```rust
struct RuntimeModule {
    symbols: &[&str],   // exported symbol names
    asm: &str,          // embedded assembly source
    deps: &[&str],      // symbols this module depends on
}
```

### CRT0

```rust
pub fn crt0_asm() → &'static str
```

Returns the C runtime startup code, included unconditionally:

```asm
    .ORG 0x100
    DI                  ; disable interrupts
    LXI SP, 0x8000      ; initialize stack pointer
    CALL main            ; call main()
    HLT                  ; halt on return
```

---

## Runtime Library Modules

The runtime consists of **13 hand-optimized Intel 8080 assembly modules** (~3,300 lines total):

### Math Routines

| Module | File | Symbols | Algorithm |
|--------|------|---------|-----------|
| 16-bit multiply | [mul16.asm](../runtime/mul16.asm) | `__mul16` | Shift-and-add (16 iterations) |
| 16-bit divide | [div16.asm](../runtime/div16.asm) | `__div16u`, `__div16s`, `__mod16u`, `__mod16s` | Restoring division (16 iterations); signed versions negate + call unsigned + fix sign |
| 32-bit multiply | [mul32.asm](../runtime/mul32.asm) | `__mul32` | Shift-and-add via memory-resident `__op1`/`__op2` |
| 32-bit divide | [div32.asm](../runtime/div32.asm) | `__div32u`, `__div32s`, `__mod32u`, `__mod32s` | Restoring division (32 iterations); includes `__abs32`/`__neg32` helpers |
| 16-bit shifts | [shift.asm](../runtime/shift.asm) | `__shl16`, `__shr16u`, `__shr16s` | Loop-based, A = shift count |
| 32-bit shifts | [shift32.asm](../runtime/shift32.asm) | `__shl32`, `__shr32u`, `__shr32s` | Loop-based on `__op1` memory; clamped to 0..31 |
| 16-bit compare | [cmp.asm](../runtime/cmp.asm) | `__cmp16u`, `__cmp16s` | Sets carry flag; signed handles different-sign cases |
| Float | [float.asm](../runtime/float.asm) | `__fadd`, `__fsub`, `__fmul`, `__fdiv`, `__fcmp_*`, conversions | IEEE 754 single-precision soft-float: unpack/pack/normalize, int↔float |

### Memory & String

| Module | File | Symbols |
|--------|------|---------|
| Memory | [memcpy.asm](../runtime/memcpy.asm) | `memcpy`, `memset`, `strlen`, `strcmp` |
| String | [string.asm](../runtime/string.asm) | `memmove`, `strcpy`, `strncpy`, `strcat`, `strncat`, `strncmp`, `strchr`, `strrchr`, `memcmp` |

### Standard Library

| Module | File | Symbols | Notes |
|--------|------|---------|-------|
| stdio | [stdio.asm](../runtime/stdio.asm) | `putchar`, `getchar`, `puts`, `printf` | Port I/O; printf supports `%d/%i/%u/%x/%X/%o/%c/%s/%%` with `%l` prefix |
| stdlib | [stdlib.asm](../runtime/stdlib.asm) | `abs`, `atoi`, `rand`, `srand`, `malloc`, `free` | LCG random; bump allocator with free-list; heap at `__heap_start` to 0xF000 |

### Startup

| Module | File | Symbols |
|--------|------|---------|
| CRT0 | [crt0.asm](../runtime/crt0.asm) | `_start` |

### Dependency Graph

```
stdio   ──→ (standalone, port I/O)
stdlib  ──→ __mul16 (rand uses multiplication)
string  ──→ (standalone)
memcpy  ──→ (standalone)
float   ──→ (standalone)
div32   ──→ defines __op1/__op2 storage (shared with mul32, shift32)
mul32   ──→ __op1/__op2 (from div32)
shift32 ──→ __op1/__op2 (from div32)
```

### 32-bit Operand Convention

32-bit operations use shared memory-resident operands:
- `__op1` (4 bytes) — first operand / result
- `__op2` (4 bytes) — second operand

The code generator stores 32-bit values into `__op1`/`__op2`, calls the runtime helper, and reads the result from `__op1`.
