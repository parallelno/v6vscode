# Parser & AST

## Parser (`parser.rs`)

**Lines:** 3,081 | **Input:** `Vec<Token>` | **Output:** `Program` (AST)

The parser is a hand-written recursive-descent parser supporting the full C89 subset targeted by v6c, plus compiler extensions (`__global`, `__stack`, `asm`).

### Supported Grammar

#### Top-Level Declarations
- Function definitions and forward declarations
- Global variable declarations (with optional initializers)
- `struct` / `union` definitions
- `enum` definitions
- `typedef` declarations

#### Statements
- `if` / `else`
- `while`, `for`, `do` / `while`
- `switch` / `case` / `default`
- `return`, `break`, `continue`, `goto`, labels
- Compound statements (blocks)
- Variable declarations (with initializers)
- Expression statements
- `asm { }` blocks (inline assembly)

#### Expressions (by precedence, low to high)
1. Comma (`,`)
2. Assignment (`=`, `+=`, `-=`, etc.)
3. Conditional (`? :`)
4. Logical OR (`||`)
5. Logical AND (`&&`)
6. Bitwise OR (`|`)
7. Bitwise XOR (`^`)
8. Bitwise AND (`&`)
9. Equality (`==`, `!=`)
10. Relational (`<`, `>`, `<=`, `>=`)
11. Shift (`<<`, `>>`)
12. Additive (`+`, `-`)
13. Multiplicative (`*`, `/`, `%`)
14. Unary (`!`, `~`, `-`, `++`, `--`, `*`, `&`, `sizeof`, cast)
15. Postfix (`[]`, `.`, `->`, `()`, `++`, `--`)
16. Primary (identifiers, literals, parenthesized expressions)

### Type Parsing

The parser handles:
- Base types: `void`, `char`, `int`, `long`, `float`, `unsigned`, `signed`
- Qualifiers: `const`
- Storage classes: `static`, `extern`, `__global`, `__stack`
- Pointers: `*` with arbitrary nesting depth
- Arrays: `type name[size]` with optional size
- Function types: `type name(params)`
- `struct` / `union` (with body or as forward reference)
- `enum` (with enumerator values)
- `typedef` names (resolved from typedef map)

### Asm Block Parsing

When the parser encounters the `asm` keyword:
1. If followed by `(` — parse typed parameter list, then `{ raw_text }`
2. If followed by `{` — parse raw asm block (clobber-all mode)

The raw text between braces is collected from the **original source** (not tokens) using `byte_offset`, preserving assembly formatting, labels, and comments.

### Error Recovery

The parser collects multiple errors and attempts to continue parsing. `ParseError` includes a descriptive message and the token position.

### Key Types

- **`Parser<'t>`** — Parser state: token slice, position, typedef/struct/union/enum maps, current function name, unroll hint
- **`ParseError`** — Error with message + position

### API

```rust
let mut parser = Parser::new(&tokens, &source);
let program = parser.parse()?; // -> Result<Program, Vec<ParseError>>
```

---

## AST (`ast.rs`)

**Lines:** 534 | Every AST node carries a `SourceLocation { line, column }` for diagnostics.

### Expression Nodes (`ExprKind`)

| Variant | Description |
|---------|-------------|
| `IntLiteral(i64)` | Integer constant |
| `FloatLiteral(f64)` | Float constant |
| `CharLiteral(i8)` | Character constant |
| `StringLiteral(String)` | String constant |
| `Ident(String)` | Variable or function name |
| `BinOp { op, lhs, rhs }` | Binary operation |
| `UnaryOp { op, operand }` | Unary operation |
| `Assign { op, target, value }` | Assignment (simple or compound) |
| `FuncCall { func, args }` | Function call |
| `Subscript { array, index }` | Array subscript `a[i]` |
| `Cast { ty, expr }` | Type cast |
| `SizeOf(CType)` | `sizeof` operator |
| `Conditional { cond, then_expr, else_expr }` | Ternary `? :` |
| `Comma(Vec<Expr>)` | Comma expression |
| `MemberAccess { expr, member }` | Struct member `.` |
| `PtrMemberAccess { expr, member }` | Struct member `->` |
| `InitList(Vec<Expr>)` | Initializer list `{ a, b, c }` |

### Binary Operators (`BinOp`)

`Add`, `Sub`, `Mul`, `Div`, `Mod`, `BitAnd`, `BitOr`, `BitXor`, `Shl`, `Shr`, `Eq`, `Ne`, `Lt`, `Gt`, `Le`, `Ge`, `LogAnd`, `LogOr`

### Unary Operators (`UnaryOp`)

`Negate`, `BitNot`, `LogNot`, `PreInc`, `PreDec`, `PostInc`, `PostDec`, `AddrOf`, `Deref`

### Assignment Operators (`AssignOp`)

`Assign`, `AddAssign`, `SubAssign`, `MulAssign`, `DivAssign`, `ModAssign`, `AndAssign`, `OrAssign`, `XorAssign`, `ShlAssign`, `ShrAssign`

### Statement Nodes (`StmtKind`)

| Variant | Description |
|---------|-------------|
| `Expr(Expr)` | Expression statement |
| `Compound(Vec<Stmt>)` | Block `{ ... }` |
| `If { cond, then_branch, else_branch }` | If/else |
| `While { cond, body }` | While loop |
| `DoWhile { body, cond }` | Do-while loop |
| `For { init, cond, update, body }` | For loop |
| `Return(Option<Expr>)` | Return statement |
| `Break` | Break |
| `Continue` | Continue |
| `Goto(String)` | Goto label |
| `Label(String)` | Label definition |
| `VarDecl { name, ty, storage, init }` | Local variable declaration |
| `Switch { expr, body }` | Switch statement |
| `Case(Expr)` | Case label |
| `Default` | Default label |
| `AsmBlock { code, params }` | Inline assembly block |

### Top-Level Nodes (`TopLevelKind`)

| Variant | Description |
|---------|-------------|
| `FuncDef { name, params, return_ty, body, storage, is_variadic }` | Function definition |
| `FuncDecl { name, params, return_ty }` | Forward declaration |
| `GlobalVar { name, ty, storage, init }` | Global variable |
| `TypeDecl` | Struct/union/enum type declaration |
| `Typedef { name, ty }` | Type alias |

### Program

```rust
pub struct Program {
    pub top_levels: Vec<TopLevel>,
    pub enum_constants: HashMap<String, i64>,
}
```

The `enum_constants` map stores all named enum values, making them accessible during IR generation as compile-time constants.
