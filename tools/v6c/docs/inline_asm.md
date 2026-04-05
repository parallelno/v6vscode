# Inline Assembly

v6c supports `asm { ... }` blocks for embedding hand-written Intel 8080 assembly within C functions. Three modes are available, each with different overhead/control tradeoffs.

> **Full design document:** [design/design_inline_asm.md](design/design_inline_asm.md)
> **Clobber hint examples:** [design/design_inline_asm_examples.md](design/design_inline_asm_examples.md)

## Syntax

```c
// Mode 1: Full-body asm function
int __global add(int a, int b) {
    asm { DAD D }
}

// Mode 2: Parameterized asm block
asm(int x, int y) {
    DAD D
};

// Mode 2b: Raw asm block (clobber-all)
asm {
    LXI H, 42
    SHLD _l_func_var
};

// Zero-param asm (no clobber)
asm() {
    EI
};
```

## Mode 1: Full-Body Asm Function

When a function body contains **only** a single `asm { }` block:

- The compiler emits the function label + raw asm + optional `RET`
- **No prologue/epilogue** — zero overhead
- Parameters arrive in registers per calling convention (HL, DE, A)
- The programmer manages registers manually
- No static-slot allocation for parameters

```c
int __global add(int a, int b) {
    asm {
        ; a in HL, b in DE
        DAD D
        ; result in HL
    }
}
```

Output:
```asm
add:
    DAD D
    RET
```

### Self-Modifying Code

The v6asm `*` location counter enables the classic 8080 optimization:

```asm
_save = * + 1
SHLD 0           ; stores HL into the LXI operand below
; ...
_save_ld = * + 1
LXI H, 0        ; operand patched by SHLD above
```

Saves 6 T-states per access vs `LHLD _save`.

## Mode 2: Parameterized Asm Block

The `asm(type var, ...)` form places C variables into registers per calling convention and only invalidates those registers:

| Parameters | Registers Touched | Spill Scope |
|------------|:-:|:-:|
| `asm() { }` | none | none |
| `asm(char x) { }` | A | A only |
| `asm(int a) { }` | HL | HL only |
| `asm(int a, int b) { }` | HL, DE | HL, DE only |

Maximum 2 parameters.

```c
void send_byte(char val) {
    asm(char val) {    // val → A
        OUT 42
    };
}
```

The compiler:
1. Spills only the touched registers (if they hold live C values)
2. Places input values into the correct registers
3. Emits the raw asm verbatim
4. Invalidates only the touched registers

## Mode 2b: Raw Asm Block (Clobber-All)

The `asm { }` block without parameters is the conservative fallback:

1. **Flushes all** live virtual registers to memory
2. Emits raw asm verbatim
3. **Invalidates all** register tracking

Use for large blocks that access `_l_` / `_g_` labels directly:

```c
int checksum(const char *data, int len) {
    int sum = 0;
    asm {
        LHLD _l_checksum_data
        XCHG
        LHLD _l_checksum_len
        ; ... full algorithm ...
        SHLD _l_checksum_sum
    }
    return sum;
}
```

## Overhead Comparison

Given `HL=x(live), DE=y(live)` before the asm block:

| Syntax | Spill | Reload | Overhead |
|--------|-------|--------|:---:|
| `asm { ... }` | SHLD+XCHG+SHLD | LHLD+XCHG+LHLD | **~72T** |
| `asm(hl) { ... }` | SHLD (HL only) | LHLD (HL only) | **~32T** |
| `asm(a) { ... }` | nothing | nothing | **~0T** |

## Parameter Equate Declarations

Inside full-body asm functions, lines matching `identifier = expression` are passed through as assembler equates:

| Pattern | Meaning |
|---------|---------|
| `_l_func_param = 0` | Parameter stays in register; no memory allocated |
| `_l_func_param = * + 1` | Self-modifying code: parameter stored in instruction operand |
| `label = expr` | General assembler equate (pass-through) |

## Label Access

Asm blocks can reference any compiler-generated label:

| Label Pattern | Description |
|---------------|-------------|
| `_l_{func}_{var}` | Function-local variable |
| `_g_{name}` | Global variable |
| `L{n}__{func}` | Compiler-generated label |

Private labels in asm blocks should be prefixed with the function name to avoid collisions (v6asm has flat label scope).

## Error Handling

| Error | Cause |
|-------|-------|
| `expected '{' after 'asm'` | Missing opening brace |
| `unterminated asm block` | EOF before closing brace |
| `unknown variable 'x' in asm params` | Parameter name not in scope |
| `asm block supports max 2 params` | More than 2 typed parameters |
