#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
操作画面の「進行の表示」が、ESP32 のステップの進みに、すぐ追いつくか（実時間のテスト）。
  ・本物の Chrome（ヘッドレス）を、DevTools プロトコル（websocket）で直接操作する。仮想時間は使わない。
    （つなぎっぱなしの通信 = EventSource があると、test_ui_browser.py の仮想時間は進まなくなるため、別のテストにした）
  ・サーバーは本物（tools/rhythm_server.py）。ESP32 の代わりに、決まった状態を返し、ステップの合図を一定の間隔で流す。
  ・確かめること:
      1. 合図が出てから、画面の進行の表示が変わるまでが、短い（ミリ秒）
      2. 古い状態の返事（約0.7秒おきの問い合わせ）が来ても、進行の表示が戻らない
      3. ESP32 が止まった合図（~T -1）で、表示が消える
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
実行:  python3 tools/host_tests/test_ui_realtime.py
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import rhythm_server as rs  # noqa: E402
sys.path.insert(0, HERE)
from cdp_lite import Cdp  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if not os.path.exists(CHROME):
    print("（Chrome がないので、実時間の画面のテストは省略）")
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
    "s": {"bpm": 120, "key": "C", "playing": 1, "step": 1, "drum": 2, "backing": 6, "lead": 1, "voicing": 4, "octave": 1, "idle": "RESET", "gain": 33,
          "midi": "BRIDGE", "learn": 0, "map": [4, 3, 2, 1],
          "chords": [{"name": "Ⅰ", "symbol": "C"}, {"name": "Ⅵm", "symbol": "Am"}, {"name": "Ⅳ", "symbol": "F"}, {"name": "Ⅴ", "symbol": "G"}]},
    "patterns": {"drum": {}, "backing": {}},
}
hub = rs.EventHub()
server = rs.start_in_thread(0, lambda l: None, control=lambda l: None, get_state=lambda: STATE, events=hub)
port = server.server_address[1]
prof = tempfile.mkdtemp()
chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + prof,
                           "--remote-debugging-port=0", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
