; Build: v6asm -g main.asm -o main.rom
; Both bytes of word fields must be read by every debugger surface.
.org 0x100
    jmp main

.struct Record
    health: byte
    ptr: word
.ends

instance: Record(health=100, ptr=50)
byte_only: Record(health=100, ptr=0)
pool: Record[2]

main:
    lxi sp, 0x8000
    mvi a, 0xff
    sta instance.ptr
    sta instance.ptr + 1
    sta byte_only.ptr ; MVI/STA write one byte: this word remains 0x00ff.
    lxi h, pool
    mvi m, 100
    inx h
    mvi m, 0xff
    inx h
    mvi m, 0xff
    call set_timer ; value-presentation breakpoint
    jmp main

set_timer:
    ret
