/*
 * ═══════════════════════════════════════════════════════════════════
 *  Restaurant NFC System — ESP32-S3 Table Module
 * ═══════════════════════════════════════════════════════════════════
 *  Hardware:
 *    - ESP32-S3-WROOM-1
 *    - PN532 NFC module (SPI mode, SCK=12, MISO=13, MOSI=11, SS=10)
 *    - QAPASS 1602A HD44780 LCD (16-pin direct, 4-bit mode)
 *
 *  REQUIRED ARDUINO LIBRARIES (install via Library Manager):
 *    - "Seeed Arduino NFC"   by Seeed Studio   ← provides PN532, PN532_SPI
 *    - "WebSockets"          by Markus Sattler (arduinoWebSockets)
 *    - "ArduinoJson"         by Benoit Blanchon
 *    - "LiquidCrystal"       bundled with Arduino (no install needed)
 *
 *  ❌ DO NOT install "Adafruit PN532" — it does not support tag emulation.
 *  ❌ DO NOT install "LiquidCrystal_I2C" — this project uses direct wiring.
 *
 *  Behaviour:
 *    The PN532 emulates an ISO14443-4 Type-4 NDEF tag carrying a public
 *    GitHub Pages URL with backend query params. When a phone taps it the
 *    browser opens automatically (Android & iOS 13+).
 * ═══════════════════════════════════════════════════════════════════
 */

#include <Wire.h>
#include <PN532_I2C.h>
#include <PN532.h>
#include <LiquidCrystal.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "esp_heap_caps.h"
#include "esp_system.h"

// ─── USER CONFIGURATION (edit per table) ──────────────────────────
#define WIFI_SSID       "Home 2.4GHz"
#define WIFI_PASSWORD   "genti123"
#define RENDER_HOST     "easyorder-19ze.onrender.com"
#define RENDER_PORT     443
#define MENU_WEB_BASE   "https://gentiosmani.github.io/EasyOrder/"
#define TABLE_ID        1                  // unique integer per table
#define DEBUG_INTERVAL_MS 10000
#define WIFI_RETRY_INTERVAL_MS 5000
#define WIFI_WATCHDOG_RESTART_MS 180000
#define WS_REINIT_INTERVAL_MS 30000
#define WS_STATE_LOG_INTERVAL_MS 15000
#define ENABLE_RUNTIME_STATS 0
#define ENABLE_BOOT_DIAGNOSTICS 0
#define LCD_BACKLIGHT_PIN -1
#define LCD_BACKLIGHT_ACTIVE_HIGH 1
#define LCD_BACKLIGHT_ON_MS 25000
#define PN532_LOW_POWER_ENABLED 1
#define PN532_POWERDOWN_AFTER_IDLE_MS 2000
#define PN532_POWERDOWN_POLL_MS 60
// ──────────────────────────────────────────────────────────────────

// ─── HARDWARE PINS ────────────────────────────────────────────────
// PN532 (I2C)  SW1=OFF SW2=ON  — SDA=pin8  SCL=pin9  IRQ=pin12  RSTO=pin3
#define PN532_SDA    8
#define PN532_SCL    9
#define PN532_IRQ    12
#define PN532_RST    3
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
PN532_I2C        pn532i2c(Wire, PN532_IRQ);
PN532            nfc(pn532i2c);
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
unsigned long lastNfcActivityMs = 0;
bool pn532InLowPower = false;

// Runtime counters for production sizing
uint32_t wsRxMessages = 0;
uint32_t wsTxMessages = 0;
uint32_t wsRxBytes = 0;
uint32_t wsTxBytes = 0;
uint32_t nfcSessions = 0;
uint32_t nfcApduExchanges = 0;
uint32_t nfcRxBytes = 0;
uint32_t nfcTxBytes = 0;
uint32_t nfcReadSuccess = 0;

// ─── NFC TYPE-4 TAG EMULATION ────────────────────────────────────────────────
// NFC Forum Type 4 Tag: the PN532 presents itself as an ISO-DEP tag
// containing one NDEF record (a URI). Android and iOS read it and
// open the URL in the browser automatically, with NO app required.

