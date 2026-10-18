; Minimal macro-stepping test fixture (assembled inside v6vscode/temp only).
; Exercises: single-instruction macro, multi-instruction macro, nested macro.

.global main

.macro SET_A_ZERO(val)
    xra a
    .if val != 0
        mvi a, val
    .endif
.endmacro

.macro ADD_TO_A(base, offset)
    adi base
    .if offset != 0
        adi offset
    .endif
.endmacro

.macro OUTER(v)
    SET_A_ZERO(v)
    adi 3
.endmacro

main:
    SET_A_ZERO(0)       ; single-instruction expansion (line 21)
    ADD_TO_A(10, 20)    ; multi-instruction expansion (line 22)
    OUTER(0)            ; nested expansion: SET_A_ZERO inside OUTER (line 23)
    hlt