# Unified Include Path Solver

**Status:** Draft; not implemented.

**Source review:** v6vscode `f012923` and v6asm `fd937d5`.
Repositories: `C:\Work\Programming\v6vscode` and `C:\Work\Programming\v6asm`.

## 1. Goal

Use the same file-search policy for `.include`, `.incbin`, and `.filesize`.
Missing targets must not look like working links.

## 2. Terminology

- The open document is the file currently open in the editor that contains the
directive whose path needs to be resolved.
- **Operand spelling:** path text written inside a directive's quotes.
- **Operand value:** path after any directive-specific string decoding.
- **Source directory:** directory of the physical source file containing the directive.
- **Compilation directory:** assembler process current working directory (CWD).
- **Entry source:** top-level `.asm` passed to the assembler.
- **Include directories:** a directories supplied to v6asm via `-I`.
- **Compilation unit (CU):** one assembly invocation represented in DWARF debug metadata;
  a linked ELF may contain several CUs with different contexts.
- **Resolution context:** source directory, compilation directory, and ordered include directories.

## 2. Validated current behavior

| Area | Current behavior and evidence |
|---|---|
| Extension links | `C:\Work\Programming\v6vscode\src\language\includes\include-resolution.ts`: `findIncludes` matches lowercase, double-quoted `.include`, including comments and mid-line occurrences. `resolveIncludePath` only anchors to the document directory; it does not probe files. |
| Missing targets | `C:\Work\Programming\v6vscode\src\language\includes\include-link-provider.ts`: `IncludeLinkProvider` emits a link for every match, including nonexistent targets. There is no directive diagnostic collection. |
| Other directives | No dedicated path links, definitions, or hover for `.incbin` and `.filesize`. |
| Assembler `.include` | `C:\Work\Programming\v6asm\crates\v6_core\src\preprocessor.rs`: `resolve_include_path` tries current source directory, `project_dir`, each `-I` directory, then the operand relative to process working directory. |
| Meaning of `project_dir` | `C:\Work\Programming\v6asm\crates\v6asm\src\main.rs`: `cmd_assemble` passes the entry source's parent directory to preprocessing and `Assembler::new`. This is not necessarily process CWD. |
| Assembler binary paths | `C:\Work\Programming\v6asm\crates\v6_core\src\assembler.rs`: `resolve_file_path` tries `project_dir`, then process CWD. `.incbin` and `.filesize` call it in assembly passes; neither gets the include-directory list or containing source directory. |
| Parsing | `C:\Work\Programming\v6asm\crates\v6_core\src\preprocessor.rs`: `parse_include_directive` accepts `.include` / `.INCLUDE` at the trimmed line start, with no label prefix, and either quote style, stripping `;` and `//` comments. `C:\Work\Programming\v6asm\crates\v6_core\src\parser.rs` dispatches other directives case-insensitively; `.filesize` supports `NAME .filesize "path"`. |
| String values | `C:\Work\Programming\v6asm\crates\v6_core\src\lexer.rs`: double-quoted string literals decode escapes. Single quotes produce character literals, not general path strings. The include preprocessor slices quotes instead of using this decoder. |
| DWARF producer | `C:\Work\Programming\v6asm\crates\v6_core\src\output.rs` passes `asm.project_dir()` to `debug_sections` for object and direct-ROM debug output. `C:\Work\Programming\v6asm\crates\v6_core\src\object\dwarf.rs` writes that directory as `DW_AT_comp_dir`, chooses the first sorted source file as `DW_AT_name`, and builds line-file directories from source paths. It does not serialize ordered CLI `-I` arguments. |
| DWARF consumer | `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf4-info-reader.ts` exposes only `compDir` and `stmtList` for a CU. `C:\Work\Programming\v6vscode\src\debug\metadata\debug-artifact-loader.ts` resolves line programs using per-CU directories, then merges files and rows into `DebugIndex`. There is no retained include-resolution context per CU. |
| Project configuration | `C:\Work\Programming\v6vscode\src\project\model\v6-project.ts` and `C:\Work\Programming\v6vscode\config\schemas\v6.project.schema.json` contain run settings only: executable, debug artifact, load address, speed, and display mode. They contain no compiler arguments, compilation directory, or include directories. |
| Breakpoints | `C:\Work\Programming\v6vscode\src\debug\metadata\debug-index.ts`: `resolveIndexedFile` prefers exact identity, then unique suffix matches. Ties remain unresolved intentionally. |

The search order below differs from the current v6asm behavior: the entry-source
directory is no longer tried separately.

## 3. Resolution contract

### Prerequiaites


- Each CU keeps its own source file list.

### Absolute path in operand

- Use as it; no resolution required.
- If absolute path is invalid or no file is found, operand is unresolved. Do
  not perform any further searches.

### Relative path in operand

#### Determine the CU of the open document

- Resolve the full paths of the source files in each CU.
  - Full path = join()

- Compare the open document's full path against the resolved full paths of the
  source files in each CU. The first matching CU is considered the owner of the
  open document.
- Use that CU's compilation directory and `-I` list to resolve every directive
  path in the document.

If no CU contains the open document, omit the optional resolution steps in §3.1
that require ELF information.

