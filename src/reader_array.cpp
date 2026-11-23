#include "reader_array.h"

#include <Arduino.h>
#include <MFRC522.h>
#include <SPI.h>
#include <string.h>

#include "array_tracker.h"
#include "config.h"

// ------------------------------------------------------------
// ピン表: リーダー番号 → SS(SDA) と RST のGPIO番号
//   リーダー1・2 は、これまで動作を確認してきた配線のまま。
//   リーダー3・4 の番号は、ボードの仕様（データシートとFreenoveのピン配置図）で
//   「ふつうの入出力ピン」と確認できたもの。起動時の設定ピン(0,3,45,46)、USB(19,20)、
//   PSRAM(35〜37)、シリアル(43,44)、SPIの共有線(11,12,13)、ブザー(14) とは重ならない。
// ------------------------------------------------------------
struct ReaderPins {
  uint8_t ss;
  uint8_t rst;
};
static const ReaderPins PINS[8] = {
    {10, 5},  // リーダー1
    {4, 8},   // リーダー2
    {6, 9},   // リーダー3
    {7, 1},   // リーダー4
    // 8台にするときに足す4台。番号は、README 3-7（Espressif のデータシートと Freenove のピン配置図）で、
    // 「ふつうの入出力ピン」と確認したもの。GPIO15・16 は、32kHz の水晶の端子も兼ねる（この基板に水晶があるかは未確認。
    // 応答しないときは、38・39・40 などの空きピンに替える）。GPIO41・42 は、JTAG の端子も兼ねる。
    {15, 42},  // リーダー5
    {16, 41},  // リーダー6
    {17, 47},  // リーダー7
    {18, 21},  // リーダー8
};
static_assert(NUM_READERS >= 1 && NUM_READERS <= 8, "NUM_READERS must be 1..8 (see the pin table)");

static MFRC522 mfrc[NUM_READERS];  // RC522 を操作するオブジェクト（1台につき1つ）

static IdleMethod method = IDLE_ANTENNA_OFF;  // 起動直後は、実績のある方。main が、保存した設定（または初期値）に切り替える
static bool inReset[NUM_READERS];       // いま RST=LOW（チップが止まっている）か
static bool alive[NUM_READERS];         // 起動時に応答したか
static uint8_t baseVersion[NUM_READERS];  // 起動時に読んだバージョン値（あとの通信テストの「正解」）
static uint8_t rxGainMask = MFRC522::RxGain_33dB;  // 受信感度（RFCfgReg に書く値）
static uint8_t cwGsP = 0x20;                       // アンテナの駆動の強さ（CWGsPReg。標準 0x20）
static const uint8_t RX_MIN_LEVEL_DEFAULT = 8;     // 受信のしきい値 MinLevel の標準（RxThresholdReg の標準値 0x84 の上の4ビット）
static const uint8_t RX_COLL_LEVEL = 4;            // 下の3ビット CollLevel は、標準のまま
static uint8_t rxMinLevel = RX_MIN_LEVEL_DEFAULT;
static bool dbgAntennaOff = false;                 // 診断用: 読むとき電波を出さない
static int lastSelfTestFailures = 0;
static uint8_t settleMs = RC522_SETTLE_MS;     // 電波を出してから、最初の呼びかけまで待つ時間
static uint8_t timeoutMs = RC522_TIMEOUT_MS;   // タグの返事を待つ時間
static bool lastWakeFast = false;      // 直前の起こし方が、速い方法で成功したか
static uint32_t slowWakeCount = 0;     // 速い起こし方に失敗して、確実な方法にした回数（診断用）
static bool lastScanGarbled[8];        // 直前の scanAllCore が「返事はあったのに読めなかった」か（駒を1枚も読めず、タイムアウト以外の失敗）
static int8_t garbleStatus[8];         // 診断用: 最後に「読めなかった（乱れ）」とした読み取りの、呼びかけ（WUPA）の結果（MFRC522 の StatusCode。100 = 呼びかけは通ったが、UID を読めなかった）
static uint32_t garbleUs[8];           // 診断用: そのときの、呼びかけにかかった時間（µs）。何も答えない本当のタイムアウトは、待ち時間（RC522_TIMEOUT_MS）いっぱいかかる
static bool hintSet[8];                // 次の読み取りで、載っているはずの駒（hintUid）を、直接呼びかけて確かめる（1回だけ有効）
static TagUid hintUid[8];
static bool hintQuick[8];              // hintSet のとき: 確かめるだけ（読めたら、HALT と、ほかの駒を探す REQA を省く。待ち時間を、約20ms 減らす）
static uint32_t directOkCount[8];      // 診断用: 直接の呼びかけ（SELECT）で、駒を確かめられた回数
static uint32_t directFailCount[8];    // 診断用: 直接の呼びかけを試したが、確かめられなかった回数（駒が外れた・入れ替わった・電波が届かない）

