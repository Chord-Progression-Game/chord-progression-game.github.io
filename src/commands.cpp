#include "commands.h"

#include <Arduino.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "board.h"
#include "bridge_link.h"
#include "chords.h"
#include "cmd_parse.h"
#include "config.h"
#include "groove.h"
#include "midi_out.h"
#include "player.h"
#include "rc522_test.h"
#include "reader_array.h"
#include "register_ui.h"
#include "rhythm.h"
#include "rhythm_print.h"
#include "rhythm_store.h"
#include "settings_store.h"
#include "tag_store.h"
#include "ui_util.h"

// ------------------------------------------------------------
// ヘルプ
// ------------------------------------------------------------
void commandsPrintHelp() {
  Serial.println();
  Serial.println("=== コマンド一覧（大文字・小文字はどちらでもOK）===");
  Serial.println("【再生】");
  Serial.println("  START / STOP    位置1から順にコード進行を再生する / 止める（STOP で登録の画面に戻る）");
  Serial.println("  STATUS          BPM・キー・パターン・各位置のコードなど、いまの状態を表示する");
  Serial.println("  BUZZER ON/OFF   基板のブザー（駒を置いたときのアルペジオ）を鳴らすか。OFF にすると、Serial Monitor でも鳴らない（保存される。標準 ON。ON でも、電源を入れて10秒のあいだと、ブリッジがつながっている間は鳴らない）");
  Serial.println("  AUTOSTART ON/OFF  電源を入れたとき、START を打たなくても自動で再生を始めるか（標準 OFF = 停止で始まる。ON のとき、ドラムは駒がなくても流れる）");
  Serial.println("  SHADOWLOG ON/OFF  隣のリーダーが読む「影」の判定（持ち主を比べ読みで決めた結果）を、そのつど表示する（診断用。保存しない）");
  Serial.println("  MARGIN / MARGIN 3  診断: 駒が載っているリーダーの、受信感度ごとの「読めた回数」（余裕の測定。数秒かかる）。弱い電波でも読めるリーダー・駒は、余裕がある");
  Serial.println("  RETEST 3        診断: リーダー3 の駒を、載せたまま「新しく置かれた駒」として見つけ直すまでの時間を測る（結果は [再検出] の行。盤面は変わらない）");
  Serial.println("  RSTAT           リーダーごとの読み取りの統計（駒が載っているリーダーの、読めた・読めなかった回数、ちらつきを吸収した回数など）。RSTAT RESET で、数え直す");
  Serial.println("【すぐに変えられる（再生中でも、すぐに反映）】");
  Serial.println("  BPM 120         BPM を設定する（30〜240）。BPM +5 / BPM -5 で、いまの値から変える");
  Serial.println("  KEY D           キーを変える（C D E F G A B と、Eb F# などの # b）。KEY +1 / KEY -1 で、半音ずつ");
  Serial.println("  キー操作        Enter なしで、すぐに効く:  +  -（BPM ±5）   ]  [（キー ±1半音）");
  Serial.println("  LEAD ON/OFF     ボイスリーディング: 前のコードから一番近い高さで鳴らす（標準 ON。位置1に戻ったら本来の高さに戻る）");
  Serial.println("  VOICING 4/3     3和音の4音目に、ルートのオクターブ上を足す（標準 4）/ 足さない（3）");
  Serial.println("  MAP             位置とリーダーの対応（配置）を表示。MAP LEARN で、駒を置いて覚えさせる。MAP 4 3 2 1 5 6 7 8 で直接指定");
  Serial.println("  OCTAVE +1       和音の高さを、オクターブ単位で変える（-1〜3。OCTAVE 2 / OCTAVE -1）。音が低い・高いときに。保存される");
  Serial.println("【リズム（ドラムとバッキングは、別々に選べて、自分で作れる）】");
  Serial.println("  DRUM 2          ドラムのパターンを選ぶ（DRUM OFF でなし）。DRUM LIST で一覧");
  Serial.println("  BACKING 1       バッキング（コードの鳴らし方）を選ぶ（BACKING OFF で、和音なし）。BACKING LIST で一覧");
  Serial.println("  GROOVE          いま選んでいる2つの中身を表示する。GROOVE 2 3 で、ドラム2・バッキング3 を同時に選ぶ");
  Serial.println("  HELP RHYTHM     パターンの作り方（DRUM SET / BACKING SET など）");
  Serial.println("【音の出力先・RC522】");
  Serial.println("  MIDI BRIDGE     音の出力先: PCのブリッジ経由（tools/midi_bridge.py を動かすと、PCの音源で鳴る）");
  Serial.println("  MIDI USB        音の出力先: ESP32の「USB」側のポートを、MIDI機器としてPCに見せる");
  Serial.println("  MIDI OFF        音の出力先: なし（画面に表示するだけ）");
  Serial.println("  IDLE RESET/OFF  使っていないリーダーの止め方（IDLE だけ打つと説明）。GAIN 23 で、受信感度");
  Serial.println("  （登録の画面では、l: 登録一覧 / t: ブザーテスト / x: RC522のテスト）");
}

void commandsPrintRhythmHelp() {
  Serial.println();
  Serial.println("=== リズムのパターン（ドラム と バッキング）===");
  Serial.println("1マス = 16分音符。16マス = 1小節（4拍）。パターンは、くり返す。長さは 8 / 16 / 32 マス。");
  Serial.println("ID 0 = なし、1〜10 = 最初から入っている（変更不可）、11〜20 = 自分で作れる（電源を切っても残る）。");
  Serial.println("【ドラム】 8つのレーン:  K キック  S スネア  P サイドスティック  H ハイハット(閉)  O ハイハット(開)  C クラップ  R ライド  X クラッシュ");
  Serial.println("  マスの文字:  .（なし）  o（弱く）  x（ふつう）  X（強く）");
  Serial.println("  DRUM COPY 2 11             プリセット2を、自分のスロット11にコピー（ここから作り始める）");
  Serial.println("  DRUM SET 11 K x...x...x...x...   スロット11の K（キック）レーンを設定する（16文字）");
  Serial.println("  DRUM NAME 11 マイ4つ打ち   名前をつける");
  Serial.println("  DRUM LEN 11 32             長さを変える（8 / 16 / 32）。DRUM CLEAR 11 で空に、DRUM DELETE 11 で削除");
  Serial.println("  DRUM SHOW 11 / DRUM LIST   中身を表示 / 一覧");
  Serial.println("【バッキング】 マスの文字:");
  Serial.println("  .（なし）  -（直前の音をのばす）  C（和音）  c（弱い和音）  B（ベース: ルートの1オクターブ下）  b（弱く）");
  Serial.println("  D（ベース＋和音）  d（弱く）  1 2 3 4（和音の1〜4番目の音を1音だけ。アルペジオ用）");
  Serial.println("  例: C-------C-------  = 1ステップ（2拍）に1回、のばす和音（8マスずつ、コードが変わる）");
  Serial.println("  BACKING COPY 6 11          プリセット6を、自分のスロット11にコピー");
  Serial.println("  BACKING SET 11 1-2-3-4-1-2-3-4-   スロット11を設定する（16文字）");
  Serial.println("  BACKING NAME / LEN / CLEAR / DELETE / SHOW / LIST  は DRUM と同じ");
  Serial.println("  ※ 音ののばしは、ステップ（8マス）の終わりで切れる（次のコードにはみ出さない）");
  Serial.println("【ファイルから】 tools/midi_bridge.py で、!load ファイル名 と打つと、ファイルの中のコマンドを、順に送れる");
}

