# Unified Include Path Solver

**Status:** Draft; not implemented.
**Verified against:** v6vscode `752bf00` (0.3.1) and the v6asm sources
(`crates/v6_core/src/preprocessor.rs`, `assembler.rs`, `object/dwarf.rs`), using the real artifact in
`temp/project/build/09_sprite_frame_no_vsync/`.
**Owner area:** `src/language/includes/`, `src/debug/metadata/`, `src/platform/files/`.
**Related:** `design/features/path-resolution-architecture-investigation.md`,
`docs/architecture.md` (Source path ownership), `docs/language-support.md` (Source Links),
`docs/architecture-owners.md`.

## 1. Problems

### 1.1 A broken `.include` looks exactly like a working one

`IncludeLinkProvider` anchors every operand to the directory of the containing document
(`include-link-provider.ts:10-21`, `include-resolution.ts:38-41`) and always emits a link, even when
the target does not exist. Following such a link opens nothing, and no error is reported anywhere.

Reproduction in the extension host workspace `temp/project`, file
`samples/common/09_sprite_frame_no_vsync/main.asm`:

| Line | Operand | Link target built by the extension | Target that exists |
|---|---|---|---|
| 17 | `../../engine/common/v6_macros.asm` | `...\samples\engine\common\v6_macros.asm` | `temp\project\engine\common\v6_macros.asm` |
| 28 | `build/09_sprite_frame_no_vsync/levels/asm/lv0_gfx_meta.asm` | `...\09_sprite_frame_no_vsync\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm` | `temp\project\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm` |

Line 17 is additionally affected by this copy's layout, which places the sample one directory deeper
than v6asm expects; line 28 is structural (`build/...` is root-relative by design, see §3.1 and §4.3).

### 1.2 `.incbin` and `.filesize` have no support

Both directives exist only as keywords in `res/syntaxes/v6vscode_8080.tmLanguage.json:144`. Their
operands get no link, no definition, no hover and no diagnostic, even though every generated
`*_meta.asm` uses `.filesize` on its asset.

### 1.3 The editor and v6asm search different places

The editor and v6asm used different path resolution rules. A project that builds
correctly can therefore show broken links in the extention host.

## 2. Desired behavior

R1. Unresolved operand of any of the three directives: **no link**, plus one `Error` diagnostic over
the operand — red squiggle, message in the hover and in the Problems panel (`Cannot find include
file "..."`; `.incbin`/`.filesize`: `Cannot find file "..."`). The mechanism is specified in §5.6.
R2. Resolved operand: **link only**, to the highest-priority existing candidate (§5.2 defines the
priority).
R3. One candidate list for `.include`, `.incbin` and `.filesize` (§3.1).
R4. Path candidates order is deterministic (§5.2).
R5. Keep what is already correct: operand-only link ranges, emoji/CRLF offset handling and absolute
operands used verbatim. Symbol hover values and constant navigation stay as they are; label navigation
changes only as described in §9 (B4).

## 3. v6asm behavior (reference)

### 3.1 Target contract: one candidate list for all three directives

The design target is a single search list shared by `.include`, `.incbin` and `.filesize`:

1. absolute operand, used as is;
2. directory of the file containing the directive;
3. directory of the top-level `.asm` ("top-level asm dir");
4. each `-I` include directory, in order;
5. process CWD.

### 3.2 Current v6asm behavior

`.include` already behaves as §3.1: step 1 is the absolute short-circuit (the operand is used as it is),
steps 2-5 are `preprocessor.rs:447-471`. `.incbin` and `.filesize` use only steps 1, 3 and 5 — no
including-file step and no `-I` (`assembler.rs:3198-3208`).

### 3.3 Operand parsing

- quoted string only (`parse_string_arg`, `parser.rs:1072-1081`);
- `.incbin` may add `, offset, length` (`parser.rs:508-523`);
- `.filesize` may be written `NAME .filesize "path"` or `.filesize "path"`
  (`parser.rs:204-210`, `:734-737`);
