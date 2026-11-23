#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
企画書（INT 261111）の「技（トリック）」が、いまの駒（src/chords.cpp のコード表）だけで表せるかを調べる。
  ・2つのコードのつながり（技）が、何通りあるか／必要な最小レベル
  ・名前の付いた進行（2-5-1、小室、王道、丸サ、カノン…）を、いまの表で作れるか
  ・駒を、ランダムに並べたとき、技がどれくらい出るか（難しさの見積もり）
実行:  python3 tools/game_lab/trick_coverage.py            （コード表は src/chords.cpp）
注意:  技の定義は、このスクリプトの中の「仮の定義」。ゲームの正式な技の定義ではない（決めるのは、あなたと音楽の分かる人）。
       ランダムの試しは、駒を1種類につき1枚として（同じ駒は2回使わない）、最後→最初のつながりも数える。
"""
import os
# 既存のコード表（chords.cpp）から、企画書の「技法」が、いまの駒だけで表せるかを調べる使い捨てのスクリプト
import re, sys, random, itertools
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'chords.cpp')
src = open(PATH, encoding='utf-8').read()
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
TYPES = {  # ルートからの半音数（chords.cpp の CHORD_TYPES と同じ。3和音の4音目は省く）
 'CT_MAJOR': (0,4,7), 'CT_MINOR': (0,3,7), 'CT_MAJ7': (0,4,7,11), 'CT_DOM7': (0,4,7,10), 'CT_MIN7': (0,3,7,10),
 'CT_MIN7B5': (0,3,6,10), 'CT_DIM7': (0,3,6,9), 'CT_MIN6': (0,3,7,9), 'CT_SUS47': (0,5,7,10), 'CT_SUS4': (0,5,7,12)}
rows = re.findall(r'\{(\d+),\s*(\d+),\s*"([^"]+)",\s*(\d+),\s*([+-]?\d+),\s*\d+,\s*(CT_[A-Z0-9]+)\}', src)
chords = []
for cid, lv, name, deg, acc, typ in rows:
    if typ == 'CT_REPEAT': continue
    root = (MAJOR_SCALE[int(deg)-1] + int(acc)) % 12
    chords.append(dict(id=int(cid), lv=int(lv), name=name, root=root, typ=typ, pcs=frozenset((root+s) % 12 for s in TYPES[typ])))
print('コードの数:', len(chords), ' （「→」を除く）')
by_name = {c['name']: c for c in chords}
DIA = set(MAJOR_SCALE)
for c in chords: c['out'] = len(c['pcs'] - DIA)          # 長音階の外の音の数（＝色の濃さ）
maj = {'CT_MAJOR','CT_MAJ7'}; mn = {'CT_MINOR','CT_MIN7','CT_MIN6'}
def E_dom(a,b):   return a['typ']=='CT_DOM7' and a['root']==7 and b['root']==0 and b['typ'] in maj          # ドミナントモーション
def E_ura(a,b):   return a['typ']=='CT_DOM7' and a['root']==1 and b['root']==0 and b['typ'] in maj          # 裏コード（♭Ⅱ7→Ⅰ）
def E_sec(a,b):   return a['typ']=='CT_DOM7' and a['root'] in (0,2,4,9,11) and b['root']==(a['root']+5)%12 and b['typ']!='CT_DOM7'   # セカンダリードミナント
def E_decep(a,b): return a['root']==7 and a['typ'] in maj|{'CT_DOM7'} and b['root']==9 and b['typ'] in mn   # 偽終止
def E_plagal(a,b):return a['root']==5 and a['typ'] in maj|mn and b['root']==0 and b['typ'] in maj           # 変格終止
def E_fifth(a,b): return (b['root']-a['root'])%12==5                                                       # 強進行（5度下行）
EDGES = [('ドミナントモーション Ⅴ7→Ⅰ',E_dom),('裏コード ♭Ⅱ7→Ⅰ',E_ura),('セカンダリードミナント Ⅱ7→Ⅴ など',E_sec),('偽終止 Ⅴ→Ⅵm',E_decep),('変格終止 Ⅳ→Ⅰ',E_plagal)]
print('\n=== 2つのコードのつながり（技法）: 使える組み合わせの数（同じ駒を並べない 28×27=756 通りのうち）と、必要な最小レベル')
for label, f in EDGES:
    pairs = [(a,b) for a in chords for b in chords if a is not b and f(a,b)]
    mlv = min((max(a['lv'],b['lv']) for a,b in pairs), default=None)
    ex = ', '.join('%s→%s' % (a['name'],b['name']) for a,b in pairs[:3])
    print('  %-34s %3d通り  最小レベル=%s  例: %s' % (label, len(pairs), mlv if mlv else '—（駒がない）', ex or '—'))
def seq(names): return [by_name.get(n) for n in names]
def need(names):
    s = seq(names); return None if any(x is None for x in s) else max(x['lv'] for x in s)
print('\n=== 3つ以上の並び（名前の付いた進行）')
LINES = [('2-5-1（Ⅱm7→Ⅴ7→ⅠM7）',['Ⅱm7','Ⅴ7','ⅠM7']), ('カデンツ（Ⅳ→Ⅴ→Ⅰ）',['Ⅳ','Ⅴ','Ⅰ']), ('バックドア（Ⅳm7→Ⅶ♭7→ⅠM7）',['Ⅳm7','Ⅶ♭7','ⅠM7']),
         ('ナポリ（Ⅱ♭M7→Ⅴ7→ⅠM7）',['Ⅱ♭M7','Ⅴ7','ⅠM7']), ('小室進行 6451（Ⅵm→Ⅳ→Ⅴ→Ⅰ）',['Ⅵm','Ⅳ','Ⅴ','Ⅰ']),
         ('王道進行 4536（ⅣM7→Ⅴ7→Ⅲm7→Ⅵm）',['ⅣM7','Ⅴ7','Ⅲm7','Ⅵm']), ('丸サ進行・短い形（ⅣM7→Ⅲ7→Ⅵm7→Ⅰ7）',['ⅣM7','Ⅲ7','Ⅵm7','Ⅰ7']), ('丸サ進行・長い形 4365(1)（ⅣM7→Ⅲ7→Ⅵm7→Ⅴm7→Ⅰ7）',['ⅣM7','Ⅲ7','Ⅵm7','Ⅴm7','Ⅰ7']),
         ('カノン進行（Ⅰ→Ⅴ→Ⅵm→Ⅲm→Ⅳ→Ⅰ→Ⅳ→Ⅴ）= 8コード',['Ⅰ','Ⅴ','Ⅵm','Ⅲm','Ⅳ','Ⅰ','Ⅳ','Ⅴ'])]
for label, names in LINES:
    n = need(names); print('  %-46s %s' % (label, ('表だけで作れる（最小レベル %d）' % n) if n else '作れない（表にない駒: %s）' % [x for x in names if x not in by_name]))
# 企画書の「4365」「6451」を度数の数字として読み直す（Ⅲ は Ⅲ7 か Ⅲm7 か、という疑問）
print('\n=== 長音階の外の音を含む駒（＝「色」が濃い駒）')
print('  ', ', '.join('%s(%d)' % (c['name'], c['out']) for c in sorted(chords, key=lambda c: -c['out']) if c['out']))
print('  長音階の中だけの駒:', ', '.join(c['name'] for c in chords if not c['out']))
# ランダムに並べたとき、技がどれくらい出るか（難しさの見積もり）
random.seed(1)
def board_tricks(order):
    cnt = {l:0 for l,_ in EDGES}; tot = 0
    n = len(order)
    for i in range(n):                       # ループなので、最後→最初もつながる
        a, b = order[i], order[(i+1) % n]
        for label, f in EDGES:
            if f(a,b): cnt[label] += 1
    return cnt
print('\n=== ランダムに並べたら、技はどれくらい出るか（駒の種類ごとに 20万回の試し。最後→最初のつながりも数える）')
for L in (1,2,3,4,5):
    pool = [c for c in chords if c['lv'] <= L]
    k = min(8, len(pool)); anyc = 0; tot = 0; N = 200000
    for _ in range(N):
        order = random.sample(pool, k)
        c = board_tricks(order); s = sum(c.values()); tot += s; anyc += (s > 0)
    print('  レベル1〜%d（駒%2d種、並べる数%d）: 技が1つ以上ある確率 %5.1f%%、1枚の盤での技の数の平均 %.2f' % (L, len(pool), k, 100*anyc/N, tot/N))
