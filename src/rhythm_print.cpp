#include "rhythm_print.h"

#include <Arduino.h>

void rhythmPrintRuler(int length) {
  for (int i = 0; i < length; i++) {
    if (i % 4 == 0) Serial.print((i / 4) % 4 + 1);  // 拍の頭に、拍の番号（1 2 3 4）
    else Serial.print('.');
  }
}

void rhythmPrintDrumPattern(int id, const DrumPattern& p) {
  Serial.printf("ドラム %d「%s」（%d マス = %s）\n", id, p.name, p.length,
                p.length == 8 ? "半小節" : (p.length == 16 ? "1小節" : "2小節"));
  Serial.print("   ");
  rhythmPrintRuler(p.length);
  Serial.println();
  bool any = false;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    char text[RHYTHM_MAX_SLOTS + 1];
    drumPatternLaneText(p, lane, text, sizeof(text));
    bool has = false;
    for (int s = 0; s < p.length; s++) {
      if (p.level[lane][s] != DRUM_NONE) has = true;
    }
    if (!has) continue;
    any = true;
    Serial.printf("%c  %s  %s\n", drumLaneLetter(lane), text, drumLaneName(lane));
  }
  if (!any) Serial.println("   （音がありません）");
}

void rhythmPrintBackingPattern(int id, const BackingPattern& p) {
  Serial.printf("バッキング %d「%s」（%d マス = %s）\n", id, p.name, p.length,
                p.length == 8 ? "半小節" : (p.length == 16 ? "1小節" : "2小節"));
  Serial.print("   ");
  rhythmPrintRuler(p.length);
  Serial.println();
  Serial.printf("   %s\n", p.cells);
}
