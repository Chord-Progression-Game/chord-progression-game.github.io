#pragma once
#include <stdint.h>

#include "chords.h"        // Key
#include "reader_array.h"  // IdleMethod

// ============================================================
// このプロジェクト全体の設定（ピン番号・音の高さ・初期値）
//   ここを読めば、「どのGPIOに何をつないでいるか」が分かる。
//   リーダーごとの SDA(SS) と RST のピンは reader_array.cpp の表にある。
// ============================================================

// ---- RC522 全台で共有するSPIの線 ----
const int PIN_SCK  = 12;
const int PIN_MOSI = 11;
const int PIN_MISO = 13;

// ---- パッシブブザー（登録のときの合図だけに使う。ピアノの音は MIDI で出す）----
// GPIO14 は、カメラ・USB・PSRAM・起動設定などの特別な役目がない、ふつうの入出力ピン
const int PIN_BUZZER = 14;

// ブザーのピンが共有のSPIの線と重なっていたら、Build のときにエラーにする
// （リーダーごとのピンとの重なりは、起動時に setup() で確認する）
static_assert(PIN_BUZZER != PIN_MOSI && PIN_BUZZER != PIN_SCK && PIN_BUZZER != PIN_MISO,
              "PIN_BUZZER overlaps with an SPI pin");

// ---- RC522 の読み取り ----
// タグの返事を待つ時間（ms）。ライブラリの標準は25ms。実機（2026-10-14）で、5ms にすると 60回に1〜2回の読み損ないが出て、
// 10ms 以上だと安定した。余裕をとって 10ms にしてある（もっと短くしたいときは、x → t で、お手持ちの機材で確かめてから）
const uint8_t RC522_TIMEOUT_MS = 10;
// アンテナをONにしてから、最初の呼びかけまで待つ時間（ms）。タグが電波で目を覚ますのを待つ。5ms は余裕が少なかった
const uint8_t RC522_SETTLE_MS = 8;
// 読み取り1回にかかる最大の時間の目安（ms）。音を鳴らす／止める時刻がこれより近いときは、読み取りを見送る
const uint32_t SCAN_GUARD_MS = RC522_SETTLE_MS + 3 * RC522_TIMEOUT_MS + 12;
// 使っていないリーダーの止め方と、受信感度（dB）の初期値。本体に保存した設定があれば、そちらが優先される
//   止め方: IDLE_RESET = RSTをLOWにして、チップごと止める（電波も、発振も止まる） / IDLE_ANTENNA_OFF = 電波だけ止める
const IdleMethod DEFAULT_IDLE_METHOD = IDLE_RESET;
const uint8_t DEFAULT_RX_GAIN_DB = 33;

// ---- 音の高さ（MIDIノート番号。60 = 真ん中のド）----
// ブザー用: 72 = C5（高いド）。ブザーは低い音が出にくいので高めにする
const uint8_t BUZZER_BASE_C = 72;
// ピアノ用の基準: 48 = C3（高さ 0 のとき、Ⅰ = C3 E3 G3 C4）。実際の高さは、「高さ」（OCTAVE コマンド・操作画面）で 12 ずつ上げ下げする。
// 高さ 0 だと、GarageBand のピアノでは低くこもって聞こえたので、標準を +1（ルートが C4〜B4）にしてある
const uint8_t PIANO_BASE_C = 48;
const int OCTAVE_MIN = -1;
const int OCTAVE_MAX = 3;
const int DEFAULT_OCTAVE = 1;

// ---- 電源を入れたときの動き（本体に保存した設定があれば、そちらが優先される）----
// 駒が1つもなくても、ドラムのリズムが流れているように、標準を「ドラムあり」にしてある
const int DEFAULT_DRUM_ID = 2;                  // 標準のドラム: 2 = 8ビート
const int DEFAULT_BACKING_ID = 1;               // 標準のバッキング: 1 = ロング（1ステップ1和音）
const bool DEFAULT_AUTOSTART = false;           // 電源を入れたとき、自動で再生を始めるか。2026-11-14 から標準 OFF（停止で始まる。音はゲームが担当するので、GarageBand などで勝手に鳴らない）。AUTOSTART ON で戻せる
const uint32_t SETTINGS_SAVE_DELAY_MS = 3000;   // BPM・キーは、変えてから、この時間、変えなければ保存する（スライダーで動かしている間は保存しない）

// ---- MIDI ----
const uint8_t MIDI_CHANNEL_PIANO = 0;  // ピアノ（バッキング）のMIDIチャンネル。0 = チャンネル1
const uint8_t MIDI_CHANNEL_DRUMS = 9;  // ドラムのMIDIチャンネル。9 = チャンネル10（GMのドラムは、チャンネル10）
const uint8_t MIDI_PROGRAM_PIANO = 0;  // 0 = Acoustic Grand Piano（将来、音色の切り替えをここに足す）
const uint8_t MIDI_VELOCITY = 80;      // ピアノの音の強さ（1〜127）。弱い音は、groove.h の GrooveSettings で決まる

// ---- いまのキー（調）。今回は Key=C 固定。将来、ここを変えるとキー変更になる ----
extern Key currentKey;
