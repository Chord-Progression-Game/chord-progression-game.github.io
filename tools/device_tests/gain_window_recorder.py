#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機の「飛行記録」: 各リーダーが、どのタグを、どの受信感度の範囲で読めるかを、変わったときだけ、時刻つきで記録する。
  ・基板のテストモード（x）の連続モニター（n）を使う。1周 約1.3秒。
  ・駒を動かす人は、何も打たなくてよい。記録が終わると、通常の動作（再生）に戻す。
  ・記録の例:  [  12.4] R3:B[33-38] R5:A[18-38] R6:A[33-48]
      R5:A[18-38] = リーダー5 はタグ A を 18〜38dB で読める（43dB 以上は信号が強すぎて読めない = 飽和。駒の真下の印）
      R6:A[33-48] = リーダー6 も A を読むが、33dB 以上が必要で、48dB でも読める（隣の駒を読んでいる = 影の印）
使い方（先に  sh tools/chordtoy_agent.sh stop  で常駐ブリッジを止める。ポートを開くと基板が再起動する）:
  tools/.venv/bin/python tools/device_tests/gain_window_recorder.py 秒数 記録ファイル
"""
import glob
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
buf = b""


def read_for(sec, show=None):
    """sec 秒のあいだ読む。行ごとに show(行) を呼ぶ"""
    global buf
    end = time.time() + sec
    while time.time() < end:
        d = ser.read(1)
        if d:
            buf += d + ser.read(ser.in_waiting)
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").rstrip("\r")
                if show and not line.startswith("~"):
                    show(line)


read_for(8)                      # 起動の表示
ser.write(b"STOP\n")
read_for(1.5)
ser.write(b"x\n")
read_for(1.5)
ser.write(b"n\n")                # 連続モニターを始める
T0 = time.time()
OUT.write("[  0.0] 記録を始めました（基板を再起動しました）\n")


def show(line):
    line = line.strip()
    if line.startswith("["):
        OUT.write("%s  (実時刻 %s)\n" % (line, time.strftime("%H:%M:%S")))


read_for(DURATION, show)
ser.write(b"n\n")                # モニターを止める
read_for(2.0)
ser.write(b"q\n")                # テストモードを終える
read_for(1.5)
ser.write(b"START\n")            # 通常の動作（再生）に戻す
read_for(1.5)
OUT.write("終わり（通常の動作に戻しました）\n")
ser.close()
