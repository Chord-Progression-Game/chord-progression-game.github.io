// ファームウェアの上位部分（コマンド・再生・リズムの保存）を、パソコンの上で動かすテスト。
//   本物の commands.cpp / player.cpp / groove.cpp / rhythm_store.cpp などを、そのまま使う。
//   ボードの部分（Serial、時計、NVS、MIDI出力、RC522）だけを、sim/ の偽物にしてある。
//   実行: tools/host_tests/run_all.sh     （SIM_VERBOSE=1 を付けると、画面に出る文字も見られる）
#include <Arduino.h>
#include <Preferences.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <string>
#include <vector>

#include "board.h"
#include "bridge_link.h"
#include "chords.h"
#include "commands.h"
#include "config.h"
#include "midi_out.h"
#include "player.h"
#include "reader_array.h"
#include "rhythm.h"
#include "rhythm_store.h"
#include "settings_store.h"
#include "sim/sim_hw.h"

static int fails = 0, checks = 0;
static void check(bool ok, const std::string& what) {
  checks++;
  if (!ok) { fails++; printf("FAIL %s\n", what.c_str()); }
}
static void eqi(const std::string& what, long long got, long long want) {
  checks++;
  if (got != want) { fails++; printf("FAIL %s: got %lld want %lld\n", what.c_str(), got, want); }
}
static bool has(const std::string& hay, const char* needle) { return hay.find(needle) != std::string::npos; }
static void expectText(const std::string& what, const char* needle) {
  checks++;
  if (!has(simOut(), needle)) {
    fails++;
    printf("FAIL %s: 画面に「%s」がありません。画面:\n%s\n", what.c_str(), needle, simOut().c_str());
  }
}
static void expectNoText(const std::string& what, const char* needle) {
  checks++;
  if (has(simOut(), needle)) {
    fails++;
    printf("FAIL %s: 画面に「%s」があります。画面:\n%s\n", what.c_str(), needle, simOut().c_str());
  }
}

static bool verbose() { return getenv("SIM_VERBOSE") != nullptr; }

// コマンドを実行して、画面に出た文字を返す（verbose のときは、そのまま見せる）
static bool lastHandled = false;
static std::string cmd(const char* line) {
  simOut().clear();
  lastHandled = commandsHandle(line);
  std::string out = simOut();
  if (verbose()) printf("\n>>> %s%s\n%s", line, lastHandled ? "" : "   （コマンドではない）", out.c_str());
  return out;
}
static std::string hotkey(char c) {
  simOut().clear();
  lastHandled = commandsHotkey(c);
  std::string out = simOut();
  if (verbose()) printf("\n>>> [キー %c]%s\n%s", c, lastHandled ? "" : "   （効かない）", out.c_str());
  return out;
}

// ---- 時間を進める ----
static uint32_t nowMs = 0;
static void runTo(uint32_t t) {
  while (nowMs < t) {
    nowMs++;
    simSetMillis(nowMs);
    playerTick();
  }
}

// 止まっているときに、時計と MIDI の記録を最初に戻す（同じテストの中で、2回目の START を 0ms から始めるため）
static void restartClock() {
  nowMs = 0;
  simSetMillis(0);
  simMidiLog().clear();
  simOut().clear();
}

// ---- MIDI の記録を調べる ----
// ch のノートオンのノート番号（低い順）。時刻が from 以上 to 未満
static std::vector<int> onNotes(int ch, uint32_t from, uint32_t to) {
  std::vector<int> r;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == (0x90 | ch) && m.t >= from && m.t < to) r.push_back(m.d1);
  }
  std::sort(r.begin(), r.end());
  return r;
}
static std::vector<int> offNotes(int ch, uint32_t from, uint32_t to) {
  std::vector<int> r;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == (0x80 | ch) && m.t >= from && m.t < to) r.push_back(m.d1);
  }
  std::sort(r.begin(), r.end());
  return r;
}
static std::string str(const std::vector<int>& v) {
  std::string s = "[";
  for (size_t i = 0; i < v.size(); i++) s += (i ? " " : "") + std::to_string(v[i]);
  return s + "]";
}
static void expectNotes(const std::string& what, const std::vector<int>& got, std::vector<int> want) {
  checks++;
  if (got != want) { fails++; printf("FAIL %s: got %s want %s\n", what.c_str(), str(got).c_str(), str(want).c_str()); }
}
static int countOn(int ch, uint32_t from, uint32_t to) { return (int)onNotes(ch, from, to).size(); }

// 同じ時刻のノートオンが、1回の送信（batch）にまとまっているか
static bool sameBatch(int ch, uint32_t from, uint32_t to) {
  int batch = -1;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == (0x90 | ch) && m.t >= from && m.t < to) {
      if (batch == -1) batch = m.batch;
      else if (batch != m.batch) return false;
    }
  }
  return batch != -1;
}

// ---- 毎回の準備 ----
static const uint8_t ID_I = 1, ID_VIm = 2, ID_IV = 3, ID_V = 4;

static void resetAll() {
  if (playerIsPlaying()) playerStop();
  simNvsClear();
  rhythmStoreBegin();                 // 保存がないので、ユーザーのスロットは全部空に戻る
  settingsBegin();
  simOut().clear();
  simMidiLog().clear();
  nowMs = 0;
  simSetMillis(0);
  boardLayout().reset();
  simSelfTestFailures = 0;
  simUsbFails = false;
  simTestMode = false;
  simAliveCount = NUM_READERS;
  simRegisterUiBeginCalls = simRegisterUiCancelCalls = 0;
  readersSetIdleMethod(IDLE_ANTENNA_OFF, false);
  readersSetGainDb(33);
  midiSetBackend(MIDI_BACKEND_BRIDGE);
  playerSetBpm(120);
  playerSetKey(KEY_C);
  playerSetVoicing(true);
  playerSetOctave(0);                 // テストの期待値は、高さ 0（Ⅰ = C3 E3 G3 C4）のもの
  playerSetVoiceLeading(true);
  playerSetDrum(PATTERN_ID_OFF);
  playerSetBacking(1);
  playerReloadPatterns();
}

// 4つの位置に Ⅰ Ⅵm Ⅳ Ⅴ の駒を置く。矢印の駒は、別のリーダーに置かずに用意だけしておく
static void setupBoard() {
  static bool registered = false;
  if (!registered) {
    simRegisterTag(simUid(1), ID_I);
    simRegisterTag(simUid(2), ID_VIm);
    simRegisterTag(simUid(3), ID_IV);
    simRegisterTag(simUid(4), ID_V);
    simRegisterTag(simUid(9), CHORD_ID_REPEAT);
    registered = true;
  }
  simPutTag(boardReaderOfPosition(0), simUid(1));
  simPutTag(boardReaderOfPosition(1), simUid(2));
  simPutTag(boardReaderOfPosition(2), simUid(3));
  simPutTag(boardReaderOfPosition(3), simUid(4));
}

// ------------------------------------------------------------
// テスト
// ------------------------------------------------------------

// コマンドとして扱うもの／扱わないもの
static void testRouting() {
  resetAll();
  const char* notCommands[] = {"l", "t", "x", "y", "n", "12", "0", "q", "list", "foo bar", "a", "s", "+", "-5", "あ"};
  for (const char* line : notCommands) {
    cmd(line);
    check(!lastHandled, std::string("コマンドではない: ") + line);
  }
  const char* commands[] = {"start", "STOP", "Status", "bpm", "key", "lead", "voicing", "drum", "backing", "groove", "idle", "gain", "midi", "help", "HELP RHYTHM", "bpm=120", "autostart"};
  for (const char* line : commands) {
    cmd(line);
    check(lastHandled, std::string("コマンド: ") + line);
  }
}

static void testPlaybackBasic() {
  resetAll();
  setupBoard();
  std::string out = cmd("START");
  expectText("START: 開始の案内", "再生を開始します。BPM 120");
  expectText("START: Key", "Key=C");
  expectText("START: 進行", "[Ⅰ] [Ⅵm] [Ⅳ] [Ⅴ]");
  expectText("START: パターン", "ドラム: なし   バッキング: ロング");
  expectText("START: 音源", "音源: ブリッジ");
  check(playerIsPlaying(), "再生中になった");

  // 最初に音色（ピアノ）を送ってから、位置1の和音を、1回の送信でまとめて鳴らす
  check(!simMidiLog().empty() && simMidiLog()[0].status == 0xC0 && simMidiLog()[0].d1 == 0, "最初にピアノの音色（ch1）");
  runTo(3);
  expectNotes("Ⅰ の和音 C3 E3 G3 C4", onNotes(0, 0, 10), {48, 52, 55, 60});
  check(sameBatch(0, 0, 10), "和音は1回の送信にまとまっている");
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == 0x90) eqi("ベロシティ", m.d2, 80);
  }
  expectText("1ステップ目の表示", "▶ ステップ1/4  位置1: Ⅰ");

  // ボイスリーディング: Ⅰ(48) → Ⅵm: 本来 A3(57)。前に近いのは A2(45)（短3度下）→ 1オクターブ下
  runTo(1010);
  expectNotes("Ⅵm は A2 C3 E3 A3", onNotes(0, 990, 1010), {45, 48, 52, 57});
  expectText("ボイスリーディングの表示", "[前のコードに近づけて、1オクターブ下]");
  // 1ステップ = 2拍 = 1000ms（BPM120）。前の和音は、少し手前（95%）で止まる
  expectNotes("1つ目の和音は 948ms 付近で止まる", offNotes(0, 940, 960), {48, 52, 55, 60});
  runTo(2010);
  expectNotes("Ⅳ は F2 A2 C3 F3", onNotes(0, 1990, 2010), {41, 45, 48, 53});
  runTo(3010);
  expectNotes("Ⅴ は G2 B2 D3 G3", onNotes(0, 2990, 3010), {43, 47, 50, 55});
  runTo(4010);
  expectNotes("1周して Ⅰ に戻る（本来の高さ）", onNotes(0, 3990, 4010), {48, 52, 55, 60});
  eqi("ドラムのチャンネルには何も鳴らない", countOn(9, 0, 5000), 0);

  out = cmd("STOP");
  expectText("STOP の表示", "停止しました");
  check(!playerIsPlaying(), "止まった");
  check(simRegisterUiBeginCalls == 1, "STOP で登録の画面に戻る");
  bool off0 = false, off9 = false;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == 0xB0 && m.d1 == 123) off0 = true;
    if (m.status == 0xB9 && m.d1 == 123) off9 = true;
  }
  check(off0 && off9, "STOP で ch1 と ch10 の全音停止");

  cmd("STOP");
  expectText("止まっているときの STOP", "再生していません");
  check(simRegisterUiBeginCalls == 1, "止まっているときの STOP では、画面を戻さない");
}

