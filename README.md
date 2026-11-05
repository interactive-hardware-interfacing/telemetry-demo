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

## Run locally

```
python -m http.server 8000
```

then open <http://localhost:8000/>. Web Serial needs HTTPS or localhost.

## Browser support

Chrome or Edge on a laptop/desktop. The simulator works anywhere.

## License

GPL-2.0 (see [`LICENSE`](LICENSE)). Maintained by [LC Linkous](https://github.com/LC-Linkous).
