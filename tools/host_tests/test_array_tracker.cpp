// 駒の持ち主を決める部品（src/array_tracker.cpp）のテスト。
//   偽のリーダーを使う: 「どのリーダーが、どの位置の駒を、どの感度の段から読めるか」を、表（確率）で決める。
//   2026-10-19 の実機で起きた「リーダー5に置いた駒を、リーダー6も読む」を、パソコン上で再現して、直ったか確かめる。
//   実行:  g++ -std=gnu++11 -Wall -Wextra -Isrc tools/host_tests/test_array_tracker.cpp src/array_tracker.cpp -o /tmp/t && /tmp/t
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <vector>

#include "array_tracker.h"

static int fails = 0;
static int checks = 0;
static bool verbose = false;      // 環境変数 TRACKER_VERBOSE があれば、ランダムな動かし方ごとの測定も表示
static int fuzzMoves = 0, fuzzQuick = 0, fuzzGlitches = 0, fuzzSeeds = 0;   // ランダム（同点なし）の合計

static void check(const char* name, bool ok) {
  checks++;
  if (!ok) {
    fails++;
    printf("FAIL %s\n", name);
  }
}

static TagUid makeUid(uint8_t a) {
  TagUid u;
  memset(&u, 0, sizeof(u));
  u.size = 4;
  u.bytes[0] = a;
  u.bytes[1] = 0x5A;
  u.bytes[2] = 0xC3;
  u.bytes[3] = 0x11;
  return u;
}
static bool sameUid(const TagUid& a, const TagUid& b) { return a.size == b.size && memcmp(a.bytes, b.bytes, a.size) == 0; }

// ------------------------------------------------------------
// 偽のリーダー
// ------------------------------------------------------------
struct FakeRf : ArrayRf {
  enum { MAXR = 8, MAXT = 8, LEVELS = 6 };
  int n;
  bool aliveFlag[MAXR];
  int defLevel;                       // 標準の感度の段（2 = 33dB）
  uint32_t now;                       // 偽の時計（ms）
  uint32_t seed;
  TagUid uids[MAXT];
  int pos[MAXT];                      // 駒がいるリーダー（-1 = どこにもない）
  double prob[MAXR][MAXR][LEVELS];    // [リーダー][駒の位置][段] = 読める確率
  int fineReq[MAXR][MAXR];            // [リーダー][駒の位置] = 読めはじめる段の1つ下で、読めるために必要な、しきい値を下げる段数（99 = 下げても読めない）
  int garbleNext[MAXR];               // このリーダーの、次の N 回の読み取りは、「返事はあったのに読めない」（電波の乱れ。約8msで失敗する）
  uint32_t blackoutUntil[MAXR];       // この時刻（ms）まで、このリーダーは、どの感度でも何も読めない（何も答えない）。実機の、短い途切れ
  bool lastHintSet[MAXR];             // 最後に教えられた「載っているはずの駒」（直接呼びかけるための hint）
  TagUid lastHint[MAXR];
  bool hintPending[MAXR];             // 次の読み取りで使う hint（1回だけ有効）
  bool hintQuickPending[MAXR];        // その hint は、確かめるだけ（confirmOnly）か
  TagUid hintUid[MAXR];
  double antiFail[MAXR];              // 衝突回避（hint で当たらなかった読み取り）が、「返事はあったのに読めない」で失敗する確率（隣の駒との衝突）
  TagUid knownList[MAXT];             // 登録済みの駒の一覧（tag_store の代わり）
  int knownN;
  uint32_t scans;

  explicit FakeRf(int n_) : n(n_), defLevel(2), now(0), seed(12345), scans(0) {
    memset(prob, 0, sizeof(prob));
    memset(garbleNext, 0, sizeof(garbleNext));
    memset(blackoutUntil, 0, sizeof(blackoutUntil));
    memset(lastHintSet, 0, sizeof(lastHintSet));
    memset(lastHint, 0, sizeof(lastHint));
    memset(hintPending, 0, sizeof(hintPending));
    memset(hintQuickPending, 0, sizeof(hintQuickPending));
    memset(hintUid, 0, sizeof(hintUid));
    memset(antiFail, 0, sizeof(antiFail));
    memset(knownList, 0, sizeof(knownList));
    knownN = 0;
    for (int a = 0; a < MAXR; a++) for (int b = 0; b < MAXR; b++) fineReq[a][b] = 99;
    for (int i = 0; i < MAXR; i++) aliveFlag[i] = i < n;
    for (int t = 0; t < MAXT; t++) {
      uids[t] = makeUid((uint8_t)(0x10 + t * 0x11));
      pos[t] = -1;
    }
  }
  double rnd() {
    seed = seed * 1664525u + 1013904223u;
    return ((seed >> 8) & 0xFFFF) / 65536.0;
  }
  // リーダー reader が、位置 position の駒を、段 thr から読める（thr-1 の段では、確率 soft で読める）
  void couple(int reader, int position, int thr, double soft) {
    for (int L = 0; L < LEVELS; L++) prob[reader][position][L] = (L >= thr) ? 1.0 : (L == thr - 1 ? soft : 0.0);
  }
  void clearCoupling() { memset(prob, 0, sizeof(prob)); }
  // 一列に並んだリーダー: 真下は ownThr から、両隣は shThr から（その1つ下の段では、確率 shSoft で）読める
  void rowCoupling(int ownThr, int shThr, double shSoft) {
    clearCoupling();
    for (int p = 0; p < n; p++) {
      couple(p, p, ownThr, 0.0);
      if (p > 0) couple(p - 1, p, shThr, shSoft);
      if (p + 1 < n) couple(p + 1, p, shThr, shSoft);
    }
  }

