# Code Generator

**Module:** [codegen.rs](../src/codegen.rs) | **Lines:** 3,145

The code generator translates IR instructions into Intel 8080 assembly text. It works with the register allocator for physical register placement and the call graph analysis for memory address resolution.

## Entry Point

```rust
pub fn generate(program: &IrProgram, analysis: &CallGraphAnalysis) → Vec<String>
```

Returns a list of assembly text lines.

## Architecture

The `CodeGenerator` maintains:
- **Output buffer** — `Vec<String>` of assembly lines
- **Register allocator** — `RegAllocator` instance for physical register tracking
- **Call graph analysis** — for address lookups and function effect queries
- **A-mirror tracking** — knows when register A already holds a value (avoids redundant loads)
- **Consumed-compare set** — tracks comparisons consumed by subsequent branches (compare-branch fusion)
- **Last-use map** — precomputed per-instruction: which vregs are last used here

## Instruction Selection

The code generator uses **pattern matching** to emit optimized instruction sequences rather than one-IR-instruction-at-a-time translation.

### Arithmetic (W16)

| IR Pattern | 8080 Assembly | Cycles |
|------------|---------------|--------|
| `Add(d, a, b)` | `LHLD a; XCHG; LHLD b; DAD D; SHLD d` | ~57 |
| `Add(d, a, 1)` | `LHLD a; INX H; SHLD d` | ~37 |
| `Sub(d, a, 1)` | `LHLD a; DCX H; SHLD d` | ~37 |
| `Mul(d, a, 2)` | `LHLD a; DAD H; SHLD d` | ~37 |
| `Mul(d, a, 3)` | `LHLD a; MOV D,H; MOV E,L; DAD H; DAD D; SHLD d` | ~55 |
| `Mul(d, a, 2^n)` | `LHLD a; DAD H (×n); SHLD d` | ~27+11n |
| `Mul(d, a, b)` (general) | `LHLD a; XCHG; LHLD b; CALL __mul16; SHLD d` | ~200+ |

### Arithmetic (W8)

| IR Pattern | 8080 Assembly |
|------------|---------------|
| `Add(d, a, b)` | `LDA a; MOV B,A; LDA b; ADD B; STA d` |
| `Add(d, a, 1)` | `LDA a; INR A; STA d` |
| `Sub(d, a, 1)` | `LDA a; DCR A; STA d` |

### Comparison-Branch Fusion

When a comparison IR instruction is immediately followed by `JumpIfTrue` or `JumpIfFalse` consuming the result, the code generator **skips boolean materialization** and emits a direct conditional jump:

| IR Pattern | Without Fusion | With Fusion |
|------------|----------------|-------------|
| `Lt(c,a,b) + JumpIfTrue(c,L)` | ~18 instructions: compare → materialize 0/1 → test → branch | ~6 instructions: compare → conditional jump |

This optimization saves ~35 cycles per comparison and is critical for loop-heavy code.

### Array Access

| IR Pattern | 8080 Assembly |
|------------|---------------|
| `PtrAdd(d, base, idx, 1)` (byte array) | `LHLD idx; XCHG; LXI H,base; DAD D; MOV A,M` |
| `PtrAdd(d, base, idx, 2)` (int array) | `LHLD idx; DAD H; XCHG; LXI H,base; DAD D` |

### 32-bit Operations (W32)

32-bit values are stored in memory operand pairs (`__op1`, `__op2`). The code generator:
1. Emits stores to `__op1` and `__op2` memory locations
2. Calls the runtime helper (`__mul32`, `__div32u`, etc.)
3. Reads the result from `__op1`

### Inline Assembly

Three modes handled:

| Mode | Behavior |
|------|----------|
| Full-body asm function | Emit label + raw asm + optional RET; skip prologue/epilogue |
| Parameterized `asm(params)` | Place C values into registers per calling convention; emit raw asm; invalidate touched regs only |
| Raw `asm { }` | Flush all live registers; emit raw asm; invalidate everything |

## Function Code Generation

### Global Mode Function

```asm
func_name:
    ; Parameter prologue: store register args to static slots
    SHLD _l_func_param0     ; HL → first param
    XCHG
    SHLD _l_func_param1     ; DE → second param
    ; ... function body ...
    ; Return: result in HL (16-bit) or A (8-bit)
    RET
```

### Stack Mode Function

```asm
func_name:
    ; Frame setup
    PUSH B                  ; save BC
    LXI H, -framesize
    DAD SP
    SPHL                    ; allocate frame
    ; ... function body (SP-relative access) ...
    ; Frame teardown
    LXI H, framesize
    DAD SP
    SPHL
    POP B
    RET
```

## Register Management

The code generator uses helper methods to request values in specific registers:

| Method | Action |
|--------|--------|
| `ensure_hl(vreg)` | Place vreg in HL (may spill current HL occupant) |
| `ensure_de(vreg)` | Place vreg in DE |
| `ensure_a(vreg)` | Place vreg in A |

### Call-Site Spilling

Before function calls, the code generator:
1. Queries `FunctionEffects` for the callee's clobber set
2. Spills only registers that are (a) live after the call AND (b) clobbered by the callee
3. For leaf functions, may skip spilling entirely

## Post-Pass: CFG Layout Compaction

```rust
pub fn compact_cfg_layout(lines: &mut Vec<String>)
```

After initial code generation, this pass:
- Threads jump chains (jump to label that jumps to another label)
- Removes jumps to the immediately following label
- Cleans up in the assembly text domain before the peephole optimizer runs

## Data Section

`gen_data_section()` emits:
- Global variable storage (`.db` / `.dw` / `.storage`)
- Initialized global data
- String literal data
- Static local variable storage
