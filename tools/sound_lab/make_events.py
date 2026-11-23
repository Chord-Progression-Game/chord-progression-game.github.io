#!/usr/bin/env python3
"""実機から録った MIDI（capture.json: [[秒, [バイト…]], …]）を、
   (1) render.cpp 用の events.txt（1行 = 秒 + MIDIメッセージ1つ）
   (2) ESP32 に埋め込む events.h
   にする。capture.json は、ESP32 が出す「~M ..」の行を時刻つきで記録したもの。"""
import json, sys
ev = json.load(open(sys.argv[1]))
with open('events.txt', 'w') as f:
    for t, b in ev:
        i = 0
        while i < len(b):
            st = b[i]
            if st < 0x80: i += 1; continue
            n = 2 if (st & 0xF0) in (0x80, 0x90, 0xA0, 0xB0, 0xE0) else 1
            f.write('%.4f %s\n' % (t, ' '.join(str(x) for x in b[i:i+1+n])))
            i += 1 + n
rows = []
for line in open('events.txt'):
    p = line.split(); t = float(p[0]); b = [int(x) for x in p[1:]]; st = b[0] & 0xF0; at = int(round(t * 44100))
    if st == 0x90 and len(b) >= 3 and b[2] > 0: rows.append((at, b[0], b[1], b[2]))
    elif st in (0x80, 0x90) and len(b) >= 2: rows.append((at, (b[0] & 0x0F) | 0x80, b[1], 0))
    elif st == 0xB0 and len(b) >= 3 and b[1] == 123: rows.append((at, b[0], 123, 0))
rows.sort(key=lambda r: r[0])
with open('events.h', 'w') as f:
    f.write('struct Ev { uint32_t at; uint8_t st, d1, d2; };\nstatic const Ev EVS[] = {\n')
    for r in rows: f.write('  {%d, 0x%02X, %d, %d},\n' % r)
    f.write('};\nstatic const int NEV = %d;\n' % len(rows))
print('events.txt / events.h を作りました（%d イベント）' % len(rows))
