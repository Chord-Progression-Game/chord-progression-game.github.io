#pragma once
#include <stdint.h>

// パッシブブザーを鳴らす（ESP32のPWM機能 LEDC を使う）

// 起動時に1回呼ぶ。pin はブザーをつないだGPIO番号
void buzzerBegin(int pin);

// MIDIノート番号の音を、順番に1音ずつ鳴らす（アルペジオ）。最大 8 音。
// 待たずに、すぐ戻る（鳴らしている間も、駒の読み取りなどが止まらない）。続きは buzzerTick() が進める。
// 鳴っている途中で呼ぶと、前の音は止めて、新しいアルペジオを始める
void buzzerPlayArpeggio(const uint8_t* midiNotes, uint8_t count);

// loop() のたびに呼ぶ。次の音へ進める・音と音のすき間を作る・鳴り終わったら無音にする
void buzzerTick();

// いま鳴っているか
bool buzzerBusy();

// 駒の読み取りを見送るべきか: ブザーが鳴っている間と、鳴り終わった直後（BUZZER_SETTLE_MS）は、true。
// ブザーを鳴らしている間に RC522 を読むと、電気的なノイズで読み取りが連続で失敗して、動かしていない駒が「外れた」と誤判定されることが、
// 実機で確認された（2026-11-15）。そこで、鳴っている間は、読まない（読み取り以外の処理は、止めない）
bool buzzerHoldsReads();
