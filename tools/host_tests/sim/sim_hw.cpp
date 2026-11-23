// パソコン上のテスト用の偽物（Arduino の Serial／時計、NVS、MIDI出力、RC522、タグの保存、登録の画面）
#include "sim_hw.h"

#include <Arduino.h>
#include <Preferences.h>
#include <stdarg.h>
#include <string.h>

#include <map>
#include <string>
#include <vector>

#include "config.h"
#include "midi_out.h"
#include "rc522_test.h"
#include "reader_array.h"
#include "register_ui.h"
#include "tag_store.h"

// ------------------------------------------------------------
// Arduino: Serial と時計
// ------------------------------------------------------------
SimSerial Serial;
static std::string g_out;
static uint32_t g_millis = 0;

std::string& simOut() { return g_out; }
void simSetMillis(uint32_t ms) { g_millis = ms; }
uint32_t millis() { return g_millis; }
void delay(uint32_t) {}
void delayMicroseconds(uint32_t) {}

static size_t append(const std::string& s) {
  g_out += s;
  return s.size();
}
static std::string number(unsigned long long v, int base) {
  char buf[40];
  snprintf(buf, sizeof(buf), base == HEX ? "%llX" : "%llu", v);
  return buf;
}

size_t SimSerial::write(uint8_t c) { g_out += (char)c; return 1; }
size_t SimSerial::print(const char* s) { return append(s ? s : ""); }
size_t SimSerial::print(char c) { g_out += c; return 1; }
size_t SimSerial::print(int v, int base) {
  if (v < 0 && base == DEC) return append(std::to_string(v));
  return append(number((unsigned)v, base));
}
size_t SimSerial::print(unsigned int v, int base) { return append(number(v, base)); }
size_t SimSerial::print(unsigned char v, int base) { return append(number(v, base)); }
size_t SimSerial::print(long v, int base) {
  if (v < 0 && base == DEC) return append(std::to_string(v));
  return append(number((unsigned long)v, base));
}
size_t SimSerial::print(unsigned long v, int base) { return append(number(v, base)); }
size_t SimSerial::println() { return append("\n"); }
size_t SimSerial::println(const char* s) { return append(std::string(s ? s : "") + "\n"); }
size_t SimSerial::println(int v) { return print(v) + println(); }
size_t SimSerial::printf(const char* format, ...) {
  char buf[1024];
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(buf, sizeof(buf), format, ap);
  va_end(ap);
  if (n < 0) return 0;
  if ((size_t)n >= sizeof(buf)) n = sizeof(buf) - 1;
  return append(std::string(buf, n));
}

// ------------------------------------------------------------
// Preferences（NVS）
// ------------------------------------------------------------
typedef std::map<std::string, std::vector<uint8_t>> Namespace;
static std::map<std::string, Namespace>& nvs() {
  static std::map<std::string, Namespace> store;
  return store;
}

bool Preferences::begin(const char* name, bool readOnly) {
  if (readOnly && nvs().find(name) == nvs().end()) return false;  // 本物と同じ: まだない名前空間は、読み取り専用では開けない
  ns_ = name;
  readOnly_ = readOnly;
  if (!readOnly) nvs()[name];  // 作る
  return true;
}
void Preferences::end() { ns_ = nullptr; }
size_t Preferences::putBytes(const char* key, const void* value, size_t len) {
  if (!ns_ || readOnly_) return 0;
  const uint8_t* p = (const uint8_t*)value;
  nvs()[ns_][key] = std::vector<uint8_t>(p, p + len);
  return len;
}
size_t Preferences::getBytes(const char* key, void* buf, size_t maxLen) {
  if (!ns_) return 0;
  auto it = nvs()[ns_].find(key);
  if (it == nvs()[ns_].end() || it->second.size() > maxLen) return 0;
  memcpy(buf, it->second.data(), it->second.size());
  return it->second.size();
}
size_t Preferences::getBytesLength(const char* key) {
  if (!ns_) return 0;
  auto it = nvs()[ns_].find(key);
  return it == nvs()[ns_].end() ? 0 : it->second.size();
}
bool Preferences::isKey(const char* key) { return ns_ && nvs()[ns_].count(key) > 0; }
bool Preferences::remove(const char* key) { return ns_ && !readOnly_ && nvs()[ns_].erase(key) > 0; }
size_t Preferences::putUChar(const char* key, uint8_t value) { return putBytes(key, &value, 1); }
uint8_t Preferences::getUChar(const char* key, uint8_t defaultValue) {
  uint8_t v;
  return getBytes(key, &v, 1) == 1 ? v : defaultValue;
}
bool simNvsHas(const char* ns, const char* key) {
  auto it = nvs().find(ns);
  return it != nvs().end() && it->second.count(key) > 0;
}
void simNvsClear() { nvs().clear(); }

