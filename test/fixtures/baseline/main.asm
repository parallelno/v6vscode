; Portable baseline ELF/DWARF fixture.
.org 0x100
ARRAY_ADDR = 0x4000
OPCODE_EI = 0xfb

main:
    lxi h, ARRAY_ADDR
    call fill_random
    hlt
    jmp main

DISPLAY_ADDR = 0x8000
.include "sub/rnd.asm"
.include "sub/palette.asm"
