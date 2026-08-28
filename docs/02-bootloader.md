# Bootloader, backup and restore

You do not need any of this to switch identity — that is just a file. You need it if you
want a full-flash backup first, which is strongly recommended, or if you ever want to flash
custom firmware.

The device is an **ESP32-S3** (QFN56), 16 MB flash, 2 MB embedded PSRAM, USB-Serial/JTAG,
with Secure Boot and Flash Encryption both **disabled** from the factory.

## Two ways into ROM download mode

**Hardware — works even when the app will not boot.** There are two tactile buttons stacked
vertically beside the spacebar, reachable by pulling that keycap. No case opening, no meter,
no soldering.

> Press **both** → release **only the bottom** → wait a few seconds → release the **top**.

The bottom button is EN/RESET, the top is BOOT/GPIO0. Releasing the bottom lets the chip
leave reset while the top still holds GPIO0 low, so the download-mode strap is sampled at
boot. Pressing **only the bottom** button is a plain reset, which is the easiest way to make
the device re-read `board_info.json`.

**Software — needs a working app.** The firmware exposes a `sys.bootloader` RPC. See
`tools/enter-bootloader.mjs`. It writes nothing to flash; the device reboots into the ROM
downloader and a serial port appears within a couple of seconds.

Either way you get a new `/dev/cu.usbmodem*` (macOS) or `/dev/ttyACM*` (Linux). The suffix
changes between sessions — never copy an example port.

## Backup

Install [esptool](https://github.com/espressif/esptool) (`pip install esptool`). On macOS
the port is world-writable, so esptool does **not** need sudo even though the HID tools do.

Pass `--before no-reset --after no-reset` on every intermediate call to stay in the
bootloader between commands:

```sh
PORT=/dev/cu.usbmodemXXXXX
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset chip-id
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset flash-id
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset get-security-info
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  read-flash 0 0x1000000 full-flash-16mb.bin
```

That is 16,777,216 bytes and takes about 90 seconds. Keep it somewhere permanent — it is
your way back from anything.

Partition layout, which matches the Framer F1's exactly:

| Label | Type | Offset | Size |
| --- | --- | --- | --- |
| `phy_init` | phy | `0x00f000` | 4 KiB |
| `factory` | app | `0x010000` | 8 MiB |
| `nvs` | nvs | `0x810000` | 128 KiB |
| `fs` | spiffs | `0x830000` | 2 MiB |
| `coredump` | coredump | `0xa30000` | 64 KiB |

## Restore

```sh
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  write-flash --flash-mode keep --flash-freq keep --flash-size keep \
  0 full-flash-16mb.bin
esptool --chip esp32s3 --port $PORT --before no-reset --after no-reset \
  verify-flash 0 full-flash-16mb.bin
esptool --chip esp32s3 --port $PORT --before no-reset --after watchdog-reset chip-id
```

**Pass the `keep` flags.** Without them esptool may rewrite the bootloader's flash
mode/frequency/size header during the write, which silently breaks byte-exact verification.

**Expect `verify-flash` to fail against an older backup, and do not read that as
corruption.** Runtime state lives in NVS. Two captures taken twenty minutes and a few
reboots apart differed by 617 bytes of 16,777,216 — every one inside `nvs`, in one
contiguous run. Bootloader, `phy_init`, the app, `fs` and `coredump` were byte-identical.
Diff per partition before concluding anything: differences confined to `nvs` or `coredump`
are ordinary bookkeeping; differences elsewhere are not.

To restore just one partition, write at its offset — e.g. `0x830000` for `fs` if a bad file
leaves the device unable to enumerate, or `0x10000` for the app alone, which leaves your
settings and files untouched.

## The battery matters

The Knob has an internal battery, so **unplugging USB does not necessarily power it down**.
If you are waiting on a config change that is only read at boot, unplugging may not be
enough. Press the bottom button, or use `sys.bootloader` followed by
`esptool --after watchdog-reset`.

Confirm a reboot actually happened by checking `uptime` from `sentry.get` — `tools/identify.mjs`
prints it and flags a recent reboot.