  void hint(int reader, const TagUid* expected, bool confirmOnly) override {
    if (reader < 0 || reader >= MAXR) return;
    hintQuickPending[reader] = expected != nullptr && confirmOnly;
    lastHintSet[reader] = expected != nullptr;
    if (expected != nullptr) lastHint[reader] = *expected;
    hintPending[reader] = expected != nullptr;
    if (expected != nullptr) hintUid[reader] = *expected;
  }
  int knownCount() override { return knownN; }
  bool knownAt(int i, TagUid* out) override {
    if (i < 0 || i >= knownN) return false;
    *out = knownList[i];
    return true;
  }
  void registerAll() {   // 8枚すべてを、登録済みにする
    knownN = MAXT;
    for (int t = 0; t < MAXT; t++) knownList[t] = uids[t];
  }
  bool alive(int r) override { return r >= 0 && r < n && aliveFlag[r]; }
  int defaultLevel() override { return defLevel; }
  int levelCount() override { return LEVELS; }
  uint32_t nowMs() override { return now; }
  int scan(int reader, int level, int sub, TagUid* out, int maxTags) override {
    int L = level < 0 ? defLevel : level;
    if (reader >= 0 && reader < MAXR && garbleNext[reader] > 0) {   // 返事はあったのに読めない（駒が、ある・ないは、分からない）
      garbleNext[reader]--;
      now += 8;
      scans++;
      return ArrayRf::SCAN_GARBLED;
    }
    now += 18;   // 駒のないリーダー1台の読み取りにかかる時間
    scans++;
    if (reader >= 0 && reader < MAXR && now < blackoutUntil[reader]) return 0;   // 途切れの間は、何も答えない
    int cnt = 0;
    // UID の大きい駒から見つかる（実機の衝突回避と同じ向き）
    int order[MAXT];
    for (int t = 0; t < MAXT; t++) order[t] = t;
    for (int a = 0; a < MAXT; a++) {
      for (int b = a + 1; b < MAXT; b++) {
        if (memcmp(uids[order[b]].bytes, uids[order[a]].bytes, 4) > 0) { int x = order[a]; order[a] = order[b]; order[b] = x; }
      }
    }
    bool hinted = reader >= 0 && reader < MAXR && hintPending[reader];
    bool quick = reader >= 0 && reader < MAXR && hintQuickPending[reader];   // 確かめるだけ（読めたら、ほかの駒は探さない）
    TagUid hu = hinted ? hintUid[reader] : TagUid();
    if (reader >= 0 && reader < MAXR) { hintPending[reader] = false; hintQuickPending[reader] = false; }
    bool readable[MAXT];
    int readableN = 0;
    for (int t = 0; t < MAXT; t++) readable[t] = false;
    for (int i = 0; i < MAXT; i++) {
      int t = order[i];
      if (pos[t] < 0) continue;
      double p = prob[reader][pos[t]][L];
      if (level >= 0 && sub > 0 && L + 1 < LEVELS && prob[reader][pos[t]][L + 1] >= 1.0 && p < 1.0 && sub >= fineReq[reader][pos[t]]) p = 1.0;
      if (rnd() < p) { readable[t] = true; readableN++; }
    }
    // 直接呼びかけ（hint）: 一致する駒が読める範囲にいれば、衝突があっても、その駒だけは読める
    bool direct = false;
    if (hinted) {
      for (int t = 0; t < MAXT; t++) {
        if (readable[t] && sameUid(uids[t], hu)) { out[cnt++] = uids[t]; now += 5; direct = true; readable[t] = false; break; }
      }
    }
    if (direct && quick) { now -= 8; return cnt; }   // 確かめるだけ: ほかの駒は探さない（実機では、待ち時間を約20ms 省く）
    // 衝突回避: 隣の駒と同時に答えて、失敗することがある（ただし、直接読めたときは、そのまま続ける）
    if (!direct && readableN > 0 && reader >= 0 && reader < MAXR && antiFail[reader] > 0.0 && rnd() < antiFail[reader]) {
      now -= 10;   // 約8msで失敗する
      return ArrayRf::SCAN_GARBLED;
    }
    for (int i = 0; i < MAXT; i++) {
      int t = order[i];
      if (!readable[t] || cnt >= maxTags) continue;
      out[cnt++] = uids[t];
      now += 5;   // 1枚読むごとに、少し時間がかかる
    }
    return cnt;
  }
};

// ------------------------------------------------------------
// 動かして、イベントを記録する
// ------------------------------------------------------------
struct Logged {
  uint32_t t;
  ReaderEvent e;
};
struct Rig {
  FakeRf rf;
  ArrayTracker tr;
  std::vector<Logged> log;
  bool opsOk;       // poll 1回の RF 読み取りが 1回以内か
  bool consistentOk;

  explicit Rig(int n) : rf(n), tr(&rf, n), opsOk(true), consistentOk(true) {}

  void step() {
    uint32_t before = tr.rfOpCount();
    ReaderEvent e;
    bool got = tr.poll(&e);
    if (tr.rfOpCount() - before > 1) opsOk = false;
    if (!tr.consistent()) consistentOk = false;
    if (got) log.push_back({rf.now, e});
    if (tr.rfOpCount() == before) rf.now += 1;   // RF を使わなかった呼び出しでも、時間は少し進む
  }
  void run(uint32_t ms) {
    uint32_t end = rf.now + ms;
    while (rf.now < end) step();
  }
  // 判定が終わる（busy でなくなる）まで、最大 ms だけ動かす
  bool settle(uint32_t ms) {
    uint32_t end = rf.now + ms;
    while (rf.now < end) {
      step();
      if (!tr.busy()) {
        // 念のため、あと1周だけ動かして、まだ何も起きないことを確かめる
        run(200);
        if (!tr.busy()) return true;
      }
    }
    return false;
  }
  size_t mark() const { return log.size(); }
  int count(size_t from, ReaderEventType type, int reader, int tag) const {
    int c = 0;
    for (size_t i = from; i < log.size(); i++) {
      if (log[i].e.type == type && (reader < 0 || log[i].e.reader == reader) && (tag < 0 || sameUid(log[i].e.uid, rf.uids[tag]))) c++;
    }
    return c;
  }
  int total(size_t from) const { return (int)(log.size() - from); }
  // 盤面が、駒の本当の位置と同じか
  bool matchesTruth() const {
    for (int r = 0; r < rf.n; r++) {
      int tag = -1;
      for (int t = 0; t < FakeRf::MAXT; t++) {
        if (rf.pos[t] == r) tag = t;
      }
      if (tag < 0) {
        if (tr.hasTag(r)) return false;
      } else {
        if (!tr.hasTag(r) || !sameUid(tr.uid(r), rf.uids[tag])) return false;
      }
    }
    return true;
  }
  std::string dump(size_t from = 0) const {
    std::string s;
    for (size_t i = from; i < log.size(); i++) {
      char buf[96];
      int tag = -1;
      for (int t = 0; t < FakeRf::MAXT; t++) {
        if (sameUid(rf.uids[t], log[i].e.uid)) tag = t;
      }
      const char* ty = log[i].e.type == READER_EVENT_PLACED ? "PLACED" : (log[i].e.type == READER_EVENT_CHANGED ? "CHANGED" : "REMOVED");
      snprintf(buf, sizeof(buf), " [%ums %s R%d tag%d]", (unsigned)log[i].t, ty, log[i].e.reader, tag);
      s += buf;
    }
    return s;
  }
};

// 持ち主の確かめ直し（RECHECK_MS）を含めて、落ち着くまで待つ時間
static uint32_t RECHECK_MS_PLUS() { return ArrayTracker::RECHECK_MS + 4000; }

// 失敗したときに、何が起きたかを出す
static void why(const Rig& g, size_t from, const char* name) {
  printf("   ↳ %s: %s\n", name, g.dump(from).c_str());
}

