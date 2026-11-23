#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ゲーム（game/）を、ブラウザで開けるように配る、小さなサーバー。
  ・game/ のファイルを配る（ES モジュールは、file:// では動かないので、サーバーが要る）
  ・/api/ は、ブリッジ（tools/midi_bridge.py。標準で 127.0.0.1:8765）に、そのまま中継する
      → ページが、実機の盤（ESP32）の駒の状態を、同じ場所から受け取れる（別の場所へのアクセスの許可が、いらない）
      → ブリッジが動いていなくても、ゲームは動く（実機は「未接続」になるだけ。画面の盤で遊べる）
  ・ふだんは、自分のパソコン（127.0.0.1）からしか、つながらない
  ・--lan を付けると、同じ Wi-Fi の、スマホ・タブレットからも、開ける（2026-11-23）。ゲームのファイル（読み取り専用）だけを配る。
      実機の盤・ブリッジへの中継（/api/）は、このパソコンのブラウザ（127.0.0.1）にだけ使えて、LAN からは使えない（外から、操作されないように）
      → スマホでは、画面の盤で遊ぶ（実機の盤は、使えない）
使い方:
  python3 tools/game_server.py            → http://127.0.0.1:8800/ を配る
  python3 tools/game_server.py --open     → Chrome で開く
  python3 tools/game_server.py --open --kiosk   → Chrome を全画面で開く（展示用）
  python3 tools/game_server.py --lan      → 同じ Wi-Fi のスマホ用の URL（http://192.168.x.x:8800/）も出す
  sh tools/game.sh                        → 上と同じ（--open つき）。sh tools/game.sh lan → スマホ用（--lan）
