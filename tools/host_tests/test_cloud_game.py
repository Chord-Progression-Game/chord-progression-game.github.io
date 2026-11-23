#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公開ページのゲームが、公開ライブラリ（Firebase Realtime Database。ここでは、にせもの）から、リアルタイムで受け取る道（game/js/net/cloud.js）のテスト（2026-11-24）。
  ・本物のブリッジ（rhythm_server の Library + CloudSync）→ にせもの Firebase → 本物の Chrome のゲーム（?cloud=… で、にせものへ向ける）の、通し
  ・編集の画面で、ドラムを追加（Library.put）→ ゲームの音のメニュー・図鑑に、すぐ届く / 削除 → 消える / 何も操作しないのに、リアルタイムで増える
  ・ゲームの検査: 形が違う内容・危険な名前・長すぎる名前・知らない駒の進行は、使わない（取り込みと同じ厳しさ）
  ・つなぎっぱなし（EventSource）が切れても、ポーリング（読み直し）で追いつく
  ・前に届いた内容は、保存してあって、つながらなくても使える
  ・取り込みの画面に、公開ライブラリの状態（つながっています）と、届いたものが出る
  ・ほかの設定: game/cloud.json の url の検査（https の firebaseio.com / firebasedatabase.app だけ）
実行:  python3 tools/host_tests/test_cloud_game.py
Chrome がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve  # noqa: E402
import cloud_sync  # noqa: E402
import rhythm_server as rs  # noqa: E402
from mock_firebase import MockFirebase  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def wait_js(ch, expr, timeout=8.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if ch.eval(expr):
            return True
        time.sleep(0.1)
    return False


DRUM = {"name": "公開ビート", "length": 16, "lanes": {"K": "x...x...x...x...", "S": "....x.......x...", "H": "x.x.x.x.x.x.x.x."}}
BACK = {"name": "公開バッキング", "length": 16, "cells": "C---....C---...."}
PROG = {"name": "公開進行", "chords": ["ⅣM7", "Ⅴ7", "Ⅲm7", "Ⅵm7"], "points": 400, "startAt": "head"}


def main():
    if not chrome_available():
        print("（公開ライブラリのテストは、Chrome が見つからないので省略）")
        return 0
    mock = MockFirebase(secret="GAMESECRET")
    tmp = tempfile.mkdtemp()
    lib = rs.Library(os.path.join(tmp, "library.json"))
    sync = cloud_sync.CloudSync(lib, config_path=os.path.join(tmp, "cloud.json"), allow_local=True)
    lib.listeners.append(sync.notify)
    srv, port = serve()
    try:
        lib.put("drum", DRUM)
        sync.configure(mock.url, "GAMESECRET")
        with ChromeSession(width=1100, height=800) as ch:
            ch.open("http://127.0.0.1:%d/index.html?cloud=%s" % (port, mock.url))
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=60)
            check("公開ライブラリ: ?cloud=… で、つながる（つなぎっぱなし = live）", wait_js(ch, "__app.cloud.state === 'live'"), True)
            check("つなぐ前に送ってあったドラム「公開ビート」が、ゲームのビートの一覧に入る（パターン番号は 6001: 5000 + 1 + 1000）", wait_js(ch, "__app.presets.drums.some((d) => d.name === '公開ビート' && d.id === 6001 && d.user)"), True)
            # ---- リアルタイム: 編集の画面で、追加 ----
            n0 = ch.eval("__app.cloud.received")
            t0 = time.time()
            lib.put("backing", BACK)
            ok = wait_js(ch, "__app.presets.backings.some((b) => b.name === '公開バッキング')", 6)
            check("リアルタイム: 編集の画面で、バッキングを追加 → ゲームに、届く", ok, True)
            print("   （追加から、ゲームに届くまで: %.2f 秒）" % (time.time() - t0))
            check("リアルタイム: 受け取った回数がふえた・ゲームは、リロードしていない", ch.eval("__app.cloud.received") > n0, True)
            lib.put("progression", PROG)
            check("リアルタイム: 進行を追加 → 図鑑に、新しい技（custom_p…）が増える", wait_js(ch, "document.querySelectorAll('#collection-title .col-dot, #collection .col-dot').length === 27 || __app.game.collection().length === 27"), True)
            lib.put("drum", {**DRUM, "name": "公開ビート", "lanes": {"K": "x.......x.......", "S": "....x.......x..."}})
            check("リアルタイム: 同じ名前で置き換え → ゲームのビートの中身が変わる（H のレーンが消える）", wait_js(ch, "(() => { const d = __app.presets.drums.find((x) => x.name === '公開ビート'); return !!d && !d.lanes.H; })()"), True)
            # ---- 削除 ----
            did = [x for x in lib.snapshot()["backings"] if x["name"] == "公開バッキング"][0]["id"]
            lib.delete("backing", did)
            check("リアルタイム: 編集の画面で削除 → ゲームから、消える", wait_js(ch, "!__app.presets.backings.some((b) => b.name === '公開バッキング')"), True)
            # ---- 取り込みの画面 ----
            ch.eval("document.body.classList.add('web-only')"); time.sleep(0.1)
            ch.eval("document.querySelector('#btn-import').click()"); time.sleep(0.5)
            check("取り込みの画面: 公開ライブラリの状態（つながっています）と、届いたもの（ドラム・進行）が出る", ch.eval("JSON.stringify([document.querySelector('#li-cloud-state').textContent.includes('つながっています'), [...document.querySelectorAll('#li-cloud .li-item')].map((e) => e.textContent)])"), json.dumps([True, ["ドラム公開ビート", "進行公開進行"]], ensure_ascii=False).replace(" ", ""))
            check("取り込みの画面: 公開ライブラリのものには、削除のボタンが、ない（読むだけ）", ch.eval("document.querySelectorAll('#li-cloud .li-del').length"), 0)
            ch.eval("document.querySelector('#li-close').click()"); time.sleep(0.2)
            # ---- 検査: 危険・おかしな内容は、使わない ----
            mock.set_value("chordlines/library", {"app": "chord-lines-library", "v": 1, "seq": 99, "at": 1,
                "drums": [{"id": "d1", "name": "ふつう", "length": 16, "lanes": {"K": "x...............", "S": "....x..........."}},
                          {"id": "d2", "name": "<img src=x onerror=alert(1)>" * 3, "length": 16, "lanes": {"K": "x..............."}},
                          {"id": "d3", "name": "長さがおかしい", "length": 15, "lanes": {"K": "x.............."}},
                          {"id": "d4", "name": "文字がおかしい", "length": 16, "lanes": {"K": "x...zzzz........"}}],
                "backings": [{"id": "b1", "name": "ふつうの", "length": 16, "cells": "C---....C---...."}, {"id": "b2", "name": "のばすが先頭", "length": 8, "cells": "-C------"}],
                "progressions": [{"id": "p1", "name": "知らない駒", "chords": ["Ⅰ", "ナイショ"], "points": 300}, {"id": "p2", "name": "点が大きすぎる", "chords": ["Ⅰ", "Ⅴ"], "points": 999999}, {"id": "p3", "name": "ふつうの進行", "chords": ["Ⅰ", "Ⅳ", "Ⅴ"], "points": 300}]})
            check("検査: 受け取った内容のうち、正しいものだけ使う（ドラム 1・バッキング 1・進行 1）。ほかは、とばす", wait_js(ch, "__app.cloud.lib.drums.length === 1 && __app.cloud.lib.backings.length === 1 && __app.cloud.lib.progressions.length === 1"), True)
            check("検査: とばした数が、わかる・名前は、そのまま（HTML として、解釈されない）", ch.eval("JSON.stringify([__app.cloud.lib.skipped, __app.cloud.lib.drums[0].name, __app.cloud.lib.progressions[0].name])"), json.dumps([6, "ふつう", "ふつうの進行"], ensure_ascii=False).replace(" ", ""))
            mock.set_value("chordlines/library", {"app": "ほかのアプリ", "v": 1, "drums": []})
            time.sleep(0.8)
            check("検査: アプリの名前が違う内容は、まるごと、使わない（いまの内容のまま）", ch.eval("__app.cloud.lib.drums.length"), 1)
            mock.set_value("chordlines/library", None)
            check("データベースが空（null）になると、公開ライブラリも、空になる", wait_js(ch, "__app.cloud.count() === 0"), True)
            # ---- 保存（前に届いたものは、つながらなくても使える）----
            lib.put("drum", {**DRUM, "name": "保存されるビート"})
            sync.push_now()
            check("保存: 届いた内容が、localStorage に、保存される", wait_js(ch, "!!(JSON.parse(localStorage.getItem('chordlines.v1')).cloudRaw)"), True)
            ch.open("http://127.0.0.1:%d/index.html" % port)               # ?cloud= なし: つながらない状態で、開き直す
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=60)
            time.sleep(0.5)
            check("保存: つながらない状態で開き直すと、前に届いたもの（保存されるビート）を、覚えている（localStorage から）", ch.eval("[__app.cloud.enabled, __app.cloud.count() > 0, __app.cloud.lib.drums.some((d) => d.name === '保存されるビート')]"), [False, True, True])
            ch.eval("__app.library.forceLocal = true; __app.library.reloadLocal()")          # 公開ページ（https。ブリッジなし）と同じ状態にする（このテストのページは、http なので、ブリッジの場所として動く）
            time.sleep(0.3)
            check("保存: 公開ページでは、そのまま、ゲームのビートの一覧に入る", ch.eval("__app.presets.drums.some((d) => d.name === '保存されるビート')"), True)
            check("JS のエラーがない", ch.eval("JSON.stringify(window.__errors)"), "[]")

        # ---- つなぎっぱなしが使えないとき: ポーリングで追いつく ----
        with ChromeSession(width=1100, height=800) as ch:
            ch.open("http://127.0.0.1:%d/index.html?cloud=%s" % (port, mock.url))
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
            ch.eval("window.EventSource = undefined")            # （このページでは、つなぎっぱなしを使えない、という状態にする。読み込み前に消せないので、いったん止めて、作りなおす）
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=60)
            ch.eval("__app.cloud.stop(); __app.cloud.ES = null; __app.cloud.pollMs = 400; __app.cloud.start({ url: %s, path: 'chordlines/library' })" % json.dumps(mock.url))
            check("ポーリング: つなぎっぱなしが使えなくても、読み込んで、polling になる", wait_js(ch, "__app.cloud.state === 'polling'"), True)
            lib.put("drum", {**DRUM, "name": "ポーリングで届く"})
            sync.push_now()
            check("ポーリング: 数秒ごとの読み直しで、追いつく（編集の画面の変更が、届く）", wait_js(ch, "__app.presets.drums.some((d) => d.name === 'ポーリングで届く')", 8), True)
    finally:
        srv.shutdown()
        sync.stop()
        mock.stop()

    # ---- game/cloud.json の url の検査（ブラウザなしで、node の代わりに、Chrome の中で）----
    if True:
        srv2, port2 = serve()
        try:
            with ChromeSession(width=600, height=400) as ch:
                ch.open("http://127.0.0.1:%d/data/chords.json" % port2)
                ch.wait_for("document.readyState === 'complete'", timeout=20)
                res = ch.eval("""(async () => {
                  const C = await import('/js/net/cloud.js');
                  const t = (o, opt) => { const r = C.parseCloudConfig(o, opt); return r ? r.url + '|' + r.path : null; };
                  return JSON.stringify([
                    t({ url: 'https://abc-default-rtdb.firebaseio.com' }), t({ url: 'https://abc.asia-southeast1.firebasedatabase.app/', path: 'x/y' }),
                    t({ url: '' }), t({ url: 'http://abc.firebaseio.com' }), t({ url: 'https://evil.example.com' }), t({ url: 'https://abc.firebaseio.com.evil.com' }),
                    t({ url: 'https://abc.firebaseio.com', path: '../etc' }), t({ url: 'http://127.0.0.1:8000' }), t({ url: 'http://127.0.0.1:8000' }, { allowLocal: true }), t(null),
                  ]);
                })()""")
                check("cloud.json の検査: https の firebaseio.com / firebasedatabase.app だけ。http・ほかのドメイン・変な path は、使わない（テストのときだけ 127.0.0.1 の http）", json.loads(res),
                      ["https://abc-default-rtdb.firebaseio.com|chordlines/library", "https://abc.asia-southeast1.firebasedatabase.app|x/y", None, None, None, None, None, None, "http://127.0.0.1:8000|chordlines/library", None])
        finally:
            srv2.shutdown()
    print("公開ライブラリ（ゲーム側）: %d 件中 %d 件 失敗" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
