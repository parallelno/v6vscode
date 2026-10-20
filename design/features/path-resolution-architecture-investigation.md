# Path-resolution architecture investigation

**Status:** Investigation completed; incremental implementation requested and delivered below. Original findings/references describe baseline `88b24bb`; see §10 for implementation decisions, intentional behavior change and verification.  
**Baseline:** `88b24bb` (`main`), initially clean working tree.  
**Repository:** `C:\Work\Programming\v6vscode`. References below are absolute paths and baseline line numbers.  
**Objective:** Separate feature-specific path interpretation from reusable local-filesystem mechanisms without changing navigation, anchoring or fallback behavior.

## 1. Executive findings

1. **The include-link premise is not accurate for this checkout.** `resolveIncludePath` only returns a host-absolute input unchanged or calls `path.resolve(sourceDir, includePath)`. Neither it nor its provider checks existence, obtains a workspace root, or tries fallback candidates. See `C:\Work\Programming\v6vscode\src\language\includes\include-link-provider.ts:38–60`. Do not design cleanup around a filesystem-aware include fallback that is absent here.
2. **Confirmed duplicate mechanism:** that function and `PathService.resolveRelative` have identical bodies after parameter renaming (`C:\Work\Programming\v6vscode\src\platform\files\path-service.ts:19–24`). However, `resolveRelative` and `expandTokens` currently have **test-only callers**; production uses `resolveExtensionPath`. The duplicated mechanism is real, but not two independently exercised production resolution services.
3. **Confirmed avoidable provider coupling:** include parsing and lexical resolution are exported from a module with a runtime `vscode` import; both unit and regression tests import through that provider. Their functionality needs only strings/Node `path`. The symbol provider similarly re-exports helpers/types from its service, and its helper tests consume those re-exports. Long relative imports are not themselves the defect; the unnecessary runtime/provider boundary is.
4. **Existing DWARF reuse should be preserved:** six production modules import one `resolveDebugSourcePath`; they do not each implement its relocation algorithm. Its current owner is not a VS Code provider and imports only `fs`/`path`. A language-to-debug-metadata dependency is not automatically inverted: language navigation genuinely consumes debug metadata here.
5. **Confirmed anchor inconsistency, conditional correctness impact:** DAP uses the first workspace folder; symbol definitions/hover actions and source-navigation tools generally use the active project-file directory. Nested projects or a project in another workspace folder can therefore resolve the same metadata path differently. This is a caller-context problem, not evidence that a universal path resolver would fix it.
6. **Confirmed repeated identity mechanics, non-equivalent policies:** navigation, Trace Log, breakpoint ownership, decorations and artifact identity repeat normalize/case-fold operations. Separately, metadata breakpoint matching and source relocation repeat trailing-segment splitting but select candidates differently. Filesystem paths, URI/source IDs and metadata identities must not be collapsed into one generic “normalize” operation.
7. **No path-related circular imports found.** A literal import/export scan of 154 production TypeScript modules found no emitted runtime cycles. One unrelated source-level cycle is erased through type use (display viewmodel/overlay renderer). No low-level path module imports an include or symbol provider.

**Recommendation:** extract an include-domain functional boundary first; use `C:\Work\Programming\v6vscode\src\platform\files` only for demonstrated local-path mechanisms. Keep DWARF reconstruction/relocation, symbol-definition lookup, project selection and VS Code navigation as distinct owners. Treat anchor alignment and cross-platform corrections as separately reviewed behavior changes.

## 2. Scope and validation method

- Searched production TypeScript and asset JavaScript, scripts, tests and documentation for `path` operations, `existsSync`/stat/access/realpath, workspace discovery, URI/location conversion, source IDs, definition scans and import/export references. Followed implementations and callers rather than grouping by function name.
- Inspected include/symbol providers and services; metadata loader/line reader/index/repository; project discovery/repository/active selection; DAP/configuration/factory; navigation/Trace Log/Hex Viewer/Symbols/Performance; platform/workspace/resource helpers; script wire paths and program/FDD I/O.
- Compared the include and `PathService` resolver bodies structurally after parameter renaming; they match. Evaluated unchanged resolver code in memory with injected `path.win32`/`path.posix` and a recorded existence predicate to check branches/order. No source or test code was edited or generated for those probes.
- Built a TypeScript-AST graph of relative literal imports/exports/requires/dynamic imports, including a second scan of transpiled CommonJS for runtime edges. Excluded declarations, browser assets and `C:\Work\Programming\v6vscode\src\test` from the 154-module graph. This is not a proof about computed imports, third-party internals or all possible bundler configurations.
- Ran **102 focused existing tests**, then the complete **764 unit tests and 62 regressions**, all passing with no skips reported on Windows. Ran full test typecheck with `--noEmit`, successfully. Focused coverage included include unit/regression tests, PathService, source-path/index/navigation, symbol provider/service, source lines, per-CU directories, active-project and architecture contracts.
- No packaged Extension Host/live emulator lane was rerun for this documentation-only investigation. Existing integration sources were inspected; their prior results are not counted as new validation. POSIX observations below are **path-module emulations on Windows**, not Linux filesystem/VS Code integration results.

## 3. Implementation inventory and callers

### 3.1 Source interpretation, resolution and lookup

