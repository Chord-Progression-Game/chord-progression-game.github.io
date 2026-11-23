# -*- coding: utf-8 -*-
"""
音質の比べ（第2弾）: 和音を同時に鳴らす演奏（バッキング=ロング、ドラム=8ビート）を、いろいろなピアノ／エレピの音源で書き出す。
  ピアノ: GeneralUser GS（基準）/ Salamander Grand Piano / Splendid Grand Piano（Steinway、パブリックドメイン）
  エレピ: GeneralUser GS の Tine（基準）/ Yamaha CP80 / Wurlitzer EP200 / Hohner Pianet T / jRhodes3c / FM（計算で作る）
  ドラムは共通。リバーブは、すべて同じもの（Freeverb 風）。音の大きさは、基準のピアノにそろえる。
実行: v/bin/python mix_compare2.py events_block_piano.txt 出力フォルダ   （raw_block_*.wav は render で作っておく）
"""
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

import mix_compare as mc
import sfz_player as sp

SR = mc.SR
HERE = os.path.dirname(os.path.abspath(__file__))
SFZ = os.path.join(HERE, "..", "sfz")


def reverb_ir(seconds=3.5):
    n = int(seconds * SR)
    imp = np.zeros((n, 2), dtype=np.float64)
    imp[0] = 1.0
    return mc.reverb(imp.astype(np.float32), wet=1.0)   # 響きだけの応答（インパルスに対する出力）


IR = reverb_ir()


def wet_of(x, wet):
    mono = (x[:, 0] + x[:, 1]) * 0.5
    out = np.stack([fftconvolve(mono, IR[:, c])[: len(x)] for c in range(2)], axis=1)
    return (out * wet).astype(np.float32)


def finish(path, piano, drums, ref_rms, piano_wet=0.30, drum_wet=0.10):
    piano = piano * (ref_rms / mc.rms(piano))
    mix = piano + wet_of(piano, piano_wet) + drums + wet_of(drums, drum_wet)
    mix = mix * (0.63 / float(np.max(np.abs(mix))))
    sf.write(path, mix, SR, subtype="PCM_16")
    print("書き出し:", os.path.basename(path))


if __name__ == "__main__":
    events, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    gu_piano = mc.load_wav(os.path.join(HERE, "raw_block_piano_gu.wav"))
    gu_ep = mc.load_wav(os.path.join(HERE, "raw_block_epiano_gu.wav"))
    drums = mc.load_wav(os.path.join(HERE, "raw_block_drums.wav"))
    n = max(len(gu_piano), len(drums)) + SR * 3
    pad = lambda x: np.vstack([x, np.zeros((n - len(x), 2), dtype=np.float32)])
    gu_piano, gu_ep, drums = pad(gu_piano), pad(gu_ep), pad(drums)
    notes = mc.parse_events(events)
    ref = mc.rms(gu_piano)

    jobs = [
        ("P1_piano_GeneralUser(基準)", lambda: gu_piano),
        ("P2_piano_Salamander_YamahaC5", lambda: mc.render_sampled(notes, mc.load_salamander(os.path.join(SFZ, "..", "salamander", "v10"), "v10"), n)),
        ("P3_piano_Splendid_Steinway", lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, "SplendidGrandPiano", "Splendid Grand Piano.sfz")), notes, n)),
        ("E1_epiano_GeneralUser_Tine(基準)", lambda: gu_ep),
        ("E2_epiano_Yamaha_CP80", lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, "GregSullivan.E-Pianos", "CP80", "CP80.sfz")), notes, n)),
        ("E3_epiano_Wurlitzer_EP200", lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, "GregSullivan.E-Pianos", "Wurlitzer EP200", "Wurlitzer EP200.sfz")), notes, n)),
        ("E4_epiano_Hohner_Pianet_T", lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, "GregSullivan.E-Pianos", "Pianet T", "Pianet T.sfz")), notes, n)),
        ("E5_epiano_Rhodes_jRhodes3c(非商用)", lambda: sp.render_notes(sp.parse_sfz(os.path.join(SFZ, "jlearman.jRhodes3c", "jRhodes3c-looped-flac-sfz", "_jRhodes-stereo-looped.sfz")), notes, n)),
        ("E6_epiano_FM計算", lambda: mc.render_fm_epiano(notes, n)),
    ]
    for name, fn in jobs:
        finish(os.path.join(outdir, name + ".wav"), fn(), drums, ref)