// ------------------------------------------------------------
// midi_out（送られたメッセージを記録する）
// ------------------------------------------------------------
static std::vector<SimMidi> g_midi;
static int g_batch = 0;
static MidiBackend g_backend = MIDI_BACKEND_BRIDGE;
bool simUsbFails = false;
bool simUsbMountedFlag = true;

std::vector<SimMidi>& simMidiLog() { return g_midi; }

void midiBegin() {}
bool midiSetBackend(MidiBackend backend) {
  if (backend == MIDI_BACKEND_USB && simUsbFails) return false;
  g_backend = backend;
  return true;
}
MidiBackend midiBackend() { return g_backend; }
const char* midiBackendName() {
  switch (g_backend) {
    case MIDI_BACKEND_NONE: return "なし";
    case MIDI_BACKEND_BRIDGE: return "ブリッジ";
    default: return "USB-MIDI";
  }
}
bool midiUsbMounted() { return simUsbMountedFlag; }
void midiSendMessages(const uint8_t* bytes, size_t len) {
  g_batch++;
  for (size_t i = 0; i + 3 <= len; i += 3) g_midi.push_back({millis(), g_batch, bytes[i], bytes[i + 1], bytes[i + 2]});
}
void midiProgramChange(uint8_t channel, uint8_t program) {
  g_batch++;
  g_midi.push_back({millis(), g_batch, (uint8_t)(0xC0 | channel), program, 0});
}
void midiAllNotesOff(uint8_t channel) {
  g_batch++;
  g_midi.push_back({millis(), g_batch, (uint8_t)(0xB0 | channel), 123, 0});
}

// ------------------------------------------------------------
// reader_array（リーダーの設定と、駒の有無）
// ------------------------------------------------------------
int simSelfTestFailures = 0;
int simAliveCount = NUM_READERS;
static IdleMethod g_idle = IDLE_ANTENNA_OFF;
static uint8_t g_gain = 33;
static int g_lastFailures = 0;
static bool g_present[NUM_READERS];
static TagUid g_uid[NUM_READERS];

