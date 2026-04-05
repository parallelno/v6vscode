# Type System

**Module:** [types.rs](../src/types.rs) | **Lines:** 660

The type system models C types for the Intel 8080 target, where `char` = 1 byte, `int` = 2 bytes, `long` = 4 bytes, and all pointers are 2 bytes.

## Type Representation (`CType`)

| Variant | C Equivalent | Size (bytes) | Notes |
|---------|-------------|:---:|-------|
| `Void` | `void` | — | Only valid as return type or `void*` |
| `Char(signed)` | `char` / `unsigned char` | 1 | `signed` flag: `true` = signed (default), `false` = unsigned |
| `Int(signed)` | `int` / `unsigned int` | 2 | Primary integer type on 8080 |
| `Long(signed)` | `long` / `unsigned long` | 4 | 32-bit via memory-resident pairs |
| `Float` | `float` | 4 | IEEE 754 single-precision (software FP) |
| `Pointer(box CType)` | `T *` | 2 | All pointers are 16-bit |
| `Array(box CType, Option<usize>)` | `T[N]` | N × sizeof(T) | Size is optional (incomplete arrays) |
| `Function { params, return_type, is_variadic }` | Function type | — | Used for function pointers |
| `Struct { name, fields }` | `struct S` | Σ field sizes | No padding (byte-aligned on 8080) |
| `Union { name, fields }` | `union U` | max(field sizes) | All fields share address |
| `Enum(Option<String>)` | `enum E` | 2 | Stored as `int` |

## Storage Classes (`StorageClass`)

| Variant | C Keyword | Meaning |
|---------|-----------|---------|
| `Auto` | (default) | Automatic storage — static allocation in global mode |
| `Static` | `static` | File-scope or persistent local |
| `Extern` | `extern` | External linkage (declared but not defined here) |
| `Register` | `register` | Hint only — treated same as `Auto` |

## Size Queries

- `CType::size_of() → Option<usize>` — returns byte size on the 8080 target; `None` for `Void` and unsized arrays
- Struct size = sum of all field sizes (no padding)
- Union size = maximum field size
- Array size = element size × count

## Type Properties

| Method | Returns `true` for |
|--------|--------------------|
| `is_integer()` | `Char`, `Int`, `Long`, `Enum` |
| `is_pointer()` | `Pointer` |
| `is_signed()` | Signed `Char`, `Int`, `Long` |
| `is_float()` | `Float` |
| `is_arithmetic()` | `is_integer()` or `is_float()` |
| `is_scalar()` | `is_arithmetic()` or `is_pointer()` |
| `is_array()` | `Array` |
| `is_struct()` | `Struct` |
| `is_void()` | `Void` |
| `is_function()` | `Function` |

## Struct and Union Field Access

```rust
CType::field_offset(name: &str) → Option<(usize, CType)>
```

Returns the byte offset and type of a named field. For structs, fields are laid out sequentially with no padding. For unions, all fields are at offset 0.

## Array / Pointer Operations

| Method | Description |
|--------|-------------|
| `pointee()` | Inner type of `Pointer(T)` |
| `element_type()` | Element type of `Array(T, N)` |
| `decay()` | Array → Pointer (array-to-pointer decay for function args) |

## Type Conversions

### Implicit Conversions (`can_implicit_cast_to`)

C89-style implicit conversion rules:
- Any integer type → wider integer type
- `Char` → `Int` (integer promotion)
- `Int` → `Long`
- Array → pointer (decay)
- Integer ↔ pointer (C89 permitted)
- Any type → `void`
- Integer → `Float` / `Float` → integer

### Usual Arithmetic Conversions (`common_type`)

```rust
common_type(a: &CType, b: &CType) → Option<CType>
```

Determines the result type for binary operations:
1. If either is `Float` → `Float`
2. If either is `Long` → `Long` (wider signedness wins)
3. If either is `Int` → `Int`
4. If both are `Char` → `Int` (integer promotion)
5. Pointer arithmetic: `Pointer + Int` → `Pointer`

## Convenience Constructors

```rust
CType::char_signed()       // Char(true)
CType::int_signed()        // Int(true)
CType::int_unsigned()      // Int(false)
CType::long_signed()       // Long(true)
CType::long_unsigned()     // Long(false)
CType::ptr(inner)          // Pointer(Box::new(inner))
CType::void_ptr()          // Pointer(Box::new(Void))
CType::float()             // Float
CType::array(elem, size)   // Array(Box::new(elem), Some(size))
CType::function(params, ret, variadic)  // Function { ... }
```
