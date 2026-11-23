#pragma once
#include <stddef.h>
#include <stdint.h>

// ============================================================
// 音源への出力（MIDI OUT）
//
//   どんな方法で音源に送るか（出力先）を切り替えられる。コード進行を作る側は、出力先を気にしない。
//     なし      … 何も送らない（画面に表示するだけ）。音源をつないでいないときの練習用
//     ブリッジ  … ESP32 の USB（UART側のポート）でPCに文字として送る。PCで tools/midi_bridge.py を動かすと、
//                 PCの音源（GarageBand など）で鳴る。追加の機材は不要
//     USB       … ESP32-S3 の「USB」側のポートを、MIDI機器としてPCに見せる。PCは自動で認識する
//   将来は「DIN-5のMIDI端子」や「音源モジュール」への出力も、ここに足す。
// ============================================================

enum MidiBackend : uint8_t {
  MIDI_BACKEND_NONE,
  MIDI_BACKEND_BRIDGE,
  MIDI_BACKEND_USB
};

void midiBegin();

// 出力先を切り替える。USB を始められなかったときは false（出力先は「なし」のまま）
bool midiSetBackend(MidiBackend backend);
MidiBackend midiBackend();
const char* midiBackendName();  // 画面に出す名前
bool midiUsbMounted();          // USB出力のとき、PCに認識されているか

// 完成した MIDI メッセージ（ノートオン・ノートオフなど、1つ以上）を、1回にまとめて送る。
// 同じ時刻の音は、まとめて送ると、ほぼ同時に鳴る
void midiSendMessages(const uint8_t* bytes, size_t len);
void midiProgramChange(uint8_t channel, uint8_t program);  // 音色（0 = ピアノ）。ドラム（チャンネル10）には不要
void midiAllNotesOff(uint8_t channel);                      // 鳴っている音をすべて止める（安全のため）