- `.include` is recognised by the preprocessor only as `.include` / `.INCLUDE`, only at the start of
  the line, after `;` comment stripping; `'...'` quotes are accepted too (`preprocessor.rs:395-412`);
- other directives are upper-cased before dispatch (`parser.rs:159-161`), so `.incbin` and
  `.filesize` are case-insensitive there.

## 4. Verification results

All measurements below come from the sample ELF in `temp/project/build/09_sprite_frame_no_vsync/`
and from running v6asm on the same source.

### 4.1 `DW_AT_comp_dir` is the top-level source directory of a linked object

`main.rs:339` derives `source_dir` from `source_path.parent()`, `main.rs:381` passes it to
`Assembler::new`, and `output.rs:213` hands `asm.project_dir()` to the DWARF writer, which stores it as
`DW_AT_comp_dir` (`dwarf.rs:349`). Measured:

```
CU count = 2
  CU0 compDir="C:/Work/Programming/v6gel/samples/09_sprite_frame_no_vsync" stmtList=0
  CU1 compDir="C:/Work/Programming/v6gel/engine"                          stmtList=2103
```

So `comp_dir` is the top-level asm dir of §3.1 step 3, per compilation unit. The extension's
`LoadResult.compDir` exposes only the first absolute comp dir, which depends on link order
(`main.o` happens to be linked first in the sample Makefile); §5.3 removes it.

### 4.2 `.debug_line` entries record the operand spelling, not the resolved location

The writer stores each file as `(file_directory(file), file_name(file))` (`dwarf.rs:923-946`), with the
directory relative to `comp_dir`. The testable main CU has nine such entries; three representative ones:

| `.debug_line` entry (dir / file) | joined with the CU's `comp_dir` | exists? | where the file really is |
|---|---|---|---|
| `../../engine/common` / `v6_consts.asm` | `...\v6gel\samples\09_...\..\..\engine\common\v6_consts.asm` → `...\v6gel\engine\common\v6_consts.asm` | yes | same path |
| `build/09_sprite_frame_no_vsync/levels/asm` / `lv0_gfx_meta.asm` | `...\v6gel\samples\09_...\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm` | **no** | `...\v6gel\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm` |
| *(none)* / `main.asm` | `...\v6gel\samples\09_...\main.asm` | yes | same path |

The second row was satisfied by the CWD step, so v6asm recorded `comp_dir + operand`, which is not the
file it read — not even at the build site. The extension joins entries to `comp_dir`
(`dwarf4-line-reader.ts:472-501`) and therefore inherits that path. Confirmed by running v6asm:

- from the repository root → preprocessing succeeds (it only stops later on unresolved linker
  symbols, which need `-D`);
- from `samples\09_sprite_frame_no_vsync` → `error: Cannot find include file: build/09_sprite_frame_no_vsync/palettes/asm/pal_lv0_meta.asm --> main.asm:25`.

For files resolved by step 2 (including-file dir), `comp_dir + operand` is correct; for files resolved by
`-I` (step 4) or the CWD (step 5) it is structurally wrong.

### 4.3 What the extension exposes today

`decodeDebugArtifact` publishes one merged `compDir` (the first absolute one) and one merged file list
(`debug-artifact-loader.ts:147,156,187`). Downstream, `buildDebugIndex` normalizes every row and every
declaration against that single `compDir` (`debug-index.ts:109-111,175-177`) and exposes the sorted union
as `sourceFiles` (`debug-index.ts:174-185`, `debug-symbol-service.ts:102-104`).

Three consequences are visible in the code:

- unit identity is dropped exactly where it would help: a row no longer knows which CU produced it;
- breakpoint matching returns *nothing* when the requested path matches several indexed files
  (`debug-index.ts:339-345`);
- label lookup iterates the union in list order (`symbol-link-service.ts:207,236`), so "first file that
  contains `label:`" decides which copy is opened.

The per-CU line tables and the comp-dir map already exist inside the loader (`buildLineCompDirs`,
`filesForUnit`); they are simply not published.

### 4.4 Why label navigation works while include links do not

