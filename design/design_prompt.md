# Make a design document for a VS Code extention called v6vscode.

This extention is a development evironment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer.

1. It provides the quality of life features for editing the asm files.
- syntaxis highlight: res\syntaxes\devector_8080.tmLanguage.json
- navigation on hyperlinks: labels and includes can be hyperlinks.
2. It provides Built-in commands for:
- creating a new project
- compilation
- emulation in special tab.
- end more.

Use .\old_implementation.md as a reference, BUT keep in mind. the design and architectura of this extension, its code and the project layout must be very well organized, modular, easily maintainnable!
Also keep in mind. v6asm, v6fdd, v6emul are not built-in functionality, but external tools just stored in tools\v6asm\.
Also important point, the system you are designing must have reach test suite. Each development mailstone must ends with regression tests updates, unit tests, running tests and updating documentation .\docs\


The build toolchain produces *.rom (and optionally *.fdd). These are the primary build artifacts.
Project settings and a reference to the executable (*.rom or *.fdd) are stored in *.project.json.
The user is in charge of setting up the toolchain. The extension's entry point is the project file and its link to the executable.
===
Use .\.old_implementation.md as a reference, but do not copy it directly. The new design, architecture, code, and project layout must be clean, modular, well-organized, and easy to maintain.
Keep in mind:
- This document can have contradiction to the old design. Stick to this ideas if they contradict the design/implementation.
- **Ignore all debug metadata and symbols-related features from old_implementation.md.** The extension takes only *.rom or *.fdd files. It does not parse, load, or use *.symbols.json / *.symbols.info for source mapping, symbol navigation, or any other purpose in the current scope.
- **No control flow bar, breakpoint UI, or watchpoint UI in the current scope.** There is no *.debug.json. These will be added in the future.
- v6asm, v6fdd, v6emul, and v6c are external tools, not built-in functionality. They are stored under .\tools\
- The system must include a comprehensive test suite. Every development milestone must:
-- Update regression tests
-- Add or update unit tests
-- Run all tests
-- Update documentation in .\docs\ and README.md in the root
- This project has a very large scope. The main issue with the previous project was a poorly structured and messy implementation. To avoid repeating those mistakes, this new project must:
-- Start with a well-thought-out foundation and clear code architecture
-- Include a plan for how the system will evolve over time
-- Keep the codebase clean, well organized, and easy to maintain as the project grows


Artifacts and Project Structure
* The toolchain produces *.rom (and optionally *.fdd) — these are the primary build artifacts.

- Project settings (including reference to the executable *.rom or *.fdd) are stored in *.project.json.

Toolchains:
- When C source: C (v6c) -> ASM (v6asm) -> ROM -> (if needed, v6fdd) -> FDD
- When ASM source: ASM (v6asm) -> ROM -> (if needed, v6fdd) -> FDD

The user is in charge of setting up the toolchain. The extension's entry point is the project file with a link to the executable.
===

Tools used by the extension:
1. v6c - C compiler for Vector-06C. Compiles C source to ASM. tools\v6c\
2. v6asm - compiles the asm files to ROM. tools\v6asm\
3. v6fdd - makes the fdd image from a Template file, and set of project artifacts (rom, bin, etc.). tools\v6fdd\
4. v6emul - emulator cli backend. tools\v6emul\. VS code extension sends the requests, the backend sends the rendered image or other responses.

VS Code Extension res:
- Image for the VS Code extention icon: res\images\icon.png

# Boot ROM for emulator
res\boot\boots.bin
# Template FDD image
res\fdd\rds308.fdd

===
# Future Plans (out of current scope)

The following features are planned for the future but are explicitly **outside the scope** of the current design and implementation plan:

- Debug symbols format support (*.symbols.json / parsing and handling)
- Mapping addresses to source code and back using debug symbols
- Symbol definition navigation (Ctrl+click on labels/constants)
- Data line and code highlights based on symbol metadata
- Symbol resolving for hovers, watches, and runtime inspection
- Control flow bar (run/pause/step/restart toolbar)
- Breakpoint UI (VS Code breakpoint panel integration, gutter toggles)
- Watchpoint UI and *.debug.json session state persistence
- VS Code debug register list window integration

These features will be designed and added later as a separate effort, once the core extension (project management, build, emulation via ROM/FDD) is stable.