#### Path resolution rules

Join the dir in the list below with operand. Use the first one that exists. If
no file is found, the operand is unresolved.

1. Document directory.
2. Each `-I` directory, in command-line order. Optional. Used when ELF is avaiable.
3. Compilation directory root directory. Optional. Used when ELF is avaiable.

#### 3.2 `-I` directory path resolution rules

- If `-I` directory is absolute, used unchanged.
- If `-I` directory is relative, join the compilation directory with the `-I`
  directory.

### 3.3 Parsing and operand ranges

Introduce a directive scanner independent of VS Code. Return directive kind, operand
spelling/value, and the original quoted-content range.

- Ignore `;`, `//`, and block comments outside strings while preserving positions.
- Require directive token boundaries; do not match `.includeExtra` or text inside strings.
- Make all three directives case-insensitive in both projects.
- Accept an optional label before every one of them: `label: .include "x"`,
  `label: .incbin "x.bin"`, and `label: SIZE .filesize "x.bin"`. The existing
  `NAME .filesize "path"` form remains valid. v6asm's preprocessor must recognize
  `.include` after a label, as the parser already does for `.incbin` and `.filesize`.
- Use one path-literal rule for all three directives: a path is a double-quoted
  string (`"..."`) with the lexer's escape decoding. The extension scanner applies
  the same decoding and keeps the range on the original quoted text.
- For `.incbin "path", offset, length`, select only the path.
- Empty/unclosed/invalid literals are syntax problems, not missing files. Emit no path
  link or duplicate missing-file diagnostic for them.
- Use original UTF-16 offsets for editor ranges, including escaped spellings, CRLF,
  Unicode, and text before the operand. Decoded value length is not range length.

v6asm currently accepts single-quoted `.include` paths; this proposal removes that
form so all three directives require double quotes. The extension scanner already
matches only double-quoted operands.

## 4. Extension behavior

All directive UI consumers use the same resolution result.

When the resolution context is known:

- Resolved operand: a link to the file and a hover showing its path.
- Unresolved operand: no link and exactly one `Error` diagnostic on the path inside
  the quotes, with hover message `Cannot find file "..."`.

Resolution requires the compilation directory and `-I` list from the ELF. Without a
matching CU context, the extension emits no directive link and no missing-file diagnostic.

Go to Definition can open an included source file at its start. Binary operands link
to the file itself.

Suggested boundaries within `C:\Work\Programming\v6vscode\src\language\includes`:

- Directive scanner that returns the operand and its editor range.
- Resolution service implementing §3.1 with the context from §3.2.
- Thin adapters for links, definitions, hover, and one owned diagnostic collection.
- Composition in `C:\Work\Programming\v6vscode\src\extension.ts`, using existing
  active-project and artifact services.

Update links and diagnostics when the document, selected project, ELF, or referenced
files change. Creating a file in an earlier search directory can change the result,
even if the previously linked file still exists. Discard results for outdated document
versions and clear diagnostics when a document closes. Filesystem work should not block
typing; the implementation should define how changes outside the workspace are detected.

## 5. Assembler implementation design

Introduce one Rust resolution context/resolver for preprocessing, original-source
collection, and both passes handling `.incbin` / `.filesize`.

- Capture absolute compilation CWD, entry source, and ordered CLI include directories
  once in `cmd_assemble`; pass the context explicitly to the core.
- Make the containing source path available when resolving binary directives.
  `SourceLine.file` currently uses paths relative to `project_dir`; account for that
  base when obtaining the source directory.
- Give binary directives their originating source directory, not just `Assembler.project_dir`.
  Library callers and tests must supply equivalent context.
- Use the same resolver for original-source collection and actual preprocessing.
- For a line written inside a macro body, the source directory is that of the macro
  definition file: `SourceLine.origin` records the body location while `SourceLine.file`
  records the invocation. This matches what the editor scans in the document.

## 6. DWARF and ELF metadata

### 6.1 Standard source identity

Correct CU fields in relocatable objects and direct-ROM companions:

- `DW_AT_comp_dir`: absolute compilation directory.
- `DW_AT_name`: actual entry source relative to the compilation directory when possible,
  otherwise absolute.
- `.debug_line`: selected source locations using normal file/directory entries.
  Relative directories are relative to the CU compilation directory.

An invocation from `C:/home/user/project` of `v6asm src/main.asm` should produce:

```text
DW_AT_name     = src/main.asm
DW_AT_comp_dir = C:/home/user/project
```

Keep the resolved source location in `.debug_line`, not just the operand spelling.
For example, `a/part.asm` and `b/part.asm` can both contain `.include "common.inc"`
but include `a/common.inc` and `b/common.inc` respectively. Recording only `common.inc`
would lose which file contributed the debug lines.

Changing `comp_dir` requires consistently rebasing relative line files, declarations,
macro definition/invocation paths, and other source references. Changing only the CU
attribute would point existing rows at the wrong files.

### 6.2 Ordered search-directory metadata

Store the ordered `-I` directory list for each CU in the ELF. Relative entries are
resolved against that CU's `DW_AT_comp_dir`.

