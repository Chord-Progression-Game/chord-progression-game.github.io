// ============================================================
// RC522 テストモード
//
//   通常の動作中に x を入力して Enter を押すと入る。q で通常の動作に戻る。
//   目的: 複数のRC522を同じSPIバスにつないで、次を確かめる
//     1. すべてのRC522と、正しく通信できるか（MISOを共有しても、データが壊れないか）
//     2. リーダーごとに、別々にタグのUIDを読めるか
//     3. 片方にタグを置いたとき、ほかのリーダーが反応（誤読）しないか
//     4. 使っていないリーダーの止め方（アンテナOFF / RESET）と受信感度で、隣のリーダーとの干渉がどう変わるか（c）
//   登録済みタグの内容（Ⅳ など）を表示するために、保存データを「読むだけ」使う。書き換えはしない。
// ============================================================
#include "rc522_test.h"

#include <Arduino.h>
#include <ctype.h>
#include <string.h>

#include "chords.h"
#include "config.h"
#include "reader_array.h"
#include "settings_store.h"
#include "tag_store.h"
#include "ui_util.h"

static bool active = false;  // テストモード中か

// このファイルの中だけで使う部品
namespace {

// ------------------------------------------------------------
// 読み取りモード（s）で使う、位置ごとの状態
// ------------------------------------------------------------
struct Slot {
  bool present;   // いまタグが載っているか
  TagUid uid;     // 載っているタグのUID
  uint8_t miss;   // 連続で「見つからなかった」回数（1回の読み損ないで「外れた」と判断しないため）
};
Slot slots[NUM_READERS];

// テストに入ったときの設定。m や g で試しに変えても、q で終わるときに、この設定に戻す
// （保存したい設定は、c の結果の y か、テストの外の IDLE ・ GAIN コマンドで変える）
IdleMethod entryIdle = IDLE_ANTENNA_OFF;
uint8_t entryGain = DEFAULT_RX_GAIN_DB;
// c の結果で「おすすめ」を出して、y / n の返事を待っているか
bool recommendPending = false;
IdleMethod recommended = DEFAULT_IDLE_METHOD;

const uint8_t GAIN_ORDER[] = {18, 23, 33, 38, 43, 48};  // g で順に切り替える

bool scanning = false;            // 読み取りモード中か
uint32_t cycles = 0;              // 何周したか
uint32_t cycleMsTotal = 0;        // 周回にかかった時間の合計
uint32_t hits[NUM_READERS];       // リーダーごとに「タグを読めた」回数

// ------------------------------------------------------------
// 表示
// ------------------------------------------------------------

// 例: "UID: 04 A1 B2 C3 → Ⅳ"  /  "UID: 04 A1 B2 C3 → (未登録)"
void printTag(const TagUid& uid) {
  Serial.print("UID: ");
  printUidBytes(uid);
  const Chord* chord = chordById(tagStoreFind(uid));
  Serial.printf(" → %s", chord ? chord->name : "(未登録)");
}

bool sameUid(const TagUid& a, const TagUid& b) {
  return a.size == b.size && memcmp(a.bytes, b.bytes, a.size) == 0;
}

void printHelp() {
  Serial.println();
  Serial.println("=== RC522 テストモード ===");
  Serial.println("  i: リーダーの確認（応答するか、バージョンはいくつか）");
  Serial.println("  v: 通信テスト A（全リーダーを起こしたまま、SSだけ切り替えて交互に読む）");
  Serial.println("  w: 通信テスト B（読まない方をRST=LOWで止めて読む）");
  Serial.printf("  1〜%d: 位置テスト（その番号のリーダーにだけタグを置いて、5秒間の合否を見る）\n", NUM_READERS);
  Serial.println("  a: 全台同時テスト（全リーダーに、別々のタグを置いて、5秒間の合否を見る）");
  Serial.println("  s: 読み取り開始 / 停止（置く・外す・交換を表示。停止すると結果が出る）");
  Serial.println("  c: 止め方の比較テスト（アンテナOFF と RESET を、続けて測って、隣のリーダーとの干渉が少ない方を選ぶ）");
  Serial.println("  t: 読めないときの原因調べ（止め方×待ち時間を総当たりで試す。タグを1枚、読めないリーダーに置いて実行）");
  Serial.println("  k: 隣のリーダーを読む原因調べ（各リーダーが、どのタグを読めるか。電波なし・感度を下げる・出力を弱める、で比べる）");
  Serial.println("  p: アンテナの出力を、試しに切り替える（標準 0x20 → 0x18 → 0x10 → 0x0C → 0x08）");
  Serial.println("  l: 感度の階段テスト（各リーダーが、どの強さから、どのタグを読めるか。弱い方から強い方へ試す）");
  Serial.println("  f: 感度×出力の格子テスト（受信感度4段 × 出力4段の16通りで、各リーダーが、どのタグを何回読めるか。影の見分けを細かくするための測定）");
  Serial.println("  o: モニターで読む順番を切り替える（1→8 / 8→1 / 5〜8だけ / 1〜4だけ / 2・3・4 を読まない）");
  Serial.println("  n: 見え方の連続モニター（各リーダーが、どのタグを、どの受信感度の範囲で読めるかを、変化したときだけ表示。例: R5:B[18-38] = リーダー5はタグBを 18〜38dB で読める（43dB 以上は信号が強すぎて読めない）。駒を動かして試すとき用。もう一度 n で停止）");
  Serial.println("  m: 使っていないリーダーの止め方を、試しに切り替える（アンテナOFF ⇔ RESET）");
  Serial.println("  g: 受信感度を、試しに切り替える（18 → 23 → 33 → 38 → 43 → 48 dB）");
  Serial.println("  h: このヘルプ");
  Serial.println("  q: テストを終了して、通常の動作に戻る（m・g で試しに変えた設定は、ここで元に戻る）");
}

// いまの止め方と受信感度（結果を教えてもらうときに、どの設定の結果か分かるように、各テストの最初に表示する）
void printSettings() {
  Serial.printf("設定: 止め方 = %s ／ 受信感度 = %d dB ／ アンテナの出力 = 0x%02X（標準 0x20）\n", readersIdleMethodName(readersIdleMethod()), readersGainDb(), readersRfPower());
}

// ------------------------------------------------------------
// 確認・通信テスト
// ------------------------------------------------------------
void showReaders() {
  Serial.println();
  Serial.println("--- リーダーの確認 ---");
  int aliveCount = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    uint8_t version;
    bool ok = readersProbe(i, &version);
    Serial.printf("リーダー%d (SS=GPIO%d, RST=GPIO%d): ", i + 1, readerSsPin(i), readerRstPin(i));
    if (ok) {
      Serial.printf("応答あり  バージョン 0x%02X\n", version);
      aliveCount++;
    } else {
      Serial.printf("応答なし (0x%02X)  → 配線を確認してください。このリーダーは使いません\n", version);
    }
  }
  Serial.printf("応答したリーダー: %d / %d 台\n", aliveCount, NUM_READERS);
}

