# C Debug DWARF Metadata Consumer Plan

**Status:** Proposed
**Date:** 2026-08-15
**Owner:** v6vscode maintainers
**Producer prerequisite:** `v6llvmc-c-debug-metadata-plan.md`
**Related roadmap:** `c-debugging-and-call-stack-plan.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

The current metadata layer parses ELF32 symbols, DWARF v4/v5 line tables, compilation directories, and a narrow constant subset. Semantic C debugging requires a bounded, version-neutral consumer for DIEs, references, strings, indexed addresses, ranges, types, scopes, variable locations, inline calls, and CFI.

Growing the existing version-specific readers would couple unrelated metadata and make partial failure unsafe. Optional unsupported data must not break source lines or baseline ASM debugging.

## 2. Scope

In scope:

- V6C ELF32 little-endian files with 16-bit CPU addresses.
- DWARF v5 emitted by v6llvmc and existing DWARF v4 line compatibility.
- Type, subprogram, lexical, variable, inline, range, location, and CFI indexes.
- Bounded DWARF expression and CFI evaluators.
- Feature detection and diagnostics for downstream DAP services.

Out of scope:

- DAP frame or variable presentation.
- C expression parsing.
- Heuristic stack unwinding.
- Forms and operations not emitted by the agreed V6C producer contract.

## 3. Module Structure

Introduce focused modules under `src/debug/metadata/`:

```text
dwarf-sections.ts          section access and bounds checks
dwarf-reader.ts            unit headers, DIE traversal, forms, references
dwarf-strings.ts           str, line_str, and str_offsets
dwarf-addresses.ts         addr and addrx resolution
dwarf-ranges.ts            v4 ranges and v5 rnglists
dwarf-locations.ts         exprloc and loclists
dwarf-types.ts             immutable C type graph
dwarf-scopes.ts            subprogram, lexical, variable, and inline graph
dwarf-expression.ts        bounded location-expression evaluator
dwarf-cfi.ts               CIE/FDE parser and CFI evaluator
debug-metadata-index.ts    immutable debugger query facade
```

Preserve existing line and symbol APIs through adapters during migration.

## 4. DIE and Form Reader

Represent DIE identity by compilation unit plus section offset. Resolve references lazily with cycle detection.

Requirements:

- DWARF32 unit lengths and v4/v5 unit headers.
- Abbreviation tables and child boundaries.
- CU-relative and section-relative references used by V6C.
- Indexed string and address bases.
- Fixed-width and LEB128 constants.
- Flags, implicit constants, section offsets, expressions, ranges, and location-list indexes.
- Strict bounds checks and useful offset diagnostics.

A malformed optional attribute degrades that entity or compilation unit without invalidating independently valid line tables.

## 5. Immutable Metadata Graph

Build stable IDs and immutable entities for:

- Compilation units.
- Subprograms.
- Lexical blocks.
- Inline subroutines and abstract origins.
- Formal parameters, locals, statics, and globals.
- Declaration locations.
- C type DIEs.

Cache reference resolution and detect cycles. Do not retain mutable parser cursors in public indexes.

## 6. C Type Graph

Support:

- Integer, character, and `_Bool` base types.
- Enumerations.
- Pointers and function pointers.
- Arrays and subranges.
- Structures and unions.
- Members and bit/byte offsets emitted by V6C.
- Typedefs and C type qualifiers.
- Subroutine types.

Expose byte size, signedness/encoding, display name, underlying type, members, enumerators, and array bounds. Protect recursive types with IDs and depth limits.

## 7. Ranges and Scope Indexes

Parse low/high PC pairs and range lists into half-open ranges.

Indexes must answer:

- Physical subprogram containing a PC.
- Active lexical scope chain.
- Active inline chain ordered outermost to innermost.
- Variables visible at a PC.
- Statement rows and next distinct logical source locations.
- FDE and CFI row covering a PC.

Test empty, overlapping, discontinuous, relocated, and indexed ranges.

## 8. Variable Locations

Represent single expressions and location lists without evaluating them during parsing.

At query time select the entry whose half-open PC range contains the selected frame PC. Distinguish:

- Constant value.
- Static-home address (`DW_OP_addrx`, optionally with `DW_OP_plus_uconst`). At `-O0`, many locals and parameters are promoted to fixed global addresses rather than stack slots.
- Active expression location.
- In-scope variable with no active location.
- Optimized-out variable.
- Unsupported or malformed location.

Never reuse a location outside its range. Do not assume a variable location is frame-relative; static-home and register locations are common.

## 9. DWARF Expression Evaluator

Evaluate against an explicit context containing selected-frame registers, CFA, frame base, target byte order, address size, and a bounded memory reader.

Initial results:

```ts
type EvaluatedLocation =
  | { kind: 'memory'; address: number; byteSize?: number }
  | { kind: 'register'; register: number }
  | { kind: 'value'; bytes: Uint8Array }
  | { kind: 'pieces'; pieces: LocationPiece[] }
  | { kind: 'unavailable'; reason: string };