int readerSsPin(int i) { return PINS[i].ss; }
int readerRstPin(int i) { return PINS[i].rst; }
bool readerIsAlive(int i) { return alive[i]; }
IdleMethod readersIdleMethod() { return method; }
int readersLastSelfTestFailures() { return lastSelfTestFailures; }
uint32_t readersSlowWakeCount() { return slowWakeCount; }

const char* readersIdleMethodName(IdleMethod m) {
  return m == IDLE_RESET ? "RESET（チップごと止める）" : "アンテナOFF（電波だけ止める）";
}

// ------------------------------------------------------------
// 受信感度
// ------------------------------------------------------------
struct GainEntry {
  uint8_t db;
  uint8_t mask;
};
static const GainEntry GAINS[] = {
    {18, MFRC522::RxGain_18dB}, {23, MFRC522::RxGain_23dB}, {33, MFRC522::RxGain_33dB},
    {38, MFRC522::RxGain_38dB}, {43, MFRC522::RxGain_43dB}, {48, MFRC522::RxGain_48dB},
};

bool readersGainValid(uint8_t db) {
  for (const GainEntry& g : GAINS) {
    if (g.db == db) return true;
  }
  return false;
}

uint8_t readersGainDb() {
  for (const GainEntry& g : GAINS) {
    if (g.mask == rxGainMask) return g.db;
  }
  return 33;
}

// ------------------------------------------------------------
// 1台ごとの「起こす」「止める」
// ------------------------------------------------------------

// タグの返事を待つ時間（TimerReg）と、受信感度を、リーダーに設定する
static void applyScanSettings(int i) {
  uint16_t reload = (uint16_t)timeoutMs * 40;  // タイマーは 25µs ごとに数える → 1ms = 40
  mfrc[i].PCD_WriteRegister(MFRC522::TReloadRegH, (uint8_t)(reload >> 8));
  mfrc[i].PCD_WriteRegister(MFRC522::TReloadRegL, (uint8_t)(reload & 0xFF));
  mfrc[i].PCD_SetAntennaGain(rxGainMask);  // RxGain の3ビットだけを書き換える（ほかのビットは、そのまま）
  mfrc[i].PCD_WriteRegister(MFRC522::CWGsPReg, cwGsP);  // アンテナの駆動の強さ
  mfrc[i].PCD_WriteRegister(MFRC522::RxThresholdReg, (uint8_t)((rxMinLevel << 4) | RX_COLL_LEVEL));  // 受信のしきい値
}

// 確実な起こし方（ライブラリの標準）。リセットして、約60ms かけて初期化する
static void wakeSlow(int i) {
  digitalWrite(PINS[i].rst, LOW);
  delay(2);
  digitalWrite(PINS[i].rst, HIGH);  // 止めていたのをやめる
  delay(10);                        // 内部の発振が安定するのを待つ
  mfrc[i].PCD_Init(PINS[i].ss, MFRC522::UNUSED_PIN);  // 初期化（アンテナはONになる）。RSTはこちらで管理するので UNUSED
  applyScanSettings(i);
}

// 速い起こし方。RST を HIGH にして、SPI で読めるようになるまで（約1〜2ms）だけ待ち、
// ライブラリの PCD_Init と同じレジスタ設定を、リセットの待ち時間（約50ms）なしで行う。
// 読めるようにならなければ false（そのときは、確実な起こし方にする）
static bool wakeFast(int i) {
  digitalWrite(PINS[i].rst, HIGH);
  // 発振が安定するまで、バージョンが正しく読めるのを待つ（2回続けて合えば、起きている）
  uint32_t start = millis();
  int good = 0;
  while (millis() - start < 20) {
    delayMicroseconds(300);
    uint8_t v = mfrc[i].PCD_ReadRegister(MFRC522::VersionReg);
    good = (v == baseVersion[i]) ? good + 1 : 0;
    if (good >= 2) break;
  }
  if (good < 2) return false;

  MFRC522& m = mfrc[i];
  m.PCD_WriteRegister(MFRC522::TxModeReg, 0x00);
  m.PCD_WriteRegister(MFRC522::RxModeReg, 0x00);
  m.PCD_WriteRegister(MFRC522::ModWidthReg, 0x26);
  m.PCD_WriteRegister(MFRC522::TModeReg, 0x80);       // タイマーを自動で始める
  m.PCD_WriteRegister(MFRC522::TPrescalerReg, 0xA9);  // タイマーは 25µs ごと
  m.PCD_WriteRegister(MFRC522::TxASKReg, 0x40);
  m.PCD_WriteRegister(MFRC522::ModeReg, 0x3D);
  applyScanSettings(i);
  m.PCD_AntennaOn();
  return true;
}

