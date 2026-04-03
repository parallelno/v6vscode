# Make a design document for a VS Code extention called v6vscode.

This extention is a development evironment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer.

1. It provides the quality of life features for editing the asm files.
- syntaxis highlight: res\syntaxes\devector_8080.tmLanguage.json
- navigation on hyperlinks: labels and includes can be hyperlinks.
2. It provides Built-in commands for:
- creating a new project
- compilation
- emulation in special tab.
- registers in the VS Code debug register list window.
- breakpoints in the VS Code breakpoint window.
- end more.

Use .\old_implementation.md as a reference, BUT keep in mind. the design and architectura of this extension, its code and the project layout must be very well organized, modular, easily maintainnable!
Also keep in mind. v6asm, v6fdd, v6emul are not built-in functionality, but external tools just stored in tools\v6asm\.
Also important point, the system you are designing must have reach test suite. Each development mailstone must ends with regression tests updates, unit tests, running tests and updating documentation .\docs\


The Asm tool produces *.rom and *.symbols.info. Those two artifacts are foundation for the project.
Project settings and compilation artifacts (links to *.rom and *.symbols.info) are stored in *.project.json.
Also use *.rom and *.symbols.info to get the debug meta info and mapping addresses to source. Reload them, parse on run or project rebuild.
Store the runtime debug data of the current session (breakpoints, watchpoints, etc) into *.debug.json.
===
Use .\old_implementation.md as a reference, but do not copy it directly. The new design, architecture, code, and project layout must be clean, modular, well-organized, and easy to maintain.
Keep in mind:
- This document can have contradiction to the old design. Stick to this ideas if they contradict the design/implementation.
- v6asm, v6fdd, and v6emul are external tools, not built-in functionality. They are stored under .\tools\
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
* The assembler produces two core artifacts:
- *.rom
- *.symbols.info
These artifacts are foundational to the entire project.

- Project settings and compilation artifacts (including references to *.rom and *.symbols.info) are stored in *.project.json.
- Use *.rom and *.symbols.info to:
-- Load and parse debug metadata
-- Map addresses back to source code
-- These files must be reloaded and reparsed on run or project rebuild.
- Runtime debug state for the current session (breakpoints, watchpoints, etc.) is stored in *.debug.json.
===

Tools used by the extension:
1. v6asm - compiles the asm files. tools\v6asm\
2. v6fdd - makes the fdd image from a Template file, and set of project artifacts (rom, bin, etc.).  tools\v6asm\
3. v6emul - emulator cli backend. tools\v6emul\. VS code extension sends the requests, the backend sends the rendered image or other responses.

VS Code Extension res:
- Image for the VS Code extention icon: res\images\icon.png

# Boot ROM for emulator
res\boot
# Template FDD image
C:\Work\Programming\v6vscode\res\fdd\rds308.fdd.
