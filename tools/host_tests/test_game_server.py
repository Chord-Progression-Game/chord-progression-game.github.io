#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ゲームを配るサーバー（tools/game_server.py）と、実機の盤とのつなぎのテスト。
  1. サーバー: ファイルを配る・/api/ をブリッジに中継する（疑似のブリッジで）・ブリッジが落ちていても止まらない・自分のパソコン以外は拒む
  2. 通しのテスト: 本物のブリッジ（midi_bridge.py）+ 疑似 ESP32（pty）+ 本物の Chrome で、
     疑似の盤の駒が、ゲームの画面の盤に出ること（置く・替える・はずす）を確かめる
実行:  python3 tools/host_tests/test_game_server.py
"""
import http.client
import json
import os
import pty
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, HERE)
import game_server  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


# ---------------------------------------------------------------------------
# 疑似のブリッジ（/api/state・/api/events・/api/control だけ）
# ---------------------------------------------------------------------------
class FakeBridge(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.headers.get("Host") != "127.0.0.1:%d" % self.server.server_address[1]:
            self.send_response(403); self.send_header("Content-Length", "0"); self.end_headers(); return
        if self.path == "/api/state":
            body = json.dumps({"connected": True, "s": {"bpm": 120, "chords": [{"name": "Ⅰ", "symbol": "C"}]}}, ensure_ascii=False).encode("utf-8")
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path.split("?")[0] == "/api/events":
            self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Connection", "close"); self.end_headers()
            self.wfile.write(b": connected\n\n")
            self.wfile.write(('data: {"type": "state", "s": {"bpm": 99}}\n\n').encode("utf-8")); self.wfile.flush()
            time.sleep(0.2)
            self.wfile.write(('data: {"type": "step", "step": 3}\n\n').encode("utf-8")); self.wfile.flush()
            self.close_connection = True
        else:
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(n)
        body = json.dumps({"echo": json.loads(data.decode("utf-8")), "ctype": self.headers.get("Content-Type")}).encode("utf-8")
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


def get(port, path, host=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("GET", path, headers={"Host": host or "127.0.0.1:%d" % port})
    r = c.getresponse(); data = r.read(); h = {k.lower(): v for k, v in r.getheaders()}; c.close()
    return r.status, data, h


bridge = ThreadingHTTPServer(("127.0.0.1", 0), FakeBridge)
bridge.daemon_threads = True
threading.Thread(target=bridge.serve_forever, daemon=True).start()
srv = game_server.make_server(port=0, bridge_port=bridge.server_address[1])
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]

st, body, h = get(port, "/")
check("ゲームのページが開く", (st, b"CHORD" in body, "text/html" in h.get("content-type", "")), (200, True, True))
check("ページは、古い版が残らない（no-store）", h.get("cache-control"), "no-store")
st, body, h = get(port, "/js/app.js")
check("モジュール（app.js）が配られる", (st, b"startAudio" in body), (200, True))
st, body, h = get(port, "/data/chords.json")
check("コードの表（chords.json）が配られる", (st, json.loads(body)["repeatId"]), (200, 99))
check("存在しないファイルは 404", get(port, "/nothing.js")[0], 404)
check("上の階層へは出られない", get(port, "/../tools/game_server.py")[0], 404)
check("自分のパソコン以外の名前（Host）は拒む", get(port, "/", host="evil.example.com")[0], 403)
check("127.0.0.1 だけで待つ", srv.server_address[0], "127.0.0.1")

st, body, h = get(port, "/api/state")
check("/api/state は、ブリッジの返事が、そのまま届く", (st, json.loads(body)["s"]["bpm"]), (200, 120))
c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
c.request("GET", "/api/events", headers={"Host": "127.0.0.1:%d" % port})
r = c.getresponse()
lines = []
while True:
    ln = r.fp.readline()
    if not ln:
        break
    lines.append(ln.decode("utf-8").strip())
c.close()
check("/api/events: つなぎっぱなしの通知が、順に届く", [l for l in lines if l.startswith("data:")], ['data: {"type": "state", "s": {"bpm": 99}}', 'data: {"type": "step", "step": 3}'])
c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
c.request("POST", "/api/control", body=json.dumps({"action": "bpm", "value": 100}), headers={"Host": "127.0.0.1:%d" % port, "Content-Type": "application/json"})
r = c.getresponse(); d = json.loads(r.read().decode("utf-8")); c.close()
check("POST も中継される（本体と、Content-Type）", (r.status, d["echo"], d["ctype"]), (200, {"action": "bpm", "value": 100}, "application/json"))

dead = game_server.make_server(port=0, bridge_port=free_port())            # ブリッジが動いていない
threading.Thread(target=dead.serve_forever, daemon=True).start()
check("ブリッジが動いていないときは 502（ゲームは止まらない）", get(dead.server_address[1], "/api/state")[0], 502)
check("ブリッジが動いていなくても、ページは開く", get(dead.server_address[1], "/")[0], 200)
dead.shutdown()

# --lan（スマホ用。同じ Wi-Fi から、ゲームのファイルだけ）
check("ふだん（--lan なし）: LAN の住所の Host は拒む", get(port, "/", host="192.168.0.5:%d" % port)[0], 403)
lan = game_server.make_server(port=0, bridge_port=bridge.server_address[1], lan=True)
threading.Thread(target=lan.serve_forever, daemon=True).start()
lport = lan.server_address[1]
check("--lan: すべての住所で待つ（0.0.0.0）", lan.server_address[0], "0.0.0.0")
check("--lan: LAN の住所（192.168.x.x）・.local の名前の Host でも、ページが開く", [get(lport, "/", host="192.168.0.5:%d" % lport)[0], get(lport, "/", host="mymac.local:%d" % lport)[0]], [200, 200])
check("--lan: LAN 以外の住所・名前（インターネット側）は、拒む", [get(lport, "/", host="evil.example.com:%d" % lport)[0], get(lport, "/", host="8.8.8.8:%d" % lport)[0], get(lport, "/", host="192.168.0.5:1")[0]], [403, 403, 403])
check("--lan: このパソコン自身（127.0.0.1）からの /api/ は、ブリッジに中継される", get(lport, "/api/state")[0], 200)
check("--lan: スマホ用のファイル（manifest・アイコン・スマホ用の CSS）が配られる", [get(lport, "/manifest.webmanifest", host="192.168.0.5:%d" % lport)[0], get(lport, "/icons/icon-180.png", host="192.168.0.5:%d" % lport)[0], get(lport, "/css/mobile.css", host="192.168.0.5:%d" % lport)[0]], [200, 200, 200])
check("--lan: 住所の判定（プライベートな住所だけ。自分自身かどうか）", [game_server.lan_host_ok("10.0.0.2:8800", 8800), game_server.lan_host_ok("172.20.1.1:8800", 8800), game_server.lan_host_ok("172.32.1.1:8800", 8800), game_server.is_loopback("127.0.0.1"), game_server.is_loopback("192.168.0.9")], [True, True, False, True, False])
ips = game_server.lan_addresses()
if ips:                                                              # このパソコンの LAN の住所から、つなぐ: 相手は、LAN の人として扱われる
    c = http.client.HTTPConnection(ips[0], lport, timeout=5)
    c.request("GET", "/api/state", headers={"Host": "%s:%d" % (ips[0], lport)})
    r = c.getresponse(); r.read(); c.close()
    c = http.client.HTTPConnection(ips[0], lport, timeout=5)
    c.request("GET", "/", headers={"Host": "%s:%d" % (ips[0], lport)})
    r2 = c.getresponse(); r2.read(); c.close()
    check("--lan: LAN の相手（%s）には、ゲームのページは配るが、/api/（実機の盤・ブリッジ）は、404（使わせない）" % ips[0], [r2.status, r.status], [200, 404])
else:
    print("（LAN の住所が見つからないので、LAN の相手からの /api/ の確認は省略）")
lan.shutdown()
srv.shutdown(); bridge.shutdown()


# ---------------------------------------------------------------------------
# 2. 通しのテスト（本物のブリッジ + 疑似 ESP32 + 本物の Chrome）
# ---------------------------------------------------------------------------
venv_python = os.path.join(ROOT, "tools", ".venv", "bin", "python")
from chrome_driver import ChromeSession, chrome_available  # noqa: E402

if os.path.exists(venv_python) and chrome_available():
    bridge_port = free_port()
    master, slave = pty.openpty()
    proc = subprocess.Popen([venv_python, os.path.join(ROOT, "tools", "midi_bridge.py"), "--port", os.ttyname(slave), "--name", "GameDeviceTest", "--ui-port", str(bridge_port)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
    gsrv = game_server.make_server(port=0, bridge_port=bridge_port)
    threading.Thread(target=gsrv.serve_forever, daemon=True).start()
    gport = gsrv.server_address[1]

    def send_state(chords):
        items = ";".join("%s,%s" % (n, s) for n, s in chords)
        line = "~S bpm=120 key=C playing=0 step=-1 drum=0 backing=1 lead=1 voicing=4 octave=1 idle=RESET gain=33 midi=BRIDGE learn=0 map=4,3,2,1,5,6,7,8 chords=%s\r\n" % items
        os.write(master, line.encode("utf-8"))

    try:
        end = time.time() + 8
        out = b""
        while time.time() < end:                                    # ブリッジの起動を待つ
            r, _, _ = select.select([proc.stdout], [], [], 0.1)
            if r:
                out += os.read(proc.stdout.fileno(), 4096)
                if b"-" * 60 in out:
                    break
        time.sleep(0.4)
        os.write(master, b"[READY]\r\n")
        with ChromeSession(width=1280, height=720) as ch:
            ch.open("http://127.0.0.1:%d/" % gport)
            ch.wait_for("window.__ready === true", timeout=30)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=30)
            ch.wait_for("__app.device.connected === true", timeout=15)
            check("通しのテスト: ブリッジにつながった（盤は、まだ）", ch.eval("__app.device.connected"), True)
            empty = [("-", "")] * 8
            send_state([("ⅣM7", "FM7"), ("Ⅴ7", "G7"), ("Ⅲm7", "Em7"), ("Ⅵm7", "Am7")] + empty[:4])
            ch.wait_for("__app.game.board[3] !== null", timeout=15)
            ids = ch.eval("JSON.stringify(__app.game.board)")
            want = ch.eval("JSON.stringify(['ⅣM7','Ⅴ7','Ⅲm7','Ⅵm7'].map(n => __app.table.byName(n).id).concat([null,null,null,null]))")
            check("通しのテスト: 実機の盤の駒が、ゲームの盤に出る", ids, want)
            check("通しのテスト: 王道進行が決まる", ch.eval("JSON.stringify(__app.game.analysis.instances.map(i => i.kind))"), '["oudou"]')
            check("通しのテスト: 実機の盤を見ている（画面の駒の置き場は使えない）", ch.eval("[__app.device.live, document.body.classList.contains('device-live')]"), [True, True])
            send_state([("ⅣM7", "FM7"), ("Ⅴ7", "G7"), ("-", ""), ("-", "")] + empty[:4])
            ch.wait_for("__app.game.board[2] === null", timeout=15)
            check("通しのテスト: 駒を外すと、画面からも消える（王道進行が消えて、ⅣM7→Ⅴ7 は「ドミナント終止」だけ残る）", ch.eval("JSON.stringify(__app.game.analysis.instances.map(i => i.kind))"), '["dominant_ending"]')
            send_state([("Ⅱm7", "Dm7"), ("Ⅴ7", "G7"), ("ⅠM7", "CM7"), ("?", ""), ("→", ""), ("-", ""), ("-", ""), ("-", "")])
            ch.wait_for("__app.game.board[2] !== null", timeout=15)
            check("通しのテスト: ツーファイブワン（未登録の「?」は休み、「→」は繰り返しの駒）", ch.eval("JSON.stringify([__app.game.analysis.instances.map(i => i.variant), __app.game.board[3], __app.game.board[4]])"), '[["ツーファイブワン"],null,99]')
            ch.eval("__app.device.toggle()")
            check("通しのテスト: 「画面の盤」に切り替えられる", ch.eval("[__app.device.live, document.body.classList.contains('device-live')]"), [False, False])
            check("通しのテスト: ページの中に、エラーがない", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
            bst = json.loads(get(bridge_port, "/api/state")[1])
            check("通しのテスト: ゲームがつながっている間、ブリッジは MIDI の出力を止める（GarageBand と二重に鳴らない）", [bst.get("game_clients", 0) >= 1, bst.get("midi_muted")], [True, True])
        # ゲームの画面を閉じると（SSE が切れると）、MIDI の出力が戻る。切れたことは、中継の見張り役（0.5秒ごと）と、ブリッジの keepalive（2秒ごと）で気づく → 数秒で戻る
        t0 = time.time(); end = t0 + 15
        bst = None
        while time.time() < end:
            bst = json.loads(get(bridge_port, "/api/state")[1])
            if bst.get("game_clients") == 0:
                break
            time.sleep(0.5)
        print("  [実測] ゲームを閉じてから、MIDI の出力が戻るまで: %.1f 秒" % (time.time() - t0))
        check("通しのテスト: ゲームを閉じると、MIDI の出力が戻る（6秒以内）", [bst.get("game_clients"), bst.get("midi_muted"), time.time() - t0 < 6], [0, False, True])
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGINT)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        gsrv.shutdown()
else:
    print("（実機の盤とのつなぎの通しテストは、tools/.venv か Chrome がないので省略）")

print("test_game_server: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
