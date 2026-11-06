'use strict';

/*
 * sim.js — fake sensor bridge for telemetry-demo. Emits the bridge's line-JSON
 * with a 16-byte telemetry payload. The "distance" swings like a hand waving
 * in front of the sensor, and occasionally drops to no-echo so the dropout
 * flatline shows.
 */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const US_PER_CM = 58.0;

function buildPayload(seq, echoUs, distMm) {
  const b = new Uint8Array(16), dv = new DataView(b.buffer);
  b[0] = 0xa5; b[1] = 1; b[2] = 1; b[3] = 0x30;
  dv.setUint32(4, seq >>> 0, true);
  dv.setUint16(8, echoUs & 0xffff, true);
  dv.setUint16(10, distMm & 0xffff, true);
  dv.setUint32(12, crc32(b.subarray(0, 12)), true);
  return b;
}
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

export class SimBridge {
  constructor() { this.onLine = () => {}; this.onRaw = () => {}; this.onClose = () => {}; this._t = null; this.connected = false; }

  async connect() {
    this.connected = true; this.seq = 0; this.lastSeq = null; this.phase = 0;
    this._emit({ t: 'hello', role: 'bridge', proto: 1, channel: 6, simulated: true });
    this._t = setInterval(() => this._tick(), 100); // 10 Hz
    return true;
  }
  _emit(o) { this.onRaw(JSON.stringify(o) + '\n'); this.onLine(o); }

  _tick() {
    this.seq++;
    this.phase += 0.08;
    // Hand wave: 40..400 mm, plus a brief "blocked" dropout every ~6 s.
    let distMm, echoUs, valid = true;
    const blocked = (this.seq % 60) >= 56;  // ~4 of every 60 samples
    if (blocked) { distMm = 0xFFFF; echoUs = 0; valid = false; }
    else {
      const cm = 22 + 18 * Math.sin(this.phase) + (Math.random() * 2 - 1);
      distMm = Math.max(20, Math.round(cm * 10));
      echoUs = Math.round(cm * US_PER_CM);
    }
    const b = buildPayload(this.seq, echoUs, distMm & 0xffff);
    let gap = 0; if (this.lastSeq !== null) gap = this.seq - this.lastSeq - 1;
    this.lastSeq = this.seq;
    this._emit({
      t: 'pkt', seq: this.seq, mac: '7c9ebda10f20', rssi: -48 + Math.round(Math.random() * 6 - 3),
      len: 16, hex: hex(b), crc_ok: true, ms: this.seq * 100,
      fields: { node_id: 1, seq: this.seq, echo_us: echoUs, dist_mm: valid ? distMm : null, valid }, gap,
    });
  }

  async send() {}
  async disconnect() { this.connected = false; clearInterval(this._t); this._t = null; }
}
