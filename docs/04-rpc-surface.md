# The RPC surface

Firmware `0.4.1` answers **36 RPC methods**. The vendor SDK exposes twelve. Several of the
rest are useful reads that no shipped tool can reach.

The authority is the device's own flash, not the Input app and not the SDK — `v.framer.bubble`
appears in neither, and it is in the firmware.

## Methods

Exposed by the vendor SDK: `sys.version`, `sys.bootloader`, `sys.selftest`, `device.status`,
`fs.list`, `fs.read`, `fs.readbin`, `fs.write`, `fs.writebin`, `fs.delete`,
`host.focused_app`, `ui.home_accent_color`, `alert.generic`.

Not in the SDK:

| Method | Notes |
| --- | --- |
| `sentry.get` | uptime, cpu freq, heap totals, per-task table with stack watermarks |
| `sentry.crash`, `sentry.coredump`, `sentry.coredump_erase` | crash reporting |
| `ui.wallpaper_list` | pager: `offset`, `limit` → `total`, `offset`, `items` |
| `ui.wallpaper_select` | takes `name`; errors `Missing name param`, `unknown wallpaper` |
| `ui.wallpaper_background` | `grad_top`, `grad_bottom`, `active` |
| `sys.charger_diagnostic` | takes a `category` |
| `sys.charger_diagnostic_summary` | returns `status` and `category` |
| `fs.chksm` | takes `file` → `size`, `checksum` |
| `fs.format` | **destructive** |
| `kb.cs.show`, `kb.cs.hide`, `kb.cs.toggle` | cheat sheet |
| `kb.sa.exec`, `kb.sa.inserttext`, `kb.sa.openapp`, `kb.sa.openurl` | smart actions |
| `v.framer.bubble` | display bubble; log format `l='%s' v='%s' d=%d s=%d` |
| `v.framer.hid` | no handler symbol; adjacent to `PUBLISH` and `KV_FRAMER_PUBLISH` |

`power.max77972.summary` and `power.max77972.register_dump` look like methods in a string
dump but are **category values** passed to `sys.charger_diagnostic` —
`sys.charger_diagnostic_summary` returns `"category": "power.max77972.summary"`.

`v.framer.bubble` **is present on a Knob 1**, with handler `rpc_on_framer_bubble`.

## `sentry.get`

The most useful undocumented read. Returns `uptime`, `uptime_ms`, `cpu_freq`, `heap_size`,
`heap_free`, `heap_min_free`, `cpu0_usage`, `cpu1_usage`, and a `tasks` array of
`{name, runtime, usage, priority, core, stack_min}`.

A healthy unit reports 240 MHz, a ~2,378,000-byte heap with ~2,008,000 free, and 16 tasks:
`wl_lights`, `wl_lvgl`, `esp_timer`, `wl_io`, `wl_tsk`, `wl_comms`, `wl_kmx`, `wl_rpc`,
`wl_ble`, `nimble_host`, `btController`, `TinyUSB`, `sys_evt`, `ipc0`, `ipc1`, `Tmr Svc`.

So: the display stack is **LVGL**, Bluetooth is **NimBLE**, USB is **TinyUSB**.
`heap_min_free` is the number to watch when judging headroom for anything you add.

## Which of these are safe to call

`tools/identify.mjs` sticks to reads. If you go exploring, these are inferred read-only from
the firmware's dispatch tables and confirmed by their responses: `ui.wallpaper_list`,
`sentry.get`, `fs.chksm`, `sys.charger_diagnostic_summary`.

Avoid: `sys.selftest` and `sys.charger_diagnostic` may actuate hardware; `sentry.crash` and
`sentry.coredump_erase` trigger or destroy state; `sentry.coredump` has unclear semantics;
`fs.format`, `fs.delete`, `fs.write` and `fs.writebin` change or destroy files;
`v.framer.hid` has no handler symbol and unknown semantics. `kb.*`, `alert.generic` and
`mp.*` are device-to-host notifications, not calls you make.

## Other strings of note

`alert.generic` carries `TIMER_END`, `POMODORO_WORK_END`, `POMODORO_BREAK_END` and
`wpm_record` — Pomodoro and WPM alert plumbing already exists in stock firmware.

Keycodes include `KV_FRAMER_AI`, `KV_FRAMER_PUBLISH` and `KV_OAI_ACT00`–`ACT19` (twenty
OpenAI action keys), alongside `KI_BLDW`/`KI_BLUP` backlight, `KI_LS1`–`15` layer select,
`KI_PS1`–`15` profile select, `KI_CBT1`–`8`/`KI_CBTP1`–`8` Bluetooth channels, and
`KI_CS_*` cheat sheet.

`device.status` reports `profile_index`, `layer_index`, `is_charging`. Reset reasons are
`poweron`, `panic`, `int_wdt`, `task_wdt`, `brownout`, `deepsleep`, `sdio`. The charger is a
MAX77972 with states `prequal_trickle`, `fast_charge_cc`, `fast_charge_cv_or_topoff`,
`charge_done`, `timer_fault`, `thermal_shutdown`, `reverse_boost`, `watchdog_fault`.