The existing `.debug_line` directory table cannot supply this list: the writer builds
it from recorded source paths and sorts it. It does not preserve CLI search order or
include directories that supplied no recorded source files.

The storage format is not decided. It must associate each list with its CU and survive
object linking, since different assembly invocations can use different directories.
An explicitly recorded empty list must be distinguishable from an older ELF that
does not record `-I` information. Choose the encoding in both projects together (§9).

### 6.3 Extension reader and debugger compatibility

Retain CU identity, entry source, compilation directory, `stmt_list`, optional
search metadata, and each CU's own source file list. `DW_AT_stmt_list` identifies the
CU's line program, and the file list identifies the open document's CU (§3.2). Existing
ELF files without the new information must still load and support their current
debugging behavior.

## 7. Acceptance tests

| Layer | Required cases |
|---|---|
| Scanner | Three directives; mixed case; double-quoted strings with escapes; optional labels and `NAME .filesize`; all comment forms and quoted comment markers; directive prefixes; empty/malformed/single-quoted operands; escaped value versus original range; CRLF/Unicode. |
| Resolver, both languages | Absolute and relative operands; source directory before `-I`; `-I` command-line order; compilation-directory fallback; relative `-I` paths; nested source with a different entry directory; paths containing spaces and `..`. |
| Cross-project parity | Shared fixture tree/context with colliding names at every search tier; compare extension target with assembler bytes or `.filesize` value. Run actual CLI subprocesses with explicit CWD, not only core tests whose project root equals source root. |
| Assembler | Both passes, recursive includes, listing/original-source collection, label-prefixed directives, double-quoted strings with escapes, macro-body directives using the definition file's directory, include-once, library callers, direct-ROM and object modes. |
| Metadata | Correct compilation directory and entry name when an include sorts first; ordered `-I`, including unused directories; empty list versus absent information; source paths still resolve correctly after changing `comp_dir`. |
| Linked ELF / consumer | Two objects with different CWDs/`-I` lists retain the correct directories and source files for each CU after linking; a document listed only by the second CU resolves with that CU's context; old ELF and C-produced ELF still work. |
| Providers / lifecycle | Link/definition/hover ranges and targets; one missing diagnostic and no link; target creation/deletion and search-priority changes; document edits and project/ELF changes; no link or diagnostic when the ELF has no matching CU context. |
| Debug regression | Breakpoints and source navigation still work for nested includes and linked CUs, including files with the same basename. |

Existing test baselines:

- `C:\Work\Programming\v6vscode\test\unit\language\include-resolution.test.ts`
- `C:\Work\Programming\v6vscode\test\unit\language\include-link-provider.test.ts`
- `C:\Work\Programming\v6vscode\test\regression\include-links.test.ts`
- `C:\Work\Programming\v6vscode\test\core\path-policies.test.ts`
- `C:\Work\Programming\v6vscode\test\unit\debug\dwarf4-line-compdirs.test.ts`
- `C:\Work\Programming\v6asm\crates\v6_core\tests\assembler_tests.rs`
- `C:\Work\Programming\v6asm\crates\v6_core\tests\object_tests.rs`

Current tests assert comment matches, rejection of single-quoted `.include`,
missing-target links, and lexical-only resolution. Update those assertions.

Implementation gates: `npm run ci` and relevant real Extension Host suites from
`C:\Work\Programming\v6vscode`; `cargo test --workspace` from
`C:\Work\Programming\v6asm`, plus explicit-CWD parity and linked-ELF fixtures.

## 8. Delivery, documentation, and scope

1. Resolve the open questions in §9.
2. Implement Rust context propagation and resolution with CLI fixtures.
3. Correct standard source identity and add per-CU search metadata; verify linked output.
4. Extend the extension's CU context projection.
5. Add scanner/service, then links, definitions/hover, and diagnostic lifecycle.
6. Pass parity and debugger regression suites before claiming unified behavior.

Update `C:\Work\Programming\v6asm\docs\directives.md` and
`C:\Work\Programming\v6asm\docs\cli.md` with exact precedence and migration guidance:
add `-I src` if nested sources relied on implicit entry-directory fallback. Document
that binary directives can now select a nearer source-relative file instead of the
old root-relative file. Document that single-quoted directive paths must be rewritten
with double quotes. Add a release note: filename collisions can silently change output.

Update `C:\Work\Programming\v6asm\docs\debug-metadata.md` with CU fields and the
chosen include-directory encoding. Update `C:\Work\Programming\v6vscode\README.md`
and user documentation with navigation, diagnostics, and behavior when the ELF has
no matching compilation-unit context.

Scope: directive path lookup and the metadata needed to reproduce it in the editor.

## 9. Open questions

1. **Compatibility:** §3.1 removes implicit entry-source-directory fallback for nested
   files, and §3.3 requires double-quoted directive paths. Confirm those migrations
   rather than retaining the old fallbacks.
2. **Metadata encoding:** how should ordered per-CU `-I` lists be stored in the ELF?
   Select a format and verify that it survives linking before implementing the reader.

The ELF records the last build's options. If build flags change without rebuilding,
the extension cannot infer the new search directories from that ELF.
