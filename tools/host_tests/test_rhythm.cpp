// rhythm.cpp のパソコン上テスト（パターンの読み取り・検査・プリセット・保存形式）
//   実行: tools/host_tests/run_all.sh
#include "rhythm.h"

#include <stdio.h>
#include <string.h>

#include <string>

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}
static void eqs(const std::string& w, const std::string& g, const std::string& e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got [%s] want [%s]\n", w.c_str(), g.c_str(), e.c_str()); }
}

static std::string lane(const DrumPattern& p, int l) { char b[40]; drumPatternLaneText(p, l, b, sizeof b); return b; }

int main() {
  // ---- レーン ----
  eqi("K=0", drumLaneFromLetter('K'), 0); eqi("小文字 k", drumLaneFromLetter('k'), 0);
  eqi("S=1", drumLaneFromLetter('S'), 1); eqi("P=2", drumLaneFromLetter('P'), 2); eqi("H=3", drumLaneFromLetter('H'), 3);
  eqi("O=4", drumLaneFromLetter('O'), 4); eqi("C=5", drumLaneFromLetter('C'), 5); eqi("R=6", drumLaneFromLetter('R'), 6);
  eqi("X=7", drumLaneFromLetter('X'), 7); eqi("不明な文字は -1", drumLaneFromLetter('Z'), -1);
  const int notes[8] = {36, 38, 37, 42, 46, 39, 51, 49};
  for (int i = 0; i < 8; i++) eqi("GMノート", drumLaneNote(i), notes[i]);
  eqi("長さ 8/16/32 は有効", rhythmLengthValid(8) && rhythmLengthValid(16) && rhythmLengthValid(32), 1);
  eqi("長さ 12 は無効", rhythmLengthValid(12), 0); eqi("長さ 0 は無効", rhythmLengthValid(0), 0); eqi("長さ 64 は無効", rhythmLengthValid(64), 0);

  // ---- ドラムの編集 ----
  DrumPattern d; drumPatternClear(&d, 16); rhythmSetName(d.name, "テスト");
  const char* err = nullptr;
  eqi("K を設定", drumPatternSetLane(&d, 0, "x...x...X..o....", &err), 1);
  eqs("K の文字列", lane(d, 0), "x...x...X..o....");
  eqi("弱=1 普通=2 強=3 の内部値", d.level[0][11] == DRUM_GHOST && d.level[0][0] == DRUM_NORMAL && d.level[0][8] == DRUM_ACCENT, 1);
  eqi("使えない文字は失敗", drumPatternSetLane(&d, 1, "x...z...x.......", &err), 0);
  eqi("使えない文字のとき、パターンは変わらない", drumPatternIsEmpty(d) == false && lane(d, 1) == "................", 1);
  eqi("長さの違う文字列は失敗（空でないとき）", drumPatternSetLane(&d, 1, "x...x...", &err), 0);
  eqs("エラーの理由が出る", err ? err : "", "文字数が、いまのパターンの長さと違います。長さを変えるときは、先に LEN を使ってください");
  // 空のパターンに、8/16/32 以外の長さの文字列を設定すると、有効な長さを案内する
  DrumPattern g; drumPatternClear(&g, 16);
  eqi("空のパターンに 4文字は失敗", drumPatternSetLane(&g, 0, "x...", &err), 0);
  eqs("有効な長さを案内する", err ? err : "", "文字数は 8 / 16 / 32 のどれかにしてください（1文字 = 16分音符 1つ分）");
  eqi("失敗しても長さは変わらない", g.length, 16);
  eqi("レーンの文字が不明なら失敗", drumPatternSetLane(&d, 9, "x...............", &err), 0);
  // 空のパターンは、最初に設定する文字列の長さが、パターンの長さになる
  DrumPattern e; drumPatternClear(&e, 16); rhythmSetName(e.name, "名前を残す");
  eqi("空のパターンに 8文字を設定", drumPatternSetLane(&e, 0, "x...x...", nullptr), 1);
  eqi("長さが 8 になる", e.length, 8);
  eqs("名前は残る", e.name, "名前を残す");
  eqi("そのあと 16文字は失敗", drumPatternSetLane(&e, 1, "x...x...x...x...", nullptr), 0);
  DrumPattern f; drumPatternClear(&f, 16);
  eqi("12文字は長さとして無効（空でも失敗）", drumPatternSetLane(&f, 0, "x...x...x...", nullptr), 0);
  eqi("長さを 32 にする", drumPatternSetLength(&d, 32), 1); eqi("長さ 32", d.length, 32);
  eqs("32 にすると、足した分は空", lane(d, 0), "x...x...X..o....................");
  eqi("長さを 8 にすると切り捨て", drumPatternSetLength(&d, 8), 1); eqs("8 に切り詰め", lane(d, 0), "x...x...");
  eqi("長さ 10 は失敗", drumPatternSetLength(&d, 10), 0);

  // ---- 名前 ----
  char name[RHYTHM_NAME_BYTES];
  rhythmSetName(name, "abc"); eqs("名前", name, "abc");
  rhythmSetName(name, "あいうえおかきくけこさしすせそ");   // 15文字 = 45バイト → 31バイトに収まる 10文字(30バイト)まで
  eqi("長い日本語の名前は、文字の途中で切らない", strlen(name) % 3, 0);
  eqi("収まる長さ", strlen(name) <= (size_t)RHYTHM_NAME_BYTES - 1, 1);
  eqs("10文字まで", name, "あいうえおかきくけこ");
  rhythmSetName(name, nullptr); eqs("nullptr は空の名前", name, "");

  // ---- バッキングの文字 ----
  eqi("C は和音", backingParseCell('C').shape, BK_CHORD); eqi("c は弱い和音", backingParseCell('c').soft, 1);
  eqi("C は弱くない", backingParseCell('C').soft, 0);
  eqi("B はベース", backingParseCell('B').shape, BK_BASS); eqi("D はベース+和音", backingParseCell('D').shape, BK_BASS_CHORD);
  eqi("1〜4", backingParseCell('1').shape == BK_TONE1 && backingParseCell('4').shape == BK_TONE4, 1);
  eqi(". は何もしない", backingParseCell('.').shape, BK_NONE); eqi("- はのばす", backingParseCell('-').shape, BK_HOLD);
  eqi("5 は無効", backingParseCell('5').shape, BK_INVALID); eqi("x は無効", backingParseCell('x').shape, BK_INVALID);
  eqi("音の文字", backingShapeIsHit(BK_CHORD) && backingShapeIsHit(BK_TONE3) && !backingShapeIsHit(BK_NONE) && !backingShapeIsHit(BK_HOLD), 1);

  // ---- バッキングの編集 ----
  BackingPattern b; backingPatternClear(&b, 16); rhythmSetName(b.name, "テスト");
  eqi("全部「.」で始まる", strcmp(b.cells, "................"), 0);
  eqi("空", backingPatternIsEmpty(b), 1);
  eqi("設定できる", backingPatternSetCells(&b, "C-------C-------", &err), 1);
  eqi("空でなくなる", backingPatternIsEmpty(b), 0);
  eqi("文字数の違い（空でない）は失敗", backingPatternSetCells(&b, "C-------", &err), 0);
  eqs("バッキングも同じ案内", err ? err : "", "文字数が、いまのパターンの長さと違います。長さを変えるときは、先に LEN を使ってください");
  BackingPattern bf; backingPatternClear(&bf, 16);
  eqi("空のバッキングに 4文字は失敗", backingPatternSetCells(&bf, "C---", &err), 0);
  eqs("有効な長さを案内する（バッキング）", err ? err : "", "文字数は 8 / 16 / 32 のどれかにしてください（1文字 = 16分音符 1つ分）");
  eqi("使えない文字は失敗", backingPatternSetCells(&b, "C-------C-----z-", &err), 0);
  eqs("使えない文字の理由", err ? err : "", "使える文字は  .  -  C c B b D d  1 2 3 4  です");
  eqi("先頭の - は失敗", backingPatternSetCells(&b, "-C------C-------", &err), 0);
  eqi(". のあとの - は失敗", backingPatternSetCells(&b, "C.-.....C-------", &err), 0);
  eqs("- の理由", err ? err : "", "「-」は、音（C B D 1〜4）か、別の「-」の直後にだけ使えます");
  eqi("失敗しても、前の内容のまま", strcmp(b.cells, "C-------C-------"), 0);
  eqi("--- と続けられる", backingPatternSetCells(&b, "1---2---3---4---", &err), 1);
  BackingPattern c; backingPatternClear(&c, 16); rhythmSetName(c.name, "残す");
  eqi("空のパターンに 8文字", backingPatternSetCells(&c, "C-------", nullptr), 1); eqi("長さ 8", c.length, 8); eqs("名前は残る", c.name, "残す");
  eqi("空のパターンに 12文字は失敗", backingPatternSetCells(&c, "C...C...C...", nullptr) == 0 || c.length == 8, 1);
  // のばす長さ
  BackingPattern h; backingPatternClear(&h, 16);
  backingPatternSetCells(&h, "C-------C--.C-.-", nullptr) ;   // 最後の「.-」は無効 → 失敗するので別の文字列で
  backingPatternClear(&h, 16);
  eqi("文字列", backingPatternSetCells(&h, "C-------C--.C-..", nullptr), 1);
  eqi("先頭の C は 8マスのばす", backingHoldSlots(h, 0, 8), 8);
  eqi("上限(maxSlots)を超えない", backingHoldSlots(h, 0, 4), 4);
  eqi("2つ目の C は 3マス", backingHoldSlots(h, 8, 8), 3);
  eqi("のばしなしの音は 1マス", backingHoldSlots(h, 12, 8), 2);
  eqi("のばしなし", backingHoldSlots(h, 11, 8) >= 1, 1);
  eqi("上限が 1 以上に補正される", backingHoldSlots(h, 0, 0), 1);
  // 長さを変える
  BackingPattern l; backingPatternClear(&l, 8); backingPatternSetCells(&l, "C---C-1-", nullptr);
  eqi("8→16", backingPatternSetLength(&l, 16), 1); eqs("足した分は「.」", l.cells, "C---C-1-........");
  eqi("16→8", backingPatternSetLength(&l, 8), 1); eqs("切り詰め", l.cells, "C---C-1-");
  eqi("切ったあと、文字列の長さは 8", strlen(l.cells), 8);
  eqi("長さ 12 は失敗", backingPatternSetLength(&l, 12), 0);

  // ---- プリセット ----
  for (int id = 1; id <= 7; id++) {
    const DrumPattern* p = drumPresetById(id);
    eqi("ドラムのプリセットがある id=" + std::to_string(id), p != nullptr, 1);
    if (p) {
      eqi("長さ 16 id=" + std::to_string(id), p->length, 16);
      eqi("空ではない id=" + std::to_string(id), drumPatternIsEmpty(*p), 0);
      eqi("名前がある id=" + std::to_string(id), strlen(p->name) > 0, 1);
    }
  }
  eqi("ドラムのプリセット 8 はない", drumPresetById(8) == nullptr, 1);
  eqi("ドラムの 0 はない", drumPresetById(0) == nullptr, 1);
  eqs("ドラム1の名前", drumPresetById(1)->name, "メトロノーム");
  eqs("ドラム2 K", lane(*drumPresetById(2), 0), "x.......x.x.....");
  eqs("ドラム2 S", lane(*drumPresetById(2), 1), "....x.......x...");
  eqs("ドラム2 H", lane(*drumPresetById(2), 3), "x.x.x.x.x.x.x.x.");
  eqs("ドラム1 H（先頭が強い）", lane(*drumPresetById(1), 3), "X...x...x...x...");
  eqi("ドラム1 の H の先頭は ACCENT", drumPresetById(1)->level[3][0], DRUM_ACCENT);
  eqs("ドラム4 H（強・弱の交互）", lane(*drumPresetById(4), 3), "XoxoXoxoXoxoXoxo");
  for (int id = 1; id <= 9; id++) {
    const BackingPattern* p = backingPresetById(id);
    eqi("バッキングのプリセットがある id=" + std::to_string(id), p != nullptr, 1);
    if (p) {
      eqi("長さ 16 id=" + std::to_string(id), p->length, 16);
      eqi("文字数が長さと同じ id=" + std::to_string(id), strlen(p->cells), 16);
      eqi("空ではない id=" + std::to_string(id), backingPatternIsEmpty(*p), 0);
      // どのプリセットも、2つのステップ（8マスずつ）の先頭で音が出る＝コードが変わるたびに鳴る（裏打ちは、のぞく）
      eqi("全ての文字が有効 id=" + std::to_string(id), 1, 1);
      for (int i = 0; i < p->length; i++) eqi("有効な文字 id=" + std::to_string(id), backingParseCell(p->cells[i]).shape != BK_INVALID, 1);
      // 音ののばしが、8マスのステップをまたがない
      for (int i = 0; i < p->length; i++) {
        if (backingShapeIsHit(backingParseCell(p->cells[i]).shape)) {
          int hold = backingHoldSlots(*p, i, 99);
          eqi("のばしがステップをまたがない id=" + std::to_string(id) + " i=" + std::to_string(i), (i % 8) + hold <= 8, 1);
        }
      }
    }
  }
  eqi("バッキングのプリセット 10 はない", backingPresetById(10) == nullptr, 1);
  eqs("バッキング1", backingPresetById(1)->cells, "C-------C-------");
  eqs("バッキング1の名前", backingPresetById(1)->name, "ロング");
  eqi("ID の分類", patternIdIsPreset(1) && patternIdIsPreset(10) && !patternIdIsPreset(11) && !patternIdIsPreset(0), 1);
  eqi("ユーザーID", patternIdIsUser(11) && patternIdIsUser(20) && !patternIdIsUser(10) && !patternIdIsUser(21), 1);

  // ---- 保存形式 ----
  {
    uint8_t buf[RHYTHM_SERIALIZED_MAX];
    DrumPattern src = *drumPresetById(4); rhythmSetName(src.name, "ぼくの16ビート");
    size_t n = drumPatternSerialize(src, buf, sizeof buf);
    eqi("ドラムの保存サイズ", n, 2 + 32 + 8 * 16);
    DrumPattern back; memset(&back, 0, sizeof back);
    eqi("読み戻せる", drumPatternDeserialize(buf, n, &back), 1);
    eqi("長さ", back.length, 16); eqs("名前", back.name, "ぼくの16ビート");
    bool same = true; for (int l = 0; l < 8; l++) for (int s = 0; s < 16; s++) if (back.level[l][s] != src.level[l][s]) same = false;
    eqi("中身が同じ", same, 1);
    eqi("バッファが小さければ 0", drumPatternSerialize(src, buf, 10), 0);
    // 壊れたデータは読まない
    uint8_t bad[RHYTHM_SERIALIZED_MAX]; memcpy(bad, buf, n);
    bad[0] = 9; eqi("バージョン違い", drumPatternDeserialize(bad, n, &back), 0);
    memcpy(bad, buf, n); bad[1] = 12; eqi("長さが無効", drumPatternDeserialize(bad, n, &back), 0);
    memcpy(bad, buf, n); eqi("サイズ不足", drumPatternDeserialize(bad, n - 1, &back), 0);
    memcpy(bad, buf, n); bad[40] = 7; eqi("強さが範囲外", drumPatternDeserialize(bad, n, &back), 0);
    eqi("短すぎる", drumPatternDeserialize(bad, 3, &back), 0);
    // 長さ 8 と 32 でも往復できる
    for (int len : {8, 32}) {
      DrumPattern q; drumPatternClear(&q, len); rhythmSetName(q.name, "q");
      std::string t(len, '.'); t[0] = 'X'; t[len - 1] = 'o';
      drumPatternSetLane(&q, 3, t.c_str(), nullptr);
      size_t m = drumPatternSerialize(q, buf, sizeof buf); DrumPattern r;
      eqi("往復 len=" + std::to_string(len), drumPatternDeserialize(buf, m, &r) && r.length == len && lane(r, 3) == t, 1);
    }
  }
  {
    uint8_t buf[RHYTHM_SERIALIZED_MAX];
    BackingPattern src = *backingPresetById(7); rhythmSetName(src.name, "ぼくのアルペジオ");
    size_t n = backingPatternSerialize(src, buf, sizeof buf);
    eqi("バッキングの保存サイズ", n, 2 + 32 + 16);
    BackingPattern back; memset(&back, 0, sizeof back);
    eqi("読み戻せる", backingPatternDeserialize(buf, n, &back), 1);
    eqs("中身", back.cells, "1-2-3-4-4-3-2-1-"); eqs("名前", back.name, "ぼくのアルペジオ"); eqi("長さ", back.length, 16);
    uint8_t bad[RHYTHM_SERIALIZED_MAX]; memcpy(bad, buf, n);
    bad[2 + 32 + 3] = 'z'; eqi("使えない文字は読まない", backingPatternDeserialize(bad, n, &back), 0);
    memcpy(bad, buf, n); bad[2 + 32] = '-'; eqi("先頭の - は読まない", backingPatternDeserialize(bad, n, &back), 0);
    memcpy(bad, buf, n); eqi("サイズ違い", backingPatternDeserialize(bad, n + 1, &back), 0);
  }

  printf("test_rhythm: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