namespace {

// ------------------------------------------------------------
// 表示の小さな部品
// ------------------------------------------------------------
void printKeyInfo() {
  char keyText[8];
  keyName(playerKey(), keyText, sizeof(keyText));
  const uint8_t ids[3] = {1, 3, 4};  // Ⅰ Ⅳ Ⅴ
  Serial.printf("Key は %s です（", keyText);
  for (int i = 0; i < 3; i++) {
    char symbol[16];
    chordSymbol(*chordById(ids[i]), playerKey(), symbol, sizeof(symbol));
    Serial.printf("%s%s = %s", i ? "、" : "", chordById(ids[i])->name, symbol);
  }
  Serial.println("）。");
}

// ------------------------------------------------------------
// STATE: 機械（PC側のブリッジ・ブラウザの操作画面）が読むための、状態の表示。人が読むものではない
//   STATE                  … 1行: ~S bpm=120 key=C playing=0 step=-1 drum=0 backing=1 lead=1 voicing=4 octave=1 idle=RESET gain=33 midi=BRIDGE learn=0 map=4,3,2,1,5,6,7,8 chords=Ⅰ,C;-,;?,;→,
//                              map は、位置ごとのリーダー番号。learn は、配置を覚えさせている最中なら、次に置く位置（0 = 覚えさせていない）
//                              chords は、位置ごとに「名前,コード名」を ; でつなぐ（空=「-」、未登録=「?」）
//   STATE PATTERN drum 11  … 1行: ~P drum 11 16 K=x...,S=....x... 名前   （なければ ~P drum 11 0 - -）
//   STATE PATTERN backing 11 … 1行: ~P backing 11 16 C-------C------- 名前
// ------------------------------------------------------------
bool parseId(const char* token, int* id);  // 下で定義

void printStateLine() {
  char keyText[8];
  keyName(playerKey(), keyText, sizeof(keyText));
  const char* midi = midiBackend() == MIDI_BACKEND_USB ? "USB" : (midiBackend() == MIDI_BACKEND_BRIDGE ? "BRIDGE" : "NONE");
  Serial.printf("~S bpm=%d key=%s playing=%d step=%d drum=%d backing=%d lead=%d voicing=%d octave=%d idle=%s gain=%d midi=%s learn=%d map=", playerBpm(), keyText,
                playerIsPlaying() ? 1 : 0, playerCurrentStep(), playerDrumId(), playerBackingId(), playerVoiceLeading() ? 1 : 0,
                playerVoicingAddsOctave() ? 4 : 3, playerOctave(), readersIdleMethod() == IDLE_RESET ? "RESET" : "OFF", readersGainDb(), midi,
                boardLayout().learning() ? boardLayout().learnNextPosition() + 1 : 0);
  for (int p = 0; p < NUM_POSITIONS; p++) Serial.printf("%s%d", p ? "," : "", boardReaderOfPosition(p) + 1);   // 位置ごとのリーダー番号（1から数える）
  Serial.print(" chords=");
  for (int p = 0; p < NUM_POSITIONS; p++) {
    if (p > 0) Serial.print(";");
    PositionInfo info = boardPosition(p);
    if (info.state == POS_EMPTY) {
      Serial.print("-,");
    } else if (info.state == POS_UNREGISTERED) {
      Serial.print("?,");
    } else {
      const Chord* chord = chordById(info.chordId);
      if (chord == nullptr) {
        Serial.print("?,");
      } else if (chordIsRepeat(*chord)) {
        Serial.print("→,");
      } else {
        char symbol[16];
        chordSymbol(*chord, playerKey(), symbol, sizeof(symbol));
        Serial.printf("%s,%s", chord->name, symbol);
      }
    }
  }
  Serial.println();
}

void printPatternLine(const char* kind, int id) {
  if (strcmp(kind, "DRUM") == 0) {
    const DrumPattern* p = rhythmDrum(id);
    if (p == nullptr) { Serial.printf("~P drum %d 0 - -\n", id); return; }
    Serial.printf("~P drum %d %d ", id, p->length);
    bool first = true;
    for (int lane = 0; lane < DRUM_LANES; lane++) {
      bool any = false;
      for (int i = 0; i < p->length; i++) if (p->level[lane][i] != DRUM_NONE) any = true;
      if (!any) continue;
      char text[RHYTHM_MAX_SLOTS + 1];
      drumPatternLaneText(*p, lane, text, sizeof(text));
      Serial.printf("%s%c=%s", first ? "" : ",", drumLaneLetter(lane), text);
      first = false;
    }
    if (first) Serial.print("-");
    Serial.printf(" %s\n", p->name);
  } else {
    const BackingPattern* p = rhythmBacking(id);
    if (p == nullptr) { Serial.printf("~P backing %d 0 - -\n", id); return; }
    Serial.printf("~P backing %d %d %s %s\n", id, p->length, p->cells, p->name);
  }
}

void doState(const char* arg) {
  if (*arg == '\0') { printStateLine(); return; }
  char t1[12], t2[12], t3[12];
  const char* p = arg;
  int id;
  if (!cmdNextToken(&p, t1, sizeof(t1)) || !cmdNextToken(&p, t2, sizeof(t2)) || !cmdNextToken(&p, t3, sizeof(t3))) return;
  cmdToUpper(t1);
  cmdToUpper(t2);
  if (strcmp(t1, "PATTERN") != 0 || (strcmp(t2, "DRUM") != 0 && strcmp(t2, "BACKING") != 0) || !parseId(t3, &id)) return;
  printPatternLine(t2, id);
}

// ------------------------------------------------------------
// BPM
// ------------------------------------------------------------
void setBpmAndReport(int bpm) {
  if (!playerSetBpm(bpm)) {
    Serial.printf("BPM は %d〜%d の整数で指定してください。例: BPM 120\n", (int)Groove::BPM_MIN, (int)Groove::BPM_MAX);
    return;
  }
  Serial.printf("BPM %d（1拍 %lu ms、%d拍 = %lu ms）", playerBpm(), (unsigned long)(60000 / playerBpm()), (int)GROOVE_BEATS_PER_STEP,
                (unsigned long)(60000 * GROOVE_BEATS_PER_STEP / playerBpm()));
  if (playerIsPlaying()) Serial.print("  ← すぐに反映されました");
  Serial.println();
}

void adjustBpm(int delta) {
  int target = playerBpm() + delta;
  if (target < Groove::BPM_MIN) target = Groove::BPM_MIN;
  if (target > Groove::BPM_MAX) target = Groove::BPM_MAX;
  if (target == playerBpm()) {
    Serial.printf("BPM は、これ以上%sにできません（%d）。\n", delta > 0 ? "上げ" : "下げ", playerBpm());
    return;
  }
  setBpmAndReport(target);
}

void doBpm(const char* arg) {
  if (*arg == '\0') {
    Serial.printf("BPM は %d です（BPM 120 / BPM +5 / BPM -5）。\n", playerBpm());
    return;
  }
  long v;
  bool relative;
  if (!cmdParseInt(arg, &v, &relative)) {
    Serial.printf("BPM は %d〜%d の整数で指定してください。例: BPM 120 / BPM +5 / BPM -5\n", (int)Groove::BPM_MIN, (int)Groove::BPM_MAX);
    return;
  }
  if (relative) adjustBpm((int)v);
  else setBpmAndReport((int)v);
}

// ------------------------------------------------------------
// キー
// ------------------------------------------------------------
void setKeyAndReport(const Key& key) {
  playerSetKey(key);
  printKeyInfo();
  if (playerIsPlaying()) Serial.println("  ← すぐに反映されました（鳴っている和音を、新しいキーで鳴らし直します）");
}

void adjustKey(int semitones) { setKeyAndReport(keyTranspose(playerKey(), semitones)); }

void doKey(const char* arg) {
  if (*arg == '\0') {
    printKeyInfo();
    Serial.println("変えるには: KEY D / KEY Eb / KEY F# / KEY +1 / KEY -1");
    return;
  }
  long v;
  bool relative;
  if (cmdParseInt(arg, &v, &relative) && relative) {
    adjustKey((int)v);
    return;
  }
  Key key;
  if (parseKeyName(arg, &key)) {
    setKeyAndReport(key);
    return;
  }
  Serial.println("キーの名前が読めません。例: KEY D / KEY Eb / KEY F# / KEY +1 / KEY -1");
}

// ------------------------------------------------------------
// ボイスリーディング・和音の音数
// ------------------------------------------------------------
void doLead(const char* arg) {
  char word[8];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  if (*arg == '\0') {
    Serial.printf("ボイスリーディング: %s（LEAD ON / LEAD OFF）\n", playerVoiceLeading() ? "ON" : "OFF");
    return;
  }
  if (strcmp(word, "ON") == 0) {
    playerSetVoiceLeading(true);
    Serial.println("ボイスリーディング ON: 前に鳴らしたコードから一番近い高さで鳴らします（本来の高さから、上下1オクターブの範囲）。次のコードから。");
  } else if (strcmp(word, "OFF") == 0) {
    playerSetVoiceLeading(false);
    Serial.println("ボイスリーディング OFF: コードは、いつも同じ高さで鳴ります。次のコードから。");
  } else {
    Serial.println("LEAD ON か LEAD OFF で指定してください。");
  }
}

// ------------------------------------------------------------
// SHADOWLOG: 影の判定の結果を、そのつど表示する（診断用。電源を切ると OFF に戻る）
static bool shadowLogOn = false;

void doShadowLog(const char* arg) {
  char word[8];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  if (strcmp(word, "ON") == 0) shadowLogOn = true;
  else if (strcmp(word, "OFF") == 0) shadowLogOn = false;
  else if (*arg != '\0') {
    Serial.println("SHADOWLOG ON か SHADOWLOG OFF で指定してください。");
    return;
  }
  Serial.printf("影の判定の表示: %s（SHADOWLOG ON / SHADOWLOG OFF。保存しません）\n", shadowLogOn ? "ON" : "OFF");
  if (shadowLogOn) {
    Serial.println("  隣のリーダーが同じ駒を読んだとき、どのリーダーを持ち主にしたかと、その得点・最初に読めた受信感度を表示します。");
  }
}

// RSTAT: リーダーごとの読み取りの統計（診断用）。「置いているのに認識しなくなる」ような不調が、どのリーダーで、どのくらい起きるかを見る
void doRstat(const char* arg) {
  char word[8];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  if (strcmp(word, "RESET") == 0) {
    readersStatsReset();
    Serial.println("リーダーごとの統計を、0 に戻しました。");
    return;
  }
  Serial.println("=== リーダーごとの読み取りの統計（駒が載っているリーダーの、標準の感度での読み取り）===");
  for (int i = 0; i < NUM_READERS; i++) {
    ReaderStatsInfo s;
    if (!readersStatsGet(i, &s)) continue;
    uint32_t total = s.hits + s.misses;
    if (total == 0 && s.garbled == 0 && s.removedByMiss == 0) {
      Serial.printf("  リーダー%d: （持ち主の駒の読み取りは、まだありません）\n", i + 1);
      continue;
    }
    uint32_t permille = total ? (s.misses * 1000u + total / 2) / total : 0;
    Serial.printf("  リーダー%d: 読めた %lu・読めなかった %lu（%lu.%lu%%）・乱れ %lu・直接確認 %lu/%lu・候補の呼びかけ %lu/%lu・高感度で救った %lu/%lu・ちらつき吸収 %lu（最長 %lu ms）・外れの知らせ %lu\n",
                  i + 1, (unsigned long)s.hits, (unsigned long)s.misses, (unsigned long)(permille / 10), (unsigned long)(permille % 10),
                  (unsigned long)s.garbled, (unsigned long)s.directOk, (unsigned long)(s.directOk + s.directFail), (unsigned long)s.guessHits, (unsigned long)s.guesses, (unsigned long)s.rescued, (unsigned long)s.rescueTries,
                  (unsigned long)s.absorbed, (unsigned long)s.longestMs, (unsigned long)s.removedByMiss);
  }
  Serial.println("  ※ 「直接確認」= 載っているはずの駒を、UID を指定して呼びかけて確かめられた回数/試した回数。「候補の呼びかけ」= 新しく載った駒を、衝突回避で読めなかったので、候補の UID を1つずつ呼びかけて、見つかった回数/試した回数。「ちらつき吸収」= 読めなくなったが、「外れた」と決める前に、また読めた回数。");
  Serial.println("  ※ 「外れの知らせ」が増えるのは、本当に外したとき（動かしていないのに増えるなら、不調）。「乱れ」が多いリーダーは、配線・駒の位置・リーダー本体を疑う。");
}

// MARGIN [n]: 診断。受信感度の段ごとに、載っている駒を読めるか（電波の余裕）
void doMargin(const char* arg) {
  int only = atoi(arg);
  const int tries = 12;
  int levels = readersGainLevels();
  Serial.printf("=== 電波の余裕（受信感度ごとの、読めた回数 / %d回。標準は %d dB）===\n", tries, (int)readersGainDb());
  for (int i = 0; i < NUM_READERS; i++) {
    if (only >= 1 && only != i + 1) continue;
    int hits[8];
    if (!readersMarginTest(i, tries, hits)) {
      if (only >= 1) Serial.printf("  リーダー%d: 駒が載っていません\n", i + 1);
      continue;
    }
    Serial.printf("  リーダー%d:", i + 1);
    for (int lv = 0; lv < levels && lv < 8; lv++) Serial.printf(" %ddB=%d", readersGainDbAt(lv), hits[lv]);
    Serial.println();
  }
  Serial.println("  ※ 弱い感度（18・23 dB）でも読めるほど、駒が近く・よく結びついている（余裕がある）。標準の感度でしか読めないリーダー・駒は、置き方や位置で、読めなくなりやすい。");
}

// RETEST n: 診断。リーダー n の持ち主の記録を忘れさせて、駒を載せたまま、見つけ直すまでの時間を測る
void doRetest(const char* arg) {
  int r = atoi(arg);
  if (r < 1 || r > NUM_READERS) {
    Serial.printf("使い方: RETEST 1〜%d（そのリーダーの駒を、載せたまま、新しく置かれた駒として見つけ直すまでの時間を測る）\n", NUM_READERS);
    return;
  }
  if (!readersRetest(r - 1)) {
    Serial.printf("RETEST: リーダー%d に駒が載っていない（または、前の測定の途中）ので、始められません。\n", r);
    return;
  }
  Serial.printf("RETEST: リーダー%d の持ち主を忘れさせました。見つけ直すまでの時間を測ります（結果は [再検出] の行。盤面は変わりません）\n", r);
}

// BUZZER: 基板のブザーを鳴らすか（2026-11-18）。夜中の作業・駒が載ったままの書き込みで、鳴らしたくないとき
// ------------------------------------------------------------
void doBuzzer(const char* arg) {
  char word[8];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  if (*arg == '\0') {
    Serial.printf("基板のブザー: %s（BUZZER ON / BUZZER OFF）\n", buzzerMuted() ? "OFF（鳴らさない）" : "ON");
    Serial.println("  ON でも、鳴らさないとき: 電源を入れて10秒のあいだ・ブリッジがつながっている間（Mac が音を鳴らすため）。");
    return;
  }
  bool on;
  if (strcmp(word, "ON") == 0) on = true;
  else if (strcmp(word, "OFF") == 0) on = false;
  else {
    Serial.println("BUZZER ON か BUZZER OFF で指定してください。");
    return;
  }
  buzzerSetMuted(!on);
  if (!settingsSaveBuzzer(on)) {
    Serial.println("※ 設定を保存できませんでした（いまの間は、有効です）。");
    return;
  }
  Serial.println(on ? "ブザー ON: ブリッジがつながっていないとき（Serial Monitor で作業するとき）に、駒を置くとアルペジオが鳴ります。"
                    : "ブザー OFF: 基板のブザーは鳴らしません（BUZZER ON で戻せます）。");
}

// AUTOSTART: 電源を入れたとき、START を打たなくても、自動で再生を始めるか
// ------------------------------------------------------------
void doAutostart(const char* arg) {
  char word[8];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  if (*arg == '\0') {
    Serial.printf("電源を入れたときの自動再生: %s（AUTOSTART ON / AUTOSTART OFF）\n", settingsLoadAutostart(DEFAULT_AUTOSTART) ? "ON" : "OFF");
    Serial.println("  ON のとき: 電源を入れると、START を打たなくても再生が始まります。駒がなくても、ドラムだけが流れます。");
    Serial.println("  駒を登録するときは、先に STOP を打ってください（STOP で登録の画面になります）。");
    return;
  }
  bool on;
  if (strcmp(word, "ON") == 0) on = true;
  else if (strcmp(word, "OFF") == 0) on = false;
  else {
    Serial.println("AUTOSTART ON か AUTOSTART OFF で指定してください。");
    return;
  }
  if (!settingsSaveAutostart(on)) {
    Serial.println("※ 設定を保存できませんでした。");
    return;
  }
  Serial.println(on ? "自動再生 ON: 次に電源を入れたときから、自動で再生が始まります（いまの状態は変わりません）。"
                    : "自動再生 OFF: 次に電源を入れたときから、登録の画面で始まります（START で再生）。");
}

// ------------------------------------------------------------
// MAP: 位置とリーダーの対応（配置）
//   MAP                      … いまの対応を表示
//   MAP 4 3 2 1 5 6 7 8      … 位置1〜8 に当たるリーダーの番号を、順に指定する
//   MAP LEARN                … 位置1から順に、駒を置いていくと、覚える（MAP DONE で途中で終える / MAP CANCEL でやめる）
//   MAP RESET                … 標準に戻す
// ------------------------------------------------------------
void saveLayout() {
  uint8_t m[LAYOUT_MAX];
  boardLayout().get(m);
  if (!settingsSaveMap(m, NUM_POSITIONS)) Serial.println("  ※ 保存に失敗しました（この電源が入っている間だけ有効です）");
}

void printLayout() {
  Serial.println();
  Serial.println("=== 位置とリーダーの対応（配置）===");
  Serial.println("4×2 に並べるときは、上段の左から 位置1〜4、下段の左から 位置5〜8。");
  for (int start = 0; start < NUM_POSITIONS; start += 4) {
    Serial.print(start == 0 ? "  上段: " : "  下段: ");
    for (int p = start; p < NUM_POSITIONS && p < start + 4; p++) {
      int r = boardReaderOfPosition(p);
      Serial.printf("位置%d=リーダー%d%s  ", p + 1, r + 1, readerIsAlive(r) ? "" : "(※応答なし)");
    }
    Serial.println();
  }
  Serial.printf("変えるには: MAP 4 3 2 1 5 6 7 8（位置1〜%d に当たるリーダーの番号）/ MAP LEARN（駒を置いて覚えさせる）/ MAP RESET（標準に戻す）\n", NUM_POSITIONS);
  Serial.println("リーダーの番号は、配線の順番（README 3-3, 3-7 の表の #）です。");
}

void printLearnPrompt() {
  Serial.printf("→ 位置%d の場所のリーダーに、駒を1つ置いてください。（途中で終える: MAP DONE / やめる: MAP CANCEL）\n", boardLayout().learnNextPosition() + 1);
}

void doMap(const char* arg) {
  Layout& layout = boardLayout();
  char word[12];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);

