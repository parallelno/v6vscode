# Unified Include Path Solver

**Status:** Design agreed; not implemented.
**Verified against:** v6vscode `752bf00` (0.3.1) and the `v6asm` sources
(`crates/v6_core/src/preprocessor.rs`, `assembler.rs`, `object/dwarf.rs`), using the real
artifact in `temp/project/build/09_sprite_frame_no_vsync/`.
**Owner area:** `src/language/includes/`, `src/debug/metadata/`, `src/platform/files/`.
**Related:** `design/features/path-resolution-architecture-investigation.md`,
`docs/architecture.md` (Source path ownership), `docs/language-support.md` (Source Links),
`docs/architecture-owners.md`.

## 1. Problems

- The extension include path solver does not match the v6asm path solver.
- The extension does not support the `.incbin` and `.filesize` directives; they exist only
  as keywords in `res/syntaxes/v6vscode_8080.tmLanguage.json:144`.
- `.include` is anchored to the containing document only, and a link is emitted even when the
  target does not exist (`include-link-provider.ts:10-21`, `include-resolution.ts:38-41`).
- The winning rule is invisible: nothing tells the user why a link points where it points.

Concrete case: `samples/common/09_sprite_frame_no_vsync/main.asm:17`
(`../../engine/...`, intended file-relative) and `:28` (`build/...`, intended root-relative).
With the extension host workspace `temp/project`, both operands are joined to the document
directory: line 17 becomes `...\samples\engine\common\v6_macros.asm` and line 28 becomes
`...\samples\common\09_sprite_frame_no_vsync\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm`.
Neither exists; the real targets are `temp\project\engine\common\v6_macros.asm` and
`temp\project\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm`.

## 2. Prerequisites

- **workspace directory** — the folder opened in the Extension Development Host; for this
  repository `C:\Work\Programming\v6vscode\temp\project\` (`.vscode/launch.json:12`).
- **project file** (optional) — the selected `*.project.json`. Its directory is the documented
  source anchor (`projectSourceRoot`, `src/project/model/source-context.ts:4-6`).
- **debug artifact** (optional) — the ELF from `project.run.debugArtifact`, already loaded and
  cached by `ArtifactRepository`/`DebugSymbolService`. `ArtifactHandle.version`
  (`artifact-repository.ts:6-10`) is available as a cache key.

## 3. Assembler (authority)

| Directive | v6asm search order |
|---|---|
| `.include` | 1) dir of the including file 2) "project dir" = **dir of the top-level `.asm`** 3) `-I` dirs 4) **process CWD** (`preprocessor.rs:447-471`) |
| `.incbin` / `.filesize` | 1) project dir (top-level asm dir) 2) CWD — **no** including-file step, **no** `-I` (`assembler.rs:3198-3208`) |

Operand parsing:

- quoted string only (`parse_string_arg`, `parser.rs:1072-1081`);
- `.incbin` may add `, offset, length` (`parser.rs:508-523`);
- `.filesize` may be written `NAME .filesize "path"` or `.filesize "path"`
  (`parser.rs:204-210`, `:734-737`);
- `.include` is recognised by the preprocessor only as `.include` / `.INCLUDE`, only at the start
  of the line, after `;` comment stripping; `'...'` quotes are accepted too
  (`preprocessor.rs:395-412`);
- other directives are upper-cased before dispatch (`parser.rs:159-161`), so `.incbin`/`.filesize`
  are case-insensitive there.

Because the search lists differ per directive family, "one solver" means one *mechanism*, not
necessarily one identical candidate list (see §5.1).

## 4. Verified facts that constrain the design

### 4.1 `DW_AT_comp_dir` is the top-level source directory of that object

`main.rs:339` derives `source_dir` from `source_path.parent()`, `main.rs:381` passes it to
`Assembler::new`, and `output.rs:213` hands `asm.project_dir()` to the DWARF writer, which stores it
as `DW_AT_comp_dir` (`dwarf.rs:349`). Measured on the sample ELF:

```
CU count = 2
  CU0 compDir="C:/Work/Programming/v6gel/samples/09_sprite_frame_no_vsync" stmtList=0
  CU1 compDir="C:/Work/Programming/v6gel/engine"                          stmtList=2103
