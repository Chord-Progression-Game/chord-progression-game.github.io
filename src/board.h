#pragma once
#include <stdint.h>

#include "layout.h"
#include "reader_array.h"  // NUM_READERS
#include "tag_store.h"     // TagUid

// ============================================================
// 盤面（ボード）: コード進行の「位置」ごとの状態
//
//   位置 0, 1, 2, 3 ... = コード進行の順番（ステップ）。ここに駒（NFCタグ）を置く。
//   リーダー 0, 1, 2, 3 ... = 配線した RC522。
//   この2つは別のもの。どの位置をどのリーダーで読むかは、board.cpp の表 POSITION_TO_READER で決める。
//   （標準: 位置1〜4 = リーダー4,3,2,1、位置5〜8 = リーダー5〜8。並べ方が変わったら、MAP コマンドか操作画面で変えられる）
//
//   位置の状態は、「リーダーがいま読んでいるUID」と「保存してある登録（UID → コードID）」から、
//   そのつど計算して求める。コピーを持たないので、タグの登録を変えたら、すぐ反映される。
// ============================================================

const int NUM_POSITIONS = NUM_READERS;

enum PositionState : uint8_t {
  POS_EMPTY,         // 駒がない（空）
  POS_UNREGISTERED,  // 駒はあるが、まだコードが登録されていないタグ
  POS_CHORD          // コードが登録されている駒
};

struct PositionInfo {
  PositionState state;
  TagUid uid;          // POS_EMPTY のときは意味がない
  uint8_t chordId;     // POS_CHORD のときのコードID。それ以外は 0
  int8_t duplicateOf;  // 同じタグを、別の位置も読んでいるとき、その位置（0から数える）。いなければ -1
};

// 位置 position の状態
PositionInfo boardPosition(int position);

// 位置 position のコードID。空・未登録のときは 0（= 休み）
uint8_t boardChordId(int position);

// 位置 position を読むリーダーの番号 / リーダー reader が読む位置の番号（なければ -1）
int boardReaderOfPosition(int position);
int boardPositionOfReader(int reader);

// 位置とリーダーの対応表（変更・学習は、これを通して行う）
Layout& boardLayout();