| Implementation / baseline reference | Actual responsibility | Actual callers / downstream use |
|---|---|---|
| `C:\Work\Programming\v6vscode\src\language\includes\include-link-provider.ts:14–43`, `findIncludes`, `resolveIncludePath` | Case-sensitive regex extraction of double-quoted `.include`; host-native lexical path resolution against an explicit source directory; no filesystem I/O | `IncludeLinkProvider.provideDocumentLinks` in the same file. External helper consumers are `C:\Work\Programming\v6vscode\test\unit\language\include-link-provider.test.ts:3` and `C:\Work\Programming\v6vscode\test\regression\include-links.test.ts:3` |
| Same file, `:45–62`, `provideDocumentLinks` | Derives `dirname(document.uri.fsPath)`; converts match offsets into `Position`/`Range`, resolved string into `Uri.file`/`DocumentLink` | Registered by `C:\Work\Programming\v6vscode\src\extension.ts:326–330`; no production helper imports from another feature |
| `C:\Work\Programming\v6vscode\src\debug\metadata\debug-source-path.ts:20–72`, `resolveDebugSourcePath`, private `withinProject`/`findWorkspaceMatch` | DWARF-to-local-source relocation, host normalization, root interpretation and ordered synchronous existence probing; fallback may be nonexistent | DAP, navigation adapter, Trace Log, source-line service, symbol provider and symbol service; exact map in §4 |
| `C:\Work\Programming\v6vscode\src\debug\metadata\debug-artifact-loader.ts:27–71,138–176`, `parseCompilationUnits`, `buildLineCompDirs`, `filesForUnit`, `decodeDebugArtifact` | Extracts CU anchors; maps line programs by `stmt_list` or declaration order; selects declaration file tables; builds baseline index | `loadDebugArtifact` and `ArtifactRepository` feed debugger/symbol selections. Baseline CU projection here is v4-only; v5 line decoding obtains its own directory context |
| `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf4-line-reader.ts:88–101,144–203,241–269,483–512`, `programCompDir`, file-table readers, private `resolveFilePath`/`resolveV5FilePath` | Reconstructs v4/v5 file-table paths from file/directory indexes and per-program compilation directories; lexical only, no existence checks | Line rows and file tables consumed by artifact loader; v4 constant declarations use their owning file table. Version/index rules are metadata policy |
| `C:\Work\Programming\v6vscode\src\debug\metadata\debug-index.ts:101–184,239–260,325–388`, `buildDebugIndex`, `normalizePath`, `resolveIndexedFile`, `splitPathSegments`, `matchByTrailingSegments` | Normalizes metadata relative to `compDir`; maps a requested breakpoint filename into known metadata filenames using exact/suffix/unique-best trailing matches; no filesystem probing | `DebugIndex.resolveBreakpoint`/`resolveBreakpointAll`, primarily `BreakpointCoordinator`; source rows/symbol tables feed stack/source-step/symbol services |
| `C:\Work\Programming\v6vscode\src\debug\metadata\debug-symbol-service.ts:22–59,80–113`, `fork`, `load`, `resolveSymbol`, `sourceFiles`, `sourceAtExactAddress`, `sourceForSymbol` | Artifact-backed name/address/declaration queries; independent selection over shared repository; **not** a source-text scanner or disk-path relocator | Symbol-link service/provider, Symbols/Hex/Performance/Trace Log and value/expression consumers |
| `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-service.ts:44–127,130–259`, token/definition helpers and `DebugSourceSymbolLinkService` | Scans only metadata-listed files; label/macro/constant/struct/field lookup, declaration preference, exact-address fallback and bounded revision/artifact/root/name cache | `SymbolLinkProvider`; `DefaultLanguagePresentationService`/Trace Log; constructed by `createLanguageServices` with an injected source-text reader |
| `C:\Work\Programming\v6vscode\src\language\asm-lexical.ts:6–16`, `codeBeforeComment` | Masks quoted text and comments while preserving UTF-16 offsets for symbol scanning | Symbol provider/service; includes do **not** currently use it. Reusing this masking function directly would erase include operands |

### 3.2 Navigation, local identity and resolution anchors

| Implementation / reference | Responsibility / callers |
|---|---|
| `C:\Work\Programming\v6vscode\src\debug\views\debug-source-navigation.ts:7–44`, `sourceNavigation`, `revealDebugSource`, `sameFile` | Relocates metadata path, creates file URI, reuses visible/inactive tabs or opens preview, clamps coordinates and focuses/reveals. Used by Hex Viewer, Symbols, Performance, Trace Log and extension hover-link command via `SourceNavigation` port |
| `C:\Work\Programming\v6vscode\src\debug\views\navigation-ports.ts:9`, `SourceNavigation` | Explicit source location plus root input; narrow UI port, not a filesystem abstraction |
| `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-provider.ts:27–29,133–177` | Hover command URI encodes `SourceLocation`; DefinitionProvider resolves against project-file directory and returns `Uri.file`/`Location`. Re-exports service helpers/types at `:11–19` |
| `C:\Work\Programming\v6vscode\src\language\source-line-service.ts:31–75,88–104`, `VsCodeSourceLineService.read`, `normalizeSourceId` | Relocates path, opens VS Code document (including dirty contents), caches line by document URI/version/line, invalidates on edits/close/workspace changes. Used by language presentation/Trace Log |
| `C:\Work\Programming\v6vscode\src\language\language-services.ts:21–39` | Composes source lines and symbol service; injected reader converts local string to `Uri.file` and `openTextDocument`, catches failures; invalidates definition scans on document edits/close |
| `C:\Work\Programming\v6vscode\src\language\assembly-highlighter.ts:82–98,203–205` | Document-token cache identity lowercases source IDs on Windows, otherwise leaves them unchanged. Unlike source-line cache it does not apply `path.normalize` to IDs on POSIX |
| `C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts:323–332,525–546,1298–1318,1364–1370,1525–1535` | First-workspace-root source anchor/artifact-relative fallback; DAP path strings for frames and breakpoint events; local path equality for decorations; source-filter glob normalization, not relocation |
| `C:\Work\Programming\v6vscode\src\debug\session\breakpoint-coordinator.ts:311–318` | Host-normalized/case-folded local filename key for user breakpoint ownership; delegates metadata matching to index |
| `C:\Work\Programming\v6vscode\src\debug\views\trace-log-panel.ts:233–248,275–315,336–352,442–445` | Reads/presents source through shared language services; navigates through port; resolves local source breakpoint locations and compares normalized local names; caches project-root/source context |
| `C:\Work\Programming\v6vscode\src\debug\views\hex-viewer-provider.ts:441–462`; `C:\Work\Programming\v6vscode\src\debug\views\symbols-panel.ts:201–211`; `C:\Work\Programming\v6vscode\src\debug\views\performance-panel.ts:207–222` | Source intent comes from symbol queries; choose active project-file directory, else first workspace root, then delegate navigation. Symbol availability/loading remains feature-owned |
| `C:\Work\Programming\v6vscode\src\extension.ts:348–354` | Hover command validates a `SourceLocation`, obtains active/resolved project and navigates using project-file directory; no project means no navigation |
| `C:\Work\Programming\v6vscode\src\debug\adapter\logical-location-index.ts:83–95`; `C:\Work\Programming\v6vscode\src\debug\adapter\source-step-service.ts:89–95` | Exact metadata filename equality within logical source-location comparisons. These are not local-file canonicalizers; the full comparisons also intentionally differ in discriminator/isStmt handling |
| `C:\Work\Programming\v6vscode\src\debug\metadata\artifact-repository.ts:18–34,49–52,130–132` | Bounded async disk reads and lexical absolute/case-folded artifact identities; no realpath/symlink canonicalization. Used by `DebugSymbolService` and DAP, not source relocation |

