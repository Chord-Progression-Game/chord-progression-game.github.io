#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
操作・編集画面（tools/rhythm_editor/index.html）を、本物のブラウザ（ヘッドレス Chrome）で動かして確かめる。
  ・画面に組み込んである自己検査（URL の末尾の #selftest / #selftest-control）が、実際にクリックして結果を書き出す
  ・サーバーは本物（tools/rhythm_server.py）。ESP32 の代わりに、決まった状態を返し、画面から届いた操作を記録する
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
実行:  python3 tools/host_tests/test_ui_browser.py
"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import rhythm_server as rs  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not os.path.exists(CHROME):
    print("（Chrome がないので、ブラウザでの画面のテストは省略）")
    sys.exit(0)

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


STATE = {
    "connected": True, "age": 0.1, "seq": 10, "sid": 1,
    "s": {"bpm": 120, "key": "E♭", "playing": 1, "step": 1, "drum": 2, "backing": 6, "lead": 1, "voicing": 4, "octave": 1, "idle": "RESET", "gain": 33,
          "midi": "BRIDGE", "learn": 0, "map": [4, 3, 2, 1], "chords": [{"name": "Ⅰ", "symbol": "E♭"}, {"name": "Ⅵm", "symbol": "Cm"}, {"name": "-", "symbol": ""}, {"name": "→", "symbol": ""}]},
    "patterns": {"drum": {"11": {"kind": "drum", "id": 11, "exists": True, "length": 16, "name": "マイ・ビート",
                                  "lanes": {"K": "x.......x.x.....", "H": "x.x.x.x.x.x.x.x."}}},
                 "backing": {}},
}
saved, controlled, liveSent = [], [], []
library = rs.Library(os.path.join(tempfile.mkdtemp(), "library.json"))        # 「ゲームに送る」の保存先（試験用の場所）
server = rs.start_in_thread(0, lambda l: saved.append(list(l)), control=lambda l: controlled.append(list(l)), get_state=lambda: STATE,
                            live=lambda l: liveSent.append(list(l)), library=library)
port = server.server_address[1]


def run_chrome(hash_name, budget=12000):
    prof = tempfile.mkdtemp()
    out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + prof,
                          "--virtual-time-budget=%d" % budget, "--dump-dom", "http://127.0.0.1:%d/#%s" % (port, hash_name)],
                         capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    m = re.search(r'<pre id="selftest-result">(.*?)</pre>', out, re.S)
    return m.group(1).replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&").split("\n") if m else None


try:
    for name in ("selftest", "selftest-control"):
        lines = run_chrome(name)
        check("%s: 結果が出た" % name, lines is not None, True)
        for line in lines or []:
            check("%s: %s" % (name, line[5:]), line.startswith("PASS"), True)
    check("画面の操作が、決まった順に ESP32 向けのコマンドになった", controlled, [
        ["BPM 125"], ["KEY D"], ["DRUM 3"], ["BACKING OFF"], ["STOP"], ["LEAD OFF"], ["VOICING 3"], ["KEY +1"], ["OCTAVE 2"], ["MAP LEARN"], ["BPM 150"]])
    check("編集画面の保存も届いた", len(saved), 1)
    # ライブ編集: 最初は全部を保存、そのあとは、変えたところだけを送る
    saved.clear()
    lines = run_chrome("selftest-live", 30000)
    check("selftest-live: 結果が出た", lines is not None, True)
    for line in lines or []:
        check("selftest-live: %s" % line[5:], line.startswith("PASS"), True)
    check("ライブ編集: 全部を保存した回（最初・長さ変更・バッキング）", saved, [
        ["DRUM CLEAR 12", "DRUM LEN 12 16", "DRUM SET 12 K x...............", "DRUM NAME 12 ライブ", "DRUM 12"],
        ["DRUM CLEAR 12", "DRUM LEN 12 8", "DRUM SET 12 K x...x...", "DRUM SET 12 S ....x...", "DRUM SET 12 H ..x.....", "DRUM NAME 12 ライブ2", "DRUM 12"],
        ["BACKING CLEAR 13", "BACKING LEN 13 16", "BACKING SET 13 C-------C-------", "BACKING NAME 13 ライブB", "BACKING 13"]])
    check("ライブ編集: 変えたところだけを送った（レーン単位・名前・バッキング全体）", liveSent, [
        ["DRUM SET 12 K x...x...........", "DRUM SET 12 S ....x..........."],
        ["DRUM SET 12 K x...x...x......."],
        ["DRUM NAME 12 ライブ2"],
        ["DRUM SET 12 H ..x............."],
        ["BACKING SET 13 C---C---C-------"]])
    # ゲームに送る（名前をつけて、ゲームのライブラリに入れる）。ESP32 には、何も送らない
    saved.clear(); liveSent.clear()
    lines = run_chrome("selftest-game", 40000)
    check("selftest-game: 結果が出た", lines is not None, True)
    for line in lines or []:
        check("selftest-game: %s" % line[5:], line.startswith("PASS"), True)
    snap = library.snapshot()
    check("ゲームに送る: 最後に残ったもの（ドラムは削除・バッキング1・進行1）", [len(snap["drums"]), [b["name"] for b in snap["backings"]], [(p["name"], p["chords"], p["points"], p["startAt"]) for p in snap["progressions"]]],
          [0, ["朝のアルペジオ"], [("ツーファイブ", ["Ⅴ7", "ⅠM7"], 300, "any")]])         # 点数は、手で変えていなければ、駒の数に合わせて変わる（150 × 2）
    check("ゲームに送る: ESP32 には、何も送っていない", [saved, liveSent], [[], []])
finally:
    server.shutdown()

print("test_ui_browser: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