// RST=LOW で止まっているリーダーを起こして、初期化する
static void wake(int i) {
  if (!inReset[i]) return;
  // バージョン値がまだ分かっていない（起動時の確認の前）ときは、確実な方法を使う
  lastWakeFast = (baseVersion[i] != 0) && wakeFast(i);
  if (!lastWakeFast) {
    if (baseVersion[i] != 0) slowWakeCount++;  // 速い方法が失敗した（起動時の確認の前は、数えない）
    wakeSlow(i);
  }
  inReset[i] = false;
}

// RST=LOW にして、チップごと止める
static void holdInReset(int i) {
  digitalWrite(PINS[i].rst, LOW);
  inReset[i] = true;
}

// 使っていない間の状態にする（止め方は method で決まる）
static void park(int i) {
  if (method == IDLE_RESET) {
    holdInReset(i);
  } else {
    wake(i);
    mfrc[i].PCD_AntennaOff();  // 電波だけ止める
  }
}

// ------------------------------------------------------------
// 起動・確認
// ------------------------------------------------------------

bool readersProbe(int i, uint8_t* version) {
  // いったん止めてから起こして、確実に初期化し直す（バージョン値が分かるまでは、確実な起こし方）
  baseVersion[i] = 0;
  holdInReset(i);
  delay(2);
  wake(i);
  uint8_t v = mfrc[i].PCD_ReadRegister(MFRC522::VersionReg);
  alive[i] = (v != 0x00 && v != 0xFF);
  baseVersion[i] = alive[i] ? v : 0;
  if (version != nullptr) *version = v;

  if (alive[i]) {
    park(i);
  } else {
    holdInReset(i);  // 応答しないリーダーは、バスの邪魔にならないよう止めておく
  }
  return alive[i];
}

void readersBegin(int sckPin, int misoPin, int mosiPin) {
  // 先に、全員のSSをHIGH（選ばれていない）、RSTをLOW（止めておく）にする
  for (int i = 0; i < NUM_READERS; i++) {
    pinMode(PINS[i].ss, OUTPUT);
    digitalWrite(PINS[i].ss, HIGH);
    pinMode(PINS[i].rst, OUTPUT);
    digitalWrite(PINS[i].rst, LOW);
    inReset[i] = true;
    alive[i] = false;
  }

  // SPIを開始する。最後の -1 は「SSはライブラリが1本ずつ手動で切り替えるので、SPI側では使わない」の意味
  SPI.begin(sckPin, misoPin, mosiPin, -1);
  // このあと、リーダーごとに readersProbe() を呼んで、応答するか確かめる
}

// 止め方 m で、全リーダーを1台ずつ起こして、正しく読めるかを確かめる。失敗したリーダーの数を返す。
// （RESET方式では、止まっているリーダーが多いほど MISO の線を邪魔しないかも、ここで分かる）
static int selfTest(IdleMethod m) {
  IdleMethod saved = method;
  method = m;
  for (int i = 0; i < NUM_READERS; i++) {
    if (alive[i]) park(i);  // まず全員を、その止め方の状態にする
  }
  int failures = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!alive[i]) continue;
    wake(i);
    bool good = lastWakeFast;  // 速い起こし方で起きなかったら、診断は失敗（遅いと、音のタイミングが崩れる）
    for (int k = 0; k < 20; k++) {
      if (mfrc[i].PCD_ReadRegister(MFRC522::VersionReg) != baseVersion[i]) good = false;
    }
    if (mfrc[i].PCD_ReadRegister(MFRC522::TModeReg) != 0x80) good = false;  // 設定が書けているか
    if (!good) failures++;
    park(i);
  }
  method = saved;
  return failures;
}

bool readersSetIdleMethod(IdleMethod newMethod, bool verify) {
  if (verify && newMethod == IDLE_RESET) {
    lastSelfTestFailures = selfTest(IDLE_RESET);
    if (lastSelfTestFailures > 0) {
      // 診断に失敗した。止め方は変えず、全員を元の止め方の状態に戻す
      for (int i = 0; i < NUM_READERS; i++) {
        if (alive[i]) park(i);
      }
      return false;
    }
  }
  lastSelfTestFailures = 0;
  method = newMethod;
  for (int i = 0; i < NUM_READERS; i++) {
    if (alive[i]) park(i);
  }
  return true;
}

