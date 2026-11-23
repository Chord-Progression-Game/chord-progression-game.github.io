#pragma once
#include <stdint.h>

#include "chords.h"        // Key
#include "reader_array.h"  // IdleMethod

// ============================================================
// 本体に保存する設定（電源を切っても残る）
//   ・リーダーの止め方（アンテナOFF / RESET）
//   ・受信感度（dB）
//   ・和音の高さ、位置とリーダーの対応
//   ・再生の設定: ドラム・バッキング・BPM・キー、電源を入れたときの自動再生
//   タグの登録（tag_store）や、リズムのパターン（rhythm_store）とは、別の保存場所。
// ============================================================

void settingsBegin(const char* nvsNamespace = "settings");

// 保存してある値を返す。保存がない・壊れているときは、defaultValue
IdleMethod settingsLoadIdleMethod(IdleMethod defaultValue);
uint8_t settingsLoadGainDb(uint8_t defaultDb);

// 和音の高さ（オクターブ。OCTAVE_MIN〜OCTAVE_MAX）。保存がない・範囲外のときは defaultValue
int settingsLoadOctave(int defaultValue);
bool settingsSaveOctave(int octave);

// 位置とリーダーの対応（位置ごとのリーダー番号。0から数える）。n 個ぶんの保存があれば true
bool settingsLoadMap(uint8_t* out, int n);
bool settingsSaveMap(const uint8_t* map, int n);

// 保存する（成功したら true）
bool settingsSaveIdleMethod(IdleMethod method);
bool settingsSaveGainDb(uint8_t db);

// ---- 再生の設定（電源を入れたときに、前回の続きから始まるように）----
// ドラム・バッキングのパターンの番号（0 = なし）。保存がないときは defaultId。同じ値なら、書き込まない（フラッシュを減らさない）
int settingsLoadDrum(int defaultId);
bool settingsSaveDrum(int id);
int settingsLoadBacking(int defaultId);
bool settingsSaveBacking(int id);
// BPM（30〜240）
int settingsLoadBpm(int defaultBpm);
bool settingsSaveBpm(int bpm);
// キー。保存があれば true（out に入れる）
bool settingsLoadKey(Key* out);
bool settingsSaveKey(const Key& key);
// 電源を入れたら自動で再生を始めるか
bool settingsLoadBuzzer(bool defaultOn);   // ブザーを鳴らすか（BUZZER ON / OFF。2026-11-18）
bool settingsSaveBuzzer(bool on);
bool settingsLoadAutostart(bool defaultOn);
bool settingsSaveAutostart(bool on);
