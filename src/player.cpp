#include "player.h"

#include <Arduino.h>
#include <string.h>

#include "board.h"
#include "chords.h"
#include "config.h"
#include "groove.h"
#include "midi_out.h"
#include "rhythm_print.h"
#include "rhythm_store.h"
#include "settings_store.h"
#include "ui_util.h"

namespace {

int octaveShift = DEFAULT_OCTAVE;   // 和音の高さ（オクターブ）。groove の baseC = PIANO_BASE_C + 12 × この値
int drumId = PATTERN_ID_OFF;
int backingId = 1;   // 初期は「ロング」（これまでと同じ、1ステップに1回の和音）

// 位置の説明（表示用）。例: "Ⅳ" / "空" / "未登録のタグ"
void printPositionName(const PositionInfo& info) {
  if (info.state == POS_EMPTY) {
    Serial.print("空");
  } else if (info.state == POS_UNREGISTERED) {
    Serial.print("未登録のタグ");
  } else {
    const Chord* chord = chordById(info.chordId);
    Serial.print(chord ? chord->name : "不明なコード");
  }
}

// MIDIノート番号から、オクターブの数字（C4 = 60 → 4）
int octaveOf(uint8_t note) { return (int)note / 12 - 1; }

// 音名を「C3 → E3 → G3 → C4」の形で表示する（高さが分かるように、オクターブつき）
void printNotes(const StepInfo& info, const Chord& chord) {
  char names[64];
  chordNoteNames(chord, currentKey, names, sizeof(names), playerVoicingAddsOctave());
  int i = 0;
  const char* p = names;
  while (*p != '\0' && i < info.noteCount) {
    if (i > 0) Serial.print(" → ");
    while (*p != '\0' && *p != ' ') Serial.write((uint8_t)*p++);
    Serial.print(octaveOf(info.notes[i]));
    if (*p == ' ') p++;
    i++;
  }
}

// グルーヴからの「お願い」を受ける
class PlayerListener : public GrooveListener {
 public:
  uint8_t rawChordAtStep(int step) override {
    return boardChordId(step);  // その位置の駒のコード（空・未登録は 0、→ は 99）
  }

  void emit(const MidiEvent* events, int count) override {
    uint8_t bytes[GROOVE_QUEUE_SIZE * 3];
    size_t n = 0;
    for (int i = 0; i < count && n + 3 <= sizeof(bytes); i++) {
      bytes[n++] = (uint8_t)((events[i].on ? 0x90 : 0x80) | (events[i].channel & 0x0F));
      bytes[n++] = events[i].note;
      bytes[n++] = events[i].velocity;
    }
    midiSendMessages(bytes, n);  // 同じ時刻の音は、まとめて1回で送る
  }

  void stepStarted(const StepInfo& info) override {
    // 操作画面用の合図: 「いま、このステップが始まった」。音の指示（~M の行）の直後に、長い表示より先に出す。
    // 画面が STATE を問い合わせて知る（約0.7秒おき）のでは、進行の表示が音より遅れるため
    if (midiBackend() != MIDI_BACKEND_NONE) Serial.printf("~T %d\n", info.step);
    const Chord* chord = (info.chordId != 0) ? chordById(info.chordId) : nullptr;
    if (chord != nullptr) {
      char keyText[8], symbol[16];
      keyName(currentKey, keyText, sizeof(keyText));
      chordSymbol(*chord, currentKey, symbol, sizeof(symbol));
      Serial.printf("▶ ステップ%d/%d  位置%d: ", info.step + 1, NUM_POSITIONS, info.step + 1);
      if (info.repeated) Serial.printf("→（前のコマと同じ: %s）", chord->name);
      else Serial.print(chord->name);
      Serial.printf("   Key=%s: %s  ♪ ", keyText, symbol);
      printNotes(info, *chord);
      if (info.shift != 0) Serial.printf("  [ループ全体の流れで、1オクターブ%s]", info.shift > 0 ? "上" : "下");
      Serial.println();
    } else {
      Serial.printf("▶ ステップ%d/%d  位置%d: （休み: ", info.step + 1, NUM_POSITIONS, info.step + 1);
      if (info.rawId == CHORD_ID_REPEAT) Serial.print("→ の前のコマが空");
      else printPositionName(boardPosition(info.step));
      Serial.println("）");
    }
  }
};

// config.h の値で、グルーヴの音の設定を作る
GrooveSettings makeSettings() {
  GrooveSettings s;
  s.baseC = (uint8_t)(PIANO_BASE_C + 12 * octaveShift);
  s.pianoChannel = MIDI_CHANNEL_PIANO;
  s.drumChannel = MIDI_CHANNEL_DRUMS;
  s.backingVelocity = MIDI_VELOCITY;
  return s;
}

PlayerListener listener;
Groove groove(NUM_POSITIONS, &listener, makeSettings());

void applyPatterns() {
  groove.setDrumPattern(drumId == PATTERN_ID_OFF ? nullptr : rhythmDrum(drumId));
  groove.setBackingPattern(backingId == PATTERN_ID_OFF ? nullptr : rhythmBacking(backingId));
}

}  // namespace

