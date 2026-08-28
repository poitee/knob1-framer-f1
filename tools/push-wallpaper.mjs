#!/usr/bin/env node
/**
 * Upload an image to the keyboard's wallpaper store and optionally select it.
 *
 * Writes to the device's fs partition. Firmware, bootloader and partition table are not
 * touched. Remove a wallpaper again with fs.delete on wallpapers/<name>.
 *
 * Usage:
 *   sudo node tools/push-wallpaper.mjs my.gif [--select]
 *   sudo node tools/push-wallpaper.mjs --list
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { KnobRpc, writeFile } from "../lib/knob-rpc.mjs";

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const select = args.includes("--select");
const localPath = args.find((a) => !a.startsWith("--"));

if (!listOnly && !localPath) {
  console.error("Usage: sudo node tools/push-wallpaper.mjs <image.gif> [--select]");
  console.error("       sudo node tools/push-wallpaper.mjs --list");
  process.exit(2);
}

const rpc = await KnobRpc.open();
const show = async (label, method, params) => {
  try {
    const r = await rpc.call(method, params);
    console.log(`${label}: ${JSON.stringify(r)}`);
    return r;
  } catch (error) {
    console.log(`${label}: FAILED ${error.message}`);
    return undefined;
  }
};

await show("before", "ui.wallpaper_list", { offset: 0, limit: 20 });

if (!listOnly) {
  const bytes = await readFile(localPath);
  const name = basename(localPath);
  const remote = `wallpapers/${name}`;
  console.log(`\nuploading ${localPath} -> /fs/${remote} ` +
    `(${bytes.length.toLocaleString()} bytes, ${Math.ceil(bytes.length / 3072)} chunks)`);

  await writeFile(rpc, remote, bytes);
  const check = await show("fs.chksm", "fs.chksm", { file: remote });
  if (check?.size !== bytes.length) {
    console.warn("WARNING: size on device does not match what was sent.");
  }

  const after = await show("after", "ui.wallpaper_list", { offset: 0, limit: 20 });

  if (select) {
    // Prefer the name the store itself reports; fall back to the filename.
    const reported = (after?.items ?? [])
      .map((i) => (typeof i === "string" ? i : i?.n ?? i?.name))
      .filter(Boolean);
    for (const candidate of [...reported, name]) {
      const ok = await show(`ui.wallpaper_select(${candidate})`,
        "ui.wallpaper_select", { name: candidate });
      if (ok !== undefined) break;
    }
    console.log("\nLook at the keyboard -- the wallpaper should have changed.");
  }
}

await rpc.close();
