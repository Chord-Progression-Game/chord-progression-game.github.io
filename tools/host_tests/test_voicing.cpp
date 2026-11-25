// voicing.cpp のパソコン上テスト。ユーザーが挙げた例と、ふつうのコード進行での動きを確かめる。
//   実行: tools/host_tests/run_all.sh
#include "voicing.h"

#include <stdio.h>
#include <string.h>

#include <initializer_list>
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


  // ============================================================
  // ① 計画（planBoardShifts。2026-11-24。ご指定）: ループ全体を見て、高さを決める
  // ============================================================
  {
    auto idOf = [](const char* name) -> int {
      for (int k = 0; k < chordCount(); k++) if (std::string(chordAt(k).name) == name) return chordAt(k).id;
      return -1;
    };
    const uint8_t R = CHORD_ID_REPEAT;
    auto shiftsOf = [&](std::initializer_list<int> ids, int8_t* out, int baseC = 48, bool enabled = true) {
      uint8_t raw[8] = {0}; int n = 0;
      for (int id : ids) raw[n++] = (uint8_t)id;
      planBoardShifts(raw, 8, KEY_C, baseC, enabled, out);
    };
    int8_t sh[8];
    auto rootAt = [&](int step, int id, int baseC = 48) { return baseC + chordRootPitchClass(*chordById(id), KEY_C) + sh[step]; };

    // ご指定の例（コンファーメーション）: ⅠM7 → Ⅶm7♭5 → Ⅲ7（完全4度上）→ Ⅵm7（完全4度上）→ Ⅴm7 → Ⅰ7（完全5度下で、ループ後の ⅠM7 と同じ高さ）
    int imaj7 = idOf("ⅠM7"), vii = idOf("Ⅶm7-5"), iii7 = idOf("Ⅲ7"), vim7 = idOf("Ⅵm7"), vm7 = idOf("Ⅴm7"), i7 = idOf("Ⅰ7");
    shiftsOf({imaj7, R, vii, iii7, vim7, R, vm7, i7}, sh);
    int r0 = rootAt(0, imaj7), r2 = rootAt(2, vii), r3 = rootAt(3, iii7), r4 = rootAt(4, vim7), r6 = rootAt(6, vm7), r7 = rootAt(7, i7);
    eqi("コンファーメーション: ⅠM7 = C3(48)", r0, 48);
    eqi("コンファーメーション: Ⅶm7♭5 = B2(47)（半音下）", r2, 47);
    eqi("コンファーメーション: Ⅲ7 = E3(52)（Ⅶm7♭5 から完全4度上）", r3, 52);
    eqi("コンファーメーション: Ⅵm7 = A3(57)（Ⅲ7 から完全4度上）", r4, 57);
    eqi("コンファーメーション: Ⅴm7 = G3(55)", r6, 55);
    eqi("コンファーメーション: Ⅰ7 = C3(48)（Ⅴm7 から完全5度下。ループ後の ⅠM7 と同じ高さ）", r7, 48);
    eqi("コンファーメーション: Ⅰ7 の高さ = 最初の ⅠM7 の高さ", r7, r0);
    eqi("コンファーメーション: 「→」は、前の駒と同じ高さ", sh[1] == sh[0] && sh[5] == sh[4], 1);

    // セカンダリードミナントは、完全4度上を優先（2026-11-25。ご指定）。高くなりすぎるとき・Ⅰ系に解決するときは、完全5度下
    {
      int ivm7 = idOf("ⅣM7"), ii7 = idOf("Ⅱ7"), iim7 = idOf("Ⅱm7"), v7 = idOf("Ⅴ7"), vi7 = idOf("Ⅵ7"), iiim7 = idOf("Ⅲm7");
      shiftsOf({ivm7, iii7, vim7, i7}, sh);
      eqi("丸サ進行: ⅣM7 = F3(53)", rootAt(0, ivm7), 53);
      eqi("丸サ進行: Ⅲ7 = E3(52)", rootAt(1, iii7), 52);
      eqi("丸サ進行: Ⅵm7 = A3(57)（Ⅲ7 から完全4度上。セカンダリードミナントは、4度上を優先）", rootAt(2, vim7), 57);
      eqi("丸サ進行: Ⅰ7 = C3(48)", rootAt(3, i7), 48);
      int iimaj7 = imaj7;
      shiftsOf({iim7, v7, iimaj7}, sh);
      eqi("ツーファイブワン: Ⅱm7 = D3(50)・Ⅴ7 = G3(55)（完全4度上）・ⅠM7 = C3(48)（Ⅰ系への解決は、完全5度下）", rootAt(0, iim7) == 50 && rootAt(1, v7) == 55 && rootAt(2, iimaj7) == 48, 1);
      shiftsOf({imaj7, ii7, v7, imaj7}, sh);
      eqi("Ⅱ7 → Ⅴ7（Ⅱ7 はドミナント）: D3(50) → G3(55)（完全4度上）", rootAt(1, ii7) == 50 && rootAt(2, v7) == 55, 1);
      shiftsOf({iii7, vi7, ii7, v7, imaj7}, sh);
      eqi("ラグタイム: Ⅲ7 = E3(52)・Ⅵ7 = A3(57)・Ⅱ7 = D3(50)（D4 は高すぎるので、完全5度下）・Ⅴ7 = G3(55)・ⅠM7 = C3(48)",
          rootAt(0, iii7) == 52 && rootAt(1, vi7) == 57 && rootAt(2, ii7) == 50 && rootAt(3, v7) == 55 && rootAt(4, imaj7) == 48, 1);
      shiftsOf({iiim7, vim7, iim7, v7}, sh);
      eqi("ドミナントではない強進行（Ⅲm7 → Ⅵm7）は、これまでどおり、完全5度下: E3(52) → A2(45)", rootAt(0, iiim7) == 52 && rootAt(1, vim7) == 45, 1);
    }
    int i1 = idOf("Ⅰ"), iv = idOf("Ⅳ"), v = idOf("Ⅴ"), vim = idOf("Ⅵm");
    // Ⅰ Ⅳ Ⅴ（ループ）: Ⅴ → Ⅰ（つなぎ目）は終止なので、5度下（Ⅴ = G3 = 55）。Ⅳ = F3
    shiftsOf({i1, R, iv, v}, sh);
    eqi("Ⅰ → Ⅳ Ⅴ: Ⅳ = F3(53)（強進行は、4度上）", rootAt(2, iv), 53);
    eqi("Ⅰ → Ⅳ Ⅴ: Ⅴ = G3(55)（つなぎ目の Ⅴ → Ⅰ は、5度下で終止）", rootAt(3, v), 55);
    // 同じ和音の連続は「→」と同じ
    int8_t a[8], b[8];
    shiftsOf({i1, i1, iv, v}, a); shiftsOf({i1, R, iv, v}, b);
    eqi("同じ和音の連続（Ⅰ Ⅰ Ⅳ Ⅴ）は、「→」（Ⅰ → Ⅳ Ⅴ）と同じ高さ", memcmp(a, b, 8), 0);
    // Ⅰ Ⅵm Ⅳ Ⅴ × 2
    shiftsOf({i1, vim, iv, v, i1, vim, iv, v}, sh);
    eqi("Ⅰ Ⅵm Ⅳ Ⅴ × 2: 1周目 = C3 A2 F3 G3", rootAt(0, i1) == 48 && rootAt(1, vim) == 45 && rootAt(2, iv) == 53 && rootAt(3, v) == 55, 1);
    eqi("Ⅰ Ⅵm Ⅳ Ⅴ × 2: 2周目も、1周目と同じ高さ", sh[4] == sh[0] && sh[5] == sh[1] && sh[6] == sh[2] && sh[7] == sh[3], 1);
    // ボイスリーディング OFF なら、いつも本来の高さ
    shiftsOf({i1, vim, iv, v, i1, vim, iv, v}, sh, 48, false);
    eqi("OFF のときは、全部 0", sh[0] + sh[1] + sh[2] + sh[3] + sh[4] + sh[5] + sh[6] + sh[7], 0);
    // 駒が1つだけ・休みだけ
    shiftsOf({0, 0, 0, i1, 0, 0, 0, 0}, sh);
    eqi("駒が1つだけなら、本来の高さ", sh[3], 0);
    shiftsOf({0, 0, 0, 0, 0, 0, 0, 0}, sh);
    eqi("全部休みなら、全部 0", sh[0] + sh[3] + sh[7], 0);

    // 無作為な盤（いまの駒の表から。「→」・空きも）。決まりが、いつも守られているか
    unsigned x = 24680;
    auto rnd = [&]() { x = x * 1664525u + 1013904223u; return x >> 8; };
    int strongTotal = 0, strongOk = 0, outOfBand = 0, rootsTotal = 0, firstTotal = 0, firstOk = 0, shiftOk = 0;
    for (int n = 0; n < 4000; n++) {
      uint8_t raw[8];
      for (int k = 0; k < 8; k++) {
        unsigned q = rnd() % 100;
        if (q < 8) raw[k] = 0;
        else if (q < 28) raw[k] = R;
        else { const Chord& c = chordAt((int)(rnd() % (unsigned)chordCount())); raw[k] = chordIsRepeat(c) ? 0 : c.id; }
      }
      int8_t pl[8];
      planBoardShifts(raw, 8, KEY_C, 48, true, pl);
      int prevRoot = -1, prevId = -1; bool any = false;
      for (int k = 0; k < 8; k++) {
        uint8_t id = raw[k];
        if (id == R) {                                         // 前へたどる（grooveResolveChordId と同じ）
          id = 0;
          for (int j = 1; j < 8; j++) { int p = ((k - j) % 8 + 8) % 8; if (raw[p] != R) { id = raw[p]; break; } }
        }
        if (id == 0) continue;
        int root = 48 + chordRootPitchClass(*chordById(id), KEY_C) + pl[k];
        shiftOk += (pl[k] == -12 || pl[k] == 0 || pl[k] == 12);
        rootsTotal++;
        if (root < 48 - 7 || root > 48 + 11) outOfBand++;
        if (!any) { any = true; firstTotal++; firstOk += (pl[k] == 0); }
        else if (prevId != id) {                                // 同じ和音の続きは、数えない
          int pcd = ((chordRootPitchClass(*chordById(id), KEY_C) - chordRootPitchClass(*chordById(prevId), KEY_C)) % 12 + 12) % 12;
          if (pcd == 5) { strongTotal++; int d = root - prevRoot; strongOk += (d == 5 || d == -7); }
        }
        prevRoot = root; prevId = id;
      }
    }
    eqi("無作為な盤 4000 通り: 最初のコードは、いつも本来の高さ", firstOk, firstTotal);
    eqi("無作為な盤: ずれは、-12 / 0 / +12 のどれか（全部）", shiftOk, rootsTotal);
    eqi("無作為な盤: 強進行のつながり（ループのつなぎ目をのぞく）は、いつも、完全4度上か完全5度下（全部）", strongOk, strongTotal);
    eqi("無作為な盤: 強進行の数が、十分ある", strongTotal > 1000, 1);
    eqi("無作為な盤: 音域の帯（baseC-7 〜 baseC+11）の外に出る和音は、1割より少ない", outOfBand * 10 < rootsTotal, 1);
  }

  printf("test_voicing: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
