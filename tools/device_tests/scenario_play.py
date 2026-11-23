#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
実機テスト: コード進行・リズム・キー/BPMの即時変更・設定の保存（疑似タグ版のファームウェアを書き込んだボードで実行する）
  本物の tools/midi_bridge.py を動かして、ESP32 → UART → ブリッジ → 仮想MIDIポート という本番と同じ道を通し、
  出てきた MIDI（音の高さ・同時発音・時刻）と、画面の表示を照合する。
  ※ 音が鳴ったかどうかは、この方法では分からない（耳で確認が必要）。MIDIメッセージが正しく出ることを確かめる。
  ※ リーダーに本物のタグを置かないこと（疑似タグの結果と混ざる）。ポートをほかのソフト（ブリッジ・Serial Monitor）が使っていないこと。
  ※ 環境変数 SKIP_TESTMODE=1 で、最後の RC522 テストモードの確認を省略できる。
実行:  tools/.venv/bin/python tools/device_tests/scenario_play.py [ポート]
"""
import os
import queue
import statistics
import subprocess
import sys
import threading
import time

import rtmidi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbmodem5C940442641"
VPORT = "ESP32 Chord Prototype (device test)"

fails = []
checks = 0


class SystemExit_(Exception):
    pass


def check(name, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        fails.append("%s %s" % (name, detail))
        print("FAIL %s %s" % (name, detail))


class Rig:
    def __init__(self):
        self.t0 = time.perf_counter()
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(ROOT, "tools", "midi_bridge.py"), "--port", PORT, "--name", VPORT],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        self.log = []      # (時刻, 行)
        self.midi = []     # (時刻, [バイト])
        self.lock = threading.Lock()
        threading.Thread(target=self._read_log, daemon=True).start()
        self.midi_in = rtmidi.MidiIn()
        self.midi_in.ignore_types(sysex=True, timing=True, active_sense=True)
        idx = None
        for _ in range(100):
            for i, n in enumerate(self.midi_in.get_ports()):
                if VPORT in n:
                    idx = i
            if idx is not None:
                break
            time.sleep(0.05)
        assert idx is not None, "仮想MIDIポートができなかった"
        self.midi_in.open_port(idx)
        self.midi_in.set_callback(self._on_midi)

    def now(self):
        return time.perf_counter() - self.t0

    def _on_midi(self, ev, data=None):
        with self.lock:
            self.midi.append((self.now(), list(ev[0])))

    def _read_log(self):
        buf = b""
        while True:
            c = self.proc.stdout.read(1)
            if not c:
                return
            buf += c
            if c == b"\n":
                with self.lock:
                    self.log.append((self.now(), buf.decode("utf-8", "replace").rstrip()))
                buf = b""

    def send(self, text):
        self.proc.stdin.write((text + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def text_since(self, t):
        with self.lock:
            return "\n".join(l for tt, l in self.log if tt >= t)

    def midi_since(self, t):
        with self.lock:
            return [(tt, m) for tt, m in self.midi if tt >= t]

    def wait_log(self, needle, since, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            if needle in self.text_since(since):
                return True
            time.sleep(0.05)
        return False

    def cmd(self, text, wait=0.35, quiet=0.3, timeout=6.0, expect=None):
        """ コマンドを送って、そのあとの表示を返す。
            expect があれば、その文字列が出るまで待つ（5秒間の測定のように、途中で表示が止まるコマンド用）。
            なければ、表示が静かになる（quiet 秒、新しい行が出ない）まで待つ。
            ESP32 は、保存（NVS）やブザーで時間がかかることがあるので、決まった時間だけ待つ方法は使わない """
        t = self.now()
        self.send(text)
        end = time.time() + timeout
        time.sleep(min(wait, 0.2))
        while time.time() < end:
            if expect is not None:
                if expect in self.text_since(t):
                    time.sleep(0.15)
                    break
            else:
                with self.lock:
                    last = max([tt for tt, _ in self.log if tt >= t] or [t])
                if self.now() - last >= quiet and self.now() - t >= wait:
                    break
            time.sleep(0.03)
        return self.text_since(t)

    def close(self):
        try:
            self.proc.send_signal(2)
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        self.midi_in.close_port()


def groups(events, gap=0.03):
    """ ほぼ同時に来た MIDI をひとまとめ（和音）にする: [(時刻, 種類, 音のタプル)] """
    out = []
    for t, m in events:
        kind = {0x90: "on", 0x80: "off", 0xB0: "cc", 0xC0: "pc"}.get(m[0] & 0xF0, "?")
        note = m[1] if kind in ("on", "off") else None
        if out and out[-1][1] == kind and t - out[-1][3] < gap:
            if note is not None:
                out[-1][2].append(note)
            out[-1][3] = t
        else:
            out.append([t, kind, [note] if note is not None else [m[1]], t])
    return [(g[0], g[1], tuple(g[2])) for g in out]


import re

# ---------------------------------------------------------------------------
# 期待値を、Python 側で独立に計算する（ESP32 の C++ とは別の実装。二重チェックになる）
# ---------------------------------------------------------------------------
BASE_C = 48
SHAPES = {"maj": [0, 4, 7, 12], "min": [0, 3, 7, 12], "dom7": [0, 4, 7, 10]}


def nominal(pc, kind, key=0):
    r = BASE_C + (pc + key) % 12
    return [r + i for i in SHAPES[kind]]


def lead_shift(prev_root, nominal_root):
    """ -12 / 0 / +12 のうち、直前のルートに一番近いもの（同じ近さなら 0 を優先） """
    if prev_root is None:
        return 0
    best, dist = 0, abs(nominal_root - prev_root)
    for c in (-12, 12):
        d = abs(nominal_root + c - prev_root)
        if d < dist:
            best, dist = c, d
    return best


def expected_sequence(steps, key=0):
    """ steps: [(pc, kind) または None(休み)] → [音のタプル または None] """
    out, prev = [], None
    for st in steps:
        if st is None:
            out.append(None)
            continue
        notes = nominal(st[0], st[1], key)
        sh = lead_shift(prev, notes[0])
        notes = [n + sh for n in notes]
        prev = notes[0]
        out.append(tuple(notes))
    return out


# 自己検査（パソコン上のテストで確認した値と同じか）
assert expected_sequence([(0, "maj"), (9, "min"), (5, "maj"), (7, "maj"), (0, "maj")]) == [
    (48, 52, 55, 60), (45, 48, 52, 57), (41, 45, 48, 53), (43, 47, 50, 55), (48, 52, 55, 60)]

I_, VIM_, IV_, V_, V7_ = (0, "maj"), (9, "min"), (5, "maj"), (7, "maj"), (7, "dom7")
DRUM_NOTE = {"K": 36, "S": 38, "P": 37, "H": 42, "O": 46, "C": 39, "R": 51, "X": 49}


def drum_ons(events, t0):
    return sorted((round(t - t0, 3), m[1]) for t, m in events if m[0] == 0x99)


def piano_groups(events, t0):
    ev = groups([(t, m) for t, m in events if (m[0] & 0x0F) == 0], gap=0.03)
    return [(round(t - t0, 3), n) for t, k, n in ev if k == "on"], [(round(t - t0, 3), n) for t, k, n in ev if k == "off"]


rig = Rig()
try:
    # ---- 起動 → ブリッジが MIDI BRIDGE を頼む ----
    t = rig.now()
    ok = rig.wait_log("音の出力先: ブリッジ", t, timeout=8.0)
    if not ok:
        rig.send("MIDI BRIDGE")
        ok = rig.wait_log("音の出力先: ブリッジ", t, timeout=3.0)
    check("ブリッジが MIDI BRIDGE を設定できた", ok)

    out = rig.cmd("@Z")
    check("テスト用の保存場所を空にした", "chordtest cleared" in out, out)
    tags = {"04A1B2C3": 1, "04A1B2C4": 2, "04A1B2C5": 3, "04A1B2C6": 4, "04A1B2C7": 9, "04A1B2C8": 99}
    for uid, cid in tags.items():
        out = rig.cmd("@T %s %d" % (uid, cid), 0.25)
        check("登録 %s→%d" % (uid, cid), "(ok)" in out, out)

    # ---- STATUS ----
    out = rig.cmd("STATUS")
    check("STATUS: 停止中", "再生: 停止中" in out, out)
    check("STATUS: BPM 120", "BPM: 120" in out and "1ステップ 1000 ms" in out, out)
    check("STATUS: 空の位置は休み", out.count("（空）") == 4, out)
    check("STATUS: パターン（標準はバッキング ロング、ドラムなし）", "ドラム: なし   バッキング: ロング" in out, out)
    check("STATUS: リーダーの止め方と受信感度", "止め方:" in out and "受信感度: 33 dB" in out, out)
    for pos, uid in enumerate(["04A1B2C3", "04A1B2C4", "04A1B2C5", "04A1B2C6"], start=1):
        rig.cmd("@P %d %s" % (pos, uid), 0.15)
    out = rig.cmd("STATUS")
    for word in ["位置1: Ⅰ", "位置2: Ⅵm", "位置3: Ⅳ", "位置4: Ⅴ", "C → E → G → C", "A → C → E → A", "F → A → C → F", "G → B → D → G"]:
        check("STATUS に「%s」" % word, word in out, out)

    # ---- BPM 120 で再生: 駒の交換・取り外し・BPM の即時変更 ----
    out = rig.cmd("BPM 120")
    check("BPM 120 の応答", "BPM 120（1拍 500 ms" in out and "1000 ms" in out, out)
    t_start = rig.now()
    rig.send("START")

    def at(sec, action):
        wait = (t_start + sec) - rig.now()
        if wait > 0:
            time.sleep(wait)
        action()
    at(4.30, lambda: rig.send("@P 3 04A1B2C7"))   # 位置3 を Ⅴ7 に交換
    at(4.50, lambda: rig.send("@R 2"))             # 位置2 を外す
    at(6.45, lambda: rig.send("BPM 60"))           # 再生中の BPM 変更（すぐ反映）
    at(11.4, lambda: None)
    log_play = rig.text_since(t_start)
    allmidi = rig.midi_since(t_start)
    ons, offs = piano_groups(allmidi, 0)
    first = ons[0][0] if ons else None
    check("最初に音が出た", first is not None)
    print("\n--- ピアノのMIDI（開始からの時刻 / 音）---")
    for t_, n in ons:
        print("  %6.3f  on  %s" % (t_ - (first or 0), n))
    if first is not None:
        rel = [(round(t_ - first, 3), n) for t_, n in ons]
        want_notes = [n for n in expected_sequence([I_, VIM_, IV_, V_, I_, None, V7_, V_, I_]) if n is not None]
        check("和音の並び（ボイスリーディング・交換・休みを反映）", [n for _, n in rel[:len(want_notes)]] == want_notes,
              "got=%s want=%s" % ([n for _, n in rel], want_notes))
        for (tt, _), wt in zip(rel[:6], [0.0, 1.0, 2.0, 3.0, 4.0, 6.0]):
            check("時刻 %.1f s の和音 (誤差 25ms 以内)" % wt, abs(tt - wt) <= 0.025, "got=%.3f" % tt)
        check("5秒目(位置2を外した)は休み", all(abs(tt - 5.0) > 0.2 for tt, _ in rel))
        check("BPM 60 はすぐ反映: 7つ目の和音は 7.0 s より遅れて始まる（残りの半分が2倍の長さ）",
              len(rel) >= 7 and 7.25 <= rel[6][0] <= 7.85, str(rel))
        check("BPM 60 のあとのステップは 2.0 s", len(rel) >= 8 and abs((rel[7][0] - rel[6][0]) - 2.0) <= 0.03, str(rel))
        # 同時発音（1回の送信）
        raw_on = [(t_, m) for t_, m in allmidi if (m[0] & 0xF0) == 0x90]
        spread = [raw_on[i + 3][0] - raw_on[i][0] for i in range(0, len(raw_on) - 3, 4)]
        check("和音の4音は 5ms 以内に出る", bool(spread) and max(spread) < 0.005, "max=%.4f" % (max(spread) if spread else -1))
        for (ton, nn), (toff, nf) in zip(ons[:4], offs[:4]):
            check("和音を止める時刻は 950ms 後 (誤差 25ms 以内)", abs((toff - ton) - 0.95) <= 0.025, "%.3f" % (toff - ton))
            check("止める音は、鳴らした音と同じ", nn == nf, "%s vs %s" % (nn, nf))
        gaps = [rel[i + 1][0] - rel[i][0] for i in range(4)]
        print("  BPM120 のステップ間隔(ms): %s" % [round(g * 1000, 1) for g in gaps])
    check("ボイスリーディングの表示", "[前のコードに近づけて、1オクターブ下]" in log_play, log_play[:400])
    check("START の案内: 進行・パターン・音源", "進行: [Ⅰ] [Ⅵm] [Ⅳ] [Ⅴ]" in log_play and "バッキング: ロング" in log_play and "音源: ブリッジ" in log_play, log_play[:500])
    check("休みの表示（位置2が空）", "（休み: 空）" in log_play, log_play)
    check("再生中の交換が表示される", "[位置3] 駒が交換されました: Ⅴ7" in log_play, log_play)
    check("再生中の取り外しが表示される", "[位置2] 駒が外れました（空）" in log_play)
    check("BPM変更の応答（再生中は、すぐ反映と出る）", "すぐに反映されました" in log_play)

    out = rig.cmd("STATUS")
    check("STATUS: 再生中・BPM 60", "再生: 再生中" in out and "BPM: 60" in out and "2000 ms" in out, out)
    m = re.search(r"最大 (\d+) ms", out)
    check("STATUS: タイミング診断が出る", m is not None, out)
    if m:
        print("  ESP32 側の時刻のずれ（実機・リーダーが実際に読み取り中）: 最大 %s ms" % m.group(1))
        check("ESP32 側の時刻のずれは 10ms 以下", int(m.group(1)) <= 10, m.group(1))
    out = rig.cmd("l")
    check("再生中に l を打つと案内が出る", "再生中です" in out, out)
    rig.send("STOP"); time.sleep(0.8)
    out = rig.cmd("STATUS"); check("STATUS: 停止中に戻る", "再生: 停止中" in out)

    # ---- 全部そろえ直す ----
    for pos, uid in enumerate(["04A1B2C3", "04A1B2C4", "04A1B2C5", "04A1B2C6"], start=1):
        rig.cmd("@P %d %s" % (pos, uid), 0.1)

    # ---- キーの即時変更とホットキー ----
    rig.cmd("BPM 120")
    t_k = rig.now()
    rig.send("START")
    time.sleep(1.3)                                  # 2つ目のステップ(Ⅵm)の途中
    t_cmd = rig.now()
    rig.send("KEY D")
    time.sleep(0.5)
    ev = piano_groups(rig.midi_since(t_cmd - 0.05), 0)
    new_ons = [n for _, n in ev[0]]
    # 鳴らし直す Ⅵm(in D = Bm) は、直前の C3(48) に近い高さ: 期待値は Python で計算
    prev_root = 48
    nom = nominal(11, "min", 0)
    want_restrike = tuple(n + lead_shift(prev_root, nom[0]) for n in nom)
    check("KEY D: 鳴っていた和音を止める", any(set(n) == {45, 48, 52, 57} for _, n in ev[1]), str(ev))
    check("KEY D: 新しいキー(Bm)で鳴らし直す", want_restrike in new_ons, "got=%s want=%s" % (new_ons, want_restrike))
    check("KEY D: 応答とすぐ反映の案内", "Key は D です" in rig.text_since(t_cmd) and "すぐに反映されました" in rig.text_since(t_cmd))
    time.sleep(0.6)
    ev = piano_groups(rig.midi_since(t_cmd), 0)
    nxt = [n for _, n in ev[0]]
    nom2 = [BASE_C + 7 + i for i in SHAPES["maj"]]   # Dキーの Ⅳ = G
    want_next = tuple(n + lead_shift(want_restrike[0], nom2[0]) for n in nom2)
    check("次のステップは、Dキーの Ⅳ(G) を、鳴らし直した高さに近づけて鳴らす", want_next in nxt, "got=%s want=%s" % (nxt, want_next))
    # ホットキー（Enter なしのキーは、ブリッジの入力では行になるが、ESP32 は同じように処理する）
    t_h = rig.now(); rig.send("+"); time.sleep(0.4)
    check("+ で BPM 125", "BPM 125" in rig.text_since(t_h), rig.text_since(t_h))
    t_h = rig.now(); rig.send("-"); time.sleep(0.4)
    check("- で BPM 120", "BPM 120" in rig.text_since(t_h), rig.text_since(t_h))
    t_h = rig.now(); rig.send("]"); time.sleep(0.4)
    check("] でキー +1（D → E♭）", "Key は E♭ です" in rig.text_since(t_h), rig.text_since(t_h))
    t_h = rig.now(); rig.send("["); time.sleep(0.4)
    check("[ でキー -1（E♭ → D）", "Key は D です" in rig.text_since(t_h), rig.text_since(t_h))
    rig.send("STOP"); time.sleep(0.8)
    out = rig.cmd("KEY C"); check("KEY C に戻す", "Key は C です" in out, out)
    out = rig.cmd("KEY H"); check("KEY H はエラー", "読めません" in out, out)

    # ---- 「→」の駒 ----
    rig.cmd("@P 2 04A1B2C8", 0.1)       # 位置2 を「→」に
    t_a = rig.now(); rig.send("START"); time.sleep(2.4)
    log_a = rig.text_since(t_a)
    ons_a, _ = piano_groups(rig.midi_since(t_a), 0)
    rig.send("STOP"); time.sleep(0.8)
    check("→: 位置2 は、位置1 と同じ和音", len(ons_a) >= 2 and ons_a[0][1] == ons_a[1][1] == (48, 52, 55, 60), str(ons_a))
    check("→: 表示", "→（前のコマと同じ: Ⅰ）" in log_a, log_a)
    out = rig.cmd("STATUS"); check("STATUS: → の説明", "→  （前のコマと同じ: Ⅰ）" in out, out)
    rig.cmd("@P 2 04A1B2C4", 0.1)

    # ---- ドラムとバッキング（ch10 / ch1）----
    out = rig.cmd("DRUM SHOW 2")
    lanes = {}
    for line in out.splitlines():
        mm = re.match(r"^([KSPHOCRX])  ([.oxX]{16})  ", line)
        if mm:
            lanes[mm.group(1)] = mm.group(2)
    check("DRUM SHOW 2 の中身が読める", set(lanes) == {"K", "S", "H"}, out)
    out = rig.cmd("DRUM 2"); check("DRUM 2", "8ビート" in out, out)
    out = rig.cmd("BACKING 6"); check("BACKING 6", "アルペジオ(8分)" in out, out)
    t_d = rig.now(); rig.send("START"); time.sleep(4.3)
    allm = rig.midi_since(t_d)
    rig.send("STOP"); time.sleep(0.8)
    d_ons = drum_ons(allm, 0)
    pi_ons, _ = piano_groups(allm, 0)
    check("ドラムの音が出た", bool(d_ons))
    if d_ons:
        t0 = min(t_ for t_, m in allm if (m[0] & 0xF0) == 0x90)
        obs = sorted((round(t_ - t0, 3), m[1], m[2]) for t_, m in allm if m[0] == 0x99)
        worst = 0.0
        for bar in (0, 1):
            for lane, text in lanes.items():
                for slot, ch in enumerate(text):
                    if ch == ".":
                        continue
                    want_t = bar * 2.0 + slot * 0.125
                    hit = [o for o in obs if o[1] == DRUM_NOTE[lane] and abs(o[0] - want_t) <= 0.025]
                    check("ドラム %s 小節%d マス%d (%.3fs)" % (lane, bar + 1, slot, want_t), len(hit) == 1, str([o for o in obs if abs(o[0] - want_t) < 0.1]))
                    if hit:
                        worst = max(worst, abs(hit[0][0] - want_t))
        n_bar = sum(1 for t_ in lanes.values() for c in t_ if c != ".")
        check("1小節あたりのドラムの数 = パターンの音の数 (%d)" % n_bar, len([o for o in obs if o[0] < 1.99]) == n_bar, str(len([o for o in obs if o[0] < 1.99])))
        check("ドラムのベロシティは 45/85/112", all(o[2] in (45, 85, 112) for o in obs))
        print("  ドラムのタイミングの最大のずれ: %.1f ms" % (worst * 1000))
    arp = [n for _, n in pi_ons[:4]]
    check("アルペジオ(8分): 最初のステップは 1→2→3→4 の順に1音ずつ", arp == [(48,), (52,), (55,), (60,)], str(pi_ons[:5]))
    out = rig.cmd("STATUS")
    m = re.search(r"最大 (\d+) ms", out)
    if m:
        print("  ドラム再生中の ESP32 側の時刻のずれ: 最大 %s ms" % m.group(1))
        check("ドラム再生中も、時刻のずれは 10ms 以下", int(m.group(1)) <= 10, m.group(1))

    # ---- IDLE の切り替えと、それぞれのタイミング ----
    for mode_cmd, label in (("IDLE OFF", "アンテナOFF"), ("IDLE RESET", "RESET")):
        out = rig.cmd(mode_cmd, 0.6)
        check("%s の応答" % mode_cmd, label in out and "本体に保存しました" in out, out)
        t_i = rig.now(); rig.send("START"); time.sleep(4.2)
        allm = rig.midi_since(t_i)
        rig.send("STOP"); time.sleep(0.8)
        out = rig.cmd("STATUS")
        m = re.search(r"最大 (\d+) ms", out)
        late = int(m.group(1)) if m else 999
        print("  %s: ESP32 側の時刻のずれ 最大 %d ms" % (label, late))
        check("%s: 時刻のずれは 10ms 以下" % label, late <= 10, str(late))
        check("%s: 速い起こし方の失敗がない（または アンテナOFF）" % label, "速い起こし方に失敗した回数" not in out, out)
    rig.cmd("IDLE")
    out = rig.cmd("GAIN 23"); check("GAIN 23", "受信感度を 23 dB にしました" in out, out)
    out = rig.cmd("GAIN 24"); check("GAIN 24 は拒否", "GAIN 18 / 23" in out, out)
    rig.cmd("GAIN 33")

    # ---- 自分のパターンの保存と、再起動後の読み込み ----
    out = rig.cmd("DRUM COPY 2 11");   check("DRUM COPY", "コピーしました" in out and "保存しました" in out, out)
    out = rig.cmd("DRUM SET 11 K x.....x.x...x..."); check("DRUM SET", "K（キック）= x.....x.x...x..." in out, out)
    out = rig.cmd("DRUM NAME 11 マイ・ビート");  check("DRUM NAME", "マイ・ビート" in out, out)
    out = rig.cmd("BACKING SET 11 C-------C-------"); check("BACKING SET", "保存しました" in out, out)
    out = rig.cmd("DRUM SET 2 K x");   check("プリセットは変更できない", "コピーしてから" in out, out)
    rig.cmd("IDLE OFF", 0.6)
    rig.cmd("GAIN 23", 0.6)
    t_b = rig.now()
    rig.send("@B")
    ok = rig.wait_log("[READY]", t_b, timeout=12.0)
    check("再起動して [READY] になった", ok, rig.text_since(t_b)[-300:])
    time.sleep(1.0)
    boot = rig.text_since(t_b)
    check("起動の表示: リーダーの止め方（保存した OFF）と受信感度（保存した 23 dB）", "リーダーの止め方: アンテナOFF" in boot and "受信感度: 23 dB" in boot, boot[-600:])
    out = rig.cmd("DRUM LIST"); check("再起動後も、自分のドラム11が残っている", "マイ・ビート" in out, out)
    out = rig.cmd("DRUM SHOW 11"); check("再起動後の中身", "x.....x.x...x..." in out, out)
    out = rig.cmd("BACKING SHOW 11"); check("再起動後のバッキング11", "C-------C-------" in out, out)
    out = rig.cmd("STATUS"); check("再起動後: BPM 120・Key C に戻る", "BPM: 120" in out and "Key: C" in out, out)
    rig.cmd("DRUM DELETE 11"); rig.cmd("BACKING DELETE 11")
    rig.cmd("IDLE RESET", 0.6); rig.cmd("GAIN 33", 0.6)
    # 再起動後は、疑似タグが消えている: 置き直す
    for pos, uid in enumerate(["04A1B2C3", "04A1B2C4", "04A1B2C5", "04A1B2C6"], start=1):
        rig.cmd("@P %d %s" % (pos, uid), 0.1)

    # ---- BPM の入力いろいろ ----
    out = rig.cmd("BPM 500");  check("範囲外のBPMは拒否", "30〜240" in out, out)
    out = rig.cmd("BPM abc");  check("数字でないBPMは拒否", "30〜240" in out, out)
    out = rig.cmd("BPM");      check("BPM だけ打つと現在値", "BPM は 120 です" in out, out)
    out = rig.cmd("bpm 90");   check("小文字でもOK", "BPM 90（1拍 666 ms" in out, out)
    out = rig.cmd("BPM +5");   check("BPM +5", "BPM 95" in out, out)
    out = rig.cmd("Bpm=100");  check("BPM=100 でもOK", "BPM 100（1拍 600 ms" in out, out)
    out = rig.cmd("BPM 120");  check("BPM 120 に戻す", "BPM 120" in out)

    # ---- VOICING 3 / MIDI OFF ----
    rig.cmd("BACKING 1")
    rig.cmd("DRUM OFF")
    out = rig.cmd("VOICING 3"); check("VOICING 3", "コードの構成音だけ" in out, out)
    t = rig.now(); rig.send("START"); time.sleep(0.4)
    ev = groups(rig.midi_since(t))
    on3 = [n for _, k, n in ev if k == "on"]
    check("VOICING 3: Ⅰ は 3音(C3 E3 G3)", on3 and on3[0] == (48, 52, 55), str(on3[:1]))
    rig.send("STOP"); time.sleep(0.5)
    rig.cmd("VOICING 4")
    out = rig.cmd("MIDI OFF"); check("MIDI OFF", "なし" in out, out)
    t = rig.now(); rig.send("START"); time.sleep(1.4); rig.send("STOP"); time.sleep(0.5)
    check("MIDI OFF のとき、MIDIが出ない", len(rig.midi_since(t)) == 0, str(rig.midi_since(t)[:3]))
    out = rig.cmd("MIDI BRIDGE"); check("MIDI BRIDGE に戻す", "ブリッジ" in out, out)

    # ---- 休みだけ / 未登録 / 重複 ----
    for pos in (1, 2, 3, 4):
        rig.cmd("@R %d" % pos, 0.1)
    t = rig.now(); rig.send("START"); time.sleep(2.3); rig.send("STOP"); time.sleep(0.5)
    check("全部が空なら、ピアノの音は出ない", not [e for e in groups(rig.midi_since(t)) if e[1] == "on"])
    check("全部が空でも、ステップは進む", rig.text_since(t).count("（休み: 空）") >= 3)
    rig.cmd("@P 1 04A1B2FF", 0.1)
    out = rig.cmd("STATUS"); check("STATUS: 未登録のタグ", "位置1: 未登録のタグ" in out, out)
    t = rig.now(); rig.send("START"); time.sleep(0.4)
    check("未登録は休み(表示)", "（休み: 未登録のタグ）" in rig.text_since(t))
    rig.send("@P 2 04A1B2FF"); time.sleep(0.3)
    check("同じタグを2か所で読むと、重複の警告", "同じタグを読んでいます" in rig.text_since(t))
    rig.send("STOP"); time.sleep(0.5)

    # ---- 登録の画面（「→」を含む）----
    rig.cmd("@R 1", 0.1); rig.cmd("@R 2", 0.1)
    out = rig.cmd("@U 1 04A1B2D0", 0.5)
    check("登録: メニューに Lv.6 と「→」と、これまでの番号", "Lv.6" in out and "32: →" in out and "30: Ⅳm6" in out and "25: Ⅵ" in out and "26: Ⅵsus4" in out and "20: Ⅴsus47" in out, out[-500:])
    out = rig.cmd("29", 1.6)
    check("登録: 29 で「→」を登録できる", "登録しました。" in out and "コード：→" in out and "前のコマと同じコード" in out, out)
    out = rig.cmd("l"); check("登録一覧に「→」", "04 A1 B2 D0 → →" in out, out)
    out = rig.cmd("@U 2 04A1B2D0", 1.6)
    check("登録済みのタグ: 再登録の確認", "このタグを再登録しますか？" in out, out)
    out = rig.cmd("n"); check("n で再登録しない", "再登録しませんでした。" in out)

    # ---- そのほかのコマンド ----
    out = rig.cmd("HELP"); check("HELP", "KEY D" in out and "DRUM 2" in out and "IDLE" in out, out)
    out = rig.cmd("HELP RHYTHM"); check("HELP RHYTHM", "K キック" in out and "!load" in out, out)
    out = rig.cmd("GROOVE 3 6"); check("GROOVE 3 6", "ドラム 3" in out and "バッキング 6" in out, out)
    rig.cmd("GROOVE OFF 1")
    out = rig.cmd("MIDI"); check("MIDI だけで現在の出力先", "音の出力先: ブリッジ" in out, out)
    out = rig.cmd("x");   check("x でテストモード", "RC522 テストモード" in out and "c: 止め方の比較テスト" in out, out)
    out = rig.cmd("START"); check("テストモード中は START できない", "テストモード中です" in out, out)
    if os.environ.get("SKIP_TESTMODE"):
        raise SystemExit_("テストモードの確認は省略")
    out = rig.cmd("i", 0.8)
    alive = re.search(r"応答したリーダー: (\d+) / 4 台", out)
    check("テストモード i: 台数が表示される", alive is not None, out)
    n_alive = int(alive.group(1)) if alive else 0
    print("  応答したリーダー: %d / 4 台" % n_alive)
    out = rig.cmd("v", 1.0, timeout=20); check("テストモード v: エラー0", "通信テスト A" in out and ("→ 合格" in out or n_alive == 0), out)
    out = rig.cmd("w", 1.0, timeout=30); check("テストモード w: エラー0", "通信テスト B" in out and ("→ 合格" in out or n_alive == 0), out)
    out = rig.cmd("m", 1.5);  check("テストモード m: 止め方を試しに切り替える", "設定: 止め方" in out, out)
    out = rig.cmd("g", 0.5);  check("テストモード g: 受信感度を切り替える", "受信感度 = " in out, out)
    out = rig.cmd("c", 0.5, timeout=30, expect="タグが1つも読めませんでした")
    check("テストモード c: タグがないときの案内（本物のタグを置かない前提）",
          "止め方の比較テスト" in out and ("タグが1つも読めませんでした" in out or "2台以上" in out), out)
    out = rig.cmd("q");   check("q でテストモードを終了（試しに変えた設定が元に戻る）", "テストモードを終了しました" in out and "設定: 止め方" in out, out)
    out = rig.cmd("STATUS"); check("q のあと、受信感度は元の 33 dB", "受信感度: 33 dB" in out, out)
except SystemExit_ as e:
    print("（%s）" % e)
finally:
    rig.close()

print("\nscenario_play: checks=%d fails=%d" % (checks, len(fails)))
sys.exit(1 if fails else 0)
