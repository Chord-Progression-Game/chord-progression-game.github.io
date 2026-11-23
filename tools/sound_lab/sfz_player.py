# -*- coding: utf-8 -*-
"""
SFZ（サンプル音源の定義ファイル）を読んで、MIDI のノートを鳴らす、必要最小限の再生プログラム（音の確認用）。
  対応: <control> default_path / #define / #include / <global> <group> <region> の継承 /
        sample, lokey, hikey, key, pitch_keycenter, lovel, hivel, tune, volume, group_volume, transpose
  対応しないもの: ペダル・共鳴・リリース音（trigger=release）・フィルター・ループ（長い音は、そのまま最後まで）
"""
import os
import re
import numpy as np
import soundfile as sf

SR = 44100
NOTE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def key_num(v):
    v = v.strip().lower()
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    m = re.fullmatch(r"([a-g])(#|b)?(-?\d+)", v)
    n = NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + n


def parse_sfz(path):
    base = os.path.dirname(path)
    defines = {}

    def read(p):
        out = []
        for line in open(p, encoding="utf-8", errors="replace"):
            line = re.sub(r"//.*", "", line).strip()
            if not line:
                continue
            m = re.match(r'#define\s+(\$\w+)\s+(.*)', line)
            if m:
                defines[m.group(1)] = m.group(2).strip()
                continue
            m = re.match(r'#include\s+"([^"]+)"', line)
            if m:
                inc = m.group(1)
                for k, v in defines.items():
                    inc = inc.replace(k, v)
                out += read(os.path.join(base, inc))
                continue
            for k in sorted(defines, key=len, reverse=True):
                line = line.replace(k, defines[k])
            out.append(line)
        return out

    lines = read(path)
    text = " ".join(lines)
    parts = re.split(r"(<\w+>)", text)
    scope = {"control": {}, "global": {}, "master": {}, "group": {}}
    regions = []
    cur_hdr = None
    for part in parts:
        if re.fullmatch(r"<\w+>", part):
            cur_hdr = part[1:-1]
            if cur_hdr == "group":
                scope["group"] = {}
            if cur_hdr == "region":
                regions.append(None)   # 場所だけ確保
            continue
        if cur_hdr is None:
            continue
        ops = {}
        # sample=名前（空白を含む）の扱い: 次の「名前=」の手前まで
        for m in re.finditer(r"(\w+)=(.*?)(?=\s+\w+=|$)", part.strip()):
            ops[m.group(1)] = m.group(2).strip()
        if cur_hdr == "region":
            merged = {}
            for s in ("global", "master", "group"):
                merged.update(scope[s])
            merged.update(ops)
            regions[-1] = merged
        elif cur_hdr in scope:
            scope[cur_hdr].update(ops)
    default_path = scope["control"].get("default_path", "")
    out = []
    for r in regions:
        if r is None or "sample" not in r:
            continue
        if r.get("trigger", "attack") != "attack" or "locc64" in r or "locc70" in r:
            continue   # リリース音・ペダル・共鳴の層は使わない
        lo = key_num(r.get("lokey", r.get("key", "0")))
        hi = key_num(r.get("hikey", r.get("key", "127")))
        center = key_num(r.get("pitch_keycenter", r.get("key", "60")))
        out.append({
            "file": os.path.join(base, default_path, r["sample"].replace("\\", "/")),
            "lokey": lo, "hikey": hi, "center": center,
            "lovel": int(r.get("lovel", 0)), "hivel": int(r.get("hivel", 127)),
            "tune": float(r.get("tune", 0)) / 100.0 + float(r.get("transpose", 0)),
            "gain_db": float(r.get("volume", 0)) + float(r.get("group_volume", 0)),
        })
    return out


_cache = {}


def load_sample(path, max_seconds):
    if path not in _cache:
        x, sr = sf.read(path, dtype="float32", always_2d=True)
        x = x[: int(max_seconds * sr)]
        if x.shape[1] == 1:
            x = np.repeat(x, 2, axis=1)
        if sr != SR:
            pos = np.arange(int(len(x) * SR / sr)) * (sr / SR)
            x = np.stack([np.interp(pos, np.arange(len(x)), x[:, c]) for c in range(2)], axis=1).astype(np.float32)
        _cache[path] = x
    return _cache[path]


def pick(regions, note, vel):
    cands = [r for r in regions if r["lokey"] <= note <= r["hikey"] and r["lovel"] <= vel <= r["hivel"]]
    return cands[0] if cands else None


def render_notes(regions, notes, length, release=0.30, max_seconds=8.0):
    out = np.zeros((length, 2), dtype=np.float32)
    for t0, t1, n, v in notes:
        r = pick(regions, n, v)
        if r is None:
            continue
        src = load_sample(r["file"], max_seconds)
        ratio = 2.0 ** ((n - r["center"] + r["tune"]) / 12.0)
        dur = (t1 - t0) + release * 3
        m = int(min(dur * SR, len(src) / ratio - 2))
        if m <= 0:
            continue
        pos = np.arange(m) * ratio
        seg = np.stack([np.interp(pos, np.arange(len(src)), src[:, c]) for c in range(2)], axis=1)
        t = np.arange(m) / SR
        env = np.ones(m)
        off = t > (t1 - t0)
        env[off] = np.exp(-(t[off] - (t1 - t0)) / (release / 3.0))
        na = int(0.002 * SR)
        env[:na] *= np.linspace(0, 1, na)
        seg = seg * env[:, None] * (10 ** (r["gain_db"] / 20.0))
        a = int(t0 * SR)
        b = min(length, a + m)
        out[a:b] += seg[: b - a]
    return out
