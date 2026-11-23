# -*- coding: utf-8 -*-
"""
音色の聞き比べ（第3弾）: 和音を同時に鳴らす演奏（バッキング=ロング、ドラム=8ビート）を、ピアノ・エレピ以外の音色で書き出す。
  GeneralUser GS の標準楽器 16種（GM の番号つき）+ SFZ の音源（マリンバ・スチールドラム・チェンバロ・ギター・教会オルガン）
  リバーブ・ドラム・音の大きさは、第2弾と同じ。
実行: v/bin/python mix_compare3.py events_block_piano.txt 出力フォルダ
"""
import os
import subprocess
import sys

import numpy as np

import mix_compare as mc
import mix_compare2 as m2
import sfz_player as sp

HERE = os.path.dirname(os.path.abspath(__file__))
SFZ = os.path.join(HERE, "..", "sfz")
SR = mc.SR

GM = [  # (ファイル名, GM のプログラム番号 0 始まり)
    ("G01_チェンバロ", 6), ("G02_クラビネット", 7), ("G03_チェレスタ", 8), ("G04_オルゴール", 10), ("G05_ビブラフォン", 11),
    ("G06_マリンバ(GM)", 12), ("G07_ドローバーオルガン", 16), ("G08_教会オルガン(GM)", 19), ("G09_アコーディオン", 21),
    ("G10_ナイロンギター", 24), ("G11_スチールギター", 25), ("G12_ハープ", 46), ("G13_ストリングス", 48),
    ("G14_シンセストリングス", 50), ("G15_合唱(アー)", 52), ("G16_ウォームパッド", 89),
]


def raw_gm(prog, events):
    out = os.path.join(HERE, "raw_gm_%d.wav" % prog)
    env = dict(os.environ, NONORM="1")
    subprocess.run([os.path.join(HERE, "render"), events, out, os.path.join(HERE, "GeneralUser-GS.sf2"), str(prog)], env=env,
                   stdout=subprocess.DEVNULL, check=True)
    return m2.mc.load_wav(out)


if __name__ == "__main__":
    events, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    gu_piano = mc.load_wav(os.path.join(HERE, "raw_block_piano_gu.wav"))
    drums = mc.load_wav(os.path.join(HERE, "raw_block_drums.wav"))
    n = max(len(gu_piano), len(drums)) + SR * 3
    pad = lambda x: np.vstack([x, np.zeros((n - len(x), 2), dtype=np.float32)])
    drums = pad(drums)
    ref = mc.rms(pad(gu_piano))
    notes = mc.parse_events(events)

    def sfz(path):
        return lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, *path)), notes, n, max_seconds=10.0)

    jobs = [(name, (lambda p=prog: pad(raw_gm(p, events)))) for name, prog in GM]
    jobs += [
        ("S01_マリンバ(録音・強さ多段)", sfz(["Terkelsen.Marimba", "Terkelsen's Marimba.sfz"])),
        ("S02_スチールドラム(録音)", sfz(["Kastendieck.SteelDrum", "Steel Drum.sfz"])),
        ("S03_チェンバロ(録音)", sfz(["Clavecin", "Clavecin.sfz"])),
        ("S04_アコースティックギター(Ovation録音)", sfz(["OvationGuitar", "Ovation Guitar (mw1 for 12-string).sfz"])),
        ("S05_教会オルガン(録音)", sfz(["OrgueEglise", "Orgue Eglise Full.sfz"])),
    ]
    for name, fn in jobs:
        m2.finish(os.path.join(outdir, name + ".wav"), fn(), drums, ref)