bool readersSetRfPower(uint8_t v) {
  if (v < 0x01 || v > 0x3F) return false;
  cwGsP = v;
  for (int i = 0; i < NUM_READERS; i++) {
    if (alive[i] && !inReset[i]) mfrc[i].PCD_WriteRegister(MFRC522::CWGsPReg, cwGsP);
  }
  return true;
}
uint8_t readersRfPower() { return cwGsP; }
bool readersSetRxMinLevel(uint8_t level) {
  if (level > 15) return false;
  rxMinLevel = level;
  for (int i = 0; i < NUM_READERS; i++) {
    if (alive[i] && !inReset[i]) mfrc[i].PCD_WriteRegister(MFRC522::RxThresholdReg, (uint8_t)((rxMinLevel << 4) | RX_COLL_LEVEL));
  }
  return true;
}
uint8_t readersRxMinLevel() { return rxMinLevel; }
void readersDebugAntennaOff(bool off) { dbgAntennaOff = off; }

bool readersSetGainDb(uint8_t db) {
  for (const GainEntry& g : GAINS) {
    if (g.db != db) continue;
    rxGainMask = g.mask;
    for (int i = 0; i < NUM_READERS; i++) {
      // 起きているリーダーには、すぐに反映する。止まっているリーダーは、次に起こすときに設定される
      if (alive[i] && !inReset[i]) mfrc[i].PCD_SetAntennaGain(rxGainMask);
    }
    return true;
  }
  return false;
}

// ------------------------------------------------------------
// タグの読み取り
// ------------------------------------------------------------

// 読み取りの本体。diag が nullptr でなければ、中身を記録する（診断用。動作は同じ）
static bool scanCore(int i, TagUid* uid, ScanDiag* diag) {
  if (!alive[i]) return false;
  uint32_t t0 = micros();
  if (diag != nullptr) {
    memset(diag, 0, sizeof(*diag));
    diag->wasInReset = inReset[i];
    diag->wupaStatus = -1;
  }

  wake(i);                   // RST方式のときは、ここで起こす
  uint32_t t1 = micros();
  if (dbgAntennaOff) mfrc[i].PCD_AntennaOff();   // 診断用: 電波を出さずに読んでみる
  else mfrc[i].PCD_AntennaOn();                  // このリーダーだけ電波を出す
  if (diag != nullptr) {
    diag->wokeFast = diag->wasInReset ? lastWakeFast : true;
    diag->wakeUs = t1 - t0;
    diag->version = mfrc[i].PCD_ReadRegister(MFRC522::VersionReg);
    diag->txControl = mfrc[i].PCD_ReadRegister(MFRC522::TxControlReg);
  }
  delay(settleMs);           // タグが電波で目を覚ますのを待つ

  bool found = false;
  uint8_t atqa[2];
  uint8_t atqaSize = sizeof(atqa);
  // PICC_WakeupA: 「そこにいるタグ、起きて」と呼びかける。
  // 前に PICC_HaltA で眠らせたタグも起こせるので、置きっぱなしのタグを何度でも読める
  MFRC522::StatusCode status = mfrc[i].PICC_WakeupA(atqa, &atqaSize);
  if (diag != nullptr) {
    diag->wupaStatus = (int)status;
    diag->errorReg = mfrc[i].PCD_ReadRegister(MFRC522::ErrorReg);
  }
  if (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION) {
    if (mfrc[i].PICC_ReadCardSerial()) {  // UIDを読む
      uid->size = mfrc[i].uid.size;
      memset(uid->bytes, 0, sizeof(uid->bytes));
      memcpy(uid->bytes, mfrc[i].uid.uidByte, mfrc[i].uid.size);
      found = true;
      if (diag != nullptr) diag->serialOk = true;
      mfrc[i].PICC_HaltA();  // タグを眠らせる
    }
  }

  park(i);  // 読み終わったら、静かな状態に戻す
  if (diag != nullptr) {
    diag->found = found;
    diag->totalUs = micros() - t0;
  }
  return found;
}

bool readersScanOne(int i, TagUid* uid) { return scanCore(i, uid, nullptr); }

