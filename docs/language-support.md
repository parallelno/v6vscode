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
the extension host.

### Performance baseline

On Windows with Node.js 21.6, the 512-line deterministic assembly benchmark recorded 243.1 ms
for cold grammar/WASM initialization plus first tokenization. Repeated warm cached document
tokenization averaged 0.506 ms. Treat these measurements as a regression baseline rather than a
cross-machine service-level objective.

Syntax highlighting, language configuration, and navigation for Intel 8080 assembly.

## Syntax Highlighting

Declared in `package.json` via `contributes.languages` and `contributes.grammars`. Language ID `asm`, file extensions `.asm`, `.s`, and `.inc`, grammar `source.v6vscode_8080` from `res/syntaxes/v6vscode_8080.tmLanguage.json`. The extension enables source breakpoints for this language.

## Language Configuration

`language-configuration.json` provides line comments (`;`), block comments (`/* */`), bracket pairs, auto-closing pairs, and surrounding pairs.

## Source Links

Ctrl/Cmd-click navigation is available for `.include "..."` paths and for constants and labels present in the active project's debug artifact. Constant links open the DWARF declaration location; label links open the exact `label:` definition when it is available in the artifact source-file table. Rebuild the project when links are missing or stale.
