# IR Optimization Passes

**Module:** [ir_opt.rs](../src/ir_opt.rs) | **Lines:** 4,661

The IR optimizer is the largest module in the compiler. It runs multiple passes in a **fixed-point loop** until no pass reports a change (convergence). All passes operate on `IrProgram` in-place.

## Entry Point

```rust
pub fn optimize(program: &mut IrProgram)
```

An `OptProfile` enum (selected via the `V6C_OPT_PROFILE` environment variable) controls pass ordering:
- `Default` — standard pass order
- `Benchmark` — tuned for benchmarks

## Pass Summary

| Pass | Category | Description |
|------|----------|-------------|
| Constant Fold & Propagate | Value | Evaluate constant ops at compile time; propagate known values |
| Dead Branch Eliminate | Control | Remove unreachable branches with known conditions |
| Load/Store Forwarding | Memory | Memory-versioned forwarding within basic blocks |
| Copy Propagation | Value | Rewrite uses through Copy/Cast chains |
| Redundant Store Eliminate | Memory | Remove stores whose values are never read |
| Strength Reduction | Algebraic | Replace mul/div/mod by powers of 2 with shifts/masks |
| CSE | Value | Common sub-expression elimination within basic blocks |
| Dead Code Eliminate | Cleanup | Remove instructions whose results are unused |
| Jump Threading | Control | Resolve branches that target other branches |
| Loop Invariant Code Motion | Loop | Hoist loop-invariant computations out of loops |
| Narrow Promoted Arithmetic | Width | Narrow W16 ops back to W8 when safe |
| Narrow Byte Ops | Width | Narrow arithmetic on byte-range values |
| Remove Dead Labels | Cleanup | Drop unreferenced labels |
| Sink W8 Loads | Scheduling | Move byte loads closer to their consumers |
| Inline Expansion | Interprocedural | Inline small functions (threshold: 20 IR instructions) |
| Function Specialization | Interprocedural | Clone functions called with constant args & simplify |
| Remove Dead Functions | Cleanup | Remove functions unreachable from `main` |
| Loop Unrolling | Loop | Unroll loops with `#pragma unroll` or small constant trips |
| Induction Variable Optimization | Loop | Optimize loop induction variables |

---

## Detailed Pass Descriptions

### Constant Folding & Propagation

Evaluates operations on known constants at compile time:
- Arithmetic: `3 + 5` → `8`, `10 * 2` → `20`
- Bitwise: `0xFF & 0x0F` → `0x0F`
- Shifts: `1 << 3` → `8`
- Comparisons: `5 < 10` → `1`
- Casts: constant width conversions
- Propagates `LoadImm` values through the instruction stream
- Handles divide-by-zero safely (skips fold)

### Dead Branch Elimination

When a conditional jump's condition is a known constant:
- `JumpIfTrue(1, label)` → `Jump(label)` (unconditional)
- `JumpIfFalse(0, label)` → `Jump(label)` (unconditional)
- `JumpIfTrue(0, label)` → removed (dead branch)
- Subsequent dead code after `Jump` is removed

### Load/Store Forwarding

Tracks a **versioned memory state** within basic blocks:
- When a `StoreGlobal(addr, v1)` is followed by `LoadGlobal(v2, addr)` with no intervening kill, replaces the load with `Copy(v2, v1)`
- Invalidates tracked state on:
  - Stores to different addresses
  - Function calls (impure)
  - Pointer stores (may alias)
- Resets at basic block boundaries

### Copy Propagation

Follows chains of `Copy` and identity `Cast` operations to find the original value:
- `v2 = Copy(v1)` then `Add(v3, v2, v4)` → `Add(v3, v1, v4)`
- Reduces register pressure and exposes further optimization opportunities

### Redundant Store Elimination

Removes stores to memory locations that are:
- Written again before any read (the first store is dead)
- Never read in any reachable path

### Strength Reduction

Replaces expensive operations with cheaper equivalents for powers of 2:

| Original | Replacement | Condition |
|----------|------------|-----------|
| `Mul(d, x, 2^n)` | `Shl(d, x, n)` | Power of 2 |
| `Div(d, x, 2^n)` | `Shr(d, x, n)` | Unsigned, power of 2 |
| `Mod(d, x, 2^n)` | `And(d, x, 2^n - 1)` | Unsigned, power of 2 |

Does **not** rewrite signed division/modulo (different semantics for negative values).

### Common Sub-Expression Elimination (CSE)

Within a basic block, identifies identical operations producing the same result:
- Matches operands and operation type
- Replaces the second computation with a `Copy` of the first result
- Invalidated by stores that could alias

### Dead Code Elimination

Performs a **liveness analysis** and removes instructions whose result vregs are never used downstream. Preserves instructions with side effects (stores, calls, returns, jumps).

### Jump Threading

When a branch targets a label that is immediately followed by another branch:
- `Jump(L1)` where `L1: Jump(L2)` → `Jump(L2)` (thread through)
- `JumpIfTrue(v, L1)` where `L1: Jump(L2)` → `JumpIfTrue(v, L2)`
- Transitive: resolves chains of jumps

### Loop Invariant Code Motion (LICM)

Identifies instructions inside loops whose operands are defined outside the loop (or by other loop-invariant instructions):
- Hoists them to the loop preheader
- Handles `LoadGlobal`/`LoadLocal` with care — only hoists compiler-local variables (`_l_*`) known not to be aliased

### Narrowing Passes

Two complementary passes narrow operations to use fewer bits:

**Narrow Promoted Arithmetic:** When integer promotion has widened a byte value to W16 unnecessarily, narrows back to W8 operations.

**Narrow Byte Ops:** Tracks value ranges through the IR:
- Known-zero high byte → use W8 operations
- Unsigned div/mod with nonzero RHS where both operands fit in 8 bits → use W8
- Compare narrowing when both sides are byte-range

### Sink W8 Loads

Scheduling optimization: moves W8 (byte) loads closer to their consumers, improving register utilization on the 8080 where A is the only 8-bit register.

### Inline Expansion

Replaces call sites with the body of the called function when:
- Function body ≤ `INLINE_THRESHOLD` (20) IR instructions
- Function is not recursive
- Function is not `__stack` mode or variadic

The function body is duplicated with fresh vregs and labels, and parameter-passing code is replaced with direct copies.

### Function Specialization

When a function is called with one or more constant arguments:
1. Clones the function body
2. Replaces parameter loads with the known constant values
3. Runs constant folding on the clone
4. Redirects the call site to the specialized copy

Identical specializations are deduplicated after the pass.

### Remove Dead Functions

Builds reachability from `main()` through the call graph. Any function not reachable (and not referenced by address) is removed from the program.

### Loop Unrolling

Unrolls loops that have:
- A `#pragma unroll` annotation (stored in `IrFunction::unroll_loop_headers`)
- Or a small constant trip count (heuristic)

Duplicates the loop body N times and adjusts the induction variable.

### Induction Variable Optimization

Recognizes loop patterns of the form `i = i + stride`:
- Replaces derived expressions (e.g., `base + i * elem_size`) with incremented pointers
- Reduces multiply operations inside loops to additions

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `INLINE_THRESHOLD` | 20 | Maximum IR instructions for automatic inlining |
