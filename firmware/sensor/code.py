# code.py — SENSOR node for telemetry-demo
#
# Runs on a XIAO ESP32-C3 in CircuitPython. Reads an HC-SR04 ultrasonic
# distance sensor ~10x/sec and broadcasts the reading over ESP-NOW. The
# payload carries BOTH the raw echo time (microseconds) and the computed
# distance, so the web page can show "the number the sensor produced" next to
# "the bytes that carried it."
#
# HC-SR04 is a 5V sensor. Power it from 5V (VUSB on the XIAO). TRIG can be
# driven from the C3's 3.3V directly; ECHO is a 5V output and MUST go through
# a level shifter down to 3.3V before reaching the C3. See wiring/.
#
# Pins (see wiring/wiring.md):
#   TRIG -> D2        (3.3V out, straight to sensor TRIG)
#   ECHO -> D3        (from the level shifter's 3.3V side)
#
# Payload (16 bytes, little-endian, msg_type 0x30):
#   off 0  1B  magic     0xA5
#   off 1  1B  version   0x01
#   off 2  1B  node_id   0x01
#   off 3  1B  msg_type  0x30
#   off 4  4B  seq       u32
#   off 8  2B  echo_us   u16   raw echo time (microseconds); 0 if no echo
#   off 10 2B  dist_mm   u16   computed distance (mm); 0xFFFF if no echo
#   off 12 4B  crc32     u32   CRC32 of bytes 0..11
#
# To swap sensors (photoresistor, pot, TMP36) just change read_sensor() to
# return (raw, value_mm) and keep the payload the same.

import time
import struct
import binascii
import board
import wifi
import espnow
import adafruit_hcsr04

NODE_ID = 0x01
MSG_TYPE = 0x30
BROADCAST = b"\xff\xff\xff\xff\xff\xff"
CHANNEL = 6
RATE_HZ = 10
US_PER_CM = 58.0            # standard HC-SR04 constant (round trip)

wifi.radio.enabled = True
try:
    wifi.radio.start_ap(ssid="telemetry-tx", channel=CHANNEL)
except Exception as ex:
    print("channel pin warning:", ex)

sonar = adafruit_hcsr04.HCSR04(trigger_pin=board.D2, echo_pin=board.D3, timeout=0.06)

def read_sensor():
    """Return (echo_us, dist_mm) or (0, None) on no-echo/timeout.

    The adafruit library gives distance in cm; we recover the raw echo
    microseconds from the same fixed relation it uses internally
    (echo_us = distance_cm * 58), so the page can show both.
    """
    try:
        cm = sonar.distance                 # may raise RuntimeError
        echo_us = int(round(cm * US_PER_CM))
        dist_mm = int(round(cm * 10))
        if dist_mm < 0 or dist_mm > 0xFFFE:
            return 0, None
        return echo_us & 0xFFFF, dist_mm
    except RuntimeError:
        return 0, None                      # out of range / moving / no echo

e = espnow.ESPNow()
peer = espnow.Peer(mac=BROADCAST, channel=CHANNEL)
e.peers.append(peer)

seq = 0
print("sensor node ready on channel", CHANNEL)

while True:
    echo_us, dist_mm = read_sensor()
    dmm = 0xFFFF if dist_mm is None else dist_mm
    body = struct.pack("<BBBB I H H", 0xA5, 0x01, NODE_ID, MSG_TYPE,
                       seq & 0xFFFFFFFF, echo_us, dmm)   # 12 bytes
    crc = binascii.crc32(body) & 0xFFFFFFFF
    packet = body + struct.pack("<I", crc)              # 16 bytes
    try:
        e.send(packet, peer)
    except Exception as ex:
        print("send error:", ex)
    seq += 1
    time.sleep(1.0 / RATE_HZ)
