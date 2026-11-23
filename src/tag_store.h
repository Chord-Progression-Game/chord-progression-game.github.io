#pragma once
#include <stdint.h>

// ============================================================
// NFCタグのUID → コードID の対応を、ESP32の不揮発メモリ(NVS)に保存する
// 電源を切っても、再起動しても登録内容は消えない。
// ============================================================

const uint8_t MAX_UID_SIZE = 10;  // UIDの最大バイト数（4, 7, 10バイトのタグがある）
const int MAX_TAGS = 100;         // 登録できるタグの最大数

// NFCタグのUID
struct TagUid {
  uint8_t size;
  uint8_t bytes[MAX_UID_SIZE];
};

enum SetResult {
  SET_OK,           // 登録（または変更）できた
  SET_FULL,         // 登録数がいっぱいで、新しいタグを登録できない
  SET_SAVE_FAILED   // 保存に失敗した（登録内容は変更されない）
};

// 起動時に1回呼ぶ。保存済みの登録を読み込む。
// 保存データが読めなかった（壊れていた）ときは false を返す。まだ何も登録していないのは正常（true）。
bool tagStoreBegin(const char* nvsNamespace = "chordtag");

int tagStoreCount();                                          // 登録数
bool tagStoreGet(int index, TagUid* uid, uint8_t* chordId);   // index番目の登録を取り出す
uint8_t tagStoreFind(const TagUid& uid);                      // UIDに登録されたコードID。未登録なら 0
SetResult tagStoreSet(const TagUid& uid, uint8_t chordId);    // 登録・変更して、NVSに保存する