// リーダー i の電波の届く範囲にいる駒を、全部読む。level が 0 以上なら、その段の受信感度（GAINS の番号）で読む（この1回だけ）
static int scanAllCore(int i, TagUid* out, int maxTags, int level, int sub = 0) {
  if (!alive[i] || maxTags <= 0) return 0;
  const bool useHint = hintSet[i];       // 1回だけ有効
  const bool quick = hintQuick[i];
  TagUid hu = hintUid[i];
  hintSet[i] = false;
  hintQuick[i] = false;
  bool quickDone = false;
  wake(i);
  bool override = level >= 0 && level < (int)(sizeof(GAINS) / sizeof(GAINS[0]));
  if (override) mfrc[i].PCD_SetAntennaGain(GAINS[level].mask);
  bool subOverride = override && sub != 0;
  if (subOverride) {   // 受信のしきい値 MinLevel を、標準(8)から sub だけ下げる（sub が負なら上げる）。2 以下は雑音で読めなくなるので使わない
    int ml = (int)rxMinLevel - sub;
    if (ml < 3) ml = 3;
    if (ml > 15) ml = 15;
    mfrc[i].PCD_WriteRegister(MFRC522::RxThresholdReg, (uint8_t)((ml << 4) | RX_COLL_LEVEL));
  }
  if (dbgAntennaOff) mfrc[i].PCD_AntennaOff();
  else mfrc[i].PCD_AntennaOn();
  delay(settleMs);
  int n = 0;
  uint8_t atqa[2];
  uint8_t atqaSize = sizeof(atqa);
  bool firstSerialFailed = false;
  // 1枚目は WUPA（眠っているタグも起こす）。そのあとは REQA（HALT したタグは答えない。まだ眠っていないタグだけが答える）
  uint32_t wupaT0 = micros();
  MFRC522::StatusCode status = mfrc[i].PICC_WakeupA(atqa, &atqaSize);
  const uint32_t wupaUs = micros() - wupaT0;
  const MFRC522::StatusCode wupaStatus = status;
  // 載っているはずの駒の UID が分かっているときは、衝突回避をせず、直接「この UID の駒、答えて」と呼びかける（SELECT）。
  // 隣の駒が同時に答えても、一致する駒だけが答える。衝突回避の途中で失敗する（UID を読めない）ことが、なくなる。
  // 失敗したときは、そのまま、ふつうの読み方に進む（駒が入れ替わったのかもしれない）
  if (useHint && hu.size > 0 && hu.size <= 10 && (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION)) {
    MFRC522::Uid su;
    memset(&su, 0, sizeof(su));
    su.size = hu.size;
    memcpy(su.uidByte, hu.bytes, hu.size);
    if (mfrc[i].PICC_Select(&su, (byte)(hu.size * 8)) == MFRC522::STATUS_OK) {
      out[n++] = hu;
      directOkCount[i]++;
      if (quick) {
        // 確かめるだけ: 駒は、このまま（電波を止めると、駒は、最初の状態にもどる）。HALT（駒が答えないので、約10ms 待つ）と、
        // ほかの駒を探す REQA（眠らせた駒は答えないので、また約10ms 待つ）は、しない。1台あたり約34ms → 約14ms
        quickDone = true;
        status = MFRC522::STATUS_TIMEOUT;   // このあとの「ほかの駒を読む」ループには、入らない
      } else {
        mfrc[i].PICC_HaltA();
        atqaSize = sizeof(atqa);
        status = mfrc[i].PICC_RequestA(atqa, &atqaSize);   // ほかの駒（隣の駒）が、まだ眠っていなければ、続けて読む
      }
    } else {
      directFailCount[i]++;
    }
  }
  while (n < maxTags && (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION)) {
    if (!mfrc[i].PICC_ReadCardSerial()) {
      if (n == 0) firstSerialFailed = true;
      break;
    }
    TagUid u;
    u.size = mfrc[i].uid.size;
    memset(u.bytes, 0, sizeof(u.bytes));
    memcpy(u.bytes, mfrc[i].uid.uidByte, mfrc[i].uid.size);
    bool dup = false;
    for (int k = 0; k < n; k++) {
      if (out[k].size == u.size && memcmp(out[k].bytes, u.bytes, u.size) == 0) dup = true;
    }
    if (dup) break;   // 同じタグをもう1度読んだ（眠らせられていない）。これ以上は数えない
    out[n++] = u;
    mfrc[i].PICC_HaltA();
    atqaSize = sizeof(atqa);
    status = mfrc[i].PICC_RequestA(atqa, &atqaSize);
  }
  // 駒を1枚も読めなかったとき: 何も答えない（タイムアウト）なら「駒がない」。返事はあったのに読めなかった（衝突・エラー）なら、
  // 駒が、ある・ないは分からない（電波の乱れ）。後者は、「外れた」の証拠にしない（HardwareRf::scan が、負の値で知らせる）
  // 「タイムアウト」でも、待ち時間いっぱい待たずに、すぐ失敗したときは、本当に「何も答えなかった」とは言えない（チップの設定が乱れたなど）ので、同じく乱れとする
  const bool fastTimeout = (wupaStatus == MFRC522::STATUS_TIMEOUT) && (wupaUs < (uint32_t)timeoutMs * 600u);   // 待ち時間（ms）の 6 割（µs に直すと ×600）より短い
  (void)quickDone;
  const bool garbled = (n == 0) && (firstSerialFailed || fastTimeout || (wupaStatus != MFRC522::STATUS_OK && wupaStatus != MFRC522::STATUS_COLLISION && wupaStatus != MFRC522::STATUS_TIMEOUT));
  lastScanGarbled[i] = garbled;
  if (garbled) {
    garbleStatus[i] = firstSerialFailed ? (int8_t)100 : (int8_t)wupaStatus;
    garbleUs[i] = wupaUs;
  }
  if (override) mfrc[i].PCD_SetAntennaGain(rxGainMask);   // 標準の感度に戻す（アンテナOFF方式では、チップが起きたままなので）
  if (subOverride) mfrc[i].PCD_WriteRegister(MFRC522::RxThresholdReg, (uint8_t)((rxMinLevel << 4) | RX_COLL_LEVEL));
  park(i);
  return n;
}