```

### 4.2 DWARF file entries record the operand spelling, not the resolved location

The writer stores `(file_directory(file), file_name(file))` (`dwarf.rs:923-946`), i.e. the path the
assembler saw, relative to `comp_dir`. Measured raw strings in the artifact:

```
../../engine/common                               ../../engine/controls
build/09_sprite_frame_no_vsync/levels/asm         build/09_sprite_frame_no_vsync/palettes/asm
build/09_sprite_frame_no_vsync/sprites/asm        main.asm
```

After the extension joins entries with `comp_dir` (`dwarf4-line-reader.ts:472-501`), the `build/...`
entries become
`...\v6gel\samples\09_sprite_frame_no_vsync\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm`
— and that path **does not exist even at the build site**. The real file is
`...\v6gel\build\09_sprite_frame_no_vsync\levels\asm\lv0_gfx_meta.asm`, found by v6asm's CWD step.
Confirmed with the assembler itself:

For files resolved by step 1 (including-file dir), `comp_dir + operand` is correct. For files
resolved by `-I` or CWD it is structurally wrong.

### 4.3 What the extension exposes today

`decodeDebugArtifact` publishes one merged `compDir` and one merged file list
(`debug-artifact-loader.ts:147,156,187`); `DebugIndex.sourceFiles` is the union across CUs
(`debug-symbol-service.ts:102-104`). Per-CU line tables and the comp-dir map already exist inside
the loader (`buildLineCompDirs`, `filesForUnit`), they are just not published.

### 4.4 Why label navigation works today while include links do not

`SymbolLinkProvider.provideDefinition` resolves the metadata file name with
`resolveDebugSourcePath(source.file, projectSourceRoot(project))`
(`symbol-link-provider.ts:159-163`), which relocates foreign absolute paths by **longest existing
trailing segment** (`debug-source-path.ts:23-52,66-74`). Measured for `temp/project`:

| Token | Metadata path | Opened |
|---|---|---|
| `lv0_gfx_init` | `...\v6gel\samples\09_...\build\...\lv0_gfx_meta.asm:23` | `temp\project\build\09_...\lv0_gfx_meta.asm` (exists) |
| `PALETTE_UPD_REQ_YES` | `...\v6gel\engine\common\v6_consts.asm:25` | `temp\project\engine\common\v6_consts.asm` (exists) |
| `room_init` | `...\v6gel\samples\09_sprite_frame_no_vsync\main.asm:410` | the **v6gel** copy (suffix `main.asm` has no workspace match) |

So symbols reach into `build/...` files only because the *suffix* survives, not because the recorded
path is usable. The same suffix trick applied to an include operand is the useful part of the DWARF
steps; the recorded prefix is not.

## 5. Proposed solution

Use one unified path solver for the `.include`, `.incbin` and `.filesize` directives.

### 5.1 One mechanism, per-directive candidate lists

The solver is a pure function with an injected existence predicate (same shape as
`resolveDebugSourcePath(sourcePath, projectRoot, exists)`), and it returns both the path and the
anchor that produced it. The provider selects the candidate list:

| Directive | Candidates (in order) | Mirrors |
|---|---|---|
| `.include` | 1 absolute · 2 source dir · 3 project dir · 4 owning-CU comp dir · 5 workspace dir | superset of v6asm (adds 3/5, which v6asm reaches only via CWD when they coincide) |
| `.incbin`, `.filesize` | 1 absolute · 3 project dir · 4 owning-CU comp dir · 5 workspace dir | superset of v6asm (adds 2 by sharing the mechanism; documented divergence) |

Sharing the mechanism is the goal; pretending the two directives have the same search list is not.
The `.incbin`/`.filesize` superset must be stated in the docs: a resolved link no longer proves that
the assembler will find the file.

### 5.2 Search order (the ladder)

| # | Anchor | Source | Why / mirrors |
|---|---|---|---|
| 1 | absolute operand, used verbatim | `path.isAbsolute` (platform-aware) | v6asm `Path::join` replaces the base for absolute inputs; preserves today's `resolveAgainstDirectory` spelling rule |
| 2 | directory of the containing document | `document.uri` | exact v6asm step 1; already correct today |
| 3 | `*.project.json` directory | `ActiveProjectService` + `projectSourceRoot` | v6asm step 4 (CWD) in this repository — this is what fixes `build/...`; the documented source anchor for nested/multi-root projects |
| 4 | `comp_dir` of the **owning CU** | new per-CU data from the loader | v6asm step 2 (top-level asm dir). The only anchor that cannot be derived from the document, the project file or the workspace, and the only way to reproduce "`.include "x.inc"` inside `engine/misc/v6_utils.asm` means *next to the top-level asm*" |
| 5 | workspace directory (see §5.6) | `WorkspaceService` | last lexical resort for projects without a `*.project.json`; **never before 3** |
| 6 | artifact membership check (filter, not a path source) | merged CU file table | prefer the candidate whose tail the last build actually consumed; report when none matches |

Ordering rules that follow from the repo's existing decisions:

- **project dir before any workspace folder.** Putting the workspace root first would undo the anchor
  correction recorded in `design/features/path-resolution-architecture-investigation.md` §7 and
  `docs/architecture.md:51-59` (DAP/source tools moved from first-workspace to selected-project).
- **comp_dir after project dir.** `comp_dir` is a build-site path; when the workspace mirrors the
  build layout it agrees with 3, and when it does not (e.g. the `temp/project` copy) it may point at
  another checkout. It must never win over the project dir.
- **membership last.** It proves nothing about location (§4.3, §4.6), so it may only confirm or warn.

### 5.3 Publish per-CU data from the artifact loader

Small, additive change to `decodeDebugArtifact`/`LoadResult`:

```ts
interface SourceUnit { compDir: string; files: readonly string[] }
// LoadResult gains:  units: readonly SourceUnit[]
```

`buildLineCompDirs` and `filesForUnit` already produce exactly this internally
(`debug-artifact-loader.ts:47-72`); keep `compDir` and the merged `sourceFiles` for existing
consumers (symbol/label navigation, Trace Log, DAP) so this change cannot regress them.

### 5.4 Selecting the owning CU

1. the CU whose file table contains the current document (compare with `localPathKey`, after
   relocation, so build-site and workspace spellings both match); else
2. the CU whose `comp_dir` is contained in the project directory; else
3. the first CU with an absolute `comp_dir`; else
4. no step 4 at all (skip the anchor).

Step 1 makes the anchor per-document instead of per-project, which is what makes nested includes
work when one linker output contains several objects (here: the sample CU and the engine CU).

### 5.5 Operand normalization and membership matching

- normalize separators for comparison only; keep the operand text untouched for the link range;
- drop leading `./` and `../` segments when deriving a membership key, so `../../engine/common/v6_consts.asm`
  matches the recorded tail `engine/common/v6_consts.asm`;
- require the **whole** remaining operand to be a tail of the artifact entry — do **not** degrade to
  basename-only matching the way `debug-source-path.ts:66-74` does, or `v6_consts.asm` from an
  unrelated module will match;
- when several entries match, prefer the one from the owning CU, then the longest tail, then the
  first in file-table order (deterministic);
- compare with `localPathKey` so Windows case differences and separator differences do not create
  false "missing" results.

### 5.6 Workspace anchor policy

The doc's constraint stands: **relative operands are never resolved against any other workspace
folder.** Concretely:

- candidate 5 is the workspace folder that **contains the current document**; if the document is
  outside every folder, the anchor is skipped;
- a second, nested project therefore resolves through candidate 3 (its own `*.project.json`), not
  through the outer folder;
- multi-root is not "try folder 1, then folder 2". If a future case needs that, it must be an
  explicit, documented change with its own tests.

Rejected alternative, recorded for review: "all workspace folders in order after the project dir".
It would help documents that live outside the project folder, and it is exactly the policy that was
previously removed from DAP; the narrower rule is kept until a concrete need appears.

### 5.7 Result, tooltip and failure behavior

The solver returns `{ path, anchor, matchedArtifact?: boolean }`. The provider then:

- emits a `DocumentLink` whose range is **only the quoted operand** (existing behavior, including
  emoji-safe offsets — see `test/unit/language/include-link-provider.test.ts`);
- sets `DocumentLink.tooltip` to the resolved absolute path plus the anchor name, e.g.
  `Resolved via project dir` — this makes the precedence visible and debuggable;
- reports (tooltip/`Information` diagnostic, not an error dialog) when the artifact says the operand
  was not part of the last build, or when more than one candidate exists;
- **still emits a link when nothing exists**, pointing at the first non-absolute candidate of that
  directive's list (source dir for `.include`, project dir for `.incbin`/`.filesize`). For
  `.include` this preserves today's documented behavior and the existing regression tests; an
  unresolved link is more useful than a disappearing one, and it keeps the diff reviewable.

Anchor names to be used in tooltips and tests: `absolute`, `source-dir`, `project-dir`,
`compilation-dir`, `workspace`, `artifact-membership`.

### 5.8 Caching and lifecycle

- `provideDocumentLinks` runs on open and on every change; cache per
  `(document.uri, document.version, artifact.version, operand)` and invalidate on
  `onDidChangeTextDocument`, `onDidCloseTextDocument`, `onDidChangeWorkspaceFolders` and artifact
  reload — the same invalidation shape already used by `DebugSourceSymbolLinkService`
  (`symbol-link-service.ts:130-135`, `language-services.ts:34-35`).
- The artifact is already versioned by content hash (`artifact-repository.ts:70-92`), so a rebuild
  invalidates naturally; no new file watching is required.
- Without an active project or artifact, candidates 4 and 6 are skipped. Results then match today's
  behavior whenever the source-dir candidate exists (today's only case); when it does not, the
  workspace anchor may now produce a different — and, for a file inside the workspace, better —
  target. That is the intended behavior change, not an accident.

## 6. Solver interface (host-free)

```ts
export type IncludeAnchor =
    | 'absolute' | 'source-dir' | 'project-dir' | 'compilation-dir' | 'workspace';