"""
import argparse
import http.client
import os
import re
import select
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME_DIR = os.path.join(ROOT, "game")


def is_loopback(addr):
    """ つないできた相手が、このパソコン自身か """
    return addr in ("127.0.0.1", "::1", "::ffff:127.0.0.1")


# LAN（家庭の Wi-Fi）で使う、プライベートな住所か（10.x・172.16〜31.x・192.168.x・169.254.x）。Host の値の検査に使う
_PRIVATE = re.compile(r"^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$")


def lan_host_ok(host_header, port):
    """ --lan のとき: Host が、プライベートな住所（または .local の名前）+ このポートなら、よい """
    host = (host_header or "").lower()
    name, _, p = host.rpartition(":")
    if not name or p != str(port):
        return False
    return bool(_PRIVATE.match(name)) or name.endswith(".local") or name in ("127.0.0.1", "localhost")


def lan_addresses():
    """ このパソコンの、LAN での住所（スマホから開く URL に使う）。見つからなければ、空 """
    found = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("10.255.255.255", 1))
        found.append(sock.getsockname()[0])
        sock.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if _PRIVATE.match(ip) and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return [ip for ip in found if _PRIVATE.match(ip)]


def make_handler(game_dir, bridge_port, port_getter, lan=False):
    class Handler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def _host_ok(self):
            host = (self.headers.get("Host") or "").lower()
            port = port_getter()
            if host in ("127.0.0.1:%d" % port, "localhost:%d" % port):
                return True
            return lan and lan_host_ok(host, port)

        def _api_ok(self):
            # /api/（実機の盤・ブリッジへの中継）は、このパソコン自身のブラウザにだけ。LAN の相手には使わせない
            return is_loopback(self.client_address[0])

        def end_headers(self):
            if not self.path.startswith("/api/"):
                self.send_header("Cache-Control", "no-store")       # 直したら、すぐ反映（展示の前に、古い版が残らないように）
            super().end_headers()

        def _send(self, code, body=b"{}", ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        # ---------- /api/ の中継 ----------
        def _proxy(self, method):
            body = None
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                if n < 0 or n > 20000:
                    return self._send(413)
                body = self.rfile.read(n) if n else b""
            stream = self.path.startswith("/api/events")
            try:
                conn = http.client.HTTPConnection("127.0.0.1", bridge_port, timeout=30 if stream else 1.5)       # 通知は、長く待つ（ブリッジは2秒ごとに、つながっている合図を送る）
                headers = {"Host": "127.0.0.1:%d" % bridge_port}
                if self.headers.get("Content-Type"):
                    headers["Content-Type"] = self.headers["Content-Type"]
                conn.request(method, self.path, body=body, headers=headers)
                resp = conn.getresponse()
            except (OSError, http.client.HTTPException):
                return self._send(502, b'{"error": "bridge"}')
            ctype = resp.getheader("Content-Type") or "application/json"
            if stream:
                # つなぎっぱなしの通知（SSE）: 届いた分を、そのまま流し続ける
                self.send_response(resp.status)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                # ブラウザが閉じたら、すぐブリッジ側のつなぎも切る（ブリッジは「ゲームがつながっている間」MIDI を止めるので、戻りが遅れないように）。
                # 読み取りで待っている間は気づけないので、見張り役が、ブラウザ側の切断（EOF）を 0.5 秒ごとに確かめる
                done = threading.Event()
                client = self.connection
                upstream = getattr(getattr(resp.fp, "raw", None), "_sock", None) or conn.sock   # getresponse のあと conn.sock は None になるので、読み口の元のソケットを使う

                def watch():
                    while not done.is_set():
                        try:
                            r, _, _ = select.select([client], [], [], 0.5)
                            if r and not client.recv(1, socket.MSG_PEEK):
                                raise OSError("closed")
                            if r:
                                time.sleep(0.5)          # 何か届いた（ふつうは来ない）。読み捨てず、少し待つ
                        except (OSError, ValueError):
                            try:
                                if upstream is not None:
                                    upstream.shutdown(socket.SHUT_RDWR)   # readline を起こして、終わらせる
                            except OSError:
                                pass
                            return
                threading.Thread(target=watch, daemon=True).start()
                try:
                    while True:
                        chunk = resp.fp.readline()
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (OSError, http.client.HTTPException, ValueError):
                    pass
                finally:
                    done.set()
                    conn.close()
                self.close_connection = True
                return
            data = resp.read()
            conn.close()
            self._send(resp.status, data, ctype)

        def do_GET(self):
            if not self._host_ok():
                return self._send(403)
            if self.path.startswith("/api/"):
                if not self._api_ok():
                    return self._send(404)
                return self._proxy("GET")
            if self.path in ("/", ""):
                self.path = "/index.html"
            return super().do_GET()

        def do_POST(self):
            if not self._host_ok():
                return self._send(403)
            if self.path.startswith("/api/"):
                if not self._api_ok():
                    return self._send(404)
                return self._proxy("POST")
            return self._send(405)

    return partial(Handler, directory=game_dir)


def make_server(port=8800, bridge_port=8765, game_dir=GAME_DIR, lan=False):
    holder = {}
    handler = make_handler(game_dir, bridge_port, lambda: holder["srv"].server_address[1], lan=lan)
    srv = ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), handler)
    srv.daemon_threads = True
    holder["srv"] = srv
    return srv


def open_browser(url, kiosk=False):
    chrome = "/Applications/Google Chrome.app"
    if os.path.exists(chrome):
        args = ["open", "-na", "Google Chrome", "--args"] + (["--kiosk"] if kiosk else []) + [url]
    else:
        args = ["open", url]
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    ap = argparse.ArgumentParser(description="コード進行ゲームを配る（実機の盤へのつなぎ付き）")
    ap.add_argument("--port", type=int, default=8800, help="ゲームを配るポート（標準 8800）")
    ap.add_argument("--bridge-port", type=int, default=8765, help="ブリッジの画面のポート（標準 8765）")
    ap.add_argument("--open", action="store_true", help="Chrome で開く")
    ap.add_argument("--kiosk", action="store_true", help="全画面で開く（展示用。--open と一緒に）")
    ap.add_argument("--lan", action="store_true", help="同じ Wi-Fi のスマホ・タブレットからも開けるようにする（ゲームのファイルだけ。実機の盤は、使えない）")
    args = ap.parse_args()
    try:
        srv = make_server(args.port, args.bridge_port, lan=args.lan)
    except OSError as e:
        print("ポート %d を使えません（すでに動いている？）: %s" % (args.port, e))
        print("  別のポートで:  python3 tools/game_server.py --port 8801")
        return 1
    url = "http://127.0.0.1:%d/" % args.port
    print("ゲームを配っています:  %s" % url)
    print("  実機の盤: ブリッジ（127.0.0.1:%d）が動いていれば、自動でつながります。止めるには Ctrl+C" % args.bridge_port)
    if args.lan:
        addrs = lan_addresses()
        print("")
        print("スマホで遊ぶとき（同じ Wi-Fi につないで、Safari・Chrome で、次の URL を開く）:")
        if addrs:
            for ip in addrs:
                print("    http://%s:%d/" % (ip, args.port))
        else:
            print("    （このパソコンの LAN の住所が見つかりません。Wi-Fi につながっているか、確認してください）")
        print("  ※ スマホでは、画面の盤で遊びます（実機の盤は、このパソコンのブラウザだけ）。Mac の「ファイアウォール」が、受信を止めていたら、許可してください")
        print("  ※ 家の中の Wi-Fi だけ。外には、公開していません。使い終わったら Ctrl+C で止める")
    if args.open:
        threading.Timer(0.6, open_browser, args=(url, args.kiosk)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