// ------------------------------------------------------------
// 1. 影のない、ふつうの置く・外す
// ------------------------------------------------------------
static void testPlainPlaceRemove() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);   // 両隣は読めない
  g.run(500);
  size_t m = g.mark();
  g.rf.pos[0] = 3;
  uint32_t t0 = g.rf.now;
  g.run(1500);
  check("置く: PLACED がちょうど1回", g.count(m, READER_EVENT_PLACED, 3, 0) == 1 && g.total(m) == 1);
  if (!(g.count(m, READER_EVENT_PLACED, 3, 0) == 1 && g.total(m) == 1)) why(g, m, "置く");
  uint32_t lat = g.log.empty() ? 99999 : g.log.back().t - t0;
  printf("  [測定] 置いてから PLACED まで: %u ms（偽の時計。1周 約%u ms）\n", (unsigned)lat, (unsigned)(8 * 18));
  check("置く: 0.6秒以内に PLACED", lat < 600);
  check("置く: 盤面が本当と同じ", g.matchesTruth());
  check("置く: 影はない", !g.tr.isShadow(2) && !g.tr.isShadow(4));
  check("置く: 比べ読みはしていない（競争相手がいない）", g.tr.arbitrationCount() == 0);

  m = g.mark();
  g.rf.pos[0] = -1;
  t0 = g.rf.now;
  g.run(1500);
  check("外す: REMOVED がちょうど1回", g.count(m, READER_EVENT_REMOVED, 3, 0) == 1 && g.total(m) == 1);
  lat = g.log.empty() ? 99999 : g.log.back().t - t0;
  printf("  [測定] 外してから REMOVED まで: %u ms\n", (unsigned)lat);
  check("外す: 1秒以内に REMOVED（猶予 0.5秒 + 高い感度での最後の確かめ。ちらつきで、外れたと誤らないための待ち）", lat < 1000);
  check("外す: すぐには知らせない（猶予のあいだは、駒がまだ載っているものとして扱う）", lat >= ArrayTracker::MISS_MIN_MS);
  check("外す: 盤面が本当と同じ", g.matchesTruth());
  check("どの呼び出しも RF の読み取りは1回以内", g.opsOk);
  check("内部の記録に矛盾がない", g.consistentOk);
}

// ------------------------------------------------------------
// 2. 影: 隣のリーダーも同じ駒を読む（実機の不具合の再現）
// ------------------------------------------------------------
static void testShadow(int placeAt, const char* label) {
  Rig g(8);
  // 真下は段1から。両隣は、標準の段(2)で半分の確率で読め、段3からは確実に読める（実機: R6 が A を 6 と 7 の間でちらつく）
  g.rf.rowCoupling(1, 3, 0.5);
  g.run(500);
  size_t m = g.mark();
  g.rf.pos[0] = placeAt;
  g.run(3000);
  char name[96];
  snprintf(name, sizeof(name), "影(%s): 置いたリーダーだけに PLACED が1回", label);
  bool ok = g.count(m, READER_EVENT_PLACED, placeAt, 0) == 1 && g.total(m) == 1;
  check(name, ok);
  if (!ok) why(g, m, label);
  snprintf(name, sizeof(name), "影(%s): 盤面が本当と同じ（隣に駒はない）", label);
  check(name, g.matchesTruth());
  // 10秒ぶん動かしても、イベントが増えない（ちらつきで、置いた・外したが出ない）
  m = g.mark();
  g.run(10000);
  snprintf(name, sizeof(name), "影(%s): 10秒間、イベントが出ない", label);
  check(name, g.total(m) == 0);
  if (g.total(m) != 0) why(g, m, label);
  // 影のリーダーが、影として扱われている瞬間がある
  bool sawShadow = false;
  for (int i = 0; i < 300 && !sawShadow; i++) {
    g.step();
    if (placeAt > 0 && g.tr.shadowOwner(placeAt - 1) == placeAt) sawShadow = true;
    if (placeAt + 1 < 8 && g.tr.shadowOwner(placeAt + 1) == placeAt) sawShadow = true;
  }
  snprintf(name, sizeof(name), "影(%s): 隣のリーダーが「影」と分かる", label);
  check(name, sawShadow);
  check("影: 比べ読みをした", g.tr.arbitrationCount() >= 1);
  check("影: どの呼び出しも RF の読み取りは1回以内", g.opsOk);
  check("影: 内部の記録に矛盾がない", g.consistentOk);

  // 外すと、影も含めて何も残らない
  m = g.mark();
  g.rf.pos[0] = -1;
  g.run(2000);
  snprintf(name, sizeof(name), "影(%s): 外すと、持ち主のリーダーに REMOVED が1回だけ", label);
  ok = g.count(m, READER_EVENT_REMOVED, placeAt, 0) == 1 && g.total(m) == 1;
  check(name, ok);
  if (!ok) why(g, m, label);
  check("影: 外したあと、盤面が空", g.matchesTruth());
}

// ------------------------------------------------------------
// 3. 影が確実に読める（ちらつかない）場合
// ------------------------------------------------------------
static void testSteadyShadow() {
  Rig g(8);
  g.rf.rowCoupling(1, 2, 0.0);   // 隣は標準の段(2)で確実に読める。真下は段1から（隣より1段弱い電波で読める）
  g.run(500);
  for (int placeAt : {4, 5, 6}) {   // リーダー5・6・7（0から数えて 4, 5, 6）
    size_t m = g.mark();
    g.rf.pos[0] = placeAt;
    g.run(3000);
    char name[96];
    snprintf(name, sizeof(name), "確実な影: リーダー%d に置く → そのリーダーだけに PLACED", placeAt + 1);
    bool ok = g.count(m, READER_EVENT_PLACED, placeAt, 0) == 1 && g.total(m) == 1 && g.matchesTruth();
    check(name, ok);
    if (!ok) why(g, m, name);
    g.rf.pos[0] = -1;
    g.run(2000);
    check("確実な影: 外すと盤面が空", g.matchesTruth());
  }
}

// ------------------------------------------------------------
// 4. 2枚を隣に置く。1枚だけ読む方式だと、自分の駒が隠れる（衝突回避は UID の大きい駒を返す）
// ------------------------------------------------------------
static void testNeighborsBoth() {
  Rig g(8);
  g.rf.rowCoupling(1, 2, 0.0);
  g.run(500);
  size_t m = g.mark();
  // タグ番号が大きいほど UID が大きい。リーダー5(4)に大きいUIDの駒、リーダー6(5)に小さいUIDの駒
  g.rf.pos[5] = 4;
  g.rf.pos[1] = 5;
  g.run(4000);
  bool ok = g.matchesTruth() && g.total(m) == 2;
  check("隣に2枚: どちらも自分のリーダーに見つかる", ok);
  if (!ok) why(g, m, "隣に2枚");
  // 逆の並び
  Rig h(8);
  h.rf.rowCoupling(1, 2, 0.0);
  h.run(500);
  size_t m2 = h.mark();
  h.rf.pos[1] = 4;
  h.rf.pos[5] = 5;
  h.run(4000);
  ok = h.matchesTruth() && h.total(m2) == 2;
  check("隣に2枚（逆の並び）: どちらも自分のリーダーに見つかる", ok);
  if (!ok) why(h, m2, "隣に2枚(逆)");
  // 3枚並べる
  Rig k(8);
  k.rf.rowCoupling(1, 2, 0.0);
  k.run(500);
  size_t m3 = k.mark();
  k.rf.pos[2] = 3;
  k.rf.pos[6] = 4;
  k.rf.pos[0] = 5;
  k.run(5000);
  ok = k.matchesTruth() && k.total(m3) == 3;
  check("隣に3枚: すべて自分のリーダーに見つかる", ok);
  if (!ok) why(k, m3, "隣に3枚");
}

