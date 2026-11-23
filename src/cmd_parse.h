#pragma once
#include <stddef.h>

// ============================================================
// コマンドの文字を読む、小さな部品（Arduino に依存しない。パソコンの上でもテストできる）
//
//   例:  "BPM +5"  → 名前 "BPM"、引数 "+5"
//        "drum set 11 K x...x..."  → 名前 "DRUM"、引数 "set 11 K x...x..."
// ============================================================

// 先頭の英字（A〜Z, a〜z）を、大文字にして name に入れる。引数（名前のあと、空白と = を飛ばした残り）の
// 先頭へのポインタを返す。名前が空（英字で始まらない）、または長すぎるときは nullptr
const char* cmdSplitName(const char* line, char* name, size_t nameSize);

// *cursor から、空白で区切った次の1語を取り出して token に入れ、*cursor を進める。なければ false。
// token が小さくて入りきらないときは、入る分だけ入れる（残りは捨てる）
bool cmdNextToken(const char** cursor, char* token, size_t tokenSize);

// *cursor の、残りの全部（前後の空白は取り除く）を text に入れる。空なら false
bool cmdRest(const char* cursor, char* text, size_t textSize);

// 整数を読む。"120" "+5" "-3"。余計な文字があれば false。先頭が + か - のとき relative が true
bool cmdParseInt(const char* text, long* value, bool* relative);

bool cmdIsAllDigits(const char* text);   // 数字だけか（空は false）
void cmdToUpper(char* text);              // 英字を大文字にする（日本語などは、そのまま）