int readersScanAll(int i, TagUid* out, int maxTags) { return scanAllCore(i, out, maxTags, -1); }
bool readersScanDiag(int i, TagUid* uid, ScanDiag* diag) { return scanCore(i, uid, diag); }

void readersSetTiming(uint8_t newSettleMs, uint8_t newTimeoutMs) {
  settleMs = newSettleMs;
  timeoutMs = newTimeoutMs;
  uint16_t reload = (uint16_t)timeoutMs * 40;
  for (int i = 0; i < NUM_READERS; i++) {
    // 起きているリーダーには、すぐ反映する。止まっているリーダーは、次に起こすときに設定される
    if (alive[i] && !inReset[i]) {
      mfrc[i].PCD_WriteRegister(MFRC522::TReloadRegH, (uint8_t)(reload >> 8));
      mfrc[i].PCD_WriteRegister(MFRC522::TReloadRegL, (uint8_t)(reload & 0xFF));
    }
  }
}
uint8_t readersSettleMs() { return settleMs; }
uint8_t readersTimeoutMs() { return timeoutMs; }

// ------------------------------------------------------------
// 通常の動作: 「置かれた」「外れた」の見張り
//   どのリーダーにどの駒が載っているかを決める仕事は、array_tracker.cpp（Arduino に依存しない部品）がする。
//   ここは、その部品に、本物のリーダーの読み取り（ArrayRf）を渡すだけ。
//   隣のリーダーが同じ駒を読んでしまう（影）ときは、一番弱い電波から読めるリーダーを、持ち主にする。
// ------------------------------------------------------------
static uint32_t avgScanUs = 0;   // 標準の感度で1台を読むのにかかった時間の、最近の平均（µs。診断用）

class HardwareRf : public ArrayRf {
 public:
  bool alive(int reader) override { return readerIsAlive(reader); }
  int scan(int reader, int level, int sub, TagUid* out, int maxTags) override {
    uint32_t t0 = micros();
    lastScanGarbled[reader] = false;
    int n = scanAllCore(reader, out, maxTags, level, sub);
    if (level < 0) {   // 比べ読みは含めない（標準の感度での、巡回の1台ぶんだけ）
      uint32_t us = micros() - t0;
      avgScanUs = (avgScanUs == 0) ? us : (avgScanUs * 7 + us) / 8;
    }
    if (n == 0 && lastScanGarbled[reader]) return ArrayRf::SCAN_GARBLED;   // 返事はあったのに読めなかった（駒が、ある・ないは、分からない）
    return n;
  }
  int knownCount() override { return tagStoreCount(); }
  bool knownAt(int index, TagUid* out) override {
    uint8_t cid;
    return tagStoreGet(index, out, &cid);
  }
  void hint(int reader, const TagUid* expected, bool confirmOnly) override {
    if (reader < 0 || reader >= 8) return;
    hintSet[reader] = expected != nullptr;
    hintQuick[reader] = expected != nullptr && confirmOnly;
    if (expected != nullptr) hintUid[reader] = *expected;
  }
  int defaultLevel() override {
    for (int k = 0; k < (int)(sizeof(GAINS) / sizeof(GAINS[0])); k++) {
      if (GAINS[k].mask == rxGainMask) return k;
    }
    return 2;   // 標準の 33 dB
  }
  int levelCount() override { return (int)(sizeof(GAINS) / sizeof(GAINS[0])); }
  uint32_t nowMs() override { return millis(); }
};
static HardwareRf hardwareRf;
static ArrayTracker tracker(&hardwareRf, NUM_READERS);

int readersAliveCount() {
  int n = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    if (alive[i]) n++;
  }
  return n;
}

bool readerHasTag(int i) { return tracker.hasTag(i); }
const TagUid& readerTagUid(int i) { return tracker.uid(i); }
bool readerIsShadow(int i) { return tracker.isShadow(i); }
int readerShadowOwner(int i) { return tracker.shadowOwner(i); }
uint32_t readersArbitrationCount() { return tracker.arbitrationCount(); }
uint32_t readersAvgScanUs() { return avgScanUs; }

