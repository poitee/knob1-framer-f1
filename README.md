# Knob 1 → Framer F1

A Work Louder **Knob 1** can identify as a **Framer F1**. It takes a 24-byte file, not a
firmware flash:

```json
{"vendor":2,"variant":0}
```

Write that to `/fs/board_info.json` on the device, reboot, and it enumerates as
USB `0x303a:0x8396`, product string `Framer F1`, `deviceType: knob_f1`. Delete the file and
it goes back to being a Knob 1.

This repository explains why that works, what else the firmware will tell you, and how to
do all of it without bricking anything.

## Why it works

The two products **run the same firmware, byte for byte.** Not a shared codebase — the same
binary. On a Knob 1 running `0.4.1`, the bootloader, partition table, `phy_init` and the
1,960,000-byte app image are all identical to the Framer F1 images, with zero differing
bytes.

The firmware carries both identity strings and picks one at boot:

```
read_board_info_from_file   ->  /fs/board_info.json, integer "vendor" and "variant"
read_board_info_from_efuse  ->  fallback when that file is absent
```

The file wins over eFuse. On a stock Knob 1 the eFuse user block is **entirely empty**, so
the device runs the fallback and reports as a Knob 1. Supplying the file overrides it.

`vendor` is the product selector — not `variant`, despite what the names suggest.
[docs/01-identity.md](docs/01-identity.md) shows the disassembly that pins it down.

## What else is in here

| Doc | What it covers |
| --- | --- |
| [01-identity.md](docs/01-identity.md) | The identity mechanism, with the disassembly |
| [02-bootloader.md](docs/02-bootloader.md) | Two ways into the ROM bootloader, backup and restore |
| [03-macos-hid.md](docs/03-macos-hid.md) | Why macOS needs `sudo`, and why that's still unexplained |
| [04-rpc-surface.md](docs/04-rpc-surface.md) | All 36 RPC methods, most undocumented |
| [05-wallpaper.md](docs/05-wallpaper.md) | Putting your own images on the display |
| [06-recovery.md](docs/06-recovery.md) | Getting out of trouble |

Highlights of the RPC surface the vendor SDK doesn't expose: `sentry.get` returns uptime,
CPU frequency, heap totals and a per-task FreeRTOS table with stack watermarks;
`ui.wallpaper_list` / `_select` drive the display; `sys.charger_diagnostic_summary` reports
the MAX77972 charger.

## Requirements

- A Work Louder Knob 1 (or Framer F1) on USB, **not** Bluetooth
- Node 18+
- `npm install` (only dependency is [`node-hid`](https://github.com/node-hid/node-hid))
- The Work Louder Input app **quit** — it holds the device
- **macOS:** run these tools with `sudo`. macOS refuses HID writes to keyboard-class
  devices, and this keyboard puts its vendor interface on the keyboard's, so it is caught by
  that. Input Monitoring does not help -- it governs reading, not sending. See
  [docs/03-macos-hid.md](docs/03-macos-hid.md).
- **Windows:** nothing special needed. Each HID collection is its own interface there, so
  the vendor interface is reachable without elevation -- browser tools work too.

## Quick start

```sh
npm install

# See what you have
sudo node tools/identify.mjs

# Become a Framer F1, then reboot the keyboard
sudo node tools/set-identity.mjs framer-f1
# ...press the reset button, or power-cycle

sudo node tools/identify.mjs        # now reports knob_f1 / 0x8396

# Change your mind
sudo node tools/set-identity.mjs knob1
```

`board_info.json` is only read at boot, so **a reboot is required**. The Knob has a battery,
so unplugging USB may not power it down — see [docs/02-bootloader.md](docs/02-bootloader.md)
for reliable ways to reset it.

## Is this safe?

Reasonably, and the honest caveats are worth reading before you start.

**It writes one small file** to the device's `fs` partition. It does not touch firmware,
the bootloader, or the partition table. `tools/set-identity.mjs knob1` reverses it, and so
does deleting the file.

**Identity may carry hardware configuration with it.** A function near the identity
selector returns `220` when the product is 2 and `57` otherwise — a geometry constant that
differs between the two models. So this may change more than a label. On the unit this was
developed against, the display continued working normally, but the two products are not
guaranteed to share a panel and yours may behave differently. Watch the screen.

**Verified on exactly one device**: a Knob 1, ANSI, firmware `0.4.1`, on macOS 26.5.2. Other
firmware versions may differ. If `0.4.1` isn't what you're running, read the docs before
assuming any of this transfers.

**Nothing here can brick the device beyond recovery**, because ROM download mode lives in
silicon and cannot be flashed away. [docs/06-recovery.md](docs/06-recovery.md) covers the
routes. Take a full-flash backup first anyway — it takes about 90 seconds.

## Credit

The reverse-engineering groundwork — firmware extraction, the recovery discipline, the
staged custom-firmware work — comes from
[gavinmonroe/worklouder-sdk-knob-1](https://github.com/gavinmonroe/worklouder-sdk-knob-1),
which is where to look for the deeper firmware-patching story. This repository is a
standalone, dependency-light take on the Knob-1-specific parts.

No Work Louder firmware images, and no part of the vendor's `@worklouder/wl-device-kit` SDK
(which ships `UNLICENSED`), are redistributed here. `lib/knob-rpc.mjs` implements the wire
protocol from scratch so that nothing proprietary is needed.

Not affiliated with or endorsed by Work Louder.

## License

MIT — see [LICENSE](LICENSE).
