// voicing.cpp のパソコン上テスト。ユーザーが挙げた例と、ふつうのコード進行での動きを確かめる。
//   実行: tools/host_tests/run_all.sh
#include "voicing.h"

#include <stdio.h>

#include <string>

#include "chords.h"

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}

// Key=C の、本来のルート（ピアノ用 C3=48 から）
static int nominal(int id, const Key& key = KEY_C) { return 48 + chordRootPitchClass(*chordById(id), key); }

int main() {
  // ---- ユーザーが挙げた例 ----
  // ⅥからⅠを鳴らすとき、6度下ではなく、短3度上に動く
  int vi = nominal(2);            // Ⅵm = A3 = 57
  int i = nominal(1);             // Ⅰ  = C3 = 48
  eqi("Ⅵ=A3(57)", vi, 57); eqi("Ⅰ=C3(48)", i, 48);
  int s = chooseOctaveShift(i, vi, true);
  eqi("Ⅵ→Ⅰ は +12（C4=60 へ。短3度上）", s, 12);
  eqi("そのときのルート", i + s, 60);
  eqi("動き: 短3度上（+3半音）", (i + s) - vi, 3);

  // 前のコード(Ⅵ)がすでに1オクターブ高くなって A4(69) のとき、Ⅰ を短3度上(C5=72)にすると
  // 本来のⅠの2オクターブ上になるので、6度下(C4=60)に動く
  int viHigh = vi + 12;           // A4 = 69
  s = chooseOctaveShift(i, viHigh, true);
  eqi("Ⅵ(A4)→Ⅰ は +12（C4=60 へ。6度下）", s, 12);
  eqi("そのときのルート", i + s, 60);
  eqi("動き: 6度下（-9半音）", (i + s) - viHigh, -9);
  eqi("本来のⅠから2オクターブ上(72)にはならない", (i + s) < i + 24, 1);

  // ---- ふつうの動き ----
  eqi("Ⅰ→Ⅶ: 上に11半音ではなく、下に1半音（B2=47）", chooseOctaveShift(nominal(15), 48, true), -12);   // Ⅶm7-5 の B
  eqi("Ⅰ→Ⅳ: 上に5半音（F3=53）のまま", chooseOctaveShift(nominal(3), 48, true), 0);
  eqi("Ⅰ→Ⅴ: 上に7半音ではなく、下に5半音（G2=43）", chooseOctaveShift(nominal(4), 48, true), -12);
  eqi("Ⅳ(F3=53)→Ⅰ: 下に5半音（C3=48）のまま", chooseOctaveShift(nominal(1), 53, true), 0);
  eqi("Ⅴ(G3=55)→Ⅰ: 上に5半音（C4=60）へ", chooseOctaveShift(nominal(1), 55, true), 12);
  eqi("同じコード（Ⅰ→Ⅰ）は動かない", chooseOctaveShift(48, 48, true), 0);
  eqi("同じコードがすでに上にあれば、そのまま（C4→C）", chooseOctaveShift(48, 60, true), 12);
  eqi("下にあれば、そのまま（C2→C）", chooseOctaveShift(48, 36, true), -12);

  // ---- 同じ近さ（トライトーン）のとき、本来の高さを選ぶ ----
  eqi("同じ近さ: F#3(54) と F#4(66) は C4(60) から6半音ずつ → 本来の高さ", chooseOctaveShift(54, 60, true), 0);
  eqi("同じ近さ: 下側も本来の高さを選ぶ（F#3 と F#2(42) は C3(48) から6半音）", chooseOctaveShift(54, 48, true), 0);

  // ---- 最初のコード・OFF ----
  eqi("最初のコード（前がない）は本来の高さ", chooseOctaveShift(59, -1, true), 0);
  eqi("OFF のときは、いつも本来の高さ", chooseOctaveShift(48, 69, false), 0);
  eqi("OFF のとき（前がない）", chooseOctaveShift(59, -1, false), 0);

  // ---- 性質（総当たり）: どんな前のコードでも、結果は本来の高さから ±12 以内、前のコードから 12 以内 ----
  for (int nom = 48; nom <= 59; nom++) {
    for (int prev = 24; prev <= 84; prev++) {
      int sh = chooseOctaveShift(nom, prev, true);
      int d = (nom + sh) - prev;
      if (d < 0) d = -d;
      eqi("シフトは -12/0/+12 のどれか", sh == -12 || sh == 0 || sh == 12, 1);
      // 3つの候補のうち、本当に一番近いか
      int best = 999;
      for (int c = -12; c <= 12; c += 12) { int dd = nom + c - prev; if (dd < 0) dd = -dd; if (dd < best) best = dd; }
      eqi("一番近い候補を選んでいる", d, best);
      // 前のコードが本来の範囲（nom-12 〜 nom+12）にあるなら、動きは最大6半音。
      // 範囲の外にあっても、12半音以内に収まる
      if (prev >= nom - 12 && prev <= nom + 12) eqi("範囲内なら、動きは最大12半音以内", d <= 12, 1);
    }
  }

  // ---- 長いコード進行で、高さが上がり続けたり下がり続けたりしない ----
  // 4度ずつ上がる・下がる、3度ずつ上がるなど、わざと偏った進行
  struct Prog { const char* name; int ids[8]; int n; };
  const Prog progs[] = {
    {"Ⅰ Ⅳ Ⅶ Ⅲ Ⅵ Ⅱ Ⅴ（4度上がり）", {1, 3, 15, 13, 2, 6, 4, 0}, 7},
    {"Ⅰ Ⅲ Ⅴ Ⅶ Ⅱ Ⅳ Ⅵ（3度上がり）", {1, 7, 4, 15, 6, 8, 2, 0}, 7},
    {"Ⅰ Ⅵ Ⅳ Ⅴ（王道）",             {1, 2, 3, 4, 0, 0, 0, 0}, 4},
  };
  for (const Prog& p : progs) {
    int prev = -1, lo = 999, hi = 0;
    for (int loop = 0; loop < 200; loop++) {          // 何周しても、範囲は同じ
      for (int k = 0; k < p.n; k++) {
        int nom = nominal(p.ids[k]);
        int sh = chooseOctaveShift(nom, prev, true);
        int root = nom + sh;
        eqi(std::string(p.name) + " 本来の±1オクターブ以内", root >= nom - 12 && root <= nom + 12, 1);
        if (root < lo) lo = root; if (root > hi) hi = root;
        prev = root;
      }
    }
    eqi(std::string(p.name) + " ルートの最低音は C2(36) 以上", lo >= 36, 1);
    eqi(std::string(p.name) + " ルートの最高音は B4(71) 以下", hi <= 71, 1);
  }

  // ---- 王道進行 Ⅰ Ⅵ Ⅳ Ⅴ の、実際の動き ----
  {
    int prev = -1; int roots[8];
    int ids[4] = {1, 2, 3, 4};
    for (int loop = 0; loop < 2; loop++) {
      for (int k = 0; k < 4; k++) {
        int nom = nominal(ids[k]); int sh = chooseOctaveShift(nom, prev, true);
        roots[loop * 4 + k] = nom + sh; prev = nom + sh;
      }
    }
    // 1周目: Ⅰ=C3(48) → Ⅵ(A3=57 から A2=45 を選ぶ? ) を、計算で確認
    // Ⅰ(48)→Ⅵ: 候補 A3=57(9) A2=45(3) A4=69(21) → A2(45)
    eqi("王道 1: Ⅰ=48", roots[0], 48);
    eqi("王道 2: Ⅵ=A2(45)（下に3半音）", roots[1], 45);
    // Ⅵ(45)→Ⅳ: F3=53(8) F2=41(4) F4=65 → F2(41)
    eqi("王道 3: Ⅳ=F2(41)（下に4半音）", roots[2], 41);
    // Ⅳ(41)→Ⅴ: G3=55(14) G2=43(2) → G2(43)
    eqi("王道 4: Ⅴ=G2(43)（上に2半音）", roots[3], 43);
    // Ⅴ(43)→Ⅰ: C3=48(5) C2=36(7) C4=60 → C3(48)
    eqi("王道 5: 2周目のⅠ=C3(48)（上に5半音）", roots[4], 48);
    eqi("王道 6〜8: 2周目も1周目と同じ動き", roots[5] == roots[1] && roots[6] == roots[2] && roots[7] == roots[3], 1);
  }

  printf("test_voicing: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
