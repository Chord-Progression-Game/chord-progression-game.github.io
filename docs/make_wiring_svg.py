#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""配線図（docs/wiring_4readers.svg）を作る。ピン番号は src/config.h と src/reader_array.cpp と同じ。
   図①: 共通の5本（3.3V / GND / SCK / MOSI / MISO）…… 1本の線に、4台がぶら下がる
   図②: 個別の2本（SDA / RST）…… リーダーごとに別のGPIO"""
import html

W, H = 1500, 1010
SH = {"3V3": "#d62828", "GND": "#222222", "SCK": "#e9a800", "MOSI": "#2a9d3f", "MISO": "#1d6fd8"}
SDA_C, RST_C = "#8e44ad", "#e67e22"
READERS = [(1, 10, 5), (2, 4, 8), (3, 6, 9), (4, 7, 1)]
HEADER = ["3.3V", "RST", "GND", "IRQ", "MISO", "MOSI", "SCK", "SDA"]   # RC522 の基板の文字（左から）
SIG_OF = {"3.3V": "3V3", "GND": "GND", "MISO": "MISO", "MOSI": "MOSI", "SCK": "SCK"}

o = []
def add(s): o.append(s)
def t(x, y, s, size=14, anchor="start", weight="normal", fill="#111"):
    add('<text x="%s" y="%s" font-size="%s" text-anchor="%s" font-weight="%s" fill="%s">%s</text>' % (x, y, size, anchor, weight, fill, html.escape(s)))

add('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="Hiragino Sans, Noto Sans JP, Arial, sans-serif">' % (W, H, W, H))
add('<rect width="100%" height="100%" fill="#ffffff"/>')
t(20, 34, "RC522 ×4 の配線図", 26, weight="bold")
t(20, 60, "同じ色の線は、同じ信号。線が交わっていても、●（丸い点）がなければ、つながっていません。", 14, fill="#444")

# ============ 図① 共通の5本 ============
t(20, 100, "① 共通の5本（4台すべてに、同じ線を枝分かれさせる）", 19, weight="bold")
ex, ey, ew = 20, 115, 250
add('<rect x="%d" y="%d" width="%d" height="250" rx="12" fill="#fbe9e7" stroke="#c0392b" stroke-width="3"/>' % (ex, ey, ew))
t(ex + ew / 2, ey + 24, "ESP32-S3 基板", 16, "middle", "bold")
lanes = [("3V3", "3V3 ピン（左列の一番上）"), ("GND", "GND ピン（右列の一番下）"), ("SCK", "GPIO12"), ("MOSI", "GPIO11"), ("MISO", "GPIO13")]
lane_y = {}
for i, (sig, label) in enumerate(lanes):
    y = ey + 55 + i * 42
    lane_y[sig] = y
    add('<rect x="%d" y="%d" width="%d" height="30" rx="6" fill="#fff" stroke="%s" stroke-width="3"/>' % (ex + 12, y - 15, ew - 24, SH[sig]))
    t(ex + 24, y + 5, label, 14, weight="bold")
    # 線（ESP32 から右へ、いちばん右まで）
    add('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="4"/>' % (ex + ew - 12, y, 1430, y, SH[sig]))
    t(1440, y + 5, {"3V3": "3.3V", "GND": "GND"}.get(sig, sig), 14, weight="bold", fill=SH[sig])

rx_w, rx_gap, ry = 262, 14, 400
for k, (n, ss, rst) in enumerate(READERS):
    x0 = 310 + k * (rx_w + rx_gap)
    add('<rect x="%d" y="%d" width="%d" height="80" rx="10" fill="#e8f1fb" stroke="#2c5aa0" stroke-width="2.5"/>' % (x0, ry, rx_w))
    t(x0 + 10, ry + 70, "RC522 リーダー%d（位置%d）" % (n, n), 14, weight="bold")
    for j, name in enumerate(HEADER):
        cx = x0 + 22 + j * 31
        sig = SIG_OF.get(name)
        col = SH[sig] if sig else "#bbbbbb"
        add('<rect x="%d" y="%d" width="29" height="30" rx="4" fill="%s" stroke="%s" stroke-width="2.5"/>' % (cx - 14.5, ry + 8, "#fff" if sig else "#f0f0f0", col))
        t(cx, ry + 28, name.replace("3.3V", "3.3"), 8.5, "middle", "bold", "#111" if sig else "#999")
        if sig:
            y = lane_y[sig]
            add('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2.4"/>' % (cx, ry + 8, cx, y, col))
            add('<circle cx="%d" cy="%d" r="5.5" fill="%s"/>' % (cx, y, col))
t(310, ry + 106, "各リーダーの8つの四角は、RC522 の8ピン（基板の文字を、左から読んだ並び）。色のついた5つが、上の線につながる。", 13, fill="#444")
t(310, ry + 126, "灰色の RST と SDA は図②で、1台ごとに別のGPIOへつなぐ。IRQ は、どこにもつながない。", 13, fill="#444")

# ============ 図② 個別の2本 ============
oy = 560
t(20, oy, "② 個別の2本（リーダーごとに、別のGPIO。SDA と RST）", 19, weight="bold")
ex2, ey2 = 20, oy + 20
add('<rect x="%d" y="%d" width="%d" height="%d" rx="12" fill="#fbe9e7" stroke="#c0392b" stroke-width="3"/>' % (ex2, ey2, ew, 385))
t(ex2 + ew / 2, ey2 + 24, "ESP32-S3 基板", 16, "middle", "bold")
rows = []
for (n, ss, rst) in READERS:
    rows.append((n, "SDA", ss, SDA_C))
    rows.append((n, "RST", rst, RST_C))
rx2 = 760
for i, (n, pin, gpio, col) in enumerate(rows):
    y = ey2 + 55 + i * 40
    add('<rect x="%d" y="%d" width="%d" height="30" rx="6" fill="#fff" stroke="%s" stroke-width="3"/>' % (ex2 + 12, y - 15, ew - 24, col))
    t(ex2 + 24, y + 5, "GPIO%d" % gpio, 14, weight="bold")
    t(ex2 + ew - 24, y + 5, "リーダー%d" % n, 12, "end", fill="#555")
    add('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="3.2" %s/>' % (ex2 + ew - 12, y, rx2, y, col, 'stroke-dasharray="9 5"' if pin == "RST" else ""))
    add('<circle cx="%d" cy="%d" r="5.5" fill="%s"/>' % (rx2, y, col))
    add('<rect x="%d" y="%d" width="70" height="30" rx="4" fill="#fff" stroke="%s" stroke-width="2.5"/>' % (rx2, y - 15, col))
    t(rx2 + 35, y + 5, pin, 14, "middle", "bold")
for k, (n, ss, rst) in enumerate(READERS):
    y_top = ey2 + 55 + (2 * k) * 40 - 22
    add('<rect x="%d" y="%d" width="300" height="84" rx="10" fill="none" stroke="#2c5aa0" stroke-width="2.5"/>' % (rx2 - 8, y_top))
    t(rx2 + 90, ey2 + 55 + (2 * k) * 40 + 4, "RC522 リーダー%d（位置%d）" % (n, n), 15, weight="bold", fill="#2c5aa0")
    t(rx2 + 90, ey2 + 55 + (2 * k + 1) * 40 + 4, "SDA（実線）と RST（破線）", 12, fill="#444")
t(20, H - 22, "※ 「どことどこがつながるか」の図です。ブレッドボード上の実際の位置ではありません。手順と、1本ずつの対応表は README を見てください。", 13, fill="#444")
add('</svg>')
open("wiring_4readers.svg", "w", encoding="utf-8").write("\n".join(o))
print("wiring_4readers.svg を作りました")