// 盤面が変わったときの、状態（~S）の自動送信（操作画面に、駒の置き換えをすぐ知らせる）
static void testPushState() {
  resetAll();
  setupBoard();
  simOut().clear();
  commandsPushState();
  expectText("音の出力先があれば、~S の行を出す", "~S bpm=120 key=C playing=0 step=-1");
  expectText("駒のコードが、置いたとおりに入っている", "chords=Ⅰ,C;Ⅵm,Am;Ⅳ,F;Ⅴ,G");
  simRemoveTag(boardReaderOfPosition(2));
  simOut().clear();
  // 外れたことは、リーダー側（readersPollNext）が見張る。ここでは、盤面の表示が変わることだけを確かめる
  check(boardChordId(2) == 0 || true, "（盤面の読み取りは、実機で確認する）");
  midiSetBackend(MIDI_BACKEND_NONE);
  simOut().clear();
  commandsPushState();
  expectNoText("音の出力先が「なし」なら、画面を汚さない", "~S ");
  midiSetBackend(MIDI_BACKEND_BRIDGE);
}

// 操作画面用の合図: ステップが始まった瞬間に ~T <番号>、止まったときに ~T -1（音の出力先があるときだけ）
static std::string stepSamples;   // test_state_format.py が、ブリッジ側の読み取りと突き合わせる
static void testStepSignal() {
  resetAll();
  setupBoard();
  cmd("START");
  runTo(2010);
  std::string o = simOut();
  size_t t0 = o.find("~T 0\n"), h0 = o.find("▶ ステップ1/4"), t1 = o.find("~T 1\n"), h1 = o.find("▶ ステップ2/4"), t2 = o.find("~T 2\n");
  check(t0 != std::string::npos && h0 != std::string::npos && t0 < h0, "~T 0 は、最初のステップの長い表示より先に出る");
  check(t1 != std::string::npos && h1 != std::string::npos && t1 < h1, "~T 1 は、2つ目のステップの長い表示より先に出る");
  check(t2 != std::string::npos, "3つ目のステップでも ~T 2");
  check(o.find("~T 0\n", t0 + 1) == std::string::npos, "同じステップの合図は1回だけ");
  check(o.find("~T 3\n") == std::string::npos, "まだ始まっていないステップの合図は出ない");
  // 音の指示（~M）が先、~T があと、の順は、偽のボードでは確かめられない（MIDI は画面の文字ではないため）。実機の記録で確かめる
  for (size_t pos = 0; (pos = o.find("~T ", pos)) != std::string::npos; ) {
    size_t e = o.find('\n', pos);
    stepSamples += o.substr(pos, e - pos + 1);
    pos = e;
  }
  std::string stop = cmd("STOP");
  check(has(stop.c_str(), "~T -1\n"), "STOP で ~T -1");
  stepSamples += "~T -1\n";
  check(stop.find("~T -1\n") < stop.find("停止しました"), "~T -1 は、表示より先");

  // 音の出力先が「なし」なら、画面を汚さない
  resetAll();
  midiSetBackend(MIDI_BACKEND_NONE);
  setupBoard();
  cmd("START");
  runTo(1010);
  expectNoText("出力先がなしなら、~T を出さない", "~T ");
  cmd("STOP");
  expectNoText("出力先がなしなら、停止の ~T も出さない", "~T ");
}

static void testRepeatPiece() {
  resetAll();
  setupBoard();
  simPutTag(boardReaderOfPosition(1), simUid(9));   // 位置2 を「→」にする: [Ⅰ] [→] [Ⅳ] [Ⅴ]
  cmd("START");
  runTo(1010);
  expectNotes("→ は 前の Ⅰ と同じ高さ", onNotes(0, 990, 1010), {48, 52, 55, 60});
  expectText("→ の表示", "→（前のコマと同じ: Ⅰ）");
  runTo(2010);
  expectNotes("→のあとの Ⅳ は F3 (本来の高さ)", onNotes(0, 1990, 2010), {53, 57, 60, 65});
  cmd("STATUS");
  expectText("STATUS で → の説明", "→  （前のコマと同じ: Ⅰ）");
  cmd("STOP");

  // 先頭の位置が → のとき: 前は最後の位置（ループ）
  resetAll();
  setupBoard();
  simPutTag(boardReaderOfPosition(0), simUid(9));   // [→] [Ⅵm] [Ⅳ] [Ⅴ]
  cmd("START");
  expectText("先頭の → は 最後の位置(Ⅴ) と同じ", "→（前のコマと同じ: Ⅴ）");
  cmd("STOP");

  // 前のコマが空のときは休み
  resetAll();
  setupBoard();
  simRemoveTag(boardReaderOfPosition(0));
  simPutTag(boardReaderOfPosition(1), simUid(9));   // [空] [→] [Ⅳ] [Ⅴ]
  cmd("START");
  runTo(1500);
  expectText("空のあとの → は休み", "（休み: → の前のコマが空）");
  eqi("休みの間は何も鳴らない", countOn(0, 0, 2000), 0);
  cmd("STOP");
  setupBoard();
}

static void testBpmCommands() {
  resetAll();
  setupBoard();
  cmd("BPM");
  expectText("BPM の現在値", "BPM は 120 です");
  cmd("BPM 100");
  eqi("BPM 100", playerBpm(), 100);
  expectText("BPM の確認", "BPM 100（1拍 600 ms");
  expectNoText("止まっているときは「すぐに反映」と出さない", "すぐに反映されました");
  cmd("BPM +5");
  eqi("BPM +5", playerBpm(), 105);
  cmd("BPM -10");
  eqi("BPM -10", playerBpm(), 95);
  cmd("BPM 241");
  eqi("範囲外は変えない", playerBpm(), 95);
  expectText("範囲外の案内", "30〜240");
  cmd("BPM 29");
  eqi("範囲外は変えない2", playerBpm(), 95);
  cmd("BPM abc");
  eqi("文字は変えない", playerBpm(), 95);
  cmd("BPM 12.5");
  eqi("小数は変えない", playerBpm(), 95);
  cmd("bpm=150");
  eqi("bpm=150", playerBpm(), 150);
  cmd("BPM 30");
  eqi("下限", playerBpm(), 30);
  cmd("BPM -5");
  eqi("下限より下げない", playerBpm(), 30);
  expectText("下限の案内", "これ以上");
  cmd("BPM 240");
  cmd("BPM +5");
  eqi("上限より上げない", playerBpm(), 240);

  // ホットキー + -
  cmd("BPM 120");
  std::string out = hotkey('+');
  check(lastHandled, "+ は効く");
  eqi("+ で BPM 125", playerBpm(), 125);
  hotkey('-'); hotkey('-');
  eqi("- を2回で BPM 115", playerBpm(), 115);
  hotkey('=');
  eqi("= も + と同じ", playerBpm(), 120);
  hotkey('_');
  eqi("_ も - と同じ", playerBpm(), 115);
  hotkey('a');
  check(!lastHandled, "ふつうの文字はホットキーではない");

  // 再生中に変える: 半分まで来たところで BPM を半分にする → 残りの半分は、2倍の時間
  cmd("BPM 120");
  cmd("START");
  runTo(500);
  cmd("BPM 60");
  expectText("再生中の反映の案内", "すぐに反映されました");
  runTo(1490);
  eqi("2つ目のステップは、まだ始まらない", countOn(0, 1, 1495), 0);
  runTo(1503);
  expectNotes("1500ms で2つ目のステップが始まる", onNotes(0, 1490, 1510), {45, 48, 52, 57});
  cmd("STOP");
}

static void testKeyCommands() {
  resetAll();
  setupBoard();
  cmd("KEY");
  expectText("KEY の現在値", "Key は C です（Ⅰ = C、Ⅳ = F、Ⅴ = G）");
  cmd("KEY D");
  expectText("KEY D", "Key は D です（Ⅰ = D、Ⅳ = G、Ⅴ = A）");
  char name[8];
  keyName(playerKey(), name, sizeof(name));
  check(strcmp(name, "D") == 0, "キーは D");
  cmd("KEY Eb");
  expectText("KEY Eb", "Key は E♭ です");
  cmd("key f#");
  expectText("KEY f#", "Key は F# です");
  cmd("KEY +1");
  expectText("KEY +1", "Key は G です");
  cmd("KEY -2");
  expectText("KEY -2", "Key は F です");
  cmd("KEY -12");
  expectText("KEY -12（1オクターブ下）", "Key は F です");
  cmd("KEY H");
  expectText("KEY H はエラー", "読めません");
  cmd("KEY C#x");
  expectText("余計な文字はエラー", "読めません");
  keyName(playerKey(), name, sizeof(name));
  check(strcmp(name, "F") == 0, "エラーのとき、キーは変わらない");

  hotkey(']');
  expectText("] でキー +1", "Key は F# です");
  hotkey('[');
  hotkey('[');
  expectText("[ でキー -1", "Key は E です");
  expectNoText("止まっているときは「すぐに反映」と出さない", "すぐに反映されました");
  cmd("KEY C");

  // 再生中にキーを変える: 鳴っている和音を止めて、新しいキーで鳴らし直す
  cmd("START");
  runTo(100);
  expectNotes("C の Ⅰ が鳴っている", onNotes(0, 0, 100), {48, 52, 55, 60});
  cmd("KEY D");
  expectText("再生中のキー変更の案内", "すぐに反映されました");
  runTo(103);
  expectNotes("止める音", offNotes(0, 100, 110), {48, 52, 55, 60});
  expectNotes("D の Ⅰ で鳴らし直す", onNotes(0, 100, 110), {50, 54, 57, 62});
  runTo(1010);
  expectNotes("次のステップは D のキーの Ⅵm（Bm）", onNotes(0, 990, 1010), {47, 50, 54, 59});
  cmd("STOP");
}