  if (*arg == '\0') { printLayout(); return; }
  if (strcmp(word, "RESET") == 0) {
    layout.reset();
    saveLayout();
    Serial.println("位置とリーダーの対応を、標準に戻しました。");
    printLayout();
    return;
  }
  if (strcmp(word, "CANCEL") == 0) {
    if (!layout.learning()) { Serial.println("配置を覚えさせている途中ではありません。"); return; }
    layout.learnCancel();
    Serial.println("やめました。もとの配置のままです。");
    return;
  }
  if (strcmp(word, "DONE") == 0) {
    if (!layout.learning()) { Serial.println("配置を覚えさせている途中ではありません。"); return; }
    layout.learnFinish();
    saveLayout();
    Serial.println("途中で終わりました。まだ決まっていない位置には、使っていないリーダーを、番号の小さい順に入れました。");
    printLayout();
    return;
  }
  if (strcmp(word, "LEARN") == 0) {
    if (playerIsPlaying()) { Serial.println("再生中は、配置を覚えさせられません。STOP してください。"); return; }
    layout.learnBegin();
    Serial.println();
    Serial.println("=== 配置を覚えさせます ===");
    Serial.println("位置1から順に、駒を1つ、その場所のリーダーに置いていきます（駒を1つだけ使って、外して次の場所に置き直してもOK）。");
    Serial.println("すでに駒が載っているリーダーは、いったん外してから置き直してください。");
    printLearnPrompt();
    return;
  }

