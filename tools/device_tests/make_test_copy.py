#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機テスト用に、本番のプロジェクトをコピーして、テスト専用の「疑似タグ」の操作を足す。
  本番のファイルは変えない。コピーの中だけに、次の改造をする:
    ・保存場所を、本番の "chordtag"（タグの登録）・"rhythm"（自分のリズムのパターン）・"settings"（リーダーの設定）ではなく、
      "chordtest"・"rhythmtest"・"settingstest" にする（本物の登録・設定に触らない）
    ・Serial から、疑似のタグを置く操作ができるようにする（@ で始まる行）
         @P <位置1-4> <UIDの16進数>   その位置に、そのUIDのタグが載っていることにする
         @R <位置1-4>                 その位置のタグを外す
         @T <UIDの16進数> <コードID>   そのタグに、コードを登録する（chordtest に保存）
         @U <リーダー1-4> <UID>        登録の画面に、タグが置かれたことにする
         @Z                           chordtest・rhythmtest・settingstest を空にする
         @B                           ESP32 を再起動する
  疑似のタグを置いた位置は、本物のリーダーが読んだ結果で上書きされない（読み取りの時間は、本物と同じようにかかる）。
使い方:  python3 tools/device_tests/make_test_copy.py <コピー先のフォルダ>
"""
import glob
import os
import shutil
import sys

SRC = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dst = sys.argv[1]
EMULATE_4 = "--emulate-4-readers" in sys.argv   # リーダー3・4が「いる」ことにして、読み取りの時間（約35ms）だけを再現する
shutil.rmtree(dst, ignore_errors=True)
os.makedirs(dst + "/src")
shutil.copy(SRC + "/platformio.ini", dst)
# 実機のテストは、配線している台数（2〜4台）に合わせて、4台構成で作る（本番のファームは、標準で8台構成）
with open(dst + "/platformio.ini", "a", encoding="utf-8") as f:
    f.write("build_flags = -DNUM_READERS_CONFIG=4\n")
for f in glob.glob(SRC + "/src/*"):
    shutil.copy(f, dst + "/src")


def patch(path, edits):
    s = open(path, encoding="utf-8").read()
    for old, new in edits:
        assert old in s, "見つからない: %r (%s)" % (old[:50], path)
        s = s.replace(old, new, 1)
    open(path, "w", encoding="utf-8").write(s)


# ---- reader_array: 疑似タグの位置は、本物の読み取りの結果で上書きしない ----
patch(dst + "/src/reader_array.h", [(
    "void readersResetPresence();",
    "void readersResetPresence();\nvoid readersDebugSet(int reader, bool present, const TagUid* uid);  // ★テスト専用")])
patch(dst + "/src/reader_array.cpp", [(
    "bool readersPollNext(ReaderEvent* event) {\n  int i = nextReader;\n  nextReader = (nextReader + 1) % NUM_READERS;\n  if (!alive[i]) return false;\n",
    "static bool debugLocked[NUM_READERS];  // ★テスト専用\n"
    "void readersDebugSet(int reader, bool present, const TagUid* uid) {  // ★テスト専用\n"
    "  debugLocked[reader] = true;\n  presence[reader].present = present;\n  presence[reader].miss = 0;\n"
    "  if (uid != nullptr) presence[reader].uid = *uid;\n}\n\n"
    "bool readersPollNext(ReaderEvent* event) {\n  int i = nextReader;\n  nextReader = (nextReader + 1) % NUM_READERS;\n"
    "  if (!alive[i]) return false;\n"
    "  if (debugLocked[i]) {  // ★テスト専用: 本物と同じ時間をかけて読むが、結果は捨てる\n"
    "    TagUid ignored;\n    readersScanOne(i, &ignored);\n    return false;\n  }\n")])

if EMULATE_4:
    # リーダー3・4（配線していない）を、「応答する」ことにして、1回の読み取りに35msかける（4台ぶんの読み取りの負荷を再現）
    patch(dst + "/src/reader_array.cpp", [
        ("static void wake(int i) {\n", "static void wake(int i) {\n  if (i >= 2) return;  // ★テスト専用: 疑似リーダーは、本物のSPIに触らない\n"),
        ("static void park(int i) {\n", "static void park(int i) {\n  if (i >= 2) return;  // ★テスト専用\n"),
        ("  for (int i = 0; i < NUM_READERS; i++) {\n    if (!alive[i]) continue;\n    wake(i);\n    bool good = lastWakeFast;",
         "  for (int i = 0; i < NUM_READERS; i++) {\n    if (!alive[i] || i >= 2) continue;  // ★テスト専用\n    wake(i);\n    bool good = lastWakeFast;"),
        ("bool readersProbe(int i, uint8_t* version) {\n",
         "bool readersProbe(int i, uint8_t* version) {\n  if (i >= 2) {  // ★テスト専用\n    alive[i] = true; baseVersion[i] = 0x92;\n    if (version != nullptr) *version = 0x92;\n    return true;\n  }\n"),
        ("bool readersScanOne(int i, TagUid* uid) {\n  if (!alive[i]) return false;\n",
         "bool readersScanOne(int i, TagUid* uid) {\n  if (!alive[i]) return false;\n  if (i >= 2) { delay(35); return false; }  // ★テスト専用\n"),
    ])
    print("（リーダー3・4を、読み取りに35msかかる疑似リーダーにしました）")

# ---- main: 保存場所を変え、疑似タグの操作を足す ----
hook = r'''
// ★テスト専用: 疑似のタグを置く操作
static TagUid hexToUid(const char* hex) {
  TagUid u = {};
  for (const char* h = hex; h[0] && h[1] && u.size < MAX_UID_SIZE; h += 2) {
    char two[3] = {h[0], h[1], 0};
    u.bytes[u.size++] = (uint8_t)strtol(two, nullptr, 16);
  }
  return u;
}
static void testHook(char* args) {
  char cmd = args[0];
  char* rest = args + 1;
  while (*rest == ' ') rest++;
  if (cmd == 'Z') {
    const char* spaces[] = {"chordtest", "rhythmtest", "settingstest"};
    for (const char* ns : spaces) { Preferences p; p.begin(ns, false); p.clear(); p.end(); }
    tagStoreBegin("chordtest");
    rhythmStoreBegin("rhythmtest");   // 自分のパターンを、空の状態に読み直す
    Serial.println("TEST: chordtest cleared");
  } else if (cmd == 'T') {
    char* sp = strchr(rest, ' ');
    if (!sp) return;
    *sp = '\0';
    TagUid u = hexToUid(rest);
    int id = atoi(sp + 1);
    SetResult r = tagStoreSet(u, (uint8_t)id);
    Serial.printf("TEST: registered %s -> id %d (%s)\n", rest, id, r == SET_OK ? "ok" : "FAILED");
  } else if (cmd == 'P') {
    char* sp = strchr(rest, ' ');
    if (!sp) return;
    *sp = '\0';
    int pos = atoi(rest);
    TagUid u = hexToUid(sp + 1);
    int reader = boardReaderOfPosition(pos - 1);
    if (reader < 0) return;
    ReaderEvent ev;
    bool had = readerHasTag(reader);
    readersDebugSet(reader, true, &u);
    ev.type = had ? READER_EVENT_CHANGED : READER_EVENT_PLACED;
    ev.reader = reader;
    ev.uid = u;
    if (playerIsPlaying()) onReaderEvent(ev);   // 再生中だけ、本物の読み取りと同じ流れで通知する（登録の画面でブザーが鳴らないように）
  } else if (cmd == 'R') {
    int pos = atoi(rest);
    int reader = boardReaderOfPosition(pos - 1);
    if (reader < 0) return;
    ReaderEvent ev;
    ev.type = READER_EVENT_REMOVED;
    ev.reader = reader;
    ev.uid = readerTagUid(reader);
    readersDebugSet(reader, false, nullptr);
    if (playerIsPlaying()) onReaderEvent(ev);
  } else if (cmd == 'B') {
    Serial.println("TEST: restarting");
    Serial.flush();
    delay(100);
    ESP.restart();   // 再起動（保存されたパターン・設定が残っているかの確認用）
  } else if (cmd == 'U') {
    char* sp = strchr(rest, ' ');
    if (!sp) return;
    *sp = '\0';
    registerUiOnTag(atoi(rest) - 1, hexToUid(sp + 1));
  }
}
'''
patch(dst + "/src/main.cpp", [
    ("#include <Arduino.h>\n#include <string.h>\n", "#include <Arduino.h>\n#include <Preferences.h>\n#include <stdlib.h>\n#include <string.h>\n"),
    ("tagStoreBegin()", 'tagStoreBegin("chordtest")'),
    ("settingsBegin();", 'settingsBegin("settingstest");'),
    ("playerBoot()", "playerBoot(false)"),   # テスト用のコピーは、自動再生しない（登録の画面で始まる）
    ("rhythmStoreBegin();", 'rhythmStoreBegin("rhythmtest");'),
    ("// Enter が押されて1行そろったときに呼ばれる\nvoid onLine(char* rawLine) {",
     "void onReaderEvent(const ReaderEvent& event);\n" + hook + "\n// Enter が押されて1行そろったときに呼ばれる\nvoid onLine(char* rawLine) {"),
    ("  // START / STOP / BPM / KEY / DRUM / BACKING / STATUS / MIDI / HELP ...\n", "  if (line[0] == '@') { testHook((char*)line + 1); return; }  // ★テスト専用\n  // START / STOP / BPM / KEY / DRUM / BACKING / STATUS / MIDI / HELP ...\n"),
])
print("テスト用のコピーを作りました:", dst)
