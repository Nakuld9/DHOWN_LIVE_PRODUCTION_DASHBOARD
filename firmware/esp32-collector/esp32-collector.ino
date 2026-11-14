/*
 * DHOWN MES - ESP32 Machine Collector  (XH-600S circular knitting machine)
 * ---------------------------------------------------------------------------
 * Reads machine signals through PC817 optocouplers and POSTs live status to
 * the MES data-collector ingest (POST /api/live-data on DC_PORT 8090) over
 * wired Ethernet (W5500). One ESP32 per machine. Replaces the Yindu collector.
 *
 * NETWORKING: uses the ESP32 core's BUILT-IN W5500 driver (ETH.h) -- no
 * external Ethernet library to install. Requires the W5500 INT pin wired.
 *
 * SERVER CONTRACT (matches src/routes/live-data.routes.js exactly):
 *   POST http://<MES_HOST>:8090/api/live-data
 *   header  x-api-key: <DC_API_KEY>            (must equal DC_API_KEY in backend/.env)
 *   body    { machine_id, rpm, dc_status:"online", production_counter, stoppage_reason }
 *   - server derives RUNNING/STOPPED from rpm (>0 = RUNNING) -> we compute rpm from count
 *   - production_counter is CUMULATIVE; server computes the delta and kg itself
 *   - stoppage_reason (optional) fills the auto-downtime reason instead of 'Reason Pending'
 *
 * W5500 wiring (SPI + interrupt):
 *   SCK->IO18  MISO->IO19  MOSI->IO23  CS->IO5  INT->IO35  VCC->3V3/5V  GND->GND
 *
 * Signal taps (through PC817 optocouplers, all cathodes -> terminal 22):
 *   23 count  -> IO4   interrupt   : revolutions -> production_counter + rpm
 *   16 green  -> IO32  interrupt   : ROLL COMPLETE (doff) momentary pulse -> rolls (extra)
 *   07 red    -> IO33  level       : stopped indicator
 *   08 yellow -> IO25  level       : stopped indicator
 *   21 upper yarn  -> IO26  level  : reason
 *   29 center yarn -> IO27  level  : reason
 *   25 oil         -> IO14  level  : reason
 *   24 door        -> IO13  level  : reason
 *   28 needle      -> IO17  level  : reason
 *   34 cloth       -> IO16  level  : reason
 *   22 (-12V)      -> GND         : common reference
 *
 * Flash: Arduino IDE -> Board "ESP32 Dev Module" -> Upload. Serial @115200.
 * Requires ONLY the "esp32 by Espressif" core. No libraries to install.
 * ===========================================================================
 */

#include <ETH.h>
#include <SPI.h>
#include <NetworkClient.h>
#include <Preferences.h>
#include "esp_task_wdt.h"

// ======================= PER-MACHINE CONFIG (edit these) =====================
#define MACHINE_ID   "SJ03"                 // MES machine_id this box is wired to
#define MES_HOST     "192.168.2.50"         // MES PC (fixed DHCP lease)
#define MES_PORT     8090                   // DC_PORT (data-collector ingest)
#define MES_PATH     "/api/live-data"
#define DC_API_KEY   "CHANGE_ME_MATCH_MES_ENV"   // == DC_API_KEY in backend/.env

// true  = signal terminal goes to +V when active (opto LED lit)  -> GPIO reads LOW
// false = signal terminal goes to 0V when active                 -> GPIO reads HIGH
// SET FROM YOUR MULTIMETER MEASUREMENT.
#define ACTIVE_LOW   true

#define FW_VERSION   "2.0.0"                 // 2.0.x = edge store-and-forward (flash counters + offline buffer)
// ============================================================================

// -------------------------- W5500 (built-in ETH) ----------------------------
#define ETH_PHY_TYPE  ETH_PHY_W5500
#define ETH_PHY_ADDR  1
#define ETH_PHY_CS    5
#define ETH_PHY_IRQ   35     // W5500 INT -> IO35 (input-only pin, fine for IRQ)
#define ETH_PHY_RST   -1     // not wired
#define ETH_SPI_SCK   18
#define ETH_SPI_MISO  19
#define ETH_SPI_MOSI  23

// ------------------------------- Signal pins --------------------------------
static const uint8_t PIN_COUNT  = 4;    // 23 count   (interrupt)
static const uint8_t PIN_GREEN  = 32;   // 16 roll    (interrupt)
static const uint8_t PIN_RED    = 33;   // 07 stopped
static const uint8_t PIN_YELLOW = 25;   // 08 stopped
static const uint8_t PIN_UYARN  = 26;   // 21 upper yarn break
static const uint8_t PIN_CYARN  = 27;   // 29 center yarn break
static const uint8_t PIN_OIL    = 14;   // 25 oil shortage
static const uint8_t PIN_DOOR   = 13;   // 24 safety door
static const uint8_t PIN_NEEDLE = 17;   // 28 needle detect
static const uint8_t PIN_CLOTH  = 16;   // 34 cloth detect

