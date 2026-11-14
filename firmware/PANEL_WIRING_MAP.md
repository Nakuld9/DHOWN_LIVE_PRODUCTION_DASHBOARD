# Electrician Wiring Sheet — XH-600S panel → ESP32 input board

**Machine:** ____________   **Board serial / location:** ____________   **Date:** ____________

Run **one wire per row** from the panel terminal to the matching board input. Tap
in **parallel** at each panel terminal — **do not cut** the machine's existing wires.
No soldering, no programming (the board comes pre-loaded).

## Signal wiring (11 wires)

| # | Panel terminal | Signal | → | Board input | ✔ |
|---|---|---|---|---|---|
| 1 | **T23** | count / RPM | → | **IN1** | ☐ |
| 2 | **T16** | green — roll complete | → | **IN2** | ☐ |
| 3 | **T07** | red — stopped | → | **IN3** | ☐ |
| 4 | **T08** | yellow — stopped | → | **IN4** | ☐ |
| 5 | **T21** | upper yarn break | → | **IN5** | ☐ |
| 6 | **T29** | center yarn break | → | **IN6** | ☐ |
| 7 | **T25** | oil shortage | → | **IN7** | ☐ |
| 8 | **T24** | safety door | → | **IN8** | ☐ |
| 9 | **T28** | needle detect | → | **IN9** | ☐ |
| 10 | **T34** | cloth detect | → | **IN10** | ☐ |
| 11 | **T27** | color-change fault | → | **IN11** | ☐ |
| *(opt)* | *T30* | *LOV — verify meaning first* | → | *IN12* | ☐ |

## Common + power (2 more connections)

| Panel terminal | → | Board terminal | Note | ✔ |
|---|---|---|---|---|
| **T22 (−12V)** | → | **COM** | shared reference for ALL inputs | ☐ |
| **12 / 24 V supply** (machine T05=12V / T04=24V, or a DIN PSU) | → | **V+ / V−** | powers the board | ☐ |

*(Network is WiFi — nothing to wire. The board sends to the MES automatically.)*

## Recommended board & the ONE thing to check first
**Board: KinCony KC868-A16** — ESP32 (WiFi), **16 opto-isolated inputs**, 12/24 V,
DIN-rail (~₹3,500). Runs our firmware.

**⚠️ Measure one machine before ordering the fleet.** The KC868-A16 inputs are
**"dry contact"** — they trigger when the input is connected to **COMMON**, not by
an applied voltage. This works **only if the panel alarm terminals are ACTIVE-LOW**
(they pull the terminal down to T22 when active — likely, since T22 is the −12 V
common). With a meter (black on T22, red on a signal terminal): if the terminal
reads **~0 V when active** → active-low → **KC868-A16 works**. If it reads
**+12/24 V when active** → active-high → we need a **voltage-input ("wet") board**
instead (tell the software person and we'll swap the board).

## Notes
- The **input order above (IN1…IN10) is what the firmware expects.** If your board
  labels its inputs differently, keep the *order* the same, or tell the software
  person the actual labels so the firmware pin map is updated.
- Tap either at the controller's back terminals **or** the matching terminal block
  in the machine's base distribution box — same terminal numbers.
- After wiring: power on → the machine appears live on the MES dashboard within
  seconds. If it doesn't, check T22→COM and the board power first.

---
*Terminal numbers refer to the XH-600S controller (see the printed legend on the
back of the controller / distribution box).*
