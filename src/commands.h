#pragma once

#include "reader_array.h"  // ReaderEvent

// ============================================================
// ターミナル（Serial Monitor）から打つコマンド
//
//   START / STOP / STATUS / HELP
//   BPM 120 / BPM +5 / BPM -5          … BPM（再生中でも、すぐに変わる）
//   KEY D / KEY Eb / KEY +1 / KEY -1   … キー（再生中でも、すぐに変わる）
//   LEAD ON|OFF / VOICING 3|4          … 和音の高さ・音の数
//   DRUM ... / BACKING ... / GROOVE    … ドラムとバッキングのパターン（別々に選べる・自分で作れる）
//   MIDI BRIDGE|USB|OFF                … 音の出力先
//   IDLE OFF|RESET / GAIN 23           … RC522 の止め方・受信感度
//   大文字・小文字はどちらでもよい（start でも START でも同じ）。
//
//   1文字で、すぐに変えるキー（Enter なし）: +  -（BPM を ±5）、 ]  [（キーを ±1 半音）
//
//   VS Code の PlatformIO の Serial Monitor は、VS Code のターミナルの1つで、打った文字をそのまま ESP32 に送る。
//   ブリッジ（tools/midi_bridge.py）を使うときは、そのターミナルに打つ。
// ============================================================

// 1行の入力（前後の空白は取り除いてあること）をコマンドとして処理する。
// コマンドだった（処理した）ときは true。コマンドではないときは false（登録の画面などが処理する）
bool commandsHandle(const char* line);

// 1文字で、すぐに効くキー（+ - [ ]）。処理したら true。Enter は不要
bool commandsHotkey(char c);

// 「配置を覚えさせる」（MAP LEARN）の最中に、リーダーで起きた出来事を使う。使ったら true
bool commandsLayoutLearnEvent(const ReaderEvent& event);

// 操作画面用: 駒が置かれた・外れたなど、盤面が変わった直後に呼ぶ。STATE の行（~S）を、すぐに出す
// （画面が約0.7秒おきの問い合わせで気づくのを待たない）。音の出力先が「なし」のときは出さない
void commandsPushState();

// 診断の表示（SHADOWLOG ON のとき、影の判定の結果を表示する）。ループのたびに呼ぶ
void commandsPollDiagnostics();

void commandsPrintHelp();
void commandsPrintRhythmHelp();