`SymbolLinkProvider.provideDefinition` resolves the metadata file name with
`resolveDebugSourcePath(source.file, projectSourceRoot(project))` (`symbol-link-provider.ts:159-163`),
which relocates foreign absolute paths by **longest existing trailing segment**
(`debug-source-path.ts:23-52,66-74`). Measured for `temp/project`:

| Token | Metadata path | Opened |
|---|---|---|
| `lv0_gfx_init` | `...\v6gel\samples\09_...\build\...\lv0_gfx_meta.asm:23` | `temp\project\build\09_...\lv0_gfx_meta.asm` (exists) |
| `PALETTE_UPD_REQ_YES` | `...\v6gel\engine\common\v6_consts.asm:25` | `temp\project\engine\common\v6_consts.asm` (exists) |
| `room_init` | `...\v6gel\samples\09_sprite_frame_no_vsync\main.asm:410` | the **v6gel** copy (the suffix `main.asm` has no workspace match) |

Symbols reach into `build/...` files only because the suffix survives, not because the recorded path is
usable.

## 5. Design

### 5.1 One candidate list for all three directives

The solver is a pure function with an injected existence predicate (the shape of
`resolveDebugSourcePath(sourcePath, projectRoot, exists)`). It returns the resolved path, or nothing
when no candidate exists. The list is identical for `.include`, `.incbin` and `.filesize`, in the
priority order of §5.2.

### 5.2 Search order and priority

Priority *N* is §3.1 step *N*: the table mirrors the v6asm list one-to-one and never promotes a later
step above an earlier one. Candidate 4 (`-I`) is not modeled (§12.2), so the solver walks 1, 2, 3, 5 and
returns the first candidate that exists. If none exists, the operand is unresolved (§5.6).

| Priority | Anchor | Source | Rationale |
|---|---|---|---|
| 1 | absolute operand, used verbatim | `path.isAbsolute` | §3.1 step 1; an absolute operand is never anchored and keeps its spelling |
| 2 | directory of the containing document | `document.uri` | §3.1 step 2; already correct today |
| 3 | `comp_dir` of **every unit that lists the document** (in unit order) | per-unit data (§5.3) | §3.1 step 3 of each such build: `comp_dir` is the directory of the `.asm` v6asm was invoked on (`main.rs:339` → `main.rs:381` → `output.rs:213` → `dwarf.rs:349`). A unit whose `comp_dir` is not absolute contributes nothing. |
| 4 | `-I` include directories | not modeled (§12.2) | §3.1 step 4 |
| 5 | **CWD directory** | the extension host's current working directory (`process.cwd()`) | §3.1 step 5. The project is built from this directory — the Makefile runs v6asm from it — so `build/...` resolves against it. |

Ordering rules:

- **the order is §3.1's order** — no step is ever promoted; the editor and v6asm agree whenever both
  see the same anchors;
- **the highest-priority existing candidate wins, silently** — no ambiguity analysis, no candidate
  reporting (R2);
- **`comp_dir` is a build-site path** — relocate it before probing (§4.1); being tried before the CWD is
  intended, because that is the order v6asm uses.

### 5.3 Unit model: one CU is one v6asm build

A CU is exactly one v6asm invocation: one top-level `.asm`, one `comp_dir` (the directory of that file),
one include graph (its `.debug_line` file table). Nothing in the artifact is global, so the metadata layer
keeps that boundary instead of flattening it.

```ts
interface DebugUnit {
    readonly id: number;                 // CU order in the artifact
    readonly compDir: string;            // build root of this invocation ('' when not absolute)
    readonly files: readonly string[];   // this CU's file table, resolved against its own compDir
}
```

| Today (§4.3) | This design |
|---|---|
| `LoadResult.compDir` = first absolute comp dir | removed; every unit carries its own `compDir` |
| `DebugIndex.sourceFiles` = sorted union of all CUs | removed; `DebugIndex.units` is the model |
| rows and declarations normalized against one `compDir` (`debug-index.ts:109-111,175-177`) | normalized against the unit that produced them; `SourceLocation` / `StatementRow` carry `unit` |
| label lookup scans the union in list order | symbol attributed through its address (§5.4) |

