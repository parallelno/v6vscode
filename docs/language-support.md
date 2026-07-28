# Language Support

Syntax highlighting, language configuration, and navigation for Intel 8080 assembly.

## Syntax Highlighting

Declared in `package.json` via `contributes.languages` and `contributes.grammars`. Language ID `asm`, file extensions `.asm`, `.s`, and `.inc`, grammar `source.v6vscode_8080` from `res/syntaxes/v6vscode_8080.tmLanguage.json`. The extension enables source breakpoints for this language.

## Language Configuration

`language-configuration.json` provides line comments (`;`), block comments (`/* */`), bracket pairs, auto-closing pairs, and surrounding pairs.

## Include Link Provider (`src/language/includes/include-link-provider.ts`)

`DocumentLinkProvider` for Ctrl+click navigation on `.include "..."` directives. Regex: `.include\s+"([^"]+)"`. Resolves paths relative to the source file's directory.
