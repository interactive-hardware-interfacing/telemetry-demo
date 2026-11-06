# Licences in this repository

| What | Where | Licence | Text |
|---|---|---|---|
| The demo: page, scripts, firmware, docs | everything not listed below | **GPL-2.0-only** | `LICENSE` |
| **Flasher**: CircuitPython flashing from the page | `flasher/` | **Apache-2.0** | `flasher/LICENSE`, `flasher/NOTICE` |
| esptool-js (Espressif) | `flasher/vendor/esptool-js/` | Apache-2.0 | `flasher/vendor/esptool-js/LICENSE` |

The flasher is kept in its own directory with its own licence because
Apache-2.0 code cannot be distributed inside a GPL-2.0-only work. The page
loads it as a separate ES module; nothing in `flasher/` depends on anything
outside it, and nothing outside it depends on anything in it except the
Firmware tab's "Install CircuitPython" button.