static uint32_t reportedVerdicts = 0;
bool readersTakeVerdict(ReaderVerdict* out) {
  if (tracker.verdictCount() == reportedVerdicts) return false;
  reportedVerdicts = tracker.verdictCount();
  const ArrayTracker::VerdictInfo& v = tracker.lastVerdict();
  out->uid = v.uid;
  out->n = v.n;
  for (int i = 0; i < 8; i++) {
    out->reader[i] = (i < v.n) ? v.reader[i] : -1;
    out->score[i] = (i < v.n) ? v.score[i] : 0;
  }
  out->foundDb = (v.foundLevel >= 0 && v.foundLevel < (int)(sizeof(GAINS) / sizeof(GAINS[0]))) ? GAINS[v.foundLevel].db : 0;
  out->winner = v.winner;
  out->recheck = v.recheck;
  out->fineRan = v.fineRan;
  out->fineSub = v.fineSub;
  out->fineWinner = v.fineWinner;
  return true;
}

static const char* causeText(ArrayTracker::EventCause c) {
  switch (c) {
    case ArrayTracker::CAUSE_NEW:      return "新しく見えた駒が、持ち主に決まった";
    case ArrayTracker::CAUSE_WON:      return "比べ読みで、持ち主に決まった";
    case ArrayTracker::CAUSE_MISS:     return "駒が、続けて読めなくなった";
    case ArrayTracker::CAUSE_LOST:     return "比べ読みで負けて、駒の持ち主が、別のリーダーに移った";
    case ArrayTracker::CAUSE_BUMP_OUT: return "同点だったので、空いている別のリーダーへ移ってもらった";
    case ArrayTracker::CAUSE_BUMP_IN:  return "同点だったので、別のリーダーから移ってきた";
    case ArrayTracker::CAUSE_SWAP_OUT: return "2枚が場所を取り合っていたので、入れ替えた（外れた側）";
    case ArrayTracker::CAUSE_SWAP_IN:  return "2枚が場所を取り合っていたので、入れ替えた（置かれた側）";
    case ArrayTracker::CAUSE_STALE:    return "読めなくなっていた古い駒を、新しい駒に入れ替えた";
    case ArrayTracker::CAUSE_GARBLED:  return "返事はあったのに読めない読み取りが続いた（電波の乱れ）";
    case ArrayTracker::CAUSE_RESCUED:  return "高い感度で読み直したら、駒がいた";
    case ArrayTracker::CAUSE_ABSORBED: return "読めなくなったが、外れたと決める前に、また読めた";
  }
  return "";
}

bool readersTakeEventNote(ReaderEventNote* out) {
  ArrayTracker::EventNote n;
  if (!tracker.takeNote(&n)) return false;
  out->type = n.type;
  out->reader = n.reader;
  out->uid = n.uid;
  out->cause = causeText(n.cause);
  out->byMiss = n.cause == ArrayTracker::CAUSE_MISS;
  out->garbled = n.cause == ArrayTracker::CAUSE_GARBLED;
  out->rescued = n.cause == ArrayTracker::CAUSE_RESCUED;
  out->absorbed = n.cause == ArrayTracker::CAUSE_ABSORBED;
  out->wupaStatus = (n.reader >= 0 && n.reader < 8) ? garbleStatus[n.reader] : 0;
  out->wupaUs = (n.reader >= 0 && n.reader < 8) ? garbleUs[n.reader] : 0;
  out->miss = n.miss;
  out->missMs = n.missMs;
  return true;
}

int readersGainLevels() { return (int)(sizeof(GAINS) / sizeof(GAINS[0])); }
int readersGainDbAt(int level) { return (level >= 0 && level < readersGainLevels()) ? GAINS[level].db : 0; }

bool readersMarginTest(int reader, int tries, int* hits) {
  if (reader < 0 || reader >= NUM_READERS || !tracker.hasTag(reader) || !alive[reader]) return false;
  const TagUid u = tracker.uid(reader);
  for (int lv = 0; lv < readersGainLevels(); lv++) {
    hits[lv] = 0;
    for (int t = 0; t < tries; t++) {
      hintUid[reader] = u;
      hintSet[reader] = true;     // 持ち主の UID を、直接呼びかける（衝突回避の失敗を、数えない。純粋に「その感度で、電波が届くか」を見る）
      TagUid out[2];
      int n = scanAllCore(reader, out, 2, lv);
      for (int j = 0; j < n; j++) {
        if (out[j].size == u.size && memcmp(out[j].bytes, u.bytes, u.size) == 0) { hits[lv]++; break; }
      }
    }
  }
  return true;
}