  // 数字を並べた指定: MAP 4 3 2 1 5 6 7 8
  uint8_t map[LAYOUT_MAX];
  int n = 0;
  const char* p = arg;
  char token[12];
  while (cmdNextToken(&p, token, sizeof(token))) {
    long v;
    bool relative;
    if (n >= NUM_POSITIONS || !cmdParseInt(token, &v, &relative) || relative || v < 1 || v > NUM_READERS) {
      Serial.printf("MAP の使い方: MAP 4 3 2 1 5 6 7 8（位置ごとのリーダーの番号 1〜%d を、%d個。同じ番号は使えません）\n", NUM_READERS, NUM_POSITIONS);
      return;
    }
    map[n++] = (uint8_t)(v - 1);
  }
  if (n != NUM_POSITIONS || !layout.set(map, n)) {
    Serial.printf("MAP の使い方: 位置ごとのリーダーの番号 1〜%d を、%d個、重ならないように並べます。例: MAP 4 3 2 1 5 6 7 8\n", NUM_READERS, NUM_POSITIONS);
    return;
  }
  saveLayout();
  Serial.println("位置とリーダーの対応を変えました。");
  printLayout();
}

// ------------------------------------------------------------
// OCTAVE: 和音の高さ（オクターブ）
// ------------------------------------------------------------
void printOctaveInfo() {
  int o = playerOctave();
  char low[8], high[8];
  snprintf(low, sizeof(low), "C%d", 3 + o);
  snprintf(high, sizeof(high), "B%d", 3 + o);
  Serial.printf("和音の高さ: %+d（コードのルートが %s〜%s の範囲）\n", o, low, high);
}

void doOctave(const char* arg) {
  if (*arg == '\0') {
    printOctaveInfo();
    Serial.printf("変えるには: OCTAVE 2 / OCTAVE +1 / OCTAVE -1（%d〜%d。標準は %+d。本体に保存されます）\n", OCTAVE_MIN, OCTAVE_MAX, DEFAULT_OCTAVE);
    Serial.println("  音が低すぎる・高すぎるときに使います。ドラム（チャンネル10）には関係しません。");
    return;
  }
  long v;
  bool relative;
  if (!cmdParseInt(arg, &v, &relative)) {
    Serial.printf("OCTAVE の使い方: OCTAVE 2 / OCTAVE +1 / OCTAVE -1（%d〜%d）\n", OCTAVE_MIN, OCTAVE_MAX);
    return;
  }
  long target = relative ? playerOctave() + v : v;
  if (!playerSetOctave((int)target)) {
    Serial.printf("和音の高さは %d〜%d です。\n", OCTAVE_MIN, OCTAVE_MAX);
    return;
  }
  bool saved = settingsSaveOctave((int)target);
  printOctaveInfo();
  if (playerIsPlaying()) Serial.println("  ← すぐに反映されました（鳴っている和音を、新しい高さで鳴らし直します）");
  if (!saved) Serial.println("  ※ 保存に失敗しました（この電源が入っている間だけ有効です）");
}

void doVoicing(const char* arg) {
  long v;
  bool relative;
  if (*arg == '\0') {
    Serial.printf("和音の鳴らし方: %s\n", playerVoicingAddsOctave() ? "4音（3和音は、ルートのオクターブ上を足す）" : "コードの構成音だけ（3和音は3音）");
    return;
  }
  if (!cmdParseInt(arg, &v, &relative) || relative || (v != 3 && v != 4)) {
    Serial.println("VOICING の使い方: VOICING 4（3和音にオクターブ上を足す）/ VOICING 3（構成音だけ）");
    return;
  }
  playerSetVoicing(v == 4);
  Serial.printf("和音の鳴らし方を変えました: %s（次に鳴らすコードから）\n",
                v == 4 ? "4音（3和音は、ルートのオクターブ上を足す）" : "コードの構成音だけ（3和音は3音）");
}

// ------------------------------------------------------------
// 音の出力先
// ------------------------------------------------------------
void doMidi(const char* arg) {
  if (*arg == '\0') {
    Serial.printf("音の出力先: %s\n", midiBackendName());
    return;
  }
  char word[12];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);

  if (strcmp(word, "OFF") == 0 || strcmp(word, "NONE") == 0) {
    midiSetBackend(MIDI_BACKEND_NONE);
    Serial.println("音の出力先: なし（画面に表示するだけ）");
  } else if (strcmp(word, "ON") == 0 || strcmp(word, "BRIDGE") == 0) {
    midiSetBackend(MIDI_BACKEND_BRIDGE);
    midiProgramChange(MIDI_CHANNEL_PIANO, MIDI_PROGRAM_PIANO);
    Serial.println("音の出力先: ブリッジ（PCで tools/midi_bridge.py を動かしていると、PCの音源で鳴ります）");
  } else if (strcmp(word, "USB") == 0) {
    if (!midiSetBackend(MIDI_BACKEND_USB)) {
      Serial.println("USB-MIDI を始められませんでした。ブリッジ（MIDI BRIDGE）を使ってください。");
      return;
    }
    Serial.println("音の出力先: USB-MIDI");
    Serial.println("  ESP32 の「USB」側のポート（いま使っているUART側とは別のポート）を、PCにつないでください。");
    Serial.println("  ※ USB の設定は、リセットするまで変えられません。");
    Serial.printf("  いまの接続: %s\n", midiUsbMounted() ? "PCに認識されています" : "PCにつながっていません");
  } else {
    Serial.println("MIDI の使い方: MIDI BRIDGE / MIDI USB / MIDI OFF");
  }
}