### 3.3 Project/platform and adjacent path domains

| Implementation / reference | Responsibility / callers; why not automatically a source resolver |
|---|---|
| `C:\Work\Programming\v6vscode\src\platform\files\path-service.ts:4–24`, `PathService` | Extension-resource URI joining and `${extension}` substitution; source-independent `resolveRelative` duplicate. Created by extension and injected into coordinator/adapter/factory. Only `resolveExtensionPath` has production invocations (default boot ROM) |
| `C:\Work\Programming\v6vscode\src\platform\files\workspace-service.ts:3–6`, `getRootUris` | Enumerates all workspace folders as URIs; used by `ActiveProjectService`; no project-root guessing |
| `C:\Work\Programming\v6vscode\src\project\discovery\project-discovery.ts:3–12`, `findProjects` | For each supplied root, calls `findFiles(RelativePattern(root, '*.project.json'))`; not recursive `**/*.project.json`, not source-document ancestor search. Caller: active-project service |
| `C:\Work\Programming\v6vscode\src\project\active\active-project-service.ts:22–24,31–82`, `resolve`, `publish` | Uses discovery/WorkspaceService, auto-selects one project or prompts for many; saves/stale resolves guarded. Does not select a project by source-document ownership. Save matching uses exact `uri.fsPath` strings |
| `C:\Work\Programming\v6vscode\src\project\persistence\project-repository.ts:16–65`, `load`/`save` | Reads/writes project URI through `workspace.fs`; resolves executable/debugArtifact/bootRom relative to project JSON directory and serializes them back using `path.relative`. No source fallback or existence policy |
| `C:\Work\Programming\v6vscode\src\debug\configuration\debug-configuration-provider.ts:23–26,43–98` | Launch inputs exclusively from active project; checks executable existence. Folder parameter does not choose project or DAP source anchor. Calls active-project resolution |
| `C:\Work\Programming\v6vscode\src\commands\create-project-command.ts:22–24,60–83,99–124` | First-workspace-root destination for generated projects; joins output filenames and builds VS Code URIs. Creation policy, not source discovery |
| `C:\Work\Programming\v6vscode\src\commands\run-project-command.ts:22–39,53–59`; `C:\Work\Programming\v6vscode\src\emulator\launcher\v6emul-locator.ts:20–37` | Explicit executable existence/error policy, respectively project program and `V6EMUL`; no candidate fallback or PATH search |
| `C:\Work\Programming\v6vscode\src\emulator\session\program-loader.ts:13–24`; `C:\Work\Programming\v6vscode\src\emulator\persistence\fdd-persistence.ts:23–27,62–105`; `C:\Work\Programming\v6vscode\src\debug\views\hardware-statistics-provider.ts:112–145` | Program bytes from supplied path; FDD write to supplied path; dialog-selected URI read then fsPath sent to emulator. Preserve ownership/read-only/write acknowledgement policies; these do not discover source paths |
| `C:\Work\Programming\v6vscode\src\debug\scripts\script-codec.ts:12–19,114–119`; `C:\Work\Programming\v6vscode\src\debug\views\scripts-panel.ts:201–207`; `C:\Work\Programming\v6vscode\src\debug\views\assets\scripts.js:35–48` | Server-local **generic wire path** validation; host/browser normalize backslashes to `/`, validate absolute syntax/UTF-8. No extension-host existence probe should be added: server filesystem is authoritative. Related host/browser validation duplication is real but belongs to script wire-contract work, not local-source relocation |
| `C:\Work\Programming\v6vscode\src\templates\template-utils.ts:16–49`; `C:\Work\Programming\v6vscode\src\language\assembly-highlighter.ts:147–165` | Template-relative resource reads and grammar/Oniguruma resource lookup. Explicit extension/package anchors; no source fallback |
| `C:\Work\Programming\v6vscode\src\platform\webview\panel-host.ts:33–36`; `C:\Work\Programming\v6vscode\src\platform\webview\webview-document.ts:12`; `C:\Work\Programming\v6vscode\src\emulator\panel\emulator-panel.ts:101–102,379–380` | URI joining, resource allowlists and `asWebviewUri`; other feature-panel HTML builders follow the same resource-conversion category. CSP/resource URLs must not use local source-resolution fallback |
| `C:\Work\Programming\v6vscode\src\test\fixture-paths.ts:6–34` and `C:\Work\Programming\v6vscode\test\helpers\fixture-paths.ts` | Test-only ancestor root discovery using repository markers, mandatory fixture checks and derived ROM creation; shared re-export intentionally supports source/compiled tests |
| `C:\Work\Programming\v6vscode\src\test\run-integration.ts:89–100`; `C:\Work\Programming\v6vscode\scripts\verify-release.cjs:14–25` | VSIX extraction containment check and release prerequisite/root validation. Separate safety/test policies, not candidates for source-path fallback reuse |