// ------------------------------------------------------------
// 5. 動かす: 持ち上げて別のリーダーへ / 滑らせて隣へ / 入れ替え
// ------------------------------------------------------------
static void testMoves() {
  {
    Rig g(8);
    g.rf.rowCoupling(1, 2, 0.0);
    g.rf.pos[0] = 3;
    g.run(2500);
    check("移動の前: リーダー4に載っている", g.matchesTruth() && g.tr.hasTag(3));
    size_t m = g.mark();
    g.rf.pos[0] = -1;           // 持ち上げる
    g.run(150);
    g.rf.pos[0] = 4;            // 隣のリーダー5に置く
    g.run(3000);
    bool ok = g.matchesTruth() && g.count(m, READER_EVENT_REMOVED, 3, 0) == 1 && g.count(m, READER_EVENT_PLACED, 4, 0) == 1;
    check("持ち上げて隣へ: REMOVED(R4) → PLACED(R5)", ok);
    if (!ok) why(g, m, "持ち上げて隣へ");
  }
  {
    Rig g(8);
    g.rf.rowCoupling(1, 2, 0.0);
    g.rf.pos[0] = 3;
    g.run(2500);
    size_t m = g.mark();
    g.rf.pos[0] = 4;            // 持ち上げずに、滑らせて隣へ（リーダー4は、そのまま影として読み続ける）
    g.run(ArrayTracker::RECHECK_MS + 3000);
    bool ok = g.matchesTruth() && g.count(m, READER_EVENT_REMOVED, 3, 0) == 1 && g.count(m, READER_EVENT_PLACED, 4, 0) == 1;
    check("滑らせて隣へ: 数秒のうちに持ち主が移る", ok);
    if (!ok) why(g, m, "滑らせて隣へ");
    // 順序: REMOVED が先
    bool order = true;
    for (size_t i = m; i + 1 < g.log.size(); i++) {
      if (g.log[i].e.type == READER_EVENT_PLACED && g.log[i + 1].e.type == READER_EVENT_REMOVED) order = false;
    }
    check("滑らせて隣へ: 外れた → 置かれた の順", order);
  }
  {
    Rig g(8);
    g.rf.rowCoupling(1, 2, 0.0);
    g.rf.pos[0] = 4;
    g.rf.pos[1] = 5;
    g.run(3000);
    check("入れ替えの前: 2枚とも見つかっている", g.matchesTruth());
    size_t m = g.mark();
    g.rf.pos[0] = 5;            // 2枚を一瞬で入れ替える
    g.rf.pos[1] = 4;
    g.run(RECHECK_MS_PLUS());
    bool ok = g.matchesTruth();
    check("入れ替え: 数秒のうちに、本当の位置になる", ok);
    if (!ok) why(g, m, "入れ替え");
    check("入れ替え: 内部の記録に矛盾がない", g.consistentOk);
  }
  {
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.rf.pos[0] = 3;
    g.run(2000);
    size_t m = g.mark();
    g.rf.pos[0] = -1;           // 同じリーダーで、駒を別の駒に取り替える（持ち上げて、すぐ別の駒を置く）
    g.run(40);
    g.rf.pos[1] = 3;
    g.run(2500);
    bool ok = g.matchesTruth() && g.count(m, READER_EVENT_PLACED, 3, 1) + g.count(m, READER_EVENT_CHANGED, 3, 1) == 1;
    check("同じリーダーで駒の取り替え: 新しい駒が見つかり、盤面が合う", ok);
    if (!ok) why(g, m, "取り替え");
  }
}

// ------------------------------------------------------------
// 6. 同じ強さで読める2つのリーダー（決め手がない）: 安定して1つに決まり、揺れない
// ------------------------------------------------------------
static void testTie() {
  Rig g(8);
  g.rf.clearCoupling();
  g.rf.couple(4, 4, 1, 0.0);
  g.rf.couple(5, 4, 1, 0.0);   // 位置4の駒を、リーダー4とリーダー5が、同じ強さで読む
  g.run(300);
  size_t m = g.mark();
  g.rf.pos[0] = 4;
  g.run(30000);
  int placed = g.count(m, READER_EVENT_PLACED, -1, 0);
  int removed = g.count(m, READER_EVENT_REMOVED, -1, 0);
  check("同点: 30秒間、置かれたのは1回だけ", placed == 1 && removed == 0);
  if (!(placed == 1 && removed == 0)) why(g, m, "同点");
  check("同点: どちらか1つのリーダーだけが持ち主", (g.tr.hasTag(4) ? 1 : 0) + (g.tr.hasTag(5) ? 1 : 0) == 1);
  check("同点: 内部の記録に矛盾がない", g.consistentOk);
}

// ------------------------------------------------------------
// 6b. 同じ段で読めても、受信のしきい値を細かく動かすと、本命が分かる（2026-10-19 の実機: 駒をリーダー7 に置くと、リーダー6 も同じ段から読めた）
// ------------------------------------------------------------
static void testFineTieBreak() {
  for (int ownerIsLower = 0; ownerIsLower < 2; ownerIsLower++) {
    Rig g(8);
    g.rf.clearCoupling();
    int own = ownerIsLower ? 5 : 6, other = ownerIsLower ? 6 : 5;
    // 位置 own の駒を、リーダー own と other が、どちらも標準の段(2)から読める（同じ段）。しきい値は own のほうが少なく下げれば読める
    g.rf.couple(own, own, 2, 0.0);
    g.rf.couple(other, own, 2, 0.0);
    g.rf.fineReq[own][own] = 3;
    g.rf.fineReq[other][own] = 5;
    g.run(300);
    size_t m = g.mark();
    g.rf.pos[0] = own;
    g.run(4000);
    char name[96];
    snprintf(name, sizeof(name), "細かい比べ(本命=リーダー%d): 本命だけに PLACED", own + 1);
    bool ok = g.count(m, READER_EVENT_PLACED, own, 0) == 1 && g.total(m) == 1;
    check(name, ok);
    if (!ok) why(g, m, name);
    check("細かい比べ: 比べ読みの記録に、細かい比べで決まったと残る",
          g.tr.verdictCount() >= 1 && g.tr.lastVerdict().fineRan && g.tr.lastVerdict().fineWinner == own);
    m = g.mark();
    g.run(30000);   // 確かめ直しを何度しても、同じ結果で揺れない
    check("細かい比べ: 30秒間、イベントが出ない", g.total(m) == 0);
  }
  {
    // 細かく動かしても決め手がない（どちらも下げ切るまで読めない）: 落ちずに、どちらかに決まって、揺れない
    Rig g(8);
    g.rf.clearCoupling();
    g.rf.couple(5, 5, 2, 0.0);
    g.rf.couple(6, 5, 2, 0.0);
    g.run(300);
    size_t m = g.mark();
    g.rf.pos[0] = 5;
    g.run(20000);
    check("細かい比べでも決め手なし: PLACED は1回だけ", g.count(m, READER_EVENT_PLACED, -1, 0) == 1 && g.total(m) == 1);
    check("細かい比べでも決め手なし: 内部の記録に矛盾がない", g.consistentOk && g.opsOk);
  }
}

// ------------------------------------------------------------
// 7. 起動時: 置いてある駒を、影も含めて見分ける
// ------------------------------------------------------------
static void testBoot() {
  Rig g(8);
  g.rf.rowCoupling(1, 2, 0.0);
  g.rf.pos[0] = 0;
  g.rf.pos[1] = 2;
  g.rf.pos[2] = 5;
  g.rf.pos[3] = 6;
  uint32_t t0 = g.rf.now;
  bool settled = g.settle(4000);
  uint32_t took = g.rf.now - t0;
  printf("  [測定] 起動時に4枚を見分けるまで: %u ms（偽の時計）、比べ読み %u 回\n", (unsigned)took, (unsigned)g.tr.arbitrationCount());
  check("起動: 判定が終わる", settled);
  check("起動: 4枚とも、自分のリーダーで見つかる", g.matchesTruth());
  check("起動: 4秒以内", took < 4000);
}

