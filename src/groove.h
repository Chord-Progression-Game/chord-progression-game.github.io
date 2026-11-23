#pragma once
#include <stdint.h>

#include "chords.h"
#include "rhythm.h"

// ============================================================
// グルーヴ: コード進行・ドラム・バッキングを、BPM に合わせて、いっしょに進める「時間の管理」
//
//   これまでのシーケンサー（2拍ごとに和音を鳴らすだけ）を、リズムのパターンも扱えるように広げたもの。
//
//   ・時間は「ティック」で数える。1拍 = 48ティック、16分音符のマス = 12ティック、1ステップ（1つの位置）= 2拍 = 96ティック。
//   ・BPM は、いつでも変えられて、すぐに反映される（ティックの進む速さが変わるだけ）。
//   ・1ステップごとに、4つの位置を順番に進める（最後まで行ったら先頭に戻る）。
//       そのステップのコードを決める → 「→」なら前のコマと同じ → ボイスリーディングで高さを決める
//   ・バッキングのパターンは、そのステップのコードの音を、パターンの通りに鳴らす。
//   ・ドラムのパターンは、コードとは関係なく、パターンの通りに鳴らす。
//   ・delay() で止まらない。loop() から update() を呼ぶたびに、「時刻が来ていたら進める」。
//   ・音を鳴らす指示は、listener の emit() に、同じ時刻のものをまとめて渡す（MIDI は1回の送信にまとめる）。
//   ・Arduino に依存しない（パソコンの上でもテストできる）。
//
//   パターンの切り替えやキーの変更は、再生中でも、すぐに反映される。
// ============================================================

enum {
  GROOVE_TICKS_PER_BEAT = 48,
  GROOVE_TICKS_PER_SLOT = 12,    // 16分音符の長さ
  GROOVE_SLOTS_PER_STEP = 8,     // 1ステップ（1つの位置）= 2拍 = 16分音符 8つ
  GROOVE_TICKS_PER_STEP = 96,
  GROOVE_BEATS_PER_STEP = 2,
  GROOVE_MAX_STEPS = 8,
  GROOVE_QUEUE_SIZE = 64         // 「あとで止める」予定を覚えておく数
};

// 音の指示1つ
struct MidiEvent {
  uint8_t on;        // 1 = 音を出す、0 = 音を止める
  uint8_t channel;   // MIDI チャンネル（0〜15）
  uint8_t note;      // ノート番号
  uint8_t velocity;  // 強さ（止めるときは 0）
};

// 1つのステップ（位置）で、いま何を鳴らすか
struct StepInfo {
  int step;                       // ステップ番号（0から）
  uint8_t rawId;                  // その位置の駒のコードID（0 = 空・未登録、99 = →）
  uint8_t chordId;                // 実際に鳴らすコードID（「→」は前のコードに置き換え済み。休みは 0）
  bool repeated;                  // 「→」で、前のコードを繰り返している
  uint8_t notes[MAX_CHORD_NOTES]; // 鳴らす音（MIDIノート番号。低い方から）
  uint8_t noteCount;              // 音の数（休みは 0）
  int root;                       // 実際のルートの高さ（MIDIノート）。休みは -1
  int shift;                      // 本来の高さからの移動（-12 / 0 / +12）。ボイスリーディングの結果
};

// グルーヴが「お願い」する相手
class GrooveListener {
 public:
  virtual ~GrooveListener() {}
  // step 番目の位置にある駒のコードID。0 = 空・未登録（休み）、99 = →。
  // ステップが始まる瞬間に呼ばれるので、駒を交換していれば、このとき新しい駒が使われる
  virtual uint8_t rawChordAtStep(int step) = 0;
  // 新しいステップが始まった（休みのときも呼ばれる）。音の指示を出したあとに呼ばれる（表示用）
  virtual void stepStarted(const StepInfo& info) = 0;
  // 同じ時刻の音の指示を、まとめて渡す（止める指示が、出す指示より先に並ぶ）
  virtual void emit(const MidiEvent* events, int count) = 0;
};

// step 番目の位置で、実際に鳴らすコードID を求める。
//   ・ふつうの駒: その駒のコード。空・未登録は 0（休み）
//   ・「→」(99): 前のコマと同じコード。前へたどって、最初に見つかった「→」でない駒のコードにする。
//                そこが空・未登録なら休み(0)。先頭の位置の「前」は、最後の位置（ループしているので）。
//                全部が「→」なら休み。
// rawId に、その位置の駒のID（99 のまま）、repeated に「→」だったかを返す（どちらも nullptr でよい）
uint8_t grooveResolveChordId(GrooveListener* listener, int numSteps, int step, uint8_t* rawId, bool* repeated);

// 音の設定（ふだんは変えなくてよい）
struct GrooveSettings {
  uint8_t baseC;              // ルートを置く音域の C（MIDIノート番号）。48 = C3
  uint8_t pianoChannel;       // バッキング（ピアノ）のチャンネル（0 = チャンネル1）
  uint8_t drumChannel;        // ドラムのチャンネル（9 = チャンネル10）
  uint8_t backingVelocity;    // バッキングの強さ
  uint8_t backingSoftVelocity;
  uint8_t drumGhostVelocity;
  uint8_t drumNormalVelocity;
  uint8_t drumAccentVelocity;
  uint8_t gatePercent;        // 音の長さのうち、何%で止めるか（少し手前で止めて、弾き直す）
  uint8_t drumNoteTicks;      // ドラムの音を止めるまでのティック数