// ------------------------------------------------------------
// RC522: 止め方・受信感度
// ------------------------------------------------------------
void doIdle(const char* arg) {
  if (*arg == '\0') {
    Serial.println();
    Serial.printf("リーダーの止め方: %s\n", readersIdleMethodName(readersIdleMethod()));
    Serial.println("  読むリーダーは1台ずつ。ほかのリーダーは、読んでいない間、次のどちらかの状態にしています。");
    Serial.println("  OFF   … 電波（アンテナの駆動）だけ止める。チップは動いたまま（約13.5mA）。この間の TX端子の状態は、データシートに規定がない。");
    Serial.println("  RESET … RST を LOW にして、チップごと止める（約5µA）。発振も受信も止まり、TX端子は HIGH か LOW に固定される。");
    Serial.println("          読むときだけ、速く起こして設定し直す。");
    Serial.println("  どちらが干渉が少ないかは、機材の並べ方で変わる。x → c（止め方の比較テスト）で、あなたの機材で測れます。");
    Serial.println("  変えるには: IDLE RESET / IDLE OFF（本体に保存されます。再生中は変えられません）");
    return;
  }
  char word[12];
  strncpy(word, arg, sizeof(word) - 1);
  word[sizeof(word) - 1] = '\0';
  cmdToUpper(word);
  IdleMethod method;
  if (strcmp(word, "RESET") == 0) method = IDLE_RESET;
  else if (strcmp(word, "OFF") == 0 || strcmp(word, "ANTENNA") == 0) method = IDLE_ANTENNA_OFF;
  else {
    Serial.println("IDLE の使い方: IDLE RESET / IDLE OFF");
    return;
  }
  if (playerIsPlaying()) {
    Serial.println("再生中は、止め方を変えられません。STOP してから変えてください。");
    return;
  }
  if (!readersSetIdleMethod(method, true)) {
    Serial.printf("RESET方式の自己診断で、%d台のリーダーがうまく起きませんでした。止め方は変えていません（%s）。\n",
                  readersLastSelfTestFailures(), readersIdleMethodName(readersIdleMethod()));
    return;
  }
  bool saved = settingsSaveIdleMethod(method);
  Serial.printf("リーダーの止め方を、%s にしました。%s\n", readersIdleMethodName(method), saved ? "（本体に保存しました）" : "（保存に失敗しました。この電源が入っている間だけ有効です）");
}

void doGain(const char* arg) {
  if (*arg == '\0') {
    Serial.printf("受信感度: %d dB（GAIN 18 / 23 / 33 / 38 / 43 / 48）\n", readersGainDb());
    Serial.println("  下げると、遠くのタグや、隣のリーダーのタグを拾いにくくなります（駒をリーダーに直接置くなら、23 でも読めることが多い）。");
    Serial.println("  x → 1〜4（位置テスト）や a（全台同時テスト）で、読める回数と、干渉の有無を確かめてください。");
    return;
  }
  long v;
  bool relative;
  if (!cmdParseInt(arg, &v, &relative) || relative || v < 0 || v > 255 || !readersGainValid((uint8_t)v)) {
    Serial.println("GAIN の使い方: GAIN 18 / 23 / 33 / 38 / 43 / 48（dB。標準は 33）");
    return;
  }
  readersSetGainDb((uint8_t)v);
  bool saved = settingsSaveGainDb((uint8_t)v);
  Serial.printf("受信感度を %d dB にしました。%s\n", (int)v, saved ? "（本体に保存しました）" : "（保存に失敗しました。この電源が入っている間だけ有効です）");
}

// ------------------------------------------------------------
// リズムのパターン（ドラム・バッキング）
// ------------------------------------------------------------
bool parseId(const char* token, int* id) {
  long v;
  bool relative;
  if (!cmdParseInt(token, &v, &relative) || relative || v < 0 || v > 99) return false;
  *id = (int)v;
  return true;
}

void printPresetHint(const char* kind) {
  Serial.printf("プリセット（1〜10）は変更できません。%s COPY 2 11 のように、自分のスロット（11〜20）にコピーしてから編集してください。\n", kind);
}

// ---- ドラム ----
void drumList() {
  Serial.println();
  Serial.println("=== ドラムのパターン ===");
  Serial.println("プリセット（変更できません）:");
  for (int id = 1; id <= PATTERN_ID_PRESET_LAST; id++) {
    const DrumPattern* p = rhythmDrum(id);
    if (p) Serial.printf("  %2d  %s（%d マス）\n", id, p->name, p->length);
  }
  Serial.println("自分のパターン（11〜20。DRUM COPY で作れます）:");
  for (int id = PATTERN_ID_USER_FIRST; id <= PATTERN_ID_USER_LAST; id++) {
    const DrumPattern* p = rhythmDrum(id);
    if (p) Serial.printf("  %2d  %s（%d マス）\n", id, p->name, p->length);
    else Serial.printf("  %2d  （空き）\n", id);
  }
  const DrumPattern* cur = rhythmDrum(playerDrumId());
  Serial.printf("いま選んでいるドラム: %s\n", cur ? cur->name : "なし");
}

void drumShow(int id) {
  const DrumPattern* p = rhythmDrum(id);
  if (!p) {
    Serial.printf("ドラム %d はありません。DRUM LIST で一覧を見られます。\n", id);
    return;
  }
  Serial.println();
  rhythmPrintDrumPattern(id, *p);
}

void drumSaveReport(int id) {
  Serial.println(rhythmSaveDrum(id) ? "保存しました。" : "※ 保存に失敗しました（この電源が入っている間だけ有効です）。");
  playerReloadPatterns();
}

