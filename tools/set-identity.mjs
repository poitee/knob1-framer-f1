#!/usr/bin/env node
/**
 * Switch which product the keyboard reports itself as, by writing /fs/board_info.json.
 *
 * This writes ONE small file to the device's fs partition. It does not touch firmware,
 * the bootloader, or the partition table, and it is reversible.
 *
 * Usage:
 *   sudo node tools/set-identity.mjs framer-f1     # {"vendor":2,"variant":0}
 *   sudo node tools/set-identity.mjs knob1         # {"vendor":0,"variant":0}
 *   sudo node tools/set-identity.mjs default       # delete the file, fall back to eFuse
 *   sudo node tools/set-identity.mjs show          # print the current file, if any
 *
 * board_info.json is read ONLY at boot, so reboot afterwards. The Knob has a battery, so
 * unplugging USB may not power it down -- press the reset button or see docs/02.
 */
import { KnobRpc, writeFile } from "../lib/knob-rpc.mjs";

const REMOTE = "board_info.json";           // lands at /fs/board_info.json
const PRESETS = {
  "framer-f1": { vendor: 2, variant: 0 },
  knob1: { vendor: 0, variant: 0 },
};

const mode = process.argv[2];
if (!mode || !["framer-f1", "knob1", "default", "show"].includes(mode)) {
  console.error("Usage: sudo node tools/set-identity.mjs <framer-f1|knob1|default|show>");
  process.exit(2);
}

const rpc = await KnobRpc.open();
const listing = await rpc.call("fs.list", { recursive: true }).catch(() => []);
const present = Array.isArray(listing) && listing.some((f) => f.name === REMOTE);

if (mode === "show") {
  if (!present) {
    console.log("No /fs/board_info.json -- identity comes from the eFuse fallback.");
  } else {
    const info = await rpc.call("fs.chksm", { file: REMOTE }).catch((e) => ({ error: e.message }));
    console.log(`/fs/board_info.json present: ${JSON.stringify(info)}`);
    console.log("Read it back with tools/pull-file.mjs if you want the contents.");
  }
  await rpc.close();
  process.exit(0);
}

if (mode === "default") {
  if (!present) {
    console.log("Already on the eFuse default; nothing to delete.");
  } else {
    console.log(await rpc.call("fs.delete", { file: REMOTE })
      .then(() => "Deleted /fs/board_info.json.")
      .catch((e) => `fs.delete failed: ${e.message}`));
  }
  console.log("Reboot the keyboard for this to take effect.");
  await rpc.close();
  process.exit(0);
}

const payload = Buffer.from(JSON.stringify(PRESETS[mode]), "utf8");
console.log(`writing ${payload.length} bytes to /fs/${REMOTE}: ${payload.toString()}`);
await writeFile(rpc, REMOTE, payload);

const check = await rpc.call("fs.chksm", { file: REMOTE }).catch((e) => ({ error: e.message }));
console.log(`fs.chksm: ${JSON.stringify(check)}`);
if (check?.size !== payload.length) {
  console.warn("WARNING: size on device does not match what was sent.");
}

console.log(
  `\nNow REBOOT the keyboard -- board_info.json is only read at boot.` +
  `\nThen: sudo node tools/identify.mjs` +
  `\nExpect ${mode === "framer-f1" ? "0x8396 / Framer F1" : "0x8296 / knob1"}.`,
);
await rpc.close();
