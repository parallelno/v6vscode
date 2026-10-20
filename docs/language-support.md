# Language Support

## Shared presentation API

The extension exposes reusable assembly presentation services from
`src/language/language-services.ts`. `createLanguageServices()` initializes the registered
TextMate grammar and Oniguruma once, then provides:

- `sourceLines` for reading exact one-based debug source lines through VS Code documents,
  including unsaved changes.
- `highlighter` for stable assembly token classes without exposing TextMate scopes or HTML.
- `symbolLinks` for validated source-symbol ranges and debug source targets.
- `presentation` with `presentSourceLine()` and `presentStandaloneLine()` operations.

Source presentation includes resolved symbol links. Standalone assembly presentation returns
classified spans with an empty link list. Both cache families are bounded and are disposed with
the extension host. Trace Log consumes these same operations: exact mapped addresses use source
presentation, while unmapped addresses use standalone presentation for server disassembly.

### Performance baseline

On Windows with Node.js 21.6, the 512-line deterministic assembly benchmark recorded 243.1 ms
for cold grammar/WASM initialization plus first tokenization. Repeated warm cached document
tokenization averaged 0.506 ms. Treat these measurements as a regression baseline rather than a
cross-machine service-level objective.

Syntax highlighting, language configuration, and navigation for Intel 8080 assembly.

## Syntax Highlighting

Declared in `package.json` via `contributes.languages` and `contributes.grammars`. Language ID `asm`, file extensions `.asm`, `.s`, and `.inc`, grammar `source.v6vscode_8080` from `res/syntaxes/v6vscode_8080.tmLanguage.json`. The extension enables source breakpoints for this language.

Assembler struct definitions are first-class syntax: `.struct`, `.ends`, `.endstruct`, and `.pragma` are highlighted as directives; inside a struct body, field lines (`update_ptr: word`) highlight the field name as a label and the type keyword (`byte|db|word|dw|dword|dd`) as a directive; the struct name and its `extends` parent use type-name scopes. Instance declarations (`hero: char`) reuse the ordinary label highlighting.

## Language Configuration

`language-configuration.json` provides line comments (`;`), block comments (`/* */`), bracket pairs, auto-closing pairs, and surrounding pairs. The word pattern `[A-Za-z0-9_.@]+` treats dotted assembler symbols (`actor.update_ptr`) as single words for double-click selection and find-at-cursor.

## Source Links

Include parsing and resolution live in the host-free include-resolution module;
the VS Code provider owns link ranges and file URIs. Include operands resolve
against the containing source document directory, not the project/workspace root,
and missing targets still produce links. Existing case-sensitive/comment-matching
parser behavior is preserved. Source definitions retain DWARF relocation policy
and use the selected project-file directory; debug launch captures the same root
so nested/multi-folder projects do not redirect DAP sources to the first folder.

Ctrl/Cmd-click navigation is available for `.include "..."` paths and for constants and labels present in the active project's debug artifact. Constant links open the DWARF declaration location; label links open the exact `label:` definition when it is available in the artifact source-file table. Rebuild the project when links are missing or stale.

Struct symbols navigate by source scan when no ELF declaration exists: a struct name (`actor`) opens its `.struct` line; a generated offset constant (`actor.update_ptr`) opens the field line inside the struct block, following `extends` parents for inherited fields (`char.pos_x` opens `actor`'s field line); a dotted instance reference (`hero.pos_x`) opens the instance's `label:` line.