void doDrum(const char* arg) {
  char t[24];
  const char* p = arg;
  if (!cmdNextToken(&p, t, sizeof(t))) {
    const DrumPattern* cur = rhythmDrum(playerDrumId());
    if (cur) Serial.printf("ドラム: %d「%s」\n", playerDrumId(), cur->name);
    else Serial.println("ドラム: なし");
    Serial.println("使い方: DRUM 2 / DRUM OFF / DRUM LIST / DRUM SHOW 2 / DRUM COPY 2 11 / DRUM SET 11 K x...x...  （HELP RHYTHM）");
    return;
  }
  cmdToUpper(t);
  int id;
  if (cmdIsAllDigits(t)) {  // DRUM 2
    if (!parseId(t, &id) || (id != PATTERN_ID_OFF && rhythmDrum(id) == nullptr)) {
      Serial.printf("ドラム %s はありません。DRUM LIST で一覧を見られます。\n", t);
      return;
    }
    playerSetDrum(id);
    const DrumPattern* cur = rhythmDrum(id);
    if (cur) {
      Serial.printf("ドラムを %d「%s」にしました。%s\n", id, cur->name, playerIsPlaying() ? "次のマスから、すぐに反映されます。" : "");
      Serial.println("  ※ ドラムは MIDI チャンネル10 で出ます。ピアノだけの音源（GarageBand のピアノのトラックなど）では、");
      Serial.println("    キック=C・ハイハット=F# などの低いピアノの音になって、不協和に聞こえます。tools/gm_synth（README 6-5）か、DRUM OFF を使ってください。");
    } else {
      Serial.println("ドラムを、なしにしました。");
    }
    return;
  }
  if (strcmp(t, "OFF") == 0 || strcmp(t, "NONE") == 0) {
    playerSetDrum(PATTERN_ID_OFF);
    Serial.println("ドラムを、なしにしました。");
    return;
  }
  if (strcmp(t, "LIST") == 0) { drumList(); return; }
  if (strcmp(t, "SHOW") == 0) {
    char tok[12];
    if (cmdNextToken(&p, tok, sizeof(tok)) && parseId(tok, &id)) drumShow(id);
    else if (playerDrumId() != PATTERN_ID_OFF) drumShow(playerDrumId());
    else Serial.println("使い方: DRUM SHOW 2（IDを指定）");
    return;
  }

  // ここから先は、IDが必要
  char idTok[12];
  if (!cmdNextToken(&p, idTok, sizeof(idTok)) || !parseId(idTok, &id)) {
    Serial.println("DRUM のあとに、ID（番号）が必要です。例: DRUM SET 11 K x...x...  （HELP RHYTHM）");
    return;
  }

  if (strcmp(t, "COPY") == 0) {
    char dstTok[12];
    int dst;
    const DrumPattern* src = rhythmDrum(id);
    if (!cmdNextToken(&p, dstTok, sizeof(dstTok)) || !parseId(dstTok, &dst)) { Serial.println("使い方: DRUM COPY 2 11（2を、自分のスロット11にコピー）"); return; }
    if (!src) { Serial.printf("ドラム %d はありません。\n", id); return; }
    if (!patternIdIsUser(dst)) { Serial.println("コピー先は、自分のスロット（11〜20）にしてください。"); return; }
    DrumPattern* d = rhythmDrumForEdit(dst, true);
    *d = *src;
    Serial.printf("ドラム %d「%s」を、スロット %d にコピーしました。\n", id, src->name, dst);
    drumSaveReport(dst);
    return;
  }
  if (!patternIdIsUser(id)) { printPresetHint("DRUM"); return; }

  if (strcmp(t, "CLEAR") == 0) {
    DrumPattern* d = rhythmDrumForEdit(id, true);
    drumPatternClear(d, d->length);
    rhythmSetName(d->name, "(新しいパターン)");
    Serial.printf("スロット %d を、空にしました。\n", id);
    drumSaveReport(id);
  } else if (strcmp(t, "DELETE") == 0) {
    if (rhythmDrum(id) == nullptr) { Serial.printf("スロット %d は、すでに空き（なし）です。\n", id); return; }
    bool wasSelected = (playerDrumId() == id);
    if (wasSelected) playerSetDrum(PATTERN_ID_OFF);
    rhythmDeleteDrum(id);
    playerReloadPatterns();
    Serial.printf("スロット %d を削除しました。%s\n", id, wasSelected ? "選んでいたので、ドラムは「なし」になりました。" : "");
  } else if (strcmp(t, "NAME") == 0) {
    char name[RHYTHM_NAME_BYTES + 8];
    if (!cmdRest(p, name, sizeof(name))) { Serial.println("使い方: DRUM NAME 11 マイ8ビート"); return; }
    DrumPattern* d = rhythmDrumForEdit(id, true);
    rhythmSetName(d->name, name);
    Serial.printf("名前を「%s」にしました。\n", d->name);
    drumSaveReport(id);
  } else if (strcmp(t, "LEN") == 0) {
    char tok[12];
    long n;
    bool rel;
    if (!cmdNextToken(&p, tok, sizeof(tok)) || !cmdParseInt(tok, &n, &rel) || rel || !rhythmLengthValid((int)n)) { Serial.println("使い方: DRUM LEN 11 16（長さは 8 / 16 / 32）"); return; }
    DrumPattern* d = rhythmDrumForEdit(id, true);
    drumPatternSetLength(d, (int)n);
    Serial.printf("長さを %d マスにしました。\n", (int)n);
    drumSaveReport(id);
  } else if (strcmp(t, "SET") == 0) {
    char laneTok[8];
    char text[RHYTHM_MAX_SLOTS + 8];
    if (!cmdNextToken(&p, laneTok, sizeof(laneTok)) || !cmdNextToken(&p, text, sizeof(text))) { Serial.println("使い方: DRUM SET 11 K x...x...x...x...（レーン K S P H O C R X と、16文字）"); return; }
    int lane = (laneTok[1] == '\0') ? drumLaneFromLetter(laneTok[0]) : -1;
    if (lane < 0) { Serial.println("レーンは K S P H O C R X のどれか1文字です（K キック / S スネア / P サイドスティック / H ハイハット閉 / O ハイハット開 / C クラップ / R ライド / X クラッシュ）。"); return; }
    bool existed = rhythmDrum(id) != nullptr;
    DrumPattern* d = rhythmDrumForEdit(id, true);
    const char* error = nullptr;
    if (!drumPatternSetLane(d, lane, text, &error)) {
      if (!existed) rhythmDeleteDrum(id);  // 失敗したときに、空のスロットを残さない
      Serial.printf("設定できません: %s\n", error ? error : "?");
      return;
    }
    char shown[RHYTHM_MAX_SLOTS + 1];
    drumPatternLaneText(*d, lane, shown, sizeof(shown));
    Serial.printf("%c（%s）= %s\n", drumLaneLetter(lane), drumLaneName(lane), shown);
    drumSaveReport(id);
  } else {
    Serial.println("DRUM の使い方: DRUM 2 / OFF / LIST / SHOW / COPY / SET / NAME / LEN / CLEAR / DELETE  （HELP RHYTHM）");
  }
}

// ---- バッキング ----
void backingList() {
  Serial.println();
  Serial.println("=== バッキング（コードの鳴らし方）のパターン ===");
  Serial.println("プリセット（変更できません）:");
  for (int id = 1; id <= PATTERN_ID_PRESET_LAST; id++) {
    const BackingPattern* p = rhythmBacking(id);
    if (p) Serial.printf("  %2d  %-16s  %s\n", id, p->cells, p->name);   // 日本語の名前は桁がずれるので、最後に置く
  }
  Serial.println("自分のパターン（11〜20。BACKING COPY で作れます）:");
  for (int id = PATTERN_ID_USER_FIRST; id <= PATTERN_ID_USER_LAST; id++) {
    const BackingPattern* p = rhythmBacking(id);
    if (p) Serial.printf("  %2d  %-16s  %s\n", id, p->cells, p->name);
    else Serial.printf("  %2d  （空き）\n", id);
  }
  const BackingPattern* cur = rhythmBacking(playerBackingId());
  Serial.printf("いま選んでいるバッキング: %s\n", cur ? cur->name : "なし（和音は鳴りません）");
}

void backingShow(int id) {
  const BackingPattern* p = rhythmBacking(id);
  if (!p) {
    Serial.printf("バッキング %d はありません。BACKING LIST で一覧を見られます。\n", id);
    return;
  }
  Serial.println();
  rhythmPrintBackingPattern(id, *p);
}

void backingSaveReport(int id) {
  Serial.println(rhythmSaveBacking(id) ? "保存しました。" : "※ 保存に失敗しました（この電源が入っている間だけ有効です）。");
  playerReloadPatterns();
}

