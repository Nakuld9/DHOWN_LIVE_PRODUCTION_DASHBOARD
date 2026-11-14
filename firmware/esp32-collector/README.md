# ESP32 Machine Collector — wired / CAT6 (XH-600S)

Reads the knitting controller's terminal board and pushes live RPM, production
count, run/stop status, **and stoppage reason** to the MES `/api/live-data`
ingest (DC_PORT **8090**) over **wired Ethernet (CAT6)**. Replaces the Yindu
collector + cloud, and avoids WiFi entirely. One ESP32 per machine.

Firmware **v2.0.0** uses the ESP32 core's **built-in W5500 driver (`ETH.h`)** —
**no Ethernet library to install** (the stock Arduino "Ethernet" library is
Arduino-board-only and won't appear for ESP32). It needs the W5500 **INT** pin
wired.

## Bill of materials (per machine, ~₹1,100)
| Part | Qty | ~Cost |
|---|---|---|
| ESP32 dev board (ESP32-WROOM DevKitC, **38-pin**) | 1 | ₹400 |
| **W5500 Ethernet module (SPI, with RJ45)** | 1 | ₹250 |
| PC817 optocoupler | up to 10 | ₹10 each |
| Resistors for opto LEDs (value from voltage) | 10 | ₹20 |
| 5V USB power adapter + cable | 1 | ₹120 |
| CAT6 cable (to your switch) | 1 | as needed |
| Enclosure, dupont wires, terminal block | — | ₹150 |

## Wire the W5500 to the ESP32 (SPI + interrupt)
| W5500 | ESP32 |
|---|---|
| SCK | GPIO18 |
| MISO | GPIO19 |
| MOSI | GPIO23 |
| SCS (CS) | GPIO5 |
| **INT** | **GPIO35**  ← required by ETH.h |
| VCC | 3V3 or 5V (check module silkscreen) |
| GND | GND |

Then plug **CAT6** from the W5500's RJ45 into your network switch (same LAN as
the MES PC). *If it never gets an IP and the INT wire is correct, add a 10kΩ
pull-up from INT to 3V3 (GPIO35 has no internal pull-up).*

## Which machine terminals to wire (XH-600S back board)
> **Tower-light meaning on these machines:** green = **roll complete (doff)**, a
> momentary pulse — NOT "running". Red **and** yellow = **stopped**. Run/stop is
> derived from the **count pulse (23)**: pulses arriving ⇒ rpm>0 ⇒ RUNNING.

| Terminal | Signal | ESP32 pin | Role |
|---|---|---|---|
| 23 | count pulse | GPIO4 | production_counter + rpm (interrupt) |
| 16 | green — roll complete | GPIO32 | rolls / doffs (interrupt) |
| 07 | red — stopped | GPIO33 | instant stop (forces rpm=0 → STOPPED now) |
| 08 | yellow — stopped | GPIO25 | instant stop (forces rpm=0 → STOPPED now) |
| 21 | upper yarn break | GPIO26 | reason |
| 29 | center yarn break | GPIO27 | reason |
| 25 | oil shortage | GPIO14 | reason |
| 24 | safety door | GPIO13 | reason |
| 28 | needle detect | GPIO17 | reason |
| 34 | cloth detect | GPIO16 | reason |
| 22 | −12V (common) | GND | shared reference |

Start with **23 + 07** (count + stopped) to go live fast; add the reason wires
later. Green (16) is optional until roll tracking is wired to the MES `rolls`.

## Optocoupler wiring (one per signal — NEVER wire a terminal straight to ESP32)
```
  machine terminal ──[ R ]──►|── PC817 LED ──── signal ground / -12V (T22)
   ESP32 GPIO (INPUT_PULLUP) ─── PC817 collector
   ESP32 GND ─────────────────── PC817 emitter
```
- Active terminal → LED lights → transistor conducts → GPIO pulled **LOW**
  (firmware `ACTIVE_LOW = true`).
- **R** from measured voltage (aim ~10mA): `R=(Vsig−1.2)/0.010` → 12V≈1kΩ, 24V≈2.2kΩ.

## Server contract (matches `src/routes/live-data.routes.js`)
```
POST http://<MES_HOST>:8090/api/live-data
header  x-api-key: <DC_API_KEY>
body    { machine_id, rpm, dc_status:"online", production_counter, stoppage_reason }
```
- Server derives **RUNNING/STOPPED from rpm** (>0 = RUNNING).
- `production_counter` is **cumulative**; server computes the delta and kg itself
  (needs `machines.kg_per_counter` set for the machine).
- `stoppage_reason` (optional) fills the **auto-downtime** record instead of
  `'Reason Pending'`, and backfills an already-open pending downtime.

## Configure (edit the top of `esp32-collector.ino`)
```
MACHINE_ID   "SJ03"  (one board per machine)
MES_HOST     MES PC's LAN IP — RESERVE A FIXED DHCP LEASE for the MES PC
MES_PORT     8090  (DC_PORT in MES backend/.env)
DC_API_KEY   same as DC_API_KEY in MES backend/.env
ACTIVE_LOW   true  (from your multimeter measurement)
PULLS_PER_REV set once you know pulses on term 23 per revolution (for rpm)
```
ETH.h derives a unique MAC per ESP32 chip automatically — no MAC to set.

## Flash
1. Arduino IDE → Boards Manager → install **"esp32" by Espressif** (only this).
2. **No Ethernet library needed** — `ETH.h` is part of the ESP32 core.
3. Select *ESP32 Dev Module* + COM port → **Upload**.
4. Serial Monitor @115200 → `[eth] got IP 192.168.x.x` then `[post] ... -> HTTP/1.1 200 OK`.

## Verify on the MES
- Machine card for `MACHINE_ID` shows live RPM / production within seconds.
- `data_collectors.status` becomes ONLINE for that machine.
- On a stop past the auto-downtime threshold, the downtime record shows the real
  reason (e.g. "Oil shortage") instead of "Reason Pending".

## Edge store-and-forward (v2.0.0)
Two layers of resilience so an outage or reboot doesn't lose data:
- **Flash-persisted counters** — cumulative `count`/`rolls` are saved to NVS
  (throttled ~60s) and restored on boot, so a power blip / crash **resumes** the
  counts instead of resetting to 0 (loses at most ~1 min of unsaved counts).
- **Offline event buffer** — while the network/MES is unreachable, each run/stop
  and reason **change** is snapshotted into a 40-deep ring buffer and **replayed
  on reconnect** (oldest first, with an `age_s`), so a stop that started AND ended
  during the outage still reaches the MES. Cumulative count/rolls already survive
  an outage via the counter itself; this preserves the transient events/reasons.
  *(The server currently records replayed events at reconnect time; honoring
  `age_s` for exact historical placement is an optional future MES tweak.)*

## Notes
- **Counter** persists across reboots (see above); the MES also has counter-reset
  protection and keeps history in `production_records`.
- **One ESP32 per machine** — flash each with its own `MACHINE_ID`.
- **rolls** (green-pulse doff count) drives the MES roll lifecycle: each doff
  auto-**closes** the machine's open roll at the current counter (estimated weight
  from `kg_per_counter`) and **opens** the next (`rolls.source='AUTO'`). Fully
  automatic — the first roll opens when a running machine has none. Operators just
  weigh + approve. So wiring green (T16) now gives real per-roll production.
