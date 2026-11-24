// ファームの「ループ全体の高さの計画」（voicing.cpp の planBoardShifts）を、無作為な盤で書き出す。
//   ゲーム（game/js/core/voicing.js の planVoicing）が、ファームと同じ高さを返すかを、テストで照合するための元データ。
//   各行: baseC 位置1〜8のコードID（0 = 空き、99 = →） | 位置1〜8の、本来の高さからのずれ（-12 / 0 / 12。休みは 0）
#include <stdio.h>

#include <string>

#include "chords.h"
#include "voicing.h"

static int idOf(const char* name) {
  for (int k = 0; k < chordCount(); k++) if (std::string(chordAt(k).name) == name) return chordAt(k).id;
  return 0;
}

int main() {
  unsigned x = 13579;
  auto rnd = [&]() { x = x * 1664525u + 1013904223u; return x >> 8; };
  // 終止・解決・強進行が出やすい、ふつうの進行の駒
  const char* common[] = {"Ⅰ", "ⅠM7", "Ⅰ7", "Ⅱm7", "Ⅲ7", "Ⅲm7", "Ⅳ", "ⅣM7", "Ⅴ", "Ⅴ7", "Ⅴm7", "Ⅵm", "Ⅵm7", "Ⅵ", "Ⅶm7-5", "Ⅱ7"};
  int commonIds[16];
  for (int k = 0; k < 16; k++) commonIds[k] = idOf(common[k]);

  for (int n = 0; n < 4000; n++) {
    int baseC = (n % 3 == 0) ? 36 : ((n % 3 == 1) ? 48 : 60);
    bool diatonic = (n % 2) == 0;
    uint8_t raw[8];
    for (int k = 0; k < 8; k++) {
      unsigned q = rnd() % 100;
      if (q < 8) raw[k] = 0;
      else if (q < 26) raw[k] = CHORD_ID_REPEAT;
      else if (diatonic) raw[k] = (uint8_t)commonIds[rnd() % 16];
      else { const Chord& c = chordAt((int)(rnd() % (unsigned)chordCount())); raw[k] = chordIsRepeat(c) ? 0 : c.id; }
    }
    int8_t sh[8];
    planBoardShifts(raw, 8, KEY_C, baseC, true, sh);
    printf("%d", baseC);
    for (int k = 0; k < 8; k++) printf(" %d", raw[k]);
    printf(" |");
    for (int k = 0; k < 8; k++) printf(" %d", sh[k]);
    printf("\n");
  }
  return 0;
}
