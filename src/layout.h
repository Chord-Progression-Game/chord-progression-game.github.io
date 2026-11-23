#pragma once
#include <stdint.h>

// ============================================================
// 位置とリーダーの対応（「配置」）
//
//   位置 1, 2, 3 ... = コード進行の順番。上段の左から 位置1〜4、下段の左から 位置5〜8（4×2 に並べるとき）。
//   リーダー 1, 2, 3 ... = 配線した RC522（reader_array.cpp のピン表の順）。
//   この2つの対応は、並べ方で変わるので、あとから変えられる（MAP コマンド・操作画面）。本体に保存される。
//
//   Arduino に依存しない（パソコンの上でもテストできる）。
// ============================================================

const int LAYOUT_MAX = 8;

class Layout {
 public:
  explicit Layout(int count);

  int count() const { return count_; }
  // 位置 → その位置を読むリーダー（0から数える）。範囲外は -1
  int readerOfPosition(int position) const;
  // リーダー → そのリーダーが読む位置。範囲外は -1
  int positionOfReader(int reader) const;

  // 初期の対応: 先頭の4つは逆順（位置1 = リーダー4 … 位置4 = リーダー1）、5つめ以降は配線順（位置5 = リーダー5 …）
  void reset();
  // readers[position] = リーダー番号（0から数える）。0〜count-1 を1回ずつ使った並べ替えでなければ、採用せず false
  bool set(const uint8_t* readers, int n);
  void get(uint8_t* out) const;                      // いまの対応（count 個）

  // ---- 学習: 位置1から順に、駒を置いていくと、どのリーダーかを覚える ----
  void learnBegin();
  bool learning() const { return learning_; }
  int learnNextPosition() const { return learnNext_; }   // 次に駒を置いてもらう位置（0から数える）
  enum LearnResult {
    LEARN_IGNORED,     // 学習中でない／すでに覚えたリーダー
    LEARN_ASSIGNED,    // 覚えた
    LEARN_COMPLETE     // 最後の位置まで覚えた（学習は終わった）
  };
  // 学習中に、リーダー reader に駒が置かれた
  LearnResult learnPlaced(int reader);
  // 途中で終える: まだ決まっていない位置には、使っていないリーダーを、小さい番号から入れる
  void learnFinish();
  // やめる: 学習を始める前の対応に戻す
  void learnCancel();

 private:
  int count_;
  uint8_t map_[LAYOUT_MAX];        // position → reader
  uint8_t backup_[LAYOUT_MAX];     // 学習を始める前の対応
  bool learning_;
  int learnNext_;
  bool used_[LAYOUT_MAX];
};