// Fault pin -> human-readable reason (stored in the downtime record). First active wins.
struct Reason { uint8_t pin; const char* label; };
Reason REASONS[] = {
  { PIN_UYARN,  "Upper yarn break"  },
  { PIN_CYARN,  "Center yarn break" },
  { PIN_OIL,    "Oil shortage"      },
  { PIN_DOOR,   "Safety door open"  },
  { PIN_NEEDLE, "Needle detect"     },
  { PIN_CLOTH,  "Cloth detect"      },
};
const int NUM_REASONS = sizeof(REASONS) / sizeof(REASONS[0]);

// ---------------------------- Tunables --------------------------------------
static const uint32_t POST_INTERVAL_MS = 5000;   // heartbeat cadence
static const uint32_t SAMPLE_MS        = 20;     // level-pin poll
static const uint8_t  DEBOUNCE_SAMPLES = 3;      // stable reads to accept a level
static const uint32_t PULSE_DEBOUNCE_US= 1500;   // ignore contact bounce on pulses
static const float    PULSES_PER_REV   = 1.0f;   // <-- MEASURE: pulses on term 23 per revolution
static const uint32_t STOP_TIMEOUT_MS  = 8000;   // no pulse this long -> rpm 0 (=> STOPPED)
static const uint32_t WDT_TIMEOUT_S    = 20;
static const uint32_t PERSIST_INTERVAL_MS = 60000;  // flash-save counters at most this often (flash wear)
static const int      EVENT_BUF_N         = 40;     // offline event ring-buffer depth

// ---------------------------- Interrupt state -------------------------------
volatile uint32_t g_count = 0;             // cumulative revolutions (production_counter)
volatile uint32_t g_rolls = 0;             // cumulative doffs (green pulses) — extra field
volatile uint32_t g_lastPulseUs = 0;
volatile uint32_t g_lastGreenUs = 0;
volatile uint32_t g_lastCountMs = 0;       // millis() of last count pulse
volatile uint32_t g_pulseGapMs  = 0;       // ms between the last two count pulses (for rpm)

void IRAM_ATTR isrCount() {
  uint32_t nowUs = micros();
  if (nowUs - g_lastPulseUs > PULSE_DEBOUNCE_US) {
    uint32_t nowMs = millis();
    if (g_lastCountMs != 0) g_pulseGapMs = nowMs - g_lastCountMs;
    g_count++;
    g_lastPulseUs = nowUs;
    g_lastCountMs = nowMs;
  }
}
void IRAM_ATTR isrGreen() {
  uint32_t nowUs = micros();
  if (nowUs - g_lastGreenUs > PULSE_DEBOUNCE_US) {
    g_rolls++;
    g_lastGreenUs = nowUs;
  }
}

// ---------------------------- Level debouncing ------------------------------
struct Debounced { uint8_t pin; bool stable; uint8_t agree; };
Debounced dRed{PIN_RED,false,0}, dYellow{PIN_YELLOW,false,0};
Debounced dReason[6] = {
  {PIN_UYARN,false,0},{PIN_CYARN,false,0},{PIN_OIL,false,0},
  {PIN_DOOR,false,0},{PIN_NEEDLE,false,0},{PIN_CLOTH,false,0}
};

bool activeRead(uint8_t pin) {              // accounts for ACTIVE_LOW wiring
  int raw = digitalRead(pin);
  return ACTIVE_LOW ? (raw == LOW) : (raw == HIGH);
}
void sample(Debounced &d) {
  bool now = activeRead(d.pin);
  if (now == d.stable) { d.agree = 0; return; }
  if (++d.agree >= DEBOUNCE_SAMPLES) { d.stable = now; d.agree = 0; }
}

// ---------------------------- RPM -------------------------------------------
// rpm from the gap between the last two count pulses; forced to 0 if the machine
// has been quiet longer than STOP_TIMEOUT_MS, OR immediately if a stop lamp
// (red/yellow, T07/T08) is lit — the lamp gives instant stop detection instead
// of waiting out the count timeout. Server derives STOPPED from rpm==0.
float currentRpm() {
  if (dRed.stable || dYellow.stable) return 0;          // stop lamp lit -> stopped now
  if (g_lastCountMs == 0) return 0;
  if (millis() - g_lastCountMs > STOP_TIMEOUT_MS) return 0;
  uint32_t gap = g_pulseGapMs;
  if (gap == 0) return 0;
  return (60000.0f / (float)gap) / PULSES_PER_REV;
}

