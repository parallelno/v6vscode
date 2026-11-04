# v6vscode directive path navigation

**Status:** Draft; not implemented.

## 1. Goal

Provide file links, path information, and missing-file diagnostics for `.include`,
`.incbin`, and `.filesize` using the open document and workspace files. Lookup works
without DWARF or a previous build and is unaffected by missing or outdated ELF files.

- **Open document:** the file in the editor containing the directive.
- **Document directory:** directory containing that file.
- **Workspace directory:** a folder opened as part of the VS Code workspace.
- **Operand spelling:** text inside the directive's quotes.
- **Operand value:** that text after string escape decoding; used for file lookup.
- **Base filename:** the final component of the operand value, for example
  `common.inc` in `lib/common.inc`.

## 2. Current behavior

`C:\Work\Programming\v6vscode\src\language\includes\include-resolution.ts`
recognizes lowercase, double-quoted `.include`, including occurrences in comments.
It resolves paths relative to the document directory without checking existence.

`C:\Work\Programming\v6vscode\src\language\includes\include-link-provider.ts`
creates links even for missing files. `.incbin` and `.filesize` have no dedicated path
navigation or missing-file diagnostics.

## 3. Lookup rules

### 3.1 Absolute operands

Try these steps in order, stopping at the first file found:

1. Use an absolute path as-is.
2. Search workspace files for the base filename and use the first matching candidate.

If no file is found, the operand is unresolved.

In step 2, match the filename, not the operand's directory components. For
`missing/sub/common.inc`, a workspace file `shared/common.inc` is a candidate.

### 3.2 Relative operands

Try these steps in order, stopping at the first file found:

1. Relative to the open document: `join(document_directory, operand_value)`.
2. Relative to the workspace directory: `join(workspace_directory, operand_value)`.
3. Search workspace files for the base filename and use the first matching candidate.

If no file is found, the operand is unresolved.

### 3.3 Workspace lookup and filename search

A **workspace root** is a directory opened in VS Code. A workspace can have one or
several roots.

**Workspace-relative lookup** checks an exact path: join the workspace root with
the operand. For root `/project` and operand `lib/common.inc`, check
`/project/lib/common.inc`.

**Filename search** searches the entire workspace, including all subfolders, for
files with the operand's base filename. For `missing/sub/common.inc`, a workspace
file `shared/common.inc` is a candidate.

With several roots, put the root containing the open document first, followed by
the other roots in the order shown in VS Code. Check the exact workspace-relative
paths in all roots before searching by filename.

For example, roots `/app` and `/shared`, open document `/app/src/main.asm`, and
operand `lib/common.inc` give this lookup order:

```text
1. /app/src/lib/common.inc
2. /app/lib/common.inc
3. /shared/lib/common.inc
4. Search /app and its subfolders for common.inc.
5. Search /shared and its subfolders for common.inc.
```

Stop at the first match. If a filename search finds several files in one root,
sort their paths alphabetically and use the first. For example,
`/app/assets/common.inc` comes before `/app/shared/common.inc`.

Without a workspace, search steps 2 and 3 in the §3.2 are skipped.

### 3.4 Example

Workspace `C:/project`, open document `C:/project/src/main.asm`, operand `lib/common.inc`:

```text
1. C:/project/src/lib/common.inc
2. C:/project/lib/common.inc
3. First workspace file named common.inc, such as C:/project/shared/common.inc
```

## 4. Directive scanning

Use the same scanner and lookup service for all three directives:

- Directive names are case-insensitive.
- Optional labels are accepted: `label: .include "x"`, `label: .incbin "x.bin"`,
  and `label: SIZE .filesize "x.bin"`. Preserve `NAME .filesize "path"` support.
- Path operands are double-quoted strings using v6asm's lexer escape rules.
  Decode escapes for lookup, but retain the original quoted-content range for the UI.
- Ignore comments outside strings: `;`, `//`, and block comments.
- For `.incbin "path", offset, length`, only the path is a file operand.
- Empty, unclosed, single-quoted, or otherwise invalid path literals receive no file
  link or missing-file diagnostic.
- Editor ranges use UTF-16 offsets and exclude the quotes, including with escapes,
  Unicode, or CRLF line endings.

Scan the text in the open document, including unsaved edits. Navigation and path
information are available for directives inside macros or conditional blocks as well.

## 5. Editor behavior

All providers use the same lookup result:

| Result | Behavior |
|---|---|
| Resolved | Link to the chosen file; hover shows its full path; no missing-file diagnostic. |
| Unresolved | No link; red squiggle and an error hover on the quoted path, with message `Cannot find file "..."`. |

Go to Definition opens an included source file at its start. Binary operands link
to the file itself. When filename search finds several candidates, use the first
according to §3.3 and show that file's path in the hover.

## 6. Implementation

Keep the scanner and candidate-order logic independent of VS Code APIs. Inject file
existence checks and workspace filename search into a resolution service. Providers
convert the service's results into links, locations, hovers, and diagnostics.

Existing integration points:

- `C:\Work\Programming\v6vscode\src\language\includes`: scanner, lookup service,
  and provider adapters.
- `C:\Work\Programming\v6vscode\src\platform\files\workspace-service.ts`:
  workspace folders.
- `C:\Work\Programming\v6vscode\src\extension.ts`: register providers and own
  diagnostic collection/listener disposal.

Use asynchronous file checks and VS Code workspace file search. Match the base
filename literally; filenames containing glob characters must not broaden the search.
Reuse filename-search results across operands in one document analysis.

Refresh results when the document changes, workspace folders change, or files are
created, deleted, or renamed. Creating a higher-priority file must replace a lower-priority
link. Discard results for outdated document versions and clear diagnostics on close.

## 7. Tests

- Absolute hit/miss; a missing absolute path never triggers workspace search.
- Document-relative file takes priority over workspace-relative and filename matches.
- Workspace-relative file takes priority over filename matches.
- Filename search uses only the base filename, including when the operand contains
  nonexistent directories; multiple matches follow §3.3 ordering.
- Multi-folder workspace order; no-workspace document-relative lookup.
- No ELF, outdated ELF, and no selected project: lookup behavior is unchanged.
- All three directives, labels, mixed case, double quotes, escapes, comments,
  malformed literals, CRLF, and Unicode ranges.
- Directives inside macro and conditional blocks still provide navigation.
- Missing file: no link and exactly one Error; file creation removes that Error.
- File deletion/rename, a new higher-priority match, unsaved edits, and document close.
- Real Extension Host links, definitions, hovers, and diagnostic ranges.

Update existing include tests in:

- `C:\Work\Programming\v6vscode\test\unit\language\include-resolution.test.ts`
- `C:\Work\Programming\v6vscode\test\unit\language\include-link-provider.test.ts`
- `C:\Work\Programming\v6vscode\test\regression\include-links.test.ts`

Run `npm run ci` and the relevant Extension Host integration tests from
`C:\Work\Programming\v6vscode`.

## 8. Documentation

Update `C:\Work\Programming\v6vscode\README.md` with the lookup order and
missing-file behavior. Explain filename-search selection: the editor shows the first
workspace candidate; this navigation choice does not determine which file v6asm builds.
