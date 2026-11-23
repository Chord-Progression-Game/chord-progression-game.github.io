#pragma once
#include <stdint.h>

#include "chords.h"
#include "reader_array.h"  // ReaderEvent

// ============================================================
// コード進行の再生
//
//   盤面（4つの位置のコード） → グルーヴ（BPM に従って、2拍ごとに次の位置へ。ドラム・バッキングのパターン）
//     → コードの構成音（Keyから実音を計算。→ は前のコードの繰り返し。ボイスリーディング） → MIDI出力
//
//   読み取り・コードの定義・時間の管理・音源への出力は、それぞれ別の部品（board / chords / groove / midi_out）。
//   この部品は、それらをつなぐ役だけをする。
//   BPM・キー・パターンは、再生中でも、いつでも変えられて、すぐに反映される。
// ============================================================

void playerBegin();
// 電源を入れたときの動き。保存してあるドラム・バッキング・BPM・キーを戻す（なければ標準: 8ビート・ロング・120・C）。
// 自動再生が ON（標準）なら、START を打たなくても再生を始めて true を返す（このとき登録の画面は出さない）。
// allowAutostart=false なら、自動再生はしない（テスト用のコピーなど）
bool playerBoot(bool allowAutostart = true);

bool playerIsPlaying();
int playerCurrentStep();                  // いま鳴らしているステップ（0から数える）。止まっているときは -1
void playerStart(bool atBoot = false);    // 位置1から再生を始める（START）。atBoot: 電源を入れたときの自動再生（案内を短くする）
void playerStop();                        // 止める（STOP）。鳴っている音も止める

// ---- すぐに反映される設定 ----
bool playerSetBpm(int bpm);               // 範囲外なら false
int playerBpm();
void playerSetKey(const Key& key);        // 再生中なら、鳴っている和音を、新しいキーで鳴らし直す
const Key& playerKey();
bool playerSetOctave(int octave);         // 和音の高さ（-1〜3）。範囲外なら false。再生中なら、すぐ鳴らし直す
int playerOctave();
void playerSetVoicing(bool octaveForTriads);   // true: 3和音の4音目にルートのオクターブ上を足す（標準）
bool playerVoicingAddsOctave();
void playerSetVoiceLeading(bool on);      // true: 前のコードから一番近い高さで鳴らす（標準）
bool playerVoiceLeading();

// ---- リズムのパターン（0 = なし。なければ false）----
bool playerSetDrum(int id);
bool playerSetBacking(int id);
int playerDrumId();
int playerBackingId();
void playerReloadPatterns();              // パターンの中身を編集・削除したあとに呼ぶ（選んでいるパターンが消えていたら、なしにする）

// loop() から頻繁に呼ぶ。時刻が来ていれば、音を鳴らす・止める・次へ進める
void playerTick();
// 次に音を鳴らす／止める時刻まで、あと何ms か。停止中は UINT32_MAX
uint32_t playerMsUntilEvent();

// 再生中に、リーダーで「置かれた／交換された／外れた」が起きたときの表示（音には、次にその位置を再生するときに反映）
void playerOnReaderEvent(const ReaderEvent& event);

// 現在の状態を表示する（STATUS）
void playerPrintStatus();
// いま選んでいる、ドラムとバッキングのパターンを表示する（GROOVE）
void playerPrintGroove();
