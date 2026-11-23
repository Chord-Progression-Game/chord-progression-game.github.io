// プリセット（ドラム・バッキング）を JSON にして出力する。tools/rhythm_editor/presets.json の元。
//   作り直し: sh tools/rhythm_editor/gen_presets.sh
#include <stdio.h>
#include "rhythm.h"
int main() {
  printf("{\n  \"drums\": [\n");
  bool first = true;
  for (int id = 1; id <= PATTERN_ID_PRESET_LAST; id++) {
    const DrumPattern* p = drumPresetById(id);
    if (!p) continue;
    printf("%s    {\"id\": %d, \"name\": \"%s\", \"length\": %d, \"lanes\": {", first ? "" : ",\n", id, p->name, p->length);
    first = false;
    bool firstLane = true;
    for (int l = 0; l < DRUM_LANES; l++) {
      char t[40];
      drumPatternLaneText(*p, l, t, sizeof t);
      bool any = false;
      for (int i = 0; i < p->length; i++) if (p->level[l][i]) any = true;
      if (!any) continue;
      printf("%s\"%c\": \"%s\"", firstLane ? "" : ", ", drumLaneLetter(l), t);
      firstLane = false;
    }
    printf("}}");
  }
  printf("\n  ],\n  \"backings\": [\n");
  first = true;
  for (int id = 1; id <= PATTERN_ID_PRESET_LAST; id++) {
    const BackingPattern* p = backingPresetById(id);
    if (!p) continue;
    printf("%s    {\"id\": %d, \"name\": \"%s\", \"length\": %d, \"cells\": \"%s\"}", first ? "" : ",\n", id, p->name, p->length, p->cells);
    first = false;
  }
  printf("\n  ]\n}\n");
  return 0;
}
