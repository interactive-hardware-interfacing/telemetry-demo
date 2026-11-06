'use strict';

/*
 * bridge.js — Web Serial reader for the bridge's line-JSON format.
 *
 * The bridge node prints one compact JSON object per line over USB serial at
 * 115200 baud. This reader opens the port, splits on newlines, parses each
 * line, and calls onLine(obj). It tolerates partial lines and junk. Payload
 * decoding happens on the page, not here.
 *
 * Line types (see PROTOCOL.md): {"t":"hello",...} {"t":"pkt",...} {"t":"idle",...}
 */

export class Bridge {
  constructor({ baudRate = 115200 } = {}) {
    this.baudRate = baudRate;
    this.port = null; this.reader = null; this.writer = null;
    this.keepReading = false;
    this.onLine = () => {};
    this.onRaw = () => {};      // raw text, for the serial log
    this.onClose = () => {};
  }

  get connected() { return !!this.port; }

  async connect() {
    if (!navigator.serial) throw new Error('This browser has no Web Serial. Use Chrome or Edge on a laptop or desktop.');
    if (!isSecureContext) throw new Error('Serve this page over HTTPS or localhost.');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: this.baudRate, bufferSize: 65536 });
    this.port = port;
    this.writer = port.writable?.getWriter() ?? null;
    this.keepReading = true;
    this._readLoop();            // runs in background
    return true;
  }

  async _readLoop() {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (this.keepReading && this.port?.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (!value) continue;
            const text = decoder.decode(value, { stream: true });
            this.onRaw(text);
            buf += text;
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let obj;
              try { obj = JSON.parse(line); } catch { continue; } // skip junk/partials
              this.onLine(obj);
            }
            if (buf.length > 1 << 20) buf = buf.slice(-65536); // runaway guard
          }
        } finally {
          try { this.reader.releaseLock(); } catch {}
          this.reader = null;
        }
      }
    } catch (e) {
      if (this.keepReading) this.onClose(e);
    }
  }

  async send(text) {
    if (!this.writer) return;
    await this.writer.write(new TextEncoder().encode(text.endsWith('\n') ? text : text + '\n'));
  }

  async disconnect() {
    this.keepReading = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    this.writer = null;
    try { await this.port?.close(); } catch {}
    this.port = null;
  }
}

// ---- field map for the 16-byte telemetry payload (msg_type 0x30) ----
// Used to color the bytes->number panel. The distance field is the star:
// hovering/plotting it shows which bytes carried the number. Offsets match
// firmware/sensor/code.py.
export const FIELD_MAP = [
  { key: 'magic',    off: 0,  len: 1, label: 'Magic',     color: '#8a8a8a' },
  { key: 'version',  off: 1,  len: 1, label: 'Version',   color: '#8a8a8a' },
  { key: 'node_id',  off: 2,  len: 1, label: 'Node ID',   color: '#b5460f' },
  { key: 'msg_type', off: 3,  len: 1, label: 'Msg type',  color: '#b5460f' },
  { key: 'seq',      off: 4,  len: 4, label: 'Sequence',  color: '#2f6fb0' },
  { key: 'echo_us',  off: 8,  len: 2, label: 'Echo µs',   color: '#6a4fb0' },
  { key: 'dist_mm',  off: 10, len: 2, label: 'Distance',  color: '#2f7d32' },
  { key: 'crc32',    off: 12, len: 4, label: 'CRC32',     color: '#b03a3a' },
];