// BPM・キーは、スライダーなどで続けて変わるので、変えてから少し落ち着いたら保存する（playerTick で）
namespace {
bool bpmSavePending = false, keySavePending = false;
uint32_t settingsChangedAt = 0;
void markSettingsChanged() { settingsChangedAt = millis(); }
void saveSettingsIfDue(bool force) {
  if (!bpmSavePending && !keySavePending) return;
  if (!force && (uint32_t)(millis() - settingsChangedAt) < SETTINGS_SAVE_DELAY_MS) return;
  if (bpmSavePending) settingsSaveBpm(groove.bpm());
  if (keySavePending) settingsSaveKey(currentKey);
  bpmSavePending = keySavePending = false;
}
}  // namespace

void playerBegin() {
  groove.setKey(currentKey);
  applyPatterns();
}

bool playerIsPlaying() { return groove.playing(); }
int playerCurrentStep() { return groove.playing() ? groove.currentStep() : -1; }

void playerStart(bool atBoot) {
  if (groove.playing()) {
    Serial.println("すでに再生中です。（止めるには STOP）");
    return;
  }
  playerReloadPatterns();
  midiProgramChange(MIDI_CHANNEL_PIANO, MIDI_PROGRAM_PIANO);  // 音色: ピアノ
  char keyText[8];
  keyName(currentKey, keyText, sizeof(keyText));
  Serial.println();
  Serial.printf("▶ 再生を開始します。BPM %d（1拍 %lu ms、%d拍ごとに次の位置へ）、Key=%s。位置1→位置%d を繰り返します。\n",
                groove.bpm(), (unsigned long)(60000 / groove.bpm()), (int)GROOVE_BEATS_PER_STEP, keyText, NUM_POSITIONS);
  Serial.print("   進行: ");
  for (int p = 0; p < NUM_POSITIONS; p++) {  // 例: [Ⅰ] [Ⅵm] [Ⅳ] [Ⅴ]
    Serial.print("[");
    printPositionName(boardPosition(p));
    Serial.print("] ");
  }
  Serial.println();
  const DrumPattern* d = groove.drumPattern();
  const BackingPattern* b = groove.backingPattern();
  Serial.printf("   ドラム: %s   バッキング: %s\n", d ? d->name : "なし", b ? b->name : "なし");
  Serial.printf("   音源: %s\n", midiBackendName());
  if (midiBackend() == MIDI_BACKEND_NONE) {
    if (atBoot) {
      Serial.println("   ※ 音源は「なし」です。ブリッジ（tools/midi_bridge.py）か USB-MIDI をつなぐと、音が出ます。");
    } else {
      Serial.println("   ※ 音源が「なし」なので、MIDI はどこにも送られません（GarageBand などは鳴りません）。");
      Serial.println("     PlatformIO の Serial Monitor は MIDI を PC に送れません。Serial Monitor を閉じて、");
      Serial.println("     tools/midi_bridge.py を動かしてください（README 6-3）。または USB側のポートなら MIDI USB。");
    }
  }
  Serial.flush();  // 案内の文字を出し切ってから始める（最初の音が、文字の送信の後ろに並んで遅れないように）
  groove.start(millis());
}

