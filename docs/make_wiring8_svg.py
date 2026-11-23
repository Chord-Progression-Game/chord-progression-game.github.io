#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""8台版の「個別の2本」の配線図（docs/wiring_8readers.svg）を作る。ピン番号は README 3-7 と同じ。
   共通の5本（3.3V / GND / SCK / MOSI / MISO）は、4台版（wiring_4readers.svg の図①）と同じ考え方で、8台ぶんに枝分かれさせる。"""
import html

READERS = [(1, 10, 5, False), (2, 4, 8, False), (3, 6, 9, False), (4, 7, 1, False),
           (5, 15, 42, True), (6, 16, 41, True), (7, 17, 47, True), (8, 18, 21, True)]   # (番号, SDA, RST, 今回増やす台か)
SDA_C, RST_C = "#8e44ad", "#e67e22"
W, H = 1300, 1010
o = []
def add(s): o.append(s)
def t(x, y, s, size=14, anchor="start", weight="normal", fill="#111"):
    add('<text x="%s" y="%s" font-size="%s" text-anchor="%s" font-weight="%s" fill="%s">%s</text>' % (x, y, size, anchor, weight, fill, html.escape(s)))

add('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="Hiragino Sans, Noto Sans JP, Arial, sans-serif">' % (W, H, W, H))
add('<rect width="100%" height="100%" fill="#ffffff"/>')
t(20, 34, "RC522 ×8 の配線図（個別の2本: SDA と RST）", 26, weight="bold")
t(20, 60, "リーダー1〜4 は、これまでの配線のまま。リーダー5〜8（太い枠）を、新しくつなぐ。実線 = SDA、破線 = RST。", 14, fill="#444")
t(20, 84, "共通の5本（3.3V / GND / SCK / MOSI / MISO）は、8台すべてに同じ線を枝分かれさせる（README 3-7）。IRQ は、どこにもつながない。", 14, fill="#444")

ex, ey, ew = 20, 110, 270
add('<rect x="%d" y="%d" width="%d" height="%d" rx="12" fill="#fbe9e7" stroke="#c0392b" stroke-width="3"/>' % (ex, ey, ew, 830))
t(ex + ew / 2, ey + 26, "ESP32-S3 基板", 16, "middle", "bold")
rx = 760
for k, (n, ss, rst, new) in enumerate(READERS):
    for j, (pin, gpio, col, dash) in enumerate((("SDA", ss, SDA_C, ""), ("RST", rst, RST_C, 'stroke-dasharray="9 5"'))):
        y = ey + 60 + (2 * k + j) * 48
        add('<rect x="%d" y="%d" width="%d" height="34" rx="6" fill="%s" stroke="%s" stroke-width="%d"/>' % (ex + 12, y - 17, ew - 24, "#fff7e0" if new else "#fff", col, 4 if new else 3))
        t(ex + 24, y + 5, "GPIO%d" % gpio, 15, weight="bold")
        t(ex + ew - 24, y + 5, "リーダー%d の %s" % (n, pin), 12, "end", fill="#555")
        add('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="3.2" %s/>' % (ex + ew - 12, y, rx, y, col, dash))
        add('<circle cx="%d" cy="%d" r="5.5" fill="%s"/>' % (rx, y, col))
        add('<rect x="%d" y="%d" width="70" height="34" rx="4" fill="#fff" stroke="%s" stroke-width="2.5"/>' % (rx, y - 17, col))
        t(rx + 35, y + 5, pin, 14, "middle", "bold")
    y_top = ey + 60 + (2 * k) * 48 - 26
    add('<rect x="%d" y="%d" width="330" height="98" rx="10" fill="none" stroke="#2c5aa0" stroke-width="%d"/>' % (rx - 8, y_top, 5 if new else 2.5))
    t(rx + 90, ey + 60 + (2 * k) * 48 + 5, "RC522 リーダー%d%s" % (n, "（追加）" if new else ""), 15, weight="bold", fill="#2c5aa0")
    t(rx + 90, ey + 60 + (2 * k + 1) * 48 + 5, "SDA（実線）と RST（破線）", 12, fill="#444")
t(20, H - 40, "※ 「どことどこがつながるか」の図です。ブレッドボード上の実際の位置ではありません。", 13, fill="#444")
t(20, H - 18, "避けるピン: 0・3・45・46（起動の設定）/ 19・20（USB）/ 35〜37（PSRAM）/ 43・44（シリアル）/ 14（ブザー）/ 11〜13（共通のSPI）/ 48（基板のLED）", 13, fill="#444")
add('</svg>')
open("wiring_8readers.svg", "w", encoding="utf-8").write("\n".join(o))
print("wiring_8readers.svg を作りました")
