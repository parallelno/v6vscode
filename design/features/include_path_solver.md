# Unified Include Path Solver

**Status:** Revised draft; not implemented. Search-order migration requires approval;
metadata encoding and macro-origin decisions remain implementation gates (§9).

**Validated against:** v6vscode `923c6d6` and v6asm `fd937d5`.
Repositories: `C:\Work\Programming\v6vscode` and `C:\Work\Programming\v6asm`.

## 1. Goal and terminology

Use the same file-search policy for `.include`, `.incbin`, and `.filesize` in
v6asm and the extension. Missing targets must not look like working links.
Keep directive resolution separate from debug-source relocation and breakpoint matching.

- **Operand spelling:** path text written inside a directive's quotes.
- **Operand value:** path after any directive-specific string decoding.
- **Source directory:** directory of the physical source file containing the directive.
- **Compilation directory:** assembler process working directory captured at invocation.
- **Entry source:** top-level `.asm` passed to the assembler.
- **Compilation unit (CU):** one assembly invocation represented in DWARF debug metadata;
  a linked ELF may contain several CUs with different contexts.
- **Resolution context:** source directory, compilation directory, and ordered include directories.
- **Resolved source identity:** selected file's normalized path, independent of operand spelling.

“Unified” means equivalent inputs produce equivalent results, not that TypeScript
and Rust share a runtime module or that all path-related features use one resolver.

## 2. Validated current behavior

References identify functions rather than relying on unstable line numbers.

| Area | Current behavior and evidence |
|---|---|
| Extension links | `C:\Work\Programming\v6vscode\src\language\includes\include-resolution.ts`: `findIncludes` matches lowercase, double-quoted `.include`, including comments and mid-line occurrences. `resolveIncludePath` only anchors to the document directory; it does not probe files. |
| Missing targets | `C:\Work\Programming\v6vscode\src\language\includes\include-link-provider.ts`: `IncludeLinkProvider` emits a link for every match, including nonexistent targets. There is no directive diagnostic collection. |
| Other directives | No dedicated path links, definitions, or hover for `.incbin` and `.filesize`. Existing symbol navigation is a separate feature. |
| Assembler `.include` | `C:\Work\Programming\v6asm\crates\v6_core\src\preprocessor.rs`: `resolve_include_path` tries current source directory, `project_dir`, each `-I` directory, then the operand relative to process CWD. It uses `exists()`, not a regular-file check. |
| Meaning of `project_dir` | `C:\Work\Programming\v6asm\crates\v6asm\src\main.rs`: `cmd_assemble` passes the entry source's parent directory to preprocessing and `Assembler::new`. This is not necessarily process CWD. |
| Assembler binary paths | `C:\Work\Programming\v6asm\crates\v6_core\src\assembler.rs`: `resolve_file_path` tries `project_dir`, then process CWD. `.incbin` and `.filesize` call it in assembly passes; neither gets the include-directory list or containing source directory. |
| Parsing | `C:\Work\Programming\v6asm\crates\v6_core\src\preprocessor.rs`: `parse_include_directive` accepts `.include` / `.INCLUDE` at the trimmed line start and either quote style, stripping `;` and `//` comments. `C:\Work\Programming\v6asm\crates\v6_core\src\parser.rs` dispatches other directives case-insensitively; `.filesize` supports `NAME .filesize "path"`. |
| String values | `C:\Work\Programming\v6asm\crates\v6_core\src\lexer.rs`: double-quoted string literals decode escapes. Single quotes produce character literals, not general path strings. The include preprocessor slices quotes instead of using this decoder. |
| DWARF producer | `C:\Work\Programming\v6asm\crates\v6_core\src\output.rs` passes `asm.project_dir()` to `debug_sections` for object and direct-ROM debug output. `C:\Work\Programming\v6asm\crates\v6_core\src\object\dwarf.rs` writes that directory as `DW_AT_comp_dir`, chooses the first sorted source file as `DW_AT_name`, and builds line-file directories from source paths. It does not serialize ordered CLI `-I` arguments. |
| DWARF consumer | `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf4-info-reader.ts` exposes only `compDir` and `stmtList` for a CU. `C:\Work\Programming\v6vscode\src\debug\metadata\debug-artifact-loader.ts` resolves line programs using per-CU directories, then merges files and rows into `DebugIndex`. There is no retained include-resolution context per CU. |
| Project configuration | `C:\Work\Programming\v6vscode\src\project\model\v6-project.ts` and `C:\Work\Programming\v6vscode\config\schemas\v6.project.schema.json` contain run settings, not compiler arguments, build CWD, or include directories. They cannot currently supply exact pre-build context. |
| Breakpoints | `C:\Work\Programming\v6vscode\src\debug\metadata\debug-index.ts`: `resolveIndexedFile` prefers exact identity, then unique suffix matches. Ties remain unresolved intentionally. |

