// コードの表（chords.cpp）を JSON にして出力する。game/data/chords.json の元。
//   ゲーム（ブラウザ）は、この JSON を読む。ファームの表を、ただ1つの正しい表にして、ゲーム側に写しを持たない。
//   作り直し: sh tools/game_lab/gen_game_data.sh
#include <stdio.h>

#include "chords.h"

static const char* typeKey(ChordType t) {
  switch (t) {
    case CT_MAJOR: return "maj";
    case CT_MINOR: return "min";
    case CT_MAJ7: return "maj7";
    case CT_DOM7: return "dom7";
    case CT_MIN7: return "min7";
    case CT_MIN7B5: return "min7b5";
    case CT_DIM7: return "dim7";
    case CT_MIN6: return "min6";
    case CT_SUS47: return "sus47";
    case CT_SUS4: return "sus4";
    case CT_REPEAT: return "repeat";
    default: return "?";
  }
}

int main() {
  printf("{\n  \"repeatId\": %d,\n  \"key\": \"C\",\n  \"chords\": [\n", CHORD_ID_REPEAT);
  for (int i = 0; i < chordCount(); i++) {
    const Chord& c = chordAt(i);
    char sym[32], names[64];
    chordSymbol(c, KEY_C, sym, sizeof sym);
    chordNoteNames(c, KEY_C, names, sizeof names, true);
    int rootPc = 0, count = 0;
    uint8_t notes[MAX_CHORD_NOTES] = {0, 0, 0, 0};
    if (!chordIsRepeat(c)) {
      rootPc = chordRootPitchClass(c, KEY_C);
      count = chordMidiNotes(c, KEY_C, 0, notes, true);   // baseC=0 なので、notes = ルートの高さ + 半音の間隔
    }
    printf("%s    {\"id\": %d, \"menu\": %d, \"level\": %d, \"name\": \"%s\", \"degree\": %d, \"accidental\": %d, \"type\": \"%s\", "
           "\"rootPc\": %d, \"semitones\": [", i ? ",\n" : "", c.id, i + 1, c.level, c.name, c.degree, c.accidental, typeKey(c.type), rootPc);
    for (int k = 0; k < count; k++) printf("%s%d", k ? ", " : "", (int)notes[k] - rootPc);
    printf("], \"symbol\": \"%s\", \"notes\": \"%s\"}", sym, names);
  }
  printf("\n  ]\n}\n");
  return 0;
}