No general filesystem abstraction exists behind all of these modules. Node `fs`, an injected artifact source/program reader, VS Code `workspace.fs`, and VS Code text documents serve different contracts. Replacing them all with one filesystem service is not justified by this inventory.

## 4. Dependency analysis

```text
extension composition
  ├─ IncludeLinkProvider ── findIncludes + resolveIncludePath [same provider module]
  │                         └─ Node path; provider module also loads vscode
  ├─ ActiveProjectService ── WorkspaceService + ProjectDiscovery + ProjectRepository
  │                            └─ VS Code workspace/URI APIs
  ├─ SymbolLinkProvider ── SourceSymbolLinkService interface
  │   └─ definition URI / hover command (VS Code boundary)
  └─ createLanguageServices
      ├─ DebugSourceSymbolLinkService ── forked DebugSymbolService
      │   ├─ asm lexical/definition rules
      │   ├─ resolveDebugSourcePath ── fs + path
      │   └─ injected source-text reader ── openTextDocument(Uri.file(...))
      └─ VsCodeSourceLineService ── resolveDebugSourcePath + document cache

DebugSymbolService / DAP ── ArtifactRepository ── loader ── DWARF line tables + DebugIndex
                                                          [no VS Code runtime]
Hex / Symbols / Performance / Trace ── SourceNavigation port
                                      └─ revealDebugSource ── resolveDebugSourcePath + VS Code
```

**Complete production import fan-in for the DWARF resolver:**

- `C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts:24,525,538,1365`: frame, unavailable-source fallback and breakpoint-event paths, using `workspaceRoot`.
- `C:\Work\Programming\v6vscode\src\debug\views\debug-source-navigation.ts:4,10`: visible/inactive/new editor navigation.
- `C:\Work\Programming\v6vscode\src\debug\views\trace-log-panel.ts:14,301,311`: source breakpoint creation/equality.
- `C:\Work\Programming\v6vscode\src\language\source-line-service.ts:4,46`: source-document reading.
- `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-provider.ts:7,164`: returned definition location.
- `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-service.ts:4,207,236`: source scan inputs.

### Problematic or potentially misleading edges

- **Confirmed:** pure include helper tests → VS Code provider module. Loading the unchanged module in memory records runtime imports `vscode` and `path`, even when only helpers are needed. Extract the helpers; do not make them import the existing VS Code `PathService` class.
- **Confirmed:** `C:\Work\Programming\v6vscode\test\unit\language\symbol-link-provider.test.ts:4–9,69–93` tests service helpers through provider re-exports (`C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-provider.ts:11–19`). Other service tests already import the correct owner. Change tests to the service boundary; remove unnecessary re-exports only after a consumer check.
- **Confirmed testability limitation, not an inversion:** symbol service injects source-text reading but directly invokes disk-aware source relocation. Injecting a source reader alone cannot simulate all candidate/existence choices. A small source-path function or existence predicate would make those choices deterministic without mocking a provider.
- **Reasonable:** UI/provider → metadata resolver; language service → pure metadata models and symbol queries; project discovery/repository → VS Code at an explicit host boundary. Type-only `SourceLocation` relationships are not runtime dependencies after emit. Do not move models just because their import path is long.
- **Not found:** core path utility → language provider, metadata → navigation UI, or a path-related runtime cycle. Existing import gates pass, although they do not currently require include parsing to be host-free. The platform resource facade is VS Code-coupled by design; its unused lexical method is the misplaced part.

## 5. Semantic comparison: mechanisms versus policy

| Aspect | Include links | DWARF → local source | Breakpoint → metadata index |
|---|---|---|---|
| Input meaning | Operand extracted from source text | Recorded source filename, possibly from another build machine | User/editor file matched to a finite metadata file set |
| Anchor | Containing source document directory | Explicit caller-supplied root; sometimes first workspace, sometimes project directory | `compDir` normalization plus indexed file set |
| Absolute input | Host `path.isAbsolute`; return original spelling | Drive/UNC special branch; single separator is metadata-rooted; normalize output | Normalize, then exact/suffix/unique-best match |
| Relative input | `path.resolve(sourceDir, operand)` unconditionally | Existing project candidate first; then existing normalized relative path (CWD-sensitive); otherwise project-resolved path | Normalize with `compDir`; use metadata matches, not disk |
| Missing target | Still emits a link | Still returns a fallback string | Returns `undefined` / `[]` when no unambiguous metadata match |
| Existence | None | `fs.existsSync`; no regular-file/readability check, no recursive search | None |
| Suffix behavior | None | Reconstruct progressively shorter suffixes under one root; first existing candidate wins | Compare known filenames; unique longest common trailing segments; reject ties |
| Case/separators | Host-native Node rules | Explicit `/` and `\\` classification/splitting plus host-native normalization/joining | Host normalization; matching additionally becomes case-insensitive if any filename is Windows-absolute |
| Presentation | URI and link range | Path string only; callers own URI/DAP/navigation | Metadata identity/address, not an openable URI |

Important distinctions verified in the implementation:

