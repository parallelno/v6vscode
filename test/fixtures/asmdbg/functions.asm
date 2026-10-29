.global main
main:
    call prepare
    hlt

.optional
prepare:
    call helper
prepare_fast:
    call emit
    ret
.endoptional

.optional
helper:
    nop
    ret
.endoptional

.optional
emit:
    nop
    ret
.endoptional

.optional
unused:
    ret
.endoptional