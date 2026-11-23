#pragma once
#include "rhythm.h"

// ============================================================
// リズムのパターンの置き場
//   ・プリセット（ID 1〜10）: 最初から入っている。変更できない。
//   ・ユーザーのスロット（ID 11〜20）: 自分で作って、保存できる。電源を切っても残る（NVS）。
//   ドラムとバッキングは、別々の置き場（ID は、それぞれ別に数える）。
// ============================================================

// 起動時に1回呼ぶ。保存してあるユーザーのパターンを読み込む。壊れていて読めなかった数を返す
int rhythmStoreBegin(const char* nvsNamespace = "rhythm");

// IDからパターンを探す（プリセットも、ユーザーのスロットも）。なければ nullptr
const DrumPattern* rhythmDrum(int id);
const BackingPattern* rhythmBacking(int id);

// 編集用。ユーザーのスロット（11〜20）だけ。まだないスロットは、create が true なら、空のパターンを作る
DrumPattern* rhythmDrumForEdit(int id, bool create);
BackingPattern* rhythmBackingForEdit(int id, bool create);

// 編集した内容を保存する。成功したら true
bool rhythmSaveDrum(int id);
bool rhythmSaveBacking(int id);

// ユーザーのスロットを削除する（保存データも消す）
bool rhythmDeleteDrum(int id);
bool rhythmDeleteBacking(int id);