void playerStop() {
  if (!groove.playing()) {
    Serial.println("再生していません。");
    return;
  }
  saveSettingsIfDue(true);              // 変えたばかりの BPM・キーも、ここで保存する
  groove.stop();                        // 鳴っている音を止める指示を出す
  midiAllNotesOff(MIDI_CHANNEL_PIANO);  // 念のため、すべての音を止める
  midiAllNotesOff(MIDI_CHANNEL_DRUMS);
  if (midiBackend() != MIDI_BACKEND_NONE) Serial.println("~T -1");   // 操作画面用の合図: 止まった
  Serial.println("■ 停止しました。");
}

bool playerSetBpm(int bpm) {
  bool ok = groove.setBpm(bpm, millis());
  if (ok) { bpmSavePending = true; markSettingsChanged(); }
  return ok;
}
int playerBpm() { return groove.bpm(); }

void playerSetKey(const Key& key) {
  currentKey = key;
  groove.setKey(key);
  keySavePending = true;
  markSettingsChanged();
}
const Key& playerKey() { return currentKey; }

bool playerSetOctave(int octave) {
  if (octave < OCTAVE_MIN || octave > OCTAVE_MAX) return false;
  octaveShift = octave;
  groove.setBaseC((uint8_t)(PIANO_BASE_C + 12 * octave));
  return true;
}
int playerOctave() { return octaveShift; }

void playerSetVoicing(bool addOctave) { groove.setOctaveForTriads(addOctave); }
bool playerVoicingAddsOctave() { return groove.octaveForTriads(); }
void playerSetVoiceLeading(bool on) { groove.setVoiceLeading(on); }
bool playerVoiceLeading() { return groove.voiceLeading(); }

namespace {
bool applyDrum(int id) {
  if (id != PATTERN_ID_OFF && rhythmDrum(id) == nullptr) return false;
  drumId = id;
  applyPatterns();
  return true;
}
bool applyBacking(int id) {
  if (id != PATTERN_ID_OFF && rhythmBacking(id) == nullptr) return false;
  backingId = id;
  applyPatterns();
  return true;
}
}  // namespace

// 選んだパターンは、電源を切っても残る（次に電源を入れたとき、同じパターンで始まる）
bool playerSetDrum(int id) {
  if (!applyDrum(id)) return false;
  settingsSaveDrum(id);
  return true;
}

bool playerSetBacking(int id) {
  if (!applyBacking(id)) return false;
  settingsSaveBacking(id);
  return true;
}

int playerDrumId() { return drumId; }
int playerBackingId() { return backingId; }

void playerReloadPatterns() {
  if (drumId != PATTERN_ID_OFF && rhythmDrum(drumId) == nullptr) drumId = PATTERN_ID_OFF;
  if (backingId != PATTERN_ID_OFF && rhythmBacking(backingId) == nullptr) backingId = PATTERN_ID_OFF;
  applyPatterns();
}

void playerTick() {
  groove.update(millis());
  saveSettingsIfDue(false);
}

bool playerBoot(bool allowAutostart) {
  // 保存してある設定を戻す（保存がなければ標準。自分のパターンが消えていたら、これも標準）
  if (!applyDrum(settingsLoadDrum(DEFAULT_DRUM_ID))) applyDrum(DEFAULT_DRUM_ID);
  if (!applyBacking(settingsLoadBacking(DEFAULT_BACKING_ID))) applyBacking(DEFAULT_BACKING_ID);
  groove.setBpm(settingsLoadBpm(groove.bpm()), millis());
  Key k;
  if (settingsLoadKey(&k)) { currentKey = k; groove.setKey(k); }
  if (allowAutostart && settingsLoadAutostart(DEFAULT_AUTOSTART)) {
    Serial.println();
    Serial.println("自動再生: 電源を入れたので、再生を始めます。（止めるのは STOP。この自動再生をやめるのは AUTOSTART OFF）");
    playerStart(true);
    return true;
  }
  return false;
}

