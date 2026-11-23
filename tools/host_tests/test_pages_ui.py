#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公開ページ（GitHub Pages = https。ブリッジなし）の動きを、本物の Chrome で確かめる（2026-11-23）。
  ・自分で作った証明書の https で、ゲームを配る（--ignore-certificate-errors）。本物の Pages ではない。本物の確認は、公開後に、別に行う
  ・ブリッジなし（/api/ への問い合わせが 0 件）・実機のボタンが隠れる
  ・リズム・コード編集の内容の取り込み: リンク（#lib=）で開く → 確認 → 取り込み → 音のメニュー・図鑑に増える → 読み直しても残る → 削除
  ・貼り付け・ファイル・不正な内容（ことわる）・同じ名前は上書き
実行:  python3 tools/host_tests/test_pages_ui.py
Chrome か openssl がなければ、省略する（終了コード 0）。
"""
import base64
import functools
import http.server
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def b64url(s):
    return base64.urlsafe_b64encode(s.encode("utf-8")).decode().rstrip("=")


PAYLOAD = {
    "app": "chord-lines-library", "v": 1,
    "drums": [{"name": "夕焼けビート", "length": 16, "lanes": {"K": "x...x...x...x...", "S": "....x.......x...", "H": "x.x.x.x.x.x.x.x."}}],
    "backings": [{"name": "ゆったり", "length": 16, "cells": "C---....C---...."}],
    "progressions": [{"name": "テスト進行", "chords": ["Ⅰ", "Ⅴ", "Ⅵm"], "points": 500, "startAt": "head"}],
}


def main():
    if not chrome_available() or not shutil.which("openssl"):
        print("（公開ページのテストは、Chrome か openssl が見つからないので省略）")
        return 0
    tmp = tempfile.mkdtemp()
    cert, key = os.path.join(tmp, "c.pem"), os.path.join(tmp, "k.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], check=True, capture_output=True)
    log = []

    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):
            log.append("%s %s" % (self.command, self.path))

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=os.path.join(ROOT, "game")))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "https://localhost:%d/index.html" % port
    code = "j1." + b64url(json.dumps(PAYLOAD, ensure_ascii=False))
    try:
        with ChromeSession(width=1280, height=720, extra_args=["--ignore-certificate-errors"]) as ch:
            # ---- リンクで開く ----
            ch.open(base + "#lib=" + code)
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
            check("https: ブリッジなしと判定・実機のボタンが隠れる", ch.eval("[__app.device.offline, getComputedStyle(document.querySelector('#btn-device')).display, getComputedStyle(document.querySelector('#btn-import')).display !== 'none']"), [True, "none", True])
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=60)
            time.sleep(0.5)
            check("リンクで開く: 取り込みの画面が、自動で開く（URL の # は消える）", ch.eval("[!document.querySelector('#libimport').classList.contains('hidden'), location.hash]"), [True, ""])
            check("リンクの内容の確認が出る（ドラム 1・バッキング 1・進行 1）", ch.eval("document.querySelector('#li-msg').textContent"), "この内容を取り込みます: ドラム 1・バッキング 1・進行 1")
            check("取り込む前は、ゲームに入っていない", ch.eval("JSON.stringify([__app.presets.drums.filter(d => d.user).length, __app.save.library.drums.length])"), "[0,0]")
            ch.eval("document.querySelector('#li-apply').click()")
            time.sleep(0.4)
            check("取り込む: 3つ増えた・一覧に出る", ch.eval("JSON.stringify([document.querySelectorAll('.li-item').length, /3つ ふやしました/.test(document.querySelector('#li-msg').textContent)])"), "[3,true]")
            check("ゲームに増える: ドラム・バッキング（番号 1000 以上）", ch.eval("JSON.stringify([__app.presets.drums.filter(d => d.user).map(d => [d.name, d.id >= 1000]), __app.presets.backings.filter(d => d.user).map(d => [d.name, d.id >= 1000])])"), '[[["夕焼けビート",true]],[["ゆったり",true]]]')
            check("ゲームに増える: 進行は、図鑑に新しい技（custom）", ch.eval("JSON.stringify(__app.game.collection().filter(c => /custom/.test(c.kind)).map(c => c.name))"), '["テスト進行"]')
            check("取り込んだ内容は、ブラウザに保存される（localStorage）", ch.eval("JSON.parse(localStorage.getItem('chordlines.v1')).library.drums[0].name"), "夕焼けビート")
            ch.eval("document.querySelector('#li-close').click()")
            time.sleep(0.2)
            check("閉じる: 画面が閉じる・タイトルのまま", ch.eval("[document.querySelector('#libimport').classList.contains('hidden'), __app.state]"), [True, "title"])

            # ---- 読み直しても残る・音のメニューで選べる ----
            ch.open(base)
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=60)
            check("読み直しても、取り込んだものが残る（ゲームに入っている）", ch.eval("JSON.stringify([__app.presets.drums.filter(d => d.user).length, __app.presets.backings.filter(d => d.user).length, __app.game.collection().filter(c => /custom/.test(c.kind)).length])"), "[1,1,1]")
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.6)
            ch.eval("document.querySelector('#btn-soundmenu').click()")
            time.sleep(0.3)
            check("音のメニュー（公開ページ）: 「取り込む」のボタンがある", ch.eval("!!document.querySelector('#sm-import')"), True)
            ch.eval("document.querySelector('#sm-import').click()")
            time.sleep(0.4)
            check("音のメニューの「取り込む」: 取り込みの画面が開く（状態 libimport）", ch.eval("[__app.state, !document.querySelector('#libimport').classList.contains('hidden')]"), ["libimport", True])

            # ---- 貼り付け: 同じ名前は上書き・不正な内容は、ことわる ----
            ch.eval("(() => { const t = document.querySelector('#li-text'); t.value = %s; t.dispatchEvent(new Event('input')); return true })()" % json.dumps(json.dumps(PAYLOAD, ensure_ascii=False)))
            time.sleep(0.2)
            ch.eval("document.querySelector('#li-apply').click()")
            time.sleep(0.3)
            check("貼り付け（JSON）: 同じ名前は、上書き（増えない）", ch.eval("JSON.stringify([/3つ 上書きしました/.test(document.querySelector('#li-msg').textContent), document.querySelectorAll('.li-item').length])"), "[true,3]")
            ch.eval("(() => { const t = document.querySelector('#li-text'); t.value = 'j1.@@@'; t.dispatchEvent(new Event('input')); return true })()")
            time.sleep(0.2)
            check("こわれたコード: ことわる（「取り込む」は押せない）", ch.eval("[document.querySelector('#li-msg').className.includes('err'), document.querySelector('#li-apply').disabled]"), [True, True])
            bad = {"app": "chord-lines-library", "v": 1, "drums": [{"name": "x", "length": 16, "lanes": {"K": "x..."}}], "backings": [{"name": "y", "length": 16, "cells": "-..............."}], "progressions": [{"name": "z", "chords": ["Ⅰ"]}]}
            ch.eval("(() => { const t = document.querySelector('#li-text'); t.value = %s; t.dispatchEvent(new Event('input')); return true })()" % json.dumps(json.dumps(bad, ensure_ascii=False)))
            time.sleep(0.2)
            check("不正な内容（長さ違い・「-」の位置・駒が1つ）: 取り込める内容が、ない", ch.eval("[/ドラム 0・バッキング 0・進行 0（読み込めないもの 3）/.test(document.querySelector('#li-msg').textContent), document.querySelector('#li-apply').disabled]"), [True, True])
            ch.eval("(() => { const t = document.querySelector('#li-text'); t.value = '{\"app\":\"other\"}'; t.dispatchEvent(new Event('input')); return true })()")
            time.sleep(0.2)
            check("別の JSON: ことわる", ch.eval("document.querySelector('#li-msg').textContent"), "リズム・コード編集の画面で作った内容ではありません")

            # ---- 削除 ----
            ch.eval("document.querySelector('.li-item[data-kind=\"drum\"] .li-del').click()")
            time.sleep(0.3)
            check("削除: 一覧からもゲームからも、なくなる", ch.eval("JSON.stringify([document.querySelectorAll('.li-item').length, __app.presets.drums.filter(d => d.user).length, __app.save.library.drums.length])"), "[2,0,0]")
            ch.eval("document.querySelector('#li-close').click()")
            time.sleep(0.2)
            check("音のメニューから開いて閉じる: 遊ぶ画面（play）にもどる", ch.eval("__app.state"), "play")
            api = [l for l in log if "/api/" in l]
            check("/api/ への問い合わせが 0 件（ブリッジなし）", api, [])
            check("JS のエラーがない", ch.eval("JSON.stringify(window.__errors)"), "[]")
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print("公開ページの確認: %d 件中 %d 件 失敗" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
