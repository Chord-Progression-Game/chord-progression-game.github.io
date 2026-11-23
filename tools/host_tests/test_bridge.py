#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
midi_bridge.py のテスト（本物の ESP32 は使わない）
  1. 文字 → MIDI の変換（parse_bridge_line / split_messages）
  2. 通しのテスト: 疑似的な ESP32（pty）につないで、仮想MIDIポートから出る MIDI を、別のプログラムで受け取って確かめる
実行:  tools/.venv/bin/python tools/host_tests/test_bridge.py
"""
import os
import pty
import queue
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
import midi_bridge as mb  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


# ---------------------------------------------------------------------------
# 1. 変換
# ---------------------------------------------------------------------------
check("通常の行はNone", mb.parse_bridge_line("RC522 version: 0x92"), None)
check("日本語の行はNone", mb.parse_bridge_line("▶ ステップ1/4  位置1: Ⅰ"), None)
check("和音ON", mb.parse_bridge_line("~M 90 30 50 90 34 50 90 37 50 90 3C 50 "),
      [0x90, 0x30, 0x50, 0x90, 0x34, 0x50, 0x90, 0x37, 0x50, 0x90, 0x3C, 0x50])
check("小文字の16進数も読める", mb.parse_bridge_line("~M 9a 3c 7f "), [0x9A, 0x3C, 0x7F])
check("空のメッセージ", mb.parse_bridge_line("~M "), [])
try:
    mb.parse_bridge_line("~M 90 ZZ 50")
    check("16進数でなければ例外", True, False)
except ValueError:
    check("16進数でなければ例外", True, True)

chord_on = [0x90, 48, 80, 0x90, 52, 80, 0x90, 55, 80, 0x90, 60, 80]
check("和音ONを4つに分ける", mb.split_messages(chord_on), [[0x90, 48, 80], [0x90, 52, 80], [0x90, 55, 80], [0x90, 60, 80]])
check("プログラムチェンジは2バイト", mb.split_messages([0xC0, 0]), [[0xC0, 0]])
check("All Notes Off", mb.split_messages([0xB0, 123, 0]), [[0xB0, 123, 0]])
check("ノートオフ", mb.split_messages([0x80, 48, 0]), [[0x80, 48, 0]])
check("途切れたメッセージは捨てる", mb.split_messages([0x90, 48, 80, 0x90, 52]), [[0x90, 48, 80]])
check("状態バイトのないデータは捨てる", mb.split_messages([48, 80]), [])
check("プログラムチェンジのあとに和音", mb.split_messages([0xC0, 0, 0x90, 60, 80]), [[0xC0, 0], [0x90, 60, 80]])
check("空", mb.split_messages([]), [])
try:
    mb.split_messages([300])
    check("範囲外のバイトは例外", True, False)
except ValueError:
    check("範囲外のバイトは例外", True, True)
# ESP32 側(C++)が作る行と、同じ形式であること（test_midi_protocol.cpp の期待値と同じ文字列）
check("C++側の和音ONの行", mb.split_messages(mb.parse_bridge_line("~M 90 30 50 90 34 50 90 37 50 90 3C 50 ")),
      [[0x90, 0x30, 0x50], [0x90, 0x34, 0x50], [0x90, 0x37, 0x50], [0x90, 0x3C, 0x50]])


# ---- ドラム（チャンネル10）の送り先 ----
mixed = [[0x90, 48, 80], [0x99, 36, 100], [0x89, 36, 0], [0xC0, 0], [0xB9, 123, 0]]
check("merge: 全部ふつうのポート", mb.route_messages(mixed, "merge"), [(0, m) for m in mixed])
check("split: チャンネル10 だけドラムのポート", mb.route_messages(mixed, "split"),
      [(0, [0x90, 48, 80]), (1, [0x99, 36, 100]), (1, [0x89, 36, 0]), (0, [0xC0, 0]), (1, [0xB9, 123, 0])])
check("off: チャンネル10 は捨てる", mb.route_messages(mixed, "off"), [(0, [0x90, 48, 80]), (0, [0xC0, 0])])
check("PANIC は ch1 と ch10", mb.PANIC_MESSAGES, [[0xB0, 123, 0], [0xB9, 123, 0]])

# ---- ファイルのコマンド（!load）----
check("コメントと空行は飛ばす", mb.parse_command_file("# メモ\n\nDRUM COPY 2 11\n  DRUM SET 11 K x...x...x...x...  \n#あとで\nBACKING 6\n"),
      ["DRUM COPY 2 11", "DRUM SET 11 K x...x...x...x...", "BACKING 6"])
check("空のファイル", mb.parse_command_file(""), [])
check("Windows の改行", mb.parse_command_file("BPM 100\r\nKEY D\r\n"), ["BPM 100", "KEY D"])

# ---- 1文字ずつの入力（LineEditor）----
def feed_all(editor, text):
    events = []
    for ch in text:
        events += editor.feed(ch)
    return events

ed = mb.LineEditor()
check("行の最初の + は、すぐ送る", ed.feed("+"), [("key", "+")])
check("行の最初の ] [ - も", [ed.feed(c) for c in "][-"], [[("key", "]")], [("key", "[")], [("key", "-")]])
check("行の途中の + は、ふつうの文字", feed_all(ed, "KEY +1"),
      [("echo", c) for c in "KEY +1"])
check("Enter で1行になる", ed.feed("\r"), [("line", "KEY +1")])
check("Enter のあとは、また最初の1文字", ed.feed("+"), [("key", "+")])
check("Enter だけの空行", ed.feed("\n"), [("line", "")])
ed = mb.LineEditor()
feed_all(ed, "BPM 9")
check("バックスペースで1文字消す", ed.feed("\x7f"), [("erase", 1)])
feed_all(ed, "8")
check("消したあとの行（9 を消して 8 を打った）", ed.feed("\r"), [("line", "BPM 8")])
check("空のときのバックスペースは何もしない", ed.feed("\x7f"), [])
feed_all(ed, "DRUM NAME 11 あい")
check("全角文字は2桁ぶん消す", ed.feed("\x7f"), [("erase", 2)])
check("Ctrl+U で行を消す（桁数ぶん）", ed.feed("\x15"), [("erase", len("DRUM NAME 11 ") + 2)])
check("行が空のとき Ctrl+D で終了", ed.feed("\x04"), [("quit",)])
feed_all(ed, "A")
check("行があるとき Ctrl+D は無視", ed.feed("\x04"), [])
ed = mb.LineEditor()
check("矢印キー（ESC [ A）は読み捨てる", feed_all(ed, "\x1b[A"), [])
check("矢印キーのあとも、ふつうに入力できる", feed_all(ed, "ab"), [("echo", "a"), ("echo", "b")])
check("その他の制御文字は無視", ed.feed("\x01"), [])
check("日本語の入力", feed_all(mb.LineEditor(), "あ"), [("echo", "あ")])
check("全角は2桁", mb.char_width("あ"), 2)
check("半角は1桁", mb.char_width("a"), 1)

# ---------------------------------------------------------------------------
# 2. 通しのテスト（疑似ESP32 → ブリッジ → 仮想MIDIポート → 受信側）
# ---------------------------------------------------------------------------
import rtmidi  # noqa: E402

VPORT = "ESP32 Chord Prototype (host test)"
master, slave = pty.openpty()
slave_path = os.ttyname(slave)

received = queue.Queue()
midi_in = rtmidi.MidiIn()
midi_in.ignore_types(sysex=True, timing=True, active_sense=True)

proc = subprocess.Popen(
    [sys.executable, os.path.join(TOOLS, "midi_bridge.py"), "--port", slave_path, "--name", VPORT, "--ui-port", "0"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)


def read_master(timeout, keep_ping=False):
    """ 疑似ESP32 が受け取った文字（ブリッジが送ってきたコマンド）を、timeout 秒まで集める。
        PING（ブリッジが約1秒ごとに送る「つながっています」の合図）は除く（keep_ping=True なら残す） """
    import select
    data = b""
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            data += os.read(master, 4096)
    text = data.decode("utf-8", errors="replace")
    return text if keep_ping else text.replace("PING\n", "")


try:
    # 仮想ポートができるのを待って、受信側をつなぐ
    idx = None
    for _ in range(100):
        ports = midi_in.get_ports()
        for i, name in enumerate(ports):
            if VPORT in name:
                idx = i
        if idx is not None:
            break
        time.sleep(0.05)
    check("仮想MIDIポートができた", idx is not None, True)
    midi_in.open_port(idx)
    midi_in.set_callback(lambda ev, data=None: received.put((time.time(), ev[0])))
    time.sleep(0.3)

    # ESP32 が起動した（[READY]）→ ブリッジが「MIDI BRIDGE」を頼んでくる
    os.write(master, "Hello ESP32!\r\nリーダー1 (SS=GPIO10, RST=GPIO5): RC522 version: 0x92\r\n[READY]\r\n".encode("utf-8"))
    cmds = read_master(1.0)
    check("起動の合図で MIDI BRIDGE を頼む", "MIDI BRIDGE" in cmds, True)

    # 和音ON → 和音OFF を送る（ESP32 が作る行と同じ形式）
    t0 = time.time()
    os.write(master, b"~M 90 30 50 90 34 50 90 37 50 90 3C 50 \n")
    time.sleep(0.2)
    os.write(master, b"~M 80 30 00 80 34 00 80 37 00 80 3C 00 \n")
    time.sleep(0.4)
    msgs = []
    while not received.empty():
        msgs.append(received.get())
    check("受け取った MIDI の数（ON4 + OFF4）", len(msgs), 8)
    check("和音ONの音", [m[1] for m in msgs[:4]], [[0x90, 0x30, 0x50], [0x90, 0x34, 0x50], [0x90, 0x37, 0x50], [0x90, 0x3C, 0x50]])
    check("和音OFFの音", [m[1] for m in msgs[4:]], [[0x80, 0x30, 0], [0x80, 0x34, 0], [0x80, 0x37, 0], [0x80, 0x3C, 0]])
    if len(msgs) == 8:
        check("和音の4音は、ほぼ同時（5ms以内）", (msgs[3][0] - msgs[0][0]) < 0.005, True)

    # 届くまでの遅れ: 送ってから MIDI が出るまで、すぐ（20ms以内）であること。
    # （シリアルを「512バイト溜まるまで」待って読むと、最大50msも遅れて、音のタイミングがずれる）
    lat = []
    for _ in range(8):
        while not received.empty():
            received.get()
        t_send = time.time()
        os.write(master, b"~M 90 3C 50 \n")
        try:
            t_recv, _msg = received.get(timeout=1.0)
            lat.append(t_recv - t_send)
        except queue.Empty:
            lat.append(9.9)
        time.sleep(0.13)
    check("ブリッジの遅れは 20ms 以内（最大 %.1f ms）" % (max(lat) * 1000), max(lat) < 0.020, True)
    while not received.empty():
        received.get()

    # 日本語の行は、MIDIにならない（画面に出るだけ）
    os.write(master, "▶ ステップ1/4  位置1: Ⅰ   Key=C: C\r\n".encode("utf-8"))
    time.sleep(0.3)
    check("日本語の行はMIDIにならない", received.empty(), True)

    # 途中で切れた行・壊れた行でも、止まらない
    os.write(master, b"~M 90 3\n")
    os.write(master, b"~M 90 ZZ 50\n")
    os.write(master, b"~M 90 3C 50 \n")
    time.sleep(0.3)
    got = []
    while not received.empty():
        got.append(received.get()[1])
    check("壊れた行のあとも、次の行は処理される", got[-1] if got else None, [0x90, 0x3C, 0x50])

    # ブリッジに打った文字が、ESP32 に届く
    proc.stdin.write("BPM 90\n".encode("utf-8"))
    proc.stdin.flush()
    cmds = read_master(0.8)
    check("打った BPM 90 が ESP32 に届く", "BPM 90" in cmds, True)
    proc.stdin.write("!panic\n".encode("utf-8"))
    proc.stdin.flush()
    time.sleep(0.3)
    got = []
    while not received.empty():
        got.append(received.get()[1])
    check("!panic で All Notes Off（ピアノ ch1 と ドラム ch10）", got, [[0xB0, 123, 0], [0xB9, 123, 0]])
    check("!panic は ESP32 には送らない", "!panic" not in read_master(0.3), True)

    # 終了: STOP と MIDI OFF を ESP32 に送り、All Notes Off を出す
    proc.send_signal(signal.SIGINT)
    cmds = read_master(1.5)
    check("終了時に STOP を送る", "STOP" in cmds, True)
    check("終了時に MIDI OFF を送る", "MIDI OFF" in cmds, True)
    time.sleep(0.3)
    got = []
    while not received.empty():
        got.append(received.get()[1])
    check("終了時に All Notes Off", [0xB0, 123, 0] in got, True)
    proc.wait(timeout=5)
    check("正常に終了する", proc.returncode, 0)
finally:
    if proc.poll() is None:
        proc.kill()
    midi_in.close_port()
    out = proc.stdout.read().decode("utf-8", errors="replace") if proc.stdout else ""
    if "Traceback" in out:
        fails += 1
        print("FAIL ブリッジが例外で止まった:\n" + out)


# ---------------------------------------------------------------------------
# 3. 追加の通しテスト（!load / 端末の1文字入力 / --drums）
# ---------------------------------------------------------------------------
import select  # noqa: E402
import tempfile  # noqa: E402


class FakeBoard(object):
    """ 疑似ESP32 のシリアル(pty) と、ブリッジのプロセス """

    def __init__(self, name, extra_args=(), tty_stdin=False):
        self.master, slave = pty.openpty()
        self.name = name
        if tty_stdin:
            self.stdin_master, stdin_slave = pty.openpty()
            stdin = stdin_slave
        else:
            self.stdin_master = None
            stdin = subprocess.PIPE
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(TOOLS, "midi_bridge.py"), "--port", os.ttyname(slave), "--name", name, "--ui-port", "0"] + list(extra_args),
            stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        self.out = b""
        self.pings = 0
        self.tty_stdin = tty_stdin

    def read_serial(self, timeout, keep_ping=False):
        """ 疑似ESP32 が受け取った文字を、timeout 秒まで集める。
            PING（ブリッジが約1秒ごとに送る「つながっています」の合図）は、集めた文字から除く（keep_ping=True なら残す）。除いた数は self.pings に足す """
        data = b""
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.master], [], [], 0.05)
            if r:
                data += os.read(self.master, 4096)
        text = data.decode("utf-8", errors="replace")
        if keep_ping:
            return text
        self.pings += text.count("PING\n")
        return text.replace("PING\n", "")

    def read_screen(self, timeout):
        """ ブリッジの画面（標準出力）に出た文字を集める """
        end = time.time() + timeout
        fd = self.proc.stdout.fileno()
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                chunk = os.read(fd, 4096)
                if not chunk:
                    break
                self.out += chunk
        return self.out.decode("utf-8", errors="replace")

    def wait_ready(self):
        """ ブリッジの起動を待ち、ESP32 の起動の合図([READY])を送って、ブリッジが頼んでくる MIDI BRIDGE を読み捨てる """
        end = time.time() + 5
        while time.time() < end:
            if "-" * 60 in self.read_screen(0.1):
                time.sleep(0.3)  # 端末の設定が終わるのを待つ
                os.write(self.master, b"[READY]\r\n")
                requested = self.read_serial(0.8)
                return "MIDI BRIDGE" in requested
        return False

    def type(self, text):
        if self.tty_stdin:
            os.write(self.stdin_master, text.encode("utf-8"))
        else:
            self.proc.stdin.write(text.encode("utf-8"))
            self.proc.stdin.flush()

    def close(self):
        if self.proc.poll() is None:
            self.proc.send_signal(signal.SIGINT)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.read_screen(0.2)
        text = self.out.decode("utf-8", errors="replace")
        if "Traceback" in text:
            global fails
            fails += 1
            print("FAIL ブリッジが例外で止まった:\n" + text)


# ---- 端末の1文字入力: + - ] [ は Enter なしで届く ----
fb = FakeBoard("BridgeTestTty", tty_stdin=True)
try:
    check("端末入力: 起動した", fb.wait_ready(), True)
    fb.type("+")
    got = fb.read_serial(0.5)
    check("端末入力: + は Enter なしで届く（改行なし）", got, "+")
    fb.type("]")
    check("端末入力: ] も", fb.read_serial(0.4), "]")
    fb.type("BPM 90\r")
    check("端末入力: 打った行は Enter で届く", fb.read_serial(0.6), "BPM 90\n")
    fb.type("KEY +1\r")
    check("端末入力: 行の途中の + は、ふつうの文字", fb.read_serial(0.6), "KEY +1\n")
    fb.type("BPM 9\x7f8\r")
    check("端末入力: バックスペースで直せる", fb.read_serial(0.6), "BPM 8\n")
    fb.type("\x1b[A\x1b[BSTATUS\r")
    check("端末入力: 矢印キーは送らない", fb.read_serial(0.6), "STATUS\n")
    fb.type("DRUM NAME 11 マイ・ビート\r")
    check("端末入力: 日本語も届く", fb.read_serial(0.6), "DRUM NAME 11 マイ・ビート\n")
    fb.type("-")
    check("端末入力: - も Enter なし", fb.read_serial(0.4), "-")
    fb.type("-5\r")
    # 行の最初の - は、すぐ送られる。そのあとの 5 は、Enter で1行になる（なので、BPM -5 は「BPM」から打つ）
    check("端末入力: 行の最初の - は即送られ、5 は行になる", fb.read_serial(0.6), "-5\n")
    fb.type("!bogus\r")
    check("端末入力: 知らない ! コマンドは ESP32 に送らない", "!bogus" not in fb.read_serial(0.4), True)
    check("端末入力: 知らない ! コマンドの案内", "ブリッジのコマンドではありません" in fb.read_screen(0.4), True)
    # 打ちかけの文字があるとき、ESP32 の表示が来ても、打ちかけの文字は消えない
    fb.type("BPM 1")
    time.sleep(0.2)
    os.write(fb.master, "▶ ステップ2/4  位置2: Ⅵm\r\n".encode("utf-8"))
    screen = fb.read_screen(0.5)
    check("端末入力: ESP32 の表示が来ても、打ちかけの文字を表示し直す", screen.endswith("BPM 1"), True)
    fb.type("\x15")  # Ctrl+U: 行を消す
    fb.type("\x04")  # Ctrl+D: 終了
    fb.proc.wait(timeout=5)
    check("端末入力: Ctrl+D で正常に終了", fb.proc.returncode, 0)
finally:
    fb.close()

# ---- !load: ファイルのコマンドを、順に ESP32 に送る ----
with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
    f.write("# テスト用のパターン\nDRUM COPY 2 11\n\nDRUM SET 11 K x...x...x...x...\n# コメント\nDRUM NAME 11 マイ・ビート\n")
    load_path = f.name
fb = FakeBoard("BridgeTestLoad")
try:
    check("!load: 起動した", fb.wait_ready(), True)
    fb.type("!load " + load_path + "\n")
    got = fb.read_serial(2.0)
    check("!load: 3行が順に届く（コメント・空行は送らない）", got, "DRUM COPY 2 11\nDRUM SET 11 K x...x...x...x...\nDRUM NAME 11 マイ・ビート\n")
    check("!load: 送った行を画面に出す", "> DRUM SET 11 K x...x...x...x..." in fb.read_screen(0.3), True)
    fb.type("!load /no/such/file.txt\n")
    got = fb.read_serial(0.4)
    check("!load: ファイルがなければ何も送らない", got, "")
    check("!load: ファイルがない案内", "見つかりません" in fb.read_screen(0.4), True)
    fb.type("!load\n")
    check("!load: 引数なしは使い方", "使い方: !load" in fb.read_screen(0.4), True)
    # tools/patterns/ の中のファイルは、名前だけで読める
    fb.type("!load example_patterns.txt\n")
    got = fb.read_serial(3.0)
    check("!load: tools/patterns/ のサンプルが読める", "DRUM COPY 2 11" in got, True)
finally:
    fb.close()
    os.unlink(load_path)

# ---- リズム編集画面: ブラウザから届いたパターンが、ESP32 にコマンドとして届く ----
import json as _json  # noqa: E402
import re as _re  # noqa: E402
import urllib.request as _urlreq  # noqa: E402
fb = FakeBoard("BridgeTestUi")
try:
    check("編集画面: 起動した", fb.wait_ready(), True)
    m = _re.search(r"(http://127\.0\.0\.1:\d+)/(?=\s)", fb.read_screen(0.3))
    check("編集画面: URL が表示される", m is not None, True)
    if m:
        body = _json.dumps({"kind": "drum", "slot": 13, "name": "テスト", "length": 8, "select": True,
                            "lanes": {"K": "x...x...", "H": "x.x.x.x."}}).encode("utf-8")
        rq = _urlreq.Request(m.group(1) + "/api/save", data=body, method="POST", headers={"Content-Type": "application/json"})
        with _urlreq.urlopen(rq, timeout=5) as resp:
            check("編集画面: 保存の依頼が受け付けられる", _json.loads(resp.read())["ok"], True)
        got = fb.read_serial(3.0)
        check("編集画面: ESP32 にコマンドが順に届く", got, "DRUM CLEAR 13\nDRUM LEN 13 8\nDRUM SET 13 K x...x...\nDRUM SET 13 H x.x.x.x.\nDRUM NAME 13 テスト\nDRUM 13\n")
        check("編集画面: 送ったコマンドが画面に出る", "> DRUM SET 13 K x...x..." in fb.read_screen(0.3), True)
finally:
    fb.close()

# ---- 操作画面: 状態の読み取りと、リアルタイムの操作 ----
fb = FakeBoard("BridgeTestControl")
try:
    check("操作: 起動した", fb.wait_ready(), True)
    check("PING: ESP32 の起動の合図([READY])のすぐあとに、PING が届く（駒の最初の読み取りより前に、ブザーを止められる）", fb.pings >= 1, True)
    check("PING: そのあとも、約1秒ごとに届く", fb.read_serial(2.6, keep_ping=True).count("PING\n") >= 2, True)
    m = _re.search(r"(http://127\.0\.0\.1:\d+)/(?=\s)", fb.read_screen(0.3))
    base_url = m.group(1) if m else None

    def get_json(path):
        with _urlreq.urlopen(base_url + path, timeout=5) as resp:
            return _json.loads(resp.read())

    def post_json(path, obj):
        rq = _urlreq.Request(base_url + path, data=_json.dumps(obj).encode("utf-8"), method="POST", headers={"Content-Type": "application/json"})
        with _urlreq.urlopen(rq, timeout=5) as resp:
            return _json.loads(resp.read())

    check("操作: 最初は未接続", get_json("/api/state")["connected"], False)
    # 画面が状態を見に来たので、ブリッジが ESP32 に STATE を頼む。自分のパターンの一覧(11〜20)も、少しずつ頼む
    asked = fb.read_serial(1.6)
    check("操作: STATE を頼む", "STATE\n" in asked, True)
    check("操作: 自分のドラム11・バッキング20の中身を頼む", "STATE PATTERN drum 11\n" in asked and "STATE PATTERN backing 20\n" in asked, True)
    # ESP32 が返す（状態の行は、画面には出さない）
    os.write(fb.master, "~S bpm=100 key=D playing=1 step=2 drum=3 backing=0 lead=1 voicing=4 octave=1 idle=OFF gain=33 midi=BRIDGE chords=Ⅰ,D;-,;?,;→,\r\n".encode("utf-8"))
    os.write(fb.master, "~P drum 11 8 K=x...x... マイ ビート\r\n".encode("utf-8"))
    time.sleep(0.4)
    st = get_json("/api/state")
    check("操作: 接続中になり、状態が読める", (st["connected"], st["s"]["bpm"], st["s"]["key"], st["s"]["step"], st["s"]["octave"]), (True, 100, "D", 2, 1))
    check("操作: パターンが読める", st["patterns"]["drum"]["11"]["name"], "マイ ビート")
    check("操作: 状態の行は画面に出ない", "~S" in fb.read_screen(0.2), False)

    # ステップの合図（~T）: STATE の問い合わせを待たずに、画面へ即時に届く（Server-Sent Events）
    import http.client as _hc  # noqa: E402
    hc = _hc.HTTPConnection(base_url.replace("http://", ""), timeout=3)
    hc.request("GET", "/api/events")
    hr = hc.getresponse()
    check("合図: /api/events に つながる", (hr.status, hr.readline()), (200, b": connected\n"))
    hr.readline()
    replay = _json.loads(hr.readline()[len(b"data: "):].decode("utf-8"))   # つないだ直後に、直前の出来事（先に届いた ~S）が届く
    hr.readline()
    check("つないだ直後に、直前の状態（~S）が1件届く", (replay["type"], replay["s"]["bpm"]), ("state", 100))
    t_sig = time.time()
    os.write(fb.master, b"~T 3\r\n")
    ev_line = hr.readline()
    sig_latency = time.time() - t_sig
    ev = _json.loads(ev_line[len(b"data: "):].decode("utf-8"))
    check("合図: ステップ 3・再生中として届く", (ev["type"], ev["step"], ev["playing"]), ("step", 3, 1))
    check("合図: 順番号・ブリッジの識別子・時刻つき", (isinstance(ev["seq"], int), isinstance(ev["sid"], int), isinstance(ev["t"], int)), (True, True, True))
    check("合図: ESP32 の行から画面への配信まで 150ms 未満（%.1f ms）" % (sig_latency * 1000), sig_latency < 0.15, True)
    hr.readline()
    st = get_json("/api/state")
    check("合図: 状態の step も、新しい合図(3)になる（STATE の返事は step=2 で古い）", (st["s"]["step"], st["s"]["playing"], st["sid"] == ev["sid"], st["seq"] >= ev["seq"]), (3, 1, True, True))
    os.write(fb.master, "~S bpm=100 key=D playing=1 step=0 drum=3 backing=0 lead=1 voicing=4 octave=1 idle=OFF gain=33 midi=BRIDGE chords=Ⅰ,D;-,;?,;→,\r\n".encode("utf-8"))
    t_state = time.time()
    st_line = hr.readline()
    state_latency = time.time() - t_state
    st_ev = _json.loads(st_line[len(b"data: "):].decode("utf-8"))
    hr.readline()
    check("状態の行(~S)も、画面に即時に流れる（type=state・bpm・step・順番号つき）", (st_ev["type"], st_ev["s"]["bpm"], st_ev["s"]["step"], st_ev["seq"] > ev["seq"]), ("state", 100, 0, True))
    check("状態の行: ESP32 の行から画面への配信まで 150ms 未満（%.1f ms）" % (state_latency * 1000), state_latency < 0.15, True)
    check("合図: そのあとに届いた STATE のほうが新しければ、そちらの step(0)になる", get_json("/api/state")["s"]["step"], 0)
    os.write(fb.master, b"~T -1\r\n")
    ev2 = _json.loads(hr.readline()[len(b"data: "):].decode("utf-8"))
    check("合図: 停止(-1)は playing=0 で届く・順番号が増える", (ev2["step"], ev2["playing"], ev2["seq"] > ev["seq"]), (-1, 0, True))
    time.sleep(0.1)
    st = get_json("/api/state")
    check("合図: 状態も止まった(playing=0)になる", (st["s"]["playing"], st["s"]["step"]), (0, -1))
    check("合図: ~T の行は画面に出ない", "~T" in fb.read_screen(0.2), False)
    os.write(fb.master, b"~T 99999\r\n~T x\r\n")
    time.sleep(0.2)
    check("合図: 形が違う行は無視される（状態は変わらない）", get_json("/api/state")["s"]["step"], -1)
    hc.close()
    fb.read_serial(0.3)
    check("操作: BPM を受け付ける", post_json("/api/control", {"action": "bpm", "value": 130})["ok"], True)
    got = fb.read_serial(0.6)
    check("操作: すぐ（待たずに）ESP32 に届く。そのあと、すぐ状態も読み直す", got.startswith("BPM 130\n") and "STATE\n" in got, True)
    post_json("/api/control", {"action": "drum", "value": 5})
    post_json("/api/control", {"action": "key", "value": "Eb"})
    got = fb.read_serial(0.6)
    check("操作: 続けた操作が順に届く", got.index("DRUM 5\n") < got.index("KEY Eb\n"), True)
    post_json("/api/refresh", {})
    check("操作: 一覧の読み直しを頼める", "STATE PATTERN drum 11\n" in fb.read_serial(1.6), True)
    # ライブ編集: 変えたところだけが、短い間隔で届く
    t_live = time.time()
    post_json("/api/live", {"kind": "drum", "slot": 12, "length": 8, "lanes": {"K": "x...x...", "S": "....x..."}})
    got = fb.read_serial(0.8)
    check("ライブ編集: 変えたレーンだけが ESP32 に届く", got.startswith("DRUM SET 12 K x...x...\nDRUM SET 12 S ....x...\n"), True)
finally:
    fb.close()

# ---- 常駐モード（--daemon）: ESP32 がなくても始まり、つながったら自動で動き、抜き差ししても、つなぎ直す ----
import tempfile as _tmp  # noqa: E402
link_dir = _tmp.mkdtemp()
link = os.path.join(link_dir, "fake_esp32")          # ESP32 のポートの代わり。あとから作る・付け替える
proc = subprocess.Popen([sys.executable, os.path.join(TOOLS, "midi_bridge.py"), "--daemon", "--port", link, "--name", "BridgeTestDaemon", "--ui-port", "0"],
                        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
d_out = b""


def d_screen(timeout):
    global d_out
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([proc.stdout.fileno()], [], [], 0.05)
        if r:
            chunk = os.read(proc.stdout.fileno(), 4096)
            if not chunk:
                break
            d_out += chunk
    return d_out.decode("utf-8", errors="replace")


def attach_board():
    """ 疑似ESP32 を作って、ポート（リンク）を、そこにつなぐ """
    master, slave = pty.openpty()
    tmp = link + ".new"
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(os.ttyname(slave), tmp)
    os.replace(tmp, link)
    return master


def read_master(master, timeout, keep_ping=False):
    data = b""
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            try:
                data += os.read(master, 4096)
            except OSError:
                break
    text = data.decode("utf-8", errors="replace")
    return text if keep_ping else text.replace("PING\n", "")   # PING（ブリッジが約1秒ごとに送る「つながっています」の合図）は、除く


try:
    scr = d_screen(2.5)
    check("常駐: ESP32 がなくても、仮想MIDIポートを作って、待つ", "仮想MIDIポート「BridgeTestDaemon」を作りました" in scr and "待ちます" in scr, True)
    check("常駐: 待っている間も、止まらない", proc.poll() is None, True)
    m1 = attach_board()
    scr = d_screen(3.0)
    check("常駐: ESP32 がつながったら、自動でつなぐ", "ESP32 につなぎました" in scr, True)
    os.write(m1, b"[READY]\r\n")
    check("常駐: 起動の合図を見て、MIDI BRIDGE を頼む", "MIDI BRIDGE" in read_master(m1, 1.5), True)
    os.write(m1, "~S bpm=100 key=D playing=1 step=2 drum=3 backing=0 lead=1 voicing=4 octave=1 idle=OFF gain=33 midi=BRIDGE chords=Ⅰ,D;-,;?,;→,\r\n".encode("utf-8"))
    # 抜く（疑似ESP32 の側を閉じる）
    os.close(m1)
    os.unlink(link)   # ポートの名前が消える（本物の ESP32 を抜いたときと同じ）
    scr = d_screen(3.0)
    check("常駐: 抜かれても、終わらずに、つなぎ直すのを待つ", "つなぎ直すのを待ちます" in scr and proc.poll() is None, True)
    n_before = scr.count("ESP32 につなぎました")
    m2 = attach_board()   # 挿し直す
    scr = d_screen(3.5)
    check("常駐: 挿し直したら、自動でつなぎ直す", scr.count("ESP32 につなぎました") > n_before, True)
    os.write(m2, b"[READY]\r\n")
    check("常駐: つなぎ直したあとも、MIDI BRIDGE を頼む", "MIDI BRIDGE" in read_master(m2, 1.5), True)
    # ---- ほかのプログラムがポートを開いたら退く / 画面の「接続する」で、Serial Monitor だけを閉じて、つなぐ ----
    import json as _json
    import re as _re2
    import urllib.request as _ur
    mm = _re2.search(r"http://127\.0\.0\.1:(\d+)/(?=\s)", d_out.decode("utf-8", errors="replace"))
    uiport = int(mm.group(1)) if mm else 0

    def api(path, body=None):
        req = _ur.Request("http://127.0.0.1:%d%s" % (uiport, path), data=(_json.dumps(body).encode("utf-8") if body is not None else None),
                          headers={"Content-Type": "application/json"} if body is not None else {}, method="POST" if body is not None else "GET")
        with _ur.urlopen(req, timeout=5) as r:
            return _json.loads(r.read().decode("utf-8"))

    def wait_open(want, timeout):
        end = time.time() + timeout
        while time.time() < end:
            if api("/api/state")["serial"]["open"] == want:
                return True
            time.sleep(0.3)
        return False

    HOLD = "import sys,time; f=open(sys.argv[1]); time.sleep(120)"
    real_link = os.path.realpath(link)
    st = api("/api/state")
    check("常駐: 状態に、ブリッジのつなぎ（serial）が出る（つながっている）", (st["serial"]["open"], st["serial"]["daemon"]), (True, True))
    mon = subprocess.Popen([sys.executable, "-c", HOLD, real_link, "platformio", "device", "monitor"])
    check("常駐: Serial Monitor がポートを開くと、ブリッジは退く", wait_open(False, 5), True)
    st = api("/api/state")
    check("常駐: 退いた理由（Serial Monitor）が、状態に出る", [h["pid"] for h in st["serial"]["busy"]] == [mon.pid] and st["serial"]["busy"][0]["monitor"], True)
    res = api("/api/bridge", {"action": "connect"})
    check("接続ボタン: Serial Monitor だけを閉じる", (res["killed"], res["others"]), ([mon.pid], []))
    check("接続ボタン: すぐ、つなぎ直す", wait_open(True, 5), True)
    check("接続ボタン: Serial Monitor は、本当に閉じた", mon.wait(timeout=5) is not None, True)
    other = subprocess.Popen([sys.executable, "-c", HOLD, real_link, "esptool-like"])
    check("常駐: ほかのプログラム（書き込みなど）でも、退く", wait_open(False, 5), True)
    res = api("/api/bridge", {"action": "connect"})
    check("接続ボタン: Serial Monitor 以外は、閉じない（名前だけ知らせる）", (res["killed"], [h["pid"] for h in res["others"]], other.poll() is None), ([], [other.pid], True))
    other.terminate(); other.wait(timeout=5)
    check("常駐: ほかのプログラムが閉じたら、自動でつなぎ直す", wait_open(True, 6), True)
    try:
        api("/api/bridge", {"action": "nothing"})
        bad = False
    except Exception:
        bad = True
    check("接続ボタン: 知らない操作は断る", bad, True)
    # ---- PING: つながっている間は、約1秒ごとに送る（ESP32 が、基板のブザーのアルペジオを鳴らさなくなる合図）----
    got_ping = read_master(m2, 2.6, keep_ping=True)
    check("PING: つながっている間は、約1秒ごとに届く", got_ping.count("PING\n") >= 2, True)
    # ---- 「解除」: ポートを閉じて、「つなぐ」まで開き直さない（Serial Monitor で確認・操作・駒の登録をするため）----
    d_screen(0.5)                                  # ここまでの表示を、読み切ってから数える
    n_cut = d_out.decode("utf-8", errors="replace").count("接続が切れました")
    res = api("/api/bridge", {"action": "release"})
    check("解除: 受け付ける", (res["ok"], res["released"], res["open"]), (True, True, False))
    check("解除: 状態に出る（ポートを閉じている）", (lambda s_: (s_["open"], s_["released"]))(api("/api/state")["serial"]), (False, True))
    read_master(m2, 0.2, keep_ping=True)           # 解除の前に届いた分を、読み捨てる
    time.sleep(2.6)
    check("PING: 解除中は、送らない（ESP32 は、約2.5秒で、ブザーが元どおり鳴る状態に戻る）", read_master(m2, 0.3, keep_ping=True).count("PING"), 0)
    holder = subprocess.Popen([sys.executable, "-c", HOLD, real_link, "pretend-serial-monitor"])    # 解除中は、ほかのプログラムが安心して使える
    time.sleep(3.0)
    st = api("/api/state")["serial"]
    check("解除中: 疑似ポートが使える状態でも、開き直さない（3秒たっても閉じたまま）", (st["open"], st["released"]), (False, True))
    holder.terminate(); holder.wait(timeout=5)
    time.sleep(2.5)
    check("解除中: ほかのプログラムが閉じても、勝手には、つながらない", api("/api/state")["serial"]["open"], False)
    scr = d_screen(0.3)
    check("解除: 「切れた」の警告は出さず、解除したことを知らせる", ("ブリッジを解除しました" in scr, scr.count("接続が切れました") - n_cut), (True, 0))
    res = api("/api/bridge", {"action": "connect"})
    check("つなぐ: 解除が外れる", res["ok"], True)
    check("つなぐ: 解除のあと、また、つながる", wait_open(True, 6), True)
    check("つなぐ: 状態の released が False に戻る", api("/api/state")["serial"]["released"], False)
    # つなぎ直したあと、MIDI が仮想ポートに出る（ブリッジが読み取りを続けている）
    os.write(m2, b"~M 90 3C 50 \r\n")
    _tb = "Traceback" in d_screen(0.5)
    if _tb or fails:
        print("--- 常駐モードのブリッジの画面 ---\n" + d_out.decode("utf-8", errors="replace")[-2500:])
    check("常駐: 例外で止まっていない", _tb, False)
finally:
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()

# ---- --to: すでにある宛先に直接送る ----
check("宛先を探す（大文字小文字を区別しない）", mb.find_destination(type("P", (), {"get_ports": lambda self: ["IAC Driver Bus 1", "GarageBand\u00e3\u0081"]})(), "garageband"), 1)
check("宛先がなければ None", mb.find_destination(type("P", (), {"get_ports": lambda self: ["A"]})(), "zzz"), None)
sink = rtmidi.MidiIn()
sink.ignore_types(sysex=True, timing=True, active_sense=True)
sink.open_virtual_port("BridgeTestSink")
sink_got = []
sink.set_callback(lambda ev, data=None: sink_got.append(ev[0]))
fb = FakeBoard("BridgeTestTo", extra_args=["--to", "BridgeTestSink"])
try:
    check("--to: 起動した", fb.wait_ready(), True)
    check("--to: 宛先につないだ案内", "にも直接送ります" in fb.read_screen(0.3), True)
    os.write(fb.master, b"~M 90 30 50 90 34 50 \n")
    time.sleep(0.4)
    check("--to: 宛先にも MIDI が届く", sink_got, [[0x90, 0x30, 0x50], [0x90, 0x34, 0x50]])
finally:
    fb.close()
    sink.close_port()

# ---- --drums split / off ----
def find_port(midi, needle, exclude=None):
    for _ in range(100):
        for i, nm in enumerate(midi.get_ports()):
            if needle in nm and (exclude is None or exclude not in nm):
                return i
        time.sleep(0.05)
    return None


for mode in ("split", "off"):
    name = "BridgeTestRoute" + mode
    fb = FakeBoard(name, extra_args=["--drums", mode])
    main_in = rtmidi.MidiIn()
    drums_in = rtmidi.MidiIn()
    main_in.ignore_types(sysex=True, timing=True, active_sense=True)
    drums_in.ignore_types(sysex=True, timing=True, active_sense=True)
    main_got, drums_got = [], []
    try:
        check("--drums %s: 起動した" % mode, fb.wait_ready(), True)
        mi = find_port(main_in, name, exclude="Drums")
        check("--drums %s: ふつうのポートができた" % mode, mi is not None, True)
        if mi is None:
            continue
        main_in.open_port(mi)
        main_in.set_callback(lambda ev, data=None: main_got.append(ev[0]))
        di = find_port(drums_in, name + " Drums")
        check("--drums %s: ドラム用のポート %s" % (mode, "ができた" if mode == "split" else "はない"), di is not None, mode == "split")
        if di is not None:
            drums_in.open_port(di)
            drums_in.set_callback(lambda ev, data=None: drums_got.append(ev[0]))
        time.sleep(0.3)
        os.write(fb.master, b"~M 90 30 50 99 24 6E 99 2A 55 \n")
        time.sleep(0.4)
        check("--drums %s: ピアノはふつうのポートに届く" % mode, main_got, [[0x90, 0x30, 0x50]])
        check("--drums %s: ドラム(ch10)のポート" % mode, drums_got, [[0x99, 0x24, 0x6E], [0x99, 0x2A, 0x55]] if mode == "split" else [])
        fb.type("!panic\n")
        time.sleep(0.4)
        check("--drums %s: !panic はピアノのポートに ch1 の All Notes Off" % mode, [0xB0, 123, 0] in main_got, True)
        if mode == "split":
            check("--drums split: !panic はドラムのポートに ch10 の All Notes Off", [0xB9, 123, 0] in drums_got, True)
    finally:
        main_in.close_port()
        drums_in.close_port()
        fb.close()

print("test_bridge: checks=%d fails=%d" % (checks, fails))
sys.exit(1 if fails else 0)