// NDEF Application AID  (D2 76 00 00 85 01 01)
static const uint8_t NDEF_AID[]     = {0xD2,0x76,0x00,0x00,0x85,0x01,0x01};
static const uint8_t CC_FILE_ID[]   = {0xE1, 0x03};
static const uint8_t NDEF_FILE_ID[] = {0xE1, 0x04};

// CC (Capability Container) — 15 bytes, read-only
static const uint8_t CC_FILE[] = {
  0x00, 0x0F,   // CCLEN = 15
  0x20,         // Mapping Version 2.0
  0x00, 0x3B,   // MLe  = 59  (max R-APDU data size)
  0x00, 0x34,   // MLc  = 52  (max C-APDU data size)
  0x04,         // T = NDEF File Control TLV
  0x06,         // L = 6
  0xE1, 0x04,   // NDEF file identifier
  0x00, 0x7F,   // max NDEF file size = 127
  0x00,         // read  access = open
  0xFF          // write access = deny
};

// NDEF file storage:  [NLEN_H][NLEN_L][raw NDEF message]
static uint8_t  ndefFile[130];
static uint16_t ndefFileLen = 0;

// Which file the phone has SELECTed
enum NfcFile { FILE_NONE, FILE_CC, FILE_NDEF };
static NfcFile selectedFile = FILE_NONE;

// Build an NDEF URI record for `url` and store it in ndefFile[]
void nfcSetUrl(const char* url) {
  // Strip known prefixes (the URI record has a 1-byte prefix code)
  uint8_t prefixCode = 0x00;   // 0x00 = no abbreviation
  const char* body = url;
  if      (strncmp(url, "http://www.",  10) == 0) { prefixCode = 0x01; body = url+10; }
  else if (strncmp(url, "https://www.", 11) == 0) { prefixCode = 0x02; body = url+11; }
  else if (strncmp(url, "http://",       7) == 0) { prefixCode = 0x03; body = url+ 7; }
  else if (strncmp(url, "https://",      8) == 0) { prefixCode = 0x04; body = url+ 8; }

  uint8_t bodyLen = strlen(body);
  uint8_t payloadLen = 1 + bodyLen;   // prefix byte + URL body

  // Single NDEF record  (MB=1 ME=1 SR=1 TNF=001)
  uint8_t ndef[128];
  uint8_t i = 0;
  ndef[i++] = 0xD1;        // MB=1 ME=1 CF=0 SR=1 IL=0 TNF=001
  ndef[i++] = 0x01;        // Type length = 1
  ndef[i++] = payloadLen;  // Payload length
  ndef[i++] = 'U';         // Type = 'U'  (NFC Forum URI)
  ndef[i++] = prefixCode;
  memcpy(ndef + i, body, bodyLen);  i += bodyLen;

  uint16_t ndefLen = i;
  ndefFile[0] = (ndefLen >> 8) & 0xFF;
  ndefFile[1] =  ndefLen       & 0xFF;
  memcpy(ndefFile + 2, ndef, ndefLen);
  ndefFileLen = 2 + ndefLen;
}

