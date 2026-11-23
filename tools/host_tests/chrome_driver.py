# -*- coding: utf-8 -*-
"""
本物の Chrome（ヘッドレス）を、実際の時間で動かして、ページを操作する道具（標準の python3 だけで動く）。
  ・ゲームのテスト（test_game_js.py）と、見た目の確認（スクリーンショット）に使う
  ・cdp_lite.py（DevTools プロトコルの最小のクライアント）の上に作ってある
  使い方:
      with ChromeSession(width=1280, height=720) as ch:
          ch.open("http://127.0.0.1:8800/")
          ch.wait_for("window.__ready === true", timeout=30)
          print(ch.eval("document.title"))
          ch.screenshot("/tmp/x.png")
"""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

from cdp_lite import Cdp

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def chrome_available():
    return os.path.exists(CHROME)


class ChromeSession:
    def __init__(self, width=1280, height=720, gpu=True, extra_args=None, mobile=False, dpr=1, touch=False, ua=None):
        self.mobile, self.dpr, self.touch, self.ua = mobile, dpr, touch, ua       # スマホの見え方（iPhone など）を、本物の Chrome で再現する: mobile=True で、画面の幅の決め方がスマホ式に
        self.width, self.height = width, height
        self.gpu = gpu
        self.extra = extra_args or []
        self.proc = None
        self.cdp = None
        self.profile = None

    def __enter__(self):
        self.profile = tempfile.mkdtemp()
        args = [CHROME, "--headless=new", "--no-first-run", "--user-data-dir=" + self.profile, "--remote-debugging-port=0",
                "--autoplay-policy=no-user-gesture-required", "--window-size=%d,%d" % (self.width, self.height),
                "--hide-scrollbars", "--mute-audio" if False else "--no-default-browser-check"]
        if not self.gpu:
            args += ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        args += self.extra + ["about:blank"]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port = None
        for _ in range(100):
            try:
                port = int(open(os.path.join(self.profile, "DevToolsActivePort")).read().split("\n")[0])
                break
            except (OSError, ValueError):
                time.sleep(0.1)
        if port is None:
            raise RuntimeError("Chrome の DevTools のポートが分かりません")
        targets = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % port, timeout=5).read().decode())
        page = [t for t in targets if t.get("type") == "page"][0]
        self.cdp = Cdp(page["webSocketDebuggerUrl"])
        self.cdp.call("Page.enable")
        self.cdp.call("Runtime.enable")
        self.cdp.call("Emulation.setDeviceMetricsOverride", {"width": self.width, "height": self.height, "deviceScaleFactor": self.dpr, "mobile": bool(self.mobile)})
        if self.touch:
            self.cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if self.ua:
            self.cdp.call("Emulation.setUserAgentOverride", {"userAgent": self.ua})
        return self

    def __exit__(self, *exc):
        try:
            if self.cdp:
                self.cdp.call("Browser.close")
        except Exception:
            pass
        if self.proc:
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.profile:
            shutil.rmtree(self.profile, ignore_errors=True)

    def open(self, url):
        self.cdp.call("Page.navigate", {"url": url})

    def eval(self, expr):
        r = self.cdp.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError("ページの中で例外: " + (d.get("exception", {}).get("description") or d.get("text", "")))
        return r.get("result", {}).get("value")

    def wait_for(self, expr, timeout=30, interval=0.1):
        end = time.time() + timeout
        last = None
        while time.time() < end:
            try:
                last = self.eval(expr)
                if last:
                    return last
            except RuntimeError as e:
                last = str(e)
            time.sleep(interval)
        raise TimeoutError("待っても、条件が成立しませんでした: %s（最後の値: %s）" % (expr, last))

    def screenshot(self, path):
        r = self.cdp.call("Page.captureScreenshot", {"format": "png"})
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return path

    def click(self, x, y):
        for t in ("mousePressed", "mouseReleased"):
            self.cdp.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": "left", "clickCount": 1})

    def mouse(self, kind, x, y, buttons=1, modifiers=0):
        """ modifiers: Alt=1・Ctrl=2・Meta(⌘)=4・Shift=8（足し合わせる）"""
        self.cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "buttons": buttons, "clickCount": 1, "modifiers": modifiers})

    # ---- 指（タッチ）----
    def touch_event(self, kind, points):
        """ kind: touchStart / touchMove / touchEnd / touchCancel。points: [(x, y), ...] """
        pts = [{"x": x, "y": y, "id": i, "radiusX": 8, "radiusY": 8, "force": 1} for i, (x, y) in enumerate(points)]
        self.cdp.call("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts if kind != "touchEnd" else []})

    def tap(self, x, y):
        self.touch_event("touchStart", [(x, y)])
        self.touch_event("touchEnd", [])

    def touch_drag(self, x0, y0, x1, y1, steps=12, hold=0.0):
        import time as _t
        self.touch_event("touchStart", [(x0, y0)])
        if hold:
            _t.sleep(hold)
        for i in range(1, steps + 1):
            t = i / steps
            self.touch_event("touchMove", [(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)])
            _t.sleep(0.012)
        self.touch_event("touchEnd", [])

    def key(self, key, code=None, modifiers=0):
        """ modifiers: Alt=1・Ctrl=2・Meta(⌘)=4・Shift=8（足し合わせる）。例: ch.key("a", "KeyA", 2) = Ctrl+A """
        self.cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": key, "code": code or key, "modifiers": modifiers})
        self.cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code or key, "modifiers": modifiers})
