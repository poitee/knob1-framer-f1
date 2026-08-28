# Putting your own images on the display

The wallpaper store is reachable over stock RPCs. No firmware modification.

```sh
sudo node tools/push-wallpaper.mjs my-image.gif --select
```

Verified end to end: a hand-generated GIF uploaded and rendered on the screen.

## How it works

The display is **LVGL v9** on the ESP32-S3 `LCD_CAM` peripheral. The wallpaper loader
accepts two formats:

- **Animated GIF** — decoded into PSRAM under a frame/KB budget. The firmware thins frames
  when the budget fills (`budget full, thinned to every %u. frame`), stops early if PSRAM
  runs out, and logs `decoded %u frames (of %u), loop=%u ms`.
- **LVGL `.bin`** — streamed from file (`LV_BIN_DECODER_RAM_LOAD is disabled`), with a
  colour-format byte and palette support for indexed formats.

Files live in `/fs/wallpapers`. The active selection is persisted in NVS namespace
`wl_wallpaper` under key `active`. Legacy paths `/fs/wallpaper.gif` and
`/fs/wallpaper_bg.bin` are migrated on boot.

## Upload

Write to `wallpapers/<name>` — paths are relative to `/fs`:

```js
await writeFile(rpc, "wallpapers/mine.gif", bytes);
await rpc.call("ui.wallpaper_select", { name: "mine.gif" });
```

Three things worth knowing:

**The store auto-discovers files.** No manifest. `ui.wallpaper_list` goes from `total: 0` to
`total: 1` immediately after the write.

**`ui.wallpaper_select` takes the bare filename**, not the path — `mine.gif`, not
`wallpapers/mine.gif`. It returns `result: null` on success.

**`fs.txbegin` returns `undefined` and `fs.txcommit` returns `false`, and the write still
succeeds.** `fs.writebin` carries `append`/`completed`/`offset` itself, so single-file writes
need no transaction. Do not treat that as an error — it will send you debugging a
non-problem.

`ui.wallpaper_list` item schema is `{n: name, t: type, s: size, a: active}`, with `t: "g"`
for GIF.

## Sizing

310×100 landscape renders correctly on the unit this was developed against, with no
rotation — corners appear where you authored them. The firmware reads the GIF's own
dimensions (`gif_frame_pack: %s reports a %ldx%ld canvas`), so it is discoverable rather
than fixed.

Since identity may carry a geometry constant with it (see
[01-identity.md](01-identity.md)), it is worth re-checking your wallpaper after switching
products.

## Making a GIF without dependencies

`tools/make-gif.py` is a dependency-free GIF89a writer — no Pillow, no ImageMagick. Its LZW
only ever emits literals, re-sending the clear code before the decoder's next free entry
would force a wider code. That is valid LZW, just not compact, and it keeps the encoder
short enough to audit.

```sh
python3 tools/make-gif.py out.gif 310 100
```

It produces an orientation probe: distinct coloured corners, a white border and a centre
cross, so a wrong rotation or crop is obvious at a glance.

## Background gradient

`ui.wallpaper_background` takes `grad_top`, `grad_bottom` and `active`, and
`ui.home_accent_color` takes `color`. Both change what is displayed, so they are writes —
they are not included in the read-only tooling here.
