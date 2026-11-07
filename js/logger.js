'use strict';

/*
 * logger.js — record what the page sees to a .zip of CSVs, with marks.
 *
 * Generic: the page declares one or more tables, each with a name and a list
 * of columns, then pushes rows. A `marks.csv` table is always present: the
 * Mark button stamps a labelled event (time + text) so a log read back a week
 * later says "antenna off" where the numbers change. Everything stays in
 * memory until Download, so a tour laptop never writes to disk unasked, and
 * recording stops itself at MAX_BYTES. The zip is written here (STORE only),
 * no dependencies.
 *
 *   const logger = new CaptureLogger({
 *     packets: ['t_s','iso_time','seq','rssi','gap','tx_dbm'],
 *   });
 *   logger.start();  logger.push('packets', [t, iso, 12, -61, 0, 4]);
 *   logger.mark('walked to door');  const {blob, name} = logger.toZip({source:'board'});
 */

const MAX_BYTES = 200 * 1024 * 1024;

export class CaptureLogger {
  /** @param {Record<string,string[]>} tables  name → column names (no "t_s" needed; added for you) */
  constructor(tables, prefix = 'log') {
    this.tables = tables; this.prefix = prefix;
    this.onChange = () => {};
    this.reset();
  }
  reset() {
    this.recording = false; this.startedAt = null; this._t0 = null;
    this.rows = Object.fromEntries(Object.keys(this.tables).map(k => [k, []]));
    this.marks = [];
    this.count = 0; this.bytes = 0; this.full = false;
    this.extra = [];              // {name, bytes} binary files the page adds (e.g. .npy)
  }
  start() { this.reset(); this.recording = true; this.startedAt = new Date(); this._t0 = performance.now(); this.onChange(this); }
  stop() { this.recording = false; this.onChange(this); }
  /** Seconds since recording started (0 when not recording). */
  t() { return this._t0 == null ? 0 : Math.max(0, (performance.now() - this._t0) / 1000); }

  push(table, values) {
    if (!this.recording || this.full) return;
    const row = [this.t().toFixed(3), ...values.map(v => v == null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : csvq(String(v)))].join(',') + '\n';
    this.rows[table].push(row); this.bytes += row.length; this.count++;
    if (this.bytes > MAX_BYTES) { this.full = true; this.recording = false; }
    if ((this.count & 15) === 0 || this.full) this.onChange(this);
  }
  /** A labelled event. Works whether or not recording (it starts a recording if none). Returns the mark. */
  mark(label) {
    if (!this.recording && !this.full) this.start();
    const m = { t: this.t(), iso: new Date().toISOString(), label: label || `mark ${this.marks.length + 1}` };
    this.marks.push(m); this.bytes += 40 + m.label.length;
    this.onChange(this);
    return m;
  }
  addFile(name, bytes) { if (!this.recording || this.full) return; this.extra.push({ name, bytes }); this.bytes += bytes.length; if (this.bytes > MAX_BYTES) { this.full = true; this.recording = false; this.onChange(this); } }

  toZip(meta = {}) {
    const enc = new TextEncoder(), files = [];
    const stamp = (this.startedAt || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let readme = `${this.prefix} capture log\nstarted: ${(this.startedAt || new Date()).toISOString()}\nrows: ${this.count}\nmarks: ${this.marks.length}\nsource: ${meta.source || 'unknown'}\n${meta.identity ? 'board: ' + meta.identity + '\n' : ''}\nfiles:\n  marks.csv   labelled events: t_s (seconds since start), iso_time, label\n`;
    for (const [name, cols] of Object.entries(this.tables)) readme += `  ${name}.csv   columns: t_s,${cols.join(',')}\n`;
    if (meta.notes) readme += '\n' + meta.notes + '\n';
    readme += `\npython:\n  import pandas as pd\n  marks = pd.read_csv('marks.csv')\n` + Object.keys(this.tables).map(n => `  ${n} = pd.read_csv('${n}.csv')`).join('\n') + '\n';
    files.push({ name: 'README.txt', bytes: enc.encode(readme) });
    files.push({ name: 'marks.csv', bytes: enc.encode('t_s,iso_time,label\n' + this.marks.map(m => `${m.t.toFixed(3)},${m.iso},${csvq(m.label)}\n`).join('')) });
    for (const [name, cols] of Object.entries(this.tables)) files.push({ name: name + '.csv', bytes: enc.encode('t_s,' + cols.join(',') + '\n' + this.rows[name].join('')) });
    for (const f of this.extra) files.push(f);
    return { blob: zipStore(files), name: `${this.prefix}-${stamp}.zip` };
  }
}

function csvq(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

/** Wire the standard panel: #recStart #recStop #recDownload #recMark #recMarkLabel #recStatus. */
export function bindLogPanel(logger, $, { isConnected, meta, log = () => {} }) {
  let lastUrl = null;
  const paint = l => {
    const st = $('#recStatus');
    $('#recStart').disabled = l.recording || !isConnected();
    $('#recStart').classList.toggle('on', l.recording);
    $('#recStop').disabled = !l.recording;
    $('#recDownload').disabled = l.count === 0 && l.marks.length === 0;
    $('#recMark').disabled = !isConnected();
    if (l.full) { st.textContent = `Stopped at ${fmtBytes(l.bytes)} — memory cap reached. Download, then record again.`; st.className = 'recstatus full'; }
    else if (l.recording) { st.textContent = `recording · ${l.count} rows · ${l.marks.length} marks · ${fmtBytes(l.bytes)}`; st.className = 'recstatus on'; }
    else if (l.count || l.marks.length) { st.textContent = `${l.count} rows · ${l.marks.length} marks · ${fmtBytes(l.bytes)} ready to download`; st.className = 'recstatus'; }
    else { st.textContent = 'Connect or start the simulator, then record.'; st.className = 'recstatus'; }
  };
  logger.onChange = paint;
  $('#recStart').addEventListener('click', () => { logger.start(); log('[log] recording\n'); });
  $('#recStop').addEventListener('click', () => { logger.stop(); log(`[log] stopped: ${logger.count} rows, ${logger.marks.length} marks, ${fmtBytes(logger.bytes)}\n`); });
  $('#recDownload').addEventListener('click', () => {
    const { blob, name } = logger.toZip(meta());
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = lastUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    log(`[log] ${name} (${fmtBytes(blob.size)})\n`);
  });
  const doMark = () => {
    const m = logger.mark($('#recMarkLabel').value.trim());
    $('#recMarkLabel').value = '';
    log(`[mark] ${m.t.toFixed(1)}s ${m.label}\n`);
    window.dispatchEvent(new CustomEvent('logmark', { detail: m }));
  };
  $('#recMark').addEventListener('click', doMark);
  $('#recMarkLabel').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doMark(); } });
  paint(logger);
  return paint;
}

export function fmtBytes(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' kB' : (b / 1048576).toFixed(1) + ' MB'; }

// ---- minimal ZIP (STORE only) ----
const CRC_T = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff; }
function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff; }
function zipStore(files) {
  const enc = new TextEncoder(), now = new Date(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes), n = f.bytes.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime(now), true); lh.setUint16(12, dosDate(now), true);
    lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.bytes);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime(now), true); ch.setUint16(14, dosDate(now), true);
    ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + n;
  }
  const cdLen = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdLen, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
