# Shared Language Presentation Refactoring Plan

**Status:** Proposed
**Date:** 2026-08-07
**Owner:** v6vscode maintainers
**Consumers:** source editor providers, Trace Log panel, future disassembly views

## 1. Goal

Make assembly language behavior reusable without moving language rules into a panel.

The refactoring will provide shared services for:

1. Loading an exact source line from a debug source location.
2. Tokenizing source and disassembly text from the existing TextMate grammar.
3. Finding source symbol tokens and resolving their definitions.
4. Returning presentation data without HTML or VS Code editor objects.
5. Keeping navigation and breakpoint execution in the extension host.

Existing source-editor highlighting, hovers, definitions, and breakpoint behavior must remain unchanged.

## 2. Ownership

Follow `design/design.md`:

- `src/language` owns lexical rules, tokenization, and symbol-link resolution.
- `src/debug/metadata` owns address-to-source and symbol data.
- `src/platform/files` owns reusable file reading and cache primitives where appropriate.
- VS Code providers adapt shared language operations to editor APIs.
- Panels consume shared operations through host-side controllers.
- Webviews render trusted view models and send opaque interaction targets.

No language module may import a Trace Log panel or webview asset.

## 3. Target Interfaces

### 3.1 Source lines

```ts
interface SourceLine {
  sourceId: string;
  line: number;
  text: string;
  version: string;
}

interface SourceLineService {
  read(location: SourceLocation, projectRoot: string): Promise<SourceLine | undefined>;
  clear(): void;
}
```

The implementation resolves paths with the existing debug-source utility and uses `vscode.workspace.openTextDocument()` so open, dirty documents are represented correctly. Cache by URI plus document version; invalidate file-backed entries when the document or project changes.

### 3.2 Highlight spans

```ts
type AssemblyTokenClass =
  | 'plain'
  | 'comment'
  | 'string'
  | 'label'
  | 'directive'
  | 'keyword'
  | 'control'
  | 'instruction'
  | 'register'
  | 'number'
  | 'operator';

interface HighlightSpan {
  start: number;
  length: number;
  tokenClass: AssemblyTokenClass;
}

interface AssemblyHighlighter {
  tokenizeLine(text: string): readonly HighlightSpan[];
  tokenizeDocument(text: string): readonly (readonly HighlightSpan[])[];
}
```

Token classes are stable presentation categories, not CSS or TextMate scope names. Adapters map TextMate scopes to these classes. Webviews map classes to VS Code theme variables.

`tokenizeDocument()` preserves TextMate rule state across lines for multiline strings/comments. Server disassembly uses `tokenizeLine()` with an initial rule stack.

### 3.3 Symbol links

```ts
interface SymbolLink {
  start: number;
  length: number;
  name: string;
  target: SourceLocation;
}

interface SourceSymbolLinkService {
  links(text: string, context: SourceDocumentContext): Promise<readonly SymbolLink[]>;
  resolve(text: string, range: TextRange, context: SourceDocumentContext): Promise<SourceLocation | undefined>;
}
```

Move symbol token discovery and source-target resolution out of `SymbolLinkProvider`. The provider remains responsible for VS Code `Hover`, `Location`, cancellation, and command-link adaptation.

The Trace Log controller sends links only for source-backed rows. It re-runs `resolve()` before navigation rather than trusting a webview-provided target.

## 4. TextMate Integration

Use `vscode-textmate` with `vscode-oniguruma` exclusively in the extension host.

- Load `res/syntaxes/v6vscode_8080.tmLanguage.json` once.
- Load Oniguruma WASM once and share the initialized registry.
- Return spans and semantic token classes, not generated HTML.
- Cache tokenized source documents by URI and document version.
- Cache server disassembly tokenization by instruction string with a bounded LRU cache.
- Keep WASM and grammar loading out of the webview CSP and message bridge.
- Send plain text and classified spans to rendering-only webview consumers.

The stable VS Code API does not expose the editor's active TextMate token stream or raw active theme. The shared highlighter therefore reuses the registered grammar's scopes, and webviews map the resulting semantic classes to VS Code theme variables. The result must remain readable in light, dark, and high-contrast themes.

## 5. Refactoring Steps

### Step 1 - Characterize current behavior

- Add golden tests for `findSymbolTokens()`, register hover classification, exact label definitions, and symbol target resolution.
- Add representative grammar fixtures for instructions, control flow, registers, numbers, labels, directives, strings, comments, and operators.
- Record provider cancellation and missing/ambiguous-symbol behavior.

### Step 2 - Extract symbol-link core

- Move pure token scanning and target-resolution policy into `src/language/symbols` modules with no panel dependency.
- Inject source-file reading instead of calling `fs.readFileSync()` inside resolution logic.
- Keep `SymbolLinkProvider` as a thin VS Code adapter.
- Run existing and new symbol-provider tests before proceeding.

### Step 3 - Add SourceLineService

- Resolve debug paths through `resolveDebugSourcePath()`.
- Read source through VS Code documents to include unsaved editor changes.
- Validate one-based DWARF line numbers and return `undefined` for missing or out-of-range locations.
- Add cache invalidation and path/case tests for Windows.

### Step 4 - Add TextMate highlighter

- Add runtime dependencies `vscode-textmate` and `vscode-oniguruma`.
- Initialize the existing grammar from the extension installation URI.
- Map known grammar scopes to stable `AssemblyTokenClass` values.
- Preserve rule stacks for source documents and use an initial stack for disassembly lines.
- Add golden span tests and bounded-cache tests.

