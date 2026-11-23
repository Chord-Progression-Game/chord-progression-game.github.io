#pragma once
#include "tag_store.h"  // TagUid

// 画面表示や入力の読み取りで、あちこちから使う小さな部品

// UID を16進数で表示する（例: 04 A3 2B 1C）。改行はしない
void printUidBytes(const TagUid& uid);

// 文字列の前後の空白を取り除く（line の中身を書き換えて、先頭へのポインタを返す）
char* trimInPlace(char* s);

// 1文字だけの入力か（大文字小文字は区別しない）。line は trim 済みであること
bool isSingleCharCommand(const char* line, char command);
