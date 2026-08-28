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
reports as a Knob 1. Supplying the file overrides that.

## `vendor` is the product selector

The field names mislead. `variant` sounds like it should pick the product; it does not.

| `vendor` | Result |
| --- | --- |
| `2` | Framer F1 — PID `0x8396` (ANSI) or `0x8397` (ISO) |
| anything else | Knob 1 — PID `0x8296` (ANSI) or `0x82e3` (ISO) |

`variant` is parsed and stored but plays no part in choosing the product. Values `0`, `1`
and `2` were all tried for `variant` and none changed identity.

This was established by disassembling the firmware, not by guessing — three guesses at the
encoding failed first. Two things pin it down: the loader stores the first JSON key into the
first byte of its cached board-info blob and `variant` into the second, and the
`"vendor=%d, variant=%d"` log line takes its arguments from those two bytes in that order.
The identity selector then compares that first byte against `2`.

## Layout is not yours to choose

The same selector picks ANSI versus ISO from a separate source — a hardware field, not
your JSON. Layout follows the board. Setting `vendor: 2` on an ANSI unit gives you a Framer
F1 **ANSI**; you cannot force ISO this way, and you needn't worry about doing so by accident.

## Identity may carry configuration with it

A function sitting immediately beside the identity selector branches on the same byte and
yields `220` when the product is `2` and `57` otherwise. That is a geometry constant of some
kind which differs between the models, so the change is **not necessarily cosmetic**.

Watch your display after switching. On the unit this was developed against the screen kept
working normally — but that is one device, and the two products are not guaranteed to share
a panel.

## Reproducing the analysis

Everything here came from a full-flash dump plus the Xtensa toolchain. To retrace it:

```sh
# Extract the app partition from a full-flash dump
python3 -c "
d = open('full-flash-16mb.bin','rb').read(); a = d[0x10000:0x810000]
e = len(a)
while e > 0 and a[e-1] == 0xff: e -= 1
open('app.bin','wb').write(a[:e])"

# Strings first -- the board-info format strings above are all visible
strings -n 4 app.bin | grep -i board_info

# IROM is segment 3, load address 0x42000020
xtensa-esp32s3-elf-objdump -D -b binary -m xtensa --adjust-vma=0x42000020 irom.bin
```

Two traps that cost real time:

**Allow a one-character first segment** when grepping for RPC method names. A pattern
requiring two or more silently drops every `v.*` method, including `v.framer.bubble`.

**Search the JSON keys NUL-terminated.** Plain `vendor` also matches inside the error string
`board_info.json missing vendor or variant fields`, which points you at an address nothing
references and makes it look as though the keys are never used.

**Mind the segment map.** DROM is only 659,824 bytes here; file offset `0xb0020` is the start
of IROM, not the tail of DROM. Getting that wrong makes literal pools look like unreferenced
data tables.