The search order below is a behavior change, not existing v6asm behavior. In particular,
entry-source-directory fallback disappears for nested includes unless that directory
is also the compilation directory or an explicit `-I`.

## 3. Resolution contract

### 3.1 Candidate generation and selection

For each valid, nonempty operand value:

1. If host-absolute, probe only that path; a missing absolute target does not fall back.
2. Otherwise probe relative to the containing source directory.
3. Probe relative to each `-I` directory in original CLI order.
4. Probe relative to the compilation directory.

Resolve relative `-I` directories against the compilation directory, never the document,
entry source, extension process CWD, or first workspace folder. Select the first regular
file; directories are not targets. Preserve order when deduplicating normalized candidates.
Do not recursively scan directories, expand environment variables or `~`, or apply
debug-source suffix relocation to directive operands.

Return a structured result: resolved target and winning search step, missing with
attempted candidates, or filesystem error. Missing candidates advance the search;
access/I/O errors must not silently select a lower-priority file. Selection does not
guarantee reading succeeds: v6asm still reports read errors at the originating directive.
Symlinks to regular files are allowed; `.pragma once` canonicalization stays separate.

Use host path semantics for live files. Cross-host debug paths belong to relocation.
Reject Windows drive-relative operands such as `C:asset.bin` rather than using per-drive CWD.

### 3.2 Extension context selection

Capture an immutable context per request. Never prompt for project selection from a
link, hover, or diagnostic request.

1. Use the already selected active project's debug artifact, if available.
2. Identify CUs containing the document by exact reconstructed source identity,
   including line-file entries without executable rows. Retain membership before merging indexes.
3. A unique matching CU with supported path metadata supplies authoritative context.
   If several CUs contain the same file, resolve in all of them: accept only when they
   agree on a target or all agree it is missing. Conflicts are ambiguous; do not choose
   the lowest CU ID. If any matching CU lacks usable context, treat the result as provisional.
4. Without usable metadata or document membership, use document-directory lookup then
   the active `*.project.json` directory as a **provisional** fallback. With no active
   project, use document-directory lookup only. Do not invent `-I` values.

An artifact describes the last build, not necessarily changed build flags or unsaved
source. Show provenance in hover/logging; do not call provisional lookup compiler-equivalent.
The project-file directory equals compilation CWD only when the build was invoked there.
Malformed/unsupported optional path metadata degrades to provisional behavior without
disabling normal debugging. Relocated documents whose CU identity cannot be established
exactly also remain provisional; never guess CU ownership from a basename.

### 3.3 Parsing and operand ranges

Introduce a directive scanner independent of VS Code. Return directive kind, operand
spelling/value, and the original quoted-content range.

- Ignore `;`, `//`, and block comments outside strings while preserving positions.
- Require directive token boundaries; do not match `.includeExtra` or text inside strings.
- Make `.include` case-insensitive in both projects as an explicit grammar improvement.
- Keep `.include` at statement start after whitespace; do not silently add label-prefixed
  include support. For `.incbin` and `.filesize`, honor existing parser label handling
  and `NAME .filesize "path"` syntax.
- Preserve single-quoted `.include` support; do not infer single-quoted path support for
  `.incbin` / `.filesize`. Preserve directive-specific decoding until a separate grammar
  change is approved. Recommend forward slashes for portable path literals.