```

Implement the operations verified in current V6C output. The producer doc `V6CDebugMetadata.md` currently names only `DW_OP_fbreg`, `DW_OP_addr`, `DW_OP_addrx`, and `DW_OP_plus_uconst`, but real `-O2` location lists also emit the following, which the evaluator must support:

- `DW_OP_reg0..N` and `DW_OP_breg0..N`.
- `DW_OP_consts`.
- `DW_OP_plus`, `DW_OP_minus`, `DW_OP_div`.
- `DW_OP_stack_value`.
- `DW_OP_call_frame_cfa` (used by `DW_AT_frame_base`).

Treat this list as the authoritative subset until the producer publishes a complete opcode table; `DW_OP_div` in particular is easy to omit. Enforce stack depth, operation count, memory-read count, address range, and result-size limits. One unsupported variable must not suppress siblings.

## 10. Call-Frame Information

Parse `.debug_frame` first; add `.eh_frame` only if the V6C contract requires it.

Build:

- Common Information Entries.
- Frame Description Entries.
- PC-indexed unwind rows.
- CFA rules.
- Register recovery rules.
- Return-address register mapping.

The CFI operations verified in current V6C output are `DW_CFA_def_cfa`, `DW_CFA_offset`, `DW_CFA_advance_loc`, `DW_CFA_undefined`, and `DW_CFA_nop`. The CIE uses code alignment 1, data alignment -2, and return-address column 11 (PC). A `DW_CFA_undefined` return address marks an honest unwind boundary (naked runtime helpers, interrupt/trampoline frames).

The CFI evaluator returns verified caller state or a precise stop reason. It must reject cycles, unchanged CFA, invalid memory, unsupported expressions, and excessive depth.

## 11. Feature Detection

Expose artifact-level and compilation-unit-level features:

```ts
interface DebugMetadataFeatures {
  lines: boolean;
  subprograms: boolean;
  types: boolean;
  lexicalScopes: boolean;
  variableLocations: boolean;
  inlineFrames: boolean;
  callFrameInfo: boolean;
}
```

Downstream services gate only dependent behavior. A file with valid lines but unsupported locations still supports breakpoints and highlighting.

## 12. Tests and Fixtures

Use checked-in minimal fixtures or deterministic fixture scripts, not mutable `temp/` files in ordinary unit tests.

Cover:

- Every supported form, tag, range entry, location entry, expression operation, and CFI operation.
- Truncation, overflow, bad references, bad list indexes, recursive types, and unsupported operations.
- V6C 16-bit wrapping and little-endian values.
- Scope containment and shadowing.
- Location transitions and gaps.
- Inline-chain ordering.
- CFI success and each honest unwind stop.
- DWARF v4 line compatibility and ASM regression.

## 13. Live-Emulator State Bridge

Static parsing alone does not complete the consumer. The evaluators operate on live stopped state, so the plan must include the bridge from emulator IPC to `DwarfEvalContext`. v6emul already provides the required commands; no protocol change is needed.

### 13.1 Register mapping

Translate `GET_REGS` (command 11) into the frozen V6C DWARF register numbers (A=0, B=1, C=2, D=3, E=4, H=5, L=6, BC=7, DE=8, HL=9, SP=10, PC=11). Produce `DwarfEvalContext.registers`. FLAGS/PSW are intentionally unnumbered.

### 13.2 Memory reader

Wrap `GET_MEM` (command 93) and `GET_STACK_SAMPLE` (command 18) into a `readMemory(address, byteSize)` callback with 16-bit bounds checks and wrap handling. This feeds both `DW_OP_deref` and CFI unwinding (which reads `PC=[CFA-2]`).

### 13.3 Real-stop verification

Stop the real emulator inside a known function (the `temp/cdbg` probe), read live registers/memory, and:

1. Evaluate a known local variable and confirm the resolved address/value matches the program's expected state.
2. Unwind a real nested call chain and confirm recovered caller CFA/SP/PC match the live stack.

### 13.4 Feature test

Add a gated real-emulator scenario (Extension Host integration or `test/features/`, keyed on `V6EMUL`) that loads the probe ELF, stops at a breakpoint, and asserts a variable location and a caller frame are recovered from live state.

## 14. Supported DWARF Compatibility Table

This is the exact subset the consumer implements and the v6llvmc producer emits. It is the versioned contract both repositories test against. Verified against `temp/cdbg/probe-O0.elf` and `probe-O2.elf` on 2026-08-16.

### 14.1 Object and section format

| Item | Value |
|---|---|
| Object format | ELF32, little-endian |
| Machine | `EM_V6C` (0x8080) |
| Address size | 2 bytes (16-bit CPU addresses) |
| DWARF format | v5 (DWARF32); v4 line tables remain a compatibility case |

### 14.2 Sections

| Section | Purpose |
|---|---|
| `.debug_info` | DIE tree (units, subprograms, variables, types, scopes, inline) |
| `.debug_abbrev` | Abbreviation tables |
| `.debug_line` | Source line programs (v4 and v5) |
| `.debug_str` / `.debug_line_str` | String tables |
| `.debug_str_offsets` | Indexed string base offsets (strx) |
| `.debug_addr` | Indexed address table (addrx) |
| `.debug_rnglists` | Subprogram/lexical/inline PC ranges |
| `.debug_loclists` | Variable location lifetimes (optimized builds) |
| `.debug_frame` | Call-frame information (CIE/FDE unwind rules) |

### 14.3 DIE tags

`compile_unit`, `subprogram`, `formal_parameter`, `variable`, `lexical_block`, `inlined_subroutine`, `base_type`, `pointer_type`, `typedef`, `array_type`, `subrange_type`, `structure_type`, `union_type`, `member`, `enumeration_type`, `enumerator`, `subroutine_type`, `unspecified_type`.

### 14.4 Attribute forms

| Category | Forms |
|---|---|
| Strings | `string`, `strp`, `line_strp`, `strx`, `strx1`–`strx4` |
| Addresses | `addr`, `addrx`, `addrx1`–`addrx4` |
| References | `ref4` (CU-relative); `ref1`/`ref2`/`ref8`/`ref_udata`/`ref_addr` decoded |
| Constants | `data1/2/4/8/16`, `sdata`, `udata`, `implicit_const`, `flag`, `flag_present` |
| Sections/lists | `sec_offset`, `rnglistx`, `loclistx` |
| Expressions | `exprloc`, `block`, `block1/2/4` |

### 14.5 Location expression operations

`DW_OP_addr`, `DW_OP_addrx`, `DW_OP_plus_uconst`, `DW_OP_reg0..31`, `DW_OP_breg0..31`, `DW_OP_lit0..31`, `DW_OP_fbreg`, `DW_OP_call_frame_cfa`, `DW_OP_consts`, `DW_OP_plus`, `DW_OP_minus`, `DW_OP_div`, `DW_OP_deref`, `DW_OP_stack_value`.

`DW_OP_piece` is deferred until the producer emits split values.

### 14.6 Call-frame operations

`DW_CFA_def_cfa`, `DW_CFA_def_cfa_register`, `DW_CFA_def_cfa_offset`, `DW_CFA_offset`, `DW_CFA_advance_loc`, `DW_CFA_advance_loc1/2/4`, `DW_CFA_set_loc`, `DW_CFA_undefined`, `DW_CFA_same_value`, `DW_CFA_register`, `DW_CFA_remember_state`, `DW_CFA_restore_state`, `DW_CFA_nop`.

CIE: code alignment 1, data alignment -2, address size 2, return-address column 11 (PC). A `DW_CFA_undefined` return-PC rule marks an honest unwind boundary.

### 14.7 DWARF register map (contract version 1)

| Number | Register | Width |
|---|---|---|
| 0 | A | 8 |
| 1 | B | 8 |
| 2 | C | 8 |
| 3 | D | 8 |
| 4 | E | 8 |
| 5 | H | 8 |
| 6 | L | 8 |
| 7 | BC | 16 |
| 8 | DE | 16 |
| 9 | HL | 16 |
| 10 | SP | 16 |
| 11 | PC | 16 (CFI return-address column) |

FLAGS and PSW are intentionally unnumbered.

### 14.8 Unsupported / degraded behavior

Anything outside this table yields an `unavailable` result for that single entity — never a failed debug session or a lost line table. Optimized-out and inactive-range variables are reported, not reconstructed.

## 15. Acceptance Gates

- Current ASM and C source breakpoint tests remain green.
- A final v6llvmc ELF builds complete subprogram, type, scope, variable, inline, and CFI indexes.
- Malformed optional metadata does not remove valid line mappings.
- Location evaluation matches real emulator registers and memory.
- CFI evaluation produces the expected physical caller chain for dedicated fixtures.
- Downstream Call Stack and Variables plans consume only public immutable APIs.

## 16. Implementation Checklist

- [x] Add bounded section and unit readers.
- [x] Add generic abbreviation, DIE, form, and reference parsing.
- [x] Resolve indexed strings and addresses.
- [x] Parse v4/v5 ranges and v5 range lists.
- [x] Build immutable compilation-unit and subprogram graphs.
- [x] Build C type, lexical-scope, variable, and inline graphs.
- [x] Parse expression locations and location lists.
- [x] Implement the bounded V6C DWARF expression subset.
- [x] Parse CIE/FDE records and PC-indexed unwind rows.
- [x] Implement the bounded V6C CFI subset.
- [x] Add metadata feature detection and diagnostics.
- [x] Preserve current line, symbol, breakpoint, and ASM APIs during migration.
- [x] Add deterministic valid and malformed fixtures.
- [x] Verify locations and CFI against real emulator state.
- [x] Translate GET_REGS into the DWARF register map for the evaluation context.
- [x] Build a bounded GET_MEM/GET_STACK_SAMPLE-backed memory reader with 16-bit wrapping.
- [x] Evaluate a known local and unwind a real call chain against a live stop.
- [x] Add a gated real-emulator consumer feature test (keyed on V6EMUL).
- [x] Publish the supported DWARF compatibility table.