void runVersionTest(bool holdOthersInReset) {
  const int ROUNDS = 300;
  Serial.println();
  Serial.printf("--- 通信テスト %s（各リーダーを %d 回ずつ読む）---\n", holdOthersInReset ? "B" : "A", ROUNDS);
  int ok[NUM_READERS], err[NUM_READERS];
  readersVersionTest(ROUNDS, holdOthersInReset, ok, err);

  int totalErr = 0, tested = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) {
      Serial.printf("リーダー%d: 応答がないのでテストしていません\n", i + 1);
      continue;
    }
    tested++;
    totalErr += err[i];
    Serial.printf("リーダー%d: 正常 %d 回 / エラー %d 回\n", i + 1, ok[i], err[i]);
  }
  if (tested == 0) {
    Serial.println("→ 応答するリーダーがありません");
  } else if (totalErr == 0) {
    Serial.println("→ 合格（エラー 0 回）");
  } else {
    Serial.println("→ エラーがありました。配線（特にMISO）を確認するか、もう一方のテストと比べてください");
  }
}

// ------------------------------------------------------------
// 位置テスト・全台同時テスト（一定時間、全リーダーを巡回して、読めた回数を数える）
// ------------------------------------------------------------
const uint32_t MEASURE_MS = 5000;       // 測る時間
const int PASS_PERCENT = 90;            // 「ほぼ毎周読める」の基準（%）
const int MAX_DISTINCT = 3;             // リーダーごとに覚えておく、別々のUIDの数

struct Measurement {
  uint32_t cycles;                       // 何周したか
  uint32_t hits[NUM_READERS];            // リーダーごとに、タグを読めた回数
  uint8_t distinct[NUM_READERS];         // リーダーごとに、見えた別々のUIDの数（最大 MAX_DISTINCT）
  TagUid seen[NUM_READERS][MAX_DISTINCT];
};

void measure(Measurement* m) {
  memset(m, 0, sizeof(*m));
  uint32_t start = millis();
  while (millis() - start < MEASURE_MS) {
    for (int i = 0; i < NUM_READERS; i++) {
      if (!readerIsAlive(i)) continue;
      TagUid uid;
      if (!readersScanOne(i, &uid)) continue;
      m->hits[i]++;
      bool known = false;
      for (int k = 0; k < m->distinct[i]; k++) {
        if (sameUid(m->seen[i][k], uid)) known = true;
      }
      if (!known && m->distinct[i] < MAX_DISTINCT) m->seen[i][m->distinct[i]++] = uid;
    }
    m->cycles++;
  }
}

// ほぼ毎周（PASS_PERCENT %以上）読めていれば true
bool isSteady(const Measurement& m, int i) {
  return m.cycles > 0 && m.hits[i] * 100 >= m.cycles * PASS_PERCENT;
}

// その位置にだけ置いたタグを、そこだけが読めて、ほかのリーダーは読まないことを確かめる
void runIsolationTest(int target) {
  Serial.println();
  Serial.printf("--- 位置テスト: リーダー%d にだけタグを置いたとき（%u秒間）---\n", target + 1, (unsigned)(MEASURE_MS / 1000));
  printSettings();
  if (!readerIsAlive(target)) {
    Serial.printf("リーダー%d は応答がありません。先に i で配線を確認してください。\n", target + 1);
    return;
  }
  Serial.printf("リーダー%d の上にタグを1枚置いたまま、動かさないでください。測定中...\n", target + 1);
  Measurement m;
  measure(&m);

  bool pass = true;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) {
      Serial.printf("リーダー%d: 応答なし（テストの対象外）\n", i + 1);
      continue;
    }
    Serial.printf("リーダー%d: %u / %u 周で読めた  ", i + 1, (unsigned)m.hits[i], (unsigned)m.cycles);
    if (i == target) {
      if (isSteady(m, i)) {
        Serial.print("→ OK（ほぼ毎周読めている）");
        if (m.distinct[i] > 0) { Serial.print("  "); printTag(m.seen[i][0]); }
        if (m.distinct[i] > 1) { Serial.print("  ※ 複数のタグが見えました"); pass = false; }
      } else {
        Serial.print("→ NG（読めない周がある。タグが離れている・位置がずれている・動かした?）");
        pass = false;
      }
    } else if (m.hits[i] == 0) {
      Serial.print("→ OK（読んでいない）");
    } else {
      Serial.print("→ NG（タグを置いていないのに読んだ。干渉の疑い。リーダーの間隔をあける・g で受信感度を下げる・c で止め方を比べる）");
      pass = false;
    }
    Serial.println();
  }
  Serial.println(pass ? "→ 合格" : "→ 不合格（上の NG を確認してください）");
}

// 全リーダーに別々のタグを置いて、それぞれが自分のタグだけを安定して読めることを確かめる
void runAllAtOnceTest() {
  Serial.println();
  Serial.printf("--- 全台同時テスト（%u秒間）---\n", (unsigned)(MEASURE_MS / 1000));
  printSettings();
  if (readersAliveCount() == 0) {
    Serial.println("応答するリーダーがありません。先に i で配線を確認してください。");
    return;
  }
  Serial.println("応答しているリーダーすべてに、別々のタグを1枚ずつ置いて、動かさないでください。測定中...");
  Measurement m;
  measure(&m);

  bool pass = true;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) {
      Serial.printf("リーダー%d: 応答なし（テストの対象外）\n", i + 1);
      continue;
    }
    Serial.printf("リーダー%d: %u / %u 周で読めた  ", i + 1, (unsigned)m.hits[i], (unsigned)m.cycles);
    if (m.hits[i] == 0) {
      Serial.print("→ NG（タグが読めていません。置いていない?）");
      pass = false;
    } else if (!isSteady(m, i)) {
      Serial.print("→ NG（読めない周がある）");
      pass = false;
    } else if (m.distinct[i] > 1) {
      Serial.print("→ NG（複数のタグが見えました。隣のタグを読んでいる? 干渉の疑い）");
      pass = false;
    } else {
      Serial.print("→ OK  ");
      printTag(m.seen[i][0]);
    }
    Serial.println();
  }
  // 別のリーダーが、同じUIDを読んでいないか（1枚のタグが2か所にあることはない）
  for (int i = 0; i < NUM_READERS; i++) {
    for (int j = i + 1; j < NUM_READERS; j++) {
      if (m.distinct[i] > 0 && m.distinct[j] > 0 && sameUid(m.seen[i][0], m.seen[j][0])) {
        Serial.printf("※ リーダー%d とリーダー%d が、同じタグを読んでいます（干渉、またはタグが2つのリーダーの間にあります）\n", i + 1, j + 1);
        pass = false;
      }
    }
  }
  Serial.println(pass ? "→ 合格" : "→ 不合格（上の NG や ※ を確認してください）");
}