### Step 5 - Add a presentation facade

Create a language-owned facade that combines source text, highlight spans, and source symbol links:

```ts
interface PresentedLine {
  text: string;
  highlights: readonly HighlightSpan[];
  links: readonly SymbolLink[];
}
```

Source-backed lines contain valid links. Disassembly lines contain highlights and an empty link list.

### Step 6 - Adopt from consumers

- Keep source editor providers on the extracted symbol-link core.
- Use the facade from Trace Log host code only for retained visible windows.
- Send plain text, spans, and opaque link ranges to the webview.
- Re-resolve every clicked range in the host before navigation.

### Step 7 - Verify architecture and performance

- Confirm language modules have no imports from `src/debug/views` panel implementations.
- Confirm the Trace Log panel contains no assembly regexes or symbol lookup policy.
- Measure cold grammar/WASM initialization and warm tokenization of one maximum-sized trace window.
- Run compile, unit, regression, Extension Development Host, and high-contrast checks.

## 6. Tests

### Unit

- TextMate scope-to-class mapping.
- Multiline rule-stack preservation.
- Independent server instruction tokenization.
- Source document cache invalidation.
- Symbol missing, unique, and ambiguous resolution.
- Host-side rejection of stale or altered link ranges.

### Integration

- Existing source hover and definition behavior remains unchanged.
- Dirty source documents appear immediately in Trace Log source-backed rows.
- Source rows and editor lines produce equivalent token classes for the same text.
- Disassembly rows have syntax colors but no links.
- Theme changes update CSS-variable-based colors without retokenizing rows.

### Performance

- Grammar and WASM initialize once per extension host.
- Warm presentation of a `maxLines` window does not block scrolling noticeably.
- Document and disassembly caches have explicit size bounds.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Oniguruma WASM complicates packaging | Resolve it from the installed dependency, test packaged-extension startup, and initialize once. |
| Webview colors do not exactly match a custom editor theme | Reuse grammar scopes and map semantic classes to documented VS Code theme variables. |
| Full-document tokenization is expensive | Cache by document version and tokenize only source files referenced by retained windows. |
| Extraction changes existing editor navigation | Add characterization tests first and keep providers as thin adapters over the same behavior. |
| Webview forges a symbol target | Send ranges only and resolve again in the extension host. |

## 8. Acceptance Criteria

- Language parsing and symbol resolution live under `src/language` and have no panel dependencies.
- The existing TextMate grammar is the only syntax grammar.
- Source editor navigation behavior remains covered and unchanged.
- Trace Log receives source/disassembly presentation without implementing language rules.
- Source lines support shared symbol hyperlinks; disassembly lines do not.
- No untrusted HTML or navigation target crosses the webview boundary.
- Initialization, document cache, and disassembly cache are bounded and tested.

## 9. Implementation Checklist

### Characterization and extraction

- [ ] Add golden tests for current symbol token discovery, hovers, definitions, and target resolution.
- [ ] Extract symbol scanning and resolution policy into panel-independent `src/language` modules.
- [ ] Inject source-file access into symbol resolution.
- [ ] Keep `SymbolLinkProvider` as a thin VS Code adapter.
- [ ] Verify existing source-editor language tests remain unchanged and pass.

### Source-line service

- [ ] Implement `SourceLineService` using existing debug-source path resolution.
- [ ] Read source through VS Code documents so unsaved changes are visible.
- [ ] Validate DWARF line bounds and missing-file behavior.
- [ ] Cache by source identity and document version.
- [ ] Add invalidation, Windows path-case, dirty-document, and missing-source tests.

### Host-side TextMate highlighting

- [ ] Add `vscode-textmate` and `vscode-oniguruma` runtime dependencies.
- [ ] Package and initialize Oniguruma WASM once per extension host.
- [ ] Load `res/syntaxes/v6vscode_8080.tmLanguage.json` once.
- [ ] Implement TextMate scope-to-`AssemblyTokenClass` mapping.
- [ ] Preserve rule stacks while tokenizing source documents.
- [ ] Tokenize standalone server instructions from an initial rule stack.
- [ ] Add bounded source-document and instruction-string caches.
- [ ] Add golden token-span, multiline-rule, cache-bound, and packaged-startup tests.

### Presentation and consumers

- [ ] Implement the `PresentedLine` facade for source and disassembly text.
- [ ] Include symbol links only for source-backed lines.
- [ ] Return plain text, classified spans, and opaque link ranges to panel consumers.
- [ ] Adopt the extracted symbol-link core from source editor providers.
- [ ] Adopt the presentation facade from Trace Log host code for retained visible windows.
- [ ] Re-resolve clicked symbol ranges in the extension host before navigation.
- [ ] Render spans with VS Code theme variables in the Trace Log webview.

### Architecture and verification

- [ ] Confirm language modules have no panel or webview dependencies.
- [ ] Confirm Trace Log contains no assembly regexes or symbol-resolution policy.
- [ ] Verify equivalent token classes for the same source text in editor and Trace Log paths.
- [ ] Verify disassembly rows are highlighted and contain no symbol links.
- [ ] Verify light, dark, and high-contrast presentation.
- [ ] Measure cold initialization and warm maximum-window tokenization.
- [ ] Run compile, focused unit tests, full unit tests, and regression tests.
- [ ] Verify the packaged extension in an Extension Development Host.