// ------------------------------------------------------------
// 8. 応答しないリーダーがあっても動く
// ------------------------------------------------------------
static void testDeadReader() {
  Rig g(8);
  g.rf.rowCoupling(1, 2, 0.0);
  g.rf.aliveFlag[6] = false;
  g.rf.aliveFlag[7] = false;
  g.rf.pos[0] = 4;
  g.rf.pos[1] = 5;
  bool settled = g.settle(4000);
  check("応答しないリーダーがあっても、判定が終わる", settled);
  check("応答しないリーダーがあっても、盤面が合う", g.matchesTruth());
  Rig h(4);
  h.rf.rowCoupling(1, 2, 0.0);
  h.rf.pos[0] = 1;
  h.settle(3000);
  check("4台構成でも動く", h.matchesTruth());
  Rig z(8);
  for (int i = 0; i < 8; i++) z.rf.aliveFlag[i] = false;
  z.run(500);
  check("1台も応答しなくても、止まらない", z.log.empty());
}

// ------------------------------------------------------------
// 9. 持ち主がちらつかない: 真下のリーダーが、まれに読み損なっても、外れたと誤認しない
// ------------------------------------------------------------
static void testOwnerFlicker() {
  Rig g(8);
  g.rf.rowCoupling(1, 3, 0.5);
  // 真下は、標準の段で 98% 読める
  for (int L = 0; L < FakeRf::LEVELS; L++) g.rf.prob[4][4][L] = (L >= 2) ? 0.98 : (L == 1 ? 0.9 : 0.0);
  g.rf.pos[0] = 4;
  g.run(3000);
  size_t m = g.mark();
  g.run(120000);
  check("持ち主が時々読み損なっても、2分間イベントが出ない", g.total(m) == 0);
  if (g.total(m) != 0) why(g, m, "ちらつき");
  check("2分後も、盤面が本当と同じ", g.matchesTruth());
}

// ------------------------------------------------------------
// 10. ランダムに動かす（影の強さも、駒の数も、動かし方もランダム）
// ------------------------------------------------------------
static void testFuzz(uint32_t seed, int moves, bool tiesAllowed) {
  Rig g(8);
  g.rf.seed = seed;
  // 影の強さをランダムに決める。真下より必ず弱い（対応している範囲）。tiesAllowed のときは、同じ強さも混ぜる
  uint32_t s = seed * 2654435761u + 1;
  auto rnd = [&s]() { s = s * 1664525u + 1013904223u; return (s >> 8) & 0xFFFF; };
  g.rf.clearCoupling();
  for (int p = 0; p < 8; p++) {
    int own = (rnd() % 2 == 0) ? 0 : 1;
    g.rf.couple(p, p, own, 0.0);
    for (int d = -1; d <= 1; d += 2) {
      int r = p + d;
      if (r < 0 || r >= 8) continue;
      if (rnd() % 3 == 0) continue;   // 隣が読めない組み合わせも混ぜる
      int sh = own + 1 + (int)(rnd() % 2);                 // 真下より 1〜2 段強い電波が必要
      double soft = (rnd() % 2 == 0) ? 0.0 : 0.5;
      if (tiesAllowed && rnd() % 6 == 0) { sh = own; soft = 0.0; }   // たまに、真下とまったく同じ強さ（決め手がない）
      if (sh > 4) sh = 4;
      g.rf.couple(r, p, sh, soft);
    }
  }
  int bad = 0;
  int wrongPlacedAtShadow = 0;
  int glitches = 0;      // 一時的にでも、駒の本当の位置とちがうリーダーに「置かれた」と知らせた回数
  int movesDone = 0;
  int quickOk = 0;       // 動かして 1.5〜2.5 秒後に、もう盤面が本当と同じになっていた回数
  for (int mv = 0; mv < moves; mv++) {
    // ランダムに、駒を1つ選んで、動かす（置く・外す・別の場所へ）
    int t = (int)(rnd() % 4);
    int to = (int)(rnd() % 9) - 1;   // -1 = 外す
    bool occupied = false;
    for (int u = 0; u < 4; u++) {
      if (u != t && g.rf.pos[u] == to) occupied = true;
    }
    if (occupied) continue;
    if (to >= 0 && g.rf.pos[t] >= 0 && rnd() % 2 == 0) {
      g.rf.pos[t] = -1;      // 持ち上げてから置く。ふつうは 0.3〜0.8 秒。ときどき、とても速い 0.1〜0.2 秒（1周の読み取りより短い）
      g.run((rnd() % 6 == 0) ? 100 + rnd() % 100 : 300 + rnd() % 500);
    }
    g.rf.pos[t] = to;
    size_t evFrom = g.mark();
    movesDone++;
    // 持ち上げずに隣へ滑らせた場合や、とても速く動かした場合は、持ち主の確かめ直し（数秒ごと）で直るので、その分を待つ
    g.run(1500);
    bool quick = g.settle(1000) && g.matchesTruth();
    if (quick) quickOk++;
    g.run(RECHECK_MS_PLUS());
    if (!g.settle(RECHECK_MS_PLUS() + 2000)) { bad++; continue; }
    for (size_t i = evFrom; i < g.log.size(); i++) {
      if (g.log[i].e.type == READER_EVENT_REMOVED) continue;
      int tg = -1;
      for (int u2 = 0; u2 < FakeRf::MAXT; u2++) {
        if (sameUid(g.rf.uids[u2], g.log[i].e.uid)) tg = u2;
      }
      if (tg < 0 || g.rf.pos[tg] != g.log[i].e.reader) glitches++;
    }
    if (!g.matchesTruth()) {
      // 同点を許すときは、本当の位置が隣と同じ強さの場合に、隣が選ばれることがある（決め手がない）ので、駒の数だけ確かめる
      bool countOk = true;
      int truth = 0, shown = 0;
      for (int r = 0; r < 8; r++) {
        for (int u = 0; u < 4; u++) {
          if (g.rf.pos[u] == r) truth++;
        }
        if (g.tr.hasTag(r)) shown++;
      }
      if (truth != shown) countOk = false;
      if (!(tiesAllowed && countOk)) { bad++; if (bad <= 3) printf("   ↳ fuzz seed=%u mv=%d 不一致\n", (unsigned)seed, mv); }
      else wrongPlacedAtShadow++;
    }
  }
  char name[160];
  snprintf(name, sizeof(name), "ランダム(seed=%u%s): 動かすたびに、盤面が本当と同じになる", (unsigned)seed, tiesAllowed ? "・同点あり" : "");
  check(name, bad == 0);
  if (verbose) {
    printf("  [測定] ランダム(seed=%u%s): 動かした %d 回のうち、2.5秒後に正しかった %d 回、一時的にでも違うリーダーに「置かれた」と知らせた回数 %d、比べ読み %u 回、RF 読み取り %u 回\n",
           (unsigned)seed, tiesAllowed ? "・同点あり" : "", movesDone, quickOk, glitches, (unsigned)g.tr.arbitrationCount(), (unsigned)g.tr.rfOpCount());
  }
  if (!tiesAllowed) {
    fuzzMoves += movesDone;
    fuzzQuick += quickOk;
    fuzzGlitches += glitches;
    fuzzSeeds++;
  }
  if (!tiesAllowed) {
    snprintf(name, sizeof(name), "ランダム(seed=%u): 違うリーダーに「置かれた」と知らせたのは、動かした回数の5%%以下", (unsigned)seed);
    check(name, glitches * 20 <= movesDone);
  }
  check("ランダム: どの呼び出しも RF の読み取りは1回以内", g.opsOk);
  check("ランダム: 内部の記録に矛盾がない", g.consistentOk);
  (void)wrongPlacedAtShadow;
}

