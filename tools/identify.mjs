#!/usr/bin/env node
/**
 * Report what the attached device currently claims to be, plus a health snapshot.
 * Read-only: calls sys.version, device.status, fs.list and sentry.get.
 *
 * Usage:  sudo node tools/identify.mjs
 */
import { KnobRpc, PRODUCTS } from "../lib/knob-rpc.mjs";

const rpc = await KnobRpc.open();
const { vendorId, productId, product, serialNumber } = rpc.info;
const known = PRODUCTS[productId];

console.log("USB");
console.log(`  vendor id   0x${vendorId.toString(16).padStart(4, "0")}`);
console.log(`  product id  0x${productId.toString(16).padStart(4, "0")}` +
  (known ? `  (${known.name}, ${known.layout})` : "  (unrecognised)"));
console.log(`  product     ${product ?? "?"}`);
console.log(`  serial      ${serialNumber ?? "?"}`);

const safe = async (method, params) => {
  try { return await rpc.call(method, params); }
  catch (error) { return { error: error.message }; }
};

const version = await safe("sys.version");
const status = await safe("device.status");
console.log("\nFirmware");
console.log(`  version     ${JSON.stringify(version)}`);
console.log(`  status      ${JSON.stringify(status)}`);

const files = await safe("fs.list", { recursive: true });
console.log("\nFilesystem");
if (Array.isArray(files)) {
  for (const f of files) {
    const kind = f.type === "d" ? "dir " : "file";
    console.log(`  ${kind} ${f.name}${f.size ? `  ${f.size} bytes` : ""}`);
  }
  const hasBoardInfo = files.some((f) => f.name === "board_info.json");
  console.log(`\n  board_info.json present: ${hasBoardInfo}` +
    (hasBoardInfo ? "  (identity overridden by file)" : "  (identity from eFuse fallback)"));
} else {
  console.log(`  ${JSON.stringify(files)}`);
}

const sentry = await safe("sentry.get");
if (sentry && !sentry.error) {
  console.log("\nHealth");
  console.log(`  uptime      ${sentry.uptime}s` +
    (sentry.uptime < 60 ? "  (recently rebooted)" : ""));
  console.log(`  cpu         ${sentry.cpu_freq}MHz  core0 ${sentry.cpu0_usage}%  core1 ${sentry.cpu1_usage}%`);
  console.log(`  heap        ${sentry.heap_free?.toLocaleString()} free of ` +
    `${sentry.heap_size?.toLocaleString()} (min ${sentry.heap_min_free?.toLocaleString()})`);
  console.log(`  tasks       ${sentry.tasks?.length ?? 0}`);
}

await rpc.close();
