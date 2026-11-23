// board.cpp のパソコン上テスト。
// リーダー（reader_array）と保存データ（tag_store）は、このファイルの下のほうで偽物を用意する。
//   実行: tools/host_tests/run_all.sh
#include "board.h"

#include <stdio.h>
#include <string.h>

#include <string>

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}

// ---- 偽物のリーダーと保存データ ----
static bool fakePresent[NUM_READERS];
static TagUid fakeUid[NUM_READERS];
struct Reg { TagUid uid; uint8_t chord; };
static Reg regs[16]; static int regCount = 0;

bool readerHasTag(int i) { return fakePresent[i]; }
const TagUid& readerTagUid(int i) { return fakeUid[i]; }
uint8_t tagStoreFind(const TagUid& uid) {
  for (int i = 0; i < regCount; i++)
    if (regs[i].uid.size == uid.size && memcmp(regs[i].uid.bytes, uid.bytes, uid.size) == 0) return regs[i].chord;
  return 0;
}

static TagUid U(uint8_t a, uint8_t b = 0, uint8_t c = 0, uint8_t d = 0) { TagUid u = {}; u.size = 4; u.bytes[0] = a; u.bytes[1] = b; u.bytes[2] = c; u.bytes[3] = d; return u; }
static void put(int reader, const TagUid& u) { fakePresent[reader] = true; fakeUid[reader] = u; }
static void remove(int reader) { fakePresent[reader] = false; }
// 位置（コード進行の順番）を指定して置く／外す。位置→リーダーは、board.cpp の表で決まる
static void putPos(int position, const TagUid& u) { put(boardReaderOfPosition(position), u); }
static void removePos(int position) { remove(boardReaderOfPosition(position)); }
static void registerTag(const TagUid& u, uint8_t chord) {
  for (int i = 0; i < regCount; i++) if (regs[i].uid.size == u.size && memcmp(regs[i].uid.bytes, u.bytes, u.size) == 0) { regs[i].chord = chord; return; }
  regs[regCount].uid = u; regs[regCount].chord = chord; regCount++;
}

int main() {
  const TagUid A = U(0x04, 0xA1, 1), B = U(0x04, 0xB2, 2), C = U(0x04, 0xC3, 3), D = U(0x04, 0xD4, 4), X = U(0x04, 0xEE, 9);
  registerTag(A, 1);   // Ⅰ
  registerTag(B, 2);   // Ⅵm
  registerTag(C, 3);   // Ⅳ
  registerTag(D, 4);   // Ⅴ

  // 位置とリーダーの対応
  eqi("位置数=リーダー数", NUM_POSITIONS, NUM_READERS);
  // 順番を逆にしてある: 位置1 = リーダー4、位置2 = リーダー3、位置3 = リーダー2、位置4 = リーダー1
  for (int p = 0; p < NUM_POSITIONS; p++) {
    // 先頭の4つは逆順（位置1 = リーダー4 …）、5つめ以降は配線順（位置5 = リーダー5 …）
    int want = p < 4 ? 3 - p : p;
    eqi("位置→リーダー（標準の配置）", boardReaderOfPosition(p), want);
    eqi("リーダー→位置（標準の配置）", boardPositionOfReader(want), p);
  }
  // リーダー3（0から数えて3）にだけ置くと、位置1に出る
  put(3, A);
  eqi("リーダー4にだけ置く → 位置1が駒あり", boardPosition(0).state, POS_CHORD);
  eqi("リーダー4にだけ置く → 位置4は空", boardPosition(3).state, POS_EMPTY);
  remove(3);
  eqi("範囲外の位置", boardReaderOfPosition(-1), -1);
  eqi("範囲外の位置2", boardReaderOfPosition(NUM_POSITIONS), -1);
  eqi("範囲外のリーダー", boardPositionOfReader(99), -1);

  // 何も置いていない
  for (int p = 0; p < NUM_POSITIONS; p++) {
    PositionInfo i = boardPosition(p);
    eqi("空: 状態", i.state, POS_EMPTY); eqi("空: コードは0", i.chordId, 0); eqi("空: 重複なし", i.duplicateOf, -1);
    eqi("空: boardChordId=0", boardChordId(p), 0);
  }

  // 位置1〜4に Ⅰ Ⅵm Ⅳ Ⅴ を置く（ユーザーが挙げた例）
  putPos(0, A); putPos(1, B); putPos(2, C); putPos(3, D);
  const uint8_t want[4] = {1, 2, 3, 4};
  for (int p = 0; p < 4; p++) {
    PositionInfo i = boardPosition(p);
    eqi("登録済み: 状態", i.state, POS_CHORD);
    eqi("登録済み: コードID", i.chordId, want[p]);
    eqi("登録済み: 重複なし", i.duplicateOf, -1);
    eqi("登録済み: UIDを持つ", i.uid.size, 4);
  }

  // 未登録のタグ: エラーとして区別できる。コードは 0（休み）
  putPos(2, X);
  { PositionInfo i = boardPosition(2); eqi("未登録: 状態", i.state, POS_UNREGISTERED); eqi("未登録: コードは0", i.chordId, 0); eqi("未登録: UIDは分かる", i.uid.bytes[1], 0xEE); }
  eqi("ほかの位置には影響しない", boardPosition(1).state, POS_CHORD);

  // 登録すると、すぐに反映される（コピーを持っていない）
  registerTag(X, 6);
  { PositionInfo i = boardPosition(2); eqi("登録後: 状態", i.state, POS_CHORD); eqi("登録後: コードID", i.chordId, 6); }
  // 再登録（別のコードに変更）も反映
  registerTag(X, 9);
  eqi("再登録後: コードID", boardChordId(2), 9);

  // 駒を交換する: 新しいUIDのコードになる
  putPos(0, D);
  eqi("交換: 位置1が Ⅴ に", boardChordId(0), 4);

  // 駒を外す: 空になる
  removePos(1);
  { PositionInfo i = boardPosition(1); eqi("外した: 空", i.state, POS_EMPTY); eqi("外した: コード0", i.chordId, 0); }

  // 同じタグを2つのリーダーが読んだ: 重複として見つける（どちらも、相手の位置を指す）
  putPos(0, D); putPos(3, D);
  eqi("重複: 位置1", boardPosition(0).duplicateOf, 3);
  eqi("重複: 位置4", boardPosition(3).duplicateOf, 0);
  eqi("重複でも、コードは取得できる", boardChordId(0), 4);
  eqi("重複していない位置は -1", boardPosition(2).duplicateOf, -1);
  // 片方が外れたら、重複は解消される
  removePos(0);
  eqi("重複の解消", boardPosition(3).duplicateOf, -1);
  // 空の位置どうしは「同じ」と見なさない
  removePos(3);
  eqi("空どうしは重複でない", boardPosition(2).duplicateOf, -1);

  // 全部空に戻す
  for (int r = 0; r < NUM_READERS; r++) remove(r);
  for (int p = 0; p < NUM_POSITIONS; p++) eqi("全部空", boardPosition(p).state, POS_EMPTY);

  printf("test_board: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
