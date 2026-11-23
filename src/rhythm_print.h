#pragma once
#include "rhythm.h"

// リズムのパターンを、Serial Monitor に見やすく表示する

// ものさし（拍の位置）。例: 16マスなら  1...2...3...4...
void rhythmPrintRuler(int length);

// ドラム。音のあるレーンだけを、1行ずつ表示する
void rhythmPrintDrumPattern(int id, const DrumPattern& pattern);

// バッキング。文字の意味は、HELP や README を見る
void rhythmPrintBackingPattern(int id, const BackingPattern& pattern);