- Drive/UNC names already considered inside the project are returned **without probing** (`debug-source-path.ts:27–29,52–55`). Foreign drive/UNC names try root/suffix candidates even when the recorded file exists. A single-rooted input instead checks the full path beneath the root, then the original absolute path; it does not run the same suffix search.
- “Workspace match” is a misleadingly broad name: `findWorkspaceMatch` knows only its supplied root; it neither enumerates workspace folders nor searches arbitrary descendants. “Longest” means ordered suffix reconstruction, not a search over every matching file.
- With no root, relative DWARF input remains relative. With a root but no project candidate, a normalized relative filename that exists against process CWD can still win. Therefore “always returns an openable absolute path” is not a valid contract today.
- `existsSync` can accept a directory and cannot guarantee a later successful open. Fallback existence is not validation of a readable source file; no realpath/symlink identity is established.
- v4/v5 file-table interpretation is deliberately version-specific. v4 can retain an unnormalized joined relative string when no compilation anchor exists; the later index normalizes it. Applying a generic absolute resolver during parsing would introduce process-CWD anchoring and change metadata identities.
- Source-definition scans are **not workspace searches**: they iterate `DebugSymbolService.sourceFiles()`, including metadata file-table entries without code rows. The injected reader uses VS Code documents, preserving unsaved contents. Moving scans into platform/files would invert ownership and lose ASM policy.

### Additional confirmed inconsistency and hypotheses

**Anchor mismatch (confirmed mechanism):** DAP sets `workspaceRoot` from `workspaceFolders[0]` only when loading a launch artifact (`C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts:323–329`); the factory does not pass `session.workspaceFolder` (`C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter-factory.ts:32–46`). Symbol provider derives `dirname(project.uri.fsPath)` (`:169–176`), as do navigation tools. In-memory Win32 probes with both files present returned `C:\workspace\src\main.asm` versus `C:\workspace\game\src\main.asm` for `src/main.asm`. This demonstrates divergent resolver results; an end-to-end nested-project launch regression remains to be added before deciding the correct replacement policy. Attach currently does not load artifact/source context in `onAttach` (`:376–389`); do not claim new attach-source support as cleanup.

**Path identity (confirmed duplication; bug impact not established):** `sameFile`, Trace Log `normalizePath`, breakpoint `sourceKey` and decoration matching repeat host normalization/case folding. Artifact cache additionally resolves absolute; index matching uses foreign-path case inference; active project save comparison is exact string equality. The two `normalizeSourceId` functions differ on POSIX: source lines normalize an actual URI string with `path.normalize`, while highlighter IDs remain opaque. A POSIX URI such as `file:///...` is not a filesystem path. These differences warrant tests, not blind substitution with a single key function. Case-only project-save notification loss and URI-key collisions remain hypotheses, not observed failures.

**Cross-host interpretation (confirmed algorithm, limited validation):** replacing Node `path` with `path.posix` in memory showed `/build/engine/main.asm` stays at the existing original even if `/project/engine/main.asm` exists; Win32 treats its drive-qualified equivalent through suffix relocation. A `\src\main.asm` operand on POSIX retains the interior backslash as a character. These follow host-path semantics; Windows-path tests passing on Windows do not establish portable behavior. Cross-platform policy changes need explicit approval and native POSIX tests.

**Performance and candidate safety (unmeasured risks):** repeated synchronous probes happen during scans/presentation. No latency regression was measured here. `withinProject` is lexical, not a sandbox; `..`, symlinks, drive-relative input, malformed UNC and basename-only suffix matches deserve characterization. Do not add a cache, recursive search, directory rejection or traversal restriction under the guise of behavior-neutral extraction.

## 6. Proposed boundaries and alternatives

### Recommended, minimal structure

1. **Include domain:** proposed `C:\Work\Programming\v6vscode\src\language\includes\include-resolution.ts` exports `IncludeMatch`, `findIncludes(text)` and `resolveIncludePath(sourceDirectory, operand)`. No VS Code import, registration, global workspace/project lookup or existence policy. The existing provider imports these and only creates ranges/URIs/links.
2. **Local filesystem mechanisms:** proposed `C:\Work\Programming\v6vscode\src\platform\files\local-path.ts`, if the duplicate API is retained, owns `resolveAgainstDirectory(baseDirectory, input)` with the exact current absolute-pass-through semantics. A narrowly named `localPathKey(file)` is justified only after identity vectors establish which callers share semantics. Use Node `path` directly for ordinary join/normalize; do not wrap every standard-library call.
3. **DWARF policy stays explicit:** retain `resolveDebugSourcePath` at `C:\Work\Programming\v6vscode\src\debug\metadata\debug-source-path.ts`. It remains a reusable domain API rather than a provider helper. Allow an explicit existence predicate or injected resolver at consuming service construction for deterministic tests; keep the present synchronous Node predicate as production default during behavior-neutral work.
4. **Metadata reconstruction/matching remain distinct:** keep CU/v4/v5 rules in metadata and index ambiguity handling in `DebugIndex`. Only their identical `splitPathSegments` operation is a possible `debug/metadata`-scoped helper after tests; neither matching algorithm should call the other.
5. **Project context remains project-owned:** document the project-file-directory anchor in the project context boundary. If repeated selection warrants extraction, use a project-specific function accepting an already selected project and explicit fallback, not a platform function that reads global active-project state. Keep active selection/prompt and document-to-project ownership outside low-level helpers.
6. **VS Code adapters stay adapters:** provider returns `Location`/`DocumentLink`; navigation owns editor reuse/focus; source-text adapter owns dirty-document reads. Do not add `Uri` or `Location` to the metadata resolver, and do not make language services import `debug/views` to reuse URI conversion.

**Candidate public contracts for review (signatures, not implementation):**

```typescript
// platform/files/local-path.ts: lexical local-filesystem operation only
resolveAgainstDirectory(baseDirectory: string, input: string): string;

// language/includes/include-resolution.ts: directive-specific interpretation
findIncludes(text: string): IncludeMatch[];
resolveIncludePath(sourceDirectory: string, operand: string): string;

// debug/metadata/debug-source-path.ts: existing policy with a test seam
type PathExists = (candidate: string) => boolean;
resolveDebugSourcePath(recordedPath: string, root: string, exists?: PathExists): string;
```