uint32_t playerMsUntilEvent() { return groove.msUntilNextEvent(millis()); }

void playerOnReaderEvent(const ReaderEvent& event) {
  int position = boardPositionOfReader(event.reader);
  if (position < 0) return;
  PositionInfo info = boardPosition(position);

  Serial.printf("[位置%d] ", position + 1);
  switch (event.type) {
    case READER_EVENT_PLACED:  Serial.print("駒が置かれました: "); printPositionName(info); break;
    case READER_EVENT_CHANGED: Serial.print("駒が交換されました: "); printPositionName(info); break;
    case READER_EVENT_REMOVED: Serial.print("駒が外れました（空）"); break;
  }
  if (event.type != READER_EVENT_REMOVED && info.state == POS_UNREGISTERED) {
    Serial.print("  UID: ");
    printUidBytes(info.uid);
    Serial.print("  ← STOP のあと、登録してください");
  }
  Serial.println("  （次にこの位置を再生するときから反映）");
  if (event.type != READER_EVENT_REMOVED && info.duplicateOf >= 0) {
    Serial.printf("  ※ 位置%d も同じタグを読んでいます（リーダー同士の干渉、またはタグが2つのリーダーの間にあります）\n",
                  info.duplicateOf + 1);
  }
}

void playerPrintGroove() {
  Serial.println();
  Serial.println("=== グルーヴ（ドラムとバッキングは、別々に選べます）===");
  const DrumPattern* d = groove.drumPattern();
  const BackingPattern* b = groove.backingPattern();
  if (d) rhythmPrintDrumPattern(drumId, *d);
  else Serial.println("ドラム: なし（DRUM 2 のように選ぶ）");
  if (b) rhythmPrintBackingPattern(backingId, *b);
  else Serial.println("バッキング: なし（和音は鳴りません。BACKING 1 のように選ぶ）");
}

