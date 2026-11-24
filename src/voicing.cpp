#include "voicing.h"

static int absInt(int v) { return v < 0 ? -v : v; }
static int mod12(int v) { return ((v % 12) + 12) % 12; }

// ------------------------------------------------------------
// ② 1つ前だけを見る簡易版
// ------------------------------------------------------------
int chooseOctaveShift(int nominalRoot, int previousRoot, bool enabled) {
  if (!enabled || previousRoot < 0) return 0;

  // 候補。先に並べたものが、同じ近さのときに選ばれる（本来の高さが最優先）
  static const int CANDIDATES[3] = {0, -12, +12};

  int best = CANDIDATES[0];
  int bestDistance = absInt(nominalRoot + best - previousRoot);
  for (int i = 1; i < 3; i++) {
    int distance = absInt(nominalRoot + CANDIDATES[i] - previousRoot);
    if (distance < bestDistance) {
      best = CANDIDATES[i];
      bestDistance = distance;
    }
  }
  return best;
}

// ------------------------------------------------------------
// ① 計画（ループ全体を見て、全部のコードの高さを決める。game/js/core/voicing.js の planOctaves と同じ計算）
// ------------------------------------------------------------

static const int PLAN_INF = 1000000000;
static const int PLAN_SHIFT[3] = {0, -12, +12};  // 先に並べたものが、同じ費用のときに選ばれる（本来の高さが先）

// a → b のつながりの種類。0 = ふつう / 1 = 終止（強進行で、フレーズの終わり・つなぎ目の、主和音 Ⅰ へ）/ 2 = 解決（途中の主和音・Ⅵm 系へ）
static int planKind(const VoicePlanNode& a, const VoicePlanNode& b, bool seam) {
  if (mod12(b.pc - a.pc) != 5 || b.goal == 0) return 0;
  return (b.goal == 2 && (seam || b.final)) ? 1 : 2;
}

static int planTransition(const VoicePlanNode& a, const VoicePlanNode& b, int ha, int hb, int kind) {
  int d = hb - ha;
  if (mod12(b.pc - a.pc) == 5) {  // 強進行: 完全4度上（+5）か、完全5度下（-7）
    if (d == 5) return 5 + (kind == 1 ? VOICE_PLAN_CAD1 : (kind == 2 ? VOICE_PLAN_CAD2 : 0));
    if (d == -7) return 7;
    return VOICE_PLAN_BIG + absInt(d);
  }
  return absInt(d);  // ほかは、近いほどよい
}

void planOctaves(const VoicePlanNode* nodes, int n, int baseC, int8_t* shifts) {
  for (int i = 0; i < n; i++) shifts[i] = 0;
  if (n < 2 || n > VOICE_PLAN_MAX_NODES) return;

  const int lo = baseC - VOICE_PLAN_LOW, hi = baseC + VOICE_PLAN_HIGH;
  int cost[VOICE_PLAN_MAX_NODES][3];
  int back[VOICE_PLAN_MAX_NODES][3];
  for (int i = 0; i < n; i++) {
    for (int k = 0; k < 3; k++) { cost[i][k] = PLAN_INF; back[i][k] = -1; }
  }
  auto reg = [&](int h) { return VOICE_PLAN_PEN * (h < lo ? lo - h : (h > hi ? h - hi : 0)); };

  cost[0][0] = reg(baseC + nodes[0].pc);  // 最初のノードは、本来の高さに固定
  for (int i = 1; i < n; i++) {
    int kind = planKind(nodes[i - 1], nodes[i], false);
    for (int k = 0; k < 3; k++) {
      int h = baseC + nodes[i].pc + PLAN_SHIFT[k];
      int own = reg(h) + (k == 0 ? 0 : VOICE_PLAN_OCT);
      for (int j = 0; j < 3; j++) {
        if (cost[i - 1][j] >= PLAN_INF) continue;
        int c = cost[i - 1][j] + planTransition(nodes[i - 1], nodes[i], baseC + nodes[i - 1].pc + PLAN_SHIFT[j], h, kind) + own;
        if (c < cost[i][k]) { cost[i][k] = c; back[i][k] = j; }
      }
    }
  }
  int seam = planKind(nodes[n - 1], nodes[0], true);  // ループのつなぎ目: 最後 → 最初（最初は、本来の高さ）
  int bestK = 0, bestC = PLAN_INF;
  for (int k = 0; k < 3; k++) {
    if (cost[n - 1][k] >= PLAN_INF) continue;
    int c = cost[n - 1][k] + planTransition(nodes[n - 1], nodes[0], baseC + nodes[n - 1].pc + PLAN_SHIFT[k], baseC + nodes[0].pc, seam);
    if (c < bestC) { bestC = c; bestK = k; }
  }
  int k = bestK;
  for (int i = n - 1; i >= 1; i--) {
    shifts[i] = (int8_t)PLAN_SHIFT[k];
    k = back[i][k];
  }
}

