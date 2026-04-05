# Lexer & Preprocessor

## Preprocessor (`preproc.rs`)

**Lines:** 2,242 | **Input:** Raw C source text | **Output:** Expanded source text

The preprocessor operates on raw text before tokenization. It is a standalone module with no sibling imports.

### Features

| Directive | Description |
|-----------|-------------|
| `#include "file"` / `#include <file>` | File inclusion — quoted paths search relative to source, angle-bracket paths search system include dirs |
| `#define NAME value` | Object-like macro |
| `#define NAME(a,b) body` | Function-like macro with parameter substitution |
| `#undef NAME` | Undefine a macro |
| `#ifdef` / `#ifndef` | Conditional compilation (macro existence) |
| `#if` / `#elif` / `#else` / `#endif` | Conditional compilation (expression evaluation) |
| `#error message` | Compilation error directive |
| Line continuations (`\`) | Backslash-newline joining |

### Key Types

- **`Preprocessor`** — Main state: macro map, include paths, file reader callback, conditional stack
- **`MacroDef`** — `ObjectLike { body }` or `FunctionLike { params, body }`
- **`CondState`** — `Active`, `SeenTrue`, `Inactive` (tracks nested `#if` state)
- **`PreprocError`** — Error with message, filename, line, column

### API

```rust
let mut pp = Preprocessor::new();
pp.add_include_path("mydir/");
pp.add_system_include_path("include/");
pp.define("DEBUG", "1");
let expanded = pp.preprocess(source, "main.c")?;
```

### Safety Limits

| Limit | Value |
|-------|-------|
| Maximum `#include` nesting depth | 64 |
| Maximum macro recursion depth | 256 |

### Include Resolution

1. Quoted includes (`"file.h"`) — search relative to the including file's directory, then user include paths
2. Angle-bracket includes (`<file.h>`) — search system include paths only
3. System include dir is auto-detected relative to the compiler executable (`../include/`)

---

## Lexer (`lexer.rs`)

**Lines:** 1,431 | **Input:** Expanded source text | **Output:** `Vec<Token>`

The lexer is a byte-level scanner that converts C source text into tokens. It is a standalone module.

### Token Categories

| Category | Examples |
|----------|---------|
| **Keywords** (~35) | `int`, `char`, `long`, `void`, `if`, `else`, `while`, `for`, `return`, `struct`, `union`, `enum`, `typedef`, `switch`, `case`, `default`, `do`, `break`, `continue`, `goto`, `static`, `extern`, `const`, `unsigned`, `signed`, `sizeof`, `float`, `__stack`, `__global`, `asm` |
| **Operators** | `+`, `-`, `*`, `/`, `%`, `&`, `|`, `^`, `~`, `!`, `<`, `>`, `<<`, `>>`, `==`, `!=`, `<=`, `>=`, `&&`, `||`, `++`, `--`, `->` |
| **Compound assignment** | `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=` |
| **Punctuation** | `(`, `)`, `{`, `}`, `[`, `]`, `;`, `,`, `.`, `?`, `:` |
| **Literals** | Integer (decimal/hex/octal), float, character, string |
| **Identifiers** | Any C identifier |
| **Extensions** | `__stack`, `__global` (storage class modifiers), `asm` keyword |

### Key Type: `Token`

```
Token {
    kind: TokenKind,    // enum with ~100 variants
    value: String,      // raw text of the token
    line: u32,          // 1-based line number
    column: u32,        // 1-based column number
    byte_offset: usize, // byte offset in source (used by asm block parser)
}
```

### Number Parsing

| Format | Prefix | Example |
|--------|--------|---------|
| Decimal | (none) | `42`, `42L`, `42U`, `42UL` |
| Hexadecimal | `0x` / `0X` | `0xFF`, `0x1AUL` |
| Octal | `0` | `077` |
| Float | (decimal with `.` or `e`) | `3.14`, `1e-5`, `0.5f` |

Integer suffixes `U`, `L`, and `UL` are recognized. Float suffix `f` is recognized.

### String & Character Literals

Standard C escape sequences are supported: `\n`, `\t`, `\r`, `\\`, `\'`, `\"`, `\0`, `\a`, `\b`, `\f`, `\v`, and `\xNN` (hex escapes).

### Error Reporting

`LexError` includes the error message and the exact line/column position for diagnostic output.

### API

```rust
let tokens = lexer::tokenize(source)?;
// tokens: Vec<Token>
```
