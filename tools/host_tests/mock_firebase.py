# -*- coding: utf-8 -*-
"""
Firebase Realtime Database の「にせもの」（テスト用）。本物とつながなくても、公開ページへ送る・受け取る道（tools/cloud_sync.py → game/js/net/cloud.js）を、確かめるため。
本物の REST の、使うところだけを、まねている:
  ・PUT /パス.json?auth=秘密  … 書きこむ（秘密が合わなければ 401）。DELETE も同じ
  ・GET /パス.json            … 読む（だれでも。ないときは null）
  ・GET /パス.json（Accept: text/event-stream）… つなぎっぱなしで、変わるたびに  event: put / data: {"path":"/","data":…}  を流す。keep-alive も流す
  ・POST /token                … Google の OAuth2 のまね。サービスアカウントの JWT（RS256 の署名つき）を、公開鍵（token_pubkey）で確かめて、アクセス トークンを返す。
                                 そのトークンを ?access_token= に付けた書きこみも、受けつける
  ・どの応答にも Access-Control-Allow-Origin: *（ブラウザの EventSource・fetch が読めるように）。OPTIONS（下見）にも答える
※ 本物の Firebase ではない。本物との違い（遅れ・再接続・ルール）は、ここでは、確かめられない。
"""
import base64
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MockFirebase(object):
    def __init__(self, secret="TESTSECRET", keepalive=1.0, token_pubkey=None):
        self.secret = secret
        self.token_pubkey = token_pubkey        # サービスアカウントの公開鍵（PEM の文字）。あれば、/token が使える
        self.tokens = set()
        self.token_requests = 0
        self.keepalive = keepalive
        self.data = {}                      # パス（'/' なし）→ 値
        self.cond = threading.Condition()
        self.version = 0
        self.puts = []                      # (時刻, パス) 書きこみの記録
        self.fail_puts = 0                  # 正の数なら、その回数だけ、書きこみを 503 で、ことわる（失敗のテスト用）
        self.stream_clients = 0
        mock = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

            def _path(self):
                p = urllib.parse.urlparse(self.path)
                path = p.path.strip("/")
                if path.endswith(".json"):
                    path = path[:-5]
                return path, urllib.parse.parse_qs(p.query)

            def _send(self, code, obj):
                body = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._cors()
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                self.send_response(204)
                self._cors()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                path, q = self._path()
                if "text/event-stream" in (self.headers.get("Accept") or ""):
                    return self._stream(path)
                with mock.cond:
                    val = mock.data.get(path)
                self._send(200, val)

            def _stream(self, path):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self._cors()
                self.end_headers()
                with mock.cond:
                    mock.stream_clients += 1
                    seen = -1
                try:
                    while True:
                        with mock.cond:
                            if mock.version == seen:
                                mock.cond.wait(timeout=mock.keepalive)
                            changed = mock.version != seen
                            seen = mock.version
                            val = mock.data.get(path)
                        if changed:
                            self.wfile.write(("event: put\ndata: " + json.dumps({"path": "/", "data": val}) + "\n\n").encode("utf-8"))
                        else:
                            self.wfile.write(b"event: keep-alive\ndata: null\n\n")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    with mock.cond:
                        mock.stream_clients -= 1

            def do_POST(self):
                if not self.path.split("?")[0].endswith("/token"):
                    return self._send(404, {"error": "not found"})
                size = int(self.headers.get("Content-Length") or 0)
                form = urllib.parse.parse_qs(self.rfile.read(size).decode("utf-8"))
                mock.token_requests += 1
                jwt = (form.get("assertion") or [""])[0]
                if (form.get("grant_type") or [""])[0] != "urn:ietf:params:oauth:grant-type:jwt-bearer" or not mock.token_pubkey or not mock._verify_jwt(jwt, "http://127.0.0.1:%d/token" % mock.port):
                    return self._send(400, {"error": "invalid_grant"})
                with mock.cond:
                    tok = "TOKEN-%d" % (len(mock.tokens) + 1)
                    mock.tokens.add(tok)
                self._send(200, {"access_token": tok, "expires_in": 3600, "token_type": "Bearer"})

            def _write(self, delete=False):
                path, q = self._path()
                ok = (q.get("auth") or [""])[0] == mock.secret or (q.get("access_token") or [""])[0] in mock.tokens
                if not ok:
                    return self._send(401, {"error": "Permission denied"})
                if mock.fail_puts > 0:
                    mock.fail_puts -= 1
                    return self._send(503, {"error": "unavailable"})
                size = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(size).decode("utf-8") if size else "null"
                try:
                    val = None if delete else json.loads(body)
                except ValueError:
                    return self._send(400, {"error": "bad json"})
                with mock.cond:
                    if val is None:
                        mock.data.pop(path, None)
                    else:
                        mock.data[path] = val
                    mock.version += 1
                    mock.puts.append((time.time(), path))
                    mock.cond.notify_all()
                self._send(200, val)

            def do_PUT(self):
                self._write()

            def do_DELETE(self):
                self._write(delete=True)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.url = "http://127.0.0.1:%d" % self.port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def _verify_jwt(self, jwt, aud):
        """ RS256 の署名を、公開鍵で確かめる（openssl）。署名・iss・aud・期限が、正しければ True """
        try:
            head, claim, sig = jwt.split(".")
            pad = lambda x: x + "=" * (-len(x) % 4)  # noqa: E731
            c = json.loads(base64.urlsafe_b64decode(pad(claim)).decode("utf-8"))
            if c.get("aud") != aud or not str(c.get("iss", "")).endswith(".iam.gserviceaccount.com") or c.get("exp", 0) < time.time() or "firebase.database" not in c.get("scope", ""):
                return False
            d = tempfile.mkdtemp()
            with open(os.path.join(d, "pub.pem"), "w") as f:
                f.write(self.token_pubkey)
            with open(os.path.join(d, "sig.bin"), "wb") as f:
                f.write(base64.urlsafe_b64decode(pad(sig)))
            r = subprocess.run(["openssl", "dgst", "-sha256", "-verify", os.path.join(d, "pub.pem"), "-signature", os.path.join(d, "sig.bin")], input=(head + "." + claim).encode("ascii"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            return r.returncode == 0
        except Exception:  # noqa: BLE001
            return False

    def value(self, path):
        with self.cond:
            return self.data.get(path)

    def set_value(self, path, val):
        """ ブリッジを通さずに、直接書く（ほかの端末の変更を、まねるため）"""
        with self.cond:
            self.data[path] = val
            self.version += 1
            self.cond.notify_all()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