This does **not** imply extracting `PathExists` into a global interface library. An optional parameter is one possible seam; a constructor-injected `(recordedPath, root) => string` on the symbol service is another. Choose the smaller seam after tests, rather than introducing both by default.

**Candidate probing/fallback:** a generic `firstExistingPath(candidates, exists): string | undefined` could own ordered probing *if two real policies need it*. Today only DWARF source relocation has that candidate-selection contract; includes do not. Keep DWARF candidate generation/order/fallback local for now. Do not introduce a shared candidate framework based on the inaccurate include-fallback premise.

### Alternatives evaluated

| Alternative | Assessment |
|---|---|
| Keep everything in place, improve tests only | Lowest churn; reasonable for trivial joins, but leaves pure include tests loading VS Code and duplicated unused lexical API |
| Extract include helpers only; remove unused PathService methods separately | Strong smallest-first option. If removing `resolveRelative` is approved, retain the tiny include resolver locally rather than inventing a shared abstraction with one user |
| Add the narrow platform local-path module and delegate both lexical APIs | Reasonable if keeping the facade/API is valuable. Two owners share one implementation without importing a VS Code class; no claim of major runtime deduplication |
| Move all metadata relocation into platform/files | Not recommended: metadata-rooted interpretation and compiled-site preference are domain policy. Only filesystem mechanics belong below metadata |
| One universal resolver with “include/DWARF/project” mode flags | Reject: obscures anchors, ambiguity and fallback differences; encourages accidental behavior changes |
| Put filesystem utilities in `C:\Work\Programming\v6vscode\src\shared` | Reject for Node/VS Code-dependent code: existing shared boundary is browser-safe and enforced by architecture tests (`C:\Work\Programming\v6vscode\test\unit\platform\architecture-contracts.test.ts:78–96`) |

## 7. Incremental refactoring plan (not executed)

| Step | Affected boundary/files | Exit criterion / benefit |
|---|---|---|
| 1. Characterize semantics | Existing tests inventoried in §8, then new standalone local-path/include-domain tests | Lock down absolute spelling, source-directory anchor, probe order, missing behavior, identity case and CWD cases before moves |
| 2. Extract include domain | New include-resolution module; existing include provider; unit/regression imports | Provider becomes a thin VS Code adapter; helper tests run without mock VS Code; preserve regex behavior and all ranges, including known quirks |
| 3. Resolve lexical duplicate deliberately | Existing PathService and proposed local-path module, or separately approve removal of test-only methods | No include → VS Code PathService dependency. Delegate if preserving facade, otherwise remove duplicate without pretending one-user machinery needs generalization |
| 4. Clean provider test/re-export boundaries | Existing symbol-link-provider/service tests and re-export list | Service-helper tests import service; provider tests cover hover/definition envelopes. Keep register-hover policy in language domain; no mandatory unrelated module split |
| 5. Isolate DWARF probe dependency | Existing debug-source-path; symbol-link-service test construction; optionally source-line adapter seam | Fake-existence order tests and host-free source scan tests; same production output/probe behavior. No new fallback, caching or async API required |
| 6. Deduplicate only proven identity/segment mechanisms | Navigation, Trace Log, decoration/source breakpoint keys; metadata segment split if justified | Shared local-file identity only where vector-equivalent; keep artifact absolute identity, URI source IDs, metadata case inference and stepping identity separate |
| 7. Review anchor alignment as a separate behavioral change | Debug configuration/adapter/factory and selected-project context; panel contexts; extension navigation command | Decide captured project-directory versus session-folder/fallback rules explicitly; add nested/multi-root/project-switch tests. Do not silently change it during mechanical extraction |
| 8. Verify/document and stop | Architecture contracts, developer docs and applicable integration suites | No core → provider/view edges; host-free helpers; unchanged packaged navigation. Separate optional proposals for include fallback, comment-aware parsing or cross-host fixes |

All paths named without repetition in this table refer to the absolute existing/proposed locations in §§3/6. Each step should be independently reviewable and tested. Do not bundle a new symbol scanner, filesystem service, source search index or generic project-discovery rewrite with path cleanup.

## 8. Testing architecture, missing coverage and regression risks

### Existing coverage to retain

- `C:\Work\Programming\v6vscode\test\unit\language\include-link-provider.test.ts:5–137`: directive extraction/ranges, relative/parent/simple paths and absolute pass-through. The comment-related case at `:60–71` has **no assertion**; it does not prove comment exclusion. `C:\Work\Programming\v6vscode\test\regression\include-links.test.ts:26–29` is named as a backslash test but supplies `sub/file.inc` and only asserts absoluteness. Neither test demonstrates workspace fallback or existence behavior.
- `C:\Work\Programming\v6vscode\test\unit\platform\path-service.test.ts:18–57`: extension resources, token substitution and lexical resolver; currently uses mock URI/VS Code bootstrap.
- `C:\Work\Programming\v6vscode\test\unit\debug\debug-source-path.test.ts:20–84`: temporary-filesystem absolute/relative/single-root/drive/UNC, longest suffix, workspace preference even when compiled-site file exists, absent match and generated assets. `:87–100` checks **source strings**, not execution of all call chains.
- `C:\Work\Programming\v6vscode\test\unit\debug\debug-index-file-resolution.test.ts:16–73`: relocated breakpoint paths, exact preference, ambiguity refusal, Windows-style case handling and next-statement slide; `:108–117` retains data-only file-table scan pool.
- `C:\Work\Programming\v6vscode\test\unit\debug\dwarf4-line-compdirs.test.ts:36–125,128–189`: CU `stmt_list`, owning declaration files, per-program directory map/order/fallback and no-compDir relative files. `C:\Work\Programming\v6vscode\test\unit\debug\elf-dwarf.test.ts` additionally covers v5 and committed metadata fixtures.
- `C:\Work\Programming\v6vscode\test\unit\language\symbol-link-service.test.ts:25–175`: injected text reads, missing/ambiguous symbols, label precedence, macro/constants, changed-artifact/source invalidation, struct/inherited-field/instance lookup. Retain returned metadata filename rather than overwriting it with a relocated local path.
- `C:\Work\Programming\v6vscode\test\unit\language\symbol-link-provider.test.ts:95–152`: hover command/definition envelope/cancellation; `C:\Work\Programming\v6vscode\test\unit\language\source-line-service.test.ts:6–150`: line versions, dirty changes, bounded cache, case and invalidation.
- `C:\Work\Programming\v6vscode\test\unit\debug\debug-source-navigation.test.ts:51–77`: visible editor/inactive tab reuse and new preview behavior. Preserve line/column clamping even though those boundary cases need stronger tests.
- `C:\Work\Programming\v6vscode\test\unit\project\active-project-service.test.ts:9–55`, `C:\Work\Programming\v6vscode\test\unit\project\medium-term-contracts.test.ts:63–93` and `C:\Work\Programming\v6vscode\test\unit\project\project-repository.test.ts:8–49`: independent selection, stale loads/saves and relative serialization. These do not prove correct nested/multi-root source anchoring or discovery scope.