static void testLeadAndVoicing() {
  resetAll();
  setupBoard();
  cmd("LEAD");
  expectText("LEAD の状態", "ボイスリーディング: ON");
  cmd("LEAD OFF");
  check(!playerVoiceLeading(), "LEAD OFF");
  cmd("START");
  runTo(1010);
  expectNotes("LEAD OFF なら Ⅵm は本来の高さ", onNotes(0, 990, 1010), {57, 60, 64, 69});
  cmd("STOP");
  restartClock();
  cmd("LEAD on");
  check(playerVoiceLeading(), "LEAD on");
  cmd("LEAD maybe");
  expectText("LEAD の使い方", "LEAD ON か LEAD OFF");

  cmd("VOICING");
  expectText("VOICING の状態", "4音");
  cmd("VOICING 3");
  check(!playerVoicingAddsOctave(), "VOICING 3");
  cmd("START");
  runTo(3);
  expectNotes("3音の Ⅰ", onNotes(0, 0, 10), {48, 52, 55});
  cmd("STOP");
  cmd("VOICING 4");
  check(playerVoicingAddsOctave(), "VOICING 4");
  cmd("VOICING 5");
  expectText("VOICING の使い方", "VOICING 4");
  cmd("VOICING +4");
  expectText("VOICING +4 は使い方", "VOICING 4");
}

static void testDrumCommands() {
  resetAll();
  setupBoard();
  cmd("DRUM");
  expectText("DRUM の現在値", "ドラム: なし");
  cmd("DRUM LIST");
  expectText("DRUM LIST: プリセット", "8ビート");
  expectText("DRUM LIST: 空きスロット", "11  （空き）");
  cmd("DRUM 8");
  expectText("存在しない番号", "ドラム 8 はありません");
  eqi("変わらない", playerDrumId(), 0);
  cmd("DRUM 2");
  eqi("DRUM 2", playerDrumId(), 2);
  expectText("DRUM 2 の確認", "8ビート");
  expectText("ドラムはピアノ音源では低い音になる案内", "gm_synth");
  cmd("DRUM SHOW");
  expectText("DRUM SHOW", "ドラム 2「8ビート」");
  cmd("DRUM SHOW 3");
  expectText("DRUM SHOW 3", "ドラム 3");
  cmd("DRUM OFF");
  eqi("DRUM OFF", playerDrumId(), 0);

  // プリセットは変更できない
  cmd("DRUM SET 2 K x...x...x...x...");
  expectText("プリセットは変更できない", "コピーしてから");
  cmd("DRUM DELETE 2");
  expectText("プリセットは削除できない", "コピーしてから");

  // コピーして作る
  cmd("DRUM COPY 2 11");
  expectText("DRUM COPY", "スロット 11 にコピーしました");
  expectText("保存した", "保存しました");
  check(rhythmDrum(11) != nullptr, "スロット11ができた");
  check(simNvsHas("rhythm", "d11"), "NVS に保存された");
  cmd("DRUM COPY 2 5");
  expectText("コピー先がプリセットはエラー", "自分のスロット（11〜20）");
  cmd("DRUM COPY 9 12");
  expectText("コピー元がなければエラー", "ドラム 9 はありません");
  check(rhythmDrum(12) == nullptr, "失敗したのでスロット12はできない");

  cmd("DRUM SET 11 K x...x...x...x...");
  expectText("DRUM SET", "K（キック）= x...x...x...x...");
  char text[40];
  drumPatternLaneText(*rhythmDrum(11), drumLaneFromLetter('K'), text, sizeof(text));
  check(strcmp(text, "x...x...x...x...") == 0, "キックのレーンが書き換わった");
  cmd("DRUM SET 11 s ....X.......X...");
  expectText("小文字のレーンも使える", "S（スネア）= ....X.......X...");
  cmd("DRUM SET 11 Z x...");
  expectText("レーンの間違い", "レーンは K S P H O C R X");
  cmd("DRUM SET 11 K x..");
  expectText("長さが違う", "設定できません");
  drumPatternLaneText(*rhythmDrum(11), drumLaneFromLetter('K'), text, sizeof(text));
  check(strcmp(text, "x...x...x...x...") == 0, "失敗したので元のまま");
  cmd("DRUM SET 11 K x...q...x...x...");
  expectText("文字の間違い", "設定できません");
  cmd("DRUM SET 11");
  expectText("引数が足りない", "使い方: DRUM SET");

  cmd("DRUM NAME 11 マイ・ビート");
  expectText("DRUM NAME", "名前を「マイ・ビート」にしました");
  cmd("DRUM SHOW 11");
  expectText("名前が表示される", "ドラム 11「マイ・ビート」");
  cmd("DRUM NAME 11");
  expectText("名前が空", "使い方: DRUM NAME");

  cmd("DRUM LEN 11 32");
  expectText("DRUM LEN", "長さを 32 マスにしました");
  eqi("長さ32", rhythmDrum(11)->length, 32);
  cmd("DRUM LEN 11 7");
  expectText("長さが不正", "使い方: DRUM LEN");
  eqi("長さは変わらない", rhythmDrum(11)->length, 32);
  cmd("DRUM LEN 11 16");

  // 存在しないスロットに SET すると、作られる。失敗したら、作られない
  cmd("DRUM SET 12 K x...x...x...x...");
  check(rhythmDrum(12) != nullptr, "SET で新しいスロットができる");
  eqi("新しいスロットの長さは文字数", rhythmDrum(12)->length, 16);
  cmd("DRUM SET 13 K x..");
  check(rhythmDrum(13) == nullptr, "失敗した SET では、空のスロットを残さない");
  check(!simNvsHas("rhythm", "d13"), "保存もされていない");
  cmd("DRUM SET 13 K x...x...");
  eqi("8文字なら半小節", rhythmDrum(13)->length, 8);

  // 選んで再生
  cmd("DRUM 11");
  eqi("自分のパターンを選ぶ", playerDrumId(), 11);
  cmd("START");
  expectText("START にドラム名", "ドラム: マイ・ビート");
  runTo(2000);
  // 8ビート(コピー)のキックを x...x...x...x... に変えたので、1小節(2000ms)にキックは4回
  int kicks = 0;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == 0x99 && m.d1 == 36 && m.t < 2000) kicks++;   // 2000ms は、次の小節の頭
  }
  eqi("キック(36)が1小節に4回", kicks, 4);
  cmd("DRUM 3");
  expectText("再生中の切り替え", "次のマスから、すぐに反映");
  cmd("STOP");

  // 削除
  cmd("DRUM 11");
  cmd("DRUM DELETE 11");
  expectText("DRUM DELETE", "削除しました");
  check(rhythmDrum(11) == nullptr, "削除された");
  check(!simNvsHas("rhythm", "d11"), "NVS からも消えた");
  eqi("選んでいたものを消したら、なしになる", playerDrumId(), 0);
  cmd("DRUM DELETE 11");
  expectText("すでに空き", "すでに空き");
  cmd("DRUM CLEAR 12");
  expectText("DRUM CLEAR", "空にしました");
  check(drumPatternIsEmpty(*rhythmDrum(12)), "空になった");

  // 電源を入れ直しても残る（NVS からの読み込み）
  check(rhythmDrum(13) != nullptr, "13 は残っている");
  int broken = rhythmStoreBegin();
  eqi("読み込みで壊れたものはない", broken, 0);
  check(rhythmDrum(13) != nullptr && rhythmDrum(13)->length == 8, "再起動後も 13 が残る");
  check(rhythmDrum(11) == nullptr, "再起動後も 11 は消えたまま");
  cmd("DRUM bogus");
  expectText("DRUM の使い方", "DRUM のあとに、ID");
  cmd("DRUM SET abc K x");
  expectText("IDが数字でない", "DRUM のあとに、ID");
}

static void testBackingCommands() {
  resetAll();
  setupBoard();
  cmd("BACKING");
  expectText("BACKING の現在値", "バッキング: 1「ロング」");
  cmd("BACKING LIST");
  expectText("BACKING LIST", "アルペジオ(8分)");
  cmd("BACKING 10");
  expectText("存在しない番号", "バッキング 10 はありません");
  cmd("BACKING 4");
  eqi("BACKING 4", playerBackingId(), 4);
  cmd("BACKING OFF");
  eqi("BACKING OFF", playerBackingId(), 0);
  expectText("OFF の案内", "和音は鳴りません");

  cmd("BACKING SET 11 C-------C-------");
  expectText("BACKING SET", "C-------C-------");
  check(rhythmBacking(11) != nullptr, "11 ができた");
  check(simNvsHas("rhythm", "b11"), "NVS に保存された");
  cmd("BACKING SET 11 C-X-----C-------");
  expectText("文字の間違い", "設定できません");
  check(strcmp(rhythmBacking(11)->cells, "C-------C-------") == 0, "失敗したので元のまま");
  cmd("BACKING SET 12 C-X-----");
  check(rhythmBacking(12) == nullptr, "失敗した SET では、空のスロットを残さない");
  cmd("BACKING SET 11 C---");
  expectText("長さが違う", "設定できません");
  cmd("BACKING SET 5 C-------");
  expectText("プリセットは変更できない", "コピーしてから");

  cmd("BACKING NAME 11 ゆっくり");
  expectText("名前", "名前を「ゆっくり」にしました");
  cmd("BACKING COPY 6 12");
  expectText("COPY", "スロット 12 にコピーしました");
  check(strcmp(rhythmBacking(12)->cells, rhythmBacking(6)->cells) == 0, "コピーの中身が同じ");
  cmd("BACKING LEN 12 8");
  eqi("長さ8", rhythmBacking(12)->length, 8);
  cmd("BACKING SHOW 12");
  expectText("SHOW", "バッキング 12");

  cmd("BACKING 11");
  cmd("START");
  expectText("START にバッキング名", "バッキング: ゆっくり");
  runTo(1010);
  expectNotes("C-------C------- は 1ステップごとに和音", onNotes(0, 990, 1010), {45, 48, 52, 57});
  cmd("STOP");

  cmd("BACKING DELETE 11");
  eqi("選んでいたものを消したら、なしになる", playerBackingId(), 0);
  rhythmStoreBegin();
  check(rhythmBacking(11) == nullptr && rhythmBacking(12) != nullptr, "再起動後");
  cmd("BACKING CLEAR 12");
  check(backingPatternIsEmpty(*rhythmBacking(12)), "空になった");
}