// ------------------------------------------------------------
// 止め方の比較テスト（c）
//   全リーダーに別々のタグを置いたまま、「アンテナOFF」と「RESET」を続けて測り、
//   隣のリーダーのタグを読んでしまう回数（干渉の疑い）と、タグを読めた率を比べる。
//   ※ 分かるのは「誤読」と「読み損ない」だけ。電波の強さそのものは測れない。
// ------------------------------------------------------------
struct CompareResult {
  bool valid;                       // 測れたか（RESET の自己診断に失敗したら false）
  int selfTestFailures;             // 自己診断で、うまく起きなかったリーダーの数
  uint32_t cycles;                  // 何周したか
  uint32_t msPerCycle;              // 1周の時間（ms）
  uint32_t slowWakes;               // 速い起こし方に失敗して、確実な方法にした回数
  int readersWithTag;               // タグを読めたリーダーの数
  int averagePercent;               // そのリーダーたちの、読めた率の平均（%）
  int suspicious;                   // 干渉の疑い（自分のタグ以外も読んだリーダーの数 + 同じタグを読んだ2台の組の数）
  uint8_t percent[NUM_READERS];     // リーダーごとの読めた率（%）
  bool multi[NUM_READERS];          // 自分のタグ以外も読んだか
};

void analyze(const Measurement& m, CompareResult* r) {
  r->cycles = m.cycles;
  r->msPerCycle = m.cycles ? MEASURE_MS / m.cycles : 0;
  int sum = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) continue;
    r->percent[i] = m.cycles ? (uint8_t)(m.hits[i] * 100 / m.cycles) : 0;
    if (m.hits[i] > 0) {
      r->readersWithTag++;
      sum += r->percent[i];
    }
    if (m.distinct[i] > 1) {
      r->multi[i] = true;
      r->suspicious++;
    }
  }
  for (int i = 0; i < NUM_READERS; i++) {
    for (int j = i + 1; j < NUM_READERS; j++) {
      if (m.distinct[i] > 0 && m.distinct[j] > 0 && sameUid(m.seen[i][0], m.seen[j][0])) r->suspicious++;
    }
  }
  r->averagePercent = r->readersWithTag ? sum / r->readersWithTag : 0;
}

// 止め方 method に切り替えて、MEASURE_MS だけ測る。RESET の自己診断に失敗したら、測らずに valid = false
void measureWithMethod(IdleMethod method, CompareResult* r) {
  memset(r, 0, sizeof(*r));
  if (!readersSetIdleMethod(method, true)) {
    r->selfTestFailures = readersLastSelfTestFailures();
    return;
  }
  r->valid = true;
  uint32_t slowBefore = readersSlowWakeCount();
  Measurement m;
  measure(&m);
  analyze(m, r);
  r->slowWakes = readersSlowWakeCount() - slowBefore;
}

void printCompareLine(const char* label, const CompareResult& r) {
  Serial.printf("[%s] ", label);
  if (!r.valid) {
    Serial.printf("測れませんでした（自己診断で、%d 台のリーダーがうまく起きませんでした）\n", r.selfTestFailures);
    return;
  }
  Serial.printf("%u 周（1周 %u ms）  読めた率:", (unsigned)r.cycles, (unsigned)r.msPerCycle);
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) continue;
    Serial.printf(" リーダー%d=%u%%%s", i + 1, (unsigned)r.percent[i], r.multi[i] ? "（ほかのタグも読んだ）" : "");
  }
  Serial.println();
  Serial.printf("    干渉の疑い: %d 件 ／ 速い起こし方に失敗した回数: %u 回\n", r.suspicious, (unsigned)r.slowWakes);
}

// どちらの止め方がよいか。差がなければ、標準（DEFAULT_IDLE_METHOD）
IdleMethod chooseBetter(const CompareResult& off, const CompareResult& reset, const char** reason) {
  if (!reset.valid) {
    *reason = "RESET は自己診断に失敗したため";
    return IDLE_ANTENNA_OFF;
  }
  if (off.suspicious != reset.suspicious) {
    *reason = "ほかのリーダーのタグを読んでしまう（干渉の疑い）が少ないため";
    return off.suspicious < reset.suspicious ? IDLE_ANTENNA_OFF : IDLE_RESET;
  }
  if (reset.slowWakes > 0) {
    *reason = "RESET の起こし方が遅くなることがあり、音のタイミングがずれるおそれがあるため";
    return IDLE_ANTENNA_OFF;
  }
  int diff = reset.averagePercent - off.averagePercent;
  if (diff >= 2 || diff <= -2) {
    *reason = "タグを読めた率が高いため";
    return diff > 0 ? IDLE_RESET : IDLE_ANTENNA_OFF;
  }
  *reason = "2つに差がなかったため（標準の方）";
  return DEFAULT_IDLE_METHOD;
}

void runCompareTest() {
  Serial.println();
  Serial.println("--- 止め方の比較テスト ---");
  if (readersAliveCount() < 2) {
    Serial.println("応答するリーダーが2台以上ないと、隣のリーダーとの干渉は比べられません。先に i で配線を確認してください。");
    return;
  }
  IdleMethod before = readersIdleMethod();
  printSettings();
  Serial.println("応答しているリーダーすべてに、別々のタグを1枚ずつ置いて、動かさないでください。");
  Serial.printf("「アンテナOFF」と「RESET」を %u 秒ずつ測ります（合計 約%u秒）。測定中...\n", (unsigned)(MEASURE_MS / 1000),
                (unsigned)(2 * MEASURE_MS / 1000));

  CompareResult off, reset;
  Serial.println("測定 1/2: アンテナOFF ...");
  measureWithMethod(IDLE_ANTENNA_OFF, &off);
  Serial.println("測定 2/2: RESET ...");
  measureWithMethod(IDLE_RESET, &reset);
  readersSetIdleMethod(before, false);  // 元の止め方に戻す

  Serial.println();
  printCompareLine("アンテナOFF", off);
  printCompareLine("RESET      ", reset);

  if (off.readersWithTag == 0 && reset.readersWithTag == 0) {
    Serial.println("→ タグが1つも読めませんでした。リーダーにタグを置いて、もう一度 c を試してください。");
    return;
  }
  int alive = readersAliveCount();
  if (off.readersWithTag < alive || (reset.valid && reset.readersWithTag < alive)) {
    Serial.println("※ タグが読めなかったリーダーがあります（タグを置き忘れていませんか?）。そのリーダーは、比べる対象になっていません。");
  }

  const char* reason = "";
  IdleMethod better = chooseBetter(off, reset, &reason);
  Serial.printf("→ おすすめ: %s（%s）\n", readersIdleMethodName(better), reason);
  Serial.println("※ このテストで分かるのは、「ほかのリーダーのタグを読んでしまう」ことと「読めない周がある」ことだけです。電波の強さそのものは測れません。");
  Serial.println("  どちらも差がないときは、リーダーの間隔をあける・g で受信感度を下げる、も試してください。");
  if (better == before) {
    Serial.println("→ いまの設定のままで大丈夫です。");
    return;
  }
  recommended = better;
  recommendPending = true;
  Serial.printf("止め方を「%s」に変えて、本体に保存しますか？ (y: 変える / n: 変えない)\n", readersIdleMethodName(better));
}

