#include "rhythm_store.h"

#include <Arduino.h>
#include <Preferences.h>
#include <stdio.h>
#include <string.h>

static const char* nvsName = "rhythm";
static Preferences prefs;

static DrumPattern userDrums[PATTERN_USER_SLOTS];
static bool userDrumExists[PATTERN_USER_SLOTS];
static BackingPattern userBackings[PATTERN_USER_SLOTS];
static bool userBackingExists[PATTERN_USER_SLOTS];

static int slotOf(int id) { return id - PATTERN_ID_USER_FIRST; }

static void keyFor(char kind, int id, char* key) { snprintf(key, 8, "%c%d", kind, id); }  // 例: d11 / b12

int rhythmStoreBegin(const char* nvsNamespace) {
  nvsName = nvsNamespace;
  memset(userDrumExists, 0, sizeof(userDrumExists));
  memset(userBackingExists, 0, sizeof(userBackingExists));
  int broken = 0;
  if (!prefs.begin(nvsName, false)) return 0;  // 開けなければ、プリセットだけで動く
  for (int id = PATTERN_ID_USER_FIRST; id <= PATTERN_ID_USER_LAST; id++) {
    char key[8];
    uint8_t buf[RHYTHM_SERIALIZED_MAX];

    keyFor('d', id, key);
    if (prefs.isKey(key)) {
      size_t len = prefs.getBytesLength(key);
      if (len > 0 && len <= sizeof(buf)) {
        prefs.getBytes(key, buf, len);
        if (drumPatternDeserialize(buf, len, &userDrums[slotOf(id)])) userDrumExists[slotOf(id)] = true;
        else broken++;
      } else {
        broken++;
      }
    }
    keyFor('b', id, key);
    if (prefs.isKey(key)) {
      size_t len = prefs.getBytesLength(key);
      if (len > 0 && len <= sizeof(buf)) {
        prefs.getBytes(key, buf, len);
        if (backingPatternDeserialize(buf, len, &userBackings[slotOf(id)])) userBackingExists[slotOf(id)] = true;
        else broken++;
      } else {
        broken++;
      }
    }
  }
  prefs.end();
  return broken;
}

const DrumPattern* rhythmDrum(int id) {
  if (patternIdIsPreset(id)) return drumPresetById(id);
  if (patternIdIsUser(id) && userDrumExists[slotOf(id)]) return &userDrums[slotOf(id)];
  return nullptr;
}

const BackingPattern* rhythmBacking(int id) {
  if (patternIdIsPreset(id)) return backingPresetById(id);
  if (patternIdIsUser(id) && userBackingExists[slotOf(id)]) return &userBackings[slotOf(id)];
  return nullptr;
}

DrumPattern* rhythmDrumForEdit(int id, bool create) {
  if (!patternIdIsUser(id)) return nullptr;
  int s = slotOf(id);
  if (!userDrumExists[s]) {
    if (!create) return nullptr;
    drumPatternClear(&userDrums[s], 16);
    rhythmSetName(userDrums[s].name, "(新しいパターン)");
    userDrumExists[s] = true;
  }
  return &userDrums[s];
}

BackingPattern* rhythmBackingForEdit(int id, bool create) {
  if (!patternIdIsUser(id)) return nullptr;
  int s = slotOf(id);
  if (!userBackingExists[s]) {
    if (!create) return nullptr;
    backingPatternClear(&userBackings[s], 16);
    rhythmSetName(userBackings[s].name, "(新しいパターン)");
    userBackingExists[s] = true;
  }
  return &userBackings[s];
}

bool rhythmSaveDrum(int id) {
  if (!patternIdIsUser(id) || !userDrumExists[slotOf(id)]) return false;
  uint8_t buf[RHYTHM_SERIALIZED_MAX];
  size_t len = drumPatternSerialize(userDrums[slotOf(id)], buf, sizeof(buf));
  if (len == 0) return false;
  char key[8];
  keyFor('d', id, key);
  if (!prefs.begin(nvsName, false)) return false;
  size_t written = prefs.putBytes(key, buf, len);
  prefs.end();
  return written == len;
}

bool rhythmSaveBacking(int id) {
  if (!patternIdIsUser(id) || !userBackingExists[slotOf(id)]) return false;
  uint8_t buf[RHYTHM_SERIALIZED_MAX];
  size_t len = backingPatternSerialize(userBackings[slotOf(id)], buf, sizeof(buf));
  if (len == 0) return false;
  char key[8];
  keyFor('b', id, key);
  if (!prefs.begin(nvsName, false)) return false;
  size_t written = prefs.putBytes(key, buf, len);
  prefs.end();
  return written == len;
}

bool rhythmDeleteDrum(int id) {
  if (!patternIdIsUser(id)) return false;
  userDrumExists[slotOf(id)] = false;
  char key[8];
  keyFor('d', id, key);
  if (!prefs.begin(nvsName, false)) return false;
  if (prefs.isKey(key)) prefs.remove(key);
  prefs.end();
  return true;
}

bool rhythmDeleteBacking(int id) {
  if (!patternIdIsUser(id)) return false;
  userBackingExists[slotOf(id)] = false;
  char key[8];
  keyFor('b', id, key);
  if (!prefs.begin(nvsName, false)) return false;
  if (prefs.isKey(key)) prefs.remove(key);
  prefs.end();
  return true;
}
