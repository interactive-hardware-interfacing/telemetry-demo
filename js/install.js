'use strict';

/*
 * install.js — the Firmware tab: put the bridge or sensor code.py on a XIAO ESP32-C3 from
 * the browser, and (for a bare board) put CircuitPython on it first.
 *
 * The C3 has no CIRCUITPY drive, so "copy code.py to the board" means talking
 * to CircuitPython's raw REPL over Web Serial (js/device/). The write is
 * verified by size and CRC32 on the board, then the board is soft-rebooted and
 * we watch for the firmware's first boot line to prove it is running.
 *
 * Installing CircuitPython itself goes through flasher/ (esptool-js, loaded
 * only when that button is used). circuitpython.org does not allow a page to
 * fetch the .bin directly, so that path is: download it, pick the file here.
 */

import { SerialLink, hasWebSerial } from './device/serial-link.js';
import { ReplDevice } from './device/repl-device.js';

const FIRMWARE = { bridge: 'firmware/bridge/code.py', sensor: 'firmware/sensor/code.py' };
// What each role prints first after boot. The bridge speaks line-JSON; the
// sensor prints a plain ready line (or an ImportError if lib/ is missing).
const BOOT_LINE = { bridge: /\{"t":"hello"/, sensor: /sensor node ready|ImportError|Traceback/ };
const EXPECT_BOARD = /xiao_esp32c3/i;

/**
 * @param {object} ui   { installBridge, installSensor, status, bar, log, noRepl, cpFile, cpLoad, cpName, cpFlash }
 * @param {object} opts { releaseSerial: () => Promise<void> }   closes the instrument's own port first
 */
export function initInstall(ui, { releaseSerial = async () => {} } = {}) {
  const log = (t, cls = '') => {
    if (!t) return;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = t.replace(/\s+$/, '');
    ui.log.appendChild(line);
    while (ui.log.childElementCount > 400) ui.log.firstChild.remove();
    ui.log.scrollTop = ui.log.scrollHeight;
  };
  const phase = (t, cls = '') => { ui.status.textContent = t; ui.status.className = 'fwstatus ' + cls; log('— ' + t, 'dim'); };
  const progress = f => { ui.bar.hidden = f == null; if (f != null) ui.bar.value = Math.max(0, Math.min(1, f)); };
  let busy = false;
  const setBusy = b => { busy = b; ui.installBridge.disabled = ui.installSensor.disabled = b; ui.cpFlash.disabled = b || !image; ui.cpLoad.disabled = b; };

  if (!hasWebSerial()) {
    phase('This browser has no Web Serial. Use Chrome or Edge on a laptop or desktop to install firmware.', 'warn');
    ui.installBridge.disabled = ui.installSensor.disabled = ui.cpLoad.disabled = ui.cpFlash.disabled = true;
    return;
  }

  // ---- 1. code.py over the REPL --------------------------------------------
  async function install(role) {
    if (busy) return;
    const path = FIRMWARE[role];
    setBusy(true); progress(null); ui.noRepl.hidden = true;
    let link = null, dev = null;
    try {
      await releaseSerial();
      phase(`fetching ${path}`);
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`could not fetch ${path} (${r.status})`);
      const text = await r.text();
      log(`${path}: ${text.length} bytes`);

      phase('choose the board\'s port in the chooser');
      link = new SerialLink();
      link.onDrop = e => log('port dropped: ' + (e?.message || e), 'warn');
      await link.open(115200);
      log('port open (' + link.info() + ')');
      dev = new ReplDevice(link, log);

      phase('looking for CircuitPython on the board…');
      let id;
      try { id = await dev.connect(); }
      catch (e) {
        log(e.message, 'warn');
        phase('No CircuitPython answered. If this is a bare board, install CircuitPython first (below), then try again.', 'warn');
        ui.noRepl.hidden = false;
        return;
      }
      log(`board ${id.boardId} · CircuitPython ${id.cpVersion} · uid ${id.uid}`, 'ok');
      if (!EXPECT_BOARD.test(id.boardId)) log(`note: this firmware is written for the XIAO ESP32-C3; the board reports "${id.boardId}". Pins may differ.`, 'warn');

      phase(`writing code.py (${role} role)…`);
      progress(0);
      await dev.writeText('code.py', text, progress);
      progress(null);

      phase('rebooting the board and watching for its first line…');
      const boot = await dev.reboot({ until: BOOT_LINE[role] });
      if (role === 'bridge') {
        const hello = /\{"t":"hello"[^\n]*/.exec(boot);
        if (hello) {
          let got = '';
          try { got = JSON.parse(hello[0]).role || ''; } catch {}
          if (got && got !== 'bridge') log(`note: the board reported role "${got}", expected "bridge"`, 'warn');
          phase('Done. This board is the bridge. Leave it plugged in, go back to the instrument and click Connect bridge.', 'ok');
        } else {
          phase('code.py written and verified, but no hello line was seen within 15 s. Check the boot output above for a Python error.', 'warn');
        }
      } else {
        if (/ImportError|Traceback/.test(boot)) {
          phase(/adafruit_hcsr04/.test(boot)
            ? 'code.py is on the board, but adafruit_hcsr04 is missing from lib/. Add the library (see the note above), then press RESET.'
            : 'code.py is on the board but crashed at boot. Check the boot output above.', 'warn');
        } else if (/sensor node ready/.test(boot)) {
          phase('Done. This board is the sensor. Wire the HC-SR04 as shown on the Hardware tab and power it from a USB bank.', 'ok');
        } else {
          phase('code.py written and verified, but no ready line was seen within 15 s. Check the boot output above.', 'warn');
        }
      }
    } catch (e) {
      log(e.message || String(e), 'warn');
      phase('Install failed: ' + (e.message || e), 'warn');
    } finally {
      try { await dev?.close(); } catch {}
      if (!dev) { try { await link?.close(); } catch {} }
      progress(null);
      setBusy(false);
    }
  }
  ui.installBridge.addEventListener('click', () => install('bridge'));
  ui.installSensor.addEventListener('click', () => install('sensor'));

  // ---- 2. CircuitPython itself, for a bare board -------------------------------
  let flasher = null, image = null;
  ui.cpLoad.addEventListener('click', () => ui.cpFile.click());
  ui.cpFile.addEventListener('change', async () => {
    const f = ui.cpFile.files?.[0];
    if (!f) return;
    try {
      flasher ??= await import('../flasher/flasher.js');
      const bytes = new Uint8Array(await f.arrayBuffer());
      flasher.setImage(f.name, bytes);
      image = flasher.image;
      const info = image.info;
      ui.cpName.textContent = `${f.name} · ${(bytes.length / 1024).toFixed(0)} kB` + (info ? ` · CircuitPython ${info.version} for ${info.boardId}` : '');
      if (info && !EXPECT_BOARD.test(info.boardId)) log(`note: that image is for "${info.boardId}", not the XIAO ESP32-C3.`, 'warn');
      if (!info) log('note: the file name is not the usual adafruit-circuitpython-<board>-<lang>-<version>.bin shape; make sure it is the .bin (not .uf2) for the XIAO ESP32-C3.', 'warn');
      ui.cpFlash.disabled = busy;
    } catch (e) { log('could not load the image: ' + (e.message || e), 'warn'); }
  });
  ui.cpFlash.addEventListener('click', async () => {
    if (busy || !image?.bytes) return;
    setBusy(true); progress(null);
    try {
      await releaseSerial();
      flasher ??= await import('../flasher/flasher.js');
      const facts = await flasher.flash({
        offset: 0x0, eraseAll: true, baud: 460800, expectChip: 'esp32c3',
        onPhase: t => phase(t), onProgress: f => progress(f), onLog: t => log(t, 'dim'),
      });
      progress(null);
      phase(`CircuitPython flashed (${facts.chip}, ${facts.seconds}s). Unplug and replug the board, then click Install firmware.`, 'ok');
    } catch (e) {
      const m = e.message || String(e);
      log(m, 'warn');
      if (/Failed to connect|timeout/i.test(m)) log('The chip did not answer. Unplug the board, hold its BOOT button (B) while plugging it back in, release, and try again.', 'warn');
      phase('Flash failed: ' + m, 'warn');
    } finally { progress(null); setBusy(false); }
  });
}