// ディグリー（Ⅰ〜Ⅶ）の、主音からの半音の数。degree が 0（絶対音名のコード）のときは -1
static int degreeOffset(const Chord& c) {
  static const uint8_t MAJOR_SCALE[7] = {0, 2, 4, 5, 7, 9, 11};
  if (c.degree < 1 || c.degree > 7) return -1;
  return mod12(MAJOR_SCALE[c.degree - 1] + c.accidental);
}

// 着地先の強さ: 2 = 主和音（Ⅰ。どの種類でも）/ 1 = Ⅵm 系（Ⅵm・Ⅵm7・Ⅵ）/ 0 = 着地先ではない
static int8_t goalLevel(const Chord& c) {
  int off = degreeOffset(c);
  if (off == 0) return 2;
  return (off == 9 && (c.type == CT_MINOR || c.type == CT_MIN7 || c.type == CT_MAJOR)) ? 1 : 0;
}

// step 番目の位置で鳴らすコード（なければ nullptr）。grooveResolveChordId と同じ規則
static const Chord* planChordAt(const uint8_t* rawIds, int numSteps, int step) {
  uint8_t raw = rawIds[step];
  if (raw == CHORD_ID_REPEAT) {
    raw = 0;
    for (int j = 1; j < numSteps; j++) {
      int p = ((step - j) % numSteps + numSteps) % numSteps;
      if (rawIds[p] != CHORD_ID_REPEAT) { raw = rawIds[p]; break; }  // 前のコマが空・未登録(0)なら、休みを繰り返す
    }
  }
  if (raw == 0) return nullptr;
  const Chord* c = chordById(raw);
  if (c != nullptr && chordIsRepeat(*c)) return nullptr;
  return c;
}

void planBoardShifts(const uint8_t* rawIds, int numSteps, const Key& key, int baseC, bool enabled, int8_t* shiftByStep) {
  for (int k = 0; k < numSteps; k++) shiftByStep[k] = 0;
  if (!enabled || numSteps < 1) return;

  // 鳴る順の、コードの並び。t0・t1: 半ステップ単位の時刻（1つのマス = 2つ）。同じコードがすぐ続くものは、1つのノードにまとめる
  struct Node { const Chord* chord; int t0; int t1; };
  Node nodes[VOICE_PLAN_MAX_NODES];
  int stepNode[VOICE_PLAN_MAX_NODES];
  int count = 0;
  for (int k = 0; k < numSteps && k < VOICE_PLAN_MAX_NODES; k++) {
    stepNode[k] = -1;
    const Chord* c = planChordAt(rawIds, numSteps, k);
    if (c == nullptr) continue;
    if (count > 0 && nodes[count - 1].chord == c && nodes[count - 1].t1 + 1 == 2 * k) {
      nodes[count - 1].t1 = 2 * k + 1;
    } else {
      nodes[count].chord = c; nodes[count].t0 = 2 * k; nodes[count].t1 = 2 * k + 1;
      count++;
    }
    stepNode[k] = count - 1;
  }
  if (count < 2) return;

  // フレーズの終わりか（sense.js の endsPhrase・game/js/core/voicing.js と同じ決まり）
  auto adjacent = [&](int i) { return i + 1 < count && nodes[i + 1].t0 == nodes[i].t1 + 1; };
  auto atEnd = [&](int i) { return !adjacent(i) || ((nodes[i].t1 % 2) == 1 && ((nodes[i].t1 / 2) % 4) == 3); };
  auto rootOf = [&](int i) { return chordRootPitchClass(*nodes[i].chord, key); };
  auto endsPhrase = [&](int i) {
    if (atEnd(i)) return true;
    int root = rootOf(i), bar = nodes[i].t1 / 8;
    for (int k = i + 1; k < count && adjacent(k - 1); k++) {
      if (rootOf(k) != root || nodes[k].t0 / 8 != bar) return false;
      if (atEnd(k)) return true;
    }
    return false;
  };

  VoicePlanNode plan[VOICE_PLAN_MAX_NODES];
  int8_t shifts[VOICE_PLAN_MAX_NODES];
  for (int i = 0; i < count; i++) {
    plan[i].pc = (int8_t)rootOf(i);
    plan[i].goal = goalLevel(*nodes[i].chord);
    plan[i].final = endsPhrase(i);
  }
  planOctaves(plan, count, baseC, shifts);
  for (int k = 0; k < numSteps && k < VOICE_PLAN_MAX_NODES; k++) {
    if (stepNode[k] >= 0) shiftByStep[k] = shifts[stepNode[k]];
  }
}