  GrooveSettings()
      : baseC(48), pianoChannel(0), drumChannel(9), backingVelocity(80), backingSoftVelocity(55),
        drumGhostVelocity(45), drumNormalVelocity(85), drumAccentVelocity(112), gatePercent(95), drumNoteTicks(6) {}
};

class Groove {
 public:
  enum { BPM_MIN = 30, BPM_MAX = 240, BPM_DEFAULT = 120 };

  Groove(int numSteps, GrooveListener* listener, const GrooveSettings& settings = GrooveSettings());

  // ---- 設定（再生中でも、いつでも変えられる）----
  // BPM。範囲外なら false（変えない）。すぐに反映される。nowMs は、いまの時刻
  bool setBpm(int bpm, uint32_t nowMs);
  int bpm() const { return bpm_; }
  // キー。再生中なら、鳴っている和音を、新しいキーで鳴らし直す（次の update で）
  void setKey(const Key& key);
  // 和音の音域（ルートを置く C の MIDI ノート番号。48 = C3）。再生中なら、鳴っている和音を、新しい高さで鳴らし直す
  void setBaseC(uint8_t baseC);
  uint8_t baseC() const { return settings_.baseC; }
  const Key& key() const { return key_; }
  void setOctaveForTriads(bool on) { octaveForTriads_ = on; }   // 3和音の4音目に、ルートのオクターブ上を足す
  bool octaveForTriads() const { return octaveForTriads_; }
  void setVoiceLeading(bool on) { voiceLeading_ = on; }          // 前のコードから一番近い高さで鳴らす
  bool voiceLeading() const { return voiceLeading_; }
  // パターン（nullptr = なし）。次のマスから反映される。ポインタの先は、使っている間、有効であること
  void setDrumPattern(const DrumPattern* pattern) { drum_ = pattern; }
  void setBackingPattern(const BackingPattern* pattern) { backing_ = pattern; }
  const DrumPattern* drumPattern() const { return drum_; }
  const BackingPattern* backingPattern() const { return backing_; }

  // ---- 再生 ----
  void start(uint32_t nowMs);   // 位置1の先頭から始める
  void stop();                  // 止める。鳴っている音を止める指示を、すぐに出す
  bool playing() const { return playing_; }
  int currentStep() const { return cur_.step; }
  const StepInfo& currentStepInfo() const { return cur_; }
  int numSteps() const { return numSteps_; }

  // 時刻が来ていたら、音を鳴らす・止める・次へ進める。loop() から頻繁に呼ぶ
  void update(uint32_t nowMs);

  // 次に何かする（音を出す・止める・ステップが進む）まで、あと何msか。停止中は UINT32_MAX。すぐなら 0
  // （この間は、時間のかかる読み取りをしても、音がずれない）
  uint32_t msUntilNextEvent(uint32_t nowMs) const;

  // 診断用: 再生を始めてから、本来の時刻より最大で何ms遅れて、音の指示を出したか
  uint32_t maxLateMs() const { return maxLateMs_; }

 private:
  struct Pending {
    uint32_t tick;
    MidiEvent ev;
  };
  struct LastHit {
    bool valid;
    BackingShape shape;
    bool soft;
    uint32_t endTick;
  };

  uint32_t unitsPerMs() const { return (uint32_t)bpm_ * GROOVE_TICKS_PER_BEAT; }
  void advanceClock(uint32_t nowMs);
  uint32_t msUntilTick(uint32_t targetTick, uint32_t nowMs) const;
  void processDue();
  void processTick(uint32_t tick);
  void beginStep(int step);
  void computeVoicing(StepInfo* info, const Chord& chord, int previousRoot);
  void scheduleSlot(uint32_t tick);
  void scheduleBackingHit(uint32_t onTick, uint32_t offTick, BackingShape shape, bool soft);
  void scheduleDrums(uint32_t tick, int slotInLoop);
  int notesForShape(BackingShape shape, uint8_t* out) const;
  void enqueue(uint32_t tick, bool on, uint8_t channel, uint8_t note, uint8_t velocity);
  void emitDue(uint32_t tick);
  void flushChannel(uint8_t channel);
  void restrikeForKeyChange();
  bool slotHasWork(int slotInLoop) const;
  uint32_t nextWorkTick() const;
  void noteLate(uint32_t eventTick);

  int numSteps_;
  GrooveListener* listener_;
  GrooveSettings settings_;
  int bpm_;
  Key key_;
  bool octaveForTriads_;
  bool voiceLeading_;
  const DrumPattern* drum_;
  const BackingPattern* backing_;

  bool playing_;
  uint32_t lastMs_;       // 前に update した時刻
  uint32_t acc_;          // ティックの端数（単位: 1/60000 ティック）
  uint32_t nowTick_;      // いまのティック（整数部分）
  uint32_t nextTick_;     // まだ処理していない、最初のティック
  StepInfo cur_;
  int lastPlayedRoot_;        // 直前に鳴らしたコードのルート（-1 = まだない）
  int prevRootBeforeStep_;    // いまのステップを始める前の lastPlayedRoot_（キー変更で作り直すため）
  LastHit lastHit_;
  bool keyDirty_;
  Pending queue_[GROOVE_QUEUE_SIZE];
  int queueCount_;
  uint32_t maxLateMs_;
};