// ------------------------------------------------------------
// 「返事はあったのに読めない」読み取り（電波の乱れ）は、「駒がない」の証拠にしない
//   実機（2026-11-15）: リーダー3の駒を扱っている間に、リーダー8の動かしていない駒が、約90msの間に11回続けて読めず、
//   「外れた」と誤って知らせられた（本当に外したときは、何も答えない=タイムアウトで、6回）
// ------------------------------------------------------------
static int drainNotes(ArrayTracker& tr, std::vector<ArrayTracker::EventNote>& out);   // 下で定義
static void testGarbledReads() {
  {
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.rf.pos[0] = 7;
    g.run(1500);
    check("乱れ: 駒がリーダー8にある（確定）", g.tr.hasTag(7));
    size_t m = g.mark();
    std::vector<ArrayTracker::EventNote> notes;
    drainNotes(g.tr, notes);
    notes.clear();
    g.rf.garbleNext[7] = 14;       // 11回以上、続けて「返事はあったのに読めない」（1周に1回ずつ進むので、14周 = 約2秒）
    g.run(3500);
    check("乱れ: 駒は動かしていない → 「外れた」と知らせない（REMOVED なし）", g.count(m, READER_EVENT_REMOVED, 7, 0) == 0 && g.total(m) == 0);
    check("乱れ: 駒は、載ったままとして扱う", g.tr.hasTag(7) && g.matchesTruth());
    drainNotes(g.tr, notes);
    bool saw = false;
    for (size_t i = 0; i < notes.size(); i++) if (notes[i].cause == ArrayTracker::CAUSE_GARBLED && notes[i].reader == 7 && notes[i].miss >= 3) saw = true;
    check("乱れ: 乱れが続いたことが、診断用に記録される", saw);
    if (g.total(m) != 0) why(g, m, "乱れ");
    check("乱れ: 内部の記録に矛盾がない", g.consistentOk);
  }
  {
    // 乱れの途中で、本当に外されたら、乱れがおさまったあとの「何も答えない」で、ちゃんと「外れた」になる
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.rf.pos[0] = 7;
    g.run(1500);
    size_t m = g.mark();
    g.rf.garbleNext[7] = 10;
    g.rf.pos[0] = -1;              // 乱れている間に、外した
    g.run(3500);
    check("乱れの途中で外した: 乱れがおさまったあと、REMOVED が1回（遅れても、数百ms）", g.count(m, READER_EVENT_REMOVED, 7, 0) == 1 && !g.tr.hasTag(7));
  }
  {
    // 乱れが、あまりに長く続くとき（ずっと読めない）は、読めなかったものとして数える（いつまでも決められなくならない）
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.rf.pos[0] = 7;
    g.run(1500);
    size_t m = g.mark();
    g.rf.garbleNext[7] = 400;
    g.run(8000);                   // 上限（30回）まで、1周に1回ずつ進むので、約4秒
    check("乱れが長く続く（上限を超える）: やがて、読めなかったものとして、REMOVED になる", g.count(m, READER_EVENT_REMOVED, 7, 0) >= 1);
    g.rf.garbleNext[7] = 0;
    g.run(2000);
    check("乱れがおさまれば、駒はまた見つかる（PLACED）。盤面が本当と同じ", g.count(m, READER_EVENT_PLACED, 7, 0) >= 1 && g.matchesTruth());
  }
  {
    // 新しい駒の確認の最中に、別のリーダーが乱れても、確認は終わる（いつまでも待たない）
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.run(300);
    size_t m = g.mark();
    g.rf.garbleNext[7] = 20;
    g.rf.pos[0] = 2;
    bool settled = g.settle(6000);
    check("新しい駒の確認中に、別のリーダーが乱れても、確認は終わる", settled && g.count(m, READER_EVENT_PLACED, 2, 0) == 1 && g.matchesTruth());
    if (!(settled && g.count(m, READER_EVENT_PLACED, 2, 0) == 1)) why(g, m, "確認中の乱れ");
  }
}

// ------------------------------------------------------------
// 読み取りが長く止まったあとは、「読めなかった」の途中経過を捨てる（止まっている間に、時間の条件だけが満たされて、
// 動かしていない駒が「外れた」と誤判定されるのを防ぐ）
// ------------------------------------------------------------
static void testGapForgetsMisses() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);
  g.rf.pos[0] = 3;
  g.run(1500);                     // 駒が、持ち主として確定している
  check("止まる前: 駒がリーダー4にある", g.tr.hasTag(3));
  size_t m = g.mark();
  // 1〜2回だけ読み損なう（本当は載っている）→ 読み取りが 700ms 止まる（ブザーを鳴らしていた）→ 止まったあと、また2回読み損なう
  g.rf.prob[3][3][2] = 0.0;        // 標準の段(2)では、読めない
  for (int i = 0; i < 12 && g.tr.hasTag(3); i++) {
    g.step();
    if (g.tr.busy()) break;        // 読み損ないが1回以上数えられた（外れたかどうかの確認中）
  }
  g.rf.now += 700;                 // 読み取りが止まる
  g.run(60);                       // 止まったあと、少しだけ読み損なう（3回に届かないくらい）
  g.rf.couple(3, 3, 1, 0.0);       // また読めるようになる
  g.run(1500);
  check("止まったあとの読み損ないに、止まる前の読み損ないを足して、「外れた」としない（REMOVED なし）", g.count(m, READER_EVENT_REMOVED, 3, 0) == 0);
  check("止まったあとも、駒はリーダー4にあるまま", g.tr.hasTag(3) && g.matchesTruth());
  if (g.count(m, READER_EVENT_REMOVED, 3, 0) != 0) why(g, m, "止まったあと");
  // ほんとうに外したときは、止まったあとでも、ちゃんと「外れた」になる
  m = g.mark();
  g.rf.pos[0] = -1;
  g.run(1500);
  check("止まったあとでも、本当に外したときは、REMOVED が1回", g.count(m, READER_EVENT_REMOVED, 3, 0) == 1);
  check("内部の記録に矛盾がない", g.consistentOk);
}

