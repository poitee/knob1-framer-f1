#!/usr/bin/env node
/**
 * Reboot the keyboard into ESP32-S3 ROM download mode via the vendor sys.bootloader RPC.
 *
 * Nothing is written to flash. The device drops its HID interface and re-enumerates as a
 * serial port, ready for esptool. Power-cycling returns it to normal firmware.
 *
 * This needs a WORKING app to answer the RPC. If the app will not boot, use the buttons
 * beside the spacebar instead -- see docs/02-bootloader.md.
 *
 * Usage:  sudo node tools/enter-bootloader.mjs --confirm
 */
import { readdirSync } from "node:fs";
import { KnobRpc } from "../lib/knob-rpc.mjs";

const ports = () => readdirSync("/dev").filter((n) => /^(cu|tty)\.?usbmodem|^ttyACM/i.test(n)).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.argv.includes("--confirm")) {
  console.error(
    "Refusing to run without --confirm.\n" +
    "This reboots the keyboard into ROM download mode (reversible: power-cycle it).",
  );
  process.exit(2);
}

const before = ports();
console.log(`serial ports before: ${before.join(", ") || "(none)"}`);

const rpc = await KnobRpc.open();
console.log(`target: 0x${rpc.info.productId.toString(16)} ${rpc.info.product ?? ""}`);

try {
  // The device drops HID as it reboots, so this call often never returns a response.
  // A timeout here is an expected outcome, not a failure.
  const result = await Promise.race([
    rpc.call("sys.bootloader").then((r) => ({ ok: true, result: r })),
    sleep(6000).then(() => ({ ok: "timeout" })),
  ]);
  console.log(`sys.bootloader: ${JSON.stringify(result)}`);
} catch (error) {
  console.log(`sys.bootloader threw (often normal, the device disconnects): ${error.message}`);
} finally {
  await rpc.close();
}

for (let i = 0; i < 12; i += 1) {
  await sleep(1000);
  const added = ports().filter((p) => !before.includes(p));
  if (added.length) {
    console.log(`\nNEW SERIAL PORT after ${i + 1}s: /dev/${added.join(", /dev/")}`);
    console.log("Now use esptool -- see docs/02-bootloader.md.");
    process.exit(0);
  }
}

console.log("\nNo new serial port appeared within 12s.");
console.log("Try the two-button sequence instead; see docs/02-bootloader.md.");
