# Standard Library

v6c ships with a minimal C standard library implemented in hand-optimized Intel 8080 assembly. C headers provide the function prototypes; the runtime assembly provides the implementations.

## Headers

All headers are in [include/](../include/) and follow C89 conventions:

### `<stdint.h>`

| Type | Definition | Size |
|------|-----------|:---:|
| `int8_t` | `signed char` | 1 |
| `uint8_t` | `unsigned char` | 1 |
| `int16_t` | `signed int` | 2 |
| `uint16_t` | `unsigned int` | 2 |
| `int32_t` | `signed long` | 4 |
| `uint32_t` | `unsigned long` | 4 |

Plus `INT8_MIN/MAX`, `UINT8_MAX`, `INT16_MIN/MAX`, `UINT16_MAX` macros.

### `<stdbool.h>`

- `bool` → `unsigned char`
- `true` → `1`, `false` → `0`

### `<stddef.h>`

- `size_t` → `unsigned int` (16-bit)
- `ptrdiff_t` → `int` (16-bit)
- `NULL` → `((void*)0)`

### `<stdarg.h>`

- `va_list` → `char*`
- `va_start(ap, last)` → `__builtin_va_start(ap, last)`
- `va_arg(ap, type)` → `__builtin_va_arg(ap, type)`
- `va_end(ap)` → (no-op)

### `<limits.h>`

8080-specific numeric limits:

| Macro | Value |
|-------|-------|
| `CHAR_BIT` | 8 |
| `CHAR_MIN` / `CHAR_MAX` | -128 / 127 |
| `INT_MIN` / `INT_MAX` | -32768 / 32767 |
| `UINT_MAX` | 65535 |
| `LONG_MIN` / `LONG_MAX` | -2147483648 / 2147483647 |
| `ULONG_MAX` | 4294967295 |

### `<stdio.h>`

| Function | Signature | Description |
|----------|-----------|-------------|
| `putchar` | `int putchar(int c)` | Write character to console |
| `getchar` | `int getchar(void)` | Read character from console |
| `puts` | `int puts(const char *s)` | Write string + newline |
| `printf` | `int printf(const char *fmt, ...)` | Formatted output |

Constants: `NULL`, `EOF` (-1)

### `<stdlib.h>`

| Function | Signature | Description |
|----------|-----------|-------------|
| `atoi` | `int atoi(const char *s)` | String to integer |
| `abs` | `int abs(int x)` | Absolute value |
| `rand` | `int rand(void)` | Pseudo-random number (LCG) |
| `srand` | `void srand(unsigned int seed)` | Seed random generator |
| `malloc` | `void *malloc(unsigned int size)` | Allocate heap memory |
| `free` | `void free(void *ptr)` | Free heap memory |

Constants: `RAND_MAX` (32767), `EXIT_SUCCESS` (0), `EXIT_FAILURE` (1)

### `<string.h>`

| Function | Signature | Description |
|----------|-----------|-------------|
| `memcpy` | `void *memcpy(void *dst, const void *src, unsigned int n)` | Copy n bytes |
| `memmove` | `void *memmove(void *dst, const void *src, unsigned int n)` | Copy with overlap handling |
| `memset` | `void *memset(void *s, int c, unsigned int n)` | Fill n bytes |
| `memcmp` | `int memcmp(const void *a, const void *b, unsigned int n)` | Compare n bytes |
| `strlen` | `unsigned int strlen(const char *s)` | String length |
| `strcmp` | `int strcmp(const char *a, const char *b)` | String compare |
| `strncmp` | `int strncmp(const char *a, const char *b, unsigned int n)` | Bounded string compare |
| `strcpy` | `char *strcpy(char *dst, const char *src)` | String copy |
| `strncpy` | `char *strncpy(char *dst, const char *src, unsigned int n)` | Bounded string copy |
| `strcat` | `char *strcat(char *dst, const char *src)` | String concatenate |
| `strncat` | `char *strncat(char *dst, const char *src, unsigned int n)` | Bounded concatenate |
| `strchr` | `char *strchr(const char *s, int c)` | Find char (forward) |
| `strrchr` | `char *strrchr(const char *s, int c)` | Find char (reverse) |

## Printf Format Specifiers

The `printf` implementation supports:

| Specifier | Description |
|-----------|-------------|
| `%d` / `%i` | Signed decimal integer |
| `%u` | Unsigned decimal integer |
| `%x` / `%X` | Hexadecimal (lower/upper) |
| `%o` | Octal |
| `%c` | Character |
| `%s` | String |
| `%%` | Literal percent |
| `%ld` / `%lu` / `%lx` | Long (32-bit) variants |

Uses repeated subtraction for decimal digit extraction (no division required).

## Heap Allocator

The `malloc`/`free` implementation uses a **bump allocator with free-list**:
- 2-byte size header per allocation
- Heap starts at `__heap_start` (placed after all static data)
- Heap grows upward toward 0xF000 (limit)
- `free()` adds blocks to a free-list; `malloc()` checks the free-list first before bumping
- No coalescing of adjacent free blocks

## Calling Convention for Library Functions

All library functions follow the v6c calling convention:
- First argument in HL (16-bit) or A (8-bit)
- Second argument in DE
- Additional arguments on the stack
- Return value in HL (16-bit) or A (8-bit)
