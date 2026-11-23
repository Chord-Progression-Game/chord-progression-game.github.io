# -*- coding: utf-8 -*-
"""
Chrome（ヘッドレス）を DevTools プロトコル（websocket）で操作する、必要最小限の部品（標準の python3 だけで動く）。
  使い方: Chrome を --remote-debugging-port=0 で起動 → プロファイルの DevToolsActivePort から番号を読む →
          http://127.0.0.1:番号/json で、ページの webSocketDebuggerUrl を得る → Cdp(その URL)
  test_ui_realtime.py（パソコン上のテスト）と、tools/device_tests/indicator_lag.py（実機）が使う
"""
import base64
import json
import os
import socket
import struct


class Cdp:
    """ DevTools プロトコルの、必要最小限の websocket クライアント """

    def __init__(self, ws_url):
        assert ws_url.startswith("ws://")
        hostport, _, path = ws_url[5:].partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        head, _, self.rest = buf.partition(b"\r\n\r\n")
        assert b" 101 " in head.split(b"\r\n")[0], head
        self.next_id = 0

    def _recv_exact(self, n):
        out = b""
        while len(out) < n:
            if self.rest:
                take = self.rest[:n - len(out)]
                self.rest = self.rest[len(take):]
                out += take
                continue
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            self.rest = chunk
        return out

    def _read_message(self):
        data = b""
        while True:
            b0, b1 = self._recv_exact(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            payload = self._recv_exact(n)
            if opcode in (1, 0):
                data += payload
                if fin:
                    return data.decode("utf-8")
            elif opcode == 8:
                raise ConnectionError("websocket closed")

    def call(self, method, params=None):
        self.next_id += 1
        mid = self.next_id
        payload = json.dumps({"id": mid, "method": method, "params": params or {}}).encode()
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536
                                 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        while True:
            msg = json.loads(self._read_message())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def eval(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": False})
        return r.get("result", {}).get("value")
