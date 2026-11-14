/*
 * DHOWN MES - ESP32 Machine Collector  (WiFi + proximity sensor)
 * ---------------------------------------------------------------------------
 * PHASE 1 (now): an inductive proximity sensor on the rotating cylinder gives
 * one pulse per revolution -> count + RPM + run/stop, pushed to the MES over
 * WiFi. This is how the vendor's collector actually worked (Omron prox sensor,
 * not the XH-600S panel).
 *
 * PHASE 2 (later): set PANEL_SIGNALS to 1 and wire the panel fault terminals to
 * also capture stoppage reasons (and green -> roll cut). No other change needed.
 *
 * Keeps the resilience from the wired build: flash-persisted counters (survive
 * reboot) + offline event buffer (replay on reconnect) + watchdog.
 *
 * WIRING (Phase 1):
 *   prox sensor (NPN NO): brown->+12/24V  blue->GND(shared)  black(out)->PC817 K(2)
 *   +12/24V -> R(1k@12V / 2.2k@24V) -> PC817 A(1)
 *   PC817 collector(4) -> ESP32 IO4      PC817 emitter(3) -> ESP32 GND
 *   ESP32 powered from 5V USB (or a 12V->5V buck).
 *
 * Flash: Arduino IDE -> "ESP32 Dev Module" -> Upload. Serial @115200.
 * Needs ONLY the "esp32" core (WiFi is built in). No libraries.
 * ===========================================================================
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <Preferences.h>
#include "esp_task_wdt.h"

// ======================= PER-MACHINE CONFIG (edit these) =====================
#define MACHINE_ID    "SJ03"                 // MES machine_id this box is wired to
#define WIFI_SSID     "Tenda_F7F5E0"         // factory WiFi
#define WIFI_PASS     "admin@123"
#define MES_HOST      "192.168.1.252"        // MES PC (fixed DHCP lease)
#define MES_PORT      8090                   // DC_PORT
#define MES_PATH      "/api/live-data"
#define DC_API_KEY    "CHANGE_ME_MATCH_MES_ENV"

#define ACTIVE_LOW    true                   // prox NPN sinks -> GPIO reads LOW when target present
#define PULLS_PER_REV 1.0f                   // prox targets per revolution (usually 1)

#define PANEL_SIGNALS 1                       // 1 = FULL (count + roll + all alarms). 0 = count-only (bench/prox test).

#define FW_VERSION    "3.0.0"                 // 3.x = WiFi + proximity-sensor build
// ============================================================================

// ------------------------------- Pins ---------------------------------------
static const uint8_t PIN_COUNT = 4;    // proximity-sensor pulse (interrupt)
#if PANEL_SIGNALS
static const uint8_t PIN_GREEN  = 32;  // 16 roll (interrupt)
static const uint8_t PIN_RED    = 33;  // 07 stopped
static const uint8_t PIN_YELLOW = 25;  // 08 stopped
static const uint8_t PIN_UYARN  = 26;  // 21 upper yarn break
static const uint8_t PIN_CYARN  = 27;  // 29 center yarn break
static const uint8_t PIN_OIL    = 14;  // 25 oil shortage
static const uint8_t PIN_DOOR   = 13;  // 24 safety door
static const uint8_t PIN_NEEDLE = 17;  // 28 needle detect
static const uint8_t PIN_CLOTH  = 16;  // 34 cloth detect
static const uint8_t PIN_COLOR  = 21;  // 27 color-change fault
// static const uint8_t PIN_LOV = 22;  // 30 LOV — enable once its meaning is confirmed
// To add an alarm: wire it, add a line to REASONS below (label shown in downtime).
struct Reason { uint8_t pin; const char* label; };
Reason REASONS[] = {
  { PIN_UYARN,  "Upper yarn break"   }, { PIN_CYARN,  "Center yarn break" },
  { PIN_OIL,    "Oil shortage"       }, { PIN_DOOR,   "Safety door open"  },
  { PIN_NEEDLE, "Needle detect"      }, { PIN_CLOTH,  "Cloth detect"      },
  { PIN_COLOR,  "Color-change fault" },
};
const int N_REASONS = sizeof(REASONS) / sizeof(REASONS[0]);
#endif

// ---------------------------- Tunables --------------------------------------
static const uint32_t POST_INTERVAL_MS    = 5000;
static const uint32_t SAMPLE_MS           = 20;
static const uint8_t  DEBOUNCE_SAMPLES    = 3;
static const uint32_t PULSE_DEBOUNCE_US   = 1500;
static const uint32_t STOP_TIMEOUT_MS     = 8000;   // no pulse this long -> rpm 0 (= STOPPED)
static const uint32_t WDT_TIMEOUT_S       = 20;
static const uint32_t PERSIST_INTERVAL_MS = 60000;  // flash-save counters at most this often
static const int      EVENT_BUF_N         = 40;

// ---------------------------- Interrupt state -------------------------------
volatile uint32_t g_count = 0;             // cumulative revolutions
volatile uint32_t g_rolls = 0;             // cumulative doffs (only used if PANEL_SIGNALS)
volatile uint32_t g_lastPulseUs = 0;
volatile uint32_t g_lastCountMs = 0;
volatile uint32_t g_pulseGapMs  = 0;

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

#if PANEL_SIGNALS
volatile uint32_t g_lastGreenUs = 0;
void IRAM_ATTR isrGreen() {
  uint32_t nowUs = micros();
  if (nowUs - g_lastGreenUs > PULSE_DEBOUNCE_US) { g_rolls++; g_lastGreenUs = nowUs; }
}
struct Debounced { uint8_t pin; bool stable; uint8_t agree; };
Debounced dRed{PIN_RED,false,0}, dYellow{PIN_YELLOW,false,0};
Debounced dReason[N_REASONS];   // pins filled from REASONS in setup()
bool activeRead(uint8_t pin) { int raw = digitalRead(pin); return ACTIVE_LOW ? (raw == LOW) : (raw == HIGH); }
void sample(Debounced &d) {
  bool now = activeRead(d.pin);
  if (now == d.stable) { d.agree = 0; return; }
  if (++d.agree >= DEBOUNCE_SAMPLES) { d.stable = now; d.agree = 0; }
}
const char* activeReason() { for (int i = 0; i < N_REASONS; i++) if (dReason[i].stable) return REASONS[i].label; return ""; }
#else
const char* activeReason() { return ""; }
#endif

// ---------------------------- RPM -------------------------------------------
float currentRpm() {
#if PANEL_SIGNALS
  if (dRed.stable || dYellow.stable) return 0;          // stop lamp lit -> stopped now
#endif
  if (g_lastCountMs == 0) return 0;
  if (millis() - g_lastCountMs > STOP_TIMEOUT_MS) return 0;
  uint32_t gap = g_pulseGapMs;
  if (gap == 0) return 0;
  return (60000.0f / (float)gap) / PULLS_PER_REV;
}

// ---------------------------- Persistence (flash / NVS) ---------------------
Preferences prefs;
uint32_t g_lastPersistMs = 0;
void loadCounters() {
  prefs.begin("dhown", false);
  g_count = prefs.getUInt("count", 0);
  g_rolls = prefs.getUInt("rolls", 0);
  Serial.printf("[nvs] restored count=%u rolls=%u\n", g_count, g_rolls);
}
void persistCounters() {
  uint32_t now = millis();
  if (now - g_lastPersistMs < PERSIST_INTERVAL_MS) return;
  g_lastPersistMs = now;
  noInterrupts(); uint32_t c = g_count, r = g_rolls; interrupts();
  prefs.putUInt("count", c); prefs.putUInt("rolls", r);
}

// ---------------------------- Offline event buffer --------------------------
struct Evt { uint32_t at; float rpm; uint32_t counter; uint32_t rolls; char reason[24]; };
Evt g_buf[EVENT_BUF_N];
int g_bufHead = 0, g_bufCount = 0;
void bufferEvent(float rpm, uint32_t counter, uint32_t rolls, const char* reason) {
  Evt &e = g_buf[(g_bufHead + g_bufCount) % EVENT_BUF_N];
  e.at = millis(); e.rpm = rpm; e.counter = counter; e.rolls = rolls;
  strncpy(e.reason, reason ? reason : "", sizeof(e.reason) - 1);
  e.reason[sizeof(e.reason) - 1] = '\0';
  if (g_bufCount < EVENT_BUF_N) g_bufCount++;
  else g_bufHead = (g_bufHead + 1) % EVENT_BUF_N;
}

// ---------------------------- WiFi ------------------------------------------
bool online() { return WiFi.status() == WL_CONNECTED; }
uint32_t g_lastWifiTry = 0;
void bringUpWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname("dhown-" MACHINE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[wifi] connecting");
}
void wifiTick() {                              // nudge reconnect if it stays down
  if (online()) return;
  uint32_t now = millis();
  if (now - g_lastWifiTry > 5000) { g_lastWifiTry = now; WiFi.reconnect(); }
}

// ---------------------------- POST ------------------------------------------
WiFiClient g_client;
bool sendReading(float rpm, uint32_t counter, uint32_t rolls, const char* reason, uint32_t ageMs) {
  if (!online()) return false;
  char body[360];
#if PANEL_SIGNALS
  int n = snprintf(body, sizeof(body),
    "{\"machine_id\":\"%s\",\"rpm\":%.1f,\"dc_status\":\"online\","
    "\"production_counter\":%u,\"stoppage_reason\":\"%s\",\"rolls\":%u,\"age_s\":%u,\"fw\":\"%s\"}",
    MACHINE_ID, rpm, counter, reason ? reason : "", rolls, ageMs / 1000, FW_VERSION);
#else
  (void)rolls; (void)reason;
  int n = snprintf(body, sizeof(body),
    "{\"machine_id\":\"%s\",\"rpm\":%.1f,\"dc_status\":\"online\","
    "\"production_counter\":%u,\"age_s\":%u,\"fw\":\"%s\"}",
    MACHINE_ID, rpm, counter, ageMs / 1000, FW_VERSION);
#endif

  if (!g_client.connect(MES_HOST, MES_PORT, 3000)) { Serial.println("[post] connect failed"); return false; }
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
  Serial.begin(115200); delay(300);
  Serial.printf("\nDHOWN collector %s fw %s (WiFi + prox, PANEL_SIGNALS=%d)\n", MACHINE_ID, FW_VERSION, PANEL_SIGNALS);

  pinMode(PIN_COUNT, INPUT_PULLUP);
#if PANEL_SIGNALS
  pinMode(PIN_GREEN, INPUT_PULLUP);
  pinMode(PIN_RED, INPUT_PULLUP);    pinMode(PIN_YELLOW, INPUT_PULLUP);
  for (int i = 0; i < N_REASONS; i++) {           // all alarm pins + build debounce list
    pinMode(REASONS[i].pin, INPUT_PULLUP);
    dReason[i].pin = REASONS[i].pin; dReason[i].stable = false; dReason[i].agree = 0;
  }
#endif

  loadCounters();

  attachInterrupt(PIN_COUNT, isrCount, ACTIVE_LOW ? FALLING : RISING);
#if PANEL_SIGNALS
  attachInterrupt(PIN_GREEN, isrGreen, ACTIVE_LOW ? FALLING : RISING);
#endif

  bringUpWiFi();
  setupWatchdog();
}

uint32_t g_lastSample = 0, g_lastPost = 0;
bool     g_prevStopped = false;
char     g_prevReason[24] = "";
void markState(bool stopped, const char* reason) {
  g_prevStopped = stopped;
  strncpy(g_prevReason, reason ? reason : "", sizeof(g_prevReason) - 1);
  g_prevReason[sizeof(g_prevReason) - 1] = '\0';
}

void loop() {
  esp_task_wdt_reset();
  uint32_t now = millis();
  wifiTick();

#if PANEL_SIGNALS
  if (now - g_lastSample >= SAMPLE_MS) {
    g_lastSample = now;
    sample(dRed); sample(dYellow);
    for (int i = 0; i < N_REASONS; i++) sample(dReason[i]);
  }
#endif

  persistCounters();

  noInterrupts(); uint32_t counter = g_count, rolls = g_rolls; interrupts();
  float rpm = currentRpm();
  const char* reason = (rpm == 0) ? activeReason() : "";
  bool stoppedNow = (rpm == 0);
  bool changed = (stoppedNow != g_prevStopped) || (strcmp(reason, g_prevReason) != 0);

  // OFFLINE: snapshot each transition for replay on reconnect.
  if (!online()) {
    if (changed) { bufferEvent(rpm, counter, rolls, reason); markState(stoppedNow, reason); }
    return;
  }

  // ONLINE: drain buffered offline events first (oldest first, one per loop).
  if (g_bufCount > 0) {
    Evt &e = g_buf[g_bufHead];
    if (sendReading(e.rpm, e.counter, e.rolls, e.reason, now - e.at)) {
      g_bufHead = (g_bufHead + 1) % EVENT_BUF_N; g_bufCount--;
    }
    return;
  }

  // ONLINE, buffer empty: heartbeat OR on-change post.
  if (now - g_lastPost >= POST_INTERVAL_MS || changed) {
    markState(stoppedNow, reason);
    g_lastPost = now;
    postStatus();
  }
}