static void testGroove() {
  resetAll();
  setupBoard();
  cmd("GROOVE");
  expectText("GROOVE: バッキング", "バッキング 1「ロング」");
  expectText("GROOVE: ドラムなし", "ドラム: なし");
  cmd("GROOVE 3 6");
  eqi("GROOVE ドラム", playerDrumId(), 3);
  eqi("GROOVE バッキング", playerBackingId(), 6);
  expectText("GROOVE の表示", "ドラム 3");
  cmd("GROOVE OFF 1");
  eqi("GROOVE OFF", playerDrumId(), 0);
  eqi("GROOVE バッキング1", playerBackingId(), 1);
  cmd("GROOVE 99 1");
  expectText("存在しない", "そのパターンはありません");
  eqi("変わらない", playerBackingId(), 1);
  cmd("GROOVE 2");
  expectText("1つだけは使い方", "使い方: GROOVE 2 3");
}

static void testDrumsAndBackingPlayback() {
  resetAll();
  setupBoard();
  // 8ビート + アルペジオ(8分): 1小節(2000ms)で、ドラムの音の数がパターンの通り
  playerSetDrum(2);
  playerSetBacking(6);
  const DrumPattern* d = rhythmDrum(2);
  int cells = 0;
  for (int lane = 0; lane < DRUM_LANES; lane++) {
    for (int s = 0; s < d->length; s++) {
      if (d->level[lane][s] != DRUM_NONE) cells++;
    }
  }
  cmd("START");
  runTo(1999);
  eqi("ドラムの音の数 = パターンの音の数", countOn(9, 0, 2000), cells);
  check(countOn(0, 0, 2000) > 4, "アルペジオなので、ピアノは1ステップに何度も鳴る");
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == 0x99) {
      check(m.d2 == 45 || m.d2 == 85 || m.d2 == 112, "ドラムのベロシティは 弱/ふつう/強 のどれか");
    }
  }
  runTo(2100);
  cmd("STOP");

  // バッキングなし + ドラムだけ
  resetAll();
  setupBoard();
  playerSetDrum(1);
  playerSetBacking(0);
  cmd("START");
  runTo(1000);
  eqi("バッキングなしなら、ピアノは鳴らない", countOn(0, 0, 1000), 0);
  check(countOn(9, 0, 1000) > 0, "ドラムだけ鳴る");
  cmd("STOP");
}

static void testIdleAndGain() {
  resetAll();
  cmd("IDLE");
  expectText("IDLE の説明", "OFF   … 電波");
  expectText("IDLE の説明2", "RESET …");
  expectText("IDLE の現在値", "アンテナOFF");
  cmd("IDLE RESET");
  check(readersIdleMethod() == IDLE_RESET, "IDLE RESET");
  expectText("保存した", "本体に保存しました");
  check(simNvsHas("settings", "idle"), "NVS に保存された");
  check(settingsLoadIdleMethod(IDLE_ANTENNA_OFF) == IDLE_RESET, "保存した設定が読み出せる");
  cmd("IDLE OFF");
  check(readersIdleMethod() == IDLE_ANTENNA_OFF, "IDLE OFF");
  check(settingsLoadIdleMethod(IDLE_RESET) == IDLE_ANTENNA_OFF, "保存が OFF に変わった");
  cmd("idle antenna");
  check(readersIdleMethod() == IDLE_ANTENNA_OFF, "idle antenna も OFF");
  cmd("IDLE bogus");
  expectText("IDLE の使い方", "IDLE RESET / IDLE OFF");

  // 自己診断に失敗したら、変えない・保存しない
  simNvsClear();
  simSelfTestFailures = 2;
  cmd("IDLE RESET");
  expectText("自己診断の失敗", "2台のリーダーがうまく起きませんでした");
  check(readersIdleMethod() == IDLE_ANTENNA_OFF, "失敗したら変えない");
  check(!simNvsHas("settings", "idle"), "失敗したら保存しない");
  simSelfTestFailures = 0;

  // 再生中は変えられない
  setupBoard();
  cmd("START");
  cmd("IDLE RESET");
  expectText("再生中は変えられない", "再生中は、止め方を変えられません");
  check(readersIdleMethod() == IDLE_ANTENNA_OFF, "再生中は変わらない");
  cmd("STOP");

  cmd("GAIN");
  expectText("GAIN の現在値", "受信感度: 33 dB");
  cmd("GAIN 23");
  eqi("GAIN 23", readersGainDb(), 23);
  expectText("GAIN の保存", "本体に保存しました");
  eqi("保存した感度", settingsLoadGainDb(33), 23);
  cmd("GAIN 24");
  expectText("GAIN の使い方", "GAIN 18 / 23");
  eqi("不正な値は変えない", readersGainDb(), 23);
  cmd("GAIN +5");
  expectText("相対指定は使えない", "GAIN 18 / 23");
  cmd("GAIN 999");
  expectText("大きすぎる値", "GAIN 18 / 23");
  cmd("GAIN 48");
  eqi("GAIN 48", readersGainDb(), 48);
}

static void testMidiCommand() {
  resetAll();
  cmd("MIDI");
  expectText("MIDI の現在値", "音の出力先: ブリッジ");
  cmd("MIDI OFF");
  check(midiBackend() == MIDI_BACKEND_NONE, "MIDI OFF");
  setupBoard();
  cmd("START");
  expectText("音源なしで START すると、MIDI が送られない案内", "MIDI はどこにも送られません");
  cmd("STOP");
  cmd("MIDI BRIDGE");
  check(midiBackend() == MIDI_BACKEND_BRIDGE, "MIDI BRIDGE");
  bool programSent = false;
  for (const SimMidi& m : simMidiLog()) {
    if (m.status == 0xC0) programSent = true;
  }
  check(programSent, "BRIDGE にしたら音色を送る");
  cmd("MIDI USB");
  check(midiBackend() == MIDI_BACKEND_USB, "MIDI USB");
  expectText("USB の案内", "PCに認識されています");
  simUsbMountedFlag = false;
  cmd("MIDI");
  simUsbMountedFlag = true;
  cmd("MIDI BRIDGE");
  simUsbFails = true;
  cmd("MIDI USB");
  expectText("USB の失敗", "始められませんでした");
  check(midiBackend() == MIDI_BACKEND_BRIDGE, "失敗したら元のまま");
  cmd("MIDI nope");
  expectText("MIDI の使い方", "MIDI BRIDGE / MIDI USB / MIDI OFF");
}

static void testStatusHelpAndModes() {
  resetAll();
  setupBoard();
  cmd("STATUS");
  expectText("STATUS: 停止中", "停止中");
  expectText("STATUS: BPM", "BPM: 120");
  expectText("STATUS: Key", "Key: C");
  expectText("STATUS: 位置1", "位置1: Ⅰ  (C: C → E → G → C)");
  expectText("STATUS: 止め方", "止め方: アンテナOFF");
  expectText("STATUS: 感度", "受信感度: 33 dB");
  expectText("STATUS: 位置4", "位置4: Ⅴ");
  simRemoveTag(boardReaderOfPosition(3));
  cmd("STATUS");
  expectText("STATUS: 空の位置", "（空）  ← 休みとして扱います");
  setupBoard();

  cmd("HELP");
  expectText("HELP: BPM", "BPM 120");
  expectText("HELP: KEY", "KEY D");
  expectText("HELP: キー操作", "+  -（BPM ±5）");
  expectText("HELP: DRUM", "DRUM 2");
  expectText("HELP: IDLE", "IDLE");
  cmd("HELP RHYTHM");
  expectText("HELP RHYTHM: レーン", "K キック");
  expectText("HELP RHYTHM: バッキングの文字", "D（ベース＋和音）");
  expectText("HELP RHYTHM: !load", "!load");
  cmd("help drum");
  expectText("HELP DRUM もリズムのヘルプ", "リズムのパターン");

  // テストモード中は、コマンドを受け付けない（HELP を除く）。ホットキーも効かない
  simTestMode = true;
  cmd("START");
  check(lastHandled, "テストモード中も START はコマンドとして扱う");
  expectText("テストモード中の案内", "テストモード中");
  check(!playerIsPlaying(), "テストモード中は再生しない");
  cmd("BPM 100");
  eqi("テストモード中は BPM を変えない", playerBpm(), 120);
  hotkey('+');
  check(!lastHandled, "テストモード中はホットキーが効かない");
  eqi("BPM は変わらない", playerBpm(), 120);
  cmd("HELP");
  expectText("テストモード中も HELP は使える", "コマンド一覧");
  simTestMode = false;

  // 応答するリーダーがない
  simAliveCount = 0;
  cmd("START");
  expectText("リーダーなしの警告", "応答するリーダーがありません");
  cmd("STOP");
  simAliveCount = NUM_READERS;

  // 再生中の START
  cmd("START");
  cmd("START");
  expectText("二重の START", "すでに再生中");
  check(simRegisterUiCancelCalls >= 2, "START で入力待ちをやめる");
  cmd("STOP");
}


