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

The editor uses one anchor (the document directory); v6asm uses four (§3.1). A project that builds
correctly can therefore show broken links, and a link that works does not prove that the build will
find the same file.

## 2. Desired behavior

R1. Unresolved operand of any of the three directives: **no link**, plus one `Error` diagnostic over
the operand — red squiggle, message in the hover and in the Problems panel (`Cannot find include
file "..."`; `.incbin`/`.filesize`: `Cannot find file "..."`). The mechanism is specified in §5.7.
R2. Resolved operand: **link only**, to the highest-priority existing candidate (§5.2 defines the
priority).
R3. One candidate list for `.include`, `.incbin` and `.filesize` (§3.1).
R4. Path candidates order is deterministic (§5.2).
R5. Keep what is already correct: operand-only link ranges, emoji/CRLF offset handling, absolute
operands used verbatim, and unchanged symbol/label navigation.

## 3. v6asm behavior (reference)

### 3.1 Target contract: one candidate list for all three directives

The design target is a single search list shared by `.include`, `.incbin` and `.filesize`:

1. directory of the file containing the directive;
2. directory of the top-level `.asm` ("top-level asm dir");
3. each `-I` include directory, in order;
4. process CWD.

### 3.2 Current v6asm behavior

`.include` already uses the list of §3.1 (`preprocessor.rs:447-471`). `.incbin` and `.filesize` use
only steps 2 and 4 — no including-file step and no `-I` (`assembler.rs:3198-3208`).

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

So `comp_dir` is the top-level asm dir of §3.1 step 2, per compilation unit. The extension's
`LoadResult.compDir` exposes only the first absolute comp dir, which depends on link order
(`main.o` happens to be linked first in the sample Makefile).

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

For files resolved by step 1, `comp_dir + operand` is correct; for files resolved by `-I` or CWD it is
structurally wrong.

### 4.3 What the extension exposes today

`decodeDebugArtifact` publishes one merged `compDir` and one merged file list
(`debug-artifact-loader.ts:147,156,187`); `DebugIndex.sourceFiles` is the union across CUs
(`debug-symbol-service.ts:102-104`). The per-CU line tables and comp-dir map already exist inside the
loader (`buildLineCompDirs`, `filesForUnit`); they are simply not published.

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

The table is a **priority list**: candidate 1 has the highest priority, candidate 5 the lowest. The
solver walks it from 1 to 5 and returns the first candidate that exists. If none exists, the operand is
unresolved (§5.7).

| Priority | Anchor | Source | Rationale |
|---|---|---|---|
| 1 | absolute operand, used verbatim | `path.isAbsolute` (platform-aware) | v6asm `Path::join` replaces the base for absolute inputs; preserves today's spelling rule |
| 2 | directory of the containing document | `document.uri` | §3.1 step 1; already correct today |
| 3 | **CWD directory** | the extension host's current working directory (`process.cwd()`) | v6asm step 4. The project is built from this directory (the Makefile runs v6asm from the workspace root), so `build/...` resolves against it. |
| 4 | `comp_dir` of the owning CU | per-CU data from the loader (§5.3) | §3.1 step 2 **of that CU's own build**: v6asm sets `comp_dir` to the directory of the `.asm` it was invoked on (`main.rs:339` → `main.rs:381` → `output.rs:213` → `dwarf.rs:349`). Unavailable when that directory is not absolute. |
| 5 | workspace folder containing the document | `WorkspaceService` | multi-root windows have no single CWD, so the folder that contains the document is used; in a single-folder window it is the same directory as candidate 3 |

**Mapping to §3.1:** candidate 2 = step 1 exactly; candidate 3 = step 4 for a build whose CWD is the
host CWD; candidate 4 = step 2 of the owning CU's build; candidate 5 = editor-only. Step 3 (`-I`) is
not modeled (§12.2).

Ordering rules:

- **CWD directory before any other workspace folder** — the build runs from the CWD; a folder that
  merely contains the document is a weaker anchor. Resolving against a workspace folder first would
  also undo the anchor correction recorded in
  `design/features/path-resolution-architecture-investigation.md` §7 and `docs/architecture.md:51-59`;
- **`comp_dir` after the CWD directory** — it is a build-site path and may point at another checkout
  (§4.1);
