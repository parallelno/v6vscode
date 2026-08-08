# Shared Language Presentation Refactoring Plan

**Status:** Proposed
**Date:** 2026-08-07
**Owner:** v6vscode maintainers
**Scope:** independently implementable language-domain refactoring

## 1. Goal

Create a complete, reusable assembly-language presentation API under `src/language`. The work must be implementable, testable, and releasable without adding or modifying a panel.

The refactoring will provide shared services for:

1. Loading an exact source line from a debug source location.
2. Tokenizing source documents and standalone assembly lines from the existing TextMate grammar.
3. Finding source symbol tokens and resolving their definitions.
4. Returning presentation data without HTML or consumer-specific view models.
5. Adapting the existing source editor providers to the extracted services.

Existing source-editor highlighting, hovers, definitions, and breakpoint behavior must remain unchanged.

The deliverable is complete when the shared APIs, editor-provider adoption, packaging, tests, and documentation pass independently. No Trace Log types, commands, assets, or tests are part of this plan.

## 2. Ownership

Follow `design/design.md`:

- `src/language` owns lexical rules, tokenization, and symbol-link resolution.
- `src/debug/metadata` owns address-to-source and symbol data.
- `src/platform/files` owns reusable file reading and cache primitives where appropriate.
- VS Code providers adapt shared language operations to editor APIs.
- Consumers depend only on exported language-domain interfaces.

No language module may import a panel, webview asset, or consumer feature module.

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

Token classes are stable presentation categories, not CSS or TextMate scope names. The highlighter maps TextMate scopes to these classes so consumers do not depend on grammar internals.

`tokenizeDocument()` preserves TextMate rule state across lines for multiline strings/comments. `tokenizeLine()` handles an independent assembly line from an initial rule stack.

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

The extracted service validates token ranges and resolves targets from authoritative source text. Consumers pass text and ranges, not pre-resolved paths.

## 4. TextMate Integration

Use `vscode-textmate` with `vscode-oniguruma` exclusively in the extension host.

- Load `res/syntaxes/v6vscode_8080.tmLanguage.json` once.
- Load Oniguruma WASM once and share the initialized registry.
- Return spans and semantic token classes, not generated HTML.
- Cache tokenized source documents by URI and document version.
- Cache standalone-line tokenization by text with a bounded LRU cache.
- Export an initialized highlighter through the extension composition root.

The stable VS Code API does not expose the editor's active TextMate token stream. The shared highlighter therefore loads the same registered grammar and exposes stable token classes to consumers.

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
- Preserve rule stacks for source documents and use an initial stack for standalone lines.
- Add golden span tests and bounded-cache tests.

### Step 5 - Add a presentation facade

Create a language-owned facade that combines source text, highlight spans, and optional source symbol links:

```ts
interface PresentedLine {
  text: string;
  highlights: readonly HighlightSpan[];
  links: readonly SymbolLink[];
}
```

`presentSourceLine()` loads a source line, highlights it, and resolves its links. `presentStandaloneLine()` highlights supplied assembly text and returns an empty link list. Both operations are directly testable without a UI consumer.

### Step 6 - Adopt from existing language providers

- Keep source editor providers on the extracted symbol-link core.
- Register the shared services from `extension.ts` through a language-domain composition function.
- Preserve existing hover, definition, cancellation, and navigation behavior.
- Export the presentation facade for later consumers without adding a consumer in this change.

### Step 7 - Verify architecture and performance

- Confirm language modules have no imports from panel, webview, or consumer feature modules.
- Measure cold grammar/WASM initialization and warm tokenization of a fixed 512-line benchmark fixture.
- Verify dependency packaging and activation in an Extension Development Host.
- Run compile, focused language tests, full unit tests, and regression tests.

## 6. Tests

### Unit

- TextMate scope-to-class mapping.
- Multiline rule-stack preservation.
- Independent standalone assembly-line tokenization.
- Source document cache invalidation.
- Symbol missing, unique, and ambiguous resolution.
- Rejection of invalid or altered symbol ranges.

### Integration

- Existing source hover and definition behavior remains unchanged.
- Dirty source documents are returned immediately by `SourceLineService`.
- `presentSourceLine()` returns text, highlights, and links.
- `presentStandaloneLine()` returns highlights and no links.
- The extension activates with the packaged grammar and Oniguruma WASM.

### Performance

- Grammar and WASM initialize once per extension host.
- Warm presentation of the 512-line benchmark remains within the recorded performance budget.
- Document and standalone-line caches have explicit size bounds.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Oniguruma WASM complicates packaging | Resolve it from the installed dependency, test packaged-extension startup, and initialize once. |
| Full-document tokenization is expensive | Cache by document version and preserve rule stacks per cached document. |
| Extraction changes existing editor navigation | Add characterization tests first and keep providers as thin adapters over the same behavior. |
| A consumer supplies an invalid token range | Validate the range against authoritative text before resolving a target. |

## 8. Acceptance Criteria

- Language parsing and symbol resolution live under `src/language` and have no panel dependencies.
- The existing TextMate grammar is the only syntax grammar.
- Source editor navigation behavior remains covered and unchanged.
- `presentSourceLine()` and `presentStandaloneLine()` are exported and directly tested.
- Source lines support shared symbol hyperlinks; standalone lines return no links.
- No HTML or consumer-specific model is returned by the language API.
- Initialization, document cache, and standalone-line cache are bounded and tested.
- The refactoring compiles, packages, and passes tests without Trace Log implementation.

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
- [ ] Tokenize standalone assembly lines from an initial rule stack.
- [ ] Add bounded source-document and standalone-line caches.
- [ ] Add golden token-span, multiline-rule, cache-bound, and packaged-startup tests.

### Presentation API and editor adoption

- [ ] Implement `presentSourceLine()` and `presentStandaloneLine()`.
- [ ] Include symbol links only in source-line presentation.
- [ ] Return plain text, classified spans, and validated link ranges.
- [ ] Adopt the extracted symbol-link core from source editor providers.
- [ ] Register shared language services through the extension composition root.
- [ ] Export the presentation facade without adding a panel consumer.
- [ ] Verify hover, definition, cancellation, and source navigation remain unchanged.

### Architecture and verification

- [ ] Confirm language modules have no panel, webview, or consumer feature dependencies.
- [ ] Verify source-line presentation contains highlights and resolved links.
- [ ] Verify standalone-line presentation contains highlights and no links.
- [ ] Measure cold initialization and warm 512-line fixture tokenization.
- [ ] Run compile, focused unit tests, full unit tests, and regression tests.
- [ ] Verify dependency packaging and activation in an Extension Development Host.
- [ ] Complete the plan without creating or modifying Trace Log implementation files.
