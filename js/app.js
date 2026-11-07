'use strict';

/*
 * app.js — telemetry-demo UI.
 * Shows a wireless sensor reading three ways:
 *  - a live distance line chart
 *  - a moving bar that tracks the current distance (the "hand")
 *  - a bytes->number panel: the raw payload hex with the distance bytes
 *    highlighted, right next to the big decoded number, so the link between
 *    "the bytes on the air" and "the value" is explicit.
 * A dropout (sensor blocked / out of range) flatlines and flags, rather than
 * drawing a false zero.
 */

import { Bridge, FIELD_MAP } from './bridge.js';
import { SimBridge } from './sim.js';
import { initViews } from './views.js';
import { initInstall } from './install.js';
import { initPresenter } from './presenter.js';
import { CaptureLogger, bindLogPanel } from './logger.js';

const $ = s => document.querySelector(s);
const logEl = $('#log');
function log(t) { logEl.textContent += t; if (logEl.textContent.length > 20000) logEl.textContent = logEl.textContent.slice(-15000); logEl.scrollTop = logEl.scrollHeight; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

let bridge = null, simulated = false;
const MAX_MM = 450;              // chart ceiling
let lastValid = null;            // last good distance for the flatline hold

// ---- line chart ----
const chart = $('#chart'), cctx = chart.getContext('2d');
const data = []; const MAXPTS = 260; let dataCount = 0; // {mm|null}
// Size the canvas bitmap to its on-screen size × devicePixelRatio so text and
// lines stay crisp. CSS controls the layout size; this just follows it.
function fitCanvas(c, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: c.clientWidth, H: c.clientHeight };
}
new ResizeObserver(() => drawChart()).observe(chart);
function drawChart() {
  const { W, H } = fitCanvas(chart, cctx);
  cctx.clearRect(0, 0, W, H);
  cctx.strokeStyle = cssVar('--grid'); cctx.fillStyle = cssVar('--muted'); cctx.font = '11px system-ui, sans-serif';
  for (let mm = 0; mm <= MAX_MM; mm += 100) {
    const y = H - mm / MAX_MM * H;
    cctx.globalAlpha = 0.5; cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(W, y); cctx.stroke(); cctx.globalAlpha = 1;
    cctx.fillText(mm + ' mm', 4, y - 2);
  }
  // draw segments; break the line on dropouts (null)
  cctx.strokeStyle = cssVar('--accent'); cctx.lineWidth = 1.5;
  let pen = false;
  data.forEach((v, i) => {
    const x = i / (MAXPTS - 1) * W;
    if (v == null) { pen = false; return; }
    const y = H - Math.min(MAX_MM, v) / MAX_MM * H;
    if (!pen) { cctx.beginPath(); cctx.moveTo(x, y); pen = true; } else cctx.lineTo(x, y);
  });
  if (pen) cctx.stroke();
  // mark dropouts with faint red ticks
  cctx.fillStyle = cssVar('--err');
  data.forEach((v, i) => { if (v == null) { const x = i / (MAXPTS - 1) * W; cctx.fillRect(x, 0, 1, H); } });
  // labelled marks from the logging panel
  cctx.save(); cctx.strokeStyle = cssVar('--magenta'); cctx.fillStyle = cssVar('--magenta'); cctx.font = '10px system-ui, sans-serif';
  for (const m of markTicks) { const idx = m.at - (dataCount - data.length); if (idx < 0 || idx > data.length) continue; const x = idx / (MAXPTS - 1) * W; cctx.beginPath(); cctx.moveTo(x, 0); cctx.lineTo(x, H); cctx.stroke(); cctx.fillText(m.label, x + 3, 10); }
  cctx.restore();
}

// ---- moving bar ("hand") ----
const barEl = $('#distbar');
function drawBar(mm, valid) {
  const pct = mm == null ? 0 : Math.min(100, mm / MAX_MM * 100);
  barEl.style.width = pct + '%';
  barEl.style.background = valid ? cssVar('--accent') : cssVar('--err');
}

// ---- bytes->number panel ----
const hexEl = $('#payhex');
function renderBytes(hexStr, highlightKey) {
  const bytes = [];
  for (let i = 0; i < hexStr.length; i += 2) bytes.push(hexStr.slice(i, i + 2));
  const fm = FIELD_MAP.find(f => f.key === highlightKey);
  hexEl.innerHTML = bytes.map((h, i) => {
    const inField = fm && i >= fm.off && i < fm.off + fm.len;
    return `<span class="hb${inField ? ' hot' : ''}">${h}</span>`;
  }).join('');
}

// ---- stats + link ----
function setLink(up) { const el = $('#link'); el.textContent = up ? 'LINK UP' : 'LINK LOST'; el.className = up ? 'ok' : 'bad'; }

