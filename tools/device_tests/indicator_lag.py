#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機のテスト: 操作画面の「進行の表示」は、音（MIDI）とそろっているか。
  本物の ESP32 → 本物の tools/midi_bridge.py → 本物の Chrome（ヘッドレス）の、全経路で測る。
    ・MIDI: ブリッジが作る仮想MIDIポートを、このプログラムが聞いて、ピアノ（チャンネル1）の和音が出た時刻を記録する
    ・画面: Chrome の画面の「いま光っているタイル」を、数ミリ秒おきに調べて、変わった時刻を記録する
  比べるのは「MIDIが出た時刻」と「画面が変わった時刻」。音源（GM音源・GarageBand）の中の遅れは含まない。
準備: ESP32 をつなぐ（UART側）。PlatformIO の Serial Monitor・ほかのブリッジは閉じる。駒は置いたままでよい（登録は変えない）。
実行:  tools/.venv/bin/python tools/device_tests/indicator_lag.py [秒数]
"""
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools", "host_tests"))
from cdp_lite import Cdp  # noqa: E402
import rtmidi  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 12.0
VPORT = "IndicatorLagTest"

bridge = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "midi_bridge.py"), "--name", VPORT, "--ui-port", "0"],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
screen = []
url_box = []


def read_screen():
    buf = b""
    while True:
        ch = bridge.stdout.read(1)
        if not ch:
            return
        buf += ch
        if ch == b"\n":
            line = buf.decode("utf-8", "replace").rstrip()
            buf = b""
            screen.append(line)
            m = re.search(r"リズム編集画面: (http://127\.0\.0\.1:\d+)/", line)
            if m:
                url_box.append(m.group(1))


threading.Thread(target=read_screen, daemon=True).start()


def send(text):
    bridge.stdin.write((text + "\n").encode("utf-8"))
    bridge.stdin.flush()


chrome = None
cdp = None
midi_in = rtmidi.MidiIn()
onsets = []   # ピアノ（チャンネル1）のノートオンの時刻


def on_midi(event, _data=None):
    msg, _dt = event
    if len(msg) == 3 and (msg[0] & 0xF0) == 0x90 and (msg[0] & 0x0F) == 0 and msg[2] > 0:
        onsets.append(time.time())


try:
    for _ in range(100):
        if url_box and any("[READY]" in l for l in screen):
            break
        time.sleep(0.1)
    if not url_box:
        print("ブリッジの画面を始められませんでした:\n" + "\n".join(screen[-10:]))
        sys.exit(2)
    time.sleep(1.0)
    send("n")                  # 駒が置いてあって「再登録しますか？」が出ていたら、必ず「そのまま」で答える
    time.sleep(0.5)
    for c in ("STOP", "BPM 120", "DRUM 2", "BACKING 6"):   # 音の指示が多い設定（8ビート + アルペジオ）で測る
        send(c)
        time.sleep(0.3)

    # 仮想MIDIポートを聞く
    ports = midi_in.get_ports()
    idx = [i for i, p in enumerate(ports) if VPORT in p]
    if not idx:
        print("仮想MIDIポートが見つかりません:", ports)
        sys.exit(2)
    midi_in.open_port(idx[0])
    midi_in.set_callback(on_midi)

    # Chrome を開いて、操作画面を表示する
    prof = tempfile.mkdtemp()
    chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + prof,
                               "--remote-debugging-port=0", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    dt_port = None
    for _ in range(100):
        try:
            dt_port = int(open(os.path.join(prof, "DevToolsActivePort")).read().split("\n")[0])
            break
        except (OSError, ValueError):
            time.sleep(0.1)
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % dt_port, timeout=5).read().decode())
    cdp = Cdp([t for t in targets if t.get("type") == "page"][0]["webSocketDebuggerUrl"])
    cdp.call("Page.enable")
    cdp.call("Page.navigate", {"url": url_box[0] + "/"})
    for _ in range(100):
        if cdp.eval("!!(window.live && live.s && live.connected && live.events && live.events.readyState === 1)"):
            break
        time.sleep(0.1)
    else:
        print("画面が ESP32 の状態を読めませんでした（ESP32 が応答していない?）")
        sys.exit(2)
    now_tile = "(function(){var t=document.querySelector('#c-prog .tile.now');return t?t.dataset.i:null;})()"

    # 再生を始めて、画面の光るタイルを、できるだけ速く調べ続ける
    send("START")
    changes = []   # (時刻, 光っているタイル)
    last = object()
    end = time.time() + SECONDS
    while time.time() < end:
        v = cdp.eval(now_tile)
        t = time.time()
        if v != last:
            changes.append((t, v))
            last = v
    send("STOP")
    time.sleep(0.5)
    for c in ("BACKING 1", "START"):   # 標準の設定に戻して、再生中にしておく（登録の画面のまま残さない）
        send(c)
        time.sleep(0.3)
finally:
    try:
        if cdp:
            cdp.call("Browser.close")
    except Exception:
        pass
    if chrome:
        chrome.terminate()
    try:
        midi_in.close_port()
    except Exception:
        pass
    try:
        bridge.send_signal(signal.SIGINT)
        bridge.wait(timeout=10)
    except Exception:
        bridge.kill()

# ---- 解析 ----
# ピアノの和音（同じステップで4音が続けて出る）→ ステップの始まりの時刻。0.4 秒以上あいたら別のステップ
steps_midi = []
for t in onsets:
    if not steps_midi or t - steps_midi[-1] > 0.4:
        steps_midi.append(t)
dom = [(t, v) for t, v in changes if v is not None]
print("MIDI のステップの始まり: %d 回 / 画面の光るタイルの変化: %d 回（%s）" % (len(steps_midi), len(dom), " ".join(v for _, v in dom)))
lags = []
for tm in steps_midi:
    after = [t for t, _ in dom if tm - 0.03 <= t <= tm + 0.5]
    if after:
        lags.append((after[0] - tm) * 1000)
if len(lags) < 5:
    print("FAIL 比べられるステップが少なすぎます（%d）" % len(lags))
    sys.exit(1)
lags_sorted = sorted(lags)
pct = lambda q: lags_sorted[min(len(lags_sorted) - 1, int(q * len(lags_sorted)))]
print("画面が変わるまでの遅れ（MIDI が出た時刻 → 画面が変わった時刻）: 中央値 %.0f ms、平均 %.0f ms、95%%点 %.0f ms、最小 %.0f ms、最大 %.0f ms（%d ステップ）" %
      (pct(0.5), sum(lags) / len(lags), pct(0.95), lags_sorted[0], lags_sorted[-1], len(lags)))
gaps = [(b - a) * 1000 for a, b in zip([t for t, _ in dom], [t for t, _ in dom][1:])]
mg = [(b - a) * 1000 for a, b in zip(steps_midi, steps_midi[1:])]
if gaps and mg:
    print("光るタイルが変わる間隔（本来 1000 ms）: 最小 %.0f / 最大 %.0f ms。MIDI のステップの間隔: 最小 %.0f / 最大 %.0f ms" % (min(gaps), max(gaps), min(mg), max(mg)))
print("  （従来は、約0.7秒おきの問い合わせだったので、平均 約600 ms・最大 約700 ms 遅れた）")
ok = lags_sorted[-1] < 80
print("PASS" if ok else "FAIL", "最大の遅れが 80 ms 未満")
sys.exit(0 if ok else 1)
