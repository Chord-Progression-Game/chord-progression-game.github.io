// ファームの和音の高さの計算（voicing.cpp + chords.cpp の chordMidiNotes）を、すべての組み合わせで書き出す。
//   ゲーム（game/js/core/voicing.js）が、ファームと同じ高さを返すかを、テストで照合するための元データ。
//   各行: baseC 前のコードID 今のコードID ルート 音1 音2 音3 音4（前のコードがないときは、前のコードID = 0）
#include <stdio.h>

#include "chords.h"
#include "voicing.h"

int main() {
  for (int baseC = 36; baseC <= 84; baseC += 12) {
    for (int p = -1; p < chordCount(); p++) {
      if (p >= 0 && chordIsRepeat(chordAt(p))) continue;
      for (int c = 0; c < chordCount(); c++) {
        const Chord& cur = chordAt(c);
        if (chordIsRepeat(cur)) continue;
        int previousRoot = -1;
        if (p >= 0) previousRoot = baseC + chordRootPitchClass(chordAt(p), KEY_C);   // 前のコードは、本来の高さで鳴ったとする（ルートだけ見る）
        int nominal = baseC + chordRootPitchClass(cur, KEY_C);
        int shift = chooseOctaveShift(nominal, previousRoot, true);
        uint8_t notes[MAX_CHORD_NOTES] = {0};
        chordMidiNotes(cur, KEY_C, (uint8_t)(baseC + shift), notes, true);
        printf("%d %d %d %d %d %d %d %d\n", baseC, p >= 0 ? chordAt(p).id : 0, cur.id, nominal + shift, notes[0], notes[1], notes[2], notes[3]);
      }
    }
  }
  return 0;
}
