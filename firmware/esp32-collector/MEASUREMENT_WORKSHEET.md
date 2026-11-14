# ESP32 Collector — Bench Measurement Worksheet (XH-600S)

**Machine ID:** ____________  **Date:** ____________  **Measured by:** ____________

Do this ONCE per machine model before soldering. It gives you two things per signal:
the **resistor value** and the **optocoupler wiring direction** — plus the count
**pulses-per-revolution** for RPM.

---

## ⚠️ Safety first
- The machine must be **powered ON** (you need live signals to measure).
- Set the multimeter to **DC Volts (V⎓)**, range 200 V or auto.
- **Stay away from the mains terminals** — `01` / `09` = 220 V, `02` = 110 V. This
  worksheet only touches the low-voltage signal terminals (07, 08, 16, 21–34) and 22.
- You are only **measuring** here — nothing is connected to the ESP32 yet.

## Step 1 — Anchor the reference
1. Put the **BLACK** probe on terminal **22 (−12V common)** and keep it there for
   every reading below.
2. All voltages are measured **red probe on the signal terminal, black on 22.**

## Step 2 — Measure each signal in BOTH states
For each terminal, record the voltage when the signal is **INACTIVE** and when
**ACTIVE**. How to force each state:
- **07 red / 08 yellow / 16 green:** stop the machine (red/yellow active), run it
  (green pulses on a roll-complete), running (red/yellow inactive).
- **23 count:** while running, the meter reading will **flicker** — note the higher
  (pulse) voltage.
- **21/29/25/24/28/34 faults:** trip each one if you safely can (open the safety
  door for 24, etc.), otherwise record the idle reading and mark polarity later.

| Term | Signal | INACTIVE (V) | ACTIVE (V) | Active voltage | Polarity | Resistor |
|---|---|---|---|---|---|---|
| 23 | count pulse | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 16 | green (roll) | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 07 | red (stop) | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 08 | yellow (stop) | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 21 | upper yarn | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 29 | center yarn | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 25 | oil shortage | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 24 | safety door | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 28 | needle | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |
| 34 | cloth | ______ | ______ | ______ | ⬜ high ⬜ low | ⬜ 1k ⬜ 2.2k |

### How to fill the last three columns
- **Active voltage** = the *bigger* of the two readings (ignore the sign). This is the
  swing the opto LED sees.
- **Polarity:**
  - Sits near **0 V** when inactive, jumps to **+12/+24 V** when active → **HIGH**.
  - Sits at **+12/+24 V** when inactive, drops to **~0 V** when active → **LOW**.
- **Resistor** from the active voltage: **~12 V → 1 kΩ**, **~24 V → 2.2 kΩ**
  (formula: R = (V − 1.2) / 0.01, aim ~10 mA).

## Step 3 — Count pulses-per-revolution (for RPM)
Pick ONE method:
- **Meter has Hz mode:** run the machine, measure the pulse **frequency (Hz)** on 23,
  and read the **RPM** off the panel's 轉速表 display.
  `PULLS_PER_REV = (Hz × 60) ÷ panel_RPM`  → **PULLS_PER_REV = ________**
- **No Hz mode:** slowly **jog** the cylinder exactly **one full revolution** and count
  how many times terminal 23 pulses (meter flickers / counter ticks).
  → **pulses in one rev = ________** (this is PULLS_PER_REV; often **1**)

*(Count/status/reasons all work even if you skip this — only the RPM number needs it.
Start with `PULLS_PER_REV = 1` and refine later.)*

---

## Step 4 — Wire each optocoupler so it conducts WHEN ACTIVE
This is the key rule. Always wire the opto so its LED **lights when the signal is
active** — then the firmware's `ACTIVE_LOW = true` is correct for every channel.

**ACTIVE-HIGH signal** (goes +V when active):
```
signal terminal ──[ R ]──►|(anode 1) PC817 (cathode 2)──── terminal 22
```

**ACTIVE-LOW signal** (drops to 0 V when active): flip the LED —
```
a +12V source (e.g. term 05) ──[ R ]──►|(anode 1) PC817 (cathode 2)──── signal terminal
```

Output side is identical for both: `PC817 collector (4) → ESP32 GPIO`,
`PC817 emitter (3) → ESP32 GND`.

## Step 5 — Transfer to firmware config
```
ACTIVE_LOW    = true        // always, if you wired opto to conduct-on-active (Step 4)
PULLS_PER_REV = ________    // from Step 3
```
Resistor per channel: use the value you ticked in the table. Buy 1k + 2.2k both;
this machine is likely all ~12 V (terminal 22 is −12V) → mostly 1k.

---

### Quick sanity checks
- If **every** signal reads ~12 V active → you're a 12 V machine → all **1 kΩ**, done.
- If terminal **22** doesn't read as a stable reference (readings jump wildly), try
  terminal **06 (L 0V)** as the common instead.
- Count (23) reading won't sit still — that's correct, it's a pulse. The **peak** is
  what sets its resistor.