`buildLineCompDirs` already resolves each line program against its own comp dir
(`debug-artifact-loader.ts:47-55`) and `parseDwarf4LineSection` walks the programs in order, so tagging
each row with its program index is a local change, not a rewrite.

### 5.4 Attribution instead of ownership

**Include operand.** Candidate 3 is the `comp_dir` of **every unit whose file table contains the
document**, in unit order — no ownership choice:

- `main.asm` belongs to the sample CU → one candidate, `...\samples\09_sprite_frame_no_vsync`;
- `v6_consts.asm` is included by the sample build and by the engine build → two candidates, the sample
  dir then the engine dir; the first existing one wins (§5.2), and each is the step-2 anchor of a real
  v6asm invocation;
- a file that no unit contains (a brand-new include target) contributes no candidate.

Membership is a fact taken from the file table: no "first CU that mentions the file", no
comp_dir-containment rule, no preference for "the project's own CU".

**Symbols and labels.** A symbol is attributed through the address the artifact already maps to one unit:

1. DWARF declaration present (constants, macros) → it carries file + line, use it;
2. otherwise `resolveAddress(symbol.address)` → row → `unit`; search `label:` in that unit's file table,
   starting with the row's own file;
3. otherwise the nearest following statement row supplies the unit, same search;
4. otherwise no navigation.

That deletes the global scan and its "first match in list order" tie-break, and makes label navigation
point at the code the address belongs to.

**Breakpoints.** Path matching keeps its suffix rules but becomes unit-scoped: the document is matched
against the file tables of the units that contain it; if two distinct files match, the unit holding the
exact document path wins, then the lowest unit id. The current "ambiguous → no breakpoint"
(`debug-index.ts:344-345`) stops being reachable for a document that belongs to a unit.

### 5.5 Operand handling

- the operand text is never rewritten; candidate paths are built with `path.resolve`, which normalizes
  `.`/`..` and duplicate separators for the existence probe only;
- the link range and the diagnostic range cover the original operand bytes, so emoji/CRLF offsets stay
  correct;
- existence is checked with the injected predicate only; no other candidate property is inspected,
  because the highest-priority existing candidate wins (§5.2).

### 5.6 UI outcome

The provider has exactly two outcomes:

| Outcome | Link | Diagnostic | Hover |
|---|---|---|---|
| a candidate exists | link to that file | none | **unchanged**: VS Code's standard link tooltip showing the target path |
| no candidate exists | **no link** (Ctrl+Click does nothing) | **Error** over the operand: `Cannot find include file "…"` (`.incbin`/`.filesize`: `Cannot find file "…"`) | the diagnostic message |

#### How the message is displayed

There is no toast and no notification, and no new hover content is added. The message **is** a VS Code
diagnostic — we supply only the range and the text, and VS Code renders it:

```ts
const diagnostic = new vscode.Diagnostic(
    operandRange,                            // the quoted operand only
    `Cannot find include file "${operand}"`, // operand as written, never a resolved candidate
    vscode.DiagnosticSeverity.Error,
);
diagnostic.source = 'v6asm';
collection.set(document.uri, diagnostics);
```

| Surface | What the user sees | Provided by |
|---|---|---|
| inline decoration | red squiggle under the operand | VS Code diagnostic renderer |
| hover over the squiggle | the message text, e.g. `Cannot find include file "build/…/lv0_gfx_meta.asm"` | VS Code built-in marker hover — **no `HoverProvider` is registered** |
| Problems panel | one entry per unresolved operand with file/line, clickable | VS Code |
| status bar | error count for the open file | VS Code |
| Ctrl+Click on the operand | nothing happens (no link is emitted) | our link provider |

Because no `DocumentLink` exists for that range, the hover contains only the diagnostic, which is
exactly the broken-TypeScript-import experience.

Rules:

- messages: `.include` → `Cannot find include file "<operand>"`; `.incbin` / `.filesize` →
  `Cannot find file "<operand>"`; the operand is reproduced exactly as written;
- the diagnostic range is the quoted operand only, `source: 'v6asm'`, severity `Error`; no `Warning`
  severity is used anywhere in this feature;
