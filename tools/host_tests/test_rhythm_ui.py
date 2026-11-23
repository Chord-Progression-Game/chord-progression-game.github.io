#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
リズム編集画面のサーバー(tools/rhythm_server.py)のテスト（ブラウザも ESP32 も使わない。標準の python3 だけで動く）
  1. プリセットの JSON が、ファームのプリセットと一致しているか（編集画面の「プリセットから始める」の元）
  2. 画面から届いた内容 → ESP32 のコマンド への変換と、間違った内容の拒否
  3. HTTP サーバー（本物を立てて、送る・断る）
  4. 全プリセットを「編集画面から送った」コマンドにして、ファイルに書き出す（ファーム側のテストが、それを実行して中身を確かめる）
実行:  python3 tools/host_tests/test_rhythm_ui.py [コマンドの書き出し先]
"""
import http.client as httpc
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import rhythm_server as rs  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def rejects(name, req):
    global fails, checks
    checks += 1
    try:
        rs.build_commands(req)
        fails += 1
        print("FAIL %s: 拒否されなかった" % name)
    except ValueError:
        pass


# ---- 1. プリセットの JSON がファームと一致 ----
with tempfile.TemporaryDirectory() as tmp:
    exe = os.path.join(tmp, "dump")
    subprocess.check_call(["g++", "-std=gnu++11", "-I" + os.path.join(ROOT, "src"), os.path.join(HERE, "dump_presets.cpp"),
                           os.path.join(ROOT, "src", "rhythm.cpp"), "-o", exe])
    fresh = json.loads(subprocess.check_output([exe]).decode("utf-8"))
with open(os.path.join(ROOT, "tools", "rhythm_editor", "presets.json"), encoding="utf-8") as f:
    saved = json.load(f)
check("presets.json はファームのプリセットと同じ（違うときは sh tools/rhythm_editor/gen_presets.sh）", saved, fresh)
check("ドラムのプリセット数", len(saved["drums"]), 7)
check("バッキングのプリセット数", len(saved["backings"]), 9)

# ---- 2. 変換 ----
drum = {"kind": "drum", "slot": 11, "name": "マイ・ビート", "length": 16, "select": True,
        "lanes": {"K": "x.....x.x...x...", "S": "....x.......x...", "H": "x.x.x.x.x.x.x.x.", "O": "................"}}
check("ドラムのコマンド（空のレーンは送らない。レーンは決まった順）", rs.build_commands(drum), [
    "DRUM CLEAR 11", "DRUM LEN 11 16", "DRUM SET 11 K x.....x.x...x...", "DRUM SET 11 S ....x.......x...",
    "DRUM SET 11 H x.x.x.x.x.x.x.x.", "DRUM NAME 11 マイ・ビート", "DRUM 11"])
drum2 = dict(drum, select=False, name="  ")
check("名前が空なら標準の名前、選ばない", rs.build_commands(drum2)[-1], "DRUM NAME 11 マイ・パターン")
check("選ばないときは DRUM 11 を送らない", "DRUM 11" in rs.build_commands(drum2), False)
backing = {"kind": "backing", "slot": 12, "name": "ゆったり", "length": 16, "cells": "C-------C-------", "select": True}
check("バッキングのコマンド", rs.build_commands(backing), [
    "BACKING CLEAR 12", "BACKING LEN 12 16", "BACKING SET 12 C-------C-------", "BACKING NAME 12 ゆったり", "BACKING 12"])
check("名前の空白を整える", rs.build_commands(dict(backing, name="  a   b  "))[3], "BACKING NAME 12 a b")

rejects("保存先が範囲外(10)", dict(drum, slot=10))
rejects("保存先が範囲外(21)", dict(drum, slot=21))
rejects("保存先が文字", dict(drum, slot="11"))
rejects("保存先が真偽値", dict(drum, slot=True))
rejects("長さが不正", dict(drum, length=12))
rejects("レーンの長さが違う", dict(drum, lanes={"K": "x..."}))
rejects("レーンの文字が不正", dict(drum, lanes={"K": "x...q..........."}))
rejects("レーン名が不正", dict(drum, lanes={"Z": "x..............."}))
rejects("音が1つもない", dict(drum, lanes={"K": "................"}))
rejects("lanes がない", {"kind": "drum", "slot": 11, "length": 16})
rejects("名前が長い", dict(drum, name="あ" * 21))
rejects("名前に制御文字", dict(drum, name="a\nDRUM CLEAR 12"))
rejects("名前に改行でコマンドを混ぜる", dict(backing, name="x\rSTART"))
rejects("バッキングの文字が不正", dict(backing, cells="C-X-----C-------"))
rejects("バッキングの長さが違う", dict(backing, cells="C---"))
rejects("先頭の - は不正", dict(backing, cells="-C------C-------"))
rejects(". のあとの - は不正", dict(backing, cells="C.-.....C-------"))
rejects("バッキングに音がない", dict(backing, cells="................"))
rejects("種類が不正", {"kind": "start", "slot": 11})
rejects("辞書ではない", ["DRUM"])
check("--- が続けられる", rs.build_commands(dict(backing, cells="1---2---3---4---"))[2], "BACKING SET 12 1---2---3---4---")
check("8マスのバッキング", rs.build_commands(dict(backing, length=8, cells="C-------"))[1], "BACKING LEN 12 8")
check("32マスのドラム", rs.build_commands(dict(drum, length=32, lanes={"K": "x" + "." * 31}))[1], "DRUM LEN 11 32")
# どんな入力でも、送るのは DRUM / BACKING で始まる行だけ
allowed = all(l.split()[0] in ("DRUM", "BACKING") for l in rs.build_commands(drum) + rs.build_commands(backing))
check("送るのは DRUM / BACKING のコマンドだけ", allowed, True)

# ---- 2b. 操作画面の操作 → コマンド ----
bc = rs.build_control_commands
check("BPM", bc({"action": "bpm", "value": 125}), ["BPM 125"])
check("BPM の下限・上限", (bc({"action": "bpm", "value": 30}), bc({"action": "bpm", "value": 240})), (["BPM 30"], ["BPM 240"]))
check("キー", [bc({"action": "key", "value": k})[0] for k in ("C", "Db", "F#", "Bb")], ["KEY C", "KEY Db", "KEY F#", "KEY Bb"])
check("キー ±1", (bc({"action": "key_shift", "value": 1}), bc({"action": "key_shift", "value": -1})), (["KEY +1"], ["KEY -1"]))
check("ドラム", (bc({"action": "drum", "value": 3}), bc({"action": "drum", "value": 0}), bc({"action": "drum", "value": 20})), (["DRUM 3"], ["DRUM OFF"], ["DRUM 20"]))
check("バッキング", (bc({"action": "backing", "value": 11}), bc({"action": "backing", "value": 0})), (["BACKING 11"], ["BACKING OFF"]))
check("高さ", (bc({"action": "octave", "value": -1}), bc({"action": "octave", "value": 3})), (["OCTAVE -1"], ["OCTAVE 3"]))
check("LEAD / VOICING / 再生", (bc({"action": "lead", "value": True}), bc({"action": "lead", "value": False}), bc({"action": "voicing", "value": 3}),
                              bc({"action": "play", "value": True}), bc({"action": "play", "value": False})),
      (["LEAD ON"], ["LEAD OFF"], ["VOICING 3"], ["START"], ["STOP"]))
check("診断ログ（SHADOWLOG）", (bc({"action": "shadowlog", "value": True}), bc({"action": "shadowlog", "value": False})), (["SHADOWLOG ON"], ["SHADOWLOG OFF"]))
for bad in [{"action": "shadowlog", "value": "ON"}, {"action": "shadowlog"}, {"action": "bpm", "value": 29}, {"action": "bpm", "value": 241}, {"action": "bpm", "value": "120"}, {"action": "bpm", "value": True},
            {"action": "bpm", "value": 120.5}, {"action": "key", "value": "H"}, {"action": "key", "value": "C\nSTART"}, {"action": "key_shift", "value": 2},
            {"action": "drum", "value": 21}, {"action": "drum", "value": -1}, {"action": "backing", "value": "1; START"},
            {"action": "lead", "value": "ON"}, {"action": "voicing", "value": 5}, {"action": "octave", "value": 4}, {"action": "octave", "value": -2}, {"action": "play", "value": 1},
            {"action": "midi", "value": "OFF"}, {"action": "idle", "value": "RESET"}, {"action": None}, {}, []]:
    checks += 1
    try:
        rs.build_control_commands(bad)
        fails += 1
        print("FAIL 拒否されなかった:", bad)
    except ValueError:
        pass

# ---- 2b2. ライブ編集（変えたところだけ）----
bl = rs.build_live_commands
check("ライブ: ドラムのレーン（決まった順）", bl({"kind": "drum", "slot": 12, "length": 16, "lanes": {"S": "....x...........", "K": "x..............."}}),
      ["DRUM SET 12 K x...............", "DRUM SET 12 S ....x..........."])
check("ライブ: レーンを空にもできる", bl({"kind": "drum", "slot": 12, "length": 8, "lanes": {"H": "........"}}), ["DRUM SET 12 H ........"])
check("ライブ: 名前だけ", bl({"kind": "drum", "slot": 12, "length": 16, "lanes": {}, "name": "新しい名前"}), ["DRUM NAME 12 新しい名前"])
check("ライブ: バッキング全体と名前", bl({"kind": "backing", "slot": 13, "length": 8, "cells": "C-------", "name": "x"}), ["BACKING SET 13 C-------", "BACKING NAME 13 x"])
for bad in [{"kind": "drum", "slot": 10, "length": 16, "lanes": {"K": "x" * 16}}, {"kind": "drum", "slot": 12, "length": 12, "lanes": {"K": "x" * 12}},
            {"kind": "drum", "slot": 12, "length": 16, "lanes": {"K": "x..."}}, {"kind": "drum", "slot": 12, "length": 16, "lanes": {"Z": "x" * 16}},
            {"kind": "drum", "slot": 12, "length": 16, "lanes": {"K": "q" * 16}}, {"kind": "drum", "slot": 12, "length": 16, "lanes": {}},
            {"kind": "drum", "slot": 12, "length": 16, "lanes": {}, "name": "a\nSTART"}, {"kind": "backing", "slot": 13, "length": 8, "cells": "-C------"},
            {"kind": "backing", "slot": 13, "length": 8, "cells": "........"}, {"kind": "backing", "slot": 13, "length": 8}, {"kind": "start", "slot": 12, "length": 8}, []]:
    checks += 1
    try:
        bl(bad)
        fails += 1
        print("FAIL ライブ: 拒否されなかった:", bad)
    except ValueError:
        pass

# ---- 2b3. 配置（MAP）----
check("配置の操作", [bc({"action": a})[0] for a in ("map_learn", "map_done", "map_cancel", "map_reset")], ["MAP LEARN", "MAP DONE", "MAP CANCEL", "MAP RESET"])
check("配置の指定", bc({"action": "map", "value": [4, 3, 2, 1, 5, 6, 7, 8]}), ["MAP 4 3 2 1 5 6 7 8"])
for bad in [{"action": "map", "value": [1, 1, 2, 3]}, {"action": "map", "value": [0, 1, 2, 3]}, {"action": "map", "value": [1, 2, 3, 5]}, {"action": "map", "value": "1 2 3 4"},
            {"action": "map", "value": []}, {"action": "map", "value": list(range(1, 10))}, {"action": "map", "value": [True, 2]}, {"action": "map_learn2"}]:
    checks += 1
    try:
        rs.build_control_commands(bad)
        fails += 1
        print("FAIL 配置: 拒否されなかった:", bad)
    except ValueError:
        pass

# ---- 2c. STATE の読み取り ----
st = rs.parse_state_line("~S bpm=120 key=E♭ playing=1 step=2 drum=2 backing=6 lead=1 voicing=4 octave=2 idle=RESET gain=33 midi=BRIDGE learn=2 map=4,3,2,1,5,6,7,8 chords=Ⅰ,E♭;-,;?,;→,")
check("STATE: 配置と覚えさせ中", (st["map"], st["learn"]), ([4, 3, 2, 1, 5, 6, 7, 8], 2))
check("高さ（古いファームは 0）の確認の前に、配置のない古い行", rs.parse_state_line("~S bpm=1 key=C playing=0 step=-1 drum=0 backing=0 lead=1 voicing=4 idle=OFF gain=33 midi=NONE chords=-,")["map"], [])
check("STATE: 高さ（古いファームは 0）", (st["octave"], rs.parse_state_line("~S bpm=1 key=C playing=0 step=-1 drum=0 backing=0 lead=1 voicing=4 idle=OFF gain=33 midi=NONE chords=-,")["octave"]), (2, 0))
check("STATE: 数字", [st[k] for k in ("bpm", "playing", "step", "drum", "backing", "lead", "voicing", "gain")], [120, 1, 2, 2, 6, 1, 4, 33])
check("STATE: 文字", [st["key"], st["idle"], st["midi"]], ["E♭", "RESET", "BRIDGE"])
check("STATE: コード", st["chords"], [{"name": "Ⅰ", "symbol": "E♭"}, {"name": "-", "symbol": ""}, {"name": "?", "symbol": ""}, {"name": "→", "symbol": ""}])
check("STATE: 形が違えば None", (rs.parse_state_line("hello"), rs.parse_state_line("~S bpm=abc key=C"), rs.parse_state_line("~S bpm=120")), (None, None, None))
check("パターン(ドラム)", rs.parse_pattern_line("~P drum 11 16 K=x...x...x...x...,S=....x.......x... マイ ビート"),
      {"kind": "drum", "id": 11, "exists": True, "length": 16, "name": "マイ ビート", "lanes": {"K": "x...x...x...x...", "S": "....x.......x..."}})
check("パターン(バッキング)", rs.parse_pattern_line("~P backing 12 8 C------- ゆったり"),
      {"kind": "backing", "id": 12, "exists": True, "length": 8, "name": "ゆったり", "cells": "C-------"})
check("パターン(空き)", rs.parse_pattern_line("~P drum 13 0 - -"), {"kind": "drum", "id": 13, "exists": False})
check("パターン: 形が違えば None", (rs.parse_pattern_line("~P drum x 16 a b"), rs.parse_pattern_line("~P bogus 1 16 a b"), rs.parse_pattern_line("~P drum 1")), (None, None, None))

# ---- 2b. ステップの合図（ファームの ~T の行）と、画面への配り役 ----
check("~T: ステップ番号", rs.parse_step_line("~T 3"), 3)
check("~T: 先頭は 0", rs.parse_step_line("~T 0"), 0)
check("~T: 停止は -1", rs.parse_step_line("~T -1"), -1)
check("~T: 形が違えば None", (rs.parse_step_line("~T x"), rs.parse_step_line("~T"), rs.parse_step_line("~S 1"), rs.parse_step_line("~T 100"), rs.parse_step_line("~T -2")), (None, None, None, None, None))
hub0 = rs.EventHub()
q1 = hub0.subscribe()
hub0.publish({"step": 1})
hub0.publish({"step": 2})
check("配り役: 受け取った順に届く", (q1.get_nowait(), q1.get_nowait()), ({"step": 1}, {"step": 2}))
q2 = hub0.subscribe()
check("配り役: あとからつないだ画面には、直前の1件が届く", q2.get_nowait(), {"step": 2})
hub0.unsubscribe(q1)
hub0.publish({"step": 3})
check("配り役: やめた画面には届かない・つないでいる画面には届く", (q1.empty(), q2.get_nowait()), (True, {"step": 3}))
hub0.close()
check("配り役: 終わりの合図（None）が届く", q2.get_nowait(), None)

# ---- 2c. ゲーム用のライブラリ（名前をつけたドラム・バッキング・固有進行）----
import tempfile as _tf
lib_dir = _tf.mkdtemp()
lib_path = os.path.join(lib_dir, "library.json")
lib = rs.Library(lib_path)
pr = lib.put("progression", {"name": "コンファメ", "chords": ["ⅠM7", "Ⅶm7-5", "Ⅲ7", "Ⅵm7"]})
check("ライブラリ: 進行を保存（id・点数・始まりの場所が付く）", (pr["id"], pr["points"], pr["startAt"], pr["chords"]), ("p1", 600, "head", ["ⅠM7", "Ⅶm7-5", "Ⅲ7", "Ⅵm7"]))
dr = lib.put("drum", {"name": "マイ・ビート", "length": 16, "lanes": {"K": "x...x...x...x...", "H": "x.x.x.x.x.x.x.x.", "S": "................"}})
check("ライブラリ: ドラムを保存（空のレーンは落とす）", (dr["id"], sorted(dr["lanes"].keys())), ("d2", ["H", "K"]))
bk = lib.put("backing", {"name": "裏打ちチョップ", "length": 16, "cells": "..C...C...C...C."})
check("ライブラリ: バッキングを保存", (bk["id"], bk["cells"]), ("b3", "..C...C...C...C."))
pr2 = lib.put("progression", {"name": "コンファメ", "chords": ["ⅠM7", "Ⅶm7-5", "Ⅲ7", "Ⅵm7", "Ⅴm7", "Ⅰ7"], "points": 900, "startAt": "any"})
check("ライブラリ: 同じ名前で保存し直すと、上書き（id は同じ。作りながら、ゲームに送り続けられる）", (pr2["id"], len(lib.snapshot()["progressions"]), pr2["points"], pr2["startAt"]), ("p1", 1, 900, "any"))
check("ライブラリ: 変えるたびに、順番号（seq）が増える", lib.snapshot()["seq"], 4)
lib2 = rs.Library(lib_path)
check("ライブラリ: ファイルに残る（作り直しても、読み込める）", (len(lib2.snapshot()["drums"]), lib2.snapshot()["progressions"][0]["name"], lib2.snapshot()["seq"]), (1, "コンファメ", 4))
check("ライブラリ: 保存のあとの番号は、続きから（id が重ならない）", lib2.put("drum", {"name": "もうひとつ", "length": 8, "lanes": {"K": "x...x..."}})["id"], "d4")
lib2.delete("drum", "d4")
check("ライブラリ: 削除", [x["id"] for x in lib2.snapshot()["drums"]], ["d2"])
bads = [
    ("progression", {"name": "", "chords": ["Ⅰ", "Ⅴ"]}), ("progression", {"name": "  ", "chords": ["Ⅰ", "Ⅴ"]}), ("progression", {"name": "あ", "chords": ["Ⅰ"]}),
    ("progression", {"name": "あ", "chords": ["Ⅰ", "ⅹ"]}), ("progression", {"name": "あ", "chords": ["Ⅰ"] * 9}), ("progression", {"name": "あ", "chords": ["Ⅰ", "→"]}),
    ("progression", {"name": "あ", "chords": ["Ⅰ", "Ⅴ"], "points": 10}), ("progression", {"name": "あ", "chords": ["Ⅰ", "Ⅴ"], "startAt": "middle"}),
    ("progression", {"name": "あ" * 21, "chords": ["Ⅰ", "Ⅴ"]}), ("progression", {"name": "あ\nSTART", "chords": ["Ⅰ", "Ⅴ"]}), ("progression", {"name": "あ", "chords": "ⅠⅤ"}),
    ("drum", {"name": "a", "length": 12, "lanes": {"K": "x" * 12}}), ("drum", {"name": "a", "length": 8, "lanes": {"K": "x..."}}), ("drum", {"name": "a", "length": 8, "lanes": {"Z": "x......."}}),
    ("drum", {"name": "a", "length": 8, "lanes": {"K": "q......."}}), ("drum", {"name": "a", "length": 8, "lanes": {"K": "........"}}), ("drum", {"name": "a", "length": 8, "lanes": {}}),
    ("backing", {"name": "a", "length": 8, "cells": "........"}), ("backing", {"name": "a", "length": 8, "cells": "C---"}), ("backing", {"name": "a", "length": 8, "cells": "C--X----"}),
    ("sound", {"name": "a"}), ("drum", "x"), ("drum", None),
]
for kind, item in bads:
    checks += 1
    try:
        lib.put(kind, item)
        fails += 1
        print("FAIL ライブラリ: 拒否されなかった:", kind, item)
    except ValueError:
        pass
check("ライブラリ: 検査で弾いた内容は、保存されない", (len(lib.snapshot()["progressions"]), len(lib.snapshot()["drums"]), len(lib.snapshot()["backings"])), (1, 1, 1))
broken = os.path.join(lib_dir, "broken.json")
open(broken, "w").write("{ これはJSONではない")
check("ライブラリ: 壊れたファイルは、空から始める（ブリッジは止まらない）", rs.Library(broken).snapshot()["progressions"], [])

# ---- 3. HTTP サーバー ----
hub = rs.EventHub()
sent = []
ctl, refreshed, liv, bridged = [], [], [], []
server = rs.start_in_thread(0, lambda lines: sent.append(list(lines)), lambda: "テスト", control=lambda l: ctl.append(list(l)),
                            get_state=lambda: {"connected": True, "s": {"bpm": 99}}, refresh=lambda: refreshed.append(1), live=lambda l: liv.append(list(l)), events=hub,
                            bridge=lambda a: (bridged.append(a), {"ok": True, "killed": [], "others": [], "open": True, "port": None})[1],
                            library=rs.Library(os.path.join(lib_dir, "http_library.json")))
port = server.server_address[1]
base = "http://127.0.0.1:%d" % port


def http(method, path, body=None, ctype="application/json", host=None):
    req = urllib.request.Request(base + path, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", ctype)
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


try:
    code, page = http("GET", "/")
    check("画面が開ける", code, 200)
    text = page.decode("utf-8")
    check("画面にプリセットが埋め込まれている", "__PRESETS__" not in text and "メトロノーム" in text, True)
    check("画面のタイトル", "<title>リズム編集</title>" in text, True)
    code, body = http("GET", "/api/status")
    check("状態", (code, json.loads(body)["status"]), (200, "テスト"))
    code, body = http("POST", "/api/save", json.dumps(drum).encode("utf-8"))
    check("正しい内容は受けて、ESP32 に送る", (code, json.loads(body)["ok"], len(sent)), (200, True, 1))
    check("送ったコマンド", sent[0][0], "DRUM CLEAR 11")
    code, body = http("POST", "/api/save", json.dumps(dict(drum, length=12)).encode("utf-8"))
    d = json.loads(body)
    check("間違った内容は断る(400)と、理由", (code, d["ok"], "長さ" in d["error"], len(sent)), (400, False, True, 1))
    code, _ = http("POST", "/api/save", json.dumps(drum).encode("utf-8"), ctype="text/plain")
    check("JSON でない送り方は断る(415)", (code, len(sent)), (415, 1))
    code, _ = http("POST", "/api/save", json.dumps(drum).encode("utf-8"), host="evil.example.com")
    check("ホスト名が違うものは断る(403)", (code, len(sent)), (403, 1))
    code, _ = http("GET", "/", host="evil.example.com:80")
    check("ホスト名が違う GET も断る(403)", code, 403)
    code, _ = http("POST", "/api/save", b"{not json")
    check("壊れた JSON は断る(400)", (code, len(sent)), (400, 1))
    code, _ = http("POST", "/api/save", b"x" * 30000)
    check("大きすぎる内容は断る(400)", (code, len(sent)), (400, 1))
    code, body = http("GET", "/api/state")
    check("状態を返す", (code, json.loads(body)["s"]["bpm"]), (200, 99))
    code, body = http("POST", "/api/control", json.dumps({"action": "bpm", "value": 130}).encode("utf-8"))
    check("操作を受けて、すぐ送る（保存用の送り方ではない）", (code, ctl, len(sent)), (200, [["BPM 130"]], 1))
    code, body = http("POST", "/api/control", json.dumps({"action": "bpm", "value": 999}).encode("utf-8"))
    check("使えない操作は断る(400)", (code, len(ctl)), (400, 1))
    code, _ = http("POST", "/api/control", json.dumps({"action": "bpm", "value": 130}).encode("utf-8"), ctype="text/plain")
    check("操作も JSON 以外は断る(415)", (code, len(ctl)), (415, 1))
    code, _ = http("POST", "/api/control", json.dumps({"action": "bpm", "value": 130}).encode("utf-8"), host="evil.example.com")
    check("操作もホスト名が違えば断る(403)", (code, len(ctl)), (403, 1))
    code, body = http("POST", "/api/live", json.dumps({"kind": "drum", "slot": 12, "length": 8, "lanes": {"K": "x...x..."}}).encode("utf-8"))
    check("ライブ編集を受けて送る（保存用の送り方 = sent は増えない）", (code, len(sent), liv), (200, 1, [["DRUM SET 12 K x...x..."]]))
    code, _ = http("POST", "/api/live", json.dumps({"kind": "drum", "slot": 12, "length": 8, "lanes": {}}).encode("utf-8"))
    check("変えるところがなければ断る(400)", code, 400)
    code, _ = http("POST", "/api/live", json.dumps({"kind": "drum", "slot": 12, "length": 8, "lanes": {"K": "x...x..."}}).encode("utf-8"), ctype="text/plain")
    check("ライブも JSON 以外は断る(415)", code, 415)
    code, body = http("POST", "/api/refresh", b"{}")
    check("一覧の読み直し", (code, len(refreshed)), (200, 1))
    code, _ = http("POST", "/api/other", b"{}")
    check("知らない道は 404", code, 404)
    code, _ = http("GET", "/etc/passwd")
    check("ほかのファイルは出さない(404)", code, 404)

    # ---- ステップの合図を、画面に即時に流す（Server-Sent Events）----
    conn = httpc.HTTPConnection("127.0.0.1", port, timeout=3)
    conn.request("GET", "/api/events")
    resp = conn.getresponse()
    check("/api/events: 200 と text/event-stream", (resp.status, (resp.getheader("Content-Type") or "").startswith("text/event-stream")), (200, True))
    check("/api/events: つないだ合図", resp.readline(), b": connected\n")
    resp.readline()
    t0 = time.time()
    hub.publish({"type": "step", "step": 2, "playing": 1, "seq": 7, "sid": 1})
    line = resp.readline()
    latency = time.time() - t0
    check("/api/events: 出来事が data: の行で届く", json.loads(line[len(b"data: "):].decode("utf-8")), {"type": "step", "step": 2, "playing": 1, "seq": 7, "sid": 1})
    check("/api/events: 届くまで 50ms 未満（%.1f ms）" % (latency * 1000), latency < 0.05, True)
    resp.readline()
    conn2 = httpc.HTTPConnection("127.0.0.1", port, timeout=3)
    conn2.request("GET", "/api/events")
    resp2 = conn2.getresponse()
    resp2.readline(); resp2.readline()
    check("/api/events: あとから開いた画面には、直前の出来事がすぐ届く", json.loads(resp2.readline()[len(b"data: "):].decode("utf-8"))["seq"], 7)
    resp2.readline()  # 空行
    hub.publish({"type": "step", "step": 3, "playing": 1, "seq": 8, "sid": 1})
    resp.readline()  # data
    resp.readline()  # 空行
    check("/api/events: 2つの画面に、同じ出来事が配られる", json.loads(resp2.readline()[len(b"data: "):].decode("utf-8"))["step"], 3)
    code, _ = http("GET", "/api/events", host="evil.example.com")
    check("/api/events: ホスト名が違えば断る(403)", code, 403)
    # ---- /api/library: 名前をつけたドラム・バッキング・固有進行を、ゲームに渡す ----
    qlib = hub.subscribe()
    while not qlib.empty():
        qlib.get_nowait()
    code, body = http("GET", "/api/library")
    check("/api/library: 空から始まる", (code, json.loads(body)["library"]["progressions"], json.loads(body)["library"]["seq"]), (200, [], 0))
    code, body = http("POST", "/api/library", json.dumps({"op": "put", "kind": "progression", "item": {"name": "ぼくの進行", "chords": ["Ⅳ", "Ⅴ", "Ⅲm", "Ⅵm"]}}).encode("utf-8"))
    item = json.loads(body)["item"]
    check("/api/library put: 保存して、id と順番号を返す", (code, item["id"], json.loads(body)["seq"], item["points"]), (200, "p1", 1, 600))
    ev_lib = qlib.get(timeout=2)
    check("/api/library put: ゲームに、すぐ知らせる（SSE の library）", (ev_lib["type"], ev_lib["seq"]), ("library", 1))
    code, body = http("GET", "/api/library")
    check("/api/library: 保存した内容が読める", [x["name"] for x in json.loads(body)["library"]["progressions"]], ["ぼくの進行"])
    code, body = http("POST", "/api/library", json.dumps({"op": "put", "kind": "backing", "item": {"name": "チョップ", "length": 8, "cells": "C.C.C.C."}}).encode("utf-8"))
    check("/api/library put: バッキング", (code, json.loads(body)["item"]["id"]), (200, "b2"))
    code, body = http("POST", "/api/library", json.dumps({"op": "put", "kind": "drum", "item": {"name": "x", "length": 16, "lanes": {"K": "xx"}}}).encode("utf-8"))
    check("/api/library put: 正しくない内容は 400（保存しない・知らせない）", (code, json.loads(body)["ok"], hub.subscribe().qsize() if False else True), (400, False, True))
    code, body = http("POST", "/api/library", json.dumps({"op": "delete", "kind": "progression", "id": "p1"}).encode("utf-8"))
    check("/api/library delete: 削除", (code, json.loads(http("GET", "/api/library")[1])["library"]["progressions"]), (200, []))
    code, body = http("POST", "/api/library", json.dumps({"op": "delete", "kind": "progression", "id": "p99"}).encode("utf-8"))
    check("/api/library delete: 無い id は 400", code, 400)
    code, body = http("POST", "/api/library", json.dumps({"op": "wipe"}).encode("utf-8"))
    check("/api/library: 知らない操作は 400", code, 400)
    code, body = http("POST", "/api/library", json.dumps({"op": "put", "kind": "backing", "item": {"name": "a", "length": 8, "cells": "C......."}}).encode("utf-8"), ctype="text/plain")
    check("/api/library: JSON でない送り方は 415（ほかのサイトから、勝手に書き込めない）", code, 415)
    code, body = http("POST", "/api/library", json.dumps({"op": "put", "kind": "backing", "item": {"name": "a", "length": 8, "cells": "C......."}}).encode("utf-8"), host="evil.example.com")
    check("/api/library: ホスト名が違えば 403", code, 403)
    code, _ = http("GET", "/api/library", host="evil.example.com")
    check("/api/library 読み取りも、ホスト名が違えば 403", code, 403)

    # ---- /api/bridge: 「ESP32 に接続する」ボタン ----
    code, body = http("POST", "/api/bridge", json.dumps({"action": "connect"}).encode("utf-8"))
    check("/api/bridge connect: 受け付けて、ブリッジの関数を呼ぶ", (code, json.loads(body)["ok"], bridged), (200, True, ["connect"]))
    code, body = http("POST", "/api/bridge", json.dumps({"action": "release"}).encode("utf-8"))
    check("/api/bridge release: 受け付けて、ブリッジの関数を呼ぶ", (code, bridged), (200, ["connect", "release"]))
    check("/api/bridge: 知らない操作は断る", http("POST", "/api/bridge", json.dumps({"action": "kill"}).encode("utf-8"))[0], 400)
    check("/api/bridge: JSON でなければ断る", http("POST", "/api/bridge", b'{"action":"connect"}', ctype="text/plain")[0], 415)
    check("/api/bridge: ホスト名が違えば断る", http("POST", "/api/bridge", json.dumps({"action": "connect"}).encode("utf-8"), host="evil.example.com")[0], 403)
    check("/api/bridge: 断ったものは、ブリッジの関数を呼ばない", bridged, ["connect", "release"])
    # ---- /game/: 常駐ブリッジの URL だけで、ゲームも開ける（読み取り専用。game/ の外へ出る道は通さない）----
    code, body = http("GET", "/game/")
    check("/game/ でゲームのページが開く", (code, b"CHORD" in body and b"app.js" in body), (200, True))
    c4 = httpc.HTTPConnection("127.0.0.1", port, timeout=5); c4.request("GET", "/game"); r4 = c4.getresponse(); r4.read()
    check("/game（末尾なし）は /game/ へ移る", (r4.status, r4.getheader("Location")), (301, "/game/")); c4.close()
    req = urllib.request.Request(base + "/game/js/app.js")
    with urllib.request.urlopen(req, timeout=5) as r:
        check("ゲームの .js は、JavaScript として配られる（ES モジュール用）", (r.status, r.headers.get("Content-Type", "").split(";")[0]), (200, "text/javascript"))
    code, body = http("GET", "/game/data/chords.json")
    check("ゲームの駒の表（json）が届く", (code, len(json.loads(body)["chords"]) > 20), (200, True))
    check("game/ の外は読めない（../）", http("GET", "/game/../rhythm_server.py")[0], 404)
    check("game/ の外は読めない（%2e%2e）", http("GET", "/game/%2e%2e/rhythm_server.py")[0], 404)
    check("ない部品は 404", http("GET", "/game/js/nothing.js")[0], 404)
    check("/game/ もホスト名を確かめる", http("GET", "/game/", host="evil.example.com")[0], 403)
    hub.close()
    rest = resp.read()
    check("/api/events: サーバーが終わるとき、つなぎが閉じる（待ち続けない。それまでに流れた library の知らせ以外は、何も来ない）",
          [ln for ln in rest.decode("utf-8").split("\n") if ln.strip() and '"type": "library"' not in ln], [])
    conn.close(); conn2.close()
    plain = rs.start_in_thread(0, lambda l: None)
    try:
        conn3 = httpc.HTTPConnection("127.0.0.1", plain.server_address[1], timeout=3)
        conn3.request("GET", "/api/events")
        check("配り役なしのサーバーでは /api/events は 404", conn3.getresponse().status, 404)
        conn3.close()
    finally:
        plain.shutdown()
finally:
    server.shutdown()

# ---- 4. 全プリセットを、編集画面から送ったコマンドにして書き出す ----
out_path = sys.argv[1] if len(sys.argv) > 1 else None
lines_out = []
for p in saved["drums"]:
    req = {"kind": "drum", "slot": 11, "name": p["name"], "length": p["length"], "lanes": p["lanes"], "select": False}
    lines_out.append("#PRESET drum %d" % p["id"])
    lines_out += rs.build_commands(req)
for p in saved["backings"]:
    req = {"kind": "backing", "slot": 11, "name": p["name"], "length": p["length"], "cells": p["cells"], "select": False}
    lines_out.append("#PRESET backing %d" % p["id"])
    lines_out += rs.build_commands(req)
check("全プリセットがコマンドに変換できた", len([l for l in lines_out if l.startswith("#PRESET")]), 16)
if out_path:
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out) + "\n")

print("test_rhythm_ui: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