// ---------------------------- Reason ----------------------------------------
const char* activeReason() {                // first active fault, else ""
  for (int i = 0; i < 6; i++) if (dReason[i].stable) return REASONS[i].label;
  return "";
}

// ---------------------------- Ethernet (ETH.h) ------------------------------
volatile bool g_ethUp = false;

void onNetEvent(arduino_event_id_t event) {
  switch (event) {
    case ARDUINO_EVENT_ETH_START:        ETH.setHostname("dhown-" MACHINE_ID); break;
    case ARDUINO_EVENT_ETH_CONNECTED:    Serial.println("[eth] link up"); break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      Serial.print("[eth] got IP "); Serial.println(ETH.localIP());
      g_ethUp = true; break;
    case ARDUINO_EVENT_ETH_DISCONNECTED: Serial.println("[eth] link DOWN"); g_ethUp = false; break;
    case ARDUINO_EVENT_ETH_STOP:         g_ethUp = false; break;
    default: break;
  }
}
void bringUpEthernet() {
  Network.onEvent(onNetEvent);
  SPI.begin(ETH_SPI_SCK, ETH_SPI_MISO, ETH_SPI_MOSI);
  ETH.begin(ETH_PHY_TYPE, ETH_PHY_ADDR, ETH_PHY_CS, ETH_PHY_IRQ, ETH_PHY_RST, SPI);
}

// ---------------------------- Persistence (flash / NVS) ---------------------
// Cumulative counters are saved to flash so a reboot resumes them instead of
// resetting to 0 — no un-sent production is lost across a power blip / crash.
Preferences prefs;
uint32_t g_lastPersistMs = 0;

void loadCounters() {
  prefs.begin("dhown", false);
  g_count = prefs.getUInt("count", 0);
  g_rolls = prefs.getUInt("rolls", 0);
  Serial.printf("[nvs] restored count=%u rolls=%u\n", g_count, g_rolls);
}
void persistCounters() {                       // throttled to protect flash wear
  uint32_t now = millis();
  if (now - g_lastPersistMs < PERSIST_INTERVAL_MS) return;
  g_lastPersistMs = now;
  noInterrupts(); uint32_t c = g_count, r = g_rolls; interrupts();
  prefs.putUInt("count", c);
  prefs.putUInt("rolls", r);
}

// ---------------------------- Offline event buffer --------------------------
// While the network/MES is down, each run/stop or reason CHANGE is snapshotted
// into a ring buffer; on reconnect they're replayed oldest-first (with age_s),
// so a stop that started AND ended during the outage isn't lost. Cumulative
// count/rolls already survive an outage via the counter itself; this preserves
// the transient events. Bounded — oldest drops if it fills.
struct Evt { uint32_t at; float rpm; uint32_t counter; uint32_t rolls; char reason[24]; };
Evt g_buf[EVENT_BUF_N];
int g_bufHead = 0, g_bufCount = 0;

void bufferEvent(float rpm, uint32_t counter, uint32_t rolls, const char* reason) {
  Evt &e = g_buf[(g_bufHead + g_bufCount) % EVENT_BUF_N];
  e.at = millis(); e.rpm = rpm; e.counter = counter; e.rolls = rolls;
  strncpy(e.reason, reason ? reason : "", sizeof(e.reason) - 1);
  e.reason[sizeof(e.reason) - 1] = '\0';
  if (g_bufCount < EVENT_BUF_N) g_bufCount++;
  else g_bufHead = (g_bufHead + 1) % EVENT_BUF_N;   // full -> overwrite oldest
}

// ---------------------------- POST ------------------------------------------
NetworkClient g_client;

// Send one reading. ageMs>0 = a buffered offline event being replayed; the
// age_s field lets the server know how long ago it happened (a live post = 0).
bool sendReading(float rpm, uint32_t counter, uint32_t rolls, const char* reason, uint32_t ageMs) {
  if (!g_ethUp) return false;
  char body[360];
  int n = snprintf(body, sizeof(body),
    "{\"machine_id\":\"%s\",\"rpm\":%.1f,\"dc_status\":\"online\","
    "\"production_counter\":%u,\"stoppage_reason\":\"%s\",\"rolls\":%u,\"age_s\":%u,\"fw\":\"%s\"}",
    MACHINE_ID, rpm, counter, reason ? reason : "", rolls, ageMs / 1000, FW_VERSION);

  if (!g_client.connect(MES_HOST, MES_PORT, 3000)) {
    Serial.println("[post] connect failed");
    return false;
  }
  g_client.printf("POST %s HTTP/1.1\r\n", MES_PATH);
  g_client.printf("Host: %s\r\n", MES_HOST);
  g_client.printf("x-api-key: %s\r\n", DC_API_KEY);
  g_client.print("Content-Type: application/json\r\n");
  g_client.printf("Content-Length: %d\r\n", n);
  g_client.print("Connection: close\r\n\r\n");
  g_client.print(body);

  uint32_t t0 = millis(); String status = "";
  while (g_client.connected() && millis() - t0 < 3000) {
    if (g_client.available()) { status = g_client.readStringUntil('\n'); break; }
  }
  g_client.stop();
  Serial.printf("[post] %s -> %s\n", body, status.length() ? status.c_str() : "(timeout)");
  return status.indexOf("200") > 0;
}