- diagnostics are recomputed with the same resolution as the links (on open and on change), so the
  squiggle appears while typing — no save or build is required;
- one `DiagnosticCollection` (`v6-asm-directives`) owned by the provider; its entries are replaced for
  the document on every resolution pass and deleted when the document closes, so a stale squiggle
  cannot survive an edit or a rename;
- the document link keeps its `DocumentLink.tooltip` exactly as today (unset, so VS Code renders the
  target path); no custom tooltip string is set, no directive hover provider is registered, and no
  anchor/candidate text is shown. Which anchor matched is an implementation detail (§5.2) and is
  asserted in tests only.

### 5.7 Caching and lifecycle

- cache per `(document.uri, document.version, artifact.version, operand)`; invalidate on
  `onDidChangeTextDocument`, `onDidCloseTextDocument`, `onDidChangeWorkspaceFolders` and artifact
  reload — the shape already used by `DebugSourceSymbolLinkService` (`symbol-link-service.ts:130-135`,
  `language-services.ts:34-35`);
- the artifact is versioned by content hash (`artifact-repository.ts:70-92`), so a rebuild invalidates
  naturally and no file watching is required;
- diagnostics are derived from the same cached resolution, so one walk per change serves both features;
  a resolved operand must clear its previous diagnostic.

## 6. Solver interface (host-free)

```ts
export interface DirectiveContext {
    /** Directory of the document containing the directive. */
    sourceDir: string;
    /** Directory of the selected *.project.json, when a project is available. */
    projectDir?: string;
    /** comp_dir of every unit that lists the document, in unit order, already relocated to local paths. */
    compilationDirs?: readonly string[];
}

/** Absolute path of the highest-priority existing candidate, or undefined when none exists. */
export function resolveDirectivePath(
    operand: string,
    context: DirectiveContext,
    exists: (candidate: string) => boolean,
): string | undefined;
```

Constraints carried over from the existing boundary checks
(`test/unit/platform/architecture-contracts.test.ts:79-93`, `docs/architecture-verification.md:82-90`):

- the solver stays host-free (`language/includes/…` and `platform/files/local-path.ts` are already in
  the pure set), so the provider injects everything;
- `resolveIncludePath(sourceDir, operand)` stays as a thin wrapper during the transition;
- `resolveDebugSourcePath` is not reused as the operand solver (opposite direction: metadata → local);
  only its relocation pattern is reused.

## 7. Provider integration

- **Link provider** — `IncludeLinkProvider` gains the active project service and the artifact index
  (`DebugSymbolService` or the repository); `src/extension.ts:328-330` constructs it from the
  composition root. It emits a link only for a resolved operand (§5.6).
- **Diagnostics** — a new adapter owning
  `languages.createDiagnosticCollection('v6-asm-directives')`, registered and disposed with the other
  language services. Per document it calls `collection.set(uri, diagnostics)` with one `Error` per
  unresolved operand and `collection.delete(uri)` on close (§5.6).
- **Hover is kept, not rebuilt** — a resolved operand keeps the standard `DocumentLink` tooltip
  (target path). For an unresolved operand the hover text comes from VS Code's built-in marker hover
  over the diagnostic above. The existing `SymbolLinkProvider` hover (value, Go to Definition) is
  untouched; no directive hover provider is registered and no extra hover content is added.
- **Parsing** — one function returning `directive`, `operand` and `range` for all three directives;
  ranges cover only the quoted operand, not `, offset, length`.
- `.filesize` has two spellings (`NAME .filesize "path"`, `.filesize "path"`), so the parser must not
  assume a leading dot at the start of the line.
- Only `file:` documents are handled (the current code already works from `uri.fsPath`); untitled and
  remote schemes are skipped.
- The `.include` dialect (case sensitivity, comment matching, "anywhere in the line") is unchanged by
  this work (§12.3).

**Metadata consumers to migrate (§5.3, §5.4):**