void printRuntimeStats() {
  const uint32_t freeHeap = ESP.getFreeHeap();
  const uint32_t minHeap = ESP.getMinFreeHeap();
  const uint32_t largestHeap = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  const uint32_t psramTotal = ESP.getPsramSize();
  const uint32_t psramFree = ESP.getFreePsram();
  const uint32_t uptimeSec = (millis() - bootMs) / 1000;
  const uint32_t totalProcessedBytes = wsRxBytes + wsTxBytes + nfcRxBytes + nfcTxBytes;

  Serial.println("[DBG] ================= Runtime Snapshot =================");
  Serial.printf("[DBG] uptime=%lus tableId=%d wsConnected=%s\n", uptimeSec, TABLE_ID, wsConnected ? "yes" : "no");
  Serial.printf("[DBG] heap_free=%u heap_min=%u heap_largest=%u\n", freeHeap, minHeap, largestHeap);
  Serial.printf("[DBG] psram_total=%u psram_free=%u\n", psramTotal, psramFree);
  Serial.printf("[DBG] ws_rx_msgs=%u ws_tx_msgs=%u ws_rx_bytes=%u ws_tx_bytes=%u\n", wsRxMessages, wsTxMessages, wsRxBytes, wsTxBytes);
  Serial.printf("[DBG] nfc_sessions=%u nfc_apdu=%u nfc_read_ok=%u nfc_rx_bytes=%u nfc_tx_bytes=%u\n", nfcSessions, nfcApduExchanges, nfcReadSuccess, nfcRxBytes, nfcTxBytes);
  Serial.printf("[DBG] ndef_file_len=%u total_processed_bytes=%u\n", ndefFileLen, totalProcessedBytes);
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

// Send a 2-byte ISO7816 status word
static void apduOK   (uint8_t* b, uint8_t* len) { b[0]=0x90; b[1]=0x00; *len=2; }
static void apduErr  (uint8_t* b, uint8_t* len, uint8_t s1, uint8_t s2)
                                                { b[0]=s1;   b[1]=s2;   *len=2; }

// Process one C-APDU, fill resp[], set *respLen, return true if handled
bool handleApdu(const uint8_t* cmd, uint8_t cmdLen,
                uint8_t* resp,      uint8_t* respLen) {
  if (cmdLen < 4) { apduErr(resp, respLen, 0x67, 0x00); return false; }

  uint8_t ins = cmd[1];
  uint8_t p1  = cmd[2];
  uint8_t p2  = cmd[3];

  // ── SELECT ─────────────────────────────────────────────────────
  if (ins == 0xA4) {
    if (p1 == 0x04) {                   // SELECT by AID
      uint8_t aidLen = (cmdLen > 4) ? cmd[4] : 0;
      if (aidLen == 7 && memcmp(cmd+5, NDEF_AID, 7) == 0) {
        selectedFile = FILE_NONE;
        apduOK(resp, respLen);
      } else {
        apduErr(resp, respLen, 0x6A, 0x82);
      }
    } else if (p1 == 0x00 && p2 == 0x0C) { // SELECT by File ID
      if (cmdLen >= 7 && cmd[5] == 0xE1) {
        if      (cmd[6] == 0x03) { selectedFile = FILE_CC;   apduOK(resp, respLen); }
        else if (cmd[6] == 0x04) { selectedFile = FILE_NDEF; apduOK(resp, respLen); }
        else                     { apduErr(resp, respLen, 0x6A, 0x82); }
      } else { apduErr(resp, respLen, 0x6A, 0x82); }
    } else {
      apduErr(resp, respLen, 0x6A, 0x81);
    }
    return true;
  }

  // ── READ BINARY ────────────────────────────────────────────────
  if (ins == 0xB0) {
    uint16_t offset = ((uint16_t)p1 << 8) | p2;
    uint8_t  rdLen  = (cmdLen > 4) ? cmd[4] : 0;

    if (selectedFile == FILE_CC) {
      uint16_t ccSz = sizeof(CC_FILE);
      if (offset >= ccSz)           { apduErr(resp, respLen, 0x6B, 0x00); return true; }
      if (offset + rdLen > ccSz)    rdLen = ccSz - offset;
      memcpy(resp, CC_FILE + offset, rdLen);
      resp[rdLen] = 0x90; resp[rdLen+1] = 0x00; *respLen = rdLen + 2;

    } else if (selectedFile == FILE_NDEF) {
      if (offset >= ndefFileLen)        { apduErr(resp, respLen, 0x6B, 0x00); return true; }
      if (offset + rdLen > ndefFileLen) rdLen = ndefFileLen - offset;
      memcpy(resp, ndefFile + offset, rdLen);
      resp[rdLen] = 0x90; resp[rdLen+1] = 0x00; *respLen = rdLen + 2;

    } else {
      apduErr(resp, respLen, 0x6A, 0x82);
    }
    return true;
  }

  // ── Anything else ────────────────────────────────────────────────
  apduErr(resp, respLen, 0x6D, 0x00);
  return false;
}

// Expose the PN532 as a Type-4 Tag for up to `timeoutMs` ms.
// Returns true the moment a phone successfully reads the NDEF.
bool nfcEmulateOnce(uint16_t timeoutMs) {
  // tgInitAsTarget command: PICC mode (passive ISO-DEP), SAK=0x20
  uint8_t tgCmd[] = {
    0x8C,              // TgInitAsTarget
    0x05,              // Mode: PICC only | passive only
    0x04, 0x00,        // SENS_RES / ATQA — indicates ISO-DEP Type A
    0x00, 0x00, 0x00,  // NFCID1  (3 random bytes, zeros OK)
    0x20,              // SEL_RES / SAK = 0x20 ← ISO-DEP flag (critical!)
    0x01, 0xFE, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,  // POL_RES (Felica, unused)
    0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
    0xFF, 0xFF,
    0xAA,0x99,0x88,0x77,0x66,0x55,0x44,0x33,0x22,0x11, // NFCID3t
    0x00,  // Gt length = 0
    0x00   // Tk length = 0
  };

  int8_t res = nfc.tgInitAsTarget(tgCmd, sizeof(tgCmd), timeoutMs);
  if (res == 0 || res == -2) return false;  // no phone in field (normal idle)
  if (res < 0) return false;

  nfcSessions++;
  selectedFile = FILE_NONE;

  uint8_t buf[128], resp[128];
  uint8_t respLen = 0;
  bool ndefServed = false;

  while (true) {
    int16_t bytes = nfc.tgGetData(buf, sizeof(buf));
    if (bytes < 0) {
      break;
    }
    nfcRxBytes += (uint16_t)bytes;

    // Mark success only when the phone actually reads NDEF file data
    if (bytes >= 5 && buf[1] == 0xB0 && selectedFile == FILE_NDEF) {
      ndefServed = true;
    }

    handleApdu(buf, (uint8_t)bytes, resp, &respLen);
    nfcTxBytes += respLen;
    nfcApduExchanges++;

    if (!nfc.tgSetData(resp, respLen)) {
      break;
    }

    // PN532 briefly de-asserts SPI READY after tgSetData while it processes
    // the sent frame. Without this pause the next writeCommand sees the chip
    // as "not ready" and returns -1 immediately (even though the phone is
    // still in the field and waiting for the next response).
    delay(15);
    wsClient.loop();  // process WebSocket messages mid-exchange
  }
  if (ndefServed) nfcReadSuccess++;
  return ndefServed;
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

bool enterPn532LowPower() {
#if PN532_LOW_POWER_ENABLED
  if (pn532InLowPower) return true;
  pn532InLowPower = true;
  return true;
#else
  return false;
#endif
}

void wakePn532FromLowPower() {
  if (!pn532InLowPower) return;
  pn532InLowPower = false;
}

unsigned long phoneMsgUntil = 0;

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
        phoneMsgUntil = 0;
        wakeLcdBacklight();
        updateLCD("Order confirmed!", "Kitchen is on it");

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
  Serial.printf("[DBG] initial_heap=%u initial_psram=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());
  #endif

  // ── Hard-reset the PN532 so it re-reads DIP switches on every boot ──
  pinMode(PN532_RST, OUTPUT);
  digitalWrite(PN532_RST, LOW);
  delay(400);
  digitalWrite(PN532_RST, HIGH);
  delay(10);

  #if ENABLE_BOOT_DIAGNOSTICS
  // ══════════════════════════════════════════════════
  // PIN DIAGNOSTIC — runs before everything else
  // ══════════════════════════════════════════════════
  Serial.println("[DIAG] ── Raw pin states (BEFORE Wire.begin) ──");
  pinMode(PN532_SDA, INPUT_PULLUP);
  pinMode(PN532_SCL, INPUT_PULLUP);
  pinMode(PN532_IRQ, INPUT_PULLUP);
  delay(5);
  int sdaState = digitalRead(PN532_SDA);
  int sclState = digitalRead(PN532_SCL);
  int irqState = digitalRead(PN532_IRQ);
  Serial.printf("[DIAG]   SDA pin %2d = %s  %s\n", PN532_SDA, sdaState ? "HIGH" : "LOW ",
    sdaState ? "(wire present or floating-high)" : "*** LOW — check wire or short ***");
  Serial.printf("[DIAG]   SCL pin %2d = %s  %s\n", PN532_SCL, sclState ? "HIGH" : "LOW ",
    sclState ? "(wire present or floating-high)" : "*** LOW — check wire or short ***");
  Serial.printf("[DIAG]   IRQ pin %2d = %s  %s\n", PN532_IRQ, irqState ? "HIGH" : "LOW ",
    irqState ? "(idle-high, correct)" : "(LOW at boot — unexpected)");

  // Drive SDA/SCL LOW, then release, to confirm the pin can toggle
  Serial.println("[DIAG] ── Toggling SDA & SCL to confirm GPIO works ──");
  pinMode(PN532_SDA, OUTPUT); digitalWrite(PN532_SDA, LOW); delay(1);
  Serial.printf("[DIAG]   SDA forced LOW -> reads %s\n", digitalRead(PN532_SDA) ? "HIGH (stuck!)" : "LOW  (OK)");
  pinMode(PN532_SDA, INPUT_PULLUP); delay(1);
  Serial.printf("[DIAG]   SDA released   -> reads %s\n", digitalRead(PN532_SDA) ? "HIGH (OK)" : "LOW  (something pulling it down)");

  pinMode(PN532_SCL, OUTPUT); digitalWrite(PN532_SCL, LOW); delay(1);
  Serial.printf("[DIAG]   SCL forced LOW -> reads %s\n", digitalRead(PN532_SCL) ? "HIGH (stuck!)" : "LOW  (OK)");
  pinMode(PN532_SCL, INPUT_PULLUP); delay(1);
  Serial.printf("[DIAG]   SCL released   -> reads %s\n", digitalRead(PN532_SCL) ? "HIGH (OK)" : "LOW  (something pulling it down)");

  // External pull-up check — set INPUT (no ESP32 pull-up) and read
  Serial.println("[DIAG] ── External pull-up check (no internal pull-up) ──");
  pinMode(PN532_SDA, INPUT); delay(2);
  int sdaExt = digitalRead(PN532_SDA);
  pinMode(PN532_SCL, INPUT); delay(2);
  int sclExt = digitalRead(PN532_SCL);
  Serial.printf("[DIAG]   SDA (no pullup) = %s  %s\n", sdaExt ? "HIGH" : "LOW",
    sdaExt ? "← external pull-up present (PN532 module IS connected)" : "← floating LOW (PN532 not connected or no power)");
  Serial.printf("[DIAG]   SCL (no pullup) = %s  %s\n", sclExt ? "HIGH" : "LOW",
    sclExt ? "← external pull-up present (PN532 module IS connected)" : "← floating LOW (PN532 not connected or no power)");

  // I2C scan at 10 kHz (extra slow for reliability)
  Serial.println("[DIAG] ── I2C scan at 10 kHz (Wire.begin SDA=8 SCL=9) ──");
  Wire.begin(PN532_SDA, PN532_SCL);
  Wire.setClock(10000);
  bool anyFound = false;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t err = Wire.endTransmission(true);
    if (err == 0) {
      Serial.printf("[DIAG]   ✓ ACK  at 0x%02X%s\n", addr, addr == 0x24 ? "  ← PN532!" : "");
      anyFound = true;
    }
  }
  if (!anyFound) {
    // Try with SDA and SCL swapped (pin 9 = SDA, pin 8 = SCL)
    Serial.println("[DIAG] ── Retry with SDA/SCL SWAPPED (pin9=SDA, pin8=SCL) ──");
    Wire.end();
    Wire.begin(PN532_SCL, PN532_SDA);  // deliberately swapped
    Wire.setClock(10000);
    bool swapFound = false;
    for (uint8_t addr = 1; addr < 127; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission(true) == 0) {
        Serial.printf("[DIAG]   ✓ ACK at 0x%02X with SWAPPED pins%s\n", addr, addr == 0x24 ? "  ← PN532!" : "");
        swapFound = true;
      }
    }
    if (swapFound) {
      Serial.println("[DIAG]   *** SDA and SCL wires are SWAPPED on your breadboard ***");
      Serial.println("[DIAG]   Swap the SDA wire to pin 9 and SCL wire to pin 8, OR");
      Serial.println("[DIAG]   change #define PN532_SDA 9 and PN532_SCL 8 in the code.");
    } else if (sdaExt && sclExt) {
      Serial.println("[DIAG]   External pull-ups present — module IS wired.");
      Serial.println("[DIAG]   *** DIP SWITCHES NOT ENGAGING ***");
      Serial.println("[DIAG]   Use a needle to push each switch firmly to the end stop.");
      Serial.println("[DIAG]   For I2C: SW1 fully OFF, SW2 fully ON.");
    } else {
      Serial.println("[DIAG]   No device found. Check VCC->3V3 and GND->G on PN532.");
    }
  }
  Serial.println("[DIAG] ─────────────────────────────────────────────");
  // ══════════════════════════════════════════════════
  #else
  Wire.begin(PN532_SDA, PN532_SCL);
  #endif

  // ── Re-init Wire at full speed after slow diagnostic scan ──
  Wire.end();
  Wire.begin(PN532_SDA, PN532_SCL);
  Wire.setClock(100000);  // 100 kHz for more robust I2C on breadboard/battery wiring

  // ── LCD ──
#if LCD_BACKLIGHT_PIN >= 0
  pinMode(LCD_BACKLIGHT_PIN, OUTPUT);
  setLcdBacklight(true);
#endif
  lcd.begin(LCD_COLS, LCD_ROWS);
  updateLCD("Starting...", "Please wait");

  // ── I2C bus for PN532 (already initialised above) ──
  nfc.begin();

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
    Serial.println("[DBG] MAC: " + WiFi.macAddress());
    #endif
    updateLCD("WiFi OK", WiFi.localIP().toString());
  } else {
    updateLCD("No WiFi!", "Offline mode");
  }
  delay(1200);

  // ── Verify PN532 is responding via I2C ──
  uint32_t fw = 0;
  for (uint8_t attempt = 0; attempt < 3 && !fw; attempt++) {
    if (attempt > 0) {
      delay(120);
      nfc.begin();
    }
    fw = nfc.getFirmwareVersion();
  }

  if (!fw) {
    Serial.println("[NFC] PN532 not found. Check wiring/DIP.");

    // Scan I2C bus for any device
    #if ENABLE_BOOT_DIAGNOSTICS
    Serial.println("[NFC] I2C retry failed. Scanning I2C bus...");
    bool foundI2C = false;
    for (uint8_t addr = 1; addr < 127; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() == 0) {
        Serial.printf("[DIAG] I2C device found at 0x%02X\n", addr);
        foundI2C = true;
      }
    }
    if (!foundI2C) {
      Serial.println("[DIAG] Nothing on I2C — check DIP SW1=OFF SW2=ON, SDA->8, SCL->9");
      updateLCD("Check wiring!", "See Serial log");
    }
    #endif
    while (true) delay(500);
  }

  #if ENABLE_RUNTIME_STATS
  Serial.printf("[NFC] PN532 OK — PN5%02X firmware v%d.%d\n",
                (fw>>24)&0xFF, (fw>>16)&0xFF, (fw>>8)&0xFF);
  #endif
  nfc.SAMConfig();
  pinMode(PN532_IRQ, INPUT_PULLUP);
  lastNfcActivityMs = millis();

  // ── Build NDEF URI ──
  char url[220];
  snprintf(url, sizeof(url), "%s?server=https://%s&table=%d", MENU_WEB_BASE, RENDER_HOST, TABLE_ID);
  nfcSetUrl(url);

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

