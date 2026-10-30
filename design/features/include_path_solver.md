# Path solver

## Problem

Extension path solver does not match v6asm path solver.

## Assembler (authority):

| Directive | v6asm search order |
|---|---|
| `.include` | 1) dir of the including file 2) "project dir" = **dir of the top-level `.asm`** 3) `-I` dirs 4) **process CWD** (`preprocessor.rs:447-471`) |
| `.incbin` / `.filesize` | 1) project dir (top-level asm dir) 2) CWD — **no** including-file step, **no** `-I` (`assembler.rs:3198-3208`) |

Operand must be a quoted string (`parse_string_arg`), `.incbin` may add `, offset, length`, `.filesize` may be written `NAME .filesize "path"`, and directive names are upper-cased before dispatch (case-insensitive) — while the extension's `.include` regex is case-sensitive and also matches inside `;` comments (documented as intentional).

## Proposed solution


This is
I am thinking of improiving the include path solution:

- when I say `a workspace directory`, I mean CWD. in the debug extension host it will be: `.\` (root).
- dirrectives `.include`, `.incbin`, `.filesize` must share one path solver.
- path solver logic:
  - if it is a full path (global), use it as it.
  - if a path is relative, resolve path relativly in order:
    - a directory of the file containing the directive.
    - a workspace directory.
    - a `*.project.json` directory when a project file is avaiable.
    - a debug source path from DWARF anchored at the `*.project.json` directory when DWARF file table avaiable.
- the extension must not resolve relative paths relative any other workspace dirs.


## Open Questions
