# Recovery

Nothing in this repository can put the device beyond recovery, because **ROM download mode
lives in silicon and cannot be flashed away**. The two buttons beside the spacebar reach it
regardless of what state the firmware is in.

That said, recovery is only *easy* if you took a backup. Take one first — 90 seconds, see
[02-bootloader.md](02-bootloader.md).

## Symptom → fix

**Identity change did nothing.** Almost always the device did not actually reboot.
`board_info.json` is read only at boot, and the internal battery means unplugging USB may
not power it down. Press the bottom button, then check `uptime` with
`sudo node tools/identify.mjs` — a small number confirms the reboot took.

**You want to undo an identity change.**

```sh
sudo node tools/set-identity.mjs default   # deletes /fs/board_info.json
```

Then reboot. It falls back to eFuse, which on a stock Knob 1 means Knob 1.

**A bad file leaves the device unable to enumerate**, so you cannot delete it over RPC.
Enter the bootloader with the buttons and restore just the `fs` partition from your backup:

```sh
python3 -c "
d = open('full-flash-16mb.bin','rb').read()
open('fs.bin','wb').write(d[0x830000:0xa30000])"

esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  write-flash --flash-mode keep --flash-freq keep --flash-size keep 0x830000 fs.bin
esptool --chip esp32s3 --port $PORT --before no-reset --after watchdog-reset chip-id
```

This wipes settings and files back to backup state but leaves firmware alone.

**The app will not boot at all.** Restore the app partition:

```sh
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  write-flash --flash-mode keep --flash-freq keep --flash-size keep 0x10000 app.bin
```

Your files and settings survive, since `fs` and `nvs` are untouched.

**Everything is broken.** Restore the whole 16 MB image at offset 0. Takes about a minute.

## Getting into the bootloader when the app is dead

Press **both** buttons → release **only the bottom** → wait a few seconds → release the
**top**. This is pure hardware strapping; it does not care whether the firmware works.

If no serial port appears, the usual cause is releasing the top button too early. GPIO0 has
to stay low until well after the chip leaves reset — give it a full 2–3 seconds.

## What each write touches

| Offset | Partition | Contains |
| --- | --- | --- |
| `0x0` | bootloader + table | boot chain |
| `0x10000` | `factory` app | firmware |
| `0x810000` | `nvs` | settings, pairings, counters |
| `0x830000` | `fs` | `keymap.json`, `board_info.json`, wallpapers |
| `0xa30000` | `coredump` | crash dumps |

Writing at `0x10000` is the safest useful operation: it replaces firmware and leaves
everything you configured intact.