export interface DirectiveCandidateContext {
    /** Directory of the document containing the directive. */
    sourceDir: string;
    /** Directory of the selected *.project.json, when a project is available. */
    projectDir?: string;
    /** comp_dir of the CU owning the document, already relocated to a local path. */
    compilationDir?: string;
    /** Workspace folder containing the document, if any. */
    workspaceDir?: string;
    /** Artifact file table entries (per-CU), for the membership filter. */
    artifactFiles?: readonly string[];
}

export interface DirectiveResolution {
    path: string;                 // last-resort lexical candidate when nothing exists
    anchor: IncludeAnchor;
    exists: boolean;
    matchedArtifact: boolean;
}

export function resolveDirectivePath(
    operand: string,
    context: DirectiveCandidateContext,
    exists: (candidate: string) => boolean,
): DirectiveResolution;
```

Constraints carried over from the existing boundary checks
(`test/unit/platform/architecture-contracts.test.ts:79-93`,
`docs/architecture-verification.md:82-90`):

- the solver stays in the pure set (`language/includes/…` or `platform/files/local-path.ts` already
  are), so no runtime `vscode` import — the provider injects everything;
- `resolveIncludePath(sourceDir, operand)` stays as a thin wrapper so existing callers/tests keep
  compiling during the transition;
- `resolveDebugSourcePath` must **not** be reused as the operand solver (opposite direction:
  metadata → local), only its relocation helper/pattern.

## 7. Provider integration

- `IncludeLinkProvider` gains constructor dependencies: active project service, a workspace accessor
  (`platform/files/workspace-service.ts`), and the artifact index (via `DebugSymbolService` or the
  repository). `src/extension.ts:328-330` must construct it from the composition root.
- Directive parsing becomes one function returning, for each match: `directive`, `operand`,
  `range`, so `.include`, `.incbin` and `.filesize` share the projection code.
  `.incbin`/`.filesize` ranges cover only the quoted operand, not `, offset, length`.
- `.filesize` has two spellings (`NAME .filesize "path"`, `.filesize "path"`), so the parser must not
  assume a leading dot at the start of the line.
- The `.include` dialect (case sensitivity, comment matching, "anywhere in the line") is **not**
  changed by this work; see §11.

## 8. Decisions to make

| # | Decision | Recommendation |
|---|---|---|
| D1 | project dir before workspace root | **yes** — required to stay consistent with the DAP/source-anchor correction |
| D2 | workspace anchor = folder containing the document only | **yes** (doc constraint); record the rejected multi-root alternative |
| D3 | missing target still produces a link | **yes**, with tooltip; add a diagnostic later if noisy |
| D4 | DWARF step is membership-only, not a path source | **yes** — §4.3/§4.6; keep the data available for a future "unresolved include" diagnostic |
| D5 | `.incbin`/`.filesize` accept the source-dir candidate too | **yes** for UX, documented as a superset of v6asm |
| D6 | `-I` include dirs | out of scope here; needs project settings or v6asm build context (§12) |
| D7 | expose per-CU `units` from the loader | **yes** — additive, needed for candidate 4 and for a correct "no artifact" path |

## 9. Tests

Host-free matrix (extend `test/core/path-policies.test.ts`, injected `exists`):

- each anchor wins, and each anchor loses, in the documented order (one case per row of §5.2);
- absolute operands are returned unchanged (spelling preserved), for POSIX and Windows shapes;
- `..`/`.` normalization for the membership key (`../../engine/common/v6_consts.asm`);
- membership matching never degrades to basename-only;
- ambiguity: two existing candidates → documented winner; two artifact entries → deterministic pick;
- nothing exists → documented fallback path and `exists: false`;
- no project → candidates 3 and 6 skipped; no artifact → candidates 4 and 6 skipped;
- workspace anchor: document inside folder / outside every folder;
- Windows case-only differences handled through `localPathKey`.

Parser tests (`test/unit/language/include-resolution.test.ts`): `.include`, `.incbin`,
`.filesize` (`NAME` and bare), `'...'` vs `"..."`, `, offset, length`, CRLF, emoji offsets, comment
handling unchanged.

Provider tests (`test/unit/language/include-link-provider.test.ts`): range still covers only the
operand; URI is the solver result; tooltip contains the anchor name.

Shipped integration test (`src/test/integration/suite/source-paths.test.ts:9-24` via
`vscode.executeLinkProvider`): a temporary project with

```
main.asm                     .include "sub/existing.inc"   .include "build/meta.inc"   .incbin "build/data.bin"
sub/existing.inc             build/meta.inc                build/data.bin
```

must produce links that resolve to the files actually created, with the project dir winning for
`build/...`, and a missing operand still producing a link. Keep the emoji/CRLF assertions.

Regression (`test/regression/include-links.test.ts`): whatever behavior changes, this lane collects
the new expectations instead of silently drifting.

Manual/feature check (optional, gated like the live lanes): run `v6asm` from the project dir and from
the sample dir on a fixture with nested includes, and assert the editor resolves the same set of
files the assembler accepts.

## 10. Documentation to update in the same change

- `docs/language-support.md:39-49` — replace "resolve against the containing source document
  directory, not the project/workspace root" with the ladder, the `.incbin`/`.filesize` support, the
  tooltip, and the "editor is a superset of the assembler" caveat.
- `docs/architecture.md:36-42` (Source path ownership) — state that include resolution now has an
  ordered anchor list and why the project dir precedes the workspace.
- `docs/architecture-owners.md:19` — owner row for include resolution/local paths.
- `docs/architecture-verification.md:82-90` — add the new host-free vectors and the integration case.
- `design/features/path-resolution-architecture-investigation.md` — append a short closeout note:
  the "behaviors not to change implicitly" list (source-dir vs project vs workspace vs compilation
  anchors, missing-target links) is now deliberately changed, with the reason (assembly of
  `build/...` includes only works because of CWD).
- `README.md:12` — include navigation line still accurate; mention `.incbin`/`.filesize` if space allows.

## 11. Outside of this Scope

It does not require solutions for now. It will be fixed outside of this plan.

- Mismatch path resolver in v6asm:

| Directive | v6asm |
|---|---|
| `.include` | 1) dir of the including file 2) "project dir" = dir of the top-level `.asm` 3) `-I` dirs 4) process CWD (`preprocessor.rs:447-471`) |
| `.incbin` / `.filesize` | 1) project dir (top-level asm dir) 2) CWD — no including-file step, no `-I` (`assembler.rs:3198-3208`) |

  Consequence accepted by this design: the editor resolves a superset of what the assembler accepts,
  so a working link is not proof that the build will succeed (documented in §10).

- Mismatch in directive dialects between v6asm and v6vscode:

| Aspect | v6asm | extension today | this change |
|---|---|---|---|
| `.include` spelling | `.include` / `.INCLUDE` only (`preprocessor.rs:400`) | `.include` only (case-sensitive regex) | unchanged |
| position | must start the trimmed line | matches anywhere in the line | unchanged |
| comments | `;` comment stripped before matching | matches inside `;` comments too (documented as intentional) | unchanged |
| quotes | `"..."` and `'...'` | `"..."` only | unchanged for `.include`; `.incbin`/`.filesize` accept `"..."` only (matches what the sample generates) |
| `.incbin` / `.filesize` | case-insensitive, quoted operand, optional args | not parsed at all | parsed as equals of `.include` in the solver |

- Emitting the build context from v6asm is not required by this plan (§12).

## 12. Future: exact build context (not part of this change)

**v6asm `-g` emits the build context** (a vendor DWARF attribute/section: main file, CWD, include
dirs). You own the assembler; this makes the editor exact and cheap.

Until then, the two facts the editor cannot recover are the **build CWD** and the **`-I` dirs**;
candidates 3 and 4 are approximations of them. Two acceptable ways to close the gap later:

1. **v6asm metadata** — one extra DWARF attribute (or a small `.debug_v6asm` section) carrying
   `{ mainFile, cwd, includeDirs }`. The editor then mirrors the assembler exactly with no heuristics
   and the ladder becomes a fallback for never-built projects.
2. **Project settings** — `asm.buildCwd` / `asm.includeDirs` / `asm.sourceRoot` in
   `*.project.json` (schema in `config/schemas/v6.project.schema.json`), with the ladder as fallback.

Either option also fixes workspaces whose layout differs from the build layout (e.g. the
`temp/project` copy where `../../engine` cannot map into `temp/project/engine` by any heuristic).

## 13. Implementation outline

Not started. Proposed order, each step independently reviewable:

1. **Pure solver + parser** — `resolveDirectivePath`, unified directive parsing for `.include`,
   `.incbin`, `.filesize`, host-free tests (`test/core`, `test/unit/language`). No behavior change in
   the provider yet: the provider keeps calling the legacy wrapper.
2. **Loader exposure** — add `units: { compDir, files }[]` to `LoadResult`, keep the merged fields,
   add unit tests for per-CU resolution (`test/unit/debug/dwarf4-line-*`).
3. **Provider wiring** — construct `IncludeLinkProvider` with project/workspace/artifact access,
   switch resolution to the ladder, add tooltips and the resolution cache.
4. **Adapter tests** — extend `include-link-provider.test.ts`, `test/regression/include-links.test.ts`
   and the shipped `source-paths` integration case (including `.incbin`/`.filesize`).
5. **Docs** — the files listed in §10, in the same commit.
6. **Optional follow-up** — unresolved-include diagnostic, then §12 (build context).

Verification gates to keep green: `npm run compile`, `npm run lint`, `npm run test:core`,
`npm run test:unit`, `npm run test:regression`, and the packaged integration lane.

## 14. Open Questions

1. Should the artifact-membership mismatch produce a visible diagnostic (squiggle/Problems entry) or
   only a tooltip note? A diagnostic is user-visible noise; a tooltip is easy to miss.
2. Should `.incbin`/`.filesize` link ranges cover only the quoted operand, or the whole directive
   including `, offset, length`? (Recommendation: operand only, consistent with `.include`.)
3. When the active project is not the project that produced the document being edited, should
   candidates 3/4/6 be used at all, or should the ladder degrade to 1/2/5 for foreign documents?
   Current proposal: use them only when the document lies under the project dir or appears in the
   artifact file table.
4. Should a hover (or the link tooltip) state "the last build did not include this file" when the
   artifact exists but the operand is absent from it?
5. Is a "why is this include unresolved" quick-fix worth it (open `${workspace}/build`, run make,
   show the assembler command from the Makefile)? Out of scope, but the natural next step.
6. POSIX: v6asm treats `\` as a literal character there; should the editor normalize `\` to `/` in
   operands on POSIX for navigation, or mirror the assembler exactly? (Recommendation: mirror.)
7. After migration, `resolveIncludePath` has only test callers — remove it, or keep it as the
   documented wrapper? The `PathService.resolveRelative` duplicate has the same question.
8. The `temp/project` copy has a layout (`samples/common/09_...`) that no heuristic can map to the
   build layout (`samples/09_...`). Is that copy expected to keep working for manual UI checks, and
   if so, should it be rebuilt from the repository root layout (or given `asm.sourceRoot` later)?