- **the highest-priority existing candidate wins, silently** — no ambiguity analysis, no candidate
  reporting (R2);
- **candidate 3 outranks candidate 4 even when they belong to different builds** — for an object built
  separately (the engine `v6.o`), the build's real step 2 is `comp_dir`, while the host CWD is that
  build's step 4 only if the host happens to run there (§15).

### 5.3 Per-CU data from the artifact loader

Additive change to `decodeDebugArtifact`/`LoadResult`:

```ts
interface SourceUnit { compDir: string; files: readonly string[] }
// LoadResult gains:  units: readonly SourceUnit[]
```

`buildLineCompDirs` and `filesForUnit` already produce this internally
(`debug-artifact-loader.ts:47-72`). Keep `compDir` and the merged `sourceFiles` for existing consumers
(symbol/label navigation, Trace Log, DAP) so this change cannot regress them.

### 5.4 Selecting the owning CU

1. the CU whose file table contains the current document (compare with `localPathKey` after
   relocation, so build-site and workspace spellings both match); else
2. the CU whose `comp_dir` is contained in the CWD directory; else
3. the first CU with an absolute `comp_dir`; else
4. candidate 4 is skipped.

Step 1 makes the anchor per-document instead of per-project, which is what makes nested includes work
when one linker output contains several objects (here: the sample CU and the engine CU).

### 5.5 Operand handling

- the operand text is never rewritten; candidate paths are built with `path.resolve`, which normalizes
  `.`/`..` and duplicate separators for the existence probe only;
- the link range and the diagnostic range cover the original operand bytes, so emoji/CRLF offsets stay
  correct;
- existence is checked with the injected predicate only; no other candidate property is inspected,
  because the highest-priority existing candidate wins (§5.2).

### 5.6 Workspace anchor policy

Relative operands are never resolved against any workspace folder other than the one containing the
document:

- candidate 5 is the workspace folder that contains the current document; if the document is outside
  every folder, the candidate is skipped;
- a nested project resolves through its own folder, not through the outer root; in a multi-root window
  this is candidate 5 (the folder containing the document), see §15;
- multi-root is not "try folder 1, then folder 2". Supporting that later is an explicit, tested change.

Rejected alternative, recorded for review: "all workspace folders in order, after the CWD directory". It
is the policy that was previously removed from DAP and is not needed by any current case.

### 5.7 UI outcome

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

### 5.8 Caching and lifecycle

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
    /** comp_dir of the CU owning the document, already relocated to a local path. */
    compilationDir?: string;
    /** Workspace folder containing the document, if any. */
    workspaceDir?: string;
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

- **Link provider** — `IncludeLinkProvider` gains the active project service, a workspace accessor
  (`platform/files/workspace-service.ts`) and the artifact index (`DebugSymbolService` or the
  repository); `src/extension.ts:328-330` constructs it from the composition root. It emits a link only
  for a resolved operand (§5.7).
- **Diagnostics** — a new adapter owning
  `languages.createDiagnosticCollection('v6-asm-directives')`, registered and disposed with the other
  language services. Per document it calls `collection.set(uri, diagnostics)` with one `Error` per
  unresolved operand and `collection.delete(uri)` on close (§5.7).
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

## 8. Decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | CWD directory before workspace root | **yes** — consistent with the DAP/source-anchor correction |
| D2 | workspace anchor = folder containing the document only | **yes**; the multi-root alternative is recorded in §5.6 |
| D3 | unresolved operand: no link, `Error` diagnostic | **yes** — replaces today's "always emit a link" |
| D4 | highest-priority existing candidate wins silently | **yes** — no ambiguity analysis, no candidate reporting (R2) |
| D5 | DWARF data supplies `comp_dir` only, never a location | **yes** (§4.1, §4.2); suffix/membership matching is not implemented |
| D6 | one candidate list for all three directives | **yes** — depends on the v6asm fix (§12.1) |
| D7 | `-I` include dirs | not modeled here (§12.2, §13) |
| D8 | publish per-CU `units` from the loader | **yes** — additive (§5.3) |
| D9 | diagnostics collection, `Error` only; link tooltip and symbol hover preserved | **yes** (§5.7) |

## 9. Behavior changes and compatibility

Intended changes:

| # | Before | After |
|---|---|---|
| B1 | every operand gets a link; a missing target is silent | missing target: no link, `Error` diagnostic (§5.7) |
| B2 | `.incbin` / `.filesize` operands are inert text | same link/diagnostic treatment as `.include` |
| B3 | resolution anchored to the document directory only | ordered candidates (§5.2); the CWD directory or `comp_dir` may now win where the document directory holds no file |
| B4 | no workspace anchor at all | workspace anchor added, limited to the folder containing the document and used only when no project file exists (§5.6) |

Unchanged, and asserted by existing tests:

- absolute operands are returned verbatim;
- link and diagnostic ranges cover only the quoted operand, with emoji/CRLF-safe offsets;
- symbol/label/constant navigation and `resolveDebugSourcePath` semantics are untouched;
- without a project or artifact, candidate 4 is skipped;
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
- no project → candidate 3 skipped; no artifact → candidate 4 skipped;
- workspace anchor: document inside a folder / outside every folder.

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

assertions: links resolve to the created files, candidate 3 (CWD) wins for `build/...`, the missing operand
yields no link and one `Error`, and the `.incbin` operand behaves like `.include`.

Regression (`test/regression/include-links.test.ts`): records B1 explicitly, so the flip from "link"
to "diagnostic" is reviewable rather than incidental.

Optional live parity check (gated like the other live lanes): run v6asm from the CWD used by the
Makefile and from the sample dir on a nested-include fixture, and compare the set of files v6asm
accepts with the set the editor resolves.

## 11. Documentation to update in the same change

- `docs/language-support.md:39-49` — candidate list, `.incbin`/`.filesize` support, the `Error`
  diagnostic for unresolved operands, and the replacement of "missing targets still produce links".
- `docs/architecture.md:36-42` (Source path ownership) — ordered candidates and why the CWD directory
  precedes the workspace folder.
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
| `.incbin` / `.filesize` | top-level asm dir, then CWD; no including-file step, no `-I` (`assembler.rs:3198-3208`) | §3.1 |

The second row is a v6asm bug, fixed outside this plan. The editor implements the target list
immediately; until the fix lands, an `.incbin`/`.filesize` link may point at a file the current v6asm
would reject. That window is temporary and must not become documented editor policy.

### 12.2 Limitation: `-I` directories are not modeled

The editor cannot see v6asm's `-I` flags, so an operand that only an `-I` directory satisfies is
reported as `Error` (§5.7) although the build succeeds. By design there is no user-facing mitigation
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
host's working directory (candidate 3), and `-I` directories are not known at all. Two acceptable ways
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
2. **Loader exposure** — `units: { compDir, files }[]` in `LoadResult` (§5.3), merged fields kept,
   per-CU unit tests.
3. **Link provider** — constructor dependencies, candidate list and cache (§5.2, §5.8); unresolved
   operands stop producing links in this step.
4. **Diagnostics** — `DiagnosticCollection` with the single `Error` rule (§5.7), sharing the cache.
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
3. If the active project did not produce the document being edited, should candidates 3 and 4 apply at
   all? Current proposal: only when the document is under the CWD directory or appears in the artifact
   file table.
4. Is a "why is this include unresolved" quick fix worth building (open the project `build/` folder,
   run `make`, show the generated command)?
5. POSIX: v6asm treats `\` literally. Should the editor normalize `\` to `/` for navigation, or mirror
   v6asm exactly? (Recommendation: mirror.)
6. After migration `resolveIncludePath` has only test callers — remove it, or keep it as the documented
   wrapper? `PathService.resolveRelative` raises the same question.
7. The `temp/project` copy does not mirror the build layout (`samples/common/09_...` vs
   `samples/09_...`), so no heuristic can map it. Should that copy be rebuilt to match the repository
   layout, or receive `asm.sourceRoot` when §13 lands?
8. In a multi-root window, candidate 3 (the host CWD) outranks candidate 5 (the folder containing the
   document), so a document in a second folder can resolve against the wrong root. Should the containing
   folder come first when the window has more than one folder?
9. For a document that belongs to a separately built object (for example the engine `v6.o`), candidate 3
   (host CWD) outranks candidate 4 (`comp_dir`) although `comp_dir` is that build's real top-level asm
   dir. Should candidate 4 come first when the owning CU is not the project's own CU?
