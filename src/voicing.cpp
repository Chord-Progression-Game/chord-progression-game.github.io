#include "voicing.h"

static int absInt(int v) { return v < 0 ? -v : v; }

int chooseOctaveShift(int nominalRoot, int previousRoot, bool enabled) {
  if (!enabled || previousRoot < 0) return 0;

  // 候補。先に並べたものが、同じ近さのときに選ばれる（本来の高さが最優先）
  static const int CANDIDATES[3] = {0, -12, +12};

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
