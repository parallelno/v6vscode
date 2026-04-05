# Calling Convention

v6c uses a **dual-mode** calling convention optimized for the Intel 8080's limited register set.

## Register Passing

| Position | 16-bit (int/ptr) | 8-bit (char) | 32-bit (long/float) |
|----------|:-:|:-:|:-:|
| Argument 0 | **HL** | **A** | **DE:HL** |
| Argument 1 | **DE** | — | stack |
| Argument 2+ | stack (R→L) | stack | stack |
| Return value | **HL** | **A** | **DE:HL** |

- The first 16-bit argument goes in HL, the second in DE
- A single 8-bit argument goes in A
- 32-bit values use DE:HL (DE = high word, HL = low word)
- Additional arguments are pushed right-to-left onto the stack
- The caller is responsible for cleaning up stack arguments

## Global Mode (Default)

In global mode, function parameters and locals are stored at **fixed memory addresses** rather than on the stack.

### Call Sequence (Caller Side)

```asm
; Calling func(x, y) where x is 16-bit, y is 16-bit:
LHLD _l_caller_x        ; load x into HL (arg 0)
XCHG                     ; move to DE (for arg 1 placement)
LHLD _l_caller_y         ; load y into HL
XCHG                     ; HL = x, DE = y
CALL func
; return value is in HL
```

### Function Prologue (Callee Side)

```asm
func:
    SHLD _l_func_param0     ; save HL (arg 0) to static slot
    XCHG
    SHLD _l_func_param1     ; save DE (arg 1) to static slot
    ; ... function body ...
    ; load return value into HL
    RET
```

### Variable Access

All local variables are accessed via direct memory addressing:

```asm
LHLD _l_func_var         ; load 16-bit local (16 cycles)
SHLD _l_func_var         ; store 16-bit local (16 cycles)
LDA _l_func_byte_var     ; load 8-bit local (13 cycles)
STA _l_func_byte_var     ; store 8-bit local (13 cycles)
```

This is far cheaper than stack-relative access on the 8080, which requires ~40+ cycles per access.

## Stack Mode

Functions marked with `__stack` or detected as recursive use traditional stack frames.

### When Stack Mode Is Required

- Functions annotated with `__stack`
- Functions detected as recursive (directly or through call chains)
- Functions called through function pointers
- Variadic functions (`...`)

### Stack Frame Layout

```
        ┌─────────────────┐  ← caller's SP
        │ return address   │  (2 bytes, from CALL)
        ├─────────────────┤
        │ saved registers  │
        ├─────────────────┤
        │ local var N      │
        │ ...              │
        │ local var 1      │
        ├─────────────────┤  ← current SP
```

### Variable Access (Stack Mode)

Stack-relative access is expensive on the 8080 (no index registers):

```asm
; Load local at SP+offset:
LXI H, offset
DAD SP
MOV E,M            ; low byte
INX H
MOV D,M            ; high byte
XCHG               ; result in HL
; ~40+ cycles per access
```

## Variadic Functions

Variadic functions (`...`) use stack mode. The callee accesses variable arguments through `va_list` / `va_arg`:

- `__builtin_va_start()` computes the base address of the first variadic argument
- Arguments are accessed via pointer arithmetic from the base
- The `__va_base_{func}` label marks the variadic argument region

## Comparison with Other Conventions

| Convention | Per-access cost (16-bit) | Frame setup | Recursion |
|------------|:---:|:---:|:---:|
| v6c global mode | ~16 cycles (LHLD/SHLD) | 0 cycles | No |
| v6c stack mode | ~40+ cycles | ~20 cycles | Yes |
| c8080 `__global` | ~16 cycles | 0 cycles | No |
| SDCC `__sdcccall(1)` | ~30 cycles (IX-based) | ~15 cycles | Yes |
| Traditional C (8080) | ~40+ cycles | ~20 cycles | Yes |

The global mode convention is the single largest performance win for non-recursive code on the 8080.
