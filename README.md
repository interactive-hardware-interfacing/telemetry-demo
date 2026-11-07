# telemetry-demo

A browser demo of wireless sensor telemetry: an ultrasonic distance sensor on
one Seeed XIAO ESP32-C3 streams its reading to another over ESP-NOW, and the
page shows the live distance **and the raw bytes that carried it, side by
side**. Over Web Serial, no install, no server.

**Live page:** <https://interactive-hardware-interfacing.github.io/telemetry-demo/>
· **Try without hardware** runs the whole page against a built-in simulator.

Part of [Interactive Hardware Interfacing](https://interactive-hardware-interfacing.github.io/).
Self-contained — copies nothing from the other demos at runtime.

## What you see

- **Distance over time** — a live line chart (holds, doesn’t zero, on dropouts).
- **A moving bar** that tracks the current reading (the “hand”).
- **The number & its bytes** — the big decoded value next to the raw payload
  hex with the distance field highlighted.

## Hardware

- **Bridge** — XIAO C3 into the laptop; runs [`firmware/bridge/code.py`](firmware/bridge/code.py).
- **Sensor** — XIAO C3 with an HC-SR04 on a level shifter (the HC-SR04 is 5 V);
  runs [`firmware/sensor/code.py`](firmware/sensor/code.py), needs
  `adafruit_hcsr04.mpy` in `lib/`.

The sensor is swappable — see `read_sensor()`. Wiring (including the level
shifter) is in [`wiring/`](wiring/); the payload is in [`PROTOCOL.md`](PROTOCOL.md).

## Putting the firmware on a board

The page does it. Open the **Firmware** tab, plug in a XIAO ESP32-C3, click
**Install bridge** or **Install sensor**, pick the port. The page writes
`code.py` through CircuitPython's raw REPL over Web Serial (the C3 has no
`CIRCUITPY` drive, so this is the only USB path), verifies size and CRC32 on
the board, reboots it, and waits for the firmware's first line.

The sensor board also needs `adafruit_hcsr04.mpy` in its `lib/` folder, which
the page cannot install: copy it once from the
[CircuitPython library bundle](https://circuitpython.org/libraries) with
Thonny or the CircuitPython web editor. The bridge needs nothing extra.

A board that has never run CircuitPython needs it installed once: download
the `.bin` for the XIAO ESP32-C3 from
[circuitpython.org](https://circuitpython.org/board/seeed_xiao_esp32c3/),
pick it on the Firmware tab, click **Flash CircuitPython**. That path uses
[esptool-js](https://github.com/espressif/esptool-js), kept in
[`flasher/`](flasher/) under its own licence.

## What's in the repo

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/app.js` | The page: instrument, plus Hardware / Firmware / About views (`js/views.js`). |
| `js/bridge.js`, `js/sim.js` | Web Serial reader for the bridge's line-JSON, and a simulator that waves a hand. |
| `js/install.js`, `js/device/` | The Firmware tab: CircuitPython raw REPL over Web Serial (write, verify, reboot). |
| `flasher/` | CircuitPython flashing for a bare board (esptool-js). Apache-2.0, see `LICENSES.md`. |
| `firmware/bridge/code.py`, `firmware/sensor/code.py` | One CircuitPython file per role. |
| `PROTOCOL.md`, `wiring/` | The serial contract and the hookup. |

## Logging data

The **Data logging** panel records while connected (simulator included) and
hands over one `.zip`: `samples.csv` (every packet: seq, distance in mm, raw
echo µs, valid flag, RSSI, gap, payload hex) and `marks.csv` (labelled
events from the **Mark** box — "hand at 20 cm", "sensor covered"). Marks
also draw as ticks on the chart. Nothing touches disk until you click
Download.

**Presenter** (or press `P`) hides the log and settings and enlarges the
chart and the number for a projector. `Esc` leaves it; the choice is
remembered.

## Run locally

```
python -m http.server 8000
```

then open <http://localhost:8000/>. Web Serial needs HTTPS or localhost.

## Browser support

Chrome or Edge on a laptop/desktop. The simulator works anywhere.

## License

GPL-2.0 (see [`LICENSE`](LICENSE)), except `flasher/`, which is Apache-2.0
because it bundles esptool-js — see [`LICENSES.md`](LICENSES.md).
Maintained by [LC Linkous](https://github.com/LC-Linkous).
