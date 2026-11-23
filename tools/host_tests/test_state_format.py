#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ファームの STATE の出力（偽のボードで動かした本物の commands.cpp が出したもの）を、ブリッジの読み取り（rhythm_server）で読めるか。
  ファーム側(C++)と、ブリッジ側(Python)の、行の形式がずれていないかの確認。
実行:  python3 tools/host_tests/test_state_format.py <test_firmware_sim が書き出したファイル>
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE)))
import rhythm_server as rs  # noqa: E402

fails = 0
checks = 0


def check(name, ok):
    global fails, checks
    checks += 1
    if not ok:
        fails += 1
        print("FAIL", name)


lines = [l.rstrip("\n") for l in open(sys.argv[1], encoding="utf-8")]
states = [rs.parse_state_line(l) for l in lines if l.startswith("~S ")]
patterns = [rs.parse_pattern_line(l) for l in lines if l.startswith("~P ")]
check("STATE の行が読める（%d 行）" % len(states), len(states) >= 6 and all(s is not None for s in states))
check("パターンの行が読める（%d 行）" % len(patterns), len(patterns) >= 5 and all(p is not None for p in patterns))
first = states[0]
check("最初の STATE: 停止中・BPM 120・Key C", (first["playing"], first["bpm"], first["key"], first["step"]) == (0, 120, "C", -1))
check("STATE に高さ（octave）", all("octave" in s for s in states) and states[0]["octave"] == 0)
check("コードが4つ", len(first["chords"]) == 4 and first["chords"][0] == {"name": "Ⅰ", "symbol": "C"})
check("再生中の STATE（step=1）", any(s["playing"] == 1 and s["step"] == 1 for s in states))
check("変更後の STATE（BPM100・Key D・ドラム2・バッキング6・LEAD OFF・3音）",
      any((s["bpm"], s["key"], s["drum"], s["backing"], s["lead"], s["voicing"]) == (100, "D", 2, 6, 0, 3) for s in states))
check("空と→", any([c["name"] for c in s["chords"]] == ["Ⅰ", "-", "→", "Ⅴ"] for s in states))
d2 = [p for p in patterns if p["kind"] == "drum" and p["id"] == 2][0]
check("ドラム2のレーン", d2["lanes"] == {"K": "x.......x.x.....", "S": "....x.......x...", "H": "x.x.x.x.x.x.x.x."} and d2["name"] == "8ビート")
check("空きスロット", any(p["kind"] == "drum" and p["id"] == 11 and not p["exists"] for p in patterns))
check("バッキング6", any(p["kind"] == "backing" and p["id"] == 6 and p["cells"] == "1-2-3-4-1-2-3-4-" for p in patterns))
check("名前に空白", any(p.get("name") == "マイ ビート" for p in patterns))
steps = [rs.parse_step_line(l) for l in lines if l.startswith("~T ")]
check("ステップの合図（~T）が読める（%d 行）" % len(steps), len(steps) >= 4 and all(s is not None for s in steps))
check("ステップの合図: 0,1,2 の順に始まり、最後が停止(-1)", steps[:3] == [0, 1, 2] and steps[-1] == -1)
print("test_state_format: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
