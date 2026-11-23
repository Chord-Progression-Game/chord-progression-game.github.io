#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機の盤面の見張り（受け身の記録）。駒を動かしている間、盤面がどう見えているかを、変わったときだけ、時刻つきで記録する。
  ・2秒おきに STATUS を送って、「位置N のコード」と「影のリーダー」を読み取る
  ・「駒が置かれました／外れました」の知らせ（イベント）も、そのまま記録する
  ・影の判定（SHADOWLOG）も記録する
  ・駒を動かす人は、何も打たなくてよい（この見張りが記録している間、ふつうに駒を置いたり外したりする）
使い方（先に  sh tools/chordtoy_agent.sh stop  で常駐ブリッジを止める。ポートを開くと基板が再起動する）:
  tools/.venv/bin/python tools/device_tests/board_watch.py 秒数 記録ファイル
記録の例:
  [  12.4] 盤面: 位置2=ⅠM7 位置5=Ⅱ7  影: リーダー6←リーダー5
  [  31.0] 知らせ: [位置6] 駒が置かれました: Ⅱ7
"""
import glob
import re
import sys
import time

import serial

DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
OUT = open(sys.argv[2], "w", buffering=1, encoding="utf-8") if len(sys.argv) > 2 else sys.stdout
PORT = (glob.glob("/dev/cu.usbmodem*") or [None])[0]
if PORT is None:
    print("ESP32 のポートが見つかりません")
    sys.exit(2)

ser = serial.Serial(PORT, 115200, timeout=0.1)
ser.dtr = False
ser.rts = True
time.sleep(0.15)
ser.rts = False
T0 = time.time()
buf = b""
last_sig = None
pos = {}
shadows = {}
in_status = False


def log(text):
    OUT.write("[%6.1f] %s\n" % (time.time() - T0, text))


def handle_line(line):
    global last_sig, pos, shadows, in_status
    if line.startswith("~"):
        return
    if "=== STATUS ===" in line:
        in_status = True
        pos, shadows = {}, {}
        return
    if re.search(r"\[位置\d\] 駒が(置かれました|交換されました|外れました)", line):
        log("知らせ: " + line.strip())
        return
    if "[影の判定]" in line:
        log("判定: " + line.strip().replace("[影の判定] ", ""))
        return
    m = re.match(r"^(?:▶ |  )位置(\d): (.*)$", line)
    if m and in_status:
        n = int(m.group(1))
        body = m.group(2)
        if body.startswith("（空）") or body.startswith("(空)"):
            pos[n] = "空"
        elif body.startswith("未登録"):
            pos[n] = "未登録"
        else:
            pos[n] = body.split("  ")[0].split(" ")[0]
        sm = re.search(r"リーダー(\d) は、リーダー(\d) の駒を読んでいますが", body)
        if sm:
            shadows[int(sm.group(1))] = int(sm.group(2))
        if n >= 8 or (len(pos) >= 8):
            in_status = False
            sig = " ".join("位置%d=%s" % (k, v) for k, v in sorted(pos.items()) if v != "空")
            sh = " ".join("リーダー%d←リーダー%d" % (a, b) for a, b in sorted(shadows.items()))
            full = (sig or "（駒なし）") + ("  影: " + sh if sh else "")
            if full != last_sig:
                log("盤面: " + full)
                last_sig = full


next_status = time.time() + 9.0   # 起動の表示が落ち着いてから
shadowlog_sent = False
log("見張りを始めました（基板を再起動しました）")
while time.time() - T0 < DURATION:
    d = ser.read(1)
    if d:
        buf += d + ser.read(ser.in_waiting)
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            handle_line(raw.decode("utf-8", "replace").rstrip("\r"))
    if time.time() >= next_status:
        if not shadowlog_sent:
            ser.write(b"SHADOWLOG ON\n")   # 影の判定（持ち主を比べ読みで決めた結果）も記録する
            shadowlog_sent = True
        ser.write(b"STATUS\n")
        next_status = time.time() + 2.0
log("終わり")
ser.close()