const char* readersIdleMethodName(IdleMethod m) {
  return m == IDLE_RESET ? "RESET（チップごと止める）" : "アンテナOFF（電波だけ止める）";
}
IdleMethod readersIdleMethod() { return g_idle; }
bool readersSetIdleMethod(IdleMethod method, bool verify) {
  if (verify && method == IDLE_RESET && simSelfTestFailures > 0) {
    g_lastFailures = simSelfTestFailures;
    return false;
  }
  g_lastFailures = 0;
  g_idle = method;
  return true;
}
int readersLastSelfTestFailures() { return g_lastFailures; }
uint32_t readersSlowWakeCount() { return 0; }
bool readersGainValid(uint8_t db) { return db == 18 || db == 23 || db == 33 || db == 38 || db == 43 || db == 48; }
bool readersSetGainDb(uint8_t db) {
  if (!readersGainValid(db)) return false;
  g_gain = db;
  return true;
}
uint8_t readersGainDb() { return g_gain; }
int readersAliveCount() { return simAliveCount; }
bool readerIsAlive(int i) { return i >= 0 && i < simAliveCount; }   // 先頭から simAliveCount 台が応答する
bool readerHasTag(int i) { return g_present[i]; }
const TagUid& readerTagUid(int i) { return g_uid[i]; }
int simShadowOwner[NUM_READERS];   // テスト用: リーダー i が影として読んでいる駒の持ち主（-1 = 影ではない）
bool readerIsShadow(int i) { return simShadowOwner[i] >= 0; }
int readerShadowOwner(int i) { return simShadowOwner[i]; }
uint32_t readersArbitrationCount() { return 0; }
uint32_t readersAvgScanUs() { return 0; }
bool simVerdictPending = false;      // テスト用: 次の readersTakeVerdict で返す判定
ReaderVerdict simVerdict;
bool readersTakeVerdict(ReaderVerdict* out) {
  if (!simVerdictPending) return false;
  simVerdictPending = false;
  *out = simVerdict;
  return true;
}
int readersGainLevels() { return 6; }
int readersGainDbAt(int level) { static const int db[6] = {18, 23, 33, 38, 43, 48}; return (level >= 0 && level < 6) ? db[level] : 0; }
bool simMarginHasTag[8] = {true, true, true, false, false, false, false, false};   // テスト用: MARGIN で、駒が載っているリーダー
bool readersMarginTest(int reader, int tries, int* hits) {
  if (reader < 0 || reader >= 8 || !simMarginHasTag[reader]) return false;
  for (int lv = 0; lv < 6; lv++) hits[lv] = lv >= 2 ? tries : (lv == 1 ? tries / 2 : 0);   // 18dB=0 23dB=半分 33dB 以上=すべて
  return true;
}
bool simRetestStartOk = true;        // テスト用: readersRetest が返す値
int simRetestStartedReader = -1;     // readersRetest に渡されたリーダー
bool simRetestResultPending = false; // 次の readersTakeRetestResult で返す結果
int simRetestResultReader = 0;
uint32_t simRetestResultMs = 0;
bool simRetestResultOk = true;
bool readersRetest(int reader) {
  simRetestStartedReader = reader;
  return simRetestStartOk;
}
bool readersTakeRetestResult(int* reader, uint32_t* ms, bool* ok) {
  if (!simRetestResultPending) return false;
  simRetestResultPending = false;
  *reader = simRetestResultReader;
  *ms = simRetestResultMs;
  *ok = simRetestResultOk;
  return true;
}
ReaderStatsInfo simStats[8];         // テスト用: readersStatsGet が返す統計
bool simStatsReset = false;          // readersStatsReset が呼ばれたか
bool readersStatsGet(int reader, ReaderStatsInfo* out) {
  if (reader < 0 || reader >= 8) return false;
  *out = simStats[reader];
  return true;
}
void readersStatsReset() {
  simStatsReset = true;
  for (int i = 0; i < 8; i++) simStats[i] = ReaderStatsInfo();
}
bool simNotePending = false;         // テスト用: 次の readersTakeEventNote で返すイベントの原因
ReaderEventNote simNote;
bool readersTakeEventNote(ReaderEventNote* out) {
  if (!simNotePending) return false;
  simNotePending = false;
  *out = simNote;
  return true;
}

TagUid simUid(uint8_t a, uint8_t b) {
  TagUid u = {};
  u.size = 4;
  u.bytes[0] = a;
  u.bytes[1] = b;
  u.bytes[2] = 0x5A;
  u.bytes[3] = 0xC3;
  return u;
}
void simPutTag(int reader, const TagUid& uid) {
  g_present[reader] = true;
  g_uid[reader] = uid;
}
void simRemoveTag(int reader) { g_present[reader] = false; }
static struct SimShadowInit { SimShadowInit() { for (int i = 0; i < NUM_READERS; i++) simShadowOwner[i] = -1; } } simShadowInit;

// ------------------------------------------------------------
// tag_store（UID → コードID）
// ------------------------------------------------------------
struct Reg {
  TagUid uid;
  uint8_t chord;
};
static std::vector<Reg> g_regs;

void simRegisterTag(const TagUid& uid, uint8_t chordId) { g_regs.push_back({uid, chordId}); }
uint8_t tagStoreFind(const TagUid& uid) {
  for (const Reg& r : g_regs) {
    if (r.uid.size == uid.size && memcmp(r.uid.bytes, uid.bytes, uid.size) == 0) return r.chord;
  }
  return 0;
}

// ------------------------------------------------------------
// 登録の画面・RC522 のテストモード（呼ばれたことだけ記録）
// ------------------------------------------------------------
int simRegisterUiBeginCalls = 0;
int simRegisterUiCancelCalls = 0;
bool simTestMode = false;
void registerUiBegin() { simRegisterUiBeginCalls++; }
void registerUiCancelPrompt() { simRegisterUiCancelCalls++; }
bool testActive() { return simTestMode; }

// ------------------------------------------------------------
// main.cpp にある変数
// ------------------------------------------------------------
Key currentKey = KEY_C;
