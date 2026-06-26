/*
 * ═══════════════════════════════════════════════════════════════════
 *  Restaurant NFC System — ESP32-S3 Table Module (LCD only)
 * ═══════════════════════════════════════════════════════════════════
 *  Hardware:
 *    - ESP32-S3-WROOM-1
 *    - QAPASS 1602A HD44780 LCD (16-pin direct, 4-bit mode)
 *
 *  NFC is handled by passive NTAG stickers written via NFC Tools app.
 *  This firmware handles WiFi, WebSocket, and LCD status display only.
 *
 *  REQUIRED ARDUINO LIBRARIES (install via Library Manager):
 *    - "WebSockets"   by Markus Sattler (arduinoWebSockets)
 *    - "ArduinoJson"  by Benoit Blanchon
 *    - "LiquidCrystal" bundled with Arduino (no install needed)
 * ═══════════════════════════════════════════════════════════════════
 */

#include <LiquidCrystal.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "esp_system.h"

// ─── USER CONFIGURATION (edit per table) ──────────────────────────
#define WIFI_SSID       "Home 2.4GHz"
#define WIFI_PASSWORD   "genti123"
#define RENDER_HOST     "easyorder-19ze.onrender.com"
#define RENDER_PORT     443
#define TABLE_ID        1                  // unique integer per table
#define DEBUG_INTERVAL_MS 10000
#define WIFI_RETRY_INTERVAL_MS 5000
#define WIFI_WATCHDOG_RESTART_MS 180000
#define WS_REINIT_INTERVAL_MS 30000
#define WS_STATE_LOG_INTERVAL_MS 15000
#define ENABLE_RUNTIME_STATS 0
#define LCD_BACKLIGHT_PIN -1
#define LCD_BACKLIGHT_ACTIVE_HIGH 1
#define LCD_BACKLIGHT_ON_MS 25000
// ──────────────────────────────────────────────────────────────────

// ─── HARDWARE PINS ────────────────────────────────────────────────
// LCD (4-bit)
#define LCD_RS      4
#define LCD_E       5
#define LCD_D4      6
#define LCD_D5      7
#define LCD_D6      15
#define LCD_D7      16
#define LCD_COLS    16
#define LCD_ROWS    2
// ──────────────────────────────────────────────────────────────────

// ─── OBJECTS ─────────────────────────────────────────────────────
LiquidCrystal    lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);
WebSocketsClient wsClient;

// ─── STATE ─────────────────────────────────────────────────────
bool     wsConnected = false;
unsigned long bootMs = 0;
unsigned long wifiDisconnectedSinceMs = 0;
unsigned long lastWifiRetryMs = 0;
unsigned long lastWsReinitMs = 0;
unsigned long lastWsStateLogMs = 0;
bool wsClientInitialized = false;
unsigned long lcdBacklightUntilMs = 0;
unsigned long phoneMsgUntil = 0;

// Runtime counters
uint32_t wsRxMessages = 0;
uint32_t wsTxMessages = 0;
uint32_t wsRxBytes = 0;
uint32_t wsTxBytes = 0;

void printRuntimeStats() {
  const uint32_t freeHeap  = ESP.getFreeHeap();
  const uint32_t minHeap   = ESP.getMinFreeHeap();
  const uint32_t uptimeSec = (millis() - bootMs) / 1000;

  Serial.println("[DBG] ================= Runtime Snapshot =================");
  Serial.printf("[DBG] uptime=%lus tableId=%d wsConnected=%s\n", uptimeSec, TABLE_ID, wsConnected ? "yes" : "no");
  Serial.printf("[DBG] heap_free=%u heap_min=%u\n", freeHeap, minHeap);
  Serial.printf("[DBG] ws_rx_msgs=%u ws_tx_msgs=%u ws_rx_bytes=%u ws_tx_bytes=%u\n", wsRxMessages, wsTxMessages, wsRxBytes, wsTxBytes);
  Serial.println("[DBG] ====================================================");
}

const char* resetReasonToStr(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:   return "POWERON";
    case ESP_RST_EXT:       return "EXTERNAL_PIN";
    case ESP_RST_SW:        return "SOFTWARE";
    case ESP_RST_PANIC:     return "PANIC";
    case ESP_RST_INT_WDT:   return "INT_WDT";
    case ESP_RST_TASK_WDT:  return "TASK_WDT";
    case ESP_RST_WDT:       return "OTHER_WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "UNKNOWN";
  }
}

// ─── LCD HELPER ──────────────────────────────────────────────────
void setLcdBacklight(bool on) {
#if LCD_BACKLIGHT_PIN >= 0
  digitalWrite(LCD_BACKLIGHT_PIN, (on == (LCD_BACKLIGHT_ACTIVE_HIGH != 0)) ? HIGH : LOW);
#else
  (void)on;
#endif
}

void wakeLcdBacklight(unsigned long holdMs = LCD_BACKLIGHT_ON_MS) {
  if (holdMs == 0) holdMs = LCD_BACKLIGHT_ON_MS;
  setLcdBacklight(true);
  lcdBacklightUntilMs = millis() + holdMs;
}

void maintainLcdBacklight() {
  if (lcdBacklightUntilMs == 0) return;
  if ((long)(millis() - lcdBacklightUntilMs) >= 0) {
    lcdBacklightUntilMs = 0;
    setLcdBacklight(false);
  }
}

