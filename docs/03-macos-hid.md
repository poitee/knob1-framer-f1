# macOS blocks writes to this keyboard

On macOS, sending anything to a Knob 1 needs `sudo`. On Windows it needs nothing. This is
macOS policy meeting a descriptor choice, and it is worth understanding because no
permission, setting, or browser can work around it.

## What happens

Every RPC fails, because every RPC starts with an HID write:

```
Cannot write to hid device
```

Chrome reports `NotAllowedError` for every report id. The Work Louder Input app fails too.
Granting Input Monitoring does not help.

## Why

The Knob 1 puts **all five HID collections on one USB interface**:

| usagePage | usage | |
| --- | --- | --- |
| `0x0001` | `0x06` | Keyboard |
| `0x000c` | `0x01` | Consumer Control |
| `0x0001` | `0x02` | Mouse |
| `0x0001` | `0x01` | Pointer |
| `0xff00` | `0x01` | Vendor RPC — output report `6`, 63 bytes |

macOS therefore builds a single `IOHIDDevice` whose *primary* usage is Keyboard, and
applies its protected-keyboard policy to the whole thing. The vendor collection is caught
by association.

**This is measured, not inferred.** Sending a deliberately undefined report id (`0xFD`) to
every HID device on one Mac, as a normal user:

```
Framer F1        1/6        KEYBOARD   NotPermitted     <- kernel refused
USB Receiver     1/6        KEYBOARD   NotPermitted     <- kernel refused
USB Receiver     65280/1    other      0xe0005000       <- reached the device
USB Receiver     13/5       other      0xe0005000       <- reached the device
USB Receiver     1/2        other      0xe0005000       <- reached the device
(null)           65292/5    other      Unsupported      <- reached the device
(null)           65280/255  other      Unsupported      <- reached the device
```

`Unsupported` and `0xe0005000` are the *hardware* rejecting an undefined report — the write
was allowed through. `NotPermitted` is the kernel refusing before the device sees anything.
Only keyboard-class devices are blocked, including another vendor's keyboard that has
nothing to do with Work Louder.

Directly, via IOKit:

| Call | uid 501 | uid 0 |
| --- | --- | --- |
| `IOHIDDeviceOpen(0)` | Success | Success |
| `IOHIDDeviceSetReport(Output, id 6)` | `kIOReturnNotPermitted` (`0xe00002e2`) | Success |
| `IOHIDDeviceSetReport(Feature, id 6)` | `kIOReturnNotPermitted` | Success |
| `IOHIDDeviceOpen(SeizeDevice)` | `kIOReturnNotPrivileged` (`0xe00002c1`) | Success |

Compare a Logitech receiver: it has a vendor collection too, on `65280/1`, and it accepts
writes — because that collection sits on **its own interface**. QMK and VIA do the same,
which is why their web tools work unprivileged. Work Louder's shared interface is the
entire difference.

## Ruled out

Each of these was tested and is **not** the cause:

- **Device identity** — refused as both `knob1` (`0x8296`) and `Framer F1` (`0x8396`)
- **A particular report id** — all of `0x1`–`0x8` refused
- **Transport** — refused over USB *and* Bluetooth LE, on a real USB interface and on a
  virtual `IOHIDUserDevice` alike
- **Another process holding it** — bare IOKit stack, no user clients
- **Input Monitoring** — `IOHIDCheckAccess` reports `GRANTED`; it governs reading input
  reports, not sending output ones
- **The vendor's app** — Input 0.18.4 fails identically and ships with *zero* entitlements
- **Machine configuration** — no MDM, no profiles, no third-party kexts, SIP enabled, no
  boot-args, admin user

The failure tracks **uid**, not app. TCC grants are per-app, so this is a privilege check
below TCC — which is why no permission you can grant will lift it.

## Cross-platform

| OS | Result | Why |
| --- | --- | --- |
| **macOS** | needs `sudo` | one interface, primary usage Keyboard, protected |
| **Windows** | **works, no elevation** | each top-level collection is its own interface, so the vendor collection is addressable on its own |
| **Linux** | expected to work with a udev rule | `hidraw` has no equivalent keyboard-write prohibition |

Confirmed on Windows: the browser flasher connects, enters the bootloader and installs
firmware with no elevation at all.

## What to do

- **macOS** — prefix with `sudo`. Everything in this repo works that way. Browser-based
  tools cannot, and that is not a bug in them.
- **Windows** — nothing special. This is the smoothest platform for the browser workflow.
- **Bootloader entry without a host** — the two buttons beside the spacebar work on any
  machine, since they are pure hardware strapping. See
  [02-bootloader.md](02-bootloader.md).

## Still open

One report holds that a Framer F1 accepts unprivileged writes on macOS. Everything
device-side has been eliminated here — same product id, same product string, same
transport, same virtual device class — so if that holds, the difference is in that machine,
not the hardware. `csrutil status` and `sw_vers -productVersion` on a working Mac would
likely settle it.

The proper fix belongs to Work Louder: move the vendor collection to its own USB interface,
as QMK does. That would make every macOS tool work unprivileged, including their own app.
