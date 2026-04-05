# User Guide

## Installation

Download the latest archive from [Releases](https://github.com/parallelno/v6c/releases), extract it, and add the directory to your `PATH`.

## Usage

### Basic Compilation

```bash
v6c source.c -o output.asm
```

### CLI Options

| Option | Description |
|--------|-------------|
| `source.c` | Input C source file(s) |
| `-o`, `--output <path>` | Output assembly file path (default: first input with `.asm` extension) |
| `-l`, `--lst <path>` | Listing file path (default: output path with `.lst` extension) |
| `-i`, `--include <dir>` | Add include search directory |
| `-v`, `--version` | Show version information (`YYYY.MM.DD-HASH`) |
| `-h`, `--help` | Show help message |

Running `v6c` with no arguments prints the help message.

### Examples

```bash
# Compile a single file
v6c hello.c -o hello.asm

# Compile with listing
v6c program.c -o program.asm --lst program.lst

# Compile with extra include path
v6c program.c -o program.asm -i myheaders/

# Multi-file compilation
v6c file1.c file2.c -o program.asm
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `V6C_OPT_PROFILE` | Optimization profile: `default` or `benchmark` |

## Full Build Pipeline

To produce a runnable ROM for the Vector 06C:

```bash
# 1. Compile C to assembly
v6c program.c -o program.asm

# 2. Assemble to ROM
tools/v6asm/v6asm.exe program.asm

# 3. (Optional) Execute in emulator
tools/v6emul/v6emul.exe --rom program.rom
```

## Output Files

### Assembly (`.asm`)

The output is a complete assembly file for the v6asm assembler:

```asm
    .ORG 0x100
    DI
    LXI SP, 0x8000
    CALL main
    HLT

main:
    ; ... compiler-generated code ...
    RET

; --- runtime library (only referenced routines) ---
__mul16:
    ; ...
```

Structure:
1. CRT0 header (ORG, SP init, call main, HLT)
2. Compiler-generated function code
3. Data section (globals, strings, storage)
4. Referenced runtime library routines

### Listing (`.lst`)

The listing file shows address, machine code bytes, and source:

```
0100               .ORG 0x100
0100  F3           DI
0101  31 00 80     LXI SP, 0x8000
0104  CD xx xx     CALL main
0107  76           HLT
```

### Symbols support (`.symbols.json`)

TODO: fill up when implemented.

### Compiler Extensions

| Extension | Description |
|-----------|-------------|
| `__global` | Storage class: force global (static allocation) mode |
| `__stack` | Storage class: force stack mode |
| `asm { }` / `asm(params) { }` | Inline assembly blocks |
| `#pragma unroll` | Loop unrolling hint |

### Target Specifications

| Property | Value |
|----------|-------|
| CPU | Intel 8080 |
| Computer | Vector 06C (Вектор-06Ц) |
| Start address | `0x100` |
| Initial SP | `0x8000` |
| `char` size | 1 byte |
| `int` size | 2 bytes |
| `long` size | 4 bytes |
| Pointer size | 2 bytes |
| `float` size | 4 bytes (IEEE 754, software) |
| Endianness | Little-endian |
