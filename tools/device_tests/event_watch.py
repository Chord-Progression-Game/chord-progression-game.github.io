#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機の「駒の知らせ」の記録（受け身。駒を動かす人は、何も打たなくてよい）。
  ・「駒が置かれた／外れた／交換された」と知らせられた瞬間を、時刻つきで、**原因つき**で記録する。
      例:  [  31.20] 位置2（リーダー3）: 外れた ［→］   原因=駒が、続けて読めなくなった（3回続けて・97 ms）
  ・盤面（~S の行）が変わったところだけ、前との違いを出す。
  ・SHADOWLOG ON にして、影の判定（比べ読みの得点）と、イベントの原因（[イベントの原因]）も、そのまま記録する。
  ・「駒を動かしていないのに、別の位置の駒が、外れた → 置かれた と知らせられる」ような不具合の、原因調べ用。
使い方（先に、ブリッジを解除する。sh tools/bridge_release.sh。ポートを開くと基板が再起動する。終わったら sh tools/bridge_connect.sh）:
  tools/.venv/bin/python tools/device_tests/event_watch.py 秒数 記録ファイル [ping]
  ping を付けると、ブリッジのように、約1秒ごとに PING を送る（基板は「ブリッジがつながっている」と考えて、ブザーを鳴らさない）。
  付けないと、駒を読むたびに、基板のブザーのアルペジオが鳴る（ブザーが読み取りに影響するかの、切り分け用）。
"""
import glob
import re
import sys
import time

import serial

DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
OUT = open(sys.argv[2], "w", buffering=1, encoding="utf-8") if len(sys.argv) > 2 else sys.stdout
SEND_PING = "ping" in sys.argv[3:]
PORT = (glob.glob("/dev/cu.usbmodem*") or [None])[0]
if PORT is None:
    print("ESP32 のポートが見つかりません")
    sys.exit(2)

ser = serial.Serial(PORT, 115200, timeout=0.05)
ser.dtr = False
ser.rts = True
time.sleep(0.15)
ser.rts = False
T0 = time.time()
buf = b""
prev_chords = None
map_ = None
ready = False
sent_shadow = False


def log(text):
    OUT.write("[%6.2f] %s\n" % (time.time() - T0, text))


def parse_state(line):
    """ ~S の行 → (位置ごとの駒の名前の並び, 位置→リーダーの並び) """
    m = re.search(r"map=([\d,]+)", line)
    mp = [int(x) for x in m.group(1).split(",")] if m else None
    m = re.search(r"chords=(.*)$", line)
    if not m:
        return None, mp
    names = []
    for item in m.group(1).split(";"):
        names.append(item.split(",")[0] or "-")
    return names, mp


def handle(line):
    global prev_chords, map_, ready, sent_shadow
    line = line.rstrip("\r")
    if line.startswith("~S "):
        names, mp = parse_state(line)
        if mp:
            map_ = mp
        if names:
            if prev_chords is None:
                log("盤面（最初）: " + " ".join("%d:%s" % (i + 1, n) for i, n in enumerate(names)))
            else:
                for i, (a, b) in enumerate(zip(prev_chords, names)):
                    if a != b:
                        rd = ("（リーダー%d）" % map_[i]) if map_ and i < len(map_) else ""
                        log("盤面: 位置%d%s  ［%s］ → ［%s］" % (i + 1, rd, a, b))
            prev_chords = names
        return
    if line.startswith("~"):
        return
    if "[READY]" in line:
        ready = True
        log("基板が起動しました（[READY]）")
        return
    if line.startswith("[イベントの原因]") or line.startswith("[影の判定]"):
        log(line.strip())
        return
    if "NFCタグを検出しました" in line:
        log("登録の画面: " + line.strip())
        return


last_ping = 0.0


def pump(sec):
    global buf, last_ping
    end = time.time() + sec
    while time.time() < end:
        if SEND_PING and time.time() - last_ping >= 1.0:
            ser.write(b"PING\n")
            last_ping = time.time()
        d = ser.read(1)
        if d:
            buf += d + ser.read(ser.in_waiting)
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                handle(raw.decode("utf-8", errors="replace"))


# 起動を待つ（ping のときは、起動の途中から PING を送り始める。ブリッジと同じ）
end_boot = time.time() + 12
while time.time() < end_boot and not ready:
    pump(0.2)
if not ready:
    log("※ 基板の起動の合図が見えませんでした（そのまま続けます）")
ser.write(b"SHADOWLOG ON\n")
time.sleep(0.2)
pump(0.5)
log("=== 記録を始めました。駒を動かしてください（%d 秒間）===" % DURATION)
OUT.flush()
t_end = time.time() + DURATION
last_status = 0
while time.time() < t_end:
    pump(0.2)
log("=== 記録を終わりました ===")
ser.write(b"SHADOWLOG OFF\n")
time.sleep(0.2)
ser.close()
