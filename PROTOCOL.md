# Protocol — telemetry-demo

Two parts: the **bridge serial format** (line-JSON over USB) that the page
reads, and the **16-byte payload** the sensor node sends over ESP-NOW.
Everything the page needs is defined here.

## Link

- USB serial (native USB Serial/JTAG on the XIAO C3), **115200 baud, 8N1**.
- The bridge is **print-only**: it emits lines, it doesn't require commands.
  The page may send text lines (the serial-log box); the firmware ignores them.
- Both boards pin **Wi-Fi channel 6**.

## Bridge → page: line-JSON

One compact JSON object per line, newline-terminated. The page parses each line
and **ignores unknown `t` values and extra keys**. Partial lines are buffered
until the newline arrives; lines that aren't valid JSON are skipped.

### `hello` — once at startup
```json
{"t":"hello","role":"bridge","proto":1,"channel":6}
```

### `pkt` — one per received ESP-NOW packet
```json
{"t":"pkt","seq":1234,"mac":"7c9ebda10f20","rssi":-42,
 "len":16,"hex":"a501...","crc_ok":true,"ms":987654,
 "fields":{"echo_us":1160,"dist_mm":200,"valid":true},"gap":0}
```
- `seq` — sequence number from the payload (or `null` if undecodable).
- `mac` — sender MAC, hex, no separators.
- `rssi` — radio RSSI in **dBm**, from the ESP-NOW packet metadata.
- `len` / `hex` — payload length and the full raw payload as hex. The page
  highlights the `dist_mm` bytes in this string.
- `crc_ok` — did the payload's CRC32 check out.
- `ms` — ms since the sender booted.
- `gap` — packets missing since the last one (seq delta − 1).
- `fields` — the decoded payload (below).

### `idle` — heartbeat when nothing arrives
```json
{"t":"idle","ms":987654}
```
Sent after ~750 ms of silence so the page can show **LINK LOST** instead of
freezing.

## Payload (16 bytes, little-endian, msg_type 0x30)

| Off | Len | Field      | Type | Notes                                      |
|-----|-----|------------|------|--------------------------------------------|
| 0   | 1   | `magic`    | u8   | 0xA5                                       |
| 1   | 1   | `version`  | u8   | 0x01                                       |
| 2   | 1   | `node_id`  | u8   | sender id                                  |
| 3   | 1   | `msg_type` | u8   | 0x30 = telemetry                           |
| 4   | 4   | `seq`      | u32  | sequence number                            |
| 8   | 2   | `echo_us`  | u16  | raw echo time, microseconds; 0 on no-echo  |
| 10  | 2   | `dist_mm`  | u16  | distance in mm; **0xFFFF = no echo**       |
| 12  | 4   | `crc32`    | u32  | CRC32 (zlib) of bytes 0..11                |

The bridge emits `fields.echo_us`, `fields.dist_mm` (null when no echo), and
`fields.valid` (false on no echo).

## The "bytes → number" link

`echo_us` and `dist_mm` are the **same measurement**: the HC-SR04 produces the
echo time, and distance is `echo_us / 58` cm (the fixed speed-of-sound
constant the sensor library uses). The page highlights the `dist_mm` bytes
(offset 10, 2 bytes) in the raw payload next to the decoded number, so the
"these bytes are that number" point is literal.

## No-echo handling

When the sensor times out (blocked, out of range, or moving), the firmware
sends `dist_mm = 0xFFFF` and `echo_us = 0`. The bridge reports
`dist_mm: null, valid: false`; the page holds the line and flags a dropout
rather than plotting a false zero.

## Checking it by hand

Plug in the bridge and open the page's serial log — the raw JSON lines stream
past. Or open any serial monitor at 115200 to read them directly.

## Installing (the Firmware tab)

Not part of the demo protocol — this is how the page gets `code.py` onto a
board. Same port, 115200 8N1 (the C3's USB-JTAG/serial ignores the rate).
It is CircuitPython's raw REPL, the exchange Thonny and mpremote use:

| step | page sends | expects |
|---|---|---|
| interrupt | `\r\x03\x03` (up to 4×, with `\r` and `\x02` fallbacks) | `>>> ` |
| enter raw | `\r\x01` | `raw REPL; CTRL-B to exit\r\n>` |
| exec | code in 128-byte chunks, 8 ms apart, then `\x04` | `OK` · stdout · `\x04` · stderr · `\x04` · `>` |
| exit raw | `\r\x02` | `>>> ` |
| soft reboot | `\x04` at the friendly prompt | boot output until the role's first line (15 s max) |

The page sends `firmware/bridge/code.py` or `firmware/sensor/code.py`,
whichever role was clicked. The write is `f=open('code.py','wb')`, then one
`f.write(b'…')` per 384-byte chunk, `f.close()`, then the board prints
`os.stat` size and `binascii.crc32` of the file read back in 512-byte pieces.
Both must match what was sent.

After the reboot the bridge is expected to print its `{"t":"hello"}` line;
the sensor prints `sensor node ready on channel 6`, or an `ImportError` if
`adafruit_hcsr04` is missing from `lib/` (the page says which).

A bare board (no REPL answers) gets CircuitPython first through
`flasher/` — the ROM bootloader protocol, handled by esptool-js.