void doBacking(const char* arg) {
  char t[24];
  const char* p = arg;
  if (!cmdNextToken(&p, t, sizeof(t))) {
    const BackingPattern* cur = rhythmBacking(playerBackingId());
    if (cur) Serial.printf("バッキング: %d「%s」\n", playerBackingId(), cur->name);
    else Serial.println("バッキング: なし（和音は鳴りません）");
    Serial.println("使い方: BACKING 1 / BACKING OFF / BACKING LIST / BACKING SHOW 6 / BACKING COPY 6 11 / BACKING SET 11 C-------C-------  （HELP RHYTHM）");
    return;
  }
  cmdToUpper(t);
  int id;
  if (cmdIsAllDigits(t)) {  // BACKING 1
    if (!parseId(t, &id) || (id != PATTERN_ID_OFF && rhythmBacking(id) == nullptr)) {
      Serial.printf("バッキング %s はありません。BACKING LIST で一覧を見られます。\n", t);
      return;
    }
    playerSetBacking(id);
    const BackingPattern* cur = rhythmBacking(id);
    if (cur) Serial.printf("バッキングを %d「%s」にしました。%s\n", id, cur->name, playerIsPlaying() ? "次のマスから、すぐに反映されます。" : "");
    else Serial.println("バッキングを、なしにしました（和音は鳴りません。ドラムだけになります）。");
    return;
  }
  if (strcmp(t, "OFF") == 0 || strcmp(t, "NONE") == 0) {
    playerSetBacking(PATTERN_ID_OFF);
    Serial.println("バッキングを、なしにしました（和音は鳴りません。ドラムだけになります）。");
    return;
  }
  if (strcmp(t, "LIST") == 0) { backingList(); return; }
  if (strcmp(t, "SHOW") == 0) {
    char tok[12];
    if (cmdNextToken(&p, tok, sizeof(tok)) && parseId(tok, &id)) backingShow(id);
    else if (playerBackingId() != PATTERN_ID_OFF) backingShow(playerBackingId());
    else Serial.println("使い方: BACKING SHOW 1（IDを指定）");
    return;
  }

  char idTok[12];
  if (!cmdNextToken(&p, idTok, sizeof(idTok)) || !parseId(idTok, &id)) {
    Serial.println("BACKING のあとに、ID（番号）が必要です。例: BACKING SET 11 C-------C-------  （HELP RHYTHM）");
    return;
  }

  if (strcmp(t, "COPY") == 0) {
    char dstTok[12];
    int dst;
    const BackingPattern* src = rhythmBacking(id);
    if (!cmdNextToken(&p, dstTok, sizeof(dstTok)) || !parseId(dstTok, &dst)) { Serial.println("使い方: BACKING COPY 6 11（6を、自分のスロット11にコピー）"); return; }
    if (!src) { Serial.printf("バッキング %d はありません。\n", id); return; }
    if (!patternIdIsUser(dst)) { Serial.println("コピー先は、自分のスロット（11〜20）にしてください。"); return; }
    BackingPattern* d = rhythmBackingForEdit(dst, true);
    *d = *src;
    Serial.printf("バッキング %d「%s」を、スロット %d にコピーしました。\n", id, src->name, dst);
    backingSaveReport(dst);
    return;
  }
  if (!patternIdIsUser(id)) { printPresetHint("BACKING"); return; }

  if (strcmp(t, "CLEAR") == 0) {
    BackingPattern* b = rhythmBackingForEdit(id, true);
    backingPatternClear(b, b->length);
    rhythmSetName(b->name, "(新しいパターン)");
    Serial.printf("スロット %d を、空にしました。\n", id);
    backingSaveReport(id);
  } else if (strcmp(t, "DELETE") == 0) {
    if (rhythmBacking(id) == nullptr) { Serial.printf("スロット %d は、すでに空き（なし）です。\n", id); return; }
    bool wasSelected = (playerBackingId() == id);
    if (wasSelected) playerSetBacking(PATTERN_ID_OFF);
    rhythmDeleteBacking(id);
    playerReloadPatterns();
    Serial.printf("スロット %d を削除しました。%s\n", id, wasSelected ? "選んでいたので、バッキングは「なし」になりました。" : "");
  } else if (strcmp(t, "NAME") == 0) {
    char name[RHYTHM_NAME_BYTES + 8];
    if (!cmdRest(p, name, sizeof(name))) { Serial.println("使い方: BACKING NAME 11 マイアルペジオ"); return; }
    BackingPattern* b = rhythmBackingForEdit(id, true);
    rhythmSetName(b->name, name);
    Serial.printf("名前を「%s」にしました。\n", b->name);
    backingSaveReport(id);
  } else if (strcmp(t, "LEN") == 0) {
    char tok[12];
    long n;
    bool rel;
    if (!cmdNextToken(&p, tok, sizeof(tok)) || !cmdParseInt(tok, &n, &rel) || rel || !rhythmLengthValid((int)n)) { Serial.println("使い方: BACKING LEN 11 16（長さは 8 / 16 / 32）"); return; }
    BackingPattern* b = rhythmBackingForEdit(id, true);
    backingPatternSetLength(b, (int)n);
    Serial.printf("長さを %d マスにしました。\n", (int)n);
    backingSaveReport(id);
  } else if (strcmp(t, "SET") == 0) {
    char text[RHYTHM_MAX_SLOTS + 8];
    if (!cmdNextToken(&p, text, sizeof(text))) { Serial.println("使い方: BACKING SET 11 C-------C-------（8 / 16 / 32 文字。文字は HELP RHYTHM）"); return; }
    bool existed = rhythmBacking(id) != nullptr;
    BackingPattern* b = rhythmBackingForEdit(id, true);
    const char* error = nullptr;
    if (!backingPatternSetCells(b, text, &error)) {
      if (!existed) rhythmDeleteBacking(id);
      Serial.printf("設定できません: %s\n", error ? error : "?");
      return;
    }
    Serial.printf("%s\n", b->cells);
    backingSaveReport(id);
  } else {
    Serial.println("BACKING の使い方: BACKING 1 / OFF / LIST / SHOW / COPY / SET / NAME / LEN / CLEAR / DELETE  （HELP RHYTHM）");
  }
}

// ---- GROOVE: ドラムとバッキングを、まとめて見る・選ぶ ----
void doGroove(const char* arg) {
  char a[12], b[12];
  const char* p = arg;
  bool hasA = cmdNextToken(&p, a, sizeof(a));
  bool hasB = cmdNextToken(&p, b, sizeof(b));
  if (!hasA) {
    playerPrintGroove();
    return;
  }
  if (!hasB) {
    Serial.println("使い方: GROOVE 2 3（ドラム2・バッキング3 を同時に選ぶ。OFF も使える）。中身を見るには GROOVE だけ。");
    return;
  }
  int drum = -1, backing = -1;
  cmdToUpper(a);
  cmdToUpper(b);
  if (strcmp(a, "OFF") == 0) drum = 0; else if (!cmdIsAllDigits(a) || !parseId(a, &drum)) drum = -1;
  if (strcmp(b, "OFF") == 0) backing = 0; else if (!cmdIsAllDigits(b) || !parseId(b, &backing)) backing = -1;
  if (drum < 0 || backing < 0 || (drum != 0 && rhythmDrum(drum) == nullptr) || (backing != 0 && rhythmBacking(backing) == nullptr)) {
    Serial.println("そのパターンはありません。DRUM LIST / BACKING LIST で一覧を見られます。");
    return;
  }
  playerSetDrum(drum);
  playerSetBacking(backing);
  Serial.println("ドラムとバッキングを選びました。");
  playerPrintGroove();
}

}  // namespace

void commandsPollDiagnostics() {
  {   // RETEST の結果（SHADOWLOG がオフでも出す）
    int rr;
    uint32_t ms;
    bool ok;
    while (readersTakeRetestResult(&rr, &ms, &ok)) {
      if (ms == 0) Serial.printf("[再検出] リーダー%d: 15秒たっても、見つけ直せませんでした\n", rr + 1);
      else Serial.printf("[再検出] リーダー%d: %lu ms%s\n", rr + 1, (unsigned long)ms, ok ? "" : "（別のリーダーの駒として見つかったので、取り消しました）");
    }
  }
  if (!shadowLogOn) {
    ReaderEventNote drop;
    while (readersTakeEventNote(&drop)) {}   // 表示しないときは、たまった分を捨てる
    return;
  }
  ReaderEventNote note;
  while (readersTakeEventNote(&note)) {      // 置かれた・外れた・交換のイベントの、原因
    if (note.garbled) {                      // 「返事はあったのに読めない」読み取りが続いて、おさまった（駒は、載ったままとして扱った）
      static const char* const NAMES[] = {"OK", "エラー", "衝突", "タイムアウト", "領域不足", "内部エラー", "不正", "CRC不一致"};
      const char* what = note.wupaStatus == 100 ? "呼びかけは通ったが、UIDを読めない" : (note.wupaStatus >= 0 && note.wupaStatus <= 7 ? NAMES[note.wupaStatus] : "その他");
      Serial.printf("[読み取りの乱れ] リーダー%d: 返事はあったのに読めない読み取りが %d 回続きました（最後の失敗: %s・%lu µs。電波の乱れ。「外れた」とは数えませんでした）\n",
                    note.reader + 1, note.miss, what, (unsigned long)note.wupaUs);
      continue;
    }
    if (note.rescued || note.absorbed) {     // イベントではない記録: 読めなくなったが、「外れた」にならずに済んだ
      const Chord* cc = chordById(tagStoreFind(note.uid));
      Serial.printf("[読み取りの救済] リーダー%d ", note.reader + 1);
      Serial.print(cc ? cc->name : "(未登録)");
      Serial.printf(" ／ %d 回続けて・%lu ms 読めなくなりましたが、%s\n", note.miss, (unsigned long)note.missMs,
                    note.rescued ? "高い感度で読み直したら、駒がいました（外れたとは、数えませんでした）" : "「外れた」と決める前に、また読めました（猶予で、ちらつきを吸収しました）");
      continue;
    }
    const Chord* c = chordById(tagStoreFind(note.uid));
    Serial.printf("[イベントの原因] リーダー%d %s ", note.reader + 1, note.type == READER_EVENT_PLACED ? "置かれた" : (note.type == READER_EVENT_REMOVED ? "外れた" : "交換された"));
    Serial.print(c ? c->name : "(未登録)");
    Serial.printf(" ／ %s", note.cause);
    if (note.byMiss) Serial.printf("（%d回続けて・%lu ms）", note.miss, (unsigned long)note.missMs);
    Serial.println();
  }
  ReaderVerdict v;
  if (!readersTakeVerdict(&v)) return;
  const Chord* chord = chordById(tagStoreFind(v.uid));
  Serial.printf("[影の判定] %s ", v.recheck ? "確かめ直し" : "新しい駒");
  Serial.print(chord ? chord->name : "(未登録)");
  Serial.print("  UID: ");
  printUidBytes(v.uid);
  Serial.print("  ／ ");
  for (int i = 0; i < v.n; i++) Serial.printf("リーダー%d=%d点 ", v.reader[i] + 1, v.score[i]);
  if (v.foundDb > 0) Serial.printf("／ 最初に読めた受信感度 %d dB ", v.foundDb);
  else Serial.print("／ どの感度でも読めなかった ");
  if (v.fineRan) {
    if (v.fineWinner >= 0) Serial.printf("／ 同じ感度から複数が読めたので、しきい値を細かく動かして比べた（%d 段で、リーダー%d だけが読めた）", v.fineSub, v.fineWinner + 1);
    else Serial.print("／ 同じ感度から複数が読めたが、しきい値を細かく動かしても決め手がなかった ");
  }
  if (v.winner >= 0) Serial.printf("→ 持ち主 リーダー%d\n", v.winner + 1);
  else Serial.println("→ 別の駒に邪魔されて、決まらなかった（場所が空くまで待つ）");
}


