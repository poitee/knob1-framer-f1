# How identity works

A Knob 1 and a Framer F1 run **the same firmware image, byte for byte**. Comparing a Knob 1's
own flash dump against the published Framer F1 `0.4.1` images:

| Region | Range | Identical |
| --- | --- | --- |
| bootloader | `0x000000`–`0x008000` | yes |
| partition table | `0x008000`–`0x009000` | yes |
| gap | `0x009000`–`0x00f000` | yes |
| `phy_init` | `0x00f000`–`0x010000` | yes |
| app | `0x010000`–`0x1ee840` | yes |

Zero differing bytes, and the 1,960,000-byte app hashes to the same SHA-256 as
`framer_app_0.4.1.bin`. The ESP-IDF app descriptor names the project `nomad-e-fw` — one
codebase across the product line — and the image carries both product name strings.

So identity cannot be coming from the firmware. It comes from `src/wl_board_info.cpp`,
whose format strings are plainly visible in the image:

```
/fs/board_info.json
%s not found, falling back to eFuse
Board info loaded from file: vendor=%d, variant=%d
Board info loaded from eFuse: vendor=%d, variant=%d
board_info.json missing vendor or variant fields
```

**The file wins; eFuse is the fallback.** On a stock Knob 1 the eFuse user block is entirely
empty — `BLOCK_USR_DATA` all zeros, `CUSTOM_MAC` zeros — so the device takes the fallback and
reports as a Knob 1.

## `vendor` is the product selector

The field names mislead, and this cost several wrong attempts: `variant` sounds like the
product, but it isn't. The loader parses the JSON into a three-byte blob cached in RAM:

```asm
4202d210  call8 0x4202c9a8      ; parse integer
4202d213  l32r  a7, 0x3fcae218  ; blob base
4202d216  s8i   a10, a7, 0      ; blob[0] <- first key
4202d219  l32r  a8, 0x3c125d2c  ; "variant"
4202d231  s8i   a10, a7, 1      ; blob[1] <- variant
...
4202d23f  l8ui  a8, a7, 0       ; \ arguments to
4202d242  l8ui  a9, a7, 1       ; / "...vendor=%d, variant=%d"
```

The log line's own argument order settles which byte is which: `blob[0]` is `vendor`,
`blob[1]` is `variant`. And `blob[0]` is exactly what the selector compares:

```asm
42003050  entry a1, 48
42003053  beqz.n a3, 305c          ; a3 == 0 ? ISO : ANSI
42003055  l32r a8, 0x8296          ;   default -> Knob 1 ANSI
    305c  l32r a8, 0x82e3          ;   default -> Knob 1 ISO
4200305f  bnei a2, 2, 307e         ; <<< a2 != 2 -> knob1 branch
42003069  l32r a8, 0x8396          ;   a2 == 2, ANSI -> Framer F1 ANSI
42003070  l32r a8, 0x8397          ;   a2 == 2, ISO  -> Framer F1 ISO
42003076  l32r a8, 0x3c120120      ;   name = "Framer F1"
    307e  ...
42003086  l32r a8, 0x3c12012c      ;   name = "knob1"
4200308f  retw.n
```

| `vendor` | Result |
| --- | --- |
| `2` | Framer F1 — PID `0x8396` (ANSI) or `0x8397` (ISO) |
| anything else | Knob 1 — PID `0x8296` (ANSI) or `0x82e3` (ISO) |

`variant` is stored but does not select the product. Values `0`, `1` and `2` were all tried
for `variant`; none changed identity.

## Layout is not yours to choose

`a3` above picks ANSI versus ISO, and it comes from a different source (`struct[81]`), not
from the JSON. Layout follows the hardware. Setting `vendor: 2` on an ANSI board gives you a
Framer F1 **ANSI** — you cannot force ISO this way, and you needn't worry about doing so by
accident.

## Identity may carry configuration with it

Immediately after the selector, another function branches on the same byte:

```asm
4202d2d0  bnei a8, 2, 4202d2dc
4202d2d3  movi a2, 220          ; product == 2
    d2dc  movi a2, 57           ; otherwise
```

`220` versus `57` is a geometry constant that differs between the models, so the change is
not necessarily cosmetic. Watch your display after switching. On the unit this was developed
against the screen kept working normally — but that is a single device, and the two products
are not guaranteed to share a panel.

## Reproducing the analysis

```sh
# Extract the app partition from a full-flash dump
python3 -c "
d = open('full-flash-16mb.bin','rb').read(); a = d[0x10000:0x810000]
e = len(a)
while e > 0 and a[e-1] == 0xff: e -= 1
open('app.bin','wb').write(a[:e])"

# IROM is segment 3, load address 0x42000020
xtensa-esp32s3-elf-objdump -D -b binary -m xtensa --adjust-vma=0x42000020 irom.bin
```

Two traps that cost real time:

**Allow a one-character first segment** when grepping for RPC method names. A pattern
requiring two or more silently drops every `v.*` method, including `v.framer.bubble`.

**Search the JSON keys NUL-terminated.** Plain `vendor` also matches inside the error string
`board_info.json missing vendor or variant fields`, which points you at an address nothing
references and makes it look like the keys are unused.
