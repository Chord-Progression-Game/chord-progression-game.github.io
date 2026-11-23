#pragma once
#include <stddef.h>
#include <stdint.h>

// ============================================================
// USB-MIDI（ESP32-S3 の「USB」側のポートを、MIDI機器としてPCに見せる）
//   このボードの Arduino core 2.0.17 には、USB-MIDI の部品（TinyUSB）が入っている。
//   追加のライブラリは使わない。
//   ※ USB の設定は、電源を入れたあと1回しか決められない。いちど始めたら、リセットするまで続く。
// ============================================================

// USB-MIDI を始める（2回目以降は何もしない）。使えない環境なら false
bool usbMidiBegin(const char* deviceName);

bool usbMidiStarted();   // begin 済みか
bool usbMidiMounted();   // PCにつながって、MIDI機器として認識されているか

// 完成した MIDI メッセージ（1つ以上）を送る。PCにつながっていなければ、捨てる
void usbMidiWrite(const uint8_t* bytes, size_t len);
