// chords.cpp のパソコン上テスト。
// ユーザーが指定した「Key=C での構成音」の表と、ずっと変えないIDの意味を照合する。
//   実行: tools/host_tests/run_all.sh
#include "chords.h"

#include <stdio.h>

#include <set>
#include <string>

static int fails = 0, checks = 0;
static void eqs(const std::string& w, const std::string& g, const std::string& e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got [%s] want [%s]\n", w.c_str(), g.c_str(), e.c_str()); }
}
static void eqi(const std::string& w, long g, long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %ld want %ld\n", w.c_str(), g, e); }
}
static std::string sym(const Chord& c, const Key& k) { char b[32]; chordSymbol(c, k, b, sizeof b); return b; }
static std::string nts(const Chord& c, const Key& k, bool oct = true) { char b[64]; chordNoteNames(c, k, b, sizeof b, oct); return b; }

int main() {
  struct E { int id, lv; const char* name; const char* notes; const char* sym; };
  // メニューの並び順。notes は Key=C、3和音は4音目にルートのオクターブ上
  const E T[] = {
    {1,1,"Ⅰ","C E G C","C"},{2,1,"Ⅵm","A C E A","Am"},{3,1,"Ⅳ","F A C F","F"},{4,1,"Ⅴ","G B D G","G"},
    {5,2,"ⅠM7","C E G B","CM7"},{6,2,"Ⅱm","D F A D","Dm"},{7,2,"Ⅲm","E G B E","Em"},{8,2,"ⅣM7","F A C E","FM7"},{9,2,"Ⅴ7","G B D F","G7"},{10,2,"Ⅵm7","A C E G","Am7"},
    {11,3,"Ⅰ7","C E G B♭","C7"},{12,3,"Ⅱm7","D F A C","Dm7"},{13,3,"Ⅲm7","E G B D","Em7"},{14,3,"Ⅲ7","E G# B D","E7"},{15,3,"Ⅶm7-5","B D F A","Bm7-5"},
    {16,4,"Ⅱ7","D F# A C","D7"},{17,4,"Ⅳm7","F A♭ C E♭","Fm7"},{18,4,"Ⅳ#m7-5","F# A C E","F#m7-5"},{19,4,"Ⅴm7","G B♭ D F","Gm7"},
    {27,4,"Ⅴsus47","G C D F","Gsus47"},{21,4,"Ⅵ♭M7","A♭ C E♭ G","A♭M7"},{20,4,"Ⅴ#dim7","G# B D F","G#dim7"},{22,4,"Ⅵ7","A C# E G","A7"},{23,4,"Ⅶ♭7","B♭ D F A♭","B♭7"},
    {30,4,"Ⅵ","A C# E A","A"},{31,4,"Ⅵsus4","A D E A","Asus4"},   // ピカルディ終止の着地点と、サス（2026-11-17 に追加）
    {24,5,"Ⅱ♭M7","D♭ F A♭ C","D♭M7"},{25,5,"Ⅲ♭M7","E♭ G B♭ D","E♭M7"},{28,5,"Ⅲ♭m6","E♭ G♭ B♭ C","E♭m6"},{26,5,"Ⅳm6","F A♭ C D","Fm6"},
    {29,5,"Ⅱ♭7","D♭ F A♭ C♭","D♭7"},   // 裏コード（2026-11-14 に追加）
    {99,6,"→","","→"},   // 特別な駒: 前のコマと同じコードを鳴らす（音は持たない）
  };
  const int N = sizeof(T) / sizeof(T[0]);
  eqi("chordCount", chordCount(), N);
  std::set<int> ids;
  for (int i = 0; i < N; i++) {
    const Chord& c = chordAt(i);
    std::string tag = "メニュー" + std::to_string(i + 1) + " " + T[i].name;
    eqi(tag + " id", c.id, T[i].id);
    eqi(tag + " level", c.level, T[i].lv);
    eqs(tag + " 表示名", c.name, T[i].name);
    eqs(tag + " Key=C 音", nts(c, KEY_C), T[i].notes);
    eqs(tag + " Key=C コード名", sym(c, KEY_C), T[i].sym);
    ids.insert(c.id);
    eqi(tag + " chordById", chordById(c.id) == &c, 1);
  }
  eqi("id重複なし", (long)ids.size(), N);

  // すでに登録済みのタグに書かれているID 1〜26 の意味が変わっていない（Lv.5は表記だけディグリーに変更済み）
  const char* old[27] = {"", "Ⅰ","Ⅵm","Ⅳ","Ⅴ","ⅠM7","Ⅱm","Ⅲm","ⅣM7","Ⅴ7","Ⅵm7","Ⅰ7","Ⅱm7","Ⅲm7","Ⅲ7","Ⅶm7-5",
                         "Ⅱ7","Ⅳm7","Ⅳ#m7-5","Ⅴm7","Ⅴ#dim7","Ⅵ♭M7","Ⅵ7","Ⅶ♭7","Ⅱ♭M7","Ⅲ♭M7","Ⅳm6"};
  for (int id = 1; id <= 26; id++) eqs("旧ID" + std::to_string(id), chordById(id)->name, old[id]);
  eqi("id0なし", chordById(0) == nullptr, 1);
  eqi("id29は Ⅱ♭7（裏コード）", chordById(29) != nullptr && std::string(chordById(29)->name) == "Ⅱ♭7", 1);
  eqi("id30は Ⅵ（長三和音）・id31は Ⅵsus4", chordById(30) != nullptr && std::string(chordById(30)->name) == "Ⅵ" && chordById(31) != nullptr && std::string(chordById(31)->name) == "Ⅵsus4", 1);
  eqi("id32なし", chordById(32) == nullptr, 1);
  eqi("id98なし", chordById(98) == nullptr, 1);
  eqi("id100なし", chordById(100) == nullptr, 1);
  // 「→」の駒（ID 99）
  {
    const Chord* a = chordById(99);
    eqi("→ のID", CHORD_ID_REPEAT, 99);
    eqi("→ がある", a != nullptr, 1);
    if (a) {
      eqs("→ の表示名", a->name, "→");
      eqi("→ はレベル6（特殊）", a->level, CHORD_LEVEL_SPECIAL);
      eqi("→ は repeat", chordIsRepeat(*a), 1);
      uint8_t m[MAX_CHORD_NOTES];
      eqi("→ は音を持たない", chordMidiNotes(*a, KEY_C, 48, m), 0);
      eqi("→ は音を持たない（3音モード）", chordMidiNotes(*a, KEY_C, 48, m, false), 0);
      eqs("→ の音名は空", nts(*a, KEY_C), "");
      eqs("→ のコード名", sym(*a, KEY_C), "→");
      eqs("→ のコード名（Key=D でも）", sym(*a, {1, 0}), "→");
    }
    int others = 0; for (int i = 0; i < chordCount(); i++) if (chordIsRepeat(chordAt(i))) others++;
    eqi("→ は1つだけ", others, 1);
    eqi("ふつうのコードは repeat ではない", chordIsRepeat(*chordById(1)), 0);
    eqi("→ はメニューの一番最後", &chordAt(chordCount() - 1) == a, 1);
  }
  for (int i = 1; i < N; i++) eqi("レベル昇順", chordAt(i).level >= chordAt(i - 1).level, 1);

  // ユーザー指定の例（Key=C）: Ⅰ→C Ⅱm→Dm Ⅲm→Em Ⅳ→F Ⅴ7→G7 Ⅵm→Am
  eqs("C: Ⅰ", sym(*chordById(1), KEY_C), "C");
  eqs("C: Ⅱm", sym(*chordById(6), KEY_C), "Dm");
  eqs("C: Ⅲm", sym(*chordById(7), KEY_C), "Em");
  eqs("C: Ⅳ", sym(*chordById(3), KEY_C), "F");
  eqs("C: Ⅴ7", sym(*chordById(9), KEY_C), "G7");
  eqs("C: Ⅵm", sym(*chordById(2), KEY_C), "Am");
  // 将来のキー変更: Key=D
  const Key D = {1, 0};
  eqs("D: Ⅰ", sym(*chordById(1), D), "D");
  eqs("D: Ⅱm", sym(*chordById(6), D), "Em");
  eqs("D: Ⅲm", sym(*chordById(7), D), "F#m");
  eqs("D: Ⅳ", sym(*chordById(3), D), "G");
  eqs("D: Ⅴ7", sym(*chordById(9), D), "A7");
  eqs("D: Ⅵm", sym(*chordById(2), D), "Bm");
  eqs("D: Ⅴsus47", sym(*chordById(27), D) + " " + nts(*chordById(27), D), "Asus47 A D E G");
  eqs("D: Ⅲ♭m6", sym(*chordById(28), D) + " " + nts(*chordById(28), D), "Fm6 F A♭ C D");
  eqs("D: Ⅱ♭M7", sym(*chordById(24), D), "E♭M7");

  // 12キーすべて: 4音・昇順・先頭がルート・3和音の4音目はルート+12
  const Key keys[] = {{0,0},{1,-1},{1,0},{2,-1},{2,0},{3,0},{3,1},{4,0},{5,-1},{5,0},{6,-1},{6,0}};
  uint8_t m[MAX_CHORD_NOTES];
  for (int k = 0; k < 12; k++) for (int i = 0; i < N; i++) {
    const Chord& c = chordAt(i);
    if (chordIsRepeat(c)) continue;   // → は音を持たない
    bool triad = (c.type == CT_MAJOR || c.type == CT_MINOR || c.type == CT_SUS4);
    uint8_t n = chordMidiNotes(c, keys[k], 48, m);
    eqi("音数=4", n, 4);
    for (int j = 1; j < n; j++) eqi("昇順", m[j] > m[j - 1], 1);
    eqi("先頭=ルート", m[0] % 12, chordRootPitchClass(c, keys[k]));
    if (triad) eqi("3和音の4音目=ルート+12", m[3], m[0] + 12);
    // octaveForTriads=false: 3和音は3音、7thなどは4音のまま（先頭の3音は同じ）
    uint8_t m3[MAX_CHORD_NOTES];
    uint8_t n3 = chordMidiNotes(c, keys[k], 48, m3, false);
    eqi("3音モードの音数", n3, triad ? 3 : 4);
    for (int j = 0; j < n3; j++) eqi("3音モードの音", m3[j], m[j]);
    std::string s3 = nts(c, keys[k], false); int sp = 0; for (char ch : s3) if (ch == ' ') sp++;
    eqi("3音モードの表示", sp, (triad ? 3 : 4) - 1);
  }
  // ピアノ用（C3=48）の具体例
  uint8_t n = chordMidiNotes(*chordById(1), KEY_C, 48, m);          // Ⅰ = C3 E3 G3 C4
  eqi("Ⅰ", n == 4 && m[0] == 48 && m[1] == 52 && m[2] == 55 && m[3] == 60, 1);
  n = chordMidiNotes(*chordById(9), KEY_C, 48, m);                  // Ⅴ7 = G3 B3 D4 F4
  eqi("Ⅴ7", n == 4 && m[0] == 55 && m[1] == 59 && m[2] == 62 && m[3] == 65, 1);
  n = chordMidiNotes(*chordById(1), KEY_C, 48, m, false);           // Ⅰ(3音) = C3 E3 G3
  eqi("Ⅰ(3音)", n == 3 && m[0] == 48 && m[1] == 52 && m[2] == 55, 1);
  n = chordMidiNotes(*chordById(27), KEY_C, 48, m);                 // Ⅴsus47 = G3 C4 D4 F4
  eqi("Ⅴsus47", n == 4 && m[0] == 55 && m[1] == 60 && m[2] == 62 && m[3] == 65, 1);
  n = chordMidiNotes(*chordById(30), KEY_C, 48, m);                 // Ⅵ（長三和音）= A3 C#4 E4 A4（3和音は4音目がオクターブ上）
  eqi("Ⅵ（長三和音）", n == 4 && m[0] == 57 && m[1] == 61 && m[2] == 64 && m[3] == 69, 1);
  n = chordMidiNotes(*chordById(31), KEY_C, 48, m);                 // Ⅵsus4 = A3 D4 E4 A4
  eqi("Ⅵsus4", n == 4 && m[0] == 57 && m[1] == 62 && m[2] == 64 && m[3] == 69, 1);
  eqs("D: Ⅵ", sym(*chordById(30), D) + " " + nts(*chordById(30), D), "B B D# F# B");
  eqs("D: Ⅵsus4", sym(*chordById(31), D) + " " + nts(*chordById(31), D), "Bsus4 B E F# B");
  n = chordMidiNotes(*chordById(28), KEY_C, 48, m);                 // Ⅲ♭m6 = E♭3 G♭3 B♭3 C4
  eqi("Ⅲ♭m6", n == 4 && m[0] == 51 && m[1] == 54 && m[2] == 58 && m[3] == 60, 1);

  // ---- キー（調）の扱い ----
  {
    Key k = {9, 9};
    struct KN { const char* text; int letter; int acc; };
    const KN good[] = {{"C", 0, 0}, {"c", 0, 0}, {"D", 1, 0}, {"E", 2, 0}, {"F", 3, 0}, {"G", 4, 0}, {"A", 5, 0}, {"B", 6, 0},
                       {"Eb", 2, -1}, {"eb", 2, -1}, {"Bb", 6, -1}, {"bb", 6, -1}, {"Db", 1, -1}, {"Ab", 5, -1}, {"Gb", 4, -1},
                       {"F#", 3, 1}, {"f#", 3, 1}, {"C#", 0, 1}, {"G#", 4, 1}, {"D#", 1, 1},
                       {"B♭", 6, -1}, {"E♭", 2, -1}, {"F♯", 3, 1}, {"c♯", 0, 1}, {"  D  ", 1, 0}, {"b", 6, 0}, {"Cb", 0, -1}, {"E#", 2, 1}};
    for (const KN& g : good) {
      k = {9, 9};
      eqi(std::string("キー名を読める: ") + g.text, parseKeyName(g.text, &k), 1);
      eqi(std::string("文字: ") + g.text, k.letter, g.letter);
      eqi(std::string("変化記号: ") + g.text, k.accidental, g.acc);
    }
    const char* bad[] = {"", "H", "Z", "C##", "Cm", "D major", "1", "#", "bb b", "Cx", "C#b", "é", "♭"};
    for (const char* b : bad) {
      k = {9, 9};
      eqi(std::string("読めない: [") + b + "]", parseKeyName(b, &k), 0);
      eqi(std::string("読めないとき key は変えない: [") + b + "]", k.letter == 9 && k.accidental == 9, 1);
    }
    eqi("nullptr は false", parseKeyName(nullptr, &k), 0);
    // 高さ → ふつうの綴り
    const char* names[12] = {"C", "D♭", "D", "E♭", "E", "F", "F#", "G", "A♭", "A", "B♭", "B"};
    for (int pc = 0; pc < 12; pc++) {
      char b[8]; Key kk = keyFromPitchClass(pc); keyName(kk, b, sizeof b);
      eqs("高さ " + std::to_string(pc) + " の綴り", b, names[pc]);
      eqi("高さが一致", keyPitchClassOf(kk), pc);
    }
    eqi("12以上も、一周して扱う", keyPitchClassOf(keyFromPitchClass(14)), 2);
    eqi("負の数も扱う", keyPitchClassOf(keyFromPitchClass(-1)), 11);
    // 移調
    char b[8];
    keyName(keyTranspose(KEY_C, 2), b, sizeof b); eqs("C +2 = D", b, "D");
    keyName(keyTranspose(KEY_C, -1), b, sizeof b); eqs("C -1 = B", b, "B");
    keyName(keyTranspose(KEY_C, 1), b, sizeof b); eqs("C +1 = D♭", b, "D♭");
    keyName(keyTranspose({1, 0}, 12), b, sizeof b); eqs("D +12 = D", b, "D");
    keyName(keyTranspose({3, 1}, 1), b, sizeof b); eqs("F# +1 = G", b, "G");
    keyName(keyTranspose({0, 0}, -13), b, sizeof b); eqs("C -13 = B", b, "B");
    // 打った名前の綴りは、そのまま使う（F# は F# のまま）
    Key fs; parseKeyName("F#", &fs); keyName(fs, b, sizeof b); eqs("F# はそのまま", b, "F#");
    eqs("F# のⅠ", sym(*chordById(1), fs), "F#");
    eqs("F# のⅤ7", sym(*chordById(9), fs), "C#7");
    Key gb; parseKeyName("Gb", &gb); eqs("Gb のⅠ", sym(*chordById(1), gb), "G♭");
    eqs("Gb のⅣ", sym(*chordById(3), gb), "C♭");
  }

  printf("test_chords: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
