# Protocol — telemetry-demo

Uses the **shared bridge serial format** from
`packet-inspector-demo/PROTOCOL.md` (line-JSON over USB, 115200 8N1, with
`hello` / `pkt` / `idle` lines). Only the payload differs.

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
