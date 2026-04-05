# Peephole Optimizer

**Module:** [peephole.rs](../src/peephole.rs) | **Lines:** 1,706

The peephole optimizer performs pattern-matched rewriting on emitted 8080 assembly text. It operates in a **fixed-point loop**, applying rules until no more changes occur.

## Entry Point

```rust
pub fn peephole_optimize(lines: Vec<String>) → Vec<String>
```

## Line Representation

Assembly lines are parsed into a structured `Line` enum:

| Variant | Description |
|---------|-------------|
| `Label(name)` | Label definition (e.g., `_main:`) |
| `Instruction { opcode, operands }` | Assembly instruction (e.g., `MOV A,B`) |
| `Comment` | Comment line |
| `Empty` | Blank line |
| `Raw` | Inline assembly — **never modified** by the peephole |

## Rules

The optimizer applies ~25 rules in sliding windows of 2–3 instructions:

### Data Movement Rules

| # | Pattern | Replacement | Savings |
|---|---------|-------------|---------|
| 1 | `SHLD addr` → `LHLD addr` | Remove `LHLD` (value already in HL) | ~16T |
| 2 | `LHLD addr` → `SHLD addr` | Remove `SHLD` if HL unchanged | ~16T |
| 4 | `MOV X,X` | Remove self-move | ~7T |
| 12 | `PUSH X` → `POP X` | Remove both (no effect) | ~21T |
| 16 | `XCHG` → `XCHG` | Remove double exchange | ~8T |
| 21 | `MVI A,0` | `XRA A` (shorter, sets flags) | ~3T |
| 36 | `MVI A,n` → `MOV M,A` | `MVI M,n` (combine) | ~7T |
| 43 | `MOV L,M` → `INX H` → `MOV H,M` | `LHLD addr` when applicable | varies |
| 45 | `MOV A,X` → `MOV Y,A` | `MOV Y,X` (bypass A) | ~7T |

### Control Flow Rules

| # | Pattern | Replacement | Savings |
|---|---------|-------------|---------|
| 3 | `CALL func` → `RET` | `JMP func` (tail-call optimization) | ~17T |
| 10 | Dead code after `JMP`/`RET` | Remove unreachable instructions | varies |
| 18 | `JMP L` where L is the next label | Remove jump | ~10T |
| 19 | Conditional branch inversion | Simplify branch chains | ~10T |
| 32 | `JMP L1` where L1 targets `JMP L2` | `JMP L2` (jump threading) | ~10T |
| 33 | Jump/branch to immediately following label | Remove | ~10T |
| 34 | `JMP label` where label is `RET` | `RET` (jump-to-ret fold) | ~10T |

### Comparison Rules

| # | Pattern | Replacement | Savings |
|---|---------|-------------|---------|
| 5 | `ORA L` → `CPI 0` | Remove `CPI 0` (ORA already sets Z flag) | ~7T |

### Special Rules

| # | Pattern | Replacement | Description |
|---|---------|-------------|-------------|
| 13 | Adjacent duplicate labels | Merge into single label | Cleanup |
| 15 | `NOP` | Remove | ~4T saved |
| 31 | Unreferenced labels | Remove | Cleanup |
| 35 | `CALL main` in CRT0 | Inline `main` body (eliminate call overhead) | ~17T |
| 39 | Dead `LXI` | Remove `LXI` whose register is immediately overwritten | ~10T |
| 40 | Dead spill store | Remove `SHLD`/`STA` to spill slot that is never reloaded | varies |
| 41 | Unused `.STORAGE` | Remove storage for unreferenced labels | size |
| 42 | Dead `LXI DE,n` before overwrite | Remove | ~10T |

## Iteration Strategy

The peephole runs all rules in a single pass, then checks if any rule fired. If yes, it runs again. This continues until a **fixed point** is reached (no rules fire in an entire pass).

Inline assembly lines (`Raw` variant) are never modified — they pass through the peephole untouched.

## Safety

- **Label reference tracking:** Rules that remove labels or jumps verify that all references are updated. The optimizer maintains awareness of which labels are referenced by jump/call/branch instructions.
- **Inline asm preservation:** Lines between `; __asm_begin__` / `; __asm_end__` markers are flagged as `Raw` and excluded from pattern matching.
