# IR Design

**Module:** [ir.rs](../src/ir.rs) | **Lines:** 673

v6c uses a three-address code (TAC) intermediate representation with virtual registers and explicit width tags. The IR sits between the AST and the 8080 code generator, enabling target-independent optimization passes.

## Width System

Every virtual register and operation carries a `Width` tag:

| Width | Bits | C Types | 8080 Storage |
|-------|------|---------|-------------|
| `W8` | 8 | `char` | Single register (A) |
| `W16` | 16 | `int`, pointer, `enum` | Register pair (HL, DE, BC) |
| `W32` | 32 | `long`, `float` | Memory-resident pair (`__op1`, `__op2`) |

Conversion: `Width::from_ctype(ty)` maps `CType` to the appropriate width.

## Virtual Registers (`VReg`)

```rust
pub struct VReg {
    pub id: u32,      // unique identifier
    pub width: Width,  // W8, W16, or W32
}
```

Virtual registers are unlimited — the register allocator maps them to physical 8080 registers during code generation. New vregs are created by `VRegAllocator::next(width)`.

## Labels

```rust
pub struct Label(pub u32);
```

Branch targets within a function. Created by `LabelAllocator::next()`.

## IR Instructions

Each instruction is wrapped:

```rust
pub struct IrInstr {
    pub op: IrOp,
    pub line: u32,  // source line number for diagnostics
}
```

## IR Operations (`IrOp`)

### Load / Store

| Variant | Description |
|---------|-------------|
| `LoadImm(dst, value, width)` | Load immediate constant into vreg |
| `LoadGlobal(dst, label)` | Load from a named memory address |
| `StoreGlobal(label, src)` | Store vreg to a named memory address |
| `LoadLocal(dst, label)` | Load from function-local static slot |
| `StoreLocal(label, src)` | Store to function-local static slot |
| `LoadPtr(dst, ptr_vreg, pointee_ty)` | Dereference pointer |
| `StorePtr(ptr_vreg, val, pointee_ty)` | Store through pointer |

### Arithmetic

| Variant | Description |
|---------|-------------|
| `Add(dst, lhs, rhs)` | Addition |
| `Sub(dst, lhs, rhs)` | Subtraction |
| `Mul(dst, lhs, rhs)` | Multiplication |
| `Div(dst, lhs, rhs)` | Division |
| `Mod(dst, lhs, rhs)` | Modulo |

### Bitwise

| Variant | Description |
|---------|-------------|
| `And(dst, lhs, rhs)` | Bitwise AND |
| `Or(dst, lhs, rhs)` | Bitwise OR |
| `Xor(dst, lhs, rhs)` | Bitwise XOR |
| `Shl(dst, lhs, rhs)` | Shift left |
| `Shr(dst, lhs, rhs)` | Shift right (arithmetic/logical based on signedness) |

### Comparison

| Variant | Description |
|---------|-------------|
| `Eq(dst, lhs, rhs)` | Equal |
| `Ne(dst, lhs, rhs)` | Not equal |
| `Lt(dst, lhs, rhs)` | Less than |
| `Le(dst, lhs, rhs)` | Less or equal |
| `Gt(dst, lhs, rhs)` | Greater than |
| `Ge(dst, lhs, rhs)` | Greater or equal |

### Unary

| Variant | Description |
|---------|-------------|
| `Neg(dst, src)` | Arithmetic negation |
| `Not(dst, src)` | Bitwise NOT |
| `LogicalNot(dst, src)` | Logical NOT (`!x`) |

### Control Flow

| Variant | Description |
|---------|-------------|
| `Jump(label)` | Unconditional jump |
| `JumpIfTrue(vreg, label)` | Branch if vreg is nonzero |
| `JumpIfFalse(vreg, label)` | Branch if vreg is zero |
| `Label(label)` | Label definition (branch target) |
| `Call(name, args, ret_dst, ret_ty)` | Function call with optional return vreg |
| `Return(Option<vreg>)` | Return from function |

### Data Movement

| Variant | Description |
|---------|-------------|
| `Copy(dst, src)` | Register copy |
| `Cast(dst, src, from_ty, to_ty)` | Type cast (widening/narrowing) |
| `AddrOfGlobal(dst, label)` | Load address of a global/local label |
| `PtrAdd(dst, base, offset, element_size)` | Pointer arithmetic: `base + offset * element_size` |

### Inline Assembly

| Variant | Description |
|---------|-------------|
| `InlineAsm { code, inputs }` | Inline assembly block with optional typed inputs |

## IR Function

```rust
pub struct IrFunction {
    pub name: String,
    pub params: Vec<IrParam>,
    pub locals: Vec<(String, CType)>,           // (label, type) pairs
    pub body: Vec<IrInstr>,
    pub return_type: CType,
    pub is_stack_mode: bool,                     // __stack annotation
    pub is_variadic: bool,                       // variadic function
    pub is_asm_body: bool,                       // full-body asm function
    pub unroll_loop_headers: HashSet<Label>,     // #pragma unroll targets
}
```

### IrParam

```rust
pub struct IrParam {
    pub name: String,
    pub ty: CType,
    pub vreg: VReg,  // virtual register assigned to this parameter
}
```

## IR Program

```rust
pub struct IrProgram {
    pub globals: Vec<GlobalVar>,
    pub functions: Vec<IrFunction>,
    pub strings: Vec<StringLiteral>,
}
```

### GlobalVar

```rust
pub struct GlobalVar {
    pub name: String,
    pub ty: CType,
    pub init: Option<Vec<u8>>,  // initialized data (byte representation)
}
```

### StringLiteral

```rust
pub struct StringLiteral {
    pub label: String,    // assembly label (e.g., "__str_0")
    pub data: Vec<u8>,    // UTF-8 bytes + null terminator
}
```

## IR Generation (`ir_gen.rs`)

**Lines:** 2,901

The `IrGenerator` translates the parsed AST into the IR. Key design decision: **default global mode** assigns every non-recursive function's locals to fixed RAM labels (`_l_main_x`, `_g_count`) instead of stack slots.

### Memory Naming Convention

| Label Pattern | Meaning |
|---------------|---------|
| `_l_{func}_{var}` | Function-local variable (static allocation) |
| `_g_{name}` | Global variable |
| `__str_N` | String literal |

### Expression Codegen

`gen_expr()` returns `(VReg, CType)` — the virtual register holding the result and its C type. The type information is used for implicit conversions and width selection.

### Constant Initialization

`const_init_bytes()` evaluates constant expressions at compile time and produces the byte representation for global variable initializers.

## Allocators

- **`VRegAllocator`** — Monotonic ID generator for virtual registers
- **`LabelAllocator`** — Monotonic ID generator for branch labels

Both ensure unique IDs across an entire compilation unit.
