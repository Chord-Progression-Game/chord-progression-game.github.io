// layout.cpp（位置とリーダーの対応・学習）のパソコン上テスト
//   実行: tools/host_tests/run_all.sh
#include "layout.h"

#include <stdio.h>

#include <string>

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}
static std::string mapText(const Layout& l) {
  uint8_t m[LAYOUT_MAX];
  l.get(m);
  std::string s;
  for (int p = 0; p < l.count(); p++) s += std::to_string(m[p]);
  return s;
}

int main() {
  // 初期の対応
  Layout l8(8), l4(4), l6(6), l2(2);
  eqi("8台の初期: 先頭4つは逆順、あとは配線順", mapText(l8) == "32104567", 1);
  eqi("4台の初期: 逆順", mapText(l4) == "3210", 1);
  eqi("6台の初期", mapText(l6) == "321045", 1);
  eqi("2台の初期", mapText(l2) == "10", 1);
  eqi("位置→リーダー", l8.readerOfPosition(0), 3);
  eqi("位置5 → リーダー5(=4)", l8.readerOfPosition(4), 4);
  eqi("リーダー→位置", l8.positionOfReader(3), 0);
  eqi("リーダー8(=7) → 位置8", l8.positionOfReader(7), 7);
  eqi("範囲外", l8.readerOfPosition(8) + l8.readerOfPosition(-1) + l8.positionOfReader(8) + l8.positionOfReader(-1), -4);
  for (int p = 0; p < 8; p++) eqi("往復 " + std::to_string(p), l8.positionOfReader(l8.readerOfPosition(p)), p);

  // 手動の指定
  const uint8_t good[8] = {0, 1, 2, 3, 7, 6, 5, 4};
  eqi("並べ替えを採用", l8.set(good, 8), 1);
  eqi("採用した内容", mapText(l8) == "01237654", 1);
  eqi("位置5 = リーダー8(=7)", l8.readerOfPosition(4), 7);
  const uint8_t dup[8] = {0, 1, 2, 3, 4, 5, 6, 6};
  eqi("重複は拒否", l8.set(dup, 8), 0);
  const uint8_t big[8] = {0, 1, 2, 3, 4, 5, 6, 8};
  eqi("範囲外は拒否", l8.set(big, 8), 0);
  eqi("数が違うと拒否", l8.set(good, 7), 0);
  eqi("拒否されたら、変わらない", mapText(l8) == "01237654", 1);
  l8.reset();
  eqi("reset で初期に戻る", mapText(l8) == "32104567", 1);

  // 学習: 位置1から順に、駒を置く
  Layout l(8);
  l.learnBegin();
  eqi("学習中", l.learning(), 1);
  eqi("次は位置1", l.learnNextPosition(), 0);
  eqi("リーダー8(=7) に置く → 位置1", l.learnPlaced(7), Layout::LEARN_ASSIGNED);
  eqi("位置1 = リーダー8", l.readerOfPosition(0), 7);
  eqi("同じリーダーに、もう一度置いても無視", l.learnPlaced(7), Layout::LEARN_IGNORED);
  eqi("範囲外のリーダーは無視", l.learnPlaced(9) + l.learnPlaced(-1), 0);
  eqi("次は位置2", l.learnNextPosition(), 1);
  eqi("リーダー1(=0) → 位置2", l.learnPlaced(0), Layout::LEARN_ASSIGNED);
  // 途中で終える: 残りは、使っていないリーダーを小さい番号から
  l.learnFinish();
  eqi("終えた", l.learning(), 0);
  eqi("残りを小さい番号から（位置1=8, 位置2=1, 位置3..=2,3,4,5,6,7）", mapText(l) == "70123456", 1);

  // 最後まで学習
  Layout m(4);
  m.learnBegin();
  eqi("1つ目", m.learnPlaced(0), Layout::LEARN_ASSIGNED);
  eqi("2つ目", m.learnPlaced(1), Layout::LEARN_ASSIGNED);
  eqi("3つ目", m.learnPlaced(2), Layout::LEARN_ASSIGNED);
  eqi("4つ目で完了", m.learnPlaced(3), Layout::LEARN_COMPLETE);
  eqi("完了したら学習は終わり", m.learning(), 0);
  eqi("学習した並び（配線順 = 位置順）", mapText(m) == "0123", 1);
  eqi("学習が終わったあとの置き方は無視", m.learnPlaced(0), Layout::LEARN_IGNORED);

  // 取り消し: もとの対応に戻る
  Layout c(8);
  const uint8_t before[8] = {1, 0, 3, 2, 5, 4, 7, 6};
  c.set(before, 8);
  c.learnBegin();
  c.learnPlaced(5);
  c.learnPlaced(6);
  eqi("学習中は、途中の対応になる", c.readerOfPosition(0), 5);
  c.learnCancel();
  eqi("取り消し: もとに戻る", mapText(c) == "10325476", 1);
  eqi("取り消し: 学習は終わり", c.learning(), 0);
  // 学習中に set / reset すると、学習は終わる
  c.learnBegin();
  c.reset();
  eqi("reset で学習も終わる", c.learning(), 0);

  // 台数が範囲外のとき
  Layout z(0), y(99);
  eqi("0台 → 1台", z.count(), 1);
  eqi("99台 → 8台", y.count(), 8);

  printf("test_layout: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
