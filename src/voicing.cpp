#include "voicing.h"

static int absInt(int v) { return v < 0 ? -v : v; }

int chooseOctaveShift(int nominalRoot, int previousRoot, bool enabled) {
  if (!enabled || previousRoot < 0) return 0;

  // 候補。先に並べたものが、同じ近さのときに選ばれる（本来の高さが最優先）
  static const int CANDIDATES[3] = {0, -12, +12};

  // 強進行（前のルートから見て、ルートが完全4度上 = 完全5度下に進む和音: Ⅴ→Ⅰ・Ⅱm→Ⅴ など）は、完全5度「下」へ動かす。
  // 上へ4度跳ぶと、ベースがいったん浮き上がって、「終止した感じ」にならない（2026-11-24 のご指定。ゲームの voicing.js と同じ規則）。
  // 5度下の高さが、候補（本来の高さの上下1オクターブ）の中にないとき（下に行きすぎるとき）だけ、いちばん近い高さにする。
  if ((((nominalRoot - previousRoot) % 12) + 12) % 12 == 5) {
    for (int i = 0; i < 3; i++) {
      if (nominalRoot + CANDIDATES[i] == previousRoot - 7) return CANDIDATES[i];
    }
  }

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