cdp = None
try:
    # Chrome が選んだ DevTools のポート番号は、プロファイルの DevToolsActivePort に書かれる
    dt_port = None
    for _ in range(100):
        try:
            dt_port = int(open(os.path.join(prof, "DevToolsActivePort")).read().split("\n")[0])
            break
        except (OSError, ValueError):
            time.sleep(0.1)
    check("Chrome の DevTools に届く", dt_port is not None, True)
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % dt_port, timeout=5).read().decode())
    page = [t for t in targets if t.get("type") == "page"][0]
    cdp = Cdp(page["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    cdp.call("Page.navigate", {"url": "http://127.0.0.1:%d/" % port})

    def wait_for(expr, seconds=8.0):
        end = time.time() + seconds
        while time.time() < end:
            if cdp.eval(expr):
                return True
            time.sleep(0.02)
        return False

    check("画面が読み込まれて、ESP32 の状態が出る", wait_for("!!(window.live && live.s && live.connected)"), True)
    now_tile = "(function(){var t=document.querySelector('#c-prog .tile.now');return t?t.dataset.i:null;})()"
    check("最初は、問い合わせの返事（step=1）で、2番目が光る", cdp.eval(now_tile), "1")
    check("EventSource でつながった", wait_for("!!live.events && live.events.readyState === 1"), True)

    # --- 1. 合図が出てから、表示が変わるまで ---
    lags = []
    seq = 1000
    for step in (2, 3, 0, 1, 2, 3, 0, 1):
        seq += 1
        t0 = time.time()
        hub.publish({"type": "step", "step": step, "playing": 1, "seq": seq, "sid": 1, "t": int(t0 * 1000)})
        ok = wait_for("(%s) === '%d'" % (now_tile, step), 2.0)
        lags.append((time.time() - t0) * 1000)
        check("合図(step=%d)で、表示が変わる" % step, ok, True)
        time.sleep(0.25)
    page_lags = cdp.eval("live.stepLagMs")
    lags_sorted = sorted(lags)
    print("  [実測] 合図 → 画面の表示が変わるまで（このテストの観測。CDP の問い合わせの間隔を含む）: 中央値 %.0f ms、最大 %.0f ms" % (lags_sorted[len(lags) // 2], lags_sorted[-1]))
    print("  [実測] 画面の中で測った遅れ（サーバーが合図を作ってから、表示を変えるまで）: %s ms" % page_lags)
    check("表示の遅れの中央値が 100ms 未満（問い合わせを待つ従来は、最大 700ms 以上）", lags_sorted[len(lags) // 2] < 100, True)
    check("画面の中で測った遅れが 50ms 未満", isinstance(page_lags, (int, float)) and page_lags < 50, True)

    # --- 2. 古い状態の返事で戻らない ---
    seq += 1
    hub.publish({"type": "step", "step": 3, "playing": 1, "seq": seq, "sid": 1, "t": int(time.time() * 1000)})
    wait_for("(%s) === '3'" % now_tile, 2.0)
    time.sleep(2.0)   # この間に、問い合わせ(約0.7秒おき)が3回ほど走る。返事は step=1（古い）
    check("古い状態の返事（step=1）が何度来ても、進行の表示(4番目)は戻らない", cdp.eval(now_tile), "3")

    # --- 3. 止まった合図で消える ---
    seq += 1
    hub.publish({"type": "step", "step": -1, "playing": 0, "seq": seq, "sid": 1, "t": int(time.time() * 1000)})
    check("止まった合図（~T -1）で、光るタイルが消える", wait_for("(%s) === null" % now_tile, 2.0), True)
    check("止まった合図で、ボタンが START になる", cdp.eval("document.getElementById('c-play').textContent.indexOf('START') >= 0"), True)

    # --- 4. 駒が外れた・置かれた（ESP32 が自分から送ってきた状態）が、すぐ反映される ---
    tile_text = lambda i: "(function(){var t=document.querySelector('#c-prog .tile[data-i=\"%d\"] .deg');return t?t.textContent:null;})()" % i
    check("最初は、位置3(3番目)に Ⅳ が出ている", cdp.eval(tile_text(2)), "Ⅳ")
    removed = json.loads(json.dumps(STATE["s"]))
    removed["chords"][2] = {"name": "-", "symbol": ""}
    seq += 1
    t0 = time.time()
    hub.publish({"type": "state", "s": removed, "seq": seq, "sid": 1, "t": int(t0 * 1000)})
    ok = wait_for("(%s) === '（空）'" % tile_text(2), 2.0)
    d_remove = (time.time() - t0) * 1000
    check("駒を外した状態の合図で、位置3が「（空）」になる", ok, True)
    placed = json.loads(json.dumps(removed))
    placed["chords"][2] = {"name": "Ⅰ", "symbol": "C"}
    seq += 1
    t0 = time.time()
    hub.publish({"type": "state", "s": placed, "seq": seq, "sid": 1, "t": int(t0 * 1000)})
    ok = wait_for("(%s) === 'Ⅰ'" % tile_text(2), 2.0)
    d_place = (time.time() - t0) * 1000
    check("駒を置いた状態の合図で、位置3が Ⅰ になる", ok, True)
    print("  [実測] 駒の外す／置く の状態の合図 → 画面の表示が変わるまで: %.0f ms / %.0f ms" % (d_remove, d_place))
    check("状態の合図の反映が 100ms 未満", d_remove < 100 and d_place < 100, True)
    time.sleep(1.5)   # 古い問い合わせの返事（Ⅳ のまま）が来ても、新しい状態を戻さない
    check("古い問い合わせの返事（駒あり=Ⅳ）で、新しい状態（Ⅰ）が戻らない", cdp.eval(tile_text(2)), "Ⅰ")
    check("リアルタイム接続の表示が ON と画面の版を出す", cdp.eval("document.getElementById('c-rt').textContent"), "リアルタイム接続: ON（直近の遅れ %d ms）　画面の版 2026-11-15c" % cdp.eval("live.lagMs"))
    STATE["s"] = placed   # 以降の（参考の）問い合わせは、この状態を返す

    # --- 5. ブリッジが ESP32 につながっていないとき、Mac から音が鳴らないことと、つなぎ方が、画面に出る ---
    bridge_js = lambda ser: "(function(){ live.serial = %s; renderBridge(); var b = document.getElementById('c-bridge'); return JSON.stringify([b.className, b.textContent, (b.querySelector('button')||{}).textContent || null]); })()" % json.dumps(ser)
    ok_state = json.loads(cdp.eval(bridge_js({"open": True, "daemon": True, "port": "/dev/cu.x", "busy": []})))
    check("ブリッジがつながっているときは、緑の表示と、「解除」ボタン", (ok_state[0], "Mac から音を鳴らせます" in ok_state[1], ok_state[2]), ("bridge-bar ok", True, "ブリッジを解除する（Serial Monitor を使う）"))
    hold_state = json.loads(cdp.eval(bridge_js({"open": False, "daemon": True, "released": True, "port": "/dev/cu.x", "busy": []})))
    check("解除中は、琥珀色の表示（音が鳴らないこと）と、「つなぐ」ボタン", (hold_state[0], "解除中" in hold_state[1], "Mac から音が鳴りません" in hold_state[1], hold_state[2]), ("bridge-bar hold", True, True, "ブリッジをつなぐ"))
    busy_state = json.loads(cdp.eval(bridge_js({"open": False, "daemon": True, "port": "/dev/cu.x", "busy": [{"pid": 4242, "command": "python platformio device monitor", "monitor": True}]})))
    check("Serial Monitor が使っているとき: 「音が鳴りません」と、理由（PID つき）と、ボタン",
          (busy_state[0], "Mac から音が鳴りません" in busy_state[1], "Serial Monitor" in busy_state[1] and "4242" in busy_state[1], busy_state[2]), ("bridge-bar warn", True, True, "Serial Monitor を閉じて、つなぐ"))
    gone_state = json.loads(cdp.eval(bridge_js({"open": False, "daemon": True, "port": None, "busy": []})))
    check("ESP32 が見つからないとき: USB の確認を促す", ("USB ケーブル" in gone_state[1], gone_state[2]), (True, "つなぎ直す"))
    plain_state = json.loads(cdp.eval(bridge_js({"open": False, "daemon": False, "port": None, "busy": []})))
    check("常駐でないブリッジ（端末で動かしている）では、表示しない", plain_state[0], "bridge-bar hidden")
    cdp.eval("live.serial = null; renderBridge()")

    # --- 参考: 従来の方式（約0.7秒おきの問い合わせだけ）の遅れ。EventSource を閉じて、同じ条件で測る ---
    cdp.eval("live.events.close()")
    polled = []
    for n, step in enumerate((2, 0, 2, 0, 2, 0)):
        STATE["s"]["step"] = step
        STATE["seq"] = 5000 + n          # 画面が覚えている順番より新しい返事にする
        t0 = time.time()
        ok = wait_for("(%s) === '%d'" % (now_tile, step), 3.0)
        polled.append((time.time() - t0) * 1000)
        check("参考: 問い合わせだけでも、いずれ追いつく(step=%d)" % step, ok, True)
    print("  [実測・参考] 従来（問い合わせだけ。約0.7秒おき）の遅れ: 平均 %.0f ms、最大 %.0f ms" % (sum(polled) / len(polled), max(polled)))
finally:
    try:
        if cdp:
            cdp.call("Browser.close")
    except Exception:
        pass
    chrome.terminate()
    try:
        chrome.wait(timeout=10)
    except subprocess.TimeoutExpired:
        chrome.kill()
    hub.close()
    server.shutdown()

print("test_ui_realtime: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
