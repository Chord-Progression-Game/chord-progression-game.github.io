#include "settings_store.h"

#include <Arduino.h>
#include <Preferences.h>

#include "config.h"

static const char* nvsName = "settings";
static Preferences prefs;

void settingsBegin(const char* nvsNamespace) { nvsName = nvsNamespace; }

IdleMethod settingsLoadIdleMethod(IdleMethod defaultValue) {
  if (!prefs.begin(nvsName, true)) return defaultValue;  // true = 読むだけ。まだ保存がないと、開けないことがある
  uint8_t v = prefs.getUChar("idle", 255);
  prefs.end();
  if (v == IDLE_ANTENNA_OFF) return IDLE_ANTENNA_OFF;
  if (v == IDLE_RESET) return IDLE_RESET;
  return defaultValue;
}

uint8_t settingsLoadGainDb(uint8_t defaultDb) {
  if (!prefs.begin(nvsName, true)) return defaultDb;
  uint8_t v = prefs.getUChar("gain", 0);
  prefs.end();
  return readersGainValid(v) ? v : defaultDb;
}

int settingsLoadOctave(int defaultValue) {
  if (!prefs.begin(nvsName, true)) return defaultValue;
  uint8_t v = prefs.getUChar("octave", 255);   // 保存は「高さ + 10」（負の数を避ける）
  prefs.end();
  int octave = (int)v - 10;
  return (v != 255 && octave >= OCTAVE_MIN && octave <= OCTAVE_MAX) ? octave : defaultValue;
}

bool settingsSaveOctave(int octave) {
  if (!prefs.begin(nvsName, false)) return false;
  size_t n = prefs.putUChar("octave", (uint8_t)(octave + 10));
  prefs.end();
  return n == 1;
}

bool settingsLoadMap(uint8_t* out, int n) {
  if (!prefs.begin(nvsName, true)) return false;
  bool ok = prefs.isKey("map") && prefs.getBytesLength("map") == (size_t)n && prefs.getBytes("map", out, (size_t)n) == (size_t)n;
  prefs.end();
  return ok;
}

bool settingsSaveMap(const uint8_t* map, int n) {
  if (!prefs.begin(nvsName, false)) return false;
  size_t written = prefs.putBytes("map", map, (size_t)n);
  prefs.end();
  return written == (size_t)n;
}

bool settingsSaveIdleMethod(IdleMethod method) {
  if (!prefs.begin(nvsName, false)) return false;
  size_t n = prefs.putUChar("idle", (uint8_t)method);
  prefs.end();
  return n == 1;
}

bool settingsSaveGainDb(uint8_t db) {
  if (!prefs.begin(nvsName, false)) return false;
  size_t n = prefs.putUChar("gain", db);
  prefs.end();
  return n == 1;
}

// ---- 再生の設定 ----
// 1バイトの値を、前と同じなら書かずに保存する
static bool putByteIfChanged(const char* key, uint8_t v) {
  if (!prefs.begin(nvsName, false)) return false;
  bool ok = true;
  if (!prefs.isKey(key) || prefs.getUChar(key, (uint8_t)(v ^ 0xFF)) != v) ok = prefs.putUChar(key, v) == 1;
  prefs.end();
  return ok;
}
static int loadByte(const char* key, int defaultValue, int lo, int hi) {
  if (!prefs.begin(nvsName, true)) return defaultValue;
  bool has = prefs.isKey(key);
  uint8_t v = prefs.getUChar(key, 0);
  prefs.end();
  return (has && v >= lo && v <= hi) ? (int)v : defaultValue;
}

int settingsLoadDrum(int defaultId) { return loadByte("drum", defaultId, 0, 99); }
bool settingsSaveDrum(int id) { return id >= 0 && id <= 99 && putByteIfChanged("drum", (uint8_t)id); }
int settingsLoadBacking(int defaultId) { return loadByte("backing", defaultId, 0, 99); }
bool settingsSaveBacking(int id) { return id >= 0 && id <= 99 && putByteIfChanged("backing", (uint8_t)id); }
int settingsLoadBpm(int defaultBpm) { return loadByte("bpm", defaultBpm, 30, 240); }
bool settingsSaveBpm(int bpm) { return bpm >= 30 && bpm <= 240 && putByteIfChanged("bpm", (uint8_t)bpm); }

// キーは「文字(0〜6) × 5 + (変化記号 + 2)」の1バイトで保存する
bool settingsLoadKey(Key* out) {
  int v = loadByte("key", -1, 0, 34);
  if (v < 0) return false;
  out->letter = (uint8_t)(v / 5);
  out->accidental = (int8_t)(v % 5 - 2);
  return true;
}
bool settingsSaveKey(const Key& key) {
  if (key.letter > 6 || key.accidental < -2 || key.accidental > 2) return false;
  return putByteIfChanged("key", (uint8_t)(key.letter * 5 + key.accidental + 2));
}

bool settingsLoadBuzzer(bool defaultOn) { return loadByte("buzz", defaultOn ? 1 : 0, 0, 1) == 1; }
bool settingsSaveBuzzer(bool on) { return putByteIfChanged("buzz", on ? 1 : 0); }
bool settingsLoadAutostart(bool defaultOn) { return loadByte("auto", defaultOn ? 1 : 0, 0, 1) == 1; }
bool settingsSaveAutostart(bool on) { return putByteIfChanged("auto", on ? 1 : 0); }
