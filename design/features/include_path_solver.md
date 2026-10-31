# Unified Include Path Solver

**Status:** Draft; not implemented.

## 1. Overview

This document describes the improvements for `.include`, `.incbin` and `.filesize`
path resolution.

The change includes two projects:
- v6vscode (this repo)
- v6asm (C:\Work\Programming\v6asm)

## 2. Problems

### 2.1 A broken `.include` looks exactly like a working one

`IncludeLinkProvider` always emits a link, even when the target does not exist.

### 2.2 The extension does not support `.incbin` and `.filesize`

Both directives get no link, no definition, no hover.

### 2.3 Inconsistent path resolution rules

- v6asm `.include` already behaves as §3.1.
- v6asm `.incbin` and `.filesize` use only steps 1, 3 and 5 of §3.1.
- The extension does not match v6asm path resolution rules.

## 3. Desired Behavior

### 3.1 Unified Path Resolution Rules

The first existing candidate is selected using the following search order:

1. Absolute operand (used as-is).
2. Document directory.
3. Each `-I` include directory, in the order specified.
4. Project root directory.

Project root directory:
- Extension: `*.project.json` directory.
- v6asm: compiler's process working directory.

### 3.2 Unified Behavior Across the Extension and v6asm

Unified path resolution for `.include`, `.incbin`, and `.filesize` across the
extension and v6asm.

* Unresolved operand (extension): **no link**, plus a single `Error`
  diagnostic on the operand (red squiggle and hover message: `Cannot find file "..."`).
* Resolved operand (extension): **link** to the highest-priority existing candidate.

## 4. Solution

### 4.1 `DW_AT_comp_dir` contains the compilation directory.

v6asm DWARF writer stores a compiler's process working directory in `DW_AT_comp_dir`.

Example:
```
CU count = 2
  CU0 DW_AT_comp_dir ="C:/Work/Programming/v6gel/samples/09_sprite_frame_no_vsync"
  CU1 DW_AT_comp_dir ="C:/Work/Programming/v6gel/engine"
```

### 4.2 `DW_AT_comp_dir` contains the top-level `.asm` file path

v6asm DWARF writer stores the top-level asm path relative to `DW_AT_comp_dir`.

Example:
```shell
cd C:/home/user/project
v6asm src/main.asm
```
might produce:
```
DW_AT_name     = src/main.asm
DW_AT_comp_dir = C:/home/user/project
```

### 4.3 ELF contains `-I` include directories

v6asm DWARF writer stores `-I` include directories into ELF file.
Relative paths are resolved via `DW_AT_comp_dir` in the order specified.

### 4.4 `.debug_line` entries record the operand spelling, not the resolved location

Currently the DWARF writer stores each file as `(file_directory(file), file_name(file))`, with the
directory relative to `comp_dir`.

The DWARF writer must stores each path as the operand spelling.

## TODO: validate and organize in he doc

### Breakpoints
**Breakpoints.** Path matching keeps its suffix rules but becomes unit-scoped: the document is matched
against the file tables of the units that contain it; if two distinct files match, the unit holding the
exact document path wins, then the lowest unit id. The current "ambiguous → no breakpoint"
(`debug-index.ts:344-345`) stops being reachable for a document that belongs to a unit.

#### Incosistency in the directive parsing

Also included in this scope.

- `.include` is recognised by the preprocessor only as `.include` / `.INCLUDE`, only at the start of
  the line, after `;` comment stripping; `'...'` quotes are accepted too (`preprocessor.rs:395-412`);
- other directives are upper-cased before dispatch (`parser.rs:159-161`), so `.incbin` and
  `.filesize` are case-insensitive there.

## 5. Tests

## 6. Documentation Update

## 7. Dependencies, limitations and out of scope

## 8. Open Questions