// Live post of the current state (age 0).
bool postStatus() {
  noInterrupts(); uint32_t counter = g_count, rolls = g_rolls; interrupts();
  float rpm = currentRpm();
  const char* reason = (rpm == 0) ? activeReason() : "";
  return sendReading(rpm, counter, rolls, reason, 0);
}

// ---------------------------- Watchdog --------------------------------------
void setupWatchdog() {
  esp_task_wdt_config_t cfg = { .timeout_ms = WDT_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&cfg);
  esp_task_wdt_add(NULL);
}

// ---------------------------- Setup / Loop ----------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\nDHOWN collector %s fw %s (ETH.h/W5500 -> /api/live-data)\n", MACHINE_ID, FW_VERSION);

  pinMode(PIN_COUNT, INPUT_PULLUP);  pinMode(PIN_GREEN, INPUT_PULLUP);
  pinMode(PIN_RED, INPUT_PULLUP);    pinMode(PIN_YELLOW, INPUT_PULLUP);
  pinMode(PIN_UYARN, INPUT_PULLUP);  pinMode(PIN_CYARN, INPUT_PULLUP);
  pinMode(PIN_OIL, INPUT_PULLUP);    pinMode(PIN_DOOR, INPUT_PULLUP);
  pinMode(PIN_NEEDLE, INPUT_PULLUP); pinMode(PIN_CLOTH, INPUT_PULLUP);

  loadCounters();                 // restore cumulative count/rolls from flash

  attachInterrupt(PIN_COUNT, isrCount, ACTIVE_LOW ? FALLING : RISING);
  attachInterrupt(PIN_GREEN, isrGreen, ACTIVE_LOW ? FALLING : RISING);

  bringUpEthernet();
  setupWatchdog();
}

uint32_t g_lastSample = 0, g_lastPost = 0;
bool     g_prevStopped = false;
char     g_prevReason[24] = "";

// Update the change-tracking baseline to the current reading.
void markState(bool stopped, const char* reason) {
  g_prevStopped = stopped;
  strncpy(g_prevReason, reason ? reason : "", sizeof(g_prevReason) - 1);
  g_prevReason[sizeof(g_prevReason) - 1] = '\0';
}

void loop() {
  esp_task_wdt_reset();
  uint32_t now = millis();

  if (now - g_lastSample >= SAMPLE_MS) {
    g_lastSample = now;
    sample(dRed); sample(dYellow);
    for (int i = 0; i < 6; i++) sample(dReason[i]);
  }

  persistCounters();              // throttled flash save (survives reboot)

  // Current snapshot + change detection (run/stop flip OR reason change).
  noInterrupts(); uint32_t counter = g_count, rolls = g_rolls; interrupts();
  float rpm = currentRpm();
  const char* reason = (rpm == 0) ? activeReason() : "";
  bool stoppedNow = (rpm == 0);
  bool changed = (stoppedNow != g_prevStopped) || (strcmp(reason, g_prevReason) != 0);

  // OFFLINE: can't send — snapshot each transition for replay on reconnect.
  if (!g_ethUp) {
    if (changed) { bufferEvent(rpm, counter, rolls, reason); markState(stoppedNow, reason); }
    return;
  }

  // ONLINE: drain buffered offline events first (oldest first, one per loop),
  // so history is replayed before resuming live posts.
  if (g_bufCount > 0) {
    Evt &e = g_buf[g_bufHead];
    if (sendReading(e.rpm, e.counter, e.rolls, e.reason, now - e.at)) {
      g_bufHead = (g_bufHead + 1) % EVENT_BUF_N;
      g_bufCount--;
    }
    return;                       // one network op per loop iteration
  }

  // ONLINE, buffer empty: heartbeat interval OR immediate post on state change
  // (red/yellow lamp lights, or motion resumes) for near-instant stop detection.
  if (now - g_lastPost >= POST_INTERVAL_MS || changed) {
    markState(stoppedNow, reason);
    g_lastPost = now;
    postStatus();
  }
}
