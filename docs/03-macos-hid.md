# macOS: why these tools need sudo

On macOS a **Knob 1 needs `sudo`** for anything that sends an RPC. A Framer F1 does not.
The cause is still unexplained; what follows is what was measured.

## Symptom

Discovery and connection succeed. Every call that writes a report fails:

```
Cannot write to hid device
```

Granting Input Monitoring does not fix it. That permission governs *reading* input reports
from a keyboard; there is no user-grantable permission for *sending* output reports to one.

## Measured

Calling IOKit directly separates the permission from the transport:

| Call | uid 501 | uid 0 |
| --- | --- | --- |
| `IOHIDDeviceOpen(0)` | `kIOReturnSuccess` | `kIOReturnSuccess` |
| `IOHIDDeviceSetReport(Output, id 6)` | `kIOReturnNotPermitted` (`0xe00002e2`) | success |
| `IOHIDDeviceSetReport(Feature, id 6)` | `kIOReturnNotPermitted` | success |
| `IOHIDDeviceOpen(SeizeDevice)` | `kIOReturnNotPrivileged` (`0xe00002c1`) | success |

Framing is not the problem: the report descriptor declares report ID 6 with an output count
of `0x3F` (63 bytes), which is exactly what the vendor SDK sends. Buffer lengths 63, 64 and
65 all fail identically at uid 501 and all succeed at uid 0.

Chrome's WebHID is not a workaround. It usefully hides the protected keyboard collection and
exposes the `0xff00` one with its output report, but `sendReport` bottoms out in the same
`IOHIDDeviceSetReport` and raises `NotAllowedError`.

## What is NOT the cause

The obvious explanation is that the Knob 1 puts its vendor `0xff00` collection on the same
USB interface as a Keyboard collection, so macOS applies its protected-keyboard policy to
the whole device. **That explanation is wrong.**

A Framer F1 has the identical shape — one HID interface, `PrimaryUsage` 1/6 Keyboard,
`DeviceUsagePairs` `{1,6} {12,1} {1,2} {1,1} {65280,1}`, vendor collection on report 6, bound
to `AppleUserHIDEventDriver` — and Chrome writes report 6 to it unprivileged. So the shared
interface cannot be what denies the write.

Both devices have been tested on macOS 26.x, so OS version is not the variable either. The
leading remaining hypothesis is which **report ids** a protected collection claims, but
nobody has isolated it.

If you work this out, it would be a genuinely useful thing to publish.

## Practical notes

- Grant your terminal **Input Monitoring** (System Settings → Privacy & Security). Necessary
  but not sufficient — you still need `sudo`.
- Fully quit and reopen the terminal after granting; macOS caches TCC decisions per process.
- **esptool does not need sudo.** `/dev/cu.*` is world-writable, so only the HID tools are
  affected.
- On Linux, a udev rule granting access to the hidraw node is normally enough; there is no
  equivalent keyboard-write prohibition. On Windows each HID top-level collection is exposed
  as its own interface, so the vendor collection is addressable directly.

`tools/hid-probe.py` reproduces the table above by opening the device and sending one
read-only RPC. Run it plain, then under sudo, and compare.
