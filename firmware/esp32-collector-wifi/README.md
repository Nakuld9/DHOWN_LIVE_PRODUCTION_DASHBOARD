# ESP32 Collector — WiFi + Proximity Sensor (current build)

This is the **current** collector build for DHOWN: an inductive **proximity
sensor** on the rotating cylinder → **WiFi** → MES. It's how the vendor's
collector actually worked (Omron prox sensor, not the XH-600S panel).

> The wired/panel-tap build lives in `../esp32-collector/` (ETH.h + W5500,
> 10-signal). Use **this** one for the prox-sensor + WiFi approach.

## Phased — start simple, add reasons later
The firmware has a **`PANEL_SIGNALS`** flag:
- **`0` (Phase 1, now):** proximity sensor only → count + RPM + run/stop. No
  panel wiring. The green/red/yellow/fault code is compiled out, so an unwired
  pin can't cause phantom rolls or false stops.
- **`1` (Phase 2, later):** also read the panel fault terminals → stoppage
  reasons, and green → roll cut. Flip the flag, wire the panel, re-flash. Nothing
  else changes.

## Hardware (Phase 1)
| Part | Note |
|---|---|
| ESP32 dev board | WiFi built in — **no W5500 needed** |
| Inductive proximity sensor | **NPN, NO, 3-wire, 6–36V, 8mm** (LJ18A3-8-Z/BX ~₹250, or Omron E2B-M18KS08-WP-B1) |
| PC817 optocoupler ×1 + resistor | 1k @12V · 2.2k @24V |
| Sensor bracket + steel target bolt | one target on the cylinder = 1 pulse/rev |
| 5V USB power (or 12V→5V buck) | powers the ESP32 |

## Wiring (Phase 1)
```
prox brown (+V)  → +12/24V (machine term 05/04 or a PSU)
prox blue  (GND) → GND (shared with ESP32 GND)
prox black (out) → PC817 cathode(2)
+12/24V → R → PC817 anode(1)
PC817 collector(4) → ESP32 IO4      PC817 emitter(3) → ESP32 GND
```
`ACTIVE_LOW = true` — the NPN sensor sinks when the target passes, lighting the
opto LED, which pulls IO4 LOW = one counted pulse.

## Server contract (same endpoint as the wired build)
```
POST http://<MES_HOST>:8090/api/live-data   header x-api-key: <DC_API_KEY>
Phase 1 body: { machine_id, rpm, dc_status:"online", production_counter, age_s, fw }
Phase 2 body: also includes stoppage_reason + rolls
```
Server derives RUNNING/STOPPED from rpm (pulses arriving = running).

## Resilience (kept from the wired build)
- **Flash-persisted counters** — count survives a reboot (no reset to 0).
- **Offline buffer** — WiFi drop → keep counting, replay events on reconnect.
  *(This is what makes WiFi safe here despite the factory's flaky WiFi.)*
- **Watchdog** — auto-reboot if the loop ever hangs.

## Configure + flash
Edit the top of `esp32-collector-wifi.ino`:
```
MACHINE_ID, WIFI_SSID, WIFI_PASS, MES_HOST, DC_API_KEY, PULLS_PER_REV
```
Board = *ESP32 Dev Module* → Upload → Serial @115200 → expect
`[wifi] ... connected` then `[post] ... 200`. No Ethernet library needed (WiFi is
part of the ESP32 core).