// ------------------------------------------------------------
// イベントの原因の記録（診断用）: 置かれた・外れた・競争に勝った/負けた、が、原因つきで取り出せる
// ------------------------------------------------------------
static int drainNotes(ArrayTracker& tr, std::vector<ArrayTracker::EventNote>& out) {
  ArrayTracker::EventNote n;
  int c = 0;
  while (tr.takeNote(&n)) { out.push_back(n); c++; }
  return c;
}
static void testEventNotes() {
  {
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);   // 両隣は読めない
    g.run(500);
    std::vector<ArrayTracker::EventNote> notes;
    drainNotes(g.tr, notes);
    notes.clear();
    g.rf.pos[0] = 3;
    g.run(1500);
    drainNotes(g.tr, notes);
    check("原因: 置いたら、PLACED の原因が1件（競争相手なし = 新しく見えた駒）", notes.size() == 1 && notes[0].type == READER_EVENT_PLACED && notes[0].reader == 3 && notes[0].cause == ArrayTracker::CAUSE_NEW);
    notes.clear();
    g.rf.pos[0] = -1;
    g.run(1500);
    drainNotes(g.tr, notes);
    check("原因: 外したら、REMOVED の原因が1件（続けて読めなくなった）", notes.size() == 1 && notes[0].type == READER_EVENT_REMOVED && notes[0].reader == 3 && notes[0].cause == ArrayTracker::CAUSE_MISS);
    check("原因: 読めなかった回数と時間が残る（3回以上・猶予の時間以上）", !notes.empty() && notes[0].miss >= ArrayTracker::MISS_LIMIT && notes[0].missMs >= ArrayTracker::MISS_MIN_MS);
    ArrayTracker::EventNote x;
    check("原因: 取り出したあとは、空", !g.tr.takeNote(&x));
  }
  {
    // 影があるときは、比べ読みで決まる（勝った = WON、負けて持ち主を譲った = LOST）
    Rig g(8);
    g.rf.rowCoupling(1, 3, 0.5);    // 真下は段1から。両隣は、標準の段(2)で半分の確率で読め、段3からは確実に読める
    g.run(300);
    std::vector<ArrayTracker::EventNote> notes;
    drainNotes(g.tr, notes);
    notes.clear();
    g.rf.pos[0] = 4;
    g.settle(4000);
    drainNotes(g.tr, notes);
    bool won = false;
    for (size_t i = 0; i < notes.size(); i++) if (notes[i].type == READER_EVENT_PLACED && notes[i].reader == 4 && notes[i].cause == ArrayTracker::CAUSE_WON) won = true;
    check("原因: 隣のリーダーも読んでいる駒は、比べ読みで持ち主が決まった（WON）", won);
  }
  {
    // 溢れても、壊れない（8件より多く溜めても、古いほうから捨てるだけ）
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.run(300);
    for (int round = 0; round < 6; round++) {
      for (int t = 0; t < 3; t++) g.rf.pos[t] = t;
      g.run(1200);
      for (int t = 0; t < 3; t++) g.rf.pos[t] = -1;
      g.run(1200);
    }
    std::vector<ArrayTracker::EventNote> notes;
    int c = drainNotes(g.tr, notes);
    check("原因: たまった記録は、8件まで（古いほうを捨てる）", c <= 8 && c > 0);
    check("原因: 内部の記録に矛盾がない", g.consistentOk);
  }
}


// ------------------------------------------------------------
// 動かしていない駒が、ときどき、続けて読めなくなる（2026-11-15 の実機: リーダー3 で 95〜370 ms。1〜2分に1回ほど）
//   → 「外れた」と決める前に、猶予（MISS_MIN_MS）をおく。猶予のあいだにまた読めたら、何も知らせない（ちらつきを吸収する）
// ------------------------------------------------------------
static void testDropoutAbsorbed() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);
  g.run(500);
  g.rf.pos[0] = 2;
  g.run(2500);
  check("ちらつき: 前提 — 駒が持ち主になっている", g.matchesTruth());
  size_t m = g.mark();
  uint32_t lens[] = {150, 250, 330, 370, 380};     // 2026-11-18: 猶予が 400 ms になったので、実機のいちばん長い途切れ（370 ms）までを、吸収できればよい
  for (int i = 0; i < 5; i++) {       // どの感度でも読めない時間（実機の、短い途切れ）
    g.rf.blackoutUntil[2] = g.rf.now + lens[i];
    g.run(lens[i] + 1500);
  }
  check("ちらつき: 読めない時間が 150〜380 ms なら、外れたとも置かれたとも知らせない", g.total(m) == 0);
  if (g.total(m) != 0) why(g, m, "ちらつき");
  ArrayTracker::ReaderStats s = g.tr.stats(2);
  if (verbose) printf("  [ちらつき統計] hits=%u misses=%u absorbed=%u longest=%u removed=%u rescueTries=%u rescued=%u\n", (unsigned)s.hits, (unsigned)s.misses, (unsigned)s.absorbed, (unsigned)s.longestMs, (unsigned)s.removedByMiss, (unsigned)s.rescueTries, (unsigned)s.rescued);
  check("ちらつき: 統計 — 5回吸収した・最長 300 ms 以上（途切れの途中から数え始めるので、380 ms の途切れで 300 ms ほど）・外れの知らせは 0", s.absorbed >= 5 && s.longestMs >= 250 && s.removedByMiss == 0);
  check("ちらつき: 駒は、ずっと同じリーダーの持ち主", g.matchesTruth());
  // 猶予をこえて読めなければ、外れたと知らせる。戻ったら、置かれたと知らせる
  m = g.mark();
  g.rf.blackoutUntil[2] = g.rf.now + 1000;
  g.run(2200);
  check("ちらつき: 1000 ms 読めなければ、外れた（1回）→ また読めたので、置かれた（1回）", g.count(m, READER_EVENT_REMOVED, 2, 0) == 1 && g.count(m, READER_EVENT_PLACED, 2, 0) == 1 && g.total(m) == 2);
  check("ちらつき: 統計 — 外れの知らせが 1回になった", g.tr.stats(2).removedByMiss == 1);
  check("ちらつき: どの呼び出しも RF の読み取りは1回以内・記録に矛盾がない", g.opsOk && g.consistentOk);
}

// 標準の感度では、半分ほどしか読めない駒（電波が弱い）。感度を上げれば確実に読める → 高い感度で読み直して、救う
static void testMarginalRescued() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);
  g.run(500);
  g.rf.pos[0] = 2;
  g.run(2500);
  for (int L = 0; L < FakeRf::LEVELS; L++) g.rf.prob[2][2][L] = (L >= 4) ? 1.0 : (L == 2 || L == 3 ? 0.35 : 0.0);   // 標準(2)は 35% しか読めない。段4以上は確実
  size_t m = g.mark();
  g.run(60000);
  check("救済: 標準の感度で 35% しか読めない駒でも、60秒間、外れたとも置かれたとも知らせない", g.total(m) == 0);
  if (g.total(m) != 0) why(g, m, "救済");
  ArrayTracker::ReaderStats s = g.tr.stats(2);
  printf("  [測定] 35%%しか読めない駒を60秒: 読めた %u・読めなかった %u・高感度で救った %u/%u・吸収 %u（最長 %u ms）\n", (unsigned)s.hits, (unsigned)s.misses, (unsigned)s.rescued, (unsigned)s.rescueTries, (unsigned)s.absorbed, (unsigned)s.longestMs);
  check("救済: 高い感度で救った回数が、数えられている", s.rescued > 0 && g.tr.rescuedCount() == s.rescued);
  m = g.mark();
  g.rf.pos[0] = -1;
  g.run(3000);
  check("救済: 駒を外すと、救済しても読めないので、REMOVED が1回", g.count(m, READER_EVENT_REMOVED, 2, 0) == 1 && g.total(m) == 1);
  check("救済: 盤面が本当と同じ・矛盾なし", g.matchesTruth() && g.consistentOk && g.opsOk);
}

