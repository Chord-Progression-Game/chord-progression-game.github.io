#pragma once
#include "reader_array.h"  // TagUid
#include "tag_store.h"

// ============================================================
// タグの登録の操作画面（Serial Monitor で番号を入力して、タグにコードを登録する）
//   ESP32_FirstTest の1台版から引き継いだ機能。動作は同じで、どのリーダーにタグを置いても使える。
//   ・未登録のタグ  → コードの一覧を表示して、番号の入力を待つ
//   ・登録済みのタグ → 登録されているコードを表示して、ブザーで鳴らし、再登録するか(y/n)確認する
//   コード進行の再生中（START のあいだ）は使わない。STOP すると、この画面に戻る。
// ============================================================

void registerUiBegin();                                   // タグ待ちの案内を表示する
void registerUiOnTag(int readerIndex, const TagUid& tag); // リーダーにタグが置かれた
void registerUiHandleLine(const char* line);              // 1行の入力（l / t / x / y / n / 番号）
void registerUiCancelPrompt();                            // y/n や番号の入力待ちをやめる（案内は表示しない）
void registerUiPrintList();                               // 登録一覧を表示する