- For `.incbin "path", offset, length`, select only the path.
- Empty/unclosed/invalid literals are syntax problems, not missing files. Emit no path
  link or duplicate missing-file diagnostic for them.
- Use original UTF-16 offsets for editor ranges, including escaped spellings, CRLF,
  Unicode, and text before the operand. Decoded value length is not range length.

The scanner is not an assembler. It cannot authoritatively evaluate conditional
assembly, macro substitution, or generated operands. Suppress authoritative missing-file
Errors for `.incbin` / `.filesize` where execution/value cannot be established; keep them
advisory or suppress them entirely. Include preprocessing precedes conditional expansion
today; retain and test that distinction.

## 4. Extension behavior and ownership

All directive UI consumers use one resolution result, not separate search implementations.

| Result | Link / definition | Hover / diagnostic |
|---|---|---|
| Resolved | Link to selected file. Source-include definition goes to file start; binary targets use file links, not invented source locations. | Resolved path and context provenance; no missing-file diagnostic. |
| Missing, authoritative | Neither | Exactly one Error on quoted content: `Cannot find file "..."`. Diagnostic source `v6`, stable code `file-not-found`. |
| Missing, provisional | Neither | One Warning with missing-file message plus unavailable-context explanation. |
| Conflicting CU contexts | Neither | One Warning describing contextual ambiguity, not a missing-file Error. |
| Filesystem failure | Neither | One distinct access/I/O diagnostic, not `file-not-found`. |

Warning severity without authoritative context is a deliberate refinement of the original
“all missing operands are Errors” requirement: absent `-I` metadata is not proof of absence.
Even complete metadata is last-build context; the editor does not prove current build equivalence.

Use normal VS Code file opening for binary links; do not read binary contents as assembly
in hover. Prevent the symbol provider from interpreting path text as symbols. Reuse
diagnostic information in hover instead of displaying duplicate messages.

Suggested boundaries within `C:\Work\Programming\v6vscode\src\language\includes`:

- Pure directive scanner and ordered candidate generator.
- Resolution service with injected asynchronous regular-file probing and captured context.
- Thin adapters for links, definitions, hover, and one owned diagnostic collection.
- Composition in `C:\Work\Programming\v6vscode\src\extension.ts`, using existing
  active-project and artifact services rather than a new global project selector.

Debounce analysis; discard cancelled/stale document versions or context generations.
Recompute on open/edit/save, project/artifact changes, and file create/delete/rename,
including creation of a higher-priority candidate. Invalidate negative results too.
Clear diagnostics on close/disposal and after context changes. External include directories
need watchers or a documented refresh path; workspace watchers alone are insufficient.
Limit concurrency and avoid synchronous probing in editor providers. Initially support
local `file:` documents only; do not convert virtual/untitled URIs into host paths.

## 5. Assembler implementation design

Introduce one Rust resolution context/resolver for preprocessing, original-source
collection, and both passes handling `.incbin` / `.filesize`.

- Capture absolute compilation CWD, entry source, and ordered CLI include directories
  once in `cmd_assemble`; pass the context explicitly to the core.
- Preserve selected physical source origin in `SourceLine` through includes and passes.
  Existing display paths relative to `project_dir` must be reconstructed against their
  recorded base, never ambient CWD, or replaced with explicit physical-origin fields.
- Give binary directives their originating source directory, not just `Assembler.project_dir`.
  Library callers and tests must supply equivalent context.
- Keep listing display paths separate from physical paths and include-once identity.
- Use the same resolver for original-source collection and actual preprocessing.
- Specify macro-expanded directives' physical origin before rollout (§9); existing
  macro debug attribution is not itself a filesystem-resolution specification.

## 6. DWARF and ELF metadata

### 6.1 Standard source identity

Correct CU fields in relocatable objects and direct-ROM companions:

- `DW_AT_comp_dir`: absolute compilation directory, not entry source parent.
- `DW_AT_name`: actual entry source relative to compilation directory when possible,
  otherwise absolute; never the first sorted source filename.