### Proposed tests (no tests added in this investigation)

1. **Host-free include boundary:** directly import proposed include-resolution module using the existing host-free test lane, without `test/register.js`; repeated parser calls, multiple includes per line, CRLF/UTF-16 offsets, malformed quotes and case/comment quirks. Lock down current commented-include match and uppercase non-match as characterization; changing either requires separate approval.
2. **Cross-policy vectors:** same relative operand resolves against **source directory** for include and **explicit metadata root** for DWARF; same missing path still produces an include target, while index lookup can refuse a match; foreign drive/UNC suffix remapping occurs only for DWARF. Include absolute strings with `..`/mixed separators must remain byte-for-byte unchanged under the existing host-absolute rule.
3. **Deterministic DWARF candidate matrix:** original/project both exist, only one exists, neither exists; exact probe order/short-circuit; in-project absolute missing (no probe); empty root; relative CWD fallback; progressively shorter suffixes; directory candidate; same basename, generated sources, Unicode and root edge cases. Test errors/probe changes explicitly before altering the existence contract.
4. **Native platform matrix:** Windows drive-qualified/drive-relative/rooted/UNC and mixed separators; native POSIX absolute/single-root/literal-backslash/case-sensitive paths. `path.win32`/`path.posix` unit tests supplement, not replace, native filesystem tests. Preserve current behavior first; design portable metadata semantics separately.
5. **Local identity versus URI identity:** Windows case variants, separators/dot segments, POSIX case differences, percent escapes, `file:///` and non-file URI/source IDs, symlink aliases and cache invalidation. No global realpath/lowercase behavior without a declared contract.
6. **Service tests at stable boundaries:** source definition helpers imported from service, not provider; inject source-path resolver/probe plus dirty text reader; declaration-first, label-before-macro fallback, metadata file order, ambiguity, negative-cache invalidation and project/artifact changes. Test actual paths sent to the injected reader, not merely returned line numbers.
7. **Provider/navigation host tests:** instantiate include provider and verify link target URI + quoted range, including nonexistent target; definition/hover locations and source command round trip; existing tab reuse, focus, preview, coordinate clamping, open failures and cancellation. Test source navigation and DAP results for identical captured context rather than grepping source code.
8. **Project/discovery/anchor tests:** root-level `*.project.json` versus nested discovery scope, multi-folder selection, nested project under first root, project in second root, no workspace/root, active-project switch during lookup, case-only URI spelling. Preserve existing selection behavior; approve anchor corrections with dedicated regression expectations.
9. **Real Extension Host regression:** use `vscode.executeDocumentLinkProvider` and `vscode.executeDefinitionProvider` against temporary ASM files; open/reveal relocated definitions; add nested/multi-root DAP stack/breakpoint/Trace Log parity fixtures. Existing `C:\Work\Programming\v6vscode\src\test\integration\suite\asm-value-presentation.test.ts:10` and `C:\Work\Programming\v6vscode\src\test\integration\suite\c-source-breakpoint.test.ts:9,90,161,229` cover real hover/value/source stepping but not this complete path-policy matrix.
10. **Architecture/release gates:** forbid runtime VS Code imports in extracted include/lexical helpers; keep browser-safe `src/shared` restrictions and no metadata → view dependencies. Run CI, full test typecheck, current/minimum packaged integration and live conformance after an implementation. Do not claim this report's unit/typecheck results are equivalent to those future integration gates.

### Behaviors not to change implicitly

- Source-directory versus project-file-directory versus first-workspace versus compilation-directory anchors.
- Absolute include spelling, missing-target links, DWARF existing-workspace preference, CWD-relative fallback and potentially nonexistent fallback strings.
- Longest existing suffix versus unique longest metadata suffix; no recursive filesystem search or automatic ambiguity resolution.
- Per-CU `stmt_list` mapping, v4/v5 directory indexes, data-only scan files, exact-address fallback and ASM definition precedence.
- Dirty editor contents/version invalidation, definition metadata filename identity, DAP string envelopes and separate URI conversion.
- Tab/group reuse, focus, previews, one-based source → zero-based editor coordinates, breakpoint ownership and source-step identity.
- Local host filesystem versus emulator-server wire paths; filesystem existence is not readability, canonical identity or confinement.

## 9. Review decision

Approve **behavior-neutral include extraction and test-boundary cleanup first**. Decide whether to retain or remove the unused `PathService` lexical/token API before creating a shared mechanism solely to keep it alive. Keep DWARF policy separate and add deterministic probing tests. Review anchor alignment, POSIX portability, stricter candidate validation and new include fallback as individually justified behavior proposals.