#if PN532_LOW_POWER_ENABLED
  if (pn532InLowPower) {
    if (digitalRead(PN532_IRQ) == LOW) {
      wakePn532FromLowPower();
      lastNfcActivityMs = millis();
    } else {
      delay(PN532_POWERDOWN_POLL_MS);
      return;
    }
  }
#endif

  static bool waitingPrinted = false;
  if (!waitingPrinted) {
    Serial.println("[NFC] Waiting for phone tap...");
    waitingPrinted = true;
  }

  if (nfcEmulateOnce(250)) {
    Serial.println("[NFC] Phone read the URL!");
    waitingPrinted = false;
    lastNfcActivityMs = millis();
    wakeLcdBacklight();
    updateLCD("Scan detected!", "Opening menu...");
    phoneMsgUntil = millis() + 30000;  // hold for 30s unless server overrides
    if (wsConnected) {
      StaticJsonDocument<128> doc;
      doc["event"] = "nfc:tap";
      doc["data"]["tableId"] = TABLE_ID;
      String msg; serializeJson(doc, msg);
      wsClient.sendTXT(msg);
      wsTxMessages++;
      wsTxBytes += msg.length();
    }
  } else if (!pn532InLowPower && (millis() - lastNfcActivityMs >= PN532_POWERDOWN_AFTER_IDLE_MS)) {
    if (enterPn532LowPower()) {
      waitingPrinted = false;
    }
  }

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
