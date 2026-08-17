# C Debug Variables and Expressions Implementation Plan

**Status:** Proposed
**Date:** 2026-08-15
**Owner:** v6vscode maintainers
**Prerequisites:** `v6llvmc-c-debug-metadata-plan.md`, `c-debug-dwarf-metadata-plan.md`, `c-debug-call-stack-plan.md`
**Related roadmap:** `c-debugging-and-call-stack-plan.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

The Variables panel currently exposes machine Registers, Flags, and Raw Stack only. Watch and Debug Console evaluation understand registers and numeric literals but not C locals, parameters, pointers, members, arrays, or selected caller frames.

Semantic C values require active lexical scopes, type metadata, location-list selection, recovered frame registers, CFA/frame base, and bounded memory reads.

## 2. Scope

In scope:

- Parameters, Locals, Statics, Globals, Registers, Flags, and Raw Stack scopes.
- Frame-sensitive variable visibility and shadowing.
- DWARF location evaluation through the metadata API.
- C integer, character, `_Bool`, enum, pointer, array, structure, union, typedef, and qualifier formatting.
- Read-only C expressions for Watch, hover, and Debug Console.
- Optimized-out and unavailable-value diagnostics.

Out of scope:

- Target function calls.
- Assignments and variable mutation.
- Floating-point support until the V6C ABI and producer emit a supported representation.
- Values the compiler has removed without a recoverable location.

## 3. Per-Frame Scopes

For a semantic C frame return scopes in this order:

1. Parameters.
2. Locals.
3. Statics.
4. Globals, marked expensive and paged if needed.
5. Registers.
6. Flags.
7. Raw Stack.

For ASM or metadata-limited frames return the current machine scopes only.

Every scope handle belongs to one frame and stopped generation. Do not share one Locals handle across frames.

## 4. Lexical Visibility and Shadowing

At the selected frame PC:

- Include only lexical ranges containing the PC.
- Order blocks innermost to outermost.
- Bind inline parameters and locals to the selected inline context.
- Preserve variables by DIE identity.
- Present the innermost same-name declaration under its source name.
- Optionally expose shadowed declarations under an `Outer scopes` group.

Do not merge same-name variables or show declarations outside their active scope.

## 5. Location Evaluation

Evaluate each variable using:

- Selected frame PC.
- Recovered frame registers.
- CFA and frame base.
- Stopped-generation memory reader.
- Target byte order and 16-bit address size.

User-visible unavailable states:

- `<optimized out>` when no recoverable location exists.
- `<not available at this location>` for a location-list gap.
- `<unsupported location: DW_OP_...>` for an unsupported operation.
- `<memory unavailable>` when a bounded target read fails.

One bad variable must not suppress sibling values.

## 6. Typed Value Model

Represent evaluated values independently of DAP formatting:

```ts
interface TypedValue {
  type: TypeId;
  storage?: EvaluatedLocation;
  bytes?: Uint8Array;
  address?: number;
  availability: 'available' | 'optimized-out' | 'inactive' | 'unsupported' | 'unreadable';
}
```

Use immutable type IDs and lazy child expansion. Retain addressability so DAP can expose `memoryReference`.

## 7. C Value Formatting

Required formatting:

- Signed and unsigned integers with target width.
- `_Bool` as `true` or `false`.
- Character values with escaped printable representation.
- Enums as `Name (numeric)` when matched.
- Pointers as `0xNNNN` and `NULL` for zero.
- Function pointers with resolved function symbol when available.
- Arrays with indexed children and DAP paging.
- Structures and unions with named members.
- Typedef name in DAP `type` while formatting through the underlying type.
- C qualifiers retained in readable type names.

Populate `type`, `memoryReference`, `namedVariables`, and `indexedVariables` accurately.

## 8. Expansion Safety

Enforce:

- Maximum expansion depth.
- Maximum children per request.
- DAP `start` and `count` paging.
- Recursive-type and pointer-cycle detection.
- Bounded string preview length.
- Address and byte-size validation before memory reads.
- Stale-generation rejection.

Invalid pointers remain visible but fail expansion with a precise diagnostic.

## 9. C Expression Grammar

Implement a pure parser and evaluator. Never execute JavaScript or target code.

First release supports:

- Identifiers.
- Integer, character, and enum constants.
- Parentheses.
- Unary `+`, `-`, `~`, `!`, dereference `*`, and address-of `&`.
- Arithmetic, shifts, bitwise operators, comparisons, and logical operators.
- Array indexing.
- Structure member `.` and pointer member `->`.
- Supported scalar and pointer casts after type-name parsing is available.
- Existing register and global symbol expressions as a compatibility fallback.

Defer assignments, function calls, increment/decrement, comma expressions, and unsupported arithmetic types.

## 10. Frame-Sensitive Name Resolution

Honor DAP `frameId`. Resolve identifiers in this order:

1. Active inline or lexical local.
2. Formal parameter.
3. Function/file static.
4. Global object or enum constant.
5. Explicit supported register alias.

Examples of precise errors:

- `Unknown identifier 'index' in frame bubbleSort`.
- `Cannot dereference optimized-out variable 'node'`.
- `Pointer 0xFFFF is outside readable memory`.
- `Expression requires an unsupported type`.

## 11. DAP Contexts and Capabilities

Support:

- Watch expressions.
- Debug Console evaluation.
- Hover evaluation after bounded-latency tests pass.

Return expandable results through `variablesReference`. Keep `supportsSetVariable` false. Mutation requires a separate design for writable locations, C qualifiers, partial-register writes, aggregate writes, and backend errors.

## 12. Service Decomposition

Extract:

```text
scope-service.ts          scope construction and visibility
variable-service.ts       locations, typed values, and DAP children
c-expression-service.ts   lexer, parser, binding, and evaluation
dap-handle-store.ts       generation-bound variable handles
```

These services consume immutable metadata and the Call Stack stopped context. The adapter remains request orchestration.

## 13. Tests

Unit fixtures:

- Register, stack, memory, constant, frame-relative, and location-list values.
- Location gaps and optimized-out values.
- Shadowed locals and nested blocks.
- Parameters in current and caller frames.
- Signed/unsigned integers, characters, booleans, enums, pointers, arrays, structures, unions, and typedefs.
- Recursive types and invalid pointers.
- Expression precedence, casts, dereference, indexing, and member access.
- Stale frame and variable handles.

Real Extension Host plus emulator tests:

- Select each frame in a three-function chain and inspect parameters/locals.
- Evaluate Watch expressions in current and caller frames.
- Expand a pointer, array, structure, and union from real memory.
- Observe a location transition and an optimized-out value under optimization.
- Verify ASM retains machine scopes only.

## 14. Acceptance Gates

- Variables are shown only in active lexical and location ranges.
- Caller-frame values use recovered caller state, not top-frame registers.
- Unsupported values degrade individually.
- Typed expansion is bounded and paged.
- Watch uses the selected frame and returns expandable typed results.
- No expression executes target code or mutates target state.
- Real-emulator values match known program state.

## 15. Implementation Checklist

- [ ] Add generation-bound scope and variable handles.
- [ ] Add Parameters, Locals, Statics, and paged Globals scopes.
- [ ] Preserve Registers, Flags, and Raw Stack fallback scopes.
- [ ] Resolve active lexical scopes and shadowing.
- [ ] Evaluate register, frame-relative, memory, constant, and location-list values.
- [ ] Distinguish optimized-out, inactive, unsupported, and unreadable values.
- [ ] Format C integers, characters, booleans, and enums.
- [ ] Add pointer and function-pointer formatting and expansion.
- [ ] Add paged arrays.
- [ ] Add structures, unions, typedefs, and C qualifiers.
- [ ] Add recursion, depth, child-count, string, and memory-read limits.
- [ ] Populate DAP type, memory, and child-count fields.
- [ ] Implement the read-only C expression lexer and parser.
- [ ] Bind names against the selected frame and lexical context.
- [ ] Implement scalar operators, address/dereference, indexing, member access, and supported casts.
- [ ] Support Watch and Debug Console contexts.
- [ ] Enable hover evaluation after latency tests pass.
- [ ] Keep assignment, function calls, and variable mutation disabled.
- [ ] Add unit, Extension Host, and real-emulator variable tests.
- [ ] Document supported C expressions and unavailable-value states.