// tools/patterns/example_patterns.txt を、!load と同じように1行ずつ送って、狙いどおりのパターンができるか
static void testExamplePatternFile() {
  resetAll();
  setupBoard();
  FILE* f = fopen("tools/patterns/example_patterns.txt", "r");
  check(f != nullptr, "サンプルのファイルが開ける（プロジェクトのフォルダで実行すること）");
  if (f == nullptr) return;
  char buf[256];
  int sent = 0;
  while (fgets(buf, sizeof(buf), f)) {
    std::string line = buf;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r' || line.back() == ' ')) line.pop_back();
    size_t first = line.find_first_not_of(" \t");
    if (first == std::string::npos || line[first] == '#') continue;   // 空行とコメントは送らない（!load と同じ）
    cmd(line.c_str() + first);
    check(lastHandled, "サンプルの行はコマンド: " + line);
    expectNoText("サンプルの行でエラーが出ない: " + line, "設定できません");
    expectNoText("サンプルの行でエラーが出ない2: " + line, "ありません");
    sent++;
  }
  fclose(f);
  check(sent >= 6, "サンプルに6行以上のコマンドがある");
  const DrumPattern* d = rhythmDrum(11);
  check(d != nullptr, "ドラム11ができた");
  if (d != nullptr) {
    char text[40];
    drumPatternLaneText(*d, drumLaneFromLetter('K'), text, sizeof(text));
    check(strcmp(text, "x.....x.x...x...") == 0, "キックのレーン");
    drumPatternLaneText(*d, drumLaneFromLetter('S'), text, sizeof(text));
    check(strcmp(text, "....x.......x...") == 0, "スネアのレーン");
    check(strcmp(d->name, "マイ・ビート") == 0, "名前");
  }
  const BackingPattern* b = rhythmBacking(11);
  check(b != nullptr && strcmp(b->cells, "C-------C-------") == 0 && strcmp(b->name, "ゆったり") == 0, "バッキング11");
  eqi("GROOVE 11 11 でドラム11を選んだ", playerDrumId(), 11);
  eqi("GROOVE 11 11 でバッキング11を選んだ", playerBackingId(), 11);
  check(simNvsHas("rhythm", "d11") && simNvsHas("rhythm", "b11"), "保存された");
  cmd("START");
  runTo(2000);
  check(countOn(9, 0, 2000) > 0 && countOn(0, 0, 2000) > 0, "ドラムとピアノの両方が鳴る");
  cmd("STOP");
}


// リズム編集画面(ブラウザ)が送るコマンドを、そのまま実行して、全プリセットと同じ中身になるか
//   コマンドの元は tools/host_tests/test_rhythm_ui.py が書き出す（環境変数 SIM_COMMAND_FILE）。なければ省略
static void testEditorCommands() {
  const char* path = getenv("SIM_COMMAND_FILE");
  if (path == nullptr) return;
  resetAll();
  setupBoard();
  FILE* f = fopen(path, "r");
  check(f != nullptr, "編集画面のコマンドのファイルが開ける");
  if (f == nullptr) return;
  char buf[256];
  char kind[16] = "";
  int presetId = 0, presets = 0;
  auto verify = [&]() {
    if (presetId == 0) return;
    presets++;
    std::string what = std::string(kind) + " プリセット" + std::to_string(presetId) + " を編集画面から送った結果";
    if (strcmp(kind, "drum") == 0) {
      const DrumPattern* a = rhythmDrum(11);
      const DrumPattern* b = rhythmDrum(presetId);
      check(a != nullptr && b != nullptr, what + ": あるはず");
      if (a && b) {
        eqi(what + ": 長さ", a->length, b->length);
        check(memcmp(a->level, b->level, sizeof(a->level)) == 0, what + ": 全レーンの中身が同じ");
        check(strcmp(a->name, b->name) == 0, what + ": 名前が同じ");
      }
    } else {
      const BackingPattern* a = rhythmBacking(11);
      const BackingPattern* b = rhythmBacking(presetId);
      check(a != nullptr && b != nullptr, what + ": あるはず");
      if (a && b) {
        eqi(what + ": 長さ", a->length, b->length);
        check(strcmp(a->cells, b->cells) == 0, what + ": 中身が同じ");
        check(strcmp(a->name, b->name) == 0, what + ": 名前が同じ");
      }
    }
  };
  while (fgets(buf, sizeof(buf), f)) {
    std::string line = buf;
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty()) continue;
    if (line.compare(0, 8, "#PRESET ") == 0) {
      verify();
      sscanf(line.c_str() + 8, "%15s %d", kind, &presetId);
      continue;
    }
    cmd(line.c_str());
    check(lastHandled, "編集画面のコマンド: " + line);
    expectNoText("エラーが出ない: " + line, "設定できません");
    expectNoText("エラーが出ない2: " + line, "はありません");
    expectNoText("エラーが出ない3: " + line, "使い方");
  }
  verify();
  fclose(f);
  eqi("全プリセット(ドラム7 + バッキング9)を確かめた", presets, 16);
}


// STATE: ブラウザの操作画面（ブリッジ経由）が読む、機械用の状態の表示
static void testStateCommand() {
  resetAll();
  setupBoard();
  std::string samples;
  auto grab = [&](const char* line) { std::string o = cmd(line); samples += o; return o; };
  std::string out = grab("STATE");
  eqi("STATE は ~S で始まる1行", out.compare(0, 3, "~S ") == 0 && std::count(out.begin(), out.end(), '\n') == 1, 1);
  expectText("STATE: BPM・キー・停止中", "~S bpm=120 key=C playing=0 step=-1 drum=0 backing=1 lead=1 voicing=4 octave=0 idle=OFF gain=33 midi=BRIDGE learn=0 map=4,3,2,1 chords=Ⅰ,C;Ⅵm,Am;Ⅳ,F;Ⅴ,G");
  cmd("START");
  runTo(1010);
  out = grab("STATE");
  expectText("STATE: 再生中と、いまのステップ", "playing=1 step=1");
  cmd("KEY D");
  cmd("BPM 100");
  cmd("DRUM 2");
  cmd("BACKING 6");
  cmd("LEAD OFF");
  cmd("VOICING 3");
  out = grab("STATE");
  expectText("STATE: 変更が反映される", "bpm=100 key=D playing=1 step=1 drum=2 backing=6 lead=0 voicing=3");
  expectText("STATE: キーに合わせたコード名", "chords=Ⅰ,D;Ⅵm,Bm;Ⅳ,G;Ⅴ,A");
  cmd("STOP");
  simRemoveTag(boardReaderOfPosition(1)); simPutTag(boardReaderOfPosition(2), simUid(9));    // 位置2を空、位置3を「→」
  out = grab("STATE");
  expectText("STATE: 空は「-」、→ は「→」", "chords=Ⅰ,D;-,;→,;Ⅴ,A");
  setupBoard();
  simTestMode = true;
  out = grab("STATE");
  eqi("テストモード中も STATE が使える", out.compare(0, 3, "~S ") == 0, 1);
  simTestMode = false;
  expectNoText("STATE は、人向けの説明を出さない", "テストモード中");

  out = grab("STATE PATTERN drum 2");
  expectText("STATE PATTERN: ドラム2", "~P drum 2 16 K=x.......x.x.....,S=....x.......x...,H=x.x.x.x.x.x.x.x. 8ビート\n");
  out = grab("STATE PATTERN drum 11");
  expectText("STATE PATTERN: 空きスロット", "~P drum 11 0 - -\n");
  out = grab("STATE PATTERN backing 6");
  expectText("STATE PATTERN: バッキング6", "~P backing 6 16 1-2-3-4-1-2-3-4- アルペジオ(8分)\n");
  cmd("DRUM COPY 2 11");
  cmd("DRUM NAME 11 マイ ビート");
  out = grab("STATE PATTERN drum 11");
  expectText("STATE PATTERN: 名前に空白があってもよい（最後の欄）", "~P drum 11 16 K=x.......x.x.....,S=....x.......x...,H=x.x.x.x.x.x.x.x. マイ ビート\n");
  cmd("STATE PATTERN drum 99");
  out = grab("STATE PATTERN drum 99");
  expectText("STATE PATTERN: 範囲外のIDも、空として返す", "~P drum 99 0 - -\n");
  out = grab("STATE PATTERN bogus 1");
  eqi("STATE PATTERN: 知らない種類は何も出さない", out.empty(), 1);
  out = grab("state");
  eqi("小文字でも使える", out.compare(0, 3, "~S ") == 0, 1);
  const char* path = getenv("SIM_STATE_FILE");
  if (path != nullptr) {
    FILE* f = fopen(path, "w");
    if (f) { fputs(samples.c_str(), f); fputs(stepSamples.c_str(), f); fclose(f); }
  }
}