- `.debug_line`: selected source locations using normal file/directory entries.
  Relative directories are relative to the CU compilation directory.

An invocation from `C:/home/user/project` of `v6asm src/main.asm` should produce:

```text
DW_AT_name     = src/main.asm
DW_AT_comp_dir = C:/home/user/project
```

Do **not** replace line-file identities with operand spellings. Two nested files can
both include `common.inc` but select different files; one file can also have several
spellings. An operand loses the including-directory edge. If future tools need include
edges, store `(including file, operand spelling, selected file)` separately.

Changing `comp_dir` requires consistently rebasing relative line files, declarations,
macro definition/invocation paths, and other source references. Changing only the CU
attribute would point existing rows at the wrong files.

### 6.2 Ordered search-directory metadata

The `.debug_line` directory table is **not** CLI `-I`: it records source directories,
may be sorted/deduplicated, and omits unused search directories. Never infer search order from it.

Proposed encoding: a vendor-specific CU attribute with `DW_FORM_strp`, referencing
a versioned JSON object in `.debug_str`, for example:

```json
{"version":1,"includeDirectories":["libs","../shared","libs"]}
```

Preserve order and duplicates. Relative paths use that CU's `DW_AT_comp_dir`; retain
invocation spelling. Entry source and compilation directory stay in standard attributes.
Allocate/document a non-conflicting vendor attribute number before implementation.
Ignore unknown versions as optional context; validate field types and payload size.
Do not serialize a command line for consumers to shell-parse.

Verify the string reference participates in `.debug_info` relocation and survives
`ld.lld` linking with independent payloads per CU. Never use an ELF-global include list
for objects compiled with different arguments. This encoding is proposed, not existing.

### 6.3 Consumer compatibility and breakpoints

Retain CU identity, entry source, compilation directory, `stmt_list`, and optional
search metadata. Preserve mapping to line programs via `DW_AT_stmt_list` and the existing
legacy order fallback for files lacking that attribute. Do not use the first CU's
context for every document. Old ELF and C-produced ELF must remain usable without the
vendor attribute.

Keep breakpoint policy separate: exact identity wins; distinct files tied on suffix
matching remain ambiguous. “Lowest unit ID wins” is deterministic but unsafe and is
rejected. One physical source in several CUs may map to several addresses; preserve
`resolveBreakpointAll`, not just one CU. Do not claim ambiguity becomes impossible or
replace the debug-source relocation algorithm as part of directive resolution.

## 7. Acceptance tests

These are implementation requirements, not tests already added by this design review.

| Layer | Required cases |
|---|---|
| Scanner | Three directives; mixed case; supported quotes; label/constant prefixes; all comment forms and quoted comment markers; directive prefixes; empty/malformed operands; escaped value versus original range; CRLF/Unicode. |
| Resolver, both languages | Absolute hit/miss with no fallback; source beats `-I`; first `-I` wins; `-I` beats CWD; CWD fallback; nested source versus entry directory; relative `-I` anchor; duplicates, `..`, spaces, symlinks, directories, access/I/O errors; Windows drive/UNC and rejected drive-relative paths. Inject probes for deterministic permission tests. |
| Cross-project parity | Shared fixture tree/context with colliding names at every search tier; compare extension target with assembler bytes or `.filesize` value. Run actual CLI subprocesses with explicit CWD, not only core tests whose project root equals source root. |
| Assembler | Both passes, recursive includes, listing/original-source collection, macro origin, conditional binary directives, include-once, library callers, direct-ROM and object modes. |
| Metadata | Correct CWD and entry name when an include sorts first; unused/repeated ordered `-I`; empty list versus absent metadata; unknown/malformed versions; source rebasing; declaration/macro/data-only files. |
| Linked ELF / consumer | Two objects with different CWDs/`-I` lists; string relocations, CU ownership and `stmt_list` mapping; old ELF and C-produced ELF still work. |
| Providers / lifecycle | Real Extension Host link/definition/hover ranges and URIs; one missing diagnostic and no link; provisional/conflicting contexts; target creation/deletion/rename/priority changes; project/artifact switches; dirty edits, cancellation, close/disposal; external directory refresh; no project and unsupported URI. |
| Debug regression | Exact/relocated source lookup; tied basenames stay ambiguous; one physical file in several CUs retains all breakpoint addresses; stack frames, symbol definitions, declarations and Trace Log still locate sources. |

