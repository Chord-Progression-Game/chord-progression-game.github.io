import sys, threading, os, time
sys.path.insert(0, 'tools/host_tests')
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from chrome_driver import ChromeSession
class Q(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
def shoot(page, out, w=1280, h=720, wait=1.2, actions=None):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Q, directory='game')); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with ChromeSession(width=w, height=h) as ch:
            ch.open('http://127.0.0.1:%d/%s' % (port, page))
            ch.wait_for('window.__ready === true && window.__frames > 20', timeout=60)
            if actions: actions(ch)
            time.sleep(wait)
            ch.screenshot(out)
    finally:
        srv.shutdown()
if __name__ == '__main__':
    shoot(sys.argv[1], sys.argv[2])