function onLine(obj) {
  if (obj.t === 'hello') { log(`[bridge] channel ${obj.channel}${obj.simulated ? ' (sim)' : ''}\n`); return; }
  if (obj.t === 'idle') { setLink(false); return; }
  if (obj.t !== 'pkt') return;
  setLink(true);

  const f = obj.fields || {};
  const valid = f.valid !== false && f.dist_mm != null;
  const mm = valid ? f.dist_mm : null;

  data.push(mm); dataCount++; while (data.length > MAXPTS) data.shift();
  logger.push('samples', [new Date().toISOString(), obj.seq, mm, f.echo_us, valid ? 1 : 0, obj.rssi, obj.gap || 0, obj.hex || '']);
  drawChart();
  drawBar(valid ? mm : (lastValid ?? 0), valid);
  if (valid) lastValid = mm;

  // big decoded number + raw bytes with the distance field highlighted
  $('#distnum').textContent = valid ? mm : '—';
  $('#distcm').textContent = valid ? (mm / 10).toFixed(1) + ' cm' : 'no echo';
  $('#echo').textContent = f.echo_us ?? '—';
  $('#distnum').classList.toggle('bad', !valid);
  if (obj.hex) renderBytes(obj.hex, 'dist_mm');
  $('#dropout').hidden = valid;
}

// ---- controls ----
function setStatus(t, c) { if (!c && logger.recording) logger.stop(); paintLog(logger); $('#status').textContent = t; $('#status').className = c ? 'ok' : ''; $('#connect').disabled = c; $('#sim').disabled = c; $('#disconnect').disabled = !c; }

async function start(useSim) {
  simulated = useSim;
  bridge = useSim ? new SimBridge() : new Bridge();
  bridge.onLine = onLine;
  bridge.onRaw = t => { if (!useSim) log(t); };
  bridge.onClose = e => { log(`\n[closed] ${e?.message || ''}\n`); setStatus('Disconnected', false); setLink(false); bridge = null; };
  try {
    log(useSim ? '[sim] starting\n' : '[serial] requesting port\n');
    await bridge.connect();
    setStatus(useSim ? 'Simulator running' : 'Bridge connected', true);
  } catch (e) { log(`[error] ${e.message}\n`); setStatus(e.message, false); bridge = null; }
}
async function stop() { if (bridge) { try { await bridge.disconnect(); } catch {} } bridge = null; setStatus('Not connected', false); setLink(false); log('[disconnected]\n'); }

$('#connect').addEventListener('click', () => start(false));
$('#sim').addEventListener('click', () => start(true));
$('#disconnect').addEventListener('click', stop);
$('#logsend').addEventListener('click', async () => {
  const cmd = $('#logcmd').value.trim(); if (!cmd) return;
  if (simulated || !bridge) { log('(no command sent)\n'); return; }
  try { await bridge.send(cmd); log('→ ' + cmd + '\n'); } catch (e) { log('[error] ' + e.message + '\n'); }
});

// ---- doc views + firmware install ----
initViews(
  $('#instrument'),
  { hardware: $('#hardware'), firmware: $('#firmware'), about: $('#about') },
  [...document.querySelectorAll('nav a[data-view]')],
);
initInstall({
  installBridge: $('#fwInstallBridge'), installSensor: $('#fwInstallSensor'), status: $('#fwStatus'), bar: $('#fwBar'), log: $('#fwLog'), noRepl: $('#fwNoRepl'),
  cpFile: $('#cpFile'), cpLoad: $('#cpLoad'), cpName: $('#cpName'), cpFlash: $('#cpFlash'),
}, { releaseSerial: async () => { if (bridge && !simulated) await stop(); } });

if (!navigator.serial) $('#nowebserial').hidden = false;
// ---- presenter mode + data logging ----
initPresenter($('#presenter'));
const logger = new CaptureLogger({
  samples: ['iso_time', 'seq', 'dist_mm', 'echo_us', 'valid', 'rssi_dbm', 'gap', 'hex'],
}, 'telemetry-demo');
const paintLog = bindLogPanel(logger, $, {
  isConnected: () => !!bridge,
  meta: () => ({ source: simulated ? 'simulator' : 'board', notes: 'samples.csv: one row per received packet. dist_mm is empty on a no-echo sample (valid = 0); hex is the raw 16-byte payload.' }),
  log,
});
const markTicks = [];
window.addEventListener('logmark', e => { markTicks.push({ at: dataCount, label: e.detail.label }); drawChart(); });

setStatus('Not connected', false); setLink(false); drawChart();
log('Ready. "Try without hardware" for the simulator, or "Connect bridge".\n');