// y / n の返事を受けて、おすすめを反映する
void answerRecommendation(bool yes) {
  recommendPending = false;
  if (!yes) {
    Serial.println("変えませんでした。");
    return;
  }
  if (!readersSetIdleMethod(recommended, true)) {
    Serial.printf("RESET方式の自己診断で、%d 台がうまく起きませんでした。止め方は変えていません。\n", readersLastSelfTestFailures());
    return;
  }
  bool saved = settingsSaveIdleMethod(recommended);
  entryIdle = recommended;  // q で戻る先も、新しい設定にする
  Serial.printf("止め方を「%s」にしました。%s\n", readersIdleMethodName(recommended),
                saved ? "（本体に保存しました。電源を入れ直しても、この設定です）" : "（保存に失敗しました。この電源が入っている間だけ有効です）");
}

// ------------------------------------------------------------
// 原因調べ（t）: 止め方 × 待ち時間 を総当たりで試す
//   タグを読めないとき、「待ち時間が足りない」のか「RESET の起こし方」なのか「配線・タグ」なのかを切り分ける。
//   読み取りの中身（呼びかけの結果・電波が出ているか・起こす時間）を、設定ごとに数えて表示する。
// ------------------------------------------------------------
struct DiagTally {
  int scans, found, serialOk;
  int statusOk, statusCollision, statusTimeout, statusError, statusOther;
  int slowWake, antennaOn, versionOk;
  uint32_t sumTotalUs, sumWakeUs;
};

void tallyScans(int reader, int count, DiagTally* t) {
  memset(t, 0, sizeof(*t));
  for (int k = 0; k < count; k++) {
    TagUid uid;
    ScanDiag d;
    readersScanDiag(reader, &uid, &d);
    t->scans++;
    if (d.found) t->found++;
    if (d.serialOk) t->serialOk++;
    switch (d.wupaStatus) {
      case 0: t->statusOk++; break;
      case 2: t->statusCollision++; break;
      case 3: t->statusTimeout++; break;
      case 1: t->statusError++; break;
      default: t->statusOther++; break;
    }
    if (d.wasInReset && !d.wokeFast) t->slowWake++;
    if ((d.txControl & 0x03) == 0x03) t->antennaOn++;
    if (d.version != 0x00 && d.version != 0xFF) t->versionOk++;
    t->sumTotalUs += d.totalUs;
    t->sumWakeUs += d.wakeUs;
  }
}

void printTally(const DiagTally& t) {
  Serial.printf("読めた %d/%d  呼びかけ[OK %d 衝突 %d 返事なし %d エラー %d 他 %d]  電波ON %d/%d  version正常 %d/%d  遅い起こし %d  1回 %.1f ms（起こす %.1f ms）\n",
                t.found, t.scans, t.statusOk, t.statusCollision, t.statusTimeout, t.statusError, t.statusOther, t.antennaOn, t.scans,
                t.versionOk, t.scans, t.slowWake, t.sumTotalUs / 1000.0 / t.scans, t.sumWakeUs / 1000.0 / t.scans);
}

void runTimingSweep() {
  Serial.println();
  Serial.println("--- 原因調べ: 止め方 × 待ち時間の総当たり ---");
  if (readersAliveCount() == 0) {
    Serial.println("応答するリーダーがありません。先に i で配線を確認してください。");
    return;
  }
  IdleMethod savedMethod = readersIdleMethod();
  uint8_t savedSettle = readersSettleMs(), savedTimeout = readersTimeoutMs();
  Serial.printf("読めないリーダーに、タグを1枚置いたまま動かさないでください。（受信感度 %d dB）\n", readersGainDb());

  // 1. いちばん余裕のある設定（旧版と同じ）で、どのリーダーが読めるか
  readersSetIdleMethod(IDLE_ANTENNA_OFF, false);
  readersSetTiming(20, 25);
  Serial.println("[1] 余裕のある設定（アンテナOFF・待ち20ms・返事25ms）で、各リーダーを10回ずつ:");
  int target = -1, best = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) continue;
    DiagTally t;
    tallyScans(i, 10, &t);
    Serial.printf("  リーダー%d: ", i + 1);
    printTally(t);
    if (t.found > best) { best = t.found; target = i; }
  }
  if (target < 0) {
    Serial.println("→ 余裕のある設定でも、どのリーダーもタグを読めませんでした。");
    Serial.println("  待ち時間や止め方の問題ではありません。タグの置き方（アンテナ面・距離10mm以内）、RC522の電源（3.3V）、");
    Serial.println("  タグそのもの（別のタグで試す）、受信感度（g で切り替え）を確認してください。");
    Serial.println("  上の「呼びかけ」が全部「エラー」なら通信（MISO・SS）の異常、全部「返事なし」なら電波かタグの問題です。");
    readersSetIdleMethod(savedMethod, false);
    readersSetTiming(savedSettle, savedTimeout);
    return;
  }
  Serial.printf("→ リーダー%d で総当たりします（20回ずつ）。\n", target + 1);

  // 2. 総当たり
  static const uint8_t SETTLES[] = {5, 10, 20};
  static const uint8_t TIMEOUTS[] = {5, 15, 25};
  int bestFound = -1;
  IdleMethod bestMethod = IDLE_ANTENNA_OFF;
  uint8_t bestSettle = 0, bestTimeout = 0;
  float bestMs = 0;
  for (int m = 0; m < 2; m++) {
    IdleMethod method = (m == 0) ? IDLE_ANTENNA_OFF : IDLE_RESET;
    if (!readersSetIdleMethod(method, true)) {
      Serial.printf("止め方 %s: 自己診断に失敗（%d台）。この止め方は試せません。\n", method == IDLE_RESET ? "RESET" : "アンテナOFF", readersLastSelfTestFailures());
      continue;
    }
    for (uint8_t settle : SETTLES) {
      for (uint8_t timeout : TIMEOUTS) {
        readersSetTiming(settle, timeout);
        DiagTally t;
        tallyScans(target, 20, &t);
        Serial.printf("%-6s 待ち%2dms 返事%2dms : ", method == IDLE_RESET ? "RESET" : "OFF", settle, timeout);
        printTally(t);
        float ms = t.sumTotalUs / 1000.0f / t.scans;
        if (t.found > bestFound || (t.found == bestFound && ms < bestMs)) {
          bestFound = t.found; bestMethod = method; bestSettle = settle; bestTimeout = timeout; bestMs = ms;
        }
      }
    }
  }
  // 3. 4台を順番に回しながら（本番と同じ読み方）。ほかのリーダーが回ると読めなくなるかを調べる
  Serial.printf("[3] 全リーダーを順番に回しながら、リーダー%d の読み取りを数える（本番と同じ読み方。60周ずつ）:\n", target + 1);
  Serial.printf("    ※ 上の行の「ほかのリーダーが読めた回数」が 0 でないときは、そのリーダーにも何か（タグ）が見えています\n");
  static const uint8_t RSETTLES[] = {5, 5, 8, 8, 10, 10, 15, 20};
  static const uint8_t RTIMEOUTS[] = {5, 10, 5, 10, 5, 10, 10, 25};
  for (int m = 0; m < 2; m++) {
    IdleMethod method = (m == 0) ? IDLE_ANTENNA_OFF : IDLE_RESET;
    if (!readersSetIdleMethod(method, true)) continue;
    for (int k = 0; k < 8; k++) {
      readersSetTiming(RSETTLES[k], RTIMEOUTS[k]);
      DiagTally t;
      memset(&t, 0, sizeof(t));
      int othersFound[NUM_READERS] = {0};
      for (int cycle = 0; cycle < 60; cycle++) {
        for (int i = 0; i < NUM_READERS; i++) {
          if (!readerIsAlive(i)) continue;
          TagUid uid;
          ScanDiag d;
          readersScanDiag(i, &uid, &d);
          if (i != target) {
            if (d.found) othersFound[i]++;
            continue;
          }
          t.scans++;
          if (d.found) t.found++;
          switch (d.wupaStatus) {
            case 0: t.statusOk++; break;
            case 2: t.statusCollision++; break;
            case 3: t.statusTimeout++; break;
            case 1: t.statusError++; break;
            default: t.statusOther++; break;
          }
          if (d.wasInReset && !d.wokeFast) t.slowWake++;
          if ((d.txControl & 0x03) == 0x03) t.antennaOn++;
          if (d.version != 0x00 && d.version != 0xFF) t.versionOk++;
          t.sumTotalUs += d.totalUs;
          t.sumWakeUs += d.wakeUs;
        }
      }
      Serial.printf("%-6s 待ち%2dms 返事%2dms : ", method == IDLE_RESET ? "RESET" : "OFF", RSETTLES[k], RTIMEOUTS[k]);
      printTally(t);
      Serial.print("      ほかのリーダーが読めた回数:");
      for (int i = 0; i < NUM_READERS; i++) {
        if (i != target && readerIsAlive(i)) Serial.printf(" リーダー%d=%d", i + 1, othersFound[i]);
      }
      Serial.println();
    }
  }

  readersSetIdleMethod(savedMethod, false);
  readersSetTiming(savedSettle, savedTimeout);
  Serial.printf("→ いちばん読めた設定: %s 待ち%dms 返事%dms（%d/20、1回 %.1f ms）\n", bestMethod == IDLE_RESET ? "RESET" : "OFF", bestSettle, bestTimeout, bestFound, bestMs);
  Serial.println("  （この表を、そのまま教えてください。標準の設定は config.h の RC522_SETTLE_MS / RC522_TIMEOUT_MS です）");
}