- **Loader** — publish `units`; tag rows and declarations with their unit; delete `LoadResult.compDir`.
- **`DebugIndex`** — expose `units`; `SourceLocation`/`StatementRow` carry `unit`; delete `sourceFiles`.
- **`DebugSymbolService`** — drop `sourceFiles()`; its only caller is `DebugSourceSymbolLinkService`
  (`symbol-link-service.ts:207,236`).
- **`DebugSourceSymbolLinkService`** — replace the scan over the merged list with address→unit attribution.
- **Breakpoints / Trace Log / DAP** — keep using `resolveAddress`; breakpoint path matching becomes
  unit-scoped (§5.4). No other consumer reads the merged file list.

## 8. Decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | unresolved operand: no link, `Error` diagnostic | **yes** — replaces today's "always emit a link" |
| D2 | highest-priority existing candidate wins silently | **yes** — no ambiguity analysis, no candidate reporting (R2) |
| D3 | candidate order follows §3.1, with no promotion | **yes** — the editor never tries a later v6asm step before an earlier one |
| D4 | DWARF data supplies `comp_dir` only, never a location | **yes** (§4.1, §4.2); suffix/membership matching is not implemented |
| D5 | one candidate list for all three directives | **yes** — depends on the v6asm fix (§12.1) |
| D6 | `-I` include dirs | not modeled here (§12.2, §13) |
| D7 | metadata model = per-unit `units`; delete `LoadResult.compDir` and `DebugIndex.sourceFiles` | **yes** (§5.3) |
| D8 | no owning-CU selection: every unit that lists the document contributes its `comp_dir` | **yes** — replaces the 3-rule heuristic (§5.4) |
| D9 | label lookup by address→unit instead of a global file scan | **yes** (§5.4) |
| D10 | diagnostics collection, `Error` only; link tooltip and symbol hover preserved | **yes** (§5.6) |

## 9. Behavior changes and compatibility

Intended changes:

| # | Before | After |
|---|---|---|
| B1 | every operand gets a link; a missing target is silent | missing target: no link, `Error` diagnostic (§5.6) |
| B2 | `.incbin` / `.filesize` operands are inert text | same link/diagnostic treatment as `.include` |
| B3 | resolution anchored to the document directory only | ordered candidates (§5.2); the CWD directory or `comp_dir` may now win where the document directory holds no file |
| B4 | label navigation scans the merged file union, first match wins | the symbol is attributed to the unit that emitted its address (§5.4) |
| B5 | a document present in two units can make breakpoint matching "ambiguous → none" | unit-scoped matching picks the document's own unit (§5.4) |

Unchanged, and asserted by existing tests:

- absolute operands are returned verbatim;
- link and diagnostic ranges cover only the quoted operand, with emoji/CRLF-safe offsets;
- constant navigation (DWARF declaration) and `resolveDebugSourcePath` semantics are untouched;
- without an artifact, candidate 3 (`comp_dir`) is skipped; candidate 5 (CWD) never is;
- the link tooltip and the existing symbol hover are preserved; no new hover content is introduced.

Two documented statements are superseded and must be updated in the same change (§11):
`docs/language-support.md:41-49` ("missing targets still produce links") and the "behaviors not to
change implicitly" list in `design/features/path-resolution-architecture-investigation.md`
(source-dir anchor, missing-target links).

## 10. Tests

Solver matrix (extend `test/core/path-policies.test.ts`, injected `exists`):

- each candidate wins and loses in the documented order (one case per row of §5.2);
- absolute operands returned unchanged (POSIX and Windows shapes);
- `.` / `..` and duplicate separators normalized by `path.resolve`;
- two existing candidates → the earlier anchor wins, deterministically;
- nothing exists → `undefined`;
- no project → candidate 5 (CWD) is still available; no artifact → candidate 3 (`comp_dir`) is skipped;

Unit model (`test/unit/debug/debug-index-file-resolution.test.ts`, `dwarf4-line-compdirs.test.ts`):

- every statement row and declaration reports the unit that produced it;
- two CUs with different `comp_dir`s keep separate file tables and separate anchors;
- a file listed by two units yields one `comp_dir` candidate per unit, in unit order;
- a label whose address belongs to the engine unit resolves inside the engine unit's file table;
- the same basename in two units: breakpoint matching picks the unit that contains the document path.

