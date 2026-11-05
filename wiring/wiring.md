# Wiring — telemetry-demo

Source of truth for the page’s hardware/wiring tables. `wiring.svg` is the
diagram; the page embeds an inline, theme-aware copy.

Two XIAO ESP32-C3 boards over ESP-NOW. The sensor board has an HC-SR04
ultrasonic sensor on a **level shifter** (the HC-SR04 is a 5 V part).

## Bridge node (required)

| Signal           | XIAO C3 pin | Goes to | Note                         |
|------------------|-------------|---------|------------------------------|
| USB data + power | USB-C       | Laptop  | The only required connection |
| Antenna          | u.FL        | Whip    | Clip on firmly               |

Runs `../firmware/bridge/code.py`.

## Sensor node (required)

| Signal        | From                | To                 | Note                                         |
|---------------|---------------------|--------------------|----------------------------------------------|
| TRIG          | XIAO C3 **D2**      | HC-SR04 TRIG       | 3.3 V drive is fine, straight through        |
| ECHO          | HC-SR04 ECHO (5 V)  | XIAO C3 **D3**     | **Through the level shifter** → 3.3 V side    |
| Sensor VCC    | VUSB (5 V)          | HC-SR04 VCC        | HC-SR04 needs 5 V                            |
| Shifter HV/LV | 5 V / 3.3 V         | shifter power pins | HV = 5 V side, LV = 3.3 V side               |
| GND           | shared              | board + shifter + sensor | Common ground everywhere               |
| Antenna       | u.FL                | Whip               | Clip on firmly                               |
| Board power   | USB-C               | USB bank           | Portable                                     |

Runs `../firmware/sensor/code.py`. Needs `adafruit_hcsr04.mpy` in `lib/`.

## Notes

- **Only the ECHO line needs shifting** (it’s a 5 V output into a 3.3 V pin).
  TRIG is an input to the sensor and is happy with a 3.3 V high.
- Both boards pin Wi-Fi channel 6.
- Swapping sensors? Edit `read_sensor()`; the payload/page are unchanged.