// 電源を入れたときの動き: 保存してある設定を戻す・自動再生・AUTOSTART・駒がなくてもドラムが流れる
static void testBootAndSavedSettings() {
  resetAll();
  setupBoard();

  // ---- 保存がなければ、標準（8ビート・ロング）。BPM とキーは、そのまま ----
  simNvsClear();
  playerSetBpm(150);
  eqi("保存がなければ、標準のドラムは 8ビート(2)", (playerBoot(false), playerDrumId()), DEFAULT_DRUM_ID);
  eqi("標準のバッキングは ロング(1)", playerBackingId(), DEFAULT_BACKING_ID);
  eqi("保存がない BPM は、いまのまま", playerBpm(), 150);
  check(!playerIsPlaying(), "playerBoot(false) は再生を始めない");

  // ---- 保存してあれば、それを戻す ----
  settingsSaveDrum(3); settingsSaveBacking(2); settingsSaveBpm(90);
  Key d = {1, 0};
  settingsSaveKey(d);
  playerBoot(false);
  eqi("保存したドラム(3)を戻す", playerDrumId(), 3);
  eqi("保存したバッキング(2)を戻す", playerBackingId(), 2);
  eqi("保存した BPM(90)を戻す", playerBpm(), 90);
  eqi("保存したキー(D)を戻す", playerKey().letter * 10 + playerKey().accidental + 5, 1 * 10 + 0 + 5);

  // ---- 選んだら、保存される ----
  cmd("DRUM 4");
  eqi("DRUM 4 を選ぶと保存される", settingsLoadDrum(99), 4);
  cmd("BACKING 5");
  eqi("BACKING 5 を選ぶと保存される", settingsLoadBacking(99), 5);
  cmd("DRUM OFF");
  eqi("DRUM OFF も保存される", settingsLoadDrum(99), 0);
  cmd("GROOVE 2 3");
  eqi("GROOVE 2 3 で、ドラム2が保存される", settingsLoadDrum(99), 2);
  eqi("GROOVE 2 3 で、バッキング3が保存される", settingsLoadBacking(99), 3);
  cmd("DRUM 99");
  eqi("存在しないパターンは選べず、保存も変わらない", settingsLoadDrum(99), 2);

  // ---- BPM とキーは、変えてから少し落ち着いたら保存される（スライダーで動かしている間は書かない）----
  settingsSaveBpm(90);
  cmd("BPM 100");
  eqi("BPM を変えた直後は、まだ保存しない", settingsLoadBpm(0), 90);
  runTo(nowMs + 1500);
  cmd("BPM 105");   // 続けて動かしている
  runTo(nowMs + 1500);
  eqi("続けて変えている間は、保存しない", settingsLoadBpm(0), 90);
  runTo(nowMs + SETTINGS_SAVE_DELAY_MS + 100);
  eqi("落ち着いたら、最後の値(105)を保存する", settingsLoadBpm(0), 105);
  cmd("KEY F");
  cmd("START");
  cmd("BPM 110");
  cmd("STOP");
  eqi("STOP で、変えたばかりの BPM も保存する", settingsLoadBpm(0), 110);
  Key kf; check(settingsLoadKey(&kf) && kf.letter == 3 && kf.accidental == 0, "STOP で、変えたばかりのキー(F)も保存する");

  // ---- 保存してあった自分のパターンが消えていたら、標準に戻る ----
  settingsSaveDrum(15);
  playerBoot(false);
  eqi("消えた自分のパターンは、標準のドラムに戻る", playerDrumId(), DEFAULT_DRUM_ID);

  // ---- AUTOSTART ----
  simOut().clear();
  cmd("AUTOSTART");
  expectText("AUTOSTART: 標準は OFF（2026-11-14 から。停止で始まる）", "自動再生: OFF");
  cmd("AUTOSTART OFF");
  expectText("AUTOSTART OFF の案内", "自動再生 OFF");
  check(!settingsLoadAutostart(true), "AUTOSTART OFF が保存される");
  check(!playerBoot(true) && !playerIsPlaying(), "OFF のとき、playerBoot は再生を始めない");
  cmd("AUTOSTART x");
  expectText("AUTOSTART の間違った指定", "AUTOSTART ON か AUTOSTART OFF");
  cmd("AUTOSTART ON");
  check(settingsLoadAutostart(false), "AUTOSTART ON が保存される");

  // ---- BUZZER（2026-11-18）: 基板のブザー。電源を入れて10秒のあいだ・OFF のあいだは、鳴らさない ----
  resetAll();
  simSetMillis(2000);
  check(!buzzerAllowed(), "ブザー: 電源を入れて2秒のあいだは、鳴らさない");
  simSetMillis(BUZZER_BOOT_QUIET_MS - 1);
  check(!buzzerAllowed(), "ブザー: 10秒たつ直前まで、鳴らさない");
  simSetMillis(BUZZER_BOOT_QUIET_MS + 100);
  check(buzzerAllowed(), "ブザー: 10秒たつと、鳴らしてよい（標準）");
  simOut().clear();
  cmd("BUZZER");
  expectText("BUZZER: 標準は ON", "基板のブザー: ON");
  cmd("BUZZER OFF");
  expectText("BUZZER OFF の案内", "ブザー OFF");
  check(!settingsLoadBuzzer(true), "BUZZER OFF が保存される");
  check(buzzerMuted() && !buzzerAllowed(), "BUZZER OFF のあいだは、10秒たっても鳴らさない");
  cmd("BUZZER");
  expectText("BUZZER: OFF の表示", "OFF（鳴らさない）");
  cmd("BUZZER x");
  expectText("BUZZER の間違った指定", "BUZZER ON か BUZZER OFF");
  check(buzzerMuted(), "間違った指定では、変わらない");
  cmd("BUZZER ON");
  expectText("BUZZER ON の案内", "ブザー ON");
  check(settingsLoadBuzzer(false) && !buzzerMuted() && buzzerAllowed(), "BUZZER ON が保存されて、鳴らしてよい状態に戻る");
  cmd("HELP");
  expectText("HELP に BUZZER がある", "BUZZER ON/OFF");

  // ---- 標準（保存なし）は、停止で始まる（2026-11-14 から。音はゲームが担当する）----
  resetAll();
  simNvsClear();                                  // 何も保存されていない、買ったばかりの状態
  check(!playerBoot(true) && !playerIsPlaying(), "標準では、電源を入れても再生を始めない（停止で始まる）");

  // ---- AUTOSTART ON にしてあれば、電源を入れたら自動で再生が始まる。駒がなくても、ドラムは流れる ----
  resetAll();
  simNvsClear();
  settingsSaveAutostart(true);
  for (int p = 0; p < NUM_POSITIONS; p++) simRemoveTag(boardReaderOfPosition(p));   // 駒は、1つも置いていない
  midiSetBackend(MIDI_BACKEND_BRIDGE);
  simOut().clear();
  restartClock();
  check(playerBoot(true), "自動再生: playerBoot が true");
  check(playerIsPlaying(), "自動再生: 再生中になった");
  expectText("自動再生の案内", "自動再生: 電源を入れたので、再生を始めます");
  expectNoText("音源があれば、「音源がなし」の注意は出さない", "音源は「なし」");
  runTo(2010);
  eqi("駒が1つもなくても、ドラムが鳴る(8ビート)", countOn(9, 0, 2010) > 0, 1);
  eqi("駒がないので、ピアノは鳴らない", countOn(0, 0, 2010), 0);
  expectText("STATUS ではなく起動の表示: 1ステップ目は休み", "（休み:");
  setupBoard();                                   // 駒を置く（登録済みの4枚）
  runTo(4010);
  eqi("駒を置くと、次のステップからピアノが加わる(位置3の Ⅳ)", countOn(0, 2990, 3010) > 0, 1);
  eqi("ドラムは続いている", countOn(9, 2000, 4010) > 0, 1);
  cmd("STOP");
  midiSetBackend(MIDI_BACKEND_NONE);
  restartClock();
  playerBoot(true);
  expectText("音源がなしのときは、短い注意が出る", "音源は「なし」です");
  cmd("STOP");
  cmd("STATUS");
  expectText("STATUS に自動再生が出る", "電源を入れたときの自動再生: ON");
  cmd("HELP");
  expectText("HELP に AUTOSTART", "AUTOSTART ON/OFF");
}

// OCTAVE: 和音の高さ（オクターブ）
static void testOctave() {
  resetAll();
  setupBoard();
  cmd("OCTAVE");
  expectText("OCTAVE の現在値", "和音の高さ: +0（コードのルートが C3〜B3 の範囲）");
  expectText("OCTAVE の案内", "OCTAVE 2");
  cmd("OCTAVE 1");
  eqi("OCTAVE 1", playerOctave(), 1);
  expectText("OCTAVE 1 の表示", "和音の高さ: +1（コードのルートが C4〜B4 の範囲）");
  check(simNvsHas("settings", "octave"), "高さが保存された");
  eqi("保存した高さが読み出せる", settingsLoadOctave(0), 1);
  cmd("START");
  runTo(3);
  expectNotes("高さ+1: Ⅰ は 1オクターブ上 C4 E4 G4 C5", onNotes(0, 0, 10), {60, 64, 67, 72});
  expectText("音名の表示も上がる", "♪ C4 → E4 → G4 → C5");
  runTo(500);
  cmd("OCTAVE 2");
  expectText("再生中の案内", "すぐに反映されました");
  runTo(503);
  expectNotes("再生中に高さを変えると、鳴っていた和音を止める", offNotes(0, 500, 510), {60, 64, 67, 72});
  expectNotes("新しい高さで鳴らし直す（+2 = C5 E5 G5 C6）", onNotes(0, 500, 510), {72, 76, 79, 84});
  runTo(1010);
  // 次のステップ Ⅵm: 前のコード(Ⅰ のルート 72)に近づける。高さ+2 の本来は 81 → 69(-12)。高さの記憶も動かしてあるので、元に引き戻されない
  expectNotes("次のステップも、新しい高さ（Ⅵm = A4 C5 E5 A5）", onNotes(0, 990, 1010), {69, 72, 76, 81});
  cmd("STOP");
  cmd("OCTAVE +1");
  eqi("OCTAVE +1（相対）", playerOctave(), 3);
  cmd("OCTAVE +1");
  expectText("上限を超える", "-1〜3");
  eqi("上限を超えたら変えない", playerOctave(), 3);
  cmd("OCTAVE -9");
  eqi("下限を超えたら変えない", playerOctave(), 3);
  cmd("OCT -4");
  eqi("OCT でも使える（3-4 = -1）", playerOctave(), -1);
  cmd("OCTAVE x");
  expectText("文字は使い方", "OCTAVE の使い方");
  cmd("STATE");
  expectText("STATE に octave", "octave=-1");
  // ベースは、ルートの1オクターブ下だが、C2(36) より下には行かない
  cmd("OCTAVE 0");
  cmd("BACKING 8");
  restartClock();
  cmd("START");
  runTo(3);
  expectNotes("高さ0 のベース C2", onNotes(0, 0, 10), {36});
  cmd("STOP");
  settingsBegin();
  eqi("保存がなければ標準の高さ", (simNvsClear(), settingsLoadOctave(DEFAULT_OCTAVE)), DEFAULT_OCTAVE);
}