void updateLCD(const String& l1, const String& l2) {
  String line1 = l1.substring(0, LCD_COLS);
  String line2 = l2.substring(0, LCD_COLS);
  while (line1.length() < LCD_COLS) line1 += ' ';
  while (line2.length() < LCD_COLS) line2 += ' ';
  lcd.setCursor(0, 0); lcd.print(line1);
  lcd.setCursor(0, 1); lcd.print(line2);
}

// ─── WEBSOCKET EVENTS ─────────────────────────────────────────────
void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {

    case WStype_CONNECTED: {
      wsConnected = true;
      lastWsStateLogMs = millis();
      StaticJsonDocument<128> doc;
      doc["event"] = "esp32:register";
      doc["data"]["tableId"] = TABLE_ID;
      String msg; serializeJson(doc, msg);
      wsClient.sendTXT(msg);
      wsTxMessages++;
      wsTxBytes += msg.length();
      break;
    }

    case WStype_DISCONNECTED:
      wsConnected = false;
      break;

    case WStype_TEXT: {
      wsRxMessages++;
      wsRxBytes += length;
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, payload, length)) break;
      const char* event = doc["event"] | "";
      if (strcmp(event, "lcd:update") == 0) {
        String l1 = doc["data"]["line1"] | "Welcome!";
        String l2 = doc["data"]["line2"] | "Tap to order";
        wakeLcdBacklight();
        updateLCD(l1, l2);

      } else if (strcmp(event, "order:received") == 0) {
        float total = doc["data"]["total"] | 0.0f;
        char totalLine[17];
        snprintf(totalLine, sizeof(totalLine), "Total: EUR %.2f", total);
        phoneMsgUntil = 0;
        wakeLcdBacklight();
        updateLCD("Order confirmed!", String(totalLine));

      } else if (strcmp(event, "order:preparing") == 0) {
        phoneMsgUntil = 0;
        wakeLcdBacklight();
        updateLCD("In the kitchen", "Sit back & relax");

      } else if (strcmp(event, "order:ready") == 0) {
        phoneMsgUntil = 0;
        wakeLcdBacklight();
        updateLCD("Ready to serve!", "On its way to you");

      } else if (strcmp(event, "order:delivered") == 0) {
        phoneMsgUntil = millis() + 4000;
        wakeLcdBacklight();
        updateLCD("Thank you!", "Come back soon :)");
      }
      break;
    }

    default: break;
  }
}

void initWebSocketClient() {
  wsClient.disconnect();
  wsClient.beginSSL(RENDER_HOST, RENDER_PORT, "/esp32");
  wsClient.onEvent(onWsEvent);
  wsClient.setReconnectInterval(5000);
  wsClient.enableHeartbeat(15000, 3000, 2);
  wsClientInitialized = true;
  lastWsReinitMs = millis();
}

void maintainConnectivity() {
  const unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    wsConnected = false;
    if (wifiDisconnectedSinceMs == 0) {
      wifiDisconnectedSinceMs = now;
    }

    if (now - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMs = now;
      if (!WiFi.reconnect()) {
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    }

    if (now - wifiDisconnectedSinceMs >= WIFI_WATCHDOG_RESTART_MS) {
      delay(50);
      ESP.restart();
    }
    return;
  }

  if (wifiDisconnectedSinceMs != 0) {
    wifiDisconnectedSinceMs = 0;
  }

  if (!wsConnected) {
    if (!wsClientInitialized || (now - lastWsReinitMs >= WS_REINIT_INTERVAL_MS)) {
      initWebSocketClient();
      return;
    }

    if (now - lastWsStateLogMs >= WS_STATE_LOG_INTERVAL_MS) {
      lastWsStateLogMs = now;
    }
  }
}

// ─── SETUP ───────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);
  bootMs = millis();
  Serial.printf("\n[System] Table %d module booting\n", TABLE_ID);
  #if ENABLE_RUNTIME_STATS
  Serial.printf("[SYS] Reset reason: %s\n", resetReasonToStr(esp_reset_reason()));
  Serial.printf("[DBG] initial_heap=%u\n", ESP.getFreeHeap());
  #endif

  // ── LCD ──
#if LCD_BACKLIGHT_PIN >= 0
  pinMode(LCD_BACKLIGHT_PIN, OUTPUT);
  setLcdBacklight(true);
#endif
  lcd.begin(LCD_COLS, LCD_ROWS);
  updateLCD("Starting...", "Please wait");

  // ── WiFi ──
  updateLCD("Connecting WiFi", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  uint8_t tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries++ < 40) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    #if ENABLE_RUNTIME_STATS
    Serial.println("\n[WiFi] IP: " + WiFi.localIP().toString());
    #endif
    updateLCD("WiFi OK", WiFi.localIP().toString());
  } else {
    updateLCD("No WiFi!", "Offline mode");
  }
  delay(1200);

  // ── WebSocket ──
  initWebSocketClient();

  updateLCD("Welcome!", "Tap to order");
  wakeLcdBacklight(3500);
  Serial.println("[System] Ready!");
}

// ─── LOOP ────────────────────────────────────────────────────────
void loop() {
  wsClient.loop();
  maintainConnectivity();
  maintainLcdBacklight();

  if (phoneMsgUntil && millis() > phoneMsgUntil) {
    phoneMsgUntil = 0;
    updateLCD("Welcome!", "Tap to order");
  }

  #if ENABLE_RUNTIME_STATS
  static unsigned long lastStats = 0;
  if (millis() - lastStats >= DEBUG_INTERVAL_MS) {
    lastStats = millis();
    printRuntimeStats();
  }
  #endif
}
