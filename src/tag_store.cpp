#include "tag_store.h"

#include <Arduino.h>
#include <Preferences.h>
#include <string.h>

// 1件分の登録（このまま NVS に保存するので、サイズが変わらないようにしている）
struct TagEntry {
  TagUid uid;
  uint8_t chordId;
};
static_assert(sizeof(TagEntry) == MAX_UID_SIZE + 2, "TagEntry has padding");

static const char* NVS_KEY = "tags";           // NVS上の項目名（15文字まで）
static const char* nvsName = "chordtag";       // NVS上の保存場所の名前
static Preferences prefs;

static TagEntry tags[MAX_TAGS];  // 登録内容。起動時にNVSから読み込んで、メモリ上で検索する
static int tagCount = 0;

static int indexOf(const TagUid& uid) {
  for (int i = 0; i < tagCount; i++) {
    if (tags[i].uid.size == uid.size && memcmp(tags[i].uid.bytes, uid.bytes, uid.size) == 0) {
      return i;
    }
  }
  return -1;
}

// 登録内容すべてを NVS に書き込む（成功したら true）
static bool saveAll() {
  if (!prefs.begin(nvsName, false)) return false;  // false = 書き込みも許可
  size_t len = tagCount * sizeof(TagEntry);
  size_t written = prefs.putBytes(NVS_KEY, tags, len);
  prefs.end();
  return written == len;
}

bool tagStoreBegin(const char* nvsNamespace) {
  nvsName = nvsNamespace;
  tagCount = 0;

  if (!prefs.begin(nvsName, false)) return false;

  bool ok = true;
  if (prefs.isKey(NVS_KEY)) {  // まだ何も保存していない最初の起動では、項目がない
    size_t len = prefs.getBytesLength(NVS_KEY);
    if (len > 0 && len % sizeof(TagEntry) == 0 && len <= sizeof(tags)) {
      prefs.getBytes(NVS_KEY, tags, len);
      tagCount = len / sizeof(TagEntry);
    } else {
      ok = false;  // 大きさがおかしい＝壊れたデータ。読み込まない
    }
  }
  prefs.end();

  // 中身がおかしい登録は取り除く
  int valid = 0;
  for (int i = 0; i < tagCount; i++) {
    if (tags[i].uid.size >= 1 && tags[i].uid.size <= MAX_UID_SIZE && tags[i].chordId != 0) {
      tags[valid++] = tags[i];
    } else {
      ok = false;
    }
  }
  tagCount = valid;
  return ok;
}

int tagStoreCount() { return tagCount; }

bool tagStoreGet(int index, TagUid* uid, uint8_t* chordId) {
  if (index < 0 || index >= tagCount) return false;
  *uid = tags[index].uid;
  *chordId = tags[index].chordId;
  return true;
}

uint8_t tagStoreFind(const TagUid& uid) {
  int i = indexOf(uid);
  return i < 0 ? 0 : tags[i].chordId;
}

SetResult tagStoreSet(const TagUid& uid, uint8_t chordId) {
  int i = indexOf(uid);

  if (i >= 0) {
    // 登録済みのタグ: コードを変更する
    uint8_t oldId = tags[i].chordId;
    tags[i].chordId = chordId;
    if (!saveAll()) {
      tags[i].chordId = oldId;  // 保存できなかったので元に戻す
      return SET_SAVE_FAILED;
    }
    return SET_OK;
  }

  // 新しいタグ: 末尾に追加する
  if (tagCount >= MAX_TAGS) return SET_FULL;
  tags[tagCount].uid = uid;
  tags[tagCount].chordId = chordId;
  tagCount++;
  if (!saveAll()) {
    tagCount--;  // 保存できなかったので取り消す
    return SET_SAVE_FAILED;
  }
  return SET_OK;
}
