#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ESP32 → PC の MIDI ブリッジ（ESP32_Octo_01 用）

  ESP32 が USB（UART側のポート）で送ってくる "~M 90 30 50 ..." という文字の行を、
  本物の MIDI メッセージに変換して、PC の「仮想MIDIポート」から出す。
  GarageBand などの PC の音源は、この仮想ポートから MIDI を受け取って、ピアノの音を鳴らす。

  このスクリプトは、VS Code の Serial Monitor の代わりにもなる。
    ・ESP32 の表示（日本語のメッセージ）を、そのまま画面に出す
    ・ここで打った文字（BPM 120 / START / STOP / STATUS ...）を、ESP32 に送る
    ・行の最初に + - ] [ を打つと、Enter なしで、すぐ ESP32 に届く（+ - は BPM ±5、] [ はキー ±1半音）
    ・!load ファイル名 で、ファイルに書いたコマンド（リズムのパターンなど）を、順に ESP32 に送る
    ・リズム編集画面（ブラウザ）: 動かすと表示される http://127.0.0.1:8765/ を開くと、マス目をクリックして
      ドラム／バッキングのパターンを作り、ESP32 に送れる（文字を打たなくてよい）

  使い方（VS Code のターミナルで）:
      tools/.venv/bin/python tools/midi_bridge.py            # ESP32 につないで動かす
      tools/.venv/bin/python tools/midi_bridge.py --test     # ESP32 なしで、テストの和音を鳴らす（音源の確認用）
      tools/.venv/bin/python tools/midi_bridge.py --list     # つながっているポートの一覧
      tools/.venv/bin/python tools/midi_bridge.py --to GarageBand # GarageBand の「仮想入力」にも直接送る（仮想ポートが見えないとき）
      tools/.venv/bin/python tools/midi_bridge.py --drums split   # ドラム（チャンネル10）を、別の仮想ポートに分ける
      tools/.venv/bin/python tools/midi_bridge.py --drums off     # ドラムを送らない（ピアノだけの音源のとき）
  終了は Ctrl+C。

  ※ PlatformIO の Serial Monitor と同時には使えない（同じポートを取り合う）。どちらか一方だけ開く。
"""
import argparse
import codecs
import os
import queue
import select
import subprocess
import sys
import threading
import time
import unicodedata

# ---------------------------------------------------------------------------
# 変換の部分（ESP32 や MIDI がなくてもテストできるように、機器に触らない関数にしてある）
# ---------------------------------------------------------------------------

BRIDGE_PREFIX = "~M "

# MIDI の状態バイト（上4ビット）ごとの、メッセージの長さ（状態バイトを含む）
_MESSAGE_LENGTH = {0x80: 3, 0x90: 3, 0xA0: 3, 0xB0: 3, 0xC0: 2, 0xD0: 2, 0xE0: 3}


def parse_bridge_line(line):
    """ "~M 90 30 50 \n" → [0x90, 0x30, 0x50]。ブリッジ用の行でなければ None。16進数でなければ ValueError """
    if not line.startswith(BRIDGE_PREFIX):
        return None
    return [int(tok, 16) for tok in line[len(BRIDGE_PREFIX):].split()]


def split_messages(data):
    """ バイト列を、MIDI メッセージごとの [[0x90, 0x30, 0x50], [0x90, 0x34, 0x50], ...] に分ける。
        長さが合わないメッセージ（途切れなど）は捨てる """
    messages, current = [], []
    for b in data:
        if b < 0 or b > 255:
            raise ValueError("バイトの範囲外: %r" % b)
        if b >= 0x80:
            if current:
                messages.append(current)
            current = [b]
        elif current:
            current.append(b)
    if current:
        messages.append(current)
    valid = []
    for m in messages:
        want = _MESSAGE_LENGTH.get(m[0] & 0xF0)
        if want is not None and len(m) == want:
            valid.append(m)
    return valid


# ---------------------------------------------------------------------------
# ドラム（チャンネル10）の送り先
# ---------------------------------------------------------------------------

DRUM_CHANNEL = 9  # MIDI のチャンネル10（0から数える）
DRUMS_MODES = ("merge", "split", "off")


def route_messages(messages, drums_mode):
    """ [(送り先, メッセージ), ...] にする。送り先は 0（ふつうのポート）か 1（ドラム用のポート）。
        merge: 全部ふつうのポート / split: チャンネル10だけ ドラム用のポート / off: チャンネル10は捨てる """
    routed = []
    for m in messages:
        is_drum = (m[0] & 0x0F) == DRUM_CHANNEL and (m[0] & 0xF0) != 0xF0
        if not is_drum or drums_mode == "merge":
            routed.append((0, m))
        elif drums_mode == "split":
            routed.append((1, m))
        # off: 捨てる
    return routed


# 全部の音を止めるメッセージ（ピアノ ch1 と ドラム ch10）
PANIC_MESSAGES = [[0xB0, 123, 0], [0xB9, 123, 0]]


# ---------------------------------------------------------------------------
# 入力の部分
# ---------------------------------------------------------------------------

# Enter なしで、すぐ ESP32 に送るキー（ESP32 側の commandsHotkey と同じ）
HOTKEYS = "+-=_[]"


def char_width(ch):
    """ 画面で何桁を使う文字か（日本語などの全角は 2） """
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


class LineEditor(object):
    """ 1文字ずつ届く入力を、1行にまとめる（端末を「1文字ずつ」読む設定にしたときに使う）。
        行の最初の1文字が HOTKEYS のときは、Enter を待たずに、すぐ送る。 """

    def __init__(self, hotkeys=HOTKEYS):
        self.hotkeys = hotkeys
        self.buf = []
        self._esc = 0  # 0: ふつう / 1: ESC を受けた / 2: ESC [ の途中（矢印キーなどを読み捨てる）

    def text(self):
        return "".join(self.buf)

    def feed(self, ch):
        """ 1文字を処理して、イベントのリストを返す。
              ("key", c)    Enter なしで、すぐ ESP32 に送る1文字
              ("line", s)   Enter が押された。1行の文字（空のこともある）
              ("echo", s)   画面に出す文字
              ("erase", n)  画面の n 桁を消す
              ("quit",)     Ctrl+D（行が空のとき） """
        if self._esc == 1:
            if ch in "[O":
                self._esc = 2
                return []
            self._esc = 0  # ESC だけだった。この文字は、ふつうに扱う
        elif self._esc == 2:
            if "@" <= ch <= "~":
                self._esc = 0  # 矢印キーなどの終わり
            return []
        if ch == "\x1b":
            self._esc = 1
            return []
        if ch in ("\r", "\n"):
            line = self.text()
            self.buf = []
            return [("line", line)]
        if ch in ("\x7f", "\b"):
            if not self.buf:
                return []
            return [("erase", char_width(self.buf.pop()))]
        if ch == "\x15":  # Ctrl+U: 行を消す
            width = sum(char_width(c) for c in self.buf)
            self.buf = []
            return [("erase", width)] if width else []
        if ch == "\x04":  # Ctrl+D
            return [("quit",)] if not self.buf else []
        if ch < " ":
            return []  # そのほかの制御文字は無視
        if not self.buf and ch in self.hotkeys:
            return [("key", ch)]
        self.buf.append(ch)
        return [("echo", ch)]


def parse_command_file(text):
    """ !load で読むファイルの中身から、ESP32 に送る行を取り出す。空の行と、# で始まる行（コメント）は飛ばす """
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines



# ---------------------------------------------------------------------------
# テスト用: ESP32 なしで、コード進行を鳴らす（PC側の音源の設定を確認するため）
# ---------------------------------------------------------------------------

# Key=C の Ⅰ Ⅵm Ⅳ Ⅴ（ピアノ用の高さ。ESP32 が鳴らす音と同じ。3和音は4音目にルートのオクターブ上）
DEMO_PROGRESSION = [
    ("Ⅰ  (C)", [48, 52, 55, 60]),
    ("Ⅵm (Am)", [57, 60, 64, 69]),
    ("Ⅳ  (F)", [53, 57, 60, 65]),
    ("Ⅴ  (G)", [55, 59, 62, 67]),
]


def run_demo(midi_out, bpm=120, velocity=80):
    step_s = 2 * 60.0 / bpm  # 1ステップ = 2拍
    print("テストの和音を鳴らします（BPM %d、1ステップ %.2f秒）。止めるには Ctrl+C。" % (bpm, step_s))
    midi_out.send_message([0xC0, 0])  # 音色: ピアノ
    try:
        while True:
            for name, notes in DEMO_PROGRESSION:
                print("  ♪ %s" % name)
                for n in notes:
                    midi_out.send_message([0x90, n, velocity])
                time.sleep(step_s * 0.95)
                for n in notes:
                    midi_out.send_message([0x80, n, 0])
                time.sleep(step_s * 0.05)
    except KeyboardInterrupt:
        pass
    finally:
        midi_out.send_message([0xB0, 123, 0])  # All Notes Off


# ---------------------------------------------------------------------------
# ESP32 とつなぐ部分
# ---------------------------------------------------------------------------

def find_esp32_port():
    import serial.tools.list_ports
    candidates = []
    for p in serial.tools.list_ports.comports():
        if p.device.startswith("/dev/tty."):
            continue  # macOS は cu. の方を使う
        # Freenove ESP32-S3 の UART 側のポートは、WCH の CH343（VID 0x1A86）
        if p.vid == 0x1A86 or "usbmodem" in p.device or "usbserial" in p.device or "ttyACM" in p.device or "ttyUSB" in p.device:
            candidates.append(p)
    return candidates


def find_destination(midi_out, needle):
    """ すでにある MIDI の宛先(出力先)から、名前に needle を含むものを探して、番号を返す。なければ None。
        （macOS の日本語の名前は、文字化けして見えることがあるので、英字の部分で探す。大文字小文字は区別しない） """
    for i, name in enumerate(midi_out.get_ports()):
        if needle.lower() in name.lower():
            return i
    return None


def open_midi_out(name):
    import rtmidi
    midi_out = rtmidi.MidiOut()
    midi_out.open_virtual_port(name)
    return midi_out


class Console(object):
    """ 画面への表示。入力の途中の文字があるとき、ESP32 からの表示で行が崩れないよう、打ちかけの文字を表示し直す """

    def __init__(self):
        self.lock = threading.Lock()
        self.editor = None  # 1文字ずつ読むとき(LineEditor)だけ

    def line(self, text):
        with self.lock:
            partial = self.editor.text() if self.editor else ""
            if partial:
                sys.stdout.write("\r\x1b[2K")  # 打ちかけの行を消して、ESP32 の表示を出す
            sys.stdout.write(text + "\n")
            if partial:
                sys.stdout.write(partial)  # 打ちかけの文字を、表示し直す
            sys.stdout.flush()

    def raw(self, text):
        with self.lock:
            sys.stdout.write(text)
            sys.stdout.flush()


LOAD_DELAY_S = 0.3  # !load で1行送るごとの待ち時間（ESP32 が保存などを終えるのを待つ）


def run_bridge(args):
    import serial

    port = args.port
    if port is None and args.daemon:
        port = ""   # 常駐モード: 下で、ESP32 が見つかるまで待つ
    if port is None:
        candidates = find_esp32_port()
        if not candidates:
            print("ESP32 のポートが見つかりません。USBケーブルをつないで、もう一度試してください。")
            print("（PlatformIO の Serial Monitor を開いていると、ポートが使えません。先に閉じてください）")
            return 1
        if len(candidates) > 1:
            print("ポートが複数見つかりました。--port で指定してください:")
            for p in candidates:
                print("  %s  (%s)" % (p.device, p.description))
            return 1
        port = candidates[0].device

    midi_out = open_midi_out(args.name)
    print("仮想MIDIポート「%s」を作りました。GarageBand などの MIDI入力に、これが見えます。" % args.name)
    drums_out = None
    if args.drums == "split":
        drums_out = open_midi_out(args.name + " Drums")
        print("ドラム（チャンネル10）用の仮想MIDIポート「%s」も作りました。" % (args.name + " Drums"))
    elif args.drums == "off":
        print("ドラム（チャンネル10）の MIDI は送りません（--drums off）。")
    outs = [midi_out, drums_out]
    extra_outs = []  # --to で指定した、すでにある宛先（例: GarageBand の「仮想入力」）。ピアノ側と同じ MIDI を送る
    for needle in args.to or []:
        import rtmidi
        probe = rtmidi.MidiOut()
        idx = find_destination(probe, needle)
        if idx is None:
            print("※ MIDIの宛先「%s」が見つかりません（GarageBand を先に開いておく必要があります）。見つかった宛先: %s" % (needle, probe.get_ports() or "なし"))
            continue
        probe.open_port(idx)
        extra_outs.append(probe)
        print("MIDIの宛先「%s」にも直接送ります。" % probe.get_ports()[idx])

    ser = serial.Serial()
    ser.baudrate = args.baud
    ser.timeout = 0.05
    # ★ ポートを開くとき、ESP32 を再起動させない（2026-11-16）:
    #   ESP32 の基板は、RTS が高く・DTR が低い、という組み合わせの一瞬で、リセットがかかる（自動リセットの回路）。
    #   以前は「DTR も RTS も、下げてから開く」だったため、開く瞬間に、DTR だけが先に下がって、毎回リセットがかかっていた
    #   （ブリッジを作り直す・つなぎ直すたびに、ESP32 が再起動して、盤面が約3.5秒、空になった）。
    #   開くときは、RTS を先に下げ、DTR は高いままにして、開いたあとで DTR を下げる（実機で、再起動しないことを確認）
    ser.dtr = True
    ser.rts = False

    def lower_dtr():
        """ 開いたあとで、DTR を下げる（RTS は、もう下がっている。この順番なら、リセットがかからない）。
            疑似ポート（テスト）は、この操作を受けつけない。そのときは、そのままにする """
        try:
            ser.dtr = False
        except (serial.SerialException, OSError):
            pass
    conn = {"ok": True}   # 常駐モードで、ESP32 とつながっているか（つながっていない間は、書き込まない）

    yield_note = {"busy": False}   # 「ほかのプログラムが使っている」の表示を、1回だけにする
    link = {"port": None, "busy": [], "released": False}   # 画面に見せる、つなぎの状態。busy: ポートを使っているほかのプログラム [{pid, command}]

    def port_holders(dev):
        """ このポートを開いている、ほかのプログラム（PlatformIO の Serial Monitor・esptool など）の [{pid, command}]。
            同じポートを2つのプログラムが同時に読むと、文字が分け取られて化けたり、途切れたりするので、ブリッジは退く """
        if not dev:
            return []
        try:
            r = subprocess.run(["lsof", "-t", "--", dev], capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.SubprocessError):
            return []
        mine = (os.getpid(), os.getppid())   # 自分と、自分を始めたプログラム（テストの疑似ポートは、テスト自身が持っている）は数えない
        out = []
        for p in r.stdout.split():
            if not p.isdigit() or int(p) in mine:
                continue
            try:
                cmd = subprocess.run(["ps", "-p", p, "-o", "command="], capture_output=True, text=True, timeout=3).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                cmd = ""
            out.append({"pid": int(p), "command": cmd[-160:], "monitor": "device monitor" in cmd})   # 名前は、後ろ側（プログラム名と引数）を残す
        return out

    def others_using_port(dev):
        holders = port_holders(dev)
        link["busy"] = holders
        return [h["pid"] for h in holders]

    def daemon_open():
        """ 常駐モード: ESP32 の UART 側のポートを探して、開く。開けたら True。ほかのプログラムが使っている間は、開かない """
        if link["released"]:
            return False   # 「解除」中: ポートを開かない（Serial Monitor などが、安心して使える）。「つなぐ」まで、このまま
        dev = args.port
        if not dev:
            cands = find_esp32_port()
            pref = [c for c in cands if c.vid == 0x1A86] or cands   # CH343（UART側）を優先
            if not pref:
                link["port"], link["busy"] = None, []
                return False
            dev = pref[0].device
        link["port"] = dev
        if others_using_port(dev):
            if not yield_note["busy"]:
                yield_note["busy"] = True
                print("ポート %s は、ほかのプログラム（Serial Monitor・書き込みなど）が使っています。空くまで待ちます…" % dev)
            return False
        try:
            ser.port = dev
            ser.dtr, ser.rts = True, False       # 開く瞬間に、リセットがかからない組み合わせ（上の説明）
            ser.open()
        except (serial.SerialException, OSError):
            return False
        lower_dtr()
        conn["ok"] = True
        yield_note["busy"] = False
        link["busy"] = []
        print("ESP32 につなぎました: %s（%d bps）" % (dev, args.baud))
        return True

    def port_watcher():
        """ 常駐モード: 1秒ごとに、ほかのプログラムが同じポートを開いていないか見る。開いたら、こちらは閉じて退く
            （閉じると、読み取り側が「切れた」として、空くのを待ってつなぎ直す） """
        while not stop.is_set():
            time.sleep(1.0)
            if not conn["ok"]:
                continue
            if others_using_port(ser.port):
                print("Serial Monitor などが %s を開いたので、ブリッジは退きます（閉じられたら、戻ります）" % ser.port)
                conn["ok"] = False
                try:
                    ser.close()
                except Exception:
                    pass
            else:
                link["busy"] = []

    def bridge_connect():
        """ 画面の「接続する」ボタン / tools/bridge_connect.sh から。PlatformIO の Serial Monitor（device monitor）がポートを使っているなら閉じて、
            つなぎ直すのを待たずに始める。それ以外のプログラム（esptool など）は、閉じない（名前だけ知らせる） """
        link["released"] = False
        killed, others = [], []
        for h in list(link["busy"]):
            if h["monitor"]:
                try:
                    os.kill(h["pid"], 15)
                    killed.append(h["pid"])
                except OSError:
                    pass
            else:
                others.append(h)
        if killed:
            time.sleep(1.2)
        return {"ok": True, "open": conn["ok"], "killed": killed, "others": others, "port": link["port"]}

    def bridge_release():
        """ 画面の「解除」ボタン / tools/bridge_release.sh から。ブリッジが ESP32 のポートを閉じて、「つなぐ」まで開き直さない。
            Serial Monitor で確認・操作・駒の登録をするときに使う（同じポートを2つが読むと、文字が化けたり、途切れたりするため）。
            解除中は、Mac から音が鳴らない """
        if args.daemon:
            link["released"] = True
            send_midi(PANIC_MESSAGES)        # 鳴りっぱなしの音を消す
            conn["ok"] = False
            try:
                ser.close()
            except Exception:
                pass
            console.line("ブリッジを解除しました。ESP32 のポートを閉じています（Serial Monitor などが使えます）。つなぐまで、Mac から音は鳴りません")
        return {"ok": bool(args.daemon), "released": link["released"], "open": conn["ok"], "port": link["port"]}

    if args.daemon:
        conn["ok"] = False
        print("常駐モード: ESP32（UART側のUSBポート）がつながるのを待ちます。つながったら、自動で始まります。")
        daemon_open()   # つながらなくても、先に進む（画面 http://127.0.0.1:8765/ は先に始める。読み取り側が、つながるまで待ち続ける）
    else:
        ser.port = port
        try:
            ser.dtr, ser.rts = True, False       # 開く瞬間に、リセットがかからない組み合わせ
            ser.open()
        except serial.SerialException as e:
            print("ポート %s を開けませんでした: %s" % (port, e))
            print("PlatformIO の Serial Monitor など、ほかのソフトが使っていないか確認してください。")
            return 1
        lower_dtr()
    print("ESP32 につなぎました: %s（%d bps）。Ctrl+C で終了。" % (ser.port, args.baud))
    print("ここに打った文字（BPM 120 / KEY D / START / STOP / STATUS / HELP）は、ESP32 に送られます。")
    use_tty = sys.stdin.isatty()
    if use_tty:
        print("行の最初に + - と打つと BPM ±5、] [ と打つとキー ±1半音（Enter は不要）。!load ファイル名 でリズムのパターンを読み込み。!help で一覧。")
    else:
        print("!load ファイル名 で、ファイルに書いたコマンド（リズムのパターンなど）を読み込めます。!help で一覧。")
    ui_server = None
    ui_hooks = {}
    ui_queue = queue.Queue()
    # ESP32 の状態（操作画面に見せる）。STATE の返事の行（~S / ~P）から作る
    ui_state = {"s": None, "s_time": 0.0, "patterns": {"drum": {}, "backing": {}}, "wanted": 0.0, "refresh": True, "poke": False,
                "seq": 0, "s_seq": 0, "step_info": None, "sid": int(time.time() * 1000)}   # sid: このブリッジを始めた時刻（作り直したら変わる）。seq: ESP32 から届いた状態・ステップの合図の順番（古い返事で新しい表示を戻さないため）
    ui_hub = None   # 画面に、ステップの進みを即時に流す配り役（画面を始めたときに作る）
    ui_lock = threading.Lock()
    if not args.no_ui:
        try:
            import rhythm_server
            ui_hub = rhythm_server.EventHub()
            ui_library = rhythm_server.Library(rhythm_server.default_library_path())   # 名前をつけたドラム・バッキング・固有進行（ゲームが、リアルタイムで受け取る）
            import cloud_sync
            ui_cloud = cloud_sync.CloudSync(ui_library)                                # 公開ページ（GitHub Pages）のゲームへも、リアルタイムで送る（設定したときだけ。docs/cloud_setup.md）
            ui_library.listeners.append(ui_cloud.notify)
            ui_cloud.start()
            # 画面から呼ばれる関数。中身は、下（send_line などを作ったあと）で入れる
            ui_server = rhythm_server.start_in_thread(
                args.ui_port, lambda lines: ui_queue.put((lines, 0.15)), events=ui_hub,
                live=lambda lines: ui_queue.put((lines, 0.06)),   # ライブ編集: 変えたところだけ。間をあまりあけず、すぐ反映する
                control=lambda lines: ui_hooks["control"](lines),
                get_state=lambda: ui_hooks["get_state"](),
                refresh=lambda: ui_hooks["refresh"](),
                bridge=lambda action: ui_hooks["bridge"](action), library=ui_library, cloud=ui_cloud)
            print("リズム・コード編集（ブラウザで開くと、マス目をクリックして、ドラム／バッキングのパターンを作れます）:")
            print("  http://127.0.0.1:%d/" % ui_server.server_address[1])
            if os.path.isdir(rhythm_server.GAME_DIR):
                print("ゲーム（コード進行をトリックにする）:")
                print("  http://127.0.0.1:%d/game/" % ui_server.server_address[1])
        except OSError as e:
            print("（リズム編集画面を始められませんでした: %s。ほかのブリッジが動いていませんか?）" % e)
    print("-" * 60)

    stop = threading.Event()
    lock = threading.Lock()  # シリアルへの書き込みを、複数の場所から同時にしないため
    state = {"ready_seen": False, "midi_notes": 0, "midi_muted": False, "game_clients": 0}
    console = Console()

    def send_raw(text):
        if not conn["ok"]:
            return
        with lock:
            try:
                ser.write(text.encode("utf-8"))
            except (serial.SerialException, OSError, TypeError, ValueError):   # TypeError/ValueError: 別のスレッドが、書く瞬間にポートを閉じた（解除・Serial Monitor に譲る）
                if not args.daemon:
                    raise

    def send_line(text):
        send_raw(text + "\n")

    def send_midi(messages):
        if state["midi_muted"]:
            return   # ゲームの画面がつながっている間は、MIDI を外に出さない（音はゲームが鳴らす。GarageBand などと二重に鳴らないため）
        if args.drums == "merge" and not state.get("drum_warned") and any((m[0] & 0x0F) == DRUM_CHANNEL and (m[0] & 0xF0) in (0x80, 0x90) for m in messages):
            state["drum_warned"] = True
            console.line("※ ドラム（MIDIチャンネル10）の音が出ています。ピアノだけの音源（GarageBand のピアノのトラックなど）では、"
                         "キック=C・ハイハット=F# の低いピアノの音になって、不協和に聞こえます。")
            console.line("  ピアノもドラムも鳴らすには、GarageBand のトラックの音源を Apple の AUMIDISynth に替える（README 6-5 の 0）か、tools/gm_synth/gm_synth を使ってください。ピアノだけにするなら --drums off、または DRUM OFF。")
        for dest, msg in route_messages(messages, args.drums):
            out = outs[dest]
            if out is not None:
                out.send_message(msg)
                state["midi_notes"] += 1
            if dest == 0:
                for extra in extra_outs:
                    extra.send_message(msg)

    def reader():
        buf = b""
        while not stop.is_set():
            try:
                # 1バイト届くまで待ち（最大 timeout）、届いたら、いま溜まっている分をすぐ読む。
                # read(512) だと、512バイト溜まるまで待ってしまい、MIDIが遅れる（音のタイミングがずれる）
                chunk = ser.read(1)
                if chunk:
                    chunk += ser.read(ser.in_waiting)
            except (serial.SerialException, OSError):
                if not args.daemon:
                    console.line("\nESP32 との接続が切れました。")
                    stop.set()
                    return
                was_open = (conn["ok"] or ser.is_open) and not link["released"]   # 解除したときの切れ方は、警告しない
                conn["ok"] = False
                try:
                    ser.close()
                except Exception:
                    pass
                if was_open:
                    console.line("ESP32 との接続が切れました。つなぎ直すのを待ちます…")
                while not stop.is_set():   # 1秒おきに探す（すぐ切れる状態で、空回りしないように、先に待つ）
                    time.sleep(1.0)
                    if daemon_open():
                        break
                if stop.is_set():
                    return
                buf = b""
                state["ready_seen"] = False
                start_late_request()
                continue
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                text = raw.decode("utf-8", errors="replace").rstrip("\r")
                if text.startswith("~T "):   # ステップの始まり／停止の合図。画面に、すぐ流す（STATE の問い合わせを待たない）
                    try:
                        import rhythm_server as _rs
                        step = _rs.parse_step_line(text)
                        if step is not None:
                            with ui_lock:
                                ui_state["seq"] += 1
                                seq = ui_state["seq"]
                                ui_state["step_info"] = {"step": step, "playing": 1 if step >= 0 else 0, "seq": seq}
                            if ui_hub is not None:
                                ui_hub.publish({"type": "step", "step": step, "playing": 1 if step >= 0 else 0, "seq": seq, "sid": ui_state["sid"], "t": int(time.time() * 1000)})
                    except ImportError:
                        pass
                    continue
                if text.startswith("~S ") or text.startswith("~P "):  # 操作画面用の状態の行。画面には出さない
                    try:
                        import rhythm_server as _rs
                        if text.startswith("~S "):
                            parsed = _rs.parse_state_line(text)
                            if parsed is not None:
                                with ui_lock:
                                    ui_state["seq"] += 1
                                    seq = ui_state["seq"]
                                    ui_state["s"], ui_state["s_time"], ui_state["s_seq"] = parsed, time.time(), seq
                                if ui_hub is not None:   # 駒の置き換えなど、ESP32 から自分で送ってきた状態も、画面にすぐ流す
                                    ui_hub.publish({"type": "state", "s": parsed, "seq": seq, "sid": ui_state["sid"], "t": int(time.time() * 1000)})
                        else:
                            parsed = _rs.parse_pattern_line(text)
                            if parsed is not None:
                                with ui_lock:
                                    ui_state["patterns"][parsed["kind"]][parsed["id"]] = parsed
                    except ImportError:
                        pass
                    continue
                if text.startswith(BRIDGE_PREFIX):
                    try:
                        data = parse_bridge_line(text)
                        send_midi(split_messages(data))
                        if args.verbose:
                            console.line("  [MIDI] " + text[len(BRIDGE_PREFIX):].strip())
                    except ValueError:
                        console.line("  （MIDIの行を読めませんでした: %r）" % text)
                    continue
                console.line(text)
                if "[READY]" in text:
                    # ESP32 の起動が終わった。MIDI を、このブリッジに出すよう頼む。「つながっています」の合図（PING）も、すぐ送る
                    # （駒の最初の読み取りより前に届けば、ブザーのアルペジオが、1回も鳴らない）
                    state["ready_seen"] = True
                    send_line("PING")
                    threading.Timer(0.3, lambda: send_line("MIDI BRIDGE")).start()

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    if args.daemon:
        threading.Thread(target=port_watcher, daemon=True).start()

    # ポートを開いただけで ESP32 がリセットされないこともあるので、起動の合図が来なければ、こちらから頼む
    def late_request():
        time.sleep(2.5)
        if not state["ready_seen"] and not stop.is_set():
            send_line("MIDI BRIDGE")

    def start_late_request():
        threading.Thread(target=late_request, daemon=True).start()

    start_late_request()

    def ui_worker():
        # 編集画面から届いたコマンドを、1行ずつ ESP32 に送る（保存に時間がかかるので、間をあける）。複数の保存が混ざらないよう、1つずつ
        while not stop.is_set():
            try:
                lines, delay = ui_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            for line in lines:
                if stop.is_set():
                    break
                console.line("> " + line)
                send_line(line)
                time.sleep(delay)
            with ui_lock:
                ui_state["refresh"] = True   # 保存したパターンを、操作画面の一覧に反映する

    threading.Thread(target=ui_worker, daemon=True).start()

    # ---- 操作画面とのつなぎ ----
    def ui_control(lines):
        for line in lines:
            send_line(line)   # BPM・キーなどは、待たずに、すぐ送る
        with ui_lock:
            ui_state["poke"] = True  # すぐ状態を読み直して、画面に反映する

    def ui_get_state():
        now = time.time()
        with ui_lock:
            ui_state["wanted"] = now   # 画面が見ている間だけ、状態を読みに行く
            s = ui_state["s"]
            info = ui_state["step_info"]
            if s is not None and info is not None and info["seq"] > ui_state["s_seq"]:
                s = dict(s)   # STATE の返事より、あとに届いたステップの合図のほうが新しい
                s["step"], s["playing"] = info["step"], info["playing"]
            return {"connected": ui_state["s"] is not None and now - ui_state["s_time"] < 3.0, "age": now - ui_state["s_time"],
                    "s": s, "s_seq": ui_state["s_seq"], "patterns": ui_state["patterns"], "seq": ui_state["seq"], "sid": ui_state["sid"],
                    "game_clients": state["game_clients"], "midi_muted": state["midi_muted"],
                    "serial": {"open": bool(conn["ok"]), "daemon": bool(args.daemon), "released": link["released"], "port": link["port"], "busy": link["busy"]}}

    def ui_refresh():
        with ui_lock:
            ui_state["refresh"] = True

    def on_game_clients(n):
        # ゲームの画面が1つでもつながっている間は、MIDI を止める。止めた瞬間に、鳴りっぱなしの音を消す
        was = state["midi_muted"]
        state["game_clients"] = n
        state["midi_muted"] = n > 0
        if state["midi_muted"] and not was:
            muted_now = state["midi_muted"]
            state["midi_muted"] = False
            send_midi(PANIC_MESSAGES)      # All Notes Off を出してから、止める
            state["midi_muted"] = muted_now
            console.line("ゲームの画面がつながったので、MIDI の出力を止めました（音はゲームが鳴らします）")
        elif was and not state["midi_muted"]:
            console.line("ゲームの画面が閉じたので、MIDI の出力を戻しました")

    if ui_hub is not None:
        ui_hub.on_game_clients = on_game_clients

    ui_hooks.update({"control": ui_control, "get_state": ui_get_state, "refresh": ui_refresh, "bridge": lambda action: bridge_release() if action == "release" else bridge_connect()})

    def ui_poller():
        # 画面が開いている間だけ、約0.7秒ごとに STATE を頼む。自分のパターン（11〜20）の中身は、必要なときだけ、少しずつ頼む
        last_state = 0.0
        last_list = 0.0
        while not stop.is_set():
            time.sleep(0.1)
            now = time.time()
            with ui_lock:
                active = now - ui_state["wanted"] < 5.0
                poke = ui_state["poke"]
                want_list = ui_state["refresh"] or (now - last_list > 30.0)
                if poke:
                    ui_state["poke"] = False
            if not active:
                continue
            if poke or now - last_state > 0.7:
                send_line("STATE")
                last_state = now
            if want_list:
                with ui_lock:
                    ui_state["refresh"] = False
                last_list = now
                for kind in ("drum", "backing"):
                    for ident in range(11, 21):
                        if stop.is_set():
                            break
                        send_line("STATE PATTERN %s %d" % (kind, ident))
                        time.sleep(0.05)   # ESP32 の送信を詰まらせない（再生中の音のタイミングを守る）

    threading.Thread(target=ui_poller, daemon=True).start()

    def heartbeat():
        # つながっている間、約1秒ごとに PING を送る。ESP32 は、PING が届いている間は「ブリッジがつながっていて、Mac が音を鳴らす」と考えて、
        # 基板のブザーのアルペジオを鳴らさない（Mac の音とぶつかるし、鳴り終わるまで、駒の読み取りと画面への知らせが遅れるため）。
        # 解除したり、Serial Monitor に譲ったり（ポートを閉じる）すると、送らなくなる → 約2.5秒で、ESP32 のブザーが、元どおり鳴る状態に戻る
        while not stop.is_set():
            try:
                send_line("PING")       # つながっていない間は、send_raw が何もしない
            except Exception:           # 終わるときに、ポートを閉じる瞬間と重なっても、例外を出さずに、静かに終わる
                return
            stop.wait(1.0)

    threading.Thread(target=heartbeat, daemon=True).start()

    def panic():
        send_midi(PANIC_MESSAGES)

    def load_file(name):
        if not name:
            console.line("使い方: !load ファイル名   （ファイルの中の、空行と # で始まる行以外を、1行ずつ ESP32 に送ります）")
            return
        here = os.path.dirname(os.path.abspath(__file__))
        path = None
        for cand in (os.path.expanduser(name), os.path.join(here, "patterns", name)):
            if os.path.isfile(cand):
                path = cand
                break
        if path is None:
            console.line("ファイル「%s」が見つかりません。（tools/patterns/ の中も探しました）" % name)
            return
        try:
            with open(path, encoding="utf-8") as f:
                lines = parse_command_file(f.read())
        except (OSError, UnicodeDecodeError) as e:
            console.line("ファイルを読めませんでした: %s" % e)
            return
        console.line("%s の %d 行を送ります（止めるには Ctrl+C）。" % (path, len(lines)))
        for line in lines:
            if stop.is_set():
                break
            console.line("> " + line)
            send_line(line)
            time.sleep(LOAD_DELAY_S)
        console.line("ファイルの送信が終わりました。")

    def handle_command(line):
        """ 打たれた1行を処理する。終わるなら False """
        line = line.strip()
        if line == "!quit":
            return False
        if line == "!panic":
            panic()
            console.line("（すべての音を止めました）")
        elif line == "!help":
            console.line("ブリッジのコマンド: !panic（鳴りっぱなしの音を止める） / !load ファイル名（ファイルのコマンドを順に送る） / !quit（終了）。")
            console.line("それ以外は ESP32 に送ります（HELP で、ESP32 のコマンド一覧）。")
        elif line == "!load" or line.startswith("!load "):
            load_file(line[5:].strip())
        elif line.startswith("!"):
            console.line("ブリッジのコマンドではありません（!help で一覧）。")
        elif line:
            send_line(line)
        return True

    def tty_loop():
        # 端末を「1文字ずつ」読む設定にして、行の最初の + - ] [ を、Enter なしで送る
        import termios
        import tty
        fd = sys.stdin.fileno()
        saved = termios.tcgetattr(fd)
        editor = LineEditor()
        console.editor = editor
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            tty.setcbreak(fd)  # Ctrl+C は、そのまま効く
            while not stop.is_set():
                ready, _, _ = select.select([fd], [], [], 0.2)
                if not ready:
                    continue
                data = os.read(fd, 1024)
                if not data:
                    return
                for ch in decoder.decode(data):
                    for ev in editor.feed(ch):
                        if ev[0] == "key":
                            send_raw(ev[1])
                        elif ev[0] == "echo":
                            console.raw(ev[1])
                        elif ev[0] == "erase":
                            console.raw("\b \b" * ev[1])
                        elif ev[0] == "line":
                            console.raw("\n")
                            if not handle_command(ev[1]):
                                return
                        elif ev[0] == "quit":
                            return
        finally:
            console.editor = None
            termios.tcsetattr(fd, termios.TCSADRAIN, saved)

    def line_loop():
        # 端末ではない入力（パイプなど）: 1行ずつ読む
        while not stop.is_set():
            try:
                line = input()
            except EOFError:
                return
            if not handle_command(line):
                return

    try:
        if args.daemon:
            while not stop.is_set():   # 常駐モード: 端末からの入力は使わない。画面（ブラウザ）と ESP32 を仲立ちし続ける
                time.sleep(0.5)
        elif use_tty:
            tty_loop()
        else:
            line_loop()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        try:
            send_line("STOP")
            send_line("MIDI OFF")
            time.sleep(0.2)
        except Exception:
            pass
        for out in outs:  # 念のため、すべての音を止める
            if out is not None:
                for m in PANIC_MESSAGES:
                    out.send_message(m)
        for extra in extra_outs:
            for m in PANIC_MESSAGES:
                extra.send_message(m)
        if ui_hub is not None:
            ui_hub.close()   # つないでいる画面の「出来事の待ち受け」を終わらせる（終了が引っかからないように）
        if ui_server is not None:
            ui_server.shutdown()
        ser.close()
        for out in outs + extra_outs:
            if out is not None:
                out.close_port()
        print("\n終了しました。")
    return 0


def main():
    # 表示を1行ごとにすぐ出す（パイプやVS Codeのタスクにつないでも、遅れないように）
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(description="ESP32 → PC MIDI ブリッジ")
    ap.add_argument("--port", help="ESP32 のシリアルポート（省略すると自動で探す）")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--name", default="ESP32 Chord Prototype", help="仮想MIDIポートの名前")
    ap.add_argument("--drums", choices=DRUMS_MODES, default="merge",
                    help="ドラム（チャンネル10）の送り先。merge: ピアノと同じポート（標準） / split: 別の仮想ポート「<名前> Drums」 / off: 送らない")
    ap.add_argument("--to", action="append", metavar="名前",
                    help="すでにある MIDI の宛先にも直接送る（名前の一部。例: --to GarageBand で、GarageBand の「仮想入力」）。複数回指定できる")
    ap.add_argument("--ui-port", type=int, default=8765, help="リズム編集画面のポート番号（標準 8765）")
    ap.add_argument("--no-ui", action="store_true", help="リズム編集画面を始めない")
    ap.add_argument("--test", action="store_true", help="ESP32 なしで、テストの和音を鳴らす")
    ap.add_argument("--list", action="store_true", help="シリアルポートの一覧を表示して終わる")
    ap.add_argument("--daemon", action="store_true", help="常駐モード: 端末の入力を使わず、ESP32 がつながるのを待ち、抜き差ししても、つなぎ直す（ログイン時に自動で動かす用。tools/chordtoy_agent.sh）")
    ap.add_argument("-v", "--verbose", action="store_true", help="受け取った MIDI を表示する")
    args = ap.parse_args()

    if args.list:
        import serial.tools.list_ports
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            print("シリアルポートが見つかりません。")
        for p in ports:
            print("%s  VID:PID=%s:%s  %s" % (p.device, "%04X" % p.vid if p.vid else "----", "%04X" % p.pid if p.pid else "----", p.description))
        return 0

    if args.test:
        midi_out = open_midi_out(args.name)
        print("仮想MIDIポート「%s」を作りました。" % args.name)
        print("GarageBand で、ピアノの音色のトラックを作り、この MIDI が入ってくるか確認してください。")
        run_demo(midi_out)
        midi_out.close_port()
        return 0

    return run_bridge(args)


if __name__ == "__main__":
    sys.exit(main())