// 高い感度で、隣の駒が読めても、持ち主の駒の救済にはならない（UID が違う）
static void testRescueIgnoresNeighbor() {
  Rig g(8);
  g.rf.rowCoupling(1, 3, 0.0);       // 隣は、段3から確実に読める
  g.run(500);
  g.rf.pos[0] = 2;                    // 駒 A
  g.rf.pos[1] = 3;                    // 駒 B（リーダー3 は、高い感度なら B も読む）
  g.settle(5000);
  check("救済と隣: 前提 — 2枚とも、自分のリーダーが持ち主", g.matchesTruth());
  size_t m = g.mark();
  g.rf.pos[0] = -1;                   // A を外す
  g.run(3000);
  check("救済と隣: A を外すと、リーダー3 に REMOVED が1回（高い感度で B が読めても、A は救われない）", g.count(m, READER_EVENT_REMOVED, 2, 0) == 1 && g.total(m) == 1);
  check("救済と隣: B は、そのまま、リーダー4 の持ち主", g.matchesTruth());
}

// 載っているはずの駒の UID を、リーダーに教える（本物のリーダーは、衝突回避をやめて、直接呼びかけられる）
static void testHintOwnerUid() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);
  g.run(300);
  g.rf.pos[0] = 3;
  g.run(3000);
  g.rf.lastHintSet[3] = false;
  g.rf.lastHintSet[5] = true;
  g.run(500);
  check("直接呼びかけ: 駒が載っているリーダーには、その駒の UID を教える", g.rf.lastHintSet[3] && sameUid(g.rf.lastHint[3], g.rf.uids[0]));
  check("直接呼びかけ: 空のリーダーには、教えない（ふつうの読み方）", !g.rf.lastHintSet[5]);
  check("直接呼びかけ: ふつうに動いている（外れたと知らせない）", g.matchesTruth() && g.consistentOk);
}

// 隣の駒と衝突して、衝突回避が9割失敗するリーダー（実機のリーダー6・リーダー3）に、駒を置く → 候補の UID を呼びかけて、すぐ見つける
static void testPlacementUnderCollisions() {
  uint32_t worst = 0, total = 0;
  int trials = 0, notFound = 0;
  for (int pass = 0; pass < 2; pass++) {
    Rig g(8);
    g.rf.rowCoupling(1, 99, 0.0);
    g.rf.antiFail[2] = 0.9;
    g.rf.antiFail[5] = 0.9;
    if (pass == 0) g.rf.registerAll();                       // 登録済みの駒の一覧がある（本物は tag_store）
    g.run(500);
    // 隣にも駒がある状態（衝突しやすい）
    g.rf.pos[5] = 1; g.rf.pos[6] = 4; g.rf.pos[7] = 6;
    g.run(3000);
    for (int rd : {2, 5}) {
      for (int k = 0; k < 6; k++) {
        size_t m = g.mark();
        uint32_t t0 = g.rf.now;
        g.rf.pos[0] = rd;                                    // 駒 A を、リーダー rd に置く
        g.run(4000);
        bool placed = g.count(m, READER_EVENT_PLACED, rd, 0) == 1;
        uint32_t lat = 0;
        for (size_t i = m; i < g.log.size(); i++) if (g.log[i].e.type == READER_EVENT_PLACED && g.log[i].e.reader == rd) lat = g.log[i].t - t0;
        if (pass == 0) { trials++; if (!placed) notFound++; else { total += lat; if (lat > worst) worst = lat; } }
        g.rf.pos[0] = -1;                                    // 外す
        g.run(2500);
      }
    }
    if (pass == 0) {
      check("衝突に強い置き方: 90%衝突するリーダーでも、置いた駒が、毎回、見つかる", notFound == 0);
      printf("  [測定] 90%%衝突するリーダーに置く（登録済みの一覧あり）: 平均 %u ms・最大 %u ms（%d 回。偽の時計）\n", (unsigned)(trials > notFound ? total / (trials - notFound) : 0), (unsigned)worst, trials);
      check("衝突に強い置き方: 最大でも 2秒以内", worst < 2000);
      check("衝突に強い置き方: 候補を呼びかけて、見つかった回数が数えられる", g.tr.stats(2).guessHits > 0 && g.tr.stats(5).guessHits > 0);
      check("衝突に強い置き方: 内部の記録に矛盾がない・RF は1回以内", g.consistentOk && g.opsOk);
    }
  }
}

// 統計: 持ち主の駒の読めた・読めなかった回数が数えられる
static void testReaderStats() {
  Rig g(8);
  g.rf.rowCoupling(1, 99, 0.0);
  g.run(300);
  g.rf.pos[0] = 1;
  g.run(5000);
  ArrayTracker::ReaderStats s = g.tr.stats(1);
  check("統計: 駒が載っているリーダーは、読めた回数が増える・読めなかった回数は 0", s.hits > 20 && s.misses == 0 && s.removedByMiss == 0);
  ArrayTracker::ReaderStats e = g.tr.stats(5);
  check("統計: 駒のないリーダーは、数えない", e.hits == 0 && e.misses == 0);
  g.rf.garbleNext[1] = 4;
  g.run(1500);
  check("統計: 乱れた読み取りの回数が数えられる（4回）", g.tr.stats(1).garbled == 4);
  g.rf.pos[0] = -1;
  g.run(3000);
  check("統計: 外すと、外れの知らせが1回", g.tr.stats(1).removedByMiss == 1);
  g.tr.resetStats();
  check("統計: 数え直すと 0", g.tr.stats(1).hits == 0 && g.tr.stats(1).removedByMiss == 0);
}

int main() {
  verbose = getenv("TRACKER_VERBOSE") != nullptr;
  testPlainPlaceRemove();
  testShadow(4, "リーダー5");
  testShadow(5, "リーダー6");
  testShadow(6, "リーダー7");
  testShadow(0, "リーダー1（端）");
  testShadow(7, "リーダー8（端）");
  testSteadyShadow();
  testNeighborsBoth();
  testMoves();
  testTie();
  testFineTieBreak();
  testBoot();
  testDeadReader();
  testOwnerFlicker();
  testGarbledReads();
  testGapForgetsMisses();
  testDropoutAbsorbed();
  testMarginalRescued();
  testRescueIgnoresNeighbor();
  testReaderStats();
  testHintOwnerUid();
  testPlacementUnderCollisions();
  testEventNotes();
  for (uint32_t seed = 1; seed <= 12; seed++) testFuzz(seed, 60, false);
  for (uint32_t seed = 101; seed <= 106; seed++) testFuzz(seed, 60, true);
  printf("  [測定] ランダム（同点なし）%d 通り・動かした %d 回: 2.5秒後に正しかった %.1f%%、一時的にでも違うリーダーに「置かれた」と知らせた %.2f%%\n",
         fuzzSeeds, fuzzMoves, fuzzMoves ? 100.0 * fuzzQuick / fuzzMoves : 0.0, fuzzMoves ? 100.0 * fuzzGlitches / fuzzMoves : 0.0);
  printf("test_array_tracker: checks=%d fails=%d\n", checks, fails);
  return fails ? 1 : 0;
}
