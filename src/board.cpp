#include "board.h"

#include <string.h>

// 位置 → その位置を読むリーダー。位置の順番（コード進行の順番）と、リーダーの順番（配線の順番）を混同しないための表。
// 並べ方が変わったら、MAP コマンドか操作画面で変えられる（layout.h）。標準: 上段の左から 位置1〜4 = リーダー4,3,2,1、下段 位置5〜8 = リーダー5〜8
static Layout layout(NUM_POSITIONS);

Layout& boardLayout() { return layout; }

int boardReaderOfPosition(int position) { return layout.readerOfPosition(position); }

int boardPositionOfReader(int reader) { return layout.positionOfReader(reader); }

static bool sameUid(const TagUid& a, const TagUid& b) {
  return a.size == b.size && memcmp(a.bytes, b.bytes, a.size) == 0;
}

PositionInfo boardPosition(int position) {
  PositionInfo info;
  memset(&info, 0, sizeof(info));
  info.state = POS_EMPTY;
  info.chordId = 0;
  info.duplicateOf = -1;

  int reader = boardReaderOfPosition(position);
  if (reader < 0 || !readerHasTag(reader)) return info;  // 空

  info.uid = readerTagUid(reader);
  info.chordId = tagStoreFind(info.uid);  // 0 なら未登録
  info.state = (info.chordId != 0) ? POS_CHORD : POS_UNREGISTERED;

  // 同じタグを、別の位置も読んでいないか。
  // 1枚のタグが同時に2か所にあることはないので、リーダー同士の電波の干渉か、タグが2つのリーダーの間にある。
  // 自動では直さず、見つけたことだけを知らせる（STATUS などに表示する）。リーダーの間隔をあけて直す。
  for (int other = 0; other < NUM_POSITIONS; other++) {
    if (other == position) continue;
    int r = boardReaderOfPosition(other);
    if (r >= 0 && readerHasTag(r) && sameUid(readerTagUid(r), info.uid)) {
      info.duplicateOf = (int8_t)other;
      break;
    }
  }
  return info;
}

uint8_t boardChordId(int position) {
  return boardPosition(position).chordId;
}