Existing baselines to retain or deliberately update:

- `C:\Work\Programming\v6vscode\test\unit\language\include-resolution.test.ts`
- `C:\Work\Programming\v6vscode\test\unit\language\include-link-provider.test.ts`
- `C:\Work\Programming\v6vscode\test\regression\include-links.test.ts`
- `C:\Work\Programming\v6vscode\test\core\path-policies.test.ts`
- `C:\Work\Programming\v6vscode\test\unit\debug\dwarf4-line-compdirs.test.ts`
- `C:\Work\Programming\v6asm\crates\v6_core\tests\assembler_tests.rs`
- `C:\Work\Programming\v6asm\crates\v6_core\tests\object_tests.rs`

Current tests intentionally assert comment matches, missing-target links, and lexical-only
resolution. Update those assertions as approved behavior changes, not incidental cleanup.

Implementation gates: `npm run ci` and relevant real Extension Host suites from
`C:\Work\Programming\v6vscode`; `cargo test --workspace` from
`C:\Work\Programming\v6asm`, plus explicit-CWD parity and linked-ELF fixtures.

### Design-review verification

Against the unchanged implementation, 46 focused TypeScript tests passed covering include
parsing/links, path policies, and per-CU directories. The Rust assembler regression suite
and all 46 object tests passed. These validate the baseline, not the proposed new behavior.

## 8. Delivery, documentation, and scope

1. Approve migration and close §9 gates.
2. Implement Rust context propagation and resolution with CLI fixtures.
3. Correct standard source identity and add per-CU search metadata; verify linked output.
4. Extend extension CU context projection without changing legacy debugging.
5. Add scanner/service, then links, definitions/hover, and diagnostic lifecycle.
6. Pass parity and debugger regression suites before claiming unified behavior.

Update `C:\Work\Programming\v6asm\docs\directives.md` and
`C:\Work\Programming\v6asm\docs\cli.md` with exact precedence and migration guidance:
add `-I src` if nested sources relied on implicit entry-directory fallback. Document
that binary directives can now select a nearer source-relative file instead of the
old root-relative file. Add a release note: filename collisions can silently change output.

Update `C:\Work\Programming\v6asm\docs\debug-metadata.md` with CU fields, vendor
encoding/version and linker requirements. Update `C:\Work\Programming\v6vscode\README.md`
and user documentation with navigation, severities, last-build context, pre-build
limitations, and refresh behavior.

Out of scope: a universal path service, recursive discovery, full macro/conditional
evaluation in the editor, project-wide syntax checking, binary preview tools, remote
filesystems, automatic build-task argument discovery, or arbitrary breakpoint tie-breaking.
Do not change project JSON schema merely to imply build context unavailable today.

## 9. Decisions required before implementation

1. **Compatibility:** approve removing implicit entry-source-directory fallback and
   putting `-I` before compilation CWD. If compatibility is required, revise the contract
   and both implementations' fixtures together; do not silently mix policies.
2. **Metadata encoding:** confirm the vendor CU attribute approach, allocate its numeric
   code, and prove unknown-attribute handling/linker relocation before freezing v1.
3. **Macro origin:** choose definition-site or invocation-site source-directory semantics
   for macro-expanded binary directives; record the chosen physical origin explicitly.
4. **Pre-build context:** this draft chooses provisional lookup and Warnings without
   supported CU metadata. Authoritative pre-build Errors require a separate explicit
   build-configuration source; the project-file directory alone is insufficient.

**Review conclusion:** the unified directive policy is viable with explicit context
propagation and optional per-CU metadata. Operand-only line tables and unit-order
breakpoint selection are unsafe and must not be prerequisites.