// ------------------------------------------------------------
// 読み取りモード
// ------------------------------------------------------------
void startScanning() {
  scanning = true;
  cycles = 0;
  cycleMsTotal = 0;
  for (int i = 0; i < NUM_READERS; i++) {
    slots[i].present = false;
    slots[i].miss = 0;
    hits[i] = 0;
  }
  Serial.println();
  Serial.println("--- 読み取り開始（s で停止）---");
  printSettings();
  Serial.println("リーダーにタグを置く／外す／交換してみてください。");
}

void stopScanning() {
  scanning = false;
  Serial.println();
  Serial.println("--- 読み取り停止 ---");
  if (cycles == 0) return;
  Serial.printf("周回数: %u 回、1周の平均: %u ms\n", (unsigned)cycles, (unsigned)(cycleMsTotal / cycles));
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) continue;
    Serial.printf("リーダー%d: タグを読めた回数 %u / %u 周\n", i + 1, (unsigned)hits[i], (unsigned)cycles);
  }
  Serial.println("（タグを置いていたリーダーは、ほぼ毎周読めるのが理想。置いていないリーダーは 0 回のはず）");
}

// 1周ぶん（全リーダーを順番に1回ずつ）読む
void scanOnce() {
  uint32_t start = millis();
  for (int i = 0; i < NUM_READERS; i++) {
    if (!readerIsAlive(i)) continue;

    TagUid uid;
    bool found = readersScanOne(i, &uid);
    if (found) hits[i]++;

    Slot& s = slots[i];
    if (found) {
      s.miss = 0;
      if (!s.present || !sameUid(s.uid, uid)) {
        Serial.printf("[リーダー%d] %s  ", i + 1, s.present ? "タグが交換されました" : "タグが置かれました");
        printTag(uid);
        Serial.println();
        s.present = true;
        s.uid = uid;
        // ほかのリーダーも同じUIDを見ていたら、干渉か、タグがリーダーの間にある
        for (int j = 0; j < NUM_READERS; j++) {
          if (j != i && slots[j].present && sameUid(slots[j].uid, uid)) {
            Serial.printf("  ※ リーダー%d も同じタグを読んでいます（干渉、またはタグがリーダーの間にあります）\n", j + 1);
          }
        }
      }
    } else if (s.present) {
      if (++s.miss >= 2) {  // 2周続けて読めなかったら「外された」とみなす
        Serial.printf("[リーダー%d] タグが外れました\n", i + 1);
        s.present = false;
      }
    }
  }
  cycles++;
  cycleMsTotal += millis() - start;
}

// ------------------------------------------------------------
// 隣のリーダーを読む原因調べ（k）
//   各リーダーで、電波の届く範囲にいるタグを全部読んで、「どのリーダーが、どのタグを、何回読めたか」を表にする。
//   モードを変えて比べると、原因が分かる:
//     ・「電波なし」でも読めるなら → 電波ではなく、配線・SPI の経路（電気的な回り込み）
//     ・「感度を下げる」「出力を弱める」と読めなくなるなら → 電波が隣まで届いている（物理的な近さ）
// ------------------------------------------------------------
struct CoupleCell {
  uint8_t count[4];   // タグ A〜D を読めた回数
  uint8_t multi;      // 2枚以上が同時に見えた回数
  uint8_t none;       // 何も読めなかった回数
};

