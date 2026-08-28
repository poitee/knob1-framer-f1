/**
 * Minimal JSON-RPC client for the Work Louder Knob 1 / Framer F1 over its vendor HID
 * interface.
 *
 * This implements the wire protocol directly rather than depending on the vendor's
 * @worklouder/wl-device-kit, which ships UNLICENSED inside the Input app and cannot be
 * redistributed. The only dependency here is node-hid.
 *
 * Wire format, both directions, on vendor HID report id 6:
 *
 *     byte 0   report id (6)
 *     byte 1   channel: 1 = debug log, 2 = JSON-RPC
 *     byte 2   payload length in this frame (<= 61)
 *     byte 3.. payload
 *
 * Requests and responses are newline-terminated JSON, split across frames as needed.
 */
import HID from "node-hid";

export const WORK_LOUDER_VID = 0x303a;
export const VENDOR_USAGE_PAGE = 0xff00;
export const REPORT_ID = 6;
export const CHANNEL_DEBUG = 1;
export const CHANNEL_RPC = 2;
const MAX_PAYLOAD = 61;

export const PRODUCTS = {
  0x8396: { name: "Framer F1", layout: "ANSI" },
  0x8397: { name: "Framer F1", layout: "ISO" },
  0x8296: { name: "Knob 1", layout: "ANSI" },
  0x82e3: { name: "Knob 1", layout: "ISO" },
};

export function findDevice() {
  const match = HID.devices().find(
    (d) => d.vendorId === WORK_LOUDER_VID && d.usagePage === VENDOR_USAGE_PAGE,
  );
  if (!match) {
    throw new Error(
      "No Work Louder device found on the vendor HID interface.\n" +
        "Connect it over USB (not Bluetooth) and quit the Work Louder Input app.",
    );
  }
  return match;
}

export class KnobRpc {
  #device;
  #pending = new Map();
  #buffer = "";
  #nextId = 1;
  #onDebug;

  constructor(device, { onDebug } = {}) {
    this.#device = device;
    this.#onDebug = onDebug;
  }

  static async open({ onDebug } = {}) {
    const info = findDevice();
    let handle;
    try {
      // macOS refuses an exclusive open of a device that also presents a keyboard.
      handle = await HID.HIDAsync.open(info.path, { nonExclusive: true });
    } catch (cause) {
      throw new Error(`Could not open ${info.path}: ${cause.message}`, { cause });
    }
    const rpc = new KnobRpc(handle, { onDebug });
    handle.on("data", (buf) => rpc.#onFrame(buf));
    rpc.info = info;
    return rpc;
  }

  #onFrame(buf) {
    const off = buf[0] === REPORT_ID ? 1 : 0; // some backends strip the report id
    const channel = buf[off];
    const len = buf[off + 1];
    if (!len) return;
    const text = buf.subarray(off + 2, off + 2 + len).toString("latin1");
    if (channel === CHANNEL_DEBUG) {
      this.#onDebug?.(text);
      return;
    }
    if (channel !== CHANNEL_RPC) return;
    this.#buffer += text;
    let nl;
    while ((nl = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, nl);
      this.#buffer = this.#buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = this.#pending.get(message.id);
      if (waiter) {
        this.#pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  }

  async call(method, params, { timeoutMs = 5000 } = {}) {
    const id = this.#nextId++;
    const line =
      JSON.stringify(params === undefined ? { method, id } : { method, params, id }) + "\n";
    const bytes = Buffer.from(line, "latin1");

    let timer;
    const answer = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
    // If the write below throws, this promise must not be left pending: its timer would
    // fire later with nobody awaiting it and take the process down.
    const abandon = () => {
      clearTimeout(timer);
      this.#pending.delete(id);
      answer.catch(() => {});
    };

    for (let offset = 0; offset < bytes.length; offset += MAX_PAYLOAD) {
      const chunk = bytes.subarray(offset, offset + MAX_PAYLOAD);
      const frame = Buffer.alloc(64);
      frame[0] = REPORT_ID;
      frame[1] = CHANNEL_RPC;
      frame[2] = chunk.length;
      chunk.copy(frame, 3);
      try {
        await this.#device.write(frame);
      } catch (cause) {
        abandon();
        throw new Error(
          `HID write refused: ${cause.message}\n` +
            "On macOS a Knob 1's writes are denied to a normal user; re-run with sudo. " +
            "See docs/03-macos-hid.md.",
          { cause },
        );
      }
    }

    const reply = await answer;
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async close() {
    try {
      await this.#device.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Chunked file write. fs.writebin carries append/completed/offset itself, so a
 * transaction is not required for a single file -- fs.txbegin returns undefined and
 * fs.txcommit returns false on 0.4.1, and the write still succeeds.
 */
export async function writeFile(rpc, remotePath, bytes, { chunkSize = 3072 } = {}) {
  const total = Math.ceil(bytes.length / chunkSize) || 1;
  for (let i = 0; i < total; i += 1) {
    const chunk = bytes.subarray(i * chunkSize, (i + 1) * chunkSize);
    await rpc.call("fs.writebin", {
      file: remotePath,
      data: chunk.toString("base64"),
      append: true,
      completed: i === total - 1,
      offset: i * chunkSize,
    });
  }
  return total;
}
