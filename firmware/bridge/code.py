# code.py — BRIDGE node for telemetry-demo
#
# Shared bridge format (see PROTOCOL.md). Decodes the 16-byte telemetry
# payload: raw echo microseconds and computed distance. A distance of 0xFFFF
# means "no echo" (out of range / sensor blocked), which the page shows as a
# dropout flatline rather than a bogus zero.

import time
import struct
import binascii
import json
import sys
import wifi
import espnow

PROTO = 1
CHANNEL = 6
IDLE_MS = 750
MAGIC = 0xA5

wifi.radio.enabled = True
try:
    wifi.radio.start_ap(ssid="telemetry-br", channel=CHANNEL)
except Exception:
    pass

e = espnow.ESPNow()

def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")))
    sys.stdout.write("\n")

emit({"t": "hello", "role": "bridge", "proto": PROTO, "channel": CHANNEL})

def decode(msg):
    if len(msg) != 16 or msg[0] != MAGIC:
        return None, False
    body, crc_rx = msg[:12], struct.unpack_from("<I", msg, 12)[0]
    crc_ok = (binascii.crc32(body) & 0xFFFFFFFF) == crc_rx
    magic, ver, node_id, msg_type, seq, echo_us, dist_mm = struct.unpack_from("<BBBB I H H", body, 0)
    valid = dist_mm != 0xFFFF
    fields = {
        "node_id": node_id, "seq": seq,
        "echo_us": echo_us,
        "dist_mm": (dist_mm if valid else None),
        "valid": valid,
    }
    return fields, crc_ok

last_seq = None
last_rx = time.monotonic_ns() // 1_000_000
idle_sent = False

while True:
    now = time.monotonic_ns() // 1_000_000
    if e:
        p = e.read()
        if p is not None:
            idle_sent = False
            last_rx = now
            msg = bytes(p.msg)
            fields, crc_ok = decode(msg)
            seq = fields["seq"] if fields else None
            gap = 0
            if seq is not None and last_seq is not None:
                gap = (seq - last_seq - 1) & 0xFFFFFFFF
                if gap > 1000:
                    gap = 0
            if seq is not None:
                last_seq = seq
            emit({
                "t": "pkt", "seq": seq, "mac": binascii.hexlify(bytes(p.mac)).decode(),
                "rssi": p.rssi, "len": len(msg), "hex": binascii.hexlify(msg).decode(),
                "crc_ok": crc_ok, "ms": p.time, "fields": fields, "gap": gap,
            })
    else:
        if (now - last_rx) > IDLE_MS and not idle_sent:
            emit({"t": "idle", "ms": now})
            idle_sent = True
        time.sleep(0.002)