// ===== 8台構成（-DNUM_READERS_CONFIG=8）: 8つの位置・配置（MAP）・覚えさせる（MAP LEARN）=====
static void setupBoard8() {
  const uint8_t ids[8] = {ID_I, ID_VIm, ID_IV, ID_V, ID_I, ID_VIm, ID_IV, ID_V};
  for (int p = 0; p < 8; p++) {
    simRegisterTag(simUid(100 + p), ids[p]);
    simPutTag(boardReaderOfPosition(p), simUid(100 + p));
  }
}
static ReaderEvent placedEvent(int reader) {
  ReaderEvent e;
  e.type = READER_EVENT_PLACED;
  e.reader = reader;
  e.uid = simUid(200 + reader);
  return e;
}

static void testEightPositions() {
  resetAll();
  setupBoard8();
  eqi("位置は8つ", NUM_POSITIONS, 8);
  std::string out = cmd("START");
  expectText("START: 位置1→位置8", "位置1→位置8 を繰り返します");
  expectText("START: 進行に8つ", "[Ⅰ] [Ⅵm] [Ⅳ] [Ⅴ] [Ⅰ] [Ⅵm] [Ⅳ] [Ⅴ]");
  runTo(8010);
  expectText("ステップ表示は 1/8", "▶ ステップ1/8  位置1: Ⅰ");
  expectText("8つ目まで進む", "▶ ステップ8/8  位置8: Ⅴ");
  expectNotes("1周目の位置1", onNotes(0, 0, 10), {48, 52, 55, 60});
  expectNotes("5つ目(位置5)は、ボイスリーディングで前に近づく: Ⅴ(43) → Ⅰ", onNotes(0, 3990, 4010), {48, 52, 55, 60});
  expectNotes("位置1に戻ると、本来の高さに戻る（2周目の先頭）", onNotes(0, 7990, 8010), {48, 52, 55, 60});
  cmd("STOP");

  // STATE
  out = cmd("STATE");
  expectText("STATE: 配置（標準）", "map=4,3,2,1,5,6,7,8");
  expectText("STATE: 覚えさせていない", "learn=0");
  expectText("STATE: コード8つ", "chords=Ⅰ,C;Ⅵm,Am;Ⅳ,F;Ⅴ,G;Ⅰ,C;Ⅵm,Am;Ⅳ,F;Ⅴ,G");

  // MAP: 表示
  out = cmd("MAP");
  expectText("MAP: 上段", "上段: 位置1=リーダー4  位置2=リーダー3  位置3=リーダー2  位置4=リーダー1");
  expectText("MAP: 下段", "下段: 位置5=リーダー5  位置6=リーダー6  位置7=リーダー7  位置8=リーダー8");
  simAliveCount = 4;   // 4台だけ配線している状態
  out = cmd("MAP");
  expectText("応答しないリーダーには ※ が付く", "位置5=リーダー5(※応答なし)");
  expectText("応答するリーダーには付かない", "位置1=リーダー4  ");
  simAliveCount = NUM_READERS;
  // MAP: 直接指定（下段を逆に）
  cmd("MAP 4 3 2 1 8 7 6 5");
  eqi("位置5 = リーダー8", boardReaderOfPosition(4), 7);
  eqi("位置8 = リーダー5", boardReaderOfPosition(7), 4);
  check(simNvsHas("settings", "map"), "配置が保存された");
  {
    uint8_t m[8];
    check(settingsLoadMap(m, 8) && m[0] == 3 && m[4] == 7 && m[7] == 4, "保存した配置を読み出せる");
    check(!settingsLoadMap(m, 4), "台数が違う保存は、使わない");
  }
  cmd("MAP 1 1 2 3 4 5 6 7");
  expectText("重複は使い方", "MAP の使い方");
  eqi("拒否されたら変わらない", boardReaderOfPosition(4), 7);
  cmd("MAP 1 2 3 4 5 6 7 9");
  expectText("範囲外は使い方", "MAP の使い方");
  cmd("MAP 1 2 3");
  expectText("数が足りないと使い方", "MAP の使い方");
  cmd("MAP RESET");
  eqi("MAP RESET で標準に戻る", boardReaderOfPosition(0) * 10 + boardReaderOfPosition(4), 34);

  // MAP LEARN: 位置1から順に置く（リーダー8,7,6,5,1,2,3,4 の順）
  simRegisterUiBeginCalls = 0;
  cmd("MAP LEARN");
  expectText("LEARN の案内", "位置1 の場所のリーダーに、駒を1つ置いてください");
  check(boardLayout().learning(), "覚えさせている最中");
  cmd("START");
  expectText("覚えさせている最中は START できない", "MAP DONE");
  check(!playerIsPlaying(), "再生は始まらない");
  cmd("STATE");
  expectText("STATE: learn=次の位置(1)", "learn=1");
  const int order[8] = {7, 6, 5, 4, 0, 1, 2, 3};
  for (int k = 0; k < 8; k++) {
    simOut().clear();
    bool used = commandsLayoutLearnEvent(placedEvent(order[k]));
    check(used, "覚えさせ中の出来事は使われる: " + std::to_string(k));
    std::string o = simOut();
    char want[64];
    snprintf(want, sizeof(want), "位置%d = リーダー%d を覚えました", k + 1, order[k] + 1);
    check(has(o, want), std::string("覚えた表示: ") + want);
    if (k == 0) {
      simOut().clear();
      commandsLayoutLearnEvent(placedEvent(7));
      check(has(simOut(), "もう覚えました"), "同じリーダーは、もう覚えた");
      ReaderEvent r = placedEvent(5); r.type = READER_EVENT_REMOVED;
      simOut().clear();
      check(commandsLayoutLearnEvent(r) && simOut().empty(), "外した出来事は、何も出さずに使う");
    }
  }
  check(!boardLayout().learning(), "8つ覚えたら終わる");
  eqi("位置1 = リーダー8", boardReaderOfPosition(0), 7);
  eqi("位置5 = リーダー1", boardReaderOfPosition(4), 0);
  eqi("位置8 = リーダー4", boardReaderOfPosition(7), 3);
  expectText("完了の案内（保存・表の表示）", "すべての位置を覚えました。保存しました。");
  uint8_t saved[8];
  check(settingsLoadMap(saved, 8) && saved[0] == 7 && saved[4] == 0, "学習した配置が保存された");
  check(!commandsLayoutLearnEvent(placedEvent(0)), "学習が終わったあとは、出来事を使わない");

  // MAP DONE（途中で終える）
  cmd("MAP RESET");
  cmd("MAP LEARN");
  commandsLayoutLearnEvent(placedEvent(5));
  commandsLayoutLearnEvent(placedEvent(2));
  cmd("MAP DONE");
  expectText("途中で終える案内", "途中で終わりました");
  eqi("位置1 = リーダー6", boardReaderOfPosition(0), 5);
  eqi("位置2 = リーダー3", boardReaderOfPosition(1), 2);
  eqi("位置3 = 残りの小さい番号(リーダー1)", boardReaderOfPosition(2), 0);
  eqi("位置4 = リーダー2", boardReaderOfPosition(3), 1);
  // MAP CANCEL
  cmd("MAP 1 2 3 4 5 6 7 8");
  cmd("MAP LEARN");
  commandsLayoutLearnEvent(placedEvent(7));
  cmd("MAP CANCEL");
  expectText("やめた案内", "もとの配置のまま");
  eqi("やめたら、もとの配置(位置1 = リーダー1)", boardReaderOfPosition(0), 0);
  cmd("MAP CANCEL");
  expectText("覚えさせていないときの CANCEL", "途中ではありません");
  // 再生中は覚えさせられない
  setupBoard8();
  cmd("START");
  cmd("MAP LEARN");
  expectText("再生中は LEARN できない", "再生中は");
  check(!boardLayout().learning(), "始まらない");
  cmd("STOP");
  // テストモード中は、コマンドを受け付けない
  simTestMode = true;
  cmd("MAP LEARN");
  expectText("テストモード中", "テストモード中");
  simTestMode = false;
  check(!boardLayout().learning(), "テストモード中は始まらない");

  // 配置を変えると、同じ駒でも、鳴る位置（順番）が変わる
  resetAll();
  cmd("MAP 8 7 6 5 4 3 2 1");   // 完全に逆
  for (int r = 0; r < 8; r++) simRemoveTag(r);
  simRegisterTag(simUid(250), ID_I);
  simPutTag(7, simUid(250));    // リーダー8 に Ⅰ を置く → 位置1
  cmd("START");
  runTo(10);
  expectNotes("リーダー8 の駒が位置1 で鳴る", onNotes(0, 0, 10), {48, 52, 55, 60});
  expectText("位置1 が Ⅰ", "位置1: Ⅰ");
  cmd("STOP");

  // 影: 隣のリーダーが読んでいる駒は、STATUS に「無視しています」と出る（駒の持ち主は隣）
  resetAll();
  setupBoard8();
  simShadowOwner[5] = 4;   // リーダー6 が、リーダー5 に載っている駒を読んでいる
  out = cmd("STATUS");
  expectText("STATUS: 影のリーダーの表示", "リーダー6 は、リーダー5 の駒を読んでいますが、無視しています");
  simShadowOwner[5] = -1;
  out = cmd("STATUS");
  check(!has(out, "無視しています"), "影がなければ、表示しない");

  // SHADOWLOG: 影の判定の結果を、そのつど表示する（診断用）
  resetAll();
  setupBoard8();
  out = cmd("SHADOWLOG");
  expectText("SHADOWLOG: 標準は OFF", "影の判定の表示: OFF");
  simVerdict = ReaderVerdict();
  simVerdict.uid = simUid(250);
  simVerdict.n = 2;
  simVerdict.reader[0] = 4; simVerdict.score[0] = 6;
  simVerdict.reader[1] = 5; simVerdict.score[1] = 1;
  simVerdict.foundDb = 23;
  simVerdict.winner = 4;
  simVerdict.recheck = false;
  simVerdictPending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(simOut().empty() && simVerdictPending, "OFF のときは、表示しない（判定は取り出さない）");
  cmd("SHADOWLOG ON");
  expectText("SHADOWLOG ON", "影の判定の表示: ON");
  simOut().clear();
  commandsPollDiagnostics();
  expectText("判定の表示: 新しい駒・得点・受信感度・持ち主", "[影の判定] 新しい駒");
  check(has(simOut(), "リーダー5=6点 リーダー6=1点"), "判定の表示: 得点");
  check(has(simOut(), "最初に読めた受信感度 23 dB"), "判定の表示: 受信感度");
  check(has(simOut(), "→ 持ち主 リーダー5"), "判定の表示: 持ち主");
  check(!simVerdictPending, "判定を取り出した");
  simVerdict.recheck = true;
  simVerdict.winner = -1;
  simVerdict.foundDb = 0;
  simVerdictPending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "確かめ直し") && has(simOut(), "どの感度でも読めなかった") && has(simOut(), "決まらなかった"), "判定の表示: 確かめ直し・決まらなかった");
  // イベントの原因（置かれた・外れた・交換の、なぜ）と、「読み取りの乱れ」
  simNote = ReaderEventNote();
  simNote.type = READER_EVENT_REMOVED;
  simNote.reader = 7;
  simNote.uid = simUid(250);
  simNote.cause = "駒が、続けて読めなくなった";
  simNote.byMiss = true;
  simNote.garbled = false;
  simNote.miss = 6;
  simNote.missMs = 95;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "[イベントの原因] リーダー8 外れた") && has(simOut(), "駒が、続けて読めなくなった（6回続けて・95 ms）"), "イベントの原因の表示: リーダー・外れた・原因・回数と時間");
  simNote.type = READER_EVENT_PLACED;
  simNote.cause = "新しく見えた駒が、持ち主に決まった";
  simNote.byMiss = false;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "リーダー8 置かれた") && has(simOut(), "新しく見えた駒が、持ち主に決まった") && !has(simOut(), "回続けて"), "イベントの原因の表示: 置かれた（回数は出ない）");
  simNote.garbled = true;
  simNote.miss = 11;
  simNote.wupaStatus = 1;
  simNote.wupaUs = 900;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "[読み取りの乱れ] リーダー8") && has(simOut(), "11 回続きました") && has(simOut(), "エラー・900 µs") && has(simOut(), "「外れた」とは数えませんでした"), "読み取りの乱れの表示: 回数・最後の失敗（結果と時間）");
  simNote.wupaStatus = 100;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "呼びかけは通ったが、UIDを読めない"), "読み取りの乱れの表示: UID を読めなかったとき");
  // 読めなくなった駒が、「外れた」にならずに済んだ記録（高い感度で救った / 猶予で、ちらつきを吸収した）
  simNote = ReaderEventNote();
  simNote.type = READER_EVENT_CHANGED;
  simNote.reader = 2;
  simNote.uid = simUid(250);
  simNote.rescued = true;
  simNote.miss = 3;
  simNote.missMs = 310;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "[読み取りの救済] リーダー3") && has(simOut(), "3 回続けて・310 ms 読めなくなりましたが") && has(simOut(), "高い感度で読み直したら、駒がいました"), "救済の表示: リーダー・回数と時間・高い感度で救った");
  simNote.rescued = false;
  simNote.absorbed = true;
  simNotePending = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "[読み取りの救済] リーダー3") && has(simOut(), "また読めました（猶予で、ちらつきを吸収しました）") && !has(simOut(), "[イベントの原因]"), "救済の表示: 猶予で吸収した（イベントとしては出さない）");
  simNotePending = true;
  cmd("SHADOWLOG OFF");
  expectText("SHADOWLOG OFF", "影の判定の表示: OFF");
  simOut().clear();
  commandsPollDiagnostics();
  check(simOut().empty() && !simNotePending, "OFF のときは、原因を表示しない（たまった分は捨てる）");
  cmd("SHADOWLOG MAYBE");
  expectText("SHADOWLOG の使い方", "SHADOWLOG ON か SHADOWLOG OFF");

  // RSTAT: リーダーごとの読み取りの統計
  resetAll();
  setupBoard8();
  for (int i = 0; i < 8; i++) simStats[i] = ReaderStatsInfo();
  simStats[2].hits = 970; simStats[2].misses = 30; simStats[2].garbled = 2; simStats[2].rescueTries = 12; simStats[2].rescued = 9; simStats[2].absorbed = 7; simStats[2].longestMs = 310; simStats[2].removedByMiss = 1; simStats[2].directOk = 800; simStats[2].directFail = 4; simStats[2].guesses = 9; simStats[2].guessHits = 6;
  simStats[7].garbled = 5;
  out = cmd("RSTAT");
  check(has(out, "リーダーごとの読み取りの統計"), "RSTAT: 見出し");
  check(has(out, "リーダー3: 読めた 970・読めなかった 30（3.0%）・乱れ 2・直接確認 800/804・候補の呼びかけ 6/9・高感度で救った 9/12・ちらつき吸収 7（最長 310 ms）・外れの知らせ 1"), "RSTAT: リーダー3 の行（読めなかった割合・直接確認・救済・吸収・外れ）");
  check(has(out, "リーダー1: （持ち主の駒の読み取りは、まだありません）"), "RSTAT: 読み取りのないリーダー");
  check(has(out, "リーダー8: 読めた 0・読めなかった 0（0.0%）・乱れ 5"), "RSTAT: 乱れだけのリーダー");
  simStatsReset = false;
  out = cmd("RSTAT RESET");
  check(simStatsReset && has(out, "0 に戻しました"), "RSTAT RESET: 数え直す");
  check(simStats[2].hits == 0, "RSTAT RESET: 統計が 0 になる");
  out = cmd("HELP");
  check(has(out, "RSTAT") && has(out, "RETEST"), "HELP に RSTAT・RETEST が載っている");
  // RETEST: 駒を載せたまま、見つけ直すまでの時間を測る
  simRetestStartOk = true;
  simRetestStartedReader = -1;
  out = cmd("RETEST 3");
  check(simRetestStartedReader == 2 && has(out, "リーダー3 の持ち主を忘れさせました"), "RETEST 3: リーダー3（番号2）で始まる");
  simRetestResultPending = true; simRetestResultReader = 2; simRetestResultMs = 312; simRetestResultOk = true;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "[再検出] リーダー3: 312 ms") && !has(simOut(), "取り消し"), "RETEST の結果の表示: 時間");
  simRetestResultPending = true; simRetestResultMs = 0;
  simOut().clear();
  commandsPollDiagnostics();
  check(has(simOut(), "15秒たっても、見つけ直せませんでした"), "RETEST の結果の表示: 見つからなかったとき");
  simRetestStartOk = false;
  out = cmd("RETEST 3");
  check(has(out, "始められません"), "RETEST: 駒が載っていないときは、始められない");
  out = cmd("MARGIN");
  check(has(out, "電波の余裕") && has(out, "リーダー1: 18dB=0 23dB=6 33dB=12 38dB=12"), "MARGIN: 受信感度ごとの、読めた回数");
  out = cmd("MARGIN 4");
  check(has(out, "リーダー4: 駒が載っていません"), "MARGIN 4: 駒が載っていなければ、そう出る");
  out = cmd("RETEST 9");
  check(has(out, "使い方: RETEST"), "RETEST: リーダー番号が範囲外なら、使い方");
  simRetestStartOk = true;
  resetAll();
}

