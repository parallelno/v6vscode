.org 0x100
.global main
main:
    lxi sp, 0x8000
    call prepare
    hlt

.optional
prepare:
    lxi h, helper
    pchl
prepare_fast:
    jmp emit
    ret
.endoptional

.optional
helper:
    nop
    jmp prepare_fast
.endoptional

.optional
emit:
    nop
    ret
.endoptional