#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ゲーム（game/）の部品のテストを、本物のブラウザ（ヘッドレスの Chrome）で動かす。
  ・game/test/*.test.js を、game/test/index.html?suite=名前 で読み込んで実行する（Node は使わない）
  ・ファームの和音の高さの計算（C++）を書き出して、ゲーム側（JS）の計算と、すべての組み合わせで照合する
  ・結果は、ページの <pre id="__result"> に JSON で書かれる。それを読んで、結果を表示する
実行:  python3 tools/host_tests/test_game_js.py [スイート名 ...]       例: logic
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
ROOT = os.path.dirname(os.path.dirname(HERE))
GAME = os.path.join(ROOT, "game")
SUITES = ["logic", "audio", "game"]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def build_generated():
    """ ファームの計算を書き出す（テストの間だけ置く） """
    out = os.path.join(GAME, "test", "_generated")
    os.makedirs(out, exist_ok=True)
    tmp = tempfile.mkdtemp()
    try:
        exe = os.path.join(tmp, "dump_voicing")
        subprocess.run(["g++", "-std=gnu++11", "-I" + os.path.join(ROOT, "src"), os.path.join(ROOT, "tools", "host_tests", "dump_voicing.cpp"),
                        os.path.join(ROOT, "src", "voicing.cpp"), os.path.join(ROOT, "src", "chords.cpp"), "-o", exe], check=True)
        with open(os.path.join(out, "voicing.txt"), "w", encoding="utf-8") as f:
            f.write(subprocess.run([exe], check=True, capture_output=True, text=True).stdout)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def check_data_in_sync():
    """ game/data/ の chords.json・presets.json が、ファームの表から作り直したものと同じか """
    tmp = tempfile.mkdtemp()
    bad = []
    try:
        for dumper, extra, target in (("dump_chords.cpp", ["chords.cpp"], "chords.json"), ("dump_presets.cpp", ["rhythm.cpp"], "presets.json")):
            exe = os.path.join(tmp, dumper)
            subprocess.run(["g++", "-std=gnu++11", "-I" + os.path.join(ROOT, "src"), os.path.join(ROOT, "tools", "host_tests", dumper)] +
                           [os.path.join(ROOT, "src", e) for e in extra] + ["-o", exe], check=True)
            fresh = subprocess.run([exe], check=True, capture_output=True, text=True).stdout
            with open(os.path.join(GAME, "data", target), encoding="utf-8") as f:
                if f.read() != fresh:
                    bad.append(target)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for t in bad:
        print("FAIL game/data/%s が、ファームの表と違います（sh tools/game_lab/gen_game_data.sh で作り直してください）" % t)
    print("test_game_data: checks=2 fails=%d" % len(bad))
    return len(bad)


def run_suite(port, name, timeout=240):
    """ ページを実際の時間で動かし、結果（<pre id="__result">）が出るまで待つ """
    try:
        with ChromeSession(width=1000, height=700) as ch:
            ch.open("http://127.0.0.1:%d/test/index.html?suite=%s" % (port, name))
            ch.wait_for("!!document.getElementById('__result')", timeout=timeout, interval=0.25)
            return json.loads(ch.eval("document.getElementById('__result').textContent"))
    except Exception as e:  # noqa: BLE001
        return {"suite": name, "checks": 0, "fails": 1, "failures": ["結果が出ませんでした: %s" % e], "logs": []}


def main():
    if not chrome_available():
        print("（ゲームの部品のテストは、Chrome が見つからないので省略）")
        return 0
    names = sys.argv[1:] or SUITES
    data_bad = check_data_in_sync()
    gen = build_generated()
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=GAME))
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    bad = 0
    try:
        for name in names:
            if not os.path.exists(os.path.join(GAME, "test", name + ".test.js")):
                continue
            r = run_suite(port, name)
            for line in r.get("logs", []):
                print("   " + line)
            for f in r.get("failures", []):
                print("FAIL " + f)
            print("test_game_%s: checks=%d fails=%d" % (name, r["checks"], r["fails"]))
            bad += 1 if r["fails"] else 0
    finally:
        server.shutdown()
        shutil.rmtree(gen, ignore_errors=True)
    return 1 if (bad or data_bad) else 0


if __name__ == "__main__":
    sys.exit(main())