void runCoupleTest() {
  const int ROUNDS = 8;
  const int MAXTAG = 4;
  Serial.println();
  Serial.println("--- 隣のリーダーを読む原因調べ ---");
  printSettings();
  Serial.println("いまの駒の置き方のまま、動かさないでください。");
  TagUid names[MAXTAG];
  int nNames = 0;
  uint8_t savedGain = readersGainDb();
  uint8_t savedPower = readersRfPower();
  struct Mode { const char* label; uint8_t gain; uint8_t power; bool antennaOff; };
  const Mode modes[] = {
      {"通常", savedGain, savedPower, false},
      {"電波を出さない", savedGain, savedPower, true},
      {"受信感度 23 dB", 23, savedPower, false},
      {"出力を弱める 0x10", savedGain, 0x10, false},
      {"出力を弱める 0x08", savedGain, 0x08, false},
  };
  for (const Mode& m : modes) {
    readersSetGainDb(m.gain);
    readersSetRfPower(m.power);
    readersDebugAntennaOff(m.antennaOff);
    Serial.printf("\n[%s]（感度 %d dB・出力 0x%02X）\n", m.label, readersGainDb(), readersRfPower());
    for (int r = 0; r < NUM_READERS; r++) {
      if (!readerIsAlive(r)) continue;
      CoupleCell c;
      memset(&c, 0, sizeof(c));
      for (int k = 0; k < ROUNDS; k++) {
        TagUid found[MAXTAG];
        int n = readersScanAll(r, found, MAXTAG);
        if (n == 0) c.none++;
        if (n >= 2) c.multi++;
        for (int j = 0; j < n; j++) {
          int idx = -1;
          for (int q = 0; q < nNames; q++) {
            if (sameUid(names[q], found[j])) idx = q;
          }
          if (idx < 0 && nNames < MAXTAG) { names[nNames] = found[j]; idx = nNames++; }
          if (idx >= 0) c.count[idx]++;
        }
      }
      Serial.printf("  リーダー%d:", r + 1);
      bool any = false;
      for (int q = 0; q < nNames; q++) {
        if (c.count[q] > 0) { Serial.printf(" %c×%d", 'A' + q, c.count[q]); any = true; }
      }
      if (!any) Serial.print(" （読めない）");
      if (c.multi > 0) Serial.printf("   ※ 2枚以上が同時に見えた %d 回", c.multi);
      Serial.println();
    }
  }
  readersDebugAntennaOff(false);
  readersSetGainDb(savedGain);
  readersSetRfPower(savedPower);
  Serial.println();
  Serial.println("タグの名前:");
  for (int q = 0; q < nNames; q++) {
    Serial.printf("  %c = ", 'A' + q);
    printUidBytes(names[q]);
    const Chord* chord = chordById(tagStoreFind(names[q]));
    Serial.printf(" → %s\n", chord ? chord->name : "(未登録)");
  }
  Serial.println("（A×8 は、8回とも読めた。「※ 2枚以上」は、電波の届く範囲に駒が2枚ある、ということ）");
}

// ------------------------------------------------------------
// 見え方の連続モニター（n）: 各リーダーが、どのタグを、どの受信感度の範囲で読めるかを調べて、変化したときだけ表示する
// ------------------------------------------------------------
bool monitoring = false;
uint32_t monitorStart = 0;
// 読むリーダーと順番（o で切り替え）: 0=1→8（標準） 1=8→1 2=5〜8だけ 3=1〜4だけ 4=2,3,4 を飛ばして読む
int monitorOrder = 0;
const char* monitorOrderName() {
  static const char* N[] = {"1→8（標準）", "8→1（逆順）", "5〜8だけ", "1〜4だけ", "2・3・4 を読まない"};
  return N[monitorOrder];
}
bool monitorReads(int r, int order) {   // r は 0 始まり
  switch (order) {
    case 2: return r >= 4;
    case 3: return r < 4;
    case 4: return !(r == 1 || r == 2 || r == 3);
    default: return true;
  }
}
char monitorLast[220] = "";
TagUid monitorNames[6];
int monitorNameCount = 0;

char monitorLetter(const TagUid& u) {
  for (int q = 0; q < monitorNameCount; q++) {
    if (sameUid(monitorNames[q], u)) return (char)('A' + q);
  }
  if (monitorNameCount < 6) { monitorNames[monitorNameCount] = u; return (char)('A' + monitorNameCount++); }
  return '?';
}

// 各リーダーが、どのタグを、どの受信感度の範囲で読めるかを調べて、「R5:A[18-38] R6:A[33-48]」のような文字にする。
//   受信感度 18/23/33/38/43/48 dB（出力は標準）で1回ずつ読み、読めた最小と最大の感度を出す。
//   駒の真下のリーダーは、弱い感度から読めて、強すぎる感度では信号が大きすぎて読めなくなる（飽和）。
//   隣のリーダー（影）は、強い感度からでないと読めないが、飽和しにくい。この2つの端が、見分けの手がかりになる（README 4-5）。
void monitorRound(char* out, size_t size) {
  static const uint8_t GAIN[6] = {18, 23, 33, 38, 43, 48};
  uint8_t savedGain = readersGainDb();
  int8_t lo[NUM_READERS][6], hi[NUM_READERS][6];   // [リーダー][タグ] = 読めた最小・最大の感度の番号（-1 = 読めない）
  memset(lo, -1, sizeof(lo));
  memset(hi, -1, sizeof(hi));
  for (int g = 0; g < 6; g++) {
    readersSetGainDb(GAIN[g]);
    for (int k = 0; k < NUM_READERS; k++) {
      int r = (monitorOrder == 1) ? NUM_READERS - 1 - k : k;
      if (!readerIsAlive(r) || !monitorReads(r, monitorOrder)) continue;
      TagUid found[4];
      int cnt = readersScanAll(r, found, 4);
      for (int j = 0; j < cnt; j++) {
        char letter = monitorLetter(found[j]);
        if (letter < 'A' || letter > 'F') continue;
        int q = letter - 'A';
        if (lo[r][q] < 0) lo[r][q] = (int8_t)g;
        hi[r][q] = (int8_t)g;
      }
    }
  }
  readersSetGainDb(savedGain);
  size_t n = 0;
  out[0] = '\0';
  for (int r = 0; r < NUM_READERS; r++) {
    for (int q = 0; q < 6; q++) {
      if (lo[r][q] < 0) continue;
      n += snprintf(out + n, size - n, "R%d:%c[%d-%d] ", r + 1, 'A' + q, GAIN[lo[r][q]], GAIN[hi[r][q]]);
    }
  }
}

void monitorOnce() {
  char round[160], line[220];
  monitorRound(round, sizeof(round));
  snprintf(line, sizeof(line), "%s", round[0] ? round : "（何も読めない）");
  if (strcmp(line, monitorLast) != 0) {
    strncpy(monitorLast, line, sizeof(monitorLast) - 1);
    Serial.printf("[%6.1f秒] %s\n", (millis() - monitorStart) / 1000.0, line);
  }
}