Parser (`test/unit/language/include-resolution.test.ts`): `.include`, `.incbin` and `.filesize`
(`NAME` and bare), `'...'` vs `"..."`, `, offset, length`, CRLF, emoji offsets, comment handling
unchanged.

Provider (`test/unit/language/include-link-provider.test.ts`): operand-only ranges; URI is the
highest-priority existing candidate; `link.tooltip` stays unset so VS Code's default path tooltip is
kept; resolved → link; unresolved → no link plus exactly one `Error` diagnostic with the expected
range, source and message; no `Warning` diagnostics.

Shipped integration (`src/test/integration/suite/source-paths.test.ts:9-24`, via
`vscode.executeLinkProvider` and `vscode.languages.getDiagnostics`) over a temporary project:

```
main.asm                .include "sub/existing.inc"  .include "build/meta.inc"  .incbin "build/data.bin"
sub/existing.inc        build/meta.inc               build/data.bin
```

assertions: links resolve to the created files, candidate 5 (CWD) wins for `build/...`, the missing operand
yields no link and one `Error`, and the `.incbin` operand behaves like `.include`.

Regression (`test/regression/include-links.test.ts`): records B1 explicitly, so the flip from "link"
to "diagnostic" is reviewable rather than incidental.

Optional live parity check (gated like the other live lanes): run v6asm from the CWD used by the
Makefile and from the sample dir on a nested-include fixture, and compare the set of files v6asm
accepts with the set the editor resolves.

## 11. Documentation to update in the same change

- `docs/language-support.md:39-49` — candidate list, `.incbin`/`.filesize` support, the `Error`
  diagnostic for unresolved operands, and the replacement of "missing targets still produce links".
- `docs/architecture.md:36-42` (Source path ownership) — the ordered candidate list and the CWD anchor.
- `docs/architecture-owners.md:19` — owner row for include resolution and local paths.
- `docs/architecture-verification.md:82-90` — new host-free vectors and the integration case.
- `design/features/path-resolution-architecture-investigation.md` — closeout note for the deliberate
  change of the "behaviors not to change implicitly" list (§9).
- `README.md:12` — include navigation line; mention `.incbin`/`.filesize` if it fits.

## 12. Dependencies, limitations and out of scope

### 12.1 Prerequisite: one search list in v6asm (bug)

The design requires v6asm to use the single list of §3.1 for all three directives. Current difference:

| Directive | current v6asm | target |
|---|---|---|
| `.include` | §3.1 (`preprocessor.rs:447-471`) | §3.1 |
| `.incbin` / `.filesize` | steps 1, 3, 5 — no including-file step, no `-I` (`assembler.rs:3198-3208`) | §3.1 |

The second row is a v6asm bug, fixed outside this plan. The editor implements the target list
immediately; until the fix lands, an `.incbin`/`.filesize` link may point at a file the current v6asm
would reject. That window is temporary and must not become documented editor policy.

### 12.2 Limitation: `-I` directories are not modeled

The editor cannot see v6asm's `-I` flags, so an operand that only an `-I` directory satisfies is
reported as `Error` (§5.6) although the build succeeds. By design there is no user-facing mitigation
(R2); the limitation is documented here and removed by §13.

### 12.3 Out of scope: directive dialects

Unchanged by this plan:

| Aspect | v6asm | extension today | this change |
|---|---|---|---|
| `.include` spelling | `.include` / `.INCLUDE` only (`preprocessor.rs:400`) | `.include` only (case-sensitive regex) | unchanged |
| position | must start the trimmed line | matches anywhere in the line | unchanged |
| comments | `;` comment stripped before matching | matches inside `;` comments too (documented as intentional) | unchanged |
| quotes | `"..."` and `'...'` | `"..."` only | unchanged for `.include`; `.incbin`/`.filesize` accept `"..."` only (matches the generated files) |
| `.incbin` / `.filesize` | case-insensitive, quoted operand, optional args | not parsed at all | parsed exactly like `.include` |

## 13. Future: exact build context

