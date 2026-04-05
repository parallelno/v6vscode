# Call Graph & Memory Model

**Module:** [callgraph.rs](../src/callgraph.rs) | **Lines:** 1,089

The call graph analyzer performs whole-program analysis to enable v6c's primary performance feature: **static memory allocation** for function locals and parameters.

## Overview

On the Intel 8080, stack-relative variable access is expensive (20+ cycles per access — `LD HL,offset / ADD HL,SP / LD r,(HL)`). v6c avoids this by placing all local variables at **fixed RAM addresses** when possible, reducing access to a single `LDA addr` / `STA addr` or `LHLD addr` / `SHLD addr`.

## Dual-Mode Memory Model

### Global Mode (Default)

- Compiler performs whole-program call-graph analysis
- Every non-recursive function's locals and parameters are assigned **fixed memory addresses**
- Function arguments are written directly to their assigned addresses by the caller (or passed in registers)
- **Result:** Zero stack-frame overhead; variable access is a single load/store instruction

### Stack Mode (Opt-in)

- For functions marked `__stack` or identified as recursive / indirectly-called
- Uses traditional SP-relative addressing or a software frame pointer
- Required for recursion, function pointers, and reentrant code

## Call Graph Analysis Pipeline

```rust
pub fn analyze(program: &IrProgram, base_addr: u16) → CallGraphAnalysis
```

### Step 1: Build Call Graph

`build_callees()` — Scans each function's IR body for `Call` instructions and builds a callee map (`HashMap<String, HashSet<String>>`). For inline assembly functions, `scan_asm_calls()` extracts `CALL label` patterns from the raw assembly text.

### Step 2: Detect Recursion

`detect_recursion()` — DFS with white/gray/black coloring:
- **White:** Unvisited
- **Gray:** Currently on the recursion stack (back edge = cycle = recursion)
- **Black:** Fully explored

Any function involved in a cycle is marked as requiring stack mode.

### Step 3: Allocate Memory

**Global variables** — `allocate_globals()`: Each global gets a fixed address starting from `base_addr` (default: `0x8000`).

**Local variables** — `allocate_locals()`: For each non-recursive function, locals and parameters are assigned addresses. The address counter continues from where globals ended.

### Step 4: Build Frame Layouts

`build_frame_layouts()` — For stack-mode functions, computes:
- `FunctionFrameLayout { size, offsets }` — total frame size and per-variable offsets

### Step 5: Compute Reachability

`compute_reachability()` — Determines which functions are reachable from `main()`. Used by dead function elimination.

### Step 6: Function Effect Summaries

`summarize_functions()` — Infers interprocedural properties:

```rust
pub struct FunctionEffects {
    pub leaf: bool,       // makes no calls
    pub pure: bool,       // no side effects, no global reads
    pub readonly: bool,   // reads globals but doesn't write
    pub noreturn: bool,   // never returns
    pub clobbers: HashSet<PhysReg>,  // physical registers clobbered
}
```

These summaries enable:
- **Selective save/restore** — only spill registers that the callee actually clobbers
- **Dead call elimination** — remove calls to pure functions whose result is unused
- **Code motion** — move calls past non-interfering code

## Key Types

### CallGraphAnalysis

```rust
pub struct CallGraphAnalysis {
    pub graph: CallGraph,
    pub local_allocs: HashMap<String, HashMap<String, u16>>,  // func → (var → addr)
    pub global_allocs: HashMap<String, u16>,                   // var → addr
    pub next_addr: u16,                                        // next free address
    pub leaf_functions: HashSet<String>,
    pub effects: HashMap<String, FunctionEffects>,
    pub frame_layouts: HashMap<String, FunctionFrameLayout>,
}
```

### CallGraph

```rust
pub struct CallGraph {
    pub callees: HashMap<String, HashSet<String>>,
    pub recursive: HashSet<String>,
    pub stack_mode: HashSet<String>,
}
```

## Memory Layout

```
0x0000 ┌────────────────────┐
       │  ROM / Code        │
       │  (ORG 0x100)       │
0x8000 ├────────────────────┤ ← DEFAULT_BASE_ADDR
       │  Global variables  │
       │  (_g_xxx)          │
       ├────────────────────┤
       │  Local variables   │
       │  (_l_func_xxx)     │
       ├────────────────────┤
       │  Heap              │
       │  (__heap_start)    │
       │  (grows upward)    │
0xF000 ├────────────────────┤ ← heap limit
       │  Stack             │
       │  (grows downward)  │
       │  SP init = 0x8000  │
0x8000 └────────────────────┘
```

Note: The stack grows downward from the initial SP value. Static allocations grow upward from `0x8000`. This layout is specific to the Vector 06C computer.

## Label Naming Convention

| Pattern | Meaning | Example |
|---------|---------|---------|
| `_g_{name}` | Global variable | `_g_count` |
| `_l_{func}_{var}` | Function-local (static) | `_l_main_i` |
| `__str_N` | String literal | `__str_0` |
| `L{n}__{func}` | Compiler-generated label | `L3__main` |
| `__va_base_{func}` | Variadic argument base | `__va_base_printf` |
