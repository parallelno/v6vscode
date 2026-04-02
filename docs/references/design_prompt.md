# Make a design document for a VS Code extention called v6code.

This extention is a development evironment for the **Vector-06C** (Вектор-06Ц), a Soviet 8-bit home computer.

1. It provides the quality of life features for editing the asm files.
a. syntaxis highlight: res\syntaxes\devector_8080.tmLanguage.json
b. navigation on hyperlinks: labels and includes can be hyperlinks.
2. It provides Built-in commands for:
a. creating a new project
b. compilation
c. emulation in special tab.
d. registers in the VS Code debug register list window.
e. breakpoints in the VS Code breakpoint window.
end more. get more info here: old_implementation.md



Project settings are stored in *.project.json
Debug info stored in *.debug.info

Tools ised by the extension:
1. v6asm - compiles the asm files. tools\v6asm\
2. v6fdd - makes the fdd image from a Template file, and set of project artifacts (rom, bin, etc.).  tools\v6asm\
3. v6emul - emulator cli backend. tools\v6emul\. VS COde extension sends the requests, the backend sends the rendered image or other responses.

VS Code Extension res:
- Image for the VS Code extention icon: res\images\icon.png

# Boot ROM for emulator
res\boot
# Template FDD image
C:\Work\Programming\v6vscode\res\fdd\rds308.fdd.
