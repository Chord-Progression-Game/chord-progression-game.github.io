#pragma once
#include <stddef.h>
#include <stdint.h>

// ============================================================
// コードの定義と、キー(調)から実際の音を求める計算
//
//   NFCタグ → コードID → ディグリー＋コードタイプ → (Key) → ルート音 → 構成音 → ブザー / MIDI
//
// NFCタグには「C」などの音名ではなく、コードID(＝ディグリー＋コードタイプ)を結びつける。
// 実際の音は、いまのKeyを使って、そのたびに計算して求める。
// このファイルはArduino/ESP32に依存しない（パソコン上でもテストできる）。
// ============================================================

// 音名の番号: C=0 D=1 E=2 F=3 G=4 A=5 B=6
// 変化記号:   ♭=-1  なし=0  #=+1

// キー(調)。主音を「音名＋変化記号」で表す。例: C=(0,0)  D=(1,0)  E♭=(2,-1)
struct Key {
  uint8_t letter;
  int8_t accidental;
};

extern const Key KEY_C;  // Key = C

// コードの種類。構成音のインターバルは chords.cpp で定義している
enum ChordType : uint8_t {
  CT_MAJOR,   // (なし)  例: Ⅰ
  CT_MINOR,   // m       例: Ⅵm
  CT_MAJ7,    // M7      例: ⅠM7
  CT_DOM7,    // 7       例: Ⅴ7
  CT_MIN7,    // m7      例: Ⅱm7
  CT_MIN7B5,  // m7-5    例: Ⅶm7-5
  CT_DIM7,    // dim7    例: Ⅴ#dim7
  CT_MIN6,    // m6      例: Fm6
  CT_SUS47,   // sus47   例: Ⅴsus47
  CT_SUS4,    // sus4    例: Ⅵsus4（3和音。2026-11-17 に追加）
  CT_REPEAT,  // →       「前のコマと同じコードを鳴らす」特別な駒（音は持たない）
  CT_TYPE_COUNT
};

// 特別な駒「→」のコードID。前のコマと同じコードを鳴らす（意味は player / groove が決める）
const uint8_t CHORD_ID_REPEAT = 99;
// メニューで「特殊」と表示するレベル番号（ふつうのコードは 1〜5）
const uint8_t CHORD_LEVEL_SPECIAL = 6;

const uint8_t MAX_CHORD_NOTES = 4;  // 1つのコードの音数。どのコードも4音（3和音は、4音目にルートのオクターブ上）

// 登録候補のコード1つ分
struct Chord {
  uint8_t id;          // コードID。NVSに保存される番号なので、変更禁止（メニューの並び順とは無関係）
  uint8_t level;       // レベル 1〜5。6 は特殊（→）
  const char* name;    // 表示名（UTF-8）
  uint8_t degree;      // ディグリー 1〜7（Ⅰ〜Ⅶ）。0 のときは絶対音名のコード（Keyで変わらない）
  int8_t accidental;   // ルートの変化記号（♭=-1 / なし=0 / #=+1）
  uint8_t absLetter;   // 絶対音名コードのルートの音名。degree が 0 のときだけ使う
  ChordType type;      // コードタイプ
};

bool chordIsRepeat(const Chord& chord);  // 「→」の駒か（音を持たず、前のコードを繰り返す）

int chordCount();                       // コードの総数
const Chord& chordAt(int index);        // 0〜chordCount()-1 番目のコード
const Chord* chordById(uint8_t id);     // IDからコードを探す。見つからなければ nullptr

// ルート音の高さ (C=0 ... B=11)
uint8_t chordRootPitchClass(const Chord& chord, const Key& key);

// 鳴らす音を MIDI ノート番号で求める（ルートから順に低→高）。戻り値は音の数。
// 3和音のコードは、octaveForTriads が true（標準）のとき、4音目にルートのオクターブ上が入って4音になる。
// false にすると、3和音は3音のまま（例: Ⅰ = C E G）。7thなどのコードは、どちらでも4音。
// baseC は「ルートを置く音域のC」のMIDIノート番号（例: 72 = C5）
uint8_t chordMidiNotes(const Chord& chord, const Key& key, uint8_t baseC, uint8_t* notes,
                       bool octaveForTriads = true);

// 表示用の文字列を作る。chordNoteNames は、chordMidiNotes と同じ並びの音名（例: "C E G C"）
void chordSymbol(const Chord& chord, const Key& key, char* buf, size_t size);      // 例: "G7"
void chordNoteNames(const Chord& chord, const Key& key, char* buf, size_t size,    // 例: "G B D F"
                    bool octaveForTriads = true);
void keyName(const Key& key, char* buf, size_t size);                              // 例: "C"

// ---- キー（調）の扱い ----
uint8_t keyPitchClassOf(const Key& key);                  // 主音の高さ（C=0 ... B=11）
Key keyFromPitchClass(int pitchClass);                    // 高さ → ふつうの綴りのキー（C D♭ D E♭ E F F# G A♭ A B♭ B）
Key keyTranspose(const Key& key, int semitones);          // 半音で上げ下げする（ふつうの綴りで返す）
// 文字から読み取る。"D" "Eb" "F#" "bb" "B♭" "c" など（大文字小文字はどちらでもよい。変化記号は # ♯ b ♭）。
// 読めなければ false（key は変えない）
bool parseKeyName(const char* text, Key* key);
