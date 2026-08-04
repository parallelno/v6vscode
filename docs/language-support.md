# Language Support

Syntax highlighting, language configuration, and navigation for Intel 8080 assembly.

## Syntax Highlighting

Declared in `package.json` via `contributes.languages` and `contributes.grammars`. Language ID `asm`, file extensions `.asm`, `.s`, and `.inc`, grammar `source.v6vscode_8080` from `res/syntaxes/v6vscode_8080.tmLanguage.json`. The extension enables source breakpoints for this language.

## Language Configuration

`language-configuration.json` provides line comments (`;`), block comments (`/* */`), bracket pairs, auto-closing pairs, and surrounding pairs.

## Source Links

Ctrl/Cmd-click navigation is available for `.include "..."` paths and for constants and labels present in the active project's debug artifact. Constant links open the DWARF declaration location; label links open the exact `label:` definition when it is available in the artifact source-file table. Rebuild the project when links are missing or stale.
