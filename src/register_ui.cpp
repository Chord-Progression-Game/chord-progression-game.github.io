#include "register_ui.h"

#include <Arduino.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "bridge_link.h"
#include "buzzer.h"
#include "chords.h"
#include "config.h"
#include "rc522_test.h"
#include "ui_util.h"

// このファイルの中だけで使う部品と状態
namespace {

// いま何を待っているか
enum Mode {
  MODE_WAIT_TAG,     // タグをかざすのを待っている
  MODE_ASK_CHANGE,   // 登録済みのタグ: 再登録するか (y/n) の入力を待っている
  MODE_CHOOSE_CHORD  // コードの番号の入力を待っている
};
Mode mode = MODE_WAIT_TAG;
TagUid currentTag = {};  // いま操作しているタグ

// ------------------------------------------------------------
// 表示
// ------------------------------------------------------------

void printUid(const TagUid& uid) {
  Serial.print("UID: ");
  printUidBytes(uid);
  Serial.println();
}

// 登録されているタグの一覧
void printList() {
  Serial.println();
  Serial.printf("=== 登録一覧 (%d / %d 件) ===\n", tagStoreCount(), MAX_TAGS);
  if (tagStoreCount() == 0) {
    Serial.println("まだ登録されたタグはありません。");
    return;
  }
  for (int i = 0; i < tagStoreCount(); i++) {
    TagUid uid;
    uint8_t chordId;
    tagStoreGet(i, &uid, &chordId);
    const Chord* chord = chordById(chordId);
    Serial.printf("%3d) ", i + 1);
    printUidBytes(uid);
    Serial.printf(" → %s\n", chord ? chord->name : "(不明なコード)");
  }
}

// コードの選択メニュー（レベルごとに表示する）
void printMenu() {
  Serial.println();
  Serial.println("登録するコードを選択してください。");
  for (int level = 1; level <= CHORD_LEVEL_SPECIAL; level++) {
    if (level == CHORD_LEVEL_SPECIAL) Serial.printf("\nLv.%d（特殊な駒: 音はなく、再生のときの働きを持つ）\n", level);
    else Serial.printf("\nLv.%d\n", level);
    for (int i = 0; i < chordCount(); i++) {
      const Chord& chord = chordAt(i);
      // 表示する番号は表の並び順（i + 1）。保存するIDとは別
      if (chord.level == level) Serial.printf("%2d: %s\n", i + 1, chord.name);
    }
  }
  Serial.printf("\n番号 (1〜%d) を入力して Enter。やめる場合は 0 を入力。\n", chordCount());
}

// タグ待ちに戻って、案内を表示する
void startWaiting() {
  mode = MODE_WAIT_TAG;
  Serial.println();
  Serial.println("=== NFC Chord Registration ===");
  Serial.println("NFCタグをかざしてください。");
  Serial.println("(l: 登録一覧 / t: ブザーテスト / x: RC522のテスト)");
  Serial.println("(START: コード進行を再生 / STATUS: 状態 / HELP: コマンド一覧)");
}

// ------------------------------------------------------------
// ブザー
// ------------------------------------------------------------

// コードをブザーで鳴らす（登録の合図）。次の3か所から呼ばれる。
//   ・新しく登録できたとき
//   ・登録済みのタグを読んだとき
//   ・ブザーテスト（t）
// 流れ: コードID → ディグリー+タイプ → Keyで実音に → 構成音 → ブザー（アルペジオ）
// ※ ピアノの和音（同時発音）は、コード進行の再生（player.cpp）が MIDI で出す。ブザーは和音を同時には鳴らせない。
// ※ ブリッジがつながっているとき（bridgeLinkAlive）は、ブザーを鳴らさない。Mac（ゲーム・GarageBand）が音を鳴らしているので、
//   ブザーの音がぶつかって邪魔になる。画面に出す文字は、そのまま出す。ブザーテスト（t）だけは、いつも鳴らす
void playChord(uint8_t chordId, const Key& key, bool force = false) {
  const Chord* chord = chordById(chordId);
  if (chord == nullptr) return;
  const bool buzz = buzzerAllowed() && (force || !bridgeLinkAlive());      // BUZZER OFF のとき・電源を入れて10秒のあいだは、鳴らさない（画面に出す文字は、そのまま出す）

  if (chordIsRepeat(*chord)) {  // 「→」は音を持たない: 説明を出して、短い「ピッ」だけ鳴らす
    Serial.println("「→」: 前のコマと同じコードを鳴らす駒です（このコマには、音はありません）。");
    uint8_t beep = BUZZER_BASE_C + 7;
    if (buzz) buzzerPlayArpeggio(&beep, 1);
    return;
  }

  uint8_t notes[MAX_CHORD_NOTES];
  uint8_t count = chordMidiNotes(*chord, key, BUZZER_BASE_C, notes);

  // 画面に表示する（例: Key=C: F  /  ♪ F → A → C）
  char keyText[8], symbol[16], names[40];
  keyName(key, keyText, sizeof(keyText));
  chordSymbol(*chord, key, symbol, sizeof(symbol));
  chordNoteNames(*chord, key, names, sizeof(names));
  Serial.printf("Key=%s: %s", keyText, symbol);
  if (chord->degree == 0) Serial.print("  ※絶対音名のコード（Keyが変わっても同じ音）");
  Serial.println();
  Serial.print("♪ ");
  for (const char* p = names; *p != '\0'; p++) {
    if (*p == ' ') Serial.print(" → ");  // 音名のあいだを矢印でつなぐ
    else Serial.write((uint8_t)*p);
  }
  Serial.println();

  if (buzz) buzzerPlayArpeggio(notes, count);  // 構成音を順番に鳴らす（アルペジオ。待たずに、すぐ戻る）
}

// ------------------------------------------------------------
// 登録
// ------------------------------------------------------------

// タグにコードを登録（または再登録）して、成功したらそのコードを鳴らす
void registerChord(const TagUid& tag, uint8_t chordId) {
  const Chord* chord = chordById(chordId);
  if (chord == nullptr) return;

  uint8_t oldId = tagStoreFind(tag);
  SetResult result = tagStoreSet(tag, chordId);

  Serial.println();
  if (result == SET_FULL) {
    Serial.printf("登録できるタグは最大 %d 件です。これ以上登録できません。\n", MAX_TAGS);
    return;
  }
  if (result == SET_SAVE_FAILED) {
    Serial.println("保存に失敗しました。もう一度試してください。");
    return;
  }

  printUid(tag);
  Serial.println(oldId != 0 ? "再登録しました。" : "登録しました。");
  Serial.printf("コード：%s\n", chord->name);
  playChord(chordId, currentKey);  // 登録できた合図として、そのコードを鳴らす
}

// ------------------------------------------------------------
// タグを読んだとき
// ------------------------------------------------------------

// readerIndex: どのリーダー（0から数える）で読んだか
void onTagScanned(int readerIndex, const TagUid& tag) {
  if (mode != MODE_WAIT_TAG) {
    // 操作の途中で、同じタグをもう一度読んだ: 操作はやり直さない。
    // 登録済みのタグなら、かざすたびにそのコードを鳴らし、そのあと入力待ちであることを知らせる
    if (tag.size == currentTag.size && memcmp(tag.bytes, currentTag.bytes, tag.size) == 0) {
      Serial.println();
      Serial.println("同じタグです。");
      const Chord* chord = chordById(tagStoreFind(tag));
      if (chord != nullptr) {
        Serial.printf("登録済みコード：%s\n", chord->name);
        playChord(chord->id, currentKey);
      }
      Serial.println(mode == MODE_CHOOSE_CHORD ? "番号を入力してください（やめる場合は 0）。"
                                               : "y か n を入力してください。");
      return;
    }
    Serial.println();
    Serial.println("(別のタグをかざしたので、前の操作はキャンセルしました)");
  }
  currentTag = tag;

  Serial.println();
  Serial.printf("NFCタグを検出しました。（リーダー%d）\n", readerIndex + 1);
  printUid(tag);

  uint8_t chordId = tagStoreFind(tag);
  if (chordId == 0) {
    // 未登録のタグ: そのままコードを選んでもらう
    Serial.println();
    Serial.println("このタグにはコードが登録されていません。");
    printMenu();
    mode = MODE_CHOOSE_CHORD;
    return;
  }

  // 登録済みのタグ: 登録されているコードを表示して、鳴らす。勝手に変更はしない
  mode = MODE_ASK_CHANGE;
  const Chord* chord = chordById(chordId);
  if (chord != nullptr) {
    Serial.printf("登録済みコード：%s\n", chord->name);
    playChord(chordId, currentKey);  // 登録されているコードを鳴らす
  } else {
    Serial.printf("登録済みコード：不明 (ID=%d)\n", chordId);
  }

  // そのあとで、再登録するかどうかを確認する
  Serial.println();
  Serial.println("このタグを再登録しますか？ (y: 再登録する / n: そのまま)");
}

// ------------------------------------------------------------
// Serial Monitor から入力があったとき
// ------------------------------------------------------------

void handleWaitTagInput(const char* line) {
  if (isSingleCharCommand(line, 'l')) {
    printList();
  } else if (isSingleCharCommand(line, 't')) {
    Serial.println("\nブザーテスト: Ⅰ");
    playChord(1, currentKey, true);  // コードID 1（Ⅰ）を鳴らす（ブザーテストは、ブリッジがつながっていても鳴らす）
  } else if (isSingleCharCommand(line, 'x')) {
    testEnter();  // RC522 のテストモードへ
  } else {
    startWaiting();
  }
}

void handleAskChangeInput(const char* line) {
  if (isSingleCharCommand(line, 'y')) {
    printMenu();
    mode = MODE_CHOOSE_CHORD;
  } else if (isSingleCharCommand(line, 'n')) {
    Serial.println("再登録しませんでした。");
    startWaiting();
  } else {
    Serial.println("y（再登録する）か n（そのまま）を入力してください。");
  }
}

void handleChooseChordInput(const char* line) {
  char* end;
  long number = strtol(line, &end, 10);
  if (end == line || *end != '\0' || number < 0 || number > chordCount()) {
    Serial.printf("1〜%d の半角数字を入力してください（やめる場合は 0）。\n", chordCount());
    return;
  }
  if (number == 0) {
    Serial.println("キャンセルしました。");
    startWaiting();
    return;
  }
  registerChord(currentTag, chordAt(number - 1).id);  // メニューの番号 → 保存用のID
  startWaiting();
}

}  // namespace

// ------------------------------------------------------------
// 外から呼ばれる部分
// ------------------------------------------------------------
void registerUiBegin() { startWaiting(); }

void registerUiOnTag(int readerIndex, const TagUid& tag) { onTagScanned(readerIndex, tag); }

void registerUiHandleLine(const char* line) {
  switch (mode) {
    case MODE_WAIT_TAG:     handleWaitTagInput(line); break;
    case MODE_ASK_CHANGE:   handleAskChangeInput(line); break;
    case MODE_CHOOSE_CHORD: handleChooseChordInput(line); break;
  }
}

void registerUiCancelPrompt() { mode = MODE_WAIT_TAG; }

void registerUiPrintList() { printList(); }