void commandsPushState() {
  if (midiBackend() != MIDI_BACKEND_NONE) printStateLine();
}

// ------------------------------------------------------------
// 入口
// ------------------------------------------------------------
bool commandsLayoutLearnEvent(const ReaderEvent& event) {
  Layout& layout = boardLayout();
  if (!layout.learning()) return false;
  if (event.type == READER_EVENT_REMOVED) return true;   // 外した。何もしない
  int position = layout.learnNextPosition();
  Layout::LearnResult result = layout.learnPlaced(event.reader);
  if (result == Layout::LEARN_IGNORED) {
    Serial.printf("リーダー%d は、もう覚えました。まだ置いていない場所のリーダーに置いてください。\n", event.reader + 1);
    return true;
  }
  Serial.printf("位置%d = リーダー%d を覚えました。\n", position + 1, event.reader + 1);
  if (result == Layout::LEARN_COMPLETE) {
    saveLayout();
    Serial.println("すべての位置を覚えました。保存しました。");
    printLayout();
  } else {
    printLearnPrompt();
  }
  return true;
}

bool commandsHotkey(char c) {
  if (testActive()) return false;
  switch (c) {
    case '+': case '=': adjustBpm(+5); return true;
    case '-': case '_': adjustBpm(-5); return true;
    case ']': adjustKey(+1); return true;
    case '[': adjustKey(-1); return true;
    default: return false;
  }
}

bool commandsHandle(const char* line) {
  char name[12];
  const char* arg = cmdSplitName(line, name, sizeof(name));
  if (arg == nullptr) return false;  // 英字で始まらない・長すぎる: コマンドではない

  enum { C_NONE, C_BPM, C_START, C_STOP, C_STATUS, C_MIDI, C_VOICING, C_LEAD, C_KEY, C_DRUM, C_BACKING, C_GROOVE, C_IDLE, C_GAIN, C_STATE, C_OCTAVE, C_MAP, C_AUTOSTART, C_BUZZER, C_SHADOWLOG, C_RSTAT, C_RETEST, C_MARGIN, C_PING, C_HELP } cmd = C_NONE;
  if (strcmp(name, "BPM") == 0) cmd = C_BPM;
  else if (strcmp(name, "START") == 0) cmd = C_START;
  else if (strcmp(name, "STOP") == 0) cmd = C_STOP;
  else if (strcmp(name, "STATUS") == 0) cmd = C_STATUS;
  else if (strcmp(name, "MIDI") == 0) cmd = C_MIDI;
  else if (strcmp(name, "VOICING") == 0) cmd = C_VOICING;
  else if (strcmp(name, "LEAD") == 0) cmd = C_LEAD;
  else if (strcmp(name, "KEY") == 0) cmd = C_KEY;
  else if (strcmp(name, "DRUM") == 0 || strcmp(name, "DRUMS") == 0) cmd = C_DRUM;
  else if (strcmp(name, "BACKING") == 0 || strcmp(name, "BACK") == 0 || strcmp(name, "COMP") == 0) cmd = C_BACKING;
  else if (strcmp(name, "GROOVE") == 0) cmd = C_GROOVE;
  else if (strcmp(name, "IDLE") == 0) cmd = C_IDLE;
  else if (strcmp(name, "GAIN") == 0) cmd = C_GAIN;
  else if (strcmp(name, "STATE") == 0) cmd = C_STATE;
  else if (strcmp(name, "OCTAVE") == 0 || strcmp(name, "OCT") == 0) cmd = C_OCTAVE;
  else if (strcmp(name, "MAP") == 0) cmd = C_MAP;
  else if (strcmp(name, "AUTOSTART") == 0) cmd = C_AUTOSTART;
  else if (strcmp(name, "BUZZER") == 0) cmd = C_BUZZER;
  else if (strcmp(name, "SHADOWLOG") == 0) cmd = C_SHADOWLOG;
  else if (strcmp(name, "RSTAT") == 0) cmd = C_RSTAT;
  else if (strcmp(name, "RETEST") == 0) cmd = C_RETEST;
  else if (strcmp(name, "MARGIN") == 0) cmd = C_MARGIN;
  else if (strcmp(name, "PING") == 0) cmd = C_PING;
  else if (strcmp(name, "HELP") == 0) cmd = C_HELP;
  if (cmd == C_NONE) return false;

  if (cmd == C_PING) {  // ブリッジが、約1秒ごとに送ってくる「つながっています」の合図。何も表示しない（テストモード中でも受ける）
    bridgeLinkPing();
    return true;
  }

  if (cmd == C_HELP) {
    char topic[12];
    strncpy(topic, arg, sizeof(topic) - 1);
    topic[sizeof(topic) - 1] = '\0';
    cmdToUpper(topic);
    if (strncmp(topic, "RHYTHM", 6) == 0 || strncmp(topic, "DRUM", 4) == 0 || strncmp(topic, "BACK", 4) == 0) commandsPrintRhythmHelp();
    else commandsPrintHelp();
    return true;
  }
  if (cmd == C_STATE) {  // 状態の表示は、テストモード中でも使える（操作画面が見るため）
    doState(arg);
    return true;
  }
  if (testActive()) {
    Serial.println("RC522 のテストモード中です。q で終了してから使ってください。");
    return true;
  }

  switch (cmd) {
    case C_BPM:     doBpm(arg); break;
    case C_KEY:     doKey(arg); break;
    case C_START:
      if (boardLayout().learning()) {
        Serial.println("配置を覚えさせている途中です。MAP DONE（途中で終える）か MAP CANCEL（やめる）を先にしてください。");
        break;
      }
      registerUiCancelPrompt();  // 登録の入力待ちがあれば、やめる
      if (readersAliveCount() == 0) Serial.println("※ 応答するリーダーがありません。すべての位置が「休み」になります。");
      playerStart();
      break;
    case C_STOP: {
      bool wasPlaying = playerIsPlaying();
      playerStop();
      if (wasPlaying) registerUiBegin();  // 登録の画面に戻る
      break;
    }
    case C_STATUS:  playerPrintStatus(); break;
    case C_MIDI:    doMidi(arg); break;
    case C_VOICING: doVoicing(arg); break;
    case C_OCTAVE:  doOctave(arg); break;
    case C_MAP:     doMap(arg); break;
    case C_AUTOSTART: doAutostart(arg); break;
    case C_BUZZER: doBuzzer(arg); break;
    case C_SHADOWLOG: doShadowLog(arg); break;
    case C_RSTAT: doRstat(arg); break;
    case C_RETEST: doRetest(arg); break;
    case C_MARGIN: doMargin(arg); break;
    case C_LEAD:    doLead(arg); break;
    case C_DRUM:    doDrum(arg); break;
    case C_BACKING: doBacking(arg); break;
    case C_GROOVE:  doGroove(arg); break;
    case C_IDLE:    doIdle(arg); break;
    case C_GAIN:    doGain(arg); break;
    default: break;
  }
  return true;
}