void playerPrintStatus() {
  Serial.println();
  Serial.println("=== STATUS ===");
  if (groove.playing()) {
    Serial.printf("再生: 再生中（ステップ %d / %d）\n", groove.currentStep() + 1, NUM_POSITIONS);
  } else {
    Serial.println("再生: 停止中（START で再生）");
  }
  Serial.printf("BPM: %d（1拍 %lu ms、%d拍ごとに次の位置へ = 1ステップ %lu ms）。BPM は、再生中でも、すぐに変わります\n", groove.bpm(),
                (unsigned long)(60000 / groove.bpm()), (int)GROOVE_BEATS_PER_STEP,
                (unsigned long)(60000 * GROOVE_BEATS_PER_STEP / groove.bpm()));
  char keyText[8];
  keyName(currentKey, keyText, sizeof(keyText));
  Serial.printf("Key: %s（KEY D / KEY +1 / KEY -1 で変更。再生中も、すぐに変わります）\n", keyText);
  Serial.printf("和音の鳴らし方: %s（VOICING 3 / 4）    ボイスリーディング: %s（LEAD ON / OFF）\n",
                groove.octaveForTriads() ? "4音（3和音は、ルートのオクターブ上を足す）" : "コードの構成音だけ（3和音は3音）",
                groove.voiceLeading() ? "ON（前のコードから、一番近い高さで鳴らす）" : "OFF（いつも同じ高さ）");
  const DrumPattern* d = groove.drumPattern();
  const BackingPattern* b = groove.backingPattern();
  Serial.printf("ドラム: %s   バッキング: %s   （GROOVE で、パターンの中身を表示）\n",
                d ? d->name : "なし", b ? b->name : "なし");
  Serial.printf("電源を入れたときの自動再生: %s（AUTOSTART ON / OFF）\n", settingsLoadAutostart(DEFAULT_AUTOSTART) ? "ON" : "OFF");
  Serial.printf("音源: %s\n", midiBackendName());
  if (midiBackend() == MIDI_BACKEND_USB) {
    Serial.printf("      USB-MIDI の接続: %s\n", midiUsbMounted() ? "PCに認識されています" : "PCにつながっていません（USB側のポートにケーブルをつないでください）");
  }
  Serial.printf("リーダー: %d / %d 台が応答。止め方: %s、受信感度: %d dB\n", readersAliveCount(), NUM_READERS,
                readersIdleMethodName(readersIdleMethod()), readersGainDb());
  if (readersAvgScanUs() > 0) {
    // 駒を置いてから「置かれた」と出るまでの時間は、おおよそ「1周の時間」の2倍＋比べ読み（影があるとき）
    Serial.printf("読み取り: 1台あたり 平均 %lu.%lu ms、1周（%d台）約 %lu ms。持ち主を比べ読みで決めた回数: %lu\n",
                  (unsigned long)(readersAvgScanUs() / 1000), (unsigned long)((readersAvgScanUs() % 1000) / 100), readersAliveCount(),
                  (unsigned long)(readersAvgScanUs() * (uint32_t)readersAliveCount() / 1000), (unsigned long)readersArbitrationCount());
  }
  if (readersIdleMethod() == IDLE_RESET && readersSlowWakeCount() > 0) {
    Serial.printf("      ※ RESET方式で、速い起こし方に失敗した回数: %lu（多いときは IDLE OFF にしてください）\n",
                  (unsigned long)readersSlowWakeCount());
  }
  if (groove.playing() || groove.maxLateMs() > 0) {
    // ESP32 の中で、本来の時刻より最大で何ms遅れたか（小さいほど、音のタイミングが正確。10ms以下なら十分）
    Serial.printf("タイミング: ESP32 側の時刻のずれは、再生を始めてから最大 %lu ms\n", (unsigned long)groove.maxLateMs());
  }
  for (int p = 0; p < NUM_POSITIONS; p++) {
    PositionInfo info = boardPosition(p);
    bool current = groove.playing() && groove.currentStep() == p;
    Serial.printf("%s位置%d: ", current ? "▶ " : "  ", p + 1);
    if (info.state == POS_CHORD) {
      const Chord* chord = chordById(info.chordId);
      if (chord != nullptr && chordIsRepeat(*chord)) {
        // → は、前のコマと同じコードになる
        bool repeated;
        uint8_t raw;
        uint8_t resolved = grooveResolveChordId(&listener, NUM_POSITIONS, p, &raw, &repeated);
        const Chord* real = resolved ? chordById(resolved) : nullptr;
        if (real != nullptr) Serial.printf("→  （前のコマと同じ: %s）", real->name);
        else Serial.print("→  （前のコマが空なので、休み）");
      } else if (chord != nullptr) {
        char symbol[16];
        chordSymbol(*chord, currentKey, symbol, sizeof(symbol));
        char names[64];
        chordNoteNames(*chord, currentKey, names, sizeof(names), groove.octaveForTriads());
        Serial.printf("%s  (%s: ", chord->name, symbol);
        for (const char* q = names; *q != '\0'; q++) {
          if (*q == ' ') Serial.print(" → ");
          else Serial.write((uint8_t)*q);
        }
        Serial.print(")");
      } else {
        Serial.printf("不明なコード(ID=%d)", info.chordId);
      }
    } else if (info.state == POS_UNREGISTERED) {
      Serial.print("未登録のタグ  ← 休みとして扱います");
    } else {
      Serial.print("（空）  ← 休みとして扱います");
    }
    if (info.state != POS_EMPTY) {
      Serial.print("   UID: ");
      printUidBytes(info.uid);
    }
    if (info.duplicateOf >= 0) Serial.printf("   ※ 位置%d と同じタグを読んでいます", info.duplicateOf + 1);
    {
      // 隣のリーダーに載っている駒を、このリーダーも読んでいる（影）。持ち主は隣なので、この位置では無視している
      int reader = boardReaderOfPosition(p);
      int owner = (reader >= 0) ? readerShadowOwner(reader) : -1;
      if (owner >= 0) Serial.printf("   （リーダー%d は、リーダー%d の駒を読んでいますが、無視しています）", reader + 1, owner + 1);
    }
    Serial.println();
  }
}