// ------------------------------------------------------------
// 感度の階段テスト（l）: 電波の強さを、弱い方から強い方へ9段階で変えて、各リーダーが、どのタグを、どの段から読めるかを調べる。
//   読めはじめる段が低いほど、そのリーダーとタグが「近い」（強く結びついている）。
//   段: 0=(18dB・出力0x01) 1=(18・0x04) 2=(18・0x08) 3=(18・0x10) 4=(18・0x20) 5=(23・0x20) 6=(33・0x20) 7=(38・0x20) 8=(43・0x20)
// ------------------------------------------------------------
struct LadderStep { uint8_t gain; uint8_t power; };
const LadderStep LADDER[9] = {{18, 0x01}, {18, 0x04}, {18, 0x08}, {18, 0x10}, {18, 0x20}, {23, 0x20}, {33, 0x20}, {38, 0x20}, {43, 0x20}};

void runLadderTest() {
  const int TRIES = 5;
  Serial.println();
  Serial.println("--- 感度の階段テスト ---");
  printSettings();
  Serial.println("いまの駒の置き方のまま、動かさないでください。");
  uint8_t savedGain = readersGainDb(), savedPower = readersRfPower();
  TagUid names[4];
  int nNames = 0;
  uint8_t hits[NUM_READERS][9][4];
  memset(hits, 0, sizeof(hits));
  for (int step = 0; step < 9; step++) {
    readersSetGainDb(LADDER[step].gain);
    readersSetRfPower(LADDER[step].power);
    for (int r = 0; r < NUM_READERS; r++) {
      if (!readerIsAlive(r)) continue;
      for (int k = 0; k < TRIES; k++) {
        TagUid found[4];
        int n = readersScanAll(r, found, 4);
        for (int j = 0; j < n; j++) {
          int idx = -1;
          for (int q = 0; q < nNames; q++) {
            if (sameUid(names[q], found[j])) idx = q;
          }
          if (idx < 0 && nNames < 4) { names[nNames] = found[j]; idx = nNames++; }
          if (idx >= 0) hits[r][step][idx]++;
        }
      }
    }
  }
  readersSetGainDb(savedGain);
  readersSetRfPower(savedPower);
  Serial.printf("各段で、%d 回のうち何回読めたか（0〜%d）。段 0 が最も弱く、段 8 が最も強い。\n", TRIES, TRIES);
  Serial.println("段:        0   1   2   3   4   5   6   7   8");
  for (int q = 0; q < nNames; q++) {
    for (int r = 0; r < NUM_READERS; r++) {
      bool any = false;
      for (int step = 0; step < 9; step++) any = any || hits[r][step][q] > 0;
      if (!any) continue;
      Serial.printf("タグ%c リーダー%d:", 'A' + q, r + 1);
      for (int step = 0; step < 9; step++) Serial.printf(" %3d", hits[r][step][q]);
      Serial.println();
    }
  }
  Serial.println("タグの名前:");
  for (int q = 0; q < nNames; q++) {
    Serial.printf("  %c = ", 'A' + q);
    printUidBytes(names[q]);
    const Chord* chord = chordById(tagStoreFind(names[q]));
    Serial.printf(" → %s\n", chord ? chord->name : "(未登録)");
  }
  Serial.println("（例: 「0 0 0 5 5 5 5 5 5」は、段 3 から確実に読める。読めはじめる段が低いほど、そのリーダーとタグは近い）");
}

// ------------------------------------------------------------
// 感度×出力の格子テスト（f）: 受信感度 4段 × アンテナの出力 4段 = 16通りで、各リーダーが、どのタグを何回読めるかを調べる。
//   感度の階段（l）は、受信感度を 10dB・5dB ずつしか変えられないので、本命のリーダーと隣のリーダーが、同じ段から読めて
//   決め手がないことがある（2026-10-19: 駒をリーダー7 に置くと、リーダー6 も 33dB で同じように読めた）。
//   出力（CWGsPReg）を半分ずつ下げると、もっと細かく比べられる。どちらが先に読めなくなるかを見る。
// ------------------------------------------------------------
void runGridTest() {
  const int TRIES = 4;
  const uint8_t GAIN_DB[4] = {18, 23, 33, 38};
  const uint8_t POWER[4] = {0x04, 0x08, 0x10, 0x20};
  Serial.println();
  Serial.println("--- 感度×出力の格子テスト ---");
  printSettings();
  Serial.println("いまの駒の置き方のまま、動かさないでください。（約40秒）");
  uint8_t savedGain = readersGainDb(), savedPower = readersRfPower();
  TagUid names[4];
  int nNames = 0;
  static uint8_t hits[NUM_READERS][4][4][4];   // [リーダー][感度][出力][タグ]
  memset(hits, 0, sizeof(hits));
  for (int g = 0; g < 4; g++) {
    for (int w = 0; w < 4; w++) {
      readersSetGainDb(GAIN_DB[g]);
      readersSetRfPower(POWER[w]);
      for (int r = 0; r < NUM_READERS; r++) {
        if (!readerIsAlive(r)) continue;
        for (int k = 0; k < TRIES; k++) {
          TagUid found[4];
          int n = readersScanAll(r, found, 4);
          for (int j = 0; j < n; j++) {
            int idx = -1;
            for (int q = 0; q < nNames; q++) {
              if (sameUid(names[q], found[j])) idx = q;
            }
            if (idx < 0 && nNames < 4) { names[nNames] = found[j]; idx = nNames++; }
            if (idx >= 0) hits[r][g][w][idx]++;
          }
        }
      }
    }
  }
  // 2つ目の格子: 受信感度 × 受信のしきい値（MinLevel。大きいほど、強い信号しか受け付けない）。出力は標準
  const uint8_t GAIN2_DB[3] = {18, 23, 33};
  const uint8_t MINLEVEL[7] = {2, 3, 4, 5, 6, 7, 8};
  static uint8_t hits2[NUM_READERS][3][7][4];
  memset(hits2, 0, sizeof(hits2));
  uint8_t savedMin = readersRxMinLevel();
  readersSetRfPower(savedPower);
  for (int g = 0; g < 3; g++) {
    for (int m = 0; m < 7; m++) {
      readersSetGainDb(GAIN2_DB[g]);
      readersSetRxMinLevel(MINLEVEL[m]);
      for (int r = 0; r < NUM_READERS; r++) {
        if (!readerIsAlive(r)) continue;
        for (int k = 0; k < TRIES; k++) {
          TagUid found[4];
          int n = readersScanAll(r, found, 4);
          for (int j = 0; j < n; j++) {
            int idx = -1;
            for (int q = 0; q < nNames; q++) {
              if (sameUid(names[q], found[j])) idx = q;
            }
            if (idx < 0 && nNames < 4) { names[nNames] = found[j]; idx = nNames++; }
            if (idx >= 0) hits2[r][g][m][idx]++;
          }
        }
      }
    }
  }
  readersSetRxMinLevel(savedMin);
  readersSetGainDb(savedGain);
  readersSetRfPower(savedPower);
  Serial.printf("各組み合わせで、%d 回のうち何回読めたか。行 = 受信感度、列 = 出力（0x04 0x08 0x10 0x20。右ほど強い）\n", TRIES);
  for (int q = 0; q < nNames; q++) {
    for (int r = 0; r < NUM_READERS; r++) {
      int total = 0;
      for (int g = 0; g < 4; g++) {
        for (int w = 0; w < 4; w++) total += hits[r][g][w][q];
      }
      if (total == 0) continue;
      Serial.printf("タグ%c リーダー%d:", 'A' + q, r + 1);
      for (int g = 0; g < 4; g++) {
        Serial.printf("  %ddB[", GAIN_DB[g]);
        for (int w = 0; w < 4; w++) Serial.printf("%d%s", hits[r][g][w][q], w < 3 ? " " : "");
        Serial.print("]");
      }
      Serial.println();
    }
  }
  Serial.println("受信のしきい値 MinLevel（8 = 標準。小さいほど、弱い信号も受け付ける = 感度が高い）を変えたとき（出力は標準）:  列 = MinLevel 2 3 4 5 6 7 8");
  for (int q = 0; q < nNames; q++) {
    for (int r = 0; r < NUM_READERS; r++) {
      int total = 0;
      for (int g = 0; g < 3; g++) {
        for (int m = 0; m < 7; m++) total += hits2[r][g][m][q];
      }
      if (total == 0) continue;
      Serial.printf("タグ%c リーダー%d:", 'A' + q, r + 1);
      for (int g = 0; g < 3; g++) {
        Serial.printf("  %ddB[", GAIN2_DB[g]);
        for (int m = 0; m < 7; m++) Serial.printf("%d%s", hits2[r][g][m][q], m < 6 ? " " : "");
        Serial.print("]");
      }
      Serial.println();
    }
  }
  Serial.println("タグの名前:");
  for (int q = 0; q < nNames; q++) {
    Serial.printf("  %c = ", 'A' + q);
    printUidBytes(names[q]);
    const Chord* chord = chordById(tagStoreFind(names[q]));
    Serial.printf(" → %s\n", chord ? chord->name : "(未登録)");
  }
  Serial.println("（例: 18dB[0 0 3 4] は、感度18dB で、出力 0x10 なら 3回、0x20 なら 4回読めた。出力が小さくても、しきい値が大きくても読めるリーダーほど、駒に近い）");
}

}  // namespace