bool readersStatsGet(int reader, ReaderStatsInfo* out) {
  if (reader < 0 || reader >= NUM_READERS) return false;
  const ArrayTracker::ReaderStats& s = tracker.stats(reader);
  out->hits = s.hits;
  out->misses = s.misses;
  out->garbled = s.garbled;
  out->rescueTries = s.rescueTries;
  out->rescued = s.rescued;
  out->absorbed = s.absorbed;
  out->longestMs = s.longestMs;
  out->removedByMiss = s.removedByMiss;
  out->directOk = directOkCount[reader];
  out->directFail = directFailCount[reader];
  out->guesses = tracker.stats(reader).guesses;
  out->guessHits = tracker.stats(reader).guessHits;
  return true;
}
void readersStatsReset() {
  tracker.resetStats();
  for (int i = 0; i < 8; i++) { directOkCount[i] = 0; directFailCount[i] = 0; }
}

void readersResetPresence() {
  tracker.reset();
  reportedVerdicts = 0;
}

// ---- 診断用（RETEST）----
static int retestReader = -1;          // 測定中のリーダー（-1 = 測定していない）
static uint32_t retestStartMs = 0;
static TagUid retestUid;
static bool retestHaveResult = false;  // 結果が、まだ取り出されていない
static int retestResultReader = 0;
static uint32_t retestResultMs = 0;
static bool retestResultOk = false;

bool readersRetest(int reader) {
  if (retestReader >= 0 || retestHaveResult) return false;
  TagUid u;
  if (!tracker.forgetOwner(reader, &u)) return false;
  retestReader = reader;
  retestUid = u;
  retestStartMs = millis();
  return true;
}

bool readersTakeRetestResult(int* reader, uint32_t* ms, bool* ok) {
  if (!retestHaveResult) return false;
  retestHaveResult = false;
  *reader = retestResultReader;
  *ms = retestResultMs;
  *ok = retestResultOk;
  return true;
}

bool readersPollNext(ReaderEvent* event) {
  bool got = tracker.poll(event);
  if (retestReader >= 0) {
    uint32_t elapsed = millis() - retestStartMs;
    if (got && event->type == READER_EVENT_PLACED && event->uid.size == retestUid.size && memcmp(event->uid.bytes, retestUid.bytes, retestUid.size) == 0) {
      retestHaveResult = true;
      retestResultReader = retestReader;
      retestResultMs = elapsed;
      retestResultOk = (event->reader == retestReader);
      if (!retestResultOk) tracker.forgetOwner(event->reader, nullptr);   // 別のリーダーの持ち主になってしまった: その記録を取り消す（盤面は、変わっていない）
      retestReader = -1;
      return false;   // 診断のための「置かれた」は、上へ渡さない
    }
    if (elapsed > 15000) {   // 見つからないまま長引いた: あきらめる
      retestHaveResult = true;
      retestResultReader = retestReader;
      retestResultMs = 0;
      retestResultOk = false;
      retestReader = -1;
    }
  }
  return got;
}

void readersScanUntilSettled(uint32_t maxMs) {
  int aliveCount = readersAliveCount();
  if (aliveCount == 0) return;
  uint32_t start = millis();
  uint32_t minScans = (uint32_t)aliveCount * 2;   // 最低でも2周は読む（1周目に見えた駒を、2周目で確かめる）
  ReaderEvent ignored;
  while ((uint32_t)(millis() - start) < maxMs) {
    readersPollNext(&ignored);   // 見つけた駒の知らせは捨てる（持ち主の記録は、部品の中に残る）
    if (tracker.scanCount() >= minScans && !tracker.busy()) break;
  }
}

// ------------------------------------------------------------
// 通信テスト
// ------------------------------------------------------------

void readersVersionTest(int rounds, bool holdOthersInReset, int* okCount, int* errCount) {
  for (int i = 0; i < NUM_READERS; i++) okCount[i] = errCount[i] = 0;

  if (!holdOthersInReset) {
    // 全員を起こしたまま、SSだけを切り替えて交互に読む
    for (int j = 0; j < NUM_READERS; j++) {
      if (alive[j]) wake(j);
    }
    for (int r = 0; r < rounds; r++) {
      for (int i = 0; i < NUM_READERS; i++) {
        if (!alive[i]) continue;
        uint8_t v = mfrc[i].PCD_ReadRegister(MFRC522::VersionReg);
        if (v == baseVersion[i]) okCount[i]++; else errCount[i]++;
      }
    }
  } else {
    // 1台ずつ起こし、ほかはRST=LOWで止めて読む
    for (int i = 0; i < NUM_READERS; i++) {
      if (!alive[i]) continue;
      for (int j = 0; j < NUM_READERS; j++) {
        if (j != i && alive[j]) holdInReset(j);
      }
      wake(i);
      for (int r = 0; r < rounds; r++) {
        uint8_t v = mfrc[i].PCD_ReadRegister(MFRC522::VersionReg);
        if (v == baseVersion[i]) okCount[i]++; else errCount[i]++;
      }
    }
  }

  // テストの前の状態（いまの止め方）に戻す
  for (int j = 0; j < NUM_READERS; j++) {
    if (alive[j]) park(j);
  }
}
