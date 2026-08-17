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
- Active expression location.
- In-scope variable with no active location.
- Optimized-out variable.
- Unsupported or malformed location.

Never reuse a location outside its range.

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

Implement only operations in the V6C compatibility table. Enforce stack depth, operation count, memory-read count, address range, and result-size limits. One unsupported variable must not suppress siblings.

## 10. Call-Frame Information

Parse `.debug_frame` first; add `.eh_frame` only if the V6C contract requires it.

Build:

- Common Information Entries.
- Frame Description Entries.
- PC-indexed unwind rows.
- CFA rules.
- Register recovery rules.
- Return-address register mapping.

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

## 13. Acceptance Gates

- Current ASM and C source breakpoint tests remain green.
- A final v6llvmc ELF builds complete subprogram, type, scope, variable, inline, and CFI indexes.
- Malformed optional metadata does not remove valid line mappings.
- Location evaluation matches real emulator registers and memory.
- CFI evaluation produces the expected physical caller chain for dedicated fixtures.
- Downstream Call Stack and Variables plans consume only public immutable APIs.

## 14. Implementation Checklist

- [ ] Add bounded section and unit readers.
- [ ] Add generic abbreviation, DIE, form, and reference parsing.
- [ ] Resolve indexed strings and addresses.
- [ ] Parse v4/v5 ranges and v5 range lists.
- [ ] Build immutable compilation-unit and subprogram graphs.
- [ ] Build C type, lexical-scope, variable, and inline graphs.
- [ ] Parse expression locations and location lists.
- [ ] Implement the bounded V6C DWARF expression subset.
- [ ] Parse CIE/FDE records and PC-indexed unwind rows.
- [ ] Implement the bounded V6C CFI subset.
- [ ] Add metadata feature detection and diagnostics.
- [ ] Preserve current line, symbol, breakpoint, and ASM APIs during migration.
- [ ] Add deterministic valid and malformed fixtures.
- [ ] Verify locations and CFI against real emulator state.
- [ ] Publish the supported DWARF compatibility table.