// ------------------------------------------------------------
// 外から呼ばれる部分
// ------------------------------------------------------------
bool testActive() { return active; }

void testEnter() {
  active = true;
  scanning = false;
  recommendPending = false;
  entryIdle = readersIdleMethod();   // q で終わるときに、この設定に戻す
  entryGain = readersGainDb();
  printHelp();
  printSettings();
}

// テストモードでの入力（1行）。q で終了する。1文字のコマンドだけを受け付ける
void testHandleLine(const char* line) {
  while (*line == ' ' || *line == '\t') line++;
  if (*line == '\0') return;
  char c = (char)tolower((unsigned char)*line);
  if (line[1] != '\0') c = '?';  // 2文字以上（"start" など）を、頭文字のコマンドと取り違えない

  if (recommendPending && (c == 'y' || c == 'n')) {  // c の「おすすめ」への返事
    answerRecommendation(c == 'y');
    return;
  }
  recommendPending = false;  // ほかの入力があったら、おすすめの確認はやめる

  if (c == 'q') {  // 通常の動作に戻る
    scanning = false;
    // m や g で試しに変えた設定を、テストに入ったときの設定に戻す（c の y で保存した設定は、そのまま）
    if (readersIdleMethod() != entryIdle) readersSetIdleMethod(entryIdle, false);
    if (readersGainDb() != entryGain) readersSetGainDb(entryGain);
    active = false;
    Serial.println();
    Serial.println("テストモードを終了しました。");
    printSettings();
    return;
  }
  if (monitoring) {
    if (c == 'o') {
      monitorOrder = (monitorOrder + 1) % 5;
      monitorLast[0] = '\0';
      Serial.printf("モニターで読む順番: %s\n", monitorOrderName());
      return;
    }
    if (c == 'n' || c == 'q') {
      monitoring = false;
      Serial.println("モニターを止めました。");
      if (c == 'n') return;
    } else {
      Serial.println("モニター中です。先に n で停止してください。");
      return;
    }
  }
  if (scanning && c != 's') {
    Serial.println("読み取り中です。先に s で停止してください。");
    return;
  }
  if (c >= '1' && c < '1' + NUM_READERS) {
    runIsolationTest(c - '1');
    return;
  }
  switch (c) {
    case 'i': showReaders(); break;
    case 'v': runVersionTest(false); break;
    case 'w': runVersionTest(true); break;
    case 'a': runAllAtOnceTest(); break;
    case 's': scanning ? stopScanning() : startScanning(); break;
    case 'c': runCompareTest(); break;
    case 't': runTimingSweep(); break;
    case 'k': runCoupleTest(); break;
    case 'l': runLadderTest(); break;
    case 'f': runGridTest(); break;
    case 'o':
      monitorOrder = (monitorOrder + 1) % 5;
      monitorLast[0] = '\0';
      Serial.printf("モニターで読む順番: %s\n", monitorOrderName());
      break;
    case 'n':
      monitoring = true;
      monitorStart = millis();
      monitorLast[0] = '\0';
      monitorNameCount = 0;
      Serial.println("見え方の連続モニターを始めます（変化したときだけ表示。止めるには n）。タグの名前は、最初に見えた順に A B C…");
      printSettings();
      break;
    case 'p': {
      static const uint8_t LEVELS[] = {0x20, 0x18, 0x10, 0x0C, 0x08};
      int index = 0;
      for (int k = 0; k < (int)sizeof(LEVELS); k++) {
        if (LEVELS[k] == readersRfPower()) index = k;
      }
      readersSetRfPower(LEVELS[(index + 1) % sizeof(LEVELS)]);
      printSettings();
      break;
    }
    case 'm': {
      IdleMethod next = readersIdleMethod() == IDLE_ANTENNA_OFF ? IDLE_RESET : IDLE_ANTENNA_OFF;
      if (!readersSetIdleMethod(next, true)) {
        Serial.printf("RESET方式の自己診断で、%d 台のリーダーがうまく起きませんでした。止め方は変えていません。\n", readersLastSelfTestFailures());
      }
      printSettings();
      break;
    }
    case 'g': {
      int index = 0;
      for (int k = 0; k < (int)sizeof(GAIN_ORDER); k++) {
        if (GAIN_ORDER[k] == readersGainDb()) index = k;
      }
      readersSetGainDb(GAIN_ORDER[(index + 1) % sizeof(GAIN_ORDER)]);
      printSettings();
      break;
    }
    default: printHelp(); break;
  }
}

// loop() から、テストモード中は毎回呼ばれる
void testLoop() {
  if (monitoring) {
    monitorOnce();
  } else if (scanning) {
    scanOnce();
  } else {
    delay(10);
  }
}
