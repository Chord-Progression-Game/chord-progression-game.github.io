#pragma once
#include <stdint.h>

#include <vector>

#include "reader_array.h"
#include "tag_store.h"

// ============================================================
// ハードウェアの偽物（パソコン上のテスト用）
//   midi_out / reader_array / tag_store / register_ui / rc522_test の、必要な部分だけ。
//   本物のソースは、ここに偽物がある関数を呼ぶだけなので、そのまま動かせる。
// ============================================================

// 送られた MIDI メッセージ1つ（3バイトのノート、または音色／全音停止）
struct SimMidi {
  uint32_t t;        // 送った時刻（ms）
  int batch;         // 同じ送信（1回の midiSendMessages）の番号
  uint8_t status;    // 0x90 | ch（ノートオン） 0x80 | ch（ノートオフ） 0xC0 | ch（音色） 0xB0 | ch（全音停止）
  uint8_t d1, d2;
};
std::vector<SimMidi>& simMidiLog();

// リーダーと駒
void simPutTag(int reader, const TagUid& uid);   // リーダーに駒を置く
void simRemoveTag(int reader);
extern bool simNotePending;      // テスト用: イベントの原因を1件、次の readersTakeEventNote で返す
extern ReaderEventNote simNote;
extern bool simRetestStartOk;
extern int simRetestStartedReader;
extern bool simRetestResultPending;
extern int simRetestResultReader;
extern uint32_t simRetestResultMs;
extern bool simRetestResultOk;
extern ReaderStatsInfo simStats[];   // テスト用: readersStatsGet が返す、リーダーごとの統計（8台ぶん）
extern bool simStatsReset;           // readersStatsReset が呼ばれたか
extern bool simVerdictPending;   // テスト用: 影の判定を1件、次の readersTakeVerdict で返す
extern ReaderVerdict simVerdict;
extern int simShadowOwner[];   // リーダー i が影として読んでいる駒の持ち主（-1 = 影ではない）。STATUS の表示のテスト用
void simRegisterTag(const TagUid& uid, uint8_t chordId);
TagUid simUid(uint8_t a, uint8_t b = 0);

// 偽のリーダーの設定／状態
extern int simSelfTestFailures;    // RESET方式の自己診断で失敗するリーダーの数（0 = 成功）
extern bool simUsbFails;           // MIDI USB を始められない
extern bool simUsbMountedFlag;
extern bool simTestMode;           // RC522 のテストモード中
extern int simRegisterUiBeginCalls;
extern int simRegisterUiCancelCalls;
extern int simAliveCount;