**v6asm `-g` emits the build context** (a vendor DWARF attribute/section: main file, CWD, include
dirs). You own v6asm; this makes the editor exact and cheap.

Today the build inputs are taken from the running host and from conventions: the CWD is the extension
host's working directory (candidate 5), and `-I` directories are not known at all. Two acceptable ways
to make them explicit:

1. **v6asm metadata** — one extra DWARF attribute (or a small `.debug_v6asm` section) carrying
   `{ mainFile, cwd, includeDirs }`; the editor then mirrors v6asm exactly and the candidate list
   remains only as a fallback for never-built projects.
2. **Project settings** — `asm.buildCwd` / `asm.includeDirs` / `asm.sourceRoot` in `*.project.json`
   (schema in `config/schemas/v6.project.schema.json`), with the candidate list as fallback.

Either option also fixes workspaces whose layout differs from the build layout (for example the
`temp/project` copy, where `../../engine` cannot map into `temp/project/engine` by any heuristic) and
removes the false-positive risk described in §12.2.

## 14. Implementation outline

Not started. Each step is independently reviewable:

1. **Solver + parser** — `resolveDirectivePath` returning the resolved path (or `undefined`); unified
   parsing for `.include`, `.incbin`, `.filesize`; host-free tests (§10). The provider keeps using the
   legacy wrapper, so no behavior changes yet.
2. **Unit model** — loader publishes `units`, rows/declarations carry `unit`, `LoadResult.compDir` and
   `DebugIndex.sourceFiles` are deleted, consumers migrated (§5.3, §5.4, §7). Independent of the
   directive work and reviewable on its own.
3. **Link provider** — constructor dependencies, candidate list and cache (§5.2, §5.7); unresolved
   operands stop producing links in this step.
4. **Diagnostics** — `DiagnosticCollection` with the single `Error` rule (§5.6), sharing the cache.
5. **Adapter tests** — unit, regression and shipped integration lanes (§10), including the B1 flip.
6. **Documentation** — the files listed in §11, in the same commit.
7. **Follow-up** — optional quick fix, then §13.

Gates to keep green: `npm run compile`, `npm run lint`, `npm run test:core`, `npm run test:unit`,
`npm run test:regression`, and the packaged integration lane.

## 15. Open Questions

1. While `-I` is not modeled (§12.2), should "not found" stay an `Error` (TypeScript parity) or be
   suppressed to avoid false positives? Current proposal: keep `Error`.
2. The parser matches `.include` inside `;` comments (§12.3). Should commented operands be excluded
   from diagnostics, or should a link inside a comment keep working?
3. If the active project did not produce the document being edited, should candidates 3 and 5 apply at
   all? Current proposal: only when the document appears in a unit's file table or lies under the CWD.
4. Is a "why is this include unresolved" quick fix worth building (open the project `build/` folder,
   run `make`, show the generated command)?
5. POSIX: v6asm treats `\` literally. Should the editor normalize `\` to `/` for navigation, or mirror
   v6asm exactly? (Recommendation: mirror.)
6. After migration `resolveIncludePath` has only test callers — remove it, or keep it as the documented
   wrapper? `PathService.resolveRelative` raises the same question.
7. The `temp/project` copy does not mirror the build layout (`samples/common/09_...` vs
   `samples/09_...`), so no heuristic can map it. Should that copy be rebuilt to match the repository
   layout, or receive `asm.sourceRoot` when §13 lands?
8. In a multi-root window the host CWD belongs to one folder only, and the containing-folder candidate
   has been removed. Root-relative includes in a second folder can then resolve only through `comp_dir`
   (which needs an artifact). Acceptable, or should the document's own workspace folder be reintroduced
   as a lower-priority candidate?
9. When a document belongs to several units, candidate 3 emits one `comp_dir` per unit. Should the order
   stay the artifact's CU order, or be ranked by proximity of `comp_dir` to the document?
10. Deleting `sourceFiles` also deletes the "all files in this artifact" view. Does any surface (Trace Log
    source picker, Problems, quick pick) need a replacement, or is per-unit enough?
