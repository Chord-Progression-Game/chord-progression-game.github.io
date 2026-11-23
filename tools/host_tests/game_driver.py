# -*- coding: utf-8 -*-
"""ゲームのページを、本物の Chrome で操作する道具（テストと、見た目の確認の両方が使う）。"""
import os
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession  # noqa: E402,F401


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=os.path.join(ROOT, "game")))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def center(ch, selector):
    return ch.eval("(() => { const e = document.querySelector(%r); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()" % selector)


def drag(ch, x0, y0, x1, y1, steps=14, hold=0.0, modifiers=0):
    ch.mouse("mouseMoved", x0, y0, 0, modifiers)
    ch.mouse("mousePressed", x0, y0, 1, modifiers)
    for i in range(1, steps + 1):
        t = i / steps
        ch.mouse("mouseMoved", x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1, modifiers)
        time.sleep(0.012)
    if hold:
        time.sleep(hold)
    ch.mouse("mouseReleased", x1, y1, 0, modifiers)


def slot_xy(ch, slot):
    return ch.eval("(() => { const p = __app.scene.slotToScreen(%d, 0.4); return [p.x, p.y]; })()" % slot)


def drag_piece_to_slot(ch, name, slot):
    cid = ch.eval("__app.table.byName(%r).id" % name)
    x0, y0 = center(ch, '.pc[data-id="%d"]' % cid)
    x1, y1 = slot_xy(ch, slot)
    drag(ch, x0, y0, x1, y1)


def move_board_piece(ch, from_slot, to_xy):
    x0, y0 = slot_xy(ch, from_slot)
    drag(ch, x0, y0, to_xy[0], to_xy[1])


def click(ch, x, y, modifiers=0):
    ch.mouse("mouseMoved", x, y, 0, modifiers)
    ch.mouse("mousePressed", x, y, 1, modifiers)
    ch.mouse("mouseReleased", x, y, 0, modifiers)


def open_game(ch, port, audio=False, state="title"):
    ch.open("http://127.0.0.1:%d/index.html" % port)
    ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
    if audio:
        ch.eval("__app.begin(true).then(() => true)")
    else:
        ch.eval("__app.begin(false).then(() => true)")
    ch.wait_for("__app.state === %r" % state, timeout=90)
