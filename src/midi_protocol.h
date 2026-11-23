#pragma once
#include <stddef.h>
#include <stdint.h>

// ============================================================
// MIDI メッセージの作り方と、PC（ブリッジ）へ送る1行の形式
//   Arduino に依存しない（パソコンの上でもテストできる）。
//
//   ブリッジ用の1行:  "~M 90 30 50 90 34 50 \n"
//     先頭の "~M " は目印。そのあとに MIDI のバイトを16進数で並べる。
//     PC側の tools/midi_bridge.py が、この行を読んで本物のMIDIに変換する。
//     ふつうの表示（日本語のメッセージ）と混ざっても見分けられる。
// ============================================================

const size_t MIDI_BRIDGE_PREFIX_LEN = 3;  // "~M "

// MIDIチャンネルは 0〜15（MIDIのチャンネル1〜16）。戻り値は out に書いたバイト数
size_t midiBuildNoteOn(uint8_t channel, uint8_t note, uint8_t velocity, uint8_t* out);  // 3バイト
size_t midiBuildNoteOff(uint8_t channel, uint8_t note, uint8_t* out);                   // 3バイト
size_t midiBuildProgramChange(uint8_t channel, uint8_t program, uint8_t* out);          // 2バイト
size_t midiBuildAllNotesOff(uint8_t channel, uint8_t* out);                             // 3バイト（CC123）

// bytes[0..len) を、ブリッジ用の1行（改行つき）にする。戻り値は out に書いた文字数（'\0' は含まない）。
// out が小さくて入りきらないときは 0 を返す。必要な大きさは 3 + len*3 + 1 + 1
size_t midiFormatBridgeLine(const uint8_t* bytes, size_t len, char* out, size_t outSize);