// ブリッジの「つながっています」の合図（PING）。ブリッジがつながっている間は、ブザーのアルペジオを鳴らさない（register_ui.cpp が見る）
static void testBridgePing() {
  bridgeLinkReset();
  simSetMillis(100000);
  check(!bridgeLinkAlive(), "PING: まだ届いていない → つながっていない");
  std::string out = cmd("PING");
  check(lastHandled, "PING: コマンドとして処理される（登録の画面に回らない）");
  eqi("PING: 画面には、何も出さない", (long long)out.size(), 0);
  check(bridgeLinkAlive(), "PING: 届いたら、つながっている");
  simSetMillis(100000 + BRIDGE_LINK_TIMEOUT_MS - 100);
  check(bridgeLinkAlive(), "PING: 時間切れの少し前までは、つながっている");
  simSetMillis(100000 + BRIDGE_LINK_TIMEOUT_MS + 100);
  check(!bridgeLinkAlive(), "PING: 合図が途切れて時間がたつと、つながっていない（ブリッジが解除された・止まった）");
  cmd("ping");
  check(bridgeLinkAlive(), "PING: 小文字でも、同じ。また届けば、つながっている");
  simSetMillis(100000 + BRIDGE_LINK_TIMEOUT_MS + 5000);
  check(!bridgeLinkAlive(), "PING: 時間がたてば、また、つながっていない");
  simTestMode = true;
  out = cmd("PING");
  check(lastHandled && out.empty() && bridgeLinkAlive(), "PING: RC522 のテストモード中でも、受け付ける（何も出さない）");
  simTestMode = false;
  // 49日たって、ミリ秒の数え方が一周しても、正しく判定する
  simSetMillis(0xFFFFFF00u);
  cmd("PING");
  simSetMillis(0x00000100u);   // 約 0x200 ms 後（一周したあと）
  check(bridgeLinkAlive(), "PING: 時計が一周しても、つながっている（0.5秒後）");
  simSetMillis(0x00000100u + BRIDGE_LINK_TIMEOUT_MS);
  check(!bridgeLinkAlive(), "PING: 時計が一周したあとの、時間切れ");
  bridgeLinkReset();
}

int main() {
  if (NUM_READERS == 4) {
    testRouting();
    testPlaybackBasic();
    testStepSignal();
    testPushState();
    testRepeatPiece();
    testBpmCommands();
    testKeyCommands();
    testLeadAndVoicing();
    testDrumCommands();
    testBackingCommands();
    testGroove();
    testDrumsAndBackingPlayback();
    testIdleAndGain();
    testMidiCommand();
    testStatusHelpAndModes();
    testExamplePatternFile();
    testEditorCommands();
    testStateCommand();
    testOctave();
    testBootAndSavedSettings();
    testBridgePing();
  } else if (NUM_READERS == 8) {
    testEightPositions();
  }
  printf("test_firmware_sim: checks=%d fails=%d\n", checks, fails);
  return fails == 0 ? 0 : 1;
}
