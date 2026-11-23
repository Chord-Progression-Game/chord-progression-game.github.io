#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
音質の比べ用: 同じ演奏（実機から録った MIDI）を、ピアノ／エレピの音源を替えて、響き（リバーブ）つきで書き出す。
  A: GeneralUser GS のピアノ     B: Salamander Grand Piano（本物の Yamaha C5 の録音）
  C: GeneralUser GS のエレピ     D: FM 方式のエレピ（録音を使わず計算で作る）
  ドラムは共通（GeneralUser GS）。リバーブは、ESP32 の中でも動かせる軽い方式（Freeverb 風）。
準備: python3 -m venv v && v/bin/pip install numpy scipy soundfile
      raw_piano_gu.wav / raw_epiano_gu.wav / raw_drums.wav を render（NONORM=1）で作っておく
      salamander/v10/*.ogg（npm の @audio-samples/piano-velocity10。Salamander Grand Piano V3、CC-BY 3.0、Alexander Holm）
実行: v/bin/python mix_compare.py events_piano.txt 出力フォルダ
"""
import glob
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

SR = 44100


# ---------------- 読み込み ----------------
def load_wav(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    assert sr == SR
    return x


def parse_events(path):
    """ events_piano.txt → [(開始秒, 終了秒, ノート, ベロシティ)] """
    on = {}
    notes = []
    for line in open(path):
        p = line.split()
        t = float(p[0])
        b = [int(x) for x in p[1:]]
        st, ch = b[0] & 0xF0, b[0] & 0x0F
        if ch != 0:
            continue
        if st == 0x90 and len(b) >= 3 and b[2] > 0:
            on[b[1]] = (t, b[2])
        elif st in (0x80, 0x90) and len(b) >= 2 and b[1] in on:
            t0, v = on.pop(b[1])
            notes.append((t0, t, b[1], v))
        elif st == 0xB0 and len(b) >= 3 and b[1] == 123:
            for n, (t0, v) in list(on.items()):
                notes.append((t0, t, n, v))
            on.clear()
    for n, (t0, v) in on.items():
        notes.append((t0, t0 + 1.0, n, v))
    return sorted(notes)


# ---------------- リバーブ（Freeverb 風。コム8本 + オールパス4本）----------------
COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
ALLP = [556, 441, 341, 225]


def reverb(x, wet=0.25, room=0.84, damp=0.25, spread=23):
    """ x: (N, 2)。響きだけを返す（足すのは呼び出し側） """
    mono = (x[:, 0] + x[:, 1]) * 0.5
    out = np.zeros_like(x)
    for ch in range(2):
        acc = np.zeros(len(mono), dtype=np.float64)
        for d in COMB:
            d += spread * ch
            # y[n] = x[n] + room * lowpass(y[n-d])  →  (1 - damp z^-1) / (1 - damp z^-1 - room (1-damp) z^-d)
            a = np.zeros(d + 1)
            a[0] = 1.0
            a[1] -= damp
            a[d] -= room * (1 - damp)
            acc += lfilter([1.0, -damp], a, mono * 0.015)
        y = acc
        for d in ALLP:
            d += spread * ch
            b = np.zeros(d + 1)
            b[0] = -0.5
            b[d] = 1.0
            a = np.zeros(d + 1)
            a[0] = 1.0
            a[d] = -0.5
            y = lfilter(b, a, y)
        out[:, ch] = y
    return (out * wet * 3.0).astype(np.float32)


# ---------------- Salamander（録音のピアノ）----------------
NOTE_BASE = {"C": 0, "D#": 3, "F#": 6, "A": 9}


def name_to_midi(name):
    base = name[:-1]
    octave = int(name[-1])
    return 12 * (octave + 1) + NOTE_BASE[base]


def load_salamander(folder, vel_tag, max_seconds=6.0):
    bank = {}
    for f in glob.glob(os.path.join(folder, "*%s.ogg" % vel_tag)):
        nm = os.path.basename(f)[: -len(vel_tag + ".ogg")]
        x, sr = sf.read(f, dtype="float32", always_2d=True)
        n = int(max_seconds * sr)
        x = x[:n]
        if sr != SR:   # 48k → 44.1k（線形補間。ESP32 では最初から 32k などで持つ）
            pos = np.arange(int(len(x) * SR / sr)) * (sr / SR)
            x = np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1)
        bank[name_to_midi(nm)] = x.astype(np.float32)
    return bank


def render_sampled(notes, bank, length, vel_ref=80, release=0.30):
    out = np.zeros((length, 2), dtype=np.float32)
    roots = np.array(sorted(bank))
    for t0, t1, n, v in notes:
        root = int(roots[np.argmin(np.abs(roots - n))])
        ratio = 2.0 ** ((n - root) / 12.0)
        src = bank[root]
        dur = (t1 - t0) + release * 3
        m = int(min(dur * SR, len(src) / ratio - 2))
        if m <= 0:
            continue
        pos = np.arange(m) * ratio
        seg = np.stack([np.interp(pos, np.arange(len(src)), src[:, c]) for c in range(2)], axis=1)
        t = np.arange(m) / SR
        env = np.ones(m)
        off = t > (t1 - t0)
        env[off] = np.exp(-(t[off] - (t1 - t0)) / (release / 3.0))      # 鍵盤を離したあとの減衰（ダンパー）
        env[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        seg = seg * env[:, None] * (v / vel_ref) ** 1.2
        a = int(t0 * SR)
        b = min(length, a + m)
        out[a:b] += seg[: b - a]
    return out


# ---------------- FM エレピ（録音を使わず、計算で作る）----------------
def render_fm_epiano(notes, length, release=0.25):
    out = np.zeros((length, 2), dtype=np.float32)
    rng = np.random.default_rng(1)
    for t0, t1, n, v in notes:
        f = 440.0 * 2 ** ((n - 69) / 12.0)
        dur = (t1 - t0) + release * 3
        m = int(dur * SR)
        t = np.arange(m) / SR
        vel = (v / 127.0)
        # 「ティン」と鳴る高い成分（ratio 14）は、強く弾くほど強く、すぐ減る。本体（ratio 1）はゆっくり減る
        idx_tine = (1.0 + 4.0 * vel) * np.exp(-t / 0.045) + 0.12
        idx_body = (0.9 + 1.2 * vel) * np.exp(-t / 0.5) + 0.25
        tine = np.sin(2 * np.pi * f * t + idx_tine * np.sin(2 * np.pi * 14 * f * t)) * np.exp(-t / 0.35) * 0.35
        body = np.sin(2 * np.pi * f * t + idx_body * np.sin(2 * np.pi * f * t)) * np.exp(-t / (1.6 - 0.6 * min(1.0, n / 84.0)))
        sub = np.sin(2 * np.pi * f * 2.0 * t + 0.4 * np.sin(2 * np.pi * f * t)) * np.exp(-t / 0.7) * 0.18
        sig = (body + tine + sub)
        # ゆっくりしたトレモロ（左右で逆位相。広がりが出る）
        trem = 0.10 * np.sin(2 * np.pi * 4.8 * t + rng.uniform(0, 6.28))
        env = np.minimum(1.0, t / 0.003)
        off = t > (t1 - t0)
        env[off] *= np.exp(-(t[off] - (t1 - t0)) / (release / 3.0))
        sig = sig * env * vel ** 0.8 * 0.6
        a = int(t0 * SR)
        b = min(length, a + m)
        out[a:b, 0] += (sig * (1 + trem))[: b - a]
        out[a:b, 1] += (sig * (1 - trem))[: b - a]
    return out


def rms(x):
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-12)


def finish(path, piano, drums, ref_piano_rms, piano_wet=0.30, drum_wet=0.10):
    piano = piano * (ref_piano_rms / rms(piano))        # ピアノの大きさをそろえる（音源ごとの差を、聞き比べに持ち込まない）
    mix = piano + reverb(piano, wet=piano_wet) + drums + reverb(drums, wet=drum_wet)
    mix = np.vstack([mix, np.zeros((SR * 2, 2), dtype=np.float32)]) if False else mix
    peak = float(np.max(np.abs(mix)))
    mix = mix * (0.63 / peak)
    sf.write(path, mix, SR, subtype="PCM_16")
    print("書き出し:", path, "最大", round(float(np.max(np.abs(mix))), 2))


if __name__ == "__main__":
    events, outdir = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(events))
    gu_piano = load_wav(os.path.join(here, "raw_piano_gu.wav"))
    gu_epiano = load_wav(os.path.join(here, "raw_epiano_gu.wav"))
    drums = load_wav(os.path.join(here, "raw_drums.wav"))
    n = max(len(gu_piano), len(drums))
    pad = lambda x: np.vstack([x, np.zeros((n + SR * 3 - len(x), 2), dtype=np.float32)])
    gu_piano, gu_epiano, drums = pad(gu_piano), pad(gu_epiano), pad(drums)
    L = len(drums)
    notes = parse_events(events)
    ref = rms(gu_piano)
    os.makedirs(outdir, exist_ok=True)
    finish(os.path.join(outdir, "A_generaluser_piano_reverb.wav"), gu_piano, drums, ref)
    bank = load_salamander(os.path.join(here, "..", "salamander", "v10"), "v10")
    finish(os.path.join(outdir, "B_salamander_piano_reverb.wav"), render_sampled(notes, bank, L), drums, ref)
    finish(os.path.join(outdir, "C_generaluser_epiano_reverb.wav"), gu_epiano, drums, ref)
    finish(os.path.join(outdir, "D_fm_epiano_reverb.wav"), render_fm_epiano(notes, L), drums, ref)