The strongest immediate architectural issue is the pure include boundary living in a VS Code provider. The strongest correctness concern is inconsistent supplied anchors. The evidence does **not** support merging includes, metadata, project discovery, filesystem I/O, symbol scans and navigation into a universal resolver.

## 10. Implementation closeout

Implemented after review at the user's request; this section supersedes the original
proposal-only status. Baseline references above are retained as investigation
evidence, not asserted to be the new source line numbers.

| Plan step | Delivered result |
|---|---|
| 1. Characterize | Host-free path-policy vectors cover source/project anchors, absolute spelling, include parser quirks/UTF-16/CRLF, missing paths, probe order/short-circuit, CWD fallback, no root, drive/UNC suffixes, conditional native POSIX behavior, metadata ambiguity and local identity. Existing commented-include test now asserts the match; the backslash regression now actually passes a backslash. |
| 2. Include domain | `C:\Work\Programming\v6vscode\src\language\includes\include-resolution.ts` owns `IncludeMatch`, parsing and include policy. The provider only creates VS Code ranges/links. Pure helper unit/regression imports target the domain module, and host-free tests run without the VS Code mock. |
| 3. Lexical duplicate | Retained `PathService.resolveRelative` and token API for compatibility. Both lexical entry points execute `resolveAgainstDirectory` in `C:\Work\Programming\v6vscode\src\platform\files\local-path.ts`; absolute input spelling is preserved. No provider re-export shim or generic candidate framework was added. |
| 4. Provider boundaries | Removed symbol-provider re-exports of service helpers/types; helper tests import the service owner directly. Hover/register-specific presentation remains provider-owned. |
| 5. Probe seam | `resolveDebugSourcePath` accepts an optional existence predicate (production default remains `fs.existsSync`). `DebugSourceSymbolLinkService` separately accepts a source-path resolver; its reader still sees local paths while returned locations retain metadata filenames. Tests cover positive/negative cache invalidation and project-root differences. |
| 6. Proven sharing | Navigation and Trace Log use the shared lexical local-file key, matching their former `normalize` + Windows `toLocaleLowerCase` behavior. Only the identical segment-splitting body was shared between relocation and index matching in `C:\Work\Programming\v6vscode\src\debug\metadata\source-path-segments.ts`. Artifact identity, breakpoint/decorations' non-locale folding, metadata case inference, URI/source IDs and stepping identity were deliberately not replaced. |
| 7. Anchor correction | `C:\Work\Programming\v6vscode\src\project\model\source-context.ts` provides explicit `projectSourceRoot`. Configuration captures that directory as internal `__v6SourceRoot` from the same project as program/artifact. The DAP adapter captures it before launch awaits; compatibility launches without project context use the factory-captured session folder, then first workspace folder, then empty root. Source panels/language/hover command share the model policy without importing each other. |
| 8. Gates/docs | Pure path/include/context import boundaries enforced; navigation coordinate/open-failure tests, project selection/discovery characterization and packaged multi-folder tests added. Architecture/owner/language/verification docs updated. Full clean-output release lane passed. |

### Intentional behavior correction and observed red/green regression

Before the anchor change, the new configuration → factory → DAP test failed:
changing workspace folders while `startDebug` awaited caused `src/main.asm` to be
reported under the newly first workspace rather than the selected nested project.
After the change, it reports the captured project's source. The same test suite
checks explicit project, session-folder fallback, first-workspace fallback and
empty-root fallback without manipulating adapter private source state.

This is the separately identified step-7 behavior correction, not a silent change
inside a generic path helper. The internal root is overwritten by project
configuration, not a supported user launch override. Existing relative artifact
fallback follows that captured source context; normal repository-loaded artifact
paths are already absolute. Attach still does not acquire new source-context
behavior. Active selection, exact project-save URI identity and root-level
`*.project.json` discovery remain unchanged.

The real Extension Host harness now opens two folders (the second nested beneath
the first). A project in the second folder is launched from the first: its DAP
stack/breakpoint, definition and hover-command/editor navigation agree on the
second-folder source. A separate test exercises registered include links and exact
ranges for existing and missing targets. The actual API-floor command is
`vscode.executeLinkProvider`; the proposed `vscode.executeDocumentLinkProvider`
spelling in §8 was corrected during integration validation. Windows drive-letter
case normalization is compared using local file identity, not changed in production.
Trace Log's breakpoint test verifies the same nested project-root mapping.

### Final verification

- `npm run verify:release`: all six clean-output gates exited zero.
- **15 host-free core tests**, **773 unit tests**, **62 regressions**; zero skips.
- Strict host/shared/browser-UI builds, shipped JavaScript browser checking and
  full test typecheck pass.
- **11 packaged integration tests on current VS Code** and **11 on minimum
  1.90.0**, zero pending; **three live conformance tests** pass.
- Lint remains **nine existing bounded warnings, zero errors**; no new dependency.
- **89 focused compiled tests** pass from an alternate output directory, covering
  path policies, include/provider boundaries, symbols, DAP anchor capture,
  metadata file matching, navigation and project discovery.
- Generated local release report: `C:\Work\Programming\v6vscode\temp\release-verification.json`.

No universal resolver, recursive source/project search, new include fallback,
comment/case dialect correction, regular-file restriction, async probing, realpath
canonicalization or relocation cache was introduced. POSIX-specific tests are
conditional on the host; this Windows run does not claim native Linux/VS Code
verification. Broader URI/source-ID cleanup and case-only active-project identity
remain separate concerns, rather than being silently changed by this refactoring.
Committed after explicit user approval as `Separate path-resolution mechanisms
from feature policies`. Nothing pushed; no PR or publication created.