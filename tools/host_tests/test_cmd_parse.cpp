// cmd_parse.cpp のパソコン上テスト
//   実行: tools/host_tests/run_all.sh
#include "cmd_parse.h"

#include <stdio.h>
#include <string.h>

#include <string>

static int fails = 0, checks = 0;
static void eqi(const std::string& w, long long g, long long e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got %lld want %lld\n", w.c_str(), g, e); }
}
static void eqs(const std::string& w, const std::string& g, const std::string& e) {
  checks++;
  if (g != e) { fails++; printf("FAIL %s: got [%s] want [%s]\n", w.c_str(), g.c_str(), e.c_str()); }
}

int main() {
  char name[12];
  const char* arg;
  arg = cmdSplitName("BPM 120", name, sizeof name);   eqs("名前", name, "BPM"); eqs("引数", arg ? arg : "(null)", "120");
  arg = cmdSplitName("bpm 90", name, sizeof name);    eqs("小文字も大文字に", name, "BPM"); eqs("引数", arg, "90");
  arg = cmdSplitName("Bpm=100", name, sizeof name);   eqs("=", name, "BPM"); eqs("= のあと", arg, "100");
  arg = cmdSplitName("BPM30", name, sizeof name);     eqs("くっついた数字", name, "BPM"); eqs("引数", arg, "30");
  arg = cmdSplitName("  start  ", name, sizeof name); eqs("前の空白", name, "START"); eqs("後ろは残る", arg, "");
  arg = cmdSplitName("BPM +5", name, sizeof name);    eqs("符号", arg, "+5");
  arg = cmdSplitName("BPM -5", name, sizeof name);    eqs("符号 -", arg, "-5");
  arg = cmdSplitName("drum set 11 K x...x...", name, sizeof name); eqs("長い引数", name, "DRUM"); eqs("引数", arg, "set 11 K x...x...");
  arg = cmdSplitName("DRUM NAME 11 マイ8ビート", name, sizeof name); eqs("日本語の引数", arg, "NAME 11 マイ8ビート");
  eqi("数字で始まる行は、コマンドではない", cmdSplitName("12", name, sizeof name) == nullptr, 1);
  eqi("空の行は、コマンドではない", cmdSplitName("", name, sizeof name) == nullptr, 1);
  eqi("記号で始まる行は、コマンドではない", cmdSplitName("+5", name, sizeof name) == nullptr, 1);
  eqi("日本語で始まる行は、コマンドではない", cmdSplitName("あ", name, sizeof name) == nullptr, 1);
  eqi("長すぎる名前は、コマンドではない", cmdSplitName("ABCDEFGHIJKLMNOP x", name, sizeof name) == nullptr, 1);
  eqi("nullptr", cmdSplitName(nullptr, name, sizeof name) == nullptr, 1);
  arg = cmdSplitName("y", name, sizeof name); eqs("1文字", name, "Y");

  // トークン
  const char* c = "set 11  K   x...x...";
  char tok[32];
  eqi("1語目", cmdNextToken(&c, tok, sizeof tok), 1); eqs("set", tok, "set");
  eqi("2語目", cmdNextToken(&c, tok, sizeof tok), 1); eqs("11", tok, "11");
  eqi("3語目", cmdNextToken(&c, tok, sizeof tok), 1); eqs("K", tok, "K");
  eqi("4語目", cmdNextToken(&c, tok, sizeof tok), 1); eqs("x...x...", tok, "x...x...");
  eqi("もうない", cmdNextToken(&c, tok, sizeof tok), 0);
  const char* c2 = "   ";
  eqi("空白だけ", cmdNextToken(&c2, tok, sizeof tok), 0);
  const char* c3 = "abcdefghij klm";
  char small[5];
  eqi("小さいバッファ", cmdNextToken(&c3, small, sizeof small), 1); eqs("入る分だけ", small, "abcd");
  eqi("次の語は、続きから", cmdNextToken(&c3, tok, sizeof tok), 1); eqs("klm", tok, "klm");
  // タブも区切り
  const char* c4 = "a\tb"; cmdNextToken(&c4, tok, sizeof tok); eqs("タブの前", tok, "a"); cmdNextToken(&c4, tok, sizeof tok); eqs("タブの後", tok, "b");

  // 残り全部
  const char* r = "マイ ドラム  パターン  ";
  char text[40];
  eqi("残り", cmdRest(r, text, sizeof text), 1); eqs("前後の空白を取る", text, "マイ ドラム  パターン");
  eqi("空", cmdRest("   ", text, sizeof text), 0);
  char tiny[8]; cmdRest("abcdefghijkl", tiny, sizeof tiny); eqs("入りきらないときは切る", tiny, "abcdefg");
  // 名前のあとの残り
  const char* cur = "11 マイ8ビート"; cmdNextToken(&cur, tok, sizeof tok); eqs("id", tok, "11");
  eqi("名前の部分", cmdRest(cur, text, sizeof text), 1); eqs("名前", text, "マイ8ビート");

  // 数字
  long v; bool rel;
  eqi("120", cmdParseInt("120", &v, &rel), 1); eqi("値", v, 120); eqi("絶対", rel, 0);
  eqi("+5", cmdParseInt("+5", &v, &rel), 1); eqi("値", v, 5); eqi("相対", rel, 1);
  eqi("-5", cmdParseInt("-5", &v, &rel), 1); eqi("値", v, -5); eqi("相対", rel, 1);
  eqi("0", cmdParseInt("0", &v, &rel), 1); eqi("値", v, 0);
  eqi("abc は失敗", cmdParseInt("abc", &v, &rel), 0);
  eqi("12abc は失敗", cmdParseInt("12abc", &v, &rel), 0);
  eqi("符号だけは失敗", cmdParseInt("+", &v, &rel), 0);
  eqi("空は失敗", cmdParseInt("", &v, &rel), 0);
  eqi("小数は失敗", cmdParseInt("1.5", &v, &rel), 0);
  eqi("全角数字は失敗", cmdParseInt("１２０", &v, &rel), 0);
  eqi("大きすぎる数は失敗", cmdParseInt("99999999999999999999", &v, &rel), 0);
  eqi("++5 は失敗", cmdParseInt("++5", &v, &rel), 0);
  eqi("nullptr は失敗", cmdParseInt(nullptr, &v, &rel), 0);
  eqi("relative が nullptr でもよい", cmdParseInt("7", &v, nullptr), 1);
  eqi("数字だけ", cmdIsAllDigits("123") && !cmdIsAllDigits("12a") && !cmdIsAllDigits("") && !cmdIsAllDigits("-1"), 1);

  // 大文字化
  char up[32]; strcpy(up, "off Eb マイ"); cmdToUpper(up); eqs("日本語はそのまま", up, "OFF EB マイ");

  printf("test_cmd_parse: checks=%d fails=%d\n", checks, fails);
  return fails != 0;
}
