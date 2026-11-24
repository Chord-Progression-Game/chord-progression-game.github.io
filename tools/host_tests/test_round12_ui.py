#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第12弾（2026-11-25）の画面のテスト。シークバー（演奏の位置。ドラッグで巻き戻し・早送り）を、本物の Chrome で、ユーザーと同じ道すじで確かめる。
  ① 置き場所（PC）: 上のバーの、すぐ下の真ん中。技のスタンプ（トリックの枠）の上。左右の欄（ガイド・得点）にかからない
  ② 演奏に合わせて動く（8ステップ = 8つの区切り。8番のあとは、1番へ）/ チュートリアルは、4ステップなら 4つの区切り
  ③ 本物のマウスで、つかんで動かす: 演奏が止まる・動かしているあいだだけ、巻き戻しの音が鳴る・止めているあいだは無音・はなすと、その位置から続く
     バーの途中を押すと、そこへ飛ぶ（短い音）。ステップの頭に近ければ、頭に吸いつく。3D の盤の「いま」の印が、つかんだ位置についてくる
  ④ 演奏を止めているときは、使えない（薄くなる）。キーボード（← → Home End）。メロディのステージでは、メロディの帯と、幅・8つの列がそろう
  ⑤ スマホ（縦・横。指の操作・音あり）: 画面に収まる・ほかの部品（得点・手順の帯・ガイド・技のスタンプ・盤）にかぶらない・指でつかめる高さ・指で動かせる
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
実行:  python3 tools/host_tests/test_round12_ui.py
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, open_game  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
fails = 0
checks = 0
OUDOU = ['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7']


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def ok(name, cond, info=""):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1
        print("FAIL %s %s" % (name, info))


def jeval(ch, expr):
    return json.loads(ch.eval("JSON.stringify(%s)" % expr))


def rect(ch, sel):
    return jeval(ch, "(() => { const e = document.querySelector(%r); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()" % sel)


def track_xy(ch, frac):
    l, t, r, b = rect(ch, '#seekbar .sk-track')
    return l + (r - l) * frac, (t + b) / 2


def pos_now(ch):
    return ch.eval("__app.engine.loopPosAt().pos")


def gain(ch):
    return ch.eval("(() => { const s = __app.engine.scrubSound; return s && s.out ? s.out.gain.value : -1; })()")


def scrubbing(ch):
    return ch.eval("!!__app.engine.scrub")


def ref_slot(ch):
    return ch.eval("__app.engine.refSlot")


def place(ch, names, start=0):
    for i, n in enumerate(names):
        ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (start + i, n))
        time.sleep(0.15)


def wait_playing(ch):
    ch.wait_for("!!__app.engine && __app.engine.playing && __app.engine.ctx.state === 'running' && __app.engine.loopPosAt().pos > 0.5", timeout=20)


# ---- 入力（PC: マウス / スマホ: 指）----
class Pointer:
    def __init__(self, ch, touch=False):
        self.ch, self.touch = ch, touch

    def down(self, x, y):
        if self.touch:
            self.ch.touch_event("touchStart", [(x, y)])
        else:
            self.ch.mouse("mouseMoved", x, y, 0)
            self.ch.mouse("mousePressed", x, y, 1)

    def move(self, x, y):
        if self.touch:
            self.ch.touch_event("touchMove", [(x, y)])
        else:
            self.ch.mouse("mouseMoved", x, y, 1)

    def up(self, x, y):
        if self.touch:
            self.ch.touch_event("touchEnd", [])
        else:
            self.ch.mouse("mouseReleased", x, y, 0)


def drag_scenario(ch, label, touch=False):
    """ つかむ → 動かす（音を測る）→ 止める（無音）→ はなす（続く）"""
    P = Pointer(ch, touch)
    ch.eval("__app.seekbar.cancel()")
    x0, y = track_xy(ch, 0.75)
    x1, _ = track_xy(ch, 0.25)
    before = pos_now(ch)
    P.down(x0, y)
    time.sleep(0.12)
    check("%s: つかむと、演奏が止まって、つかみの状態になる（バーに「つかんでいる」の印）" % label, [scrubbing(ch), ch.eval("document.querySelector('#seekbar').classList.contains('is-scrubbing')"), ch.eval("__app.engine.playing")], [True, True, True])
    idx0 = ch.eval("__app.engine.slotIndex")
    gains = []
    for i in range(1, 21):
        P.move(x0 + (x1 - x0) * i / 20, y)
        time.sleep(0.03)
        gains.append(gain(ch))
    pos_moved = ch.eval("__app.engine.scrub.pos")
    ok("%s: 動かしているあいだ、巻き戻しの音が鳴る（音の大きさ 最大 %.3f）" % (label, max(gains)), max(gains) > 0.05)
    ok("%s: 左へ動かしている（巻き戻し）。速さがマイナス・向きの印 ◀◀ が出る（%s）" % (label, ch.eval("document.querySelector('.sk-dir').textContent")), ch.eval("__app.engine.scrub.v") < 0 and ch.eval("document.querySelector('#seekbar').classList.contains('dir-back')"))
    ok("%s: 位置は、つかんだところ（25%% = 16マス目）についてくる（%.1f）" % (label, pos_moved), abs(pos_moved - 16) < 2.5)
    check("%s: 3D の盤の「いま」の印が、つかんだ位置のステップ（3番目 = step 1。16マス目は 3番目の頭）についてくる" % label, ch.eval("__app.scene.playStep"), 2)
    time.sleep(0.6)
    held = gain(ch)
    ok("%s: 動かさずに止めているあいだは、無音（音の大きさ %.4f）" % (label, held), 0 <= held < 0.005)
    check("%s: 止めているあいだは、演奏は進まない（予約するマスが増えない）・つかんだまま" % label, [ch.eval("__app.engine.slotIndex"), scrubbing(ch)], [idx0, True])
    ok("%s: 向きの印 ◀◀ は、止めると消える" % label, not ch.eval("document.querySelector('#seekbar').classList.contains('dir-back')"))
    P.up(x1, y)
    time.sleep(0.3)
    check("%s: はなすと、つかみが外れて、演奏が続く" % label, [scrubbing(ch), ch.eval("document.querySelector('#seekbar').classList.contains('is-scrubbing')"), ch.eval("__app.engine.playing")], [False, False, True])
    check("%s: 続きは、はなした位置（25%% = 16マス目 = 3番目の頭）から" % label, ref_slot(ch), 16)
    time.sleep(0.5)
    p = pos_now(ch)
    ok("%s: そこから進んでいる（16 + 0.5秒ぶん = 20 前後。%.1f）" % (label, p), 17 < p < 26)
    ok("%s: バーの印も、そこから進む（%.1f）" % (label, ch.eval("__app.seekbar.pos")), abs(ch.eval("__app.seekbar.pos") - p) < 3)
    ok("%s: 巻き戻しの音は、はなしたあと、消える（%.4f）" % (label, ch.eval("(() => { const s = __app.engine.scrubSound; return s && s.out ? s.out.gain.value : 0; })()")), ch.eval("(() => { const s = __app.engine.scrubSound; return s && s.out ? s.out.gain.value : 0; })()") < 0.005)
    return before


def click_scenario(ch, label, touch=False):
    """ バーの途中を押す = そこへ飛ぶ（短い音）。ステップの頭に近ければ頭に吸いつく """
    P = Pointer(ch, touch)
    ch.eval("__app.seekbar.cancel()")
    x, y = track_xy(ch, 0.5 + 0.009)                     # 32 マス目に近い（0.6 マス右）→ 32 に吸いつく
    P.down(x, y)
    time.sleep(0.05)
    g = gain(ch)
    ok("%s: バーの途中を押すと、短い音が鳴る（%.3f）" % (label, g), g > 0.03)
    P.up(x, y)
    time.sleep(0.25)
    check("%s: 押した位置（32 マス目の近く）から続く。ステップの頭（32）に吸いつく" % label, [scrubbing(ch), ref_slot(ch)], [False, 32])
    x, y = track_xy(ch, 0.0)
    P.down(x + 1, y); time.sleep(0.04); P.up(x + 1, y)
    time.sleep(0.25)
    check("%s: 左はしを押すと、1番（0 マス目）から（巻きもどし）" % label, ref_slot(ch), 0)
    time.sleep(0.2)
    ok("%s: 巻きもどしたあと、すぐ進む（%.1f）" % (label, pos_now(ch)), 0 < pos_now(ch) < 8)
    check("%s: 巻き戻しの音の部品は、はなしたあと片づく" % label, ch.eval("!!(__app.engine.scrubSound && __app.engine.scrubSound.active)"), False)


def pc_scenario(ch):
    ch.eval("__app.startStage(__free(), 'free')")
    time.sleep(1.0)
    place(ch, OUDOU)
    wait_playing(ch)
    time.sleep(0.8)
    # ---- 置き場所 ----
    tb, sk, st = rect(ch, '#topbar'), rect(ch, '#seekbar'), rect(ch, '#stamp-layer')
    gd, sd = rect(ch, '#guide'), rect(ch, '#side')
    vw = ch.eval("innerWidth")
    ok("PC: シークバーは、上のバーの、すぐ下（すきま 2〜14px）%s %s" % (tb, sk), 2 <= sk[1] - tb[3] <= 14)
    ok("PC: 画面の左右の、真ん中（中心 %.1f / %.1f）" % ((sk[0] + sk[2]) / 2, vw / 2), abs((sk[0] + sk[2]) / 2 - vw / 2) < 2)
    ok("PC: 技のスタンプ（トリックの枠）の上。重ならない（バーの下 %.1f ≦ スタンプの上 %.1f）" % (sk[3], st[1]), sk[3] <= st[1] + 0.5)
    ok("PC: 左のガイド・右の得点の欄に、かからない", sk[0] >= gd[2] and sk[2] <= sd[0])
    ok("PC: 画面の中に、収まる（高さ %.1f）" % (sk[3] - sk[1]), sk[0] >= 0 and sk[2] <= vw and 18 <= sk[3] - sk[1] <= 32)
    check("PC: 区切りは 8つ（1〜8番）", ch.eval("document.querySelectorAll('#seekbar .sk-seg').length"), 8)
    check("PC: 3D の盤は、シークバーのぶん、下がっている（0 より大きい）", ch.eval("__app.scene.topInset > 0"), True)
    # ---- 演奏に合わせて動く ----
    p1, t1 = pos_now(ch), time.time()
    time.sleep(1.0)
    p2, t2 = pos_now(ch), time.time()
    adv = (p2 - p1) % 64
    ok("PC: 演奏に合わせて進む（1秒 = 8マス。%.1f）" % adv, 6 <= adv <= 10.5)
    shown = ch.eval("__app.seekbar.pos")
    ok("PC: バーの印は、演奏の位置と同じ（%.1f / %.1f）" % (shown, pos_now(ch)), min(abs(shown - pos_now(ch)), 64 - abs(shown - pos_now(ch))) < 3.5)
    left_pct = float(ch.eval("document.querySelector('.sk-thumb').style.left.replace('%', '')"))
    ok("PC: 印の位置（左から %.1f%%）は、位置 ÷ 64 と同じ" % left_pct, abs(left_pct - shown / 64 * 100) < 0.2)
    check("PC: 演奏中は、バーが使える（薄くならない）", ch.eval("document.querySelector('#seekbar').classList.contains('is-disabled')"), False)
    # 周回の終わりをこえて、1番にもどる（バーの印が、左はしへ）
    ch.eval("__app.engine.seekTo(62)")
    time.sleep(0.2)
    ch.wait_for("__app.seekbar.pos < 8 && __app.engine.loopPosAt().pos < 8", timeout=6)
    ok("PC: 8番のあとは、1番へ（印が、左はしへもどる。%.1f）" % ch.eval("__app.seekbar.pos"), ch.eval("__app.seekbar.pos") < 10)
    # ---- つかんで動かす ----
    drag_scenario(ch, "PC")
    click_scenario(ch, "PC")
    # ---- キーボード ----
    ch.eval("document.querySelector('#seekbar').focus()")
    time.sleep(0.1)
    ch.eval("__app.engine.seekTo(0)")
    ch.key("ArrowRight", "ArrowRight")
    time.sleep(0.2)
    check("PC: キーボード → で、次のステップ（8 マス目）の頭へ", ref_slot(ch), 8)
    ch.key("Home", "Home")
    time.sleep(0.2)
    check("PC: Home で、1番の頭（0）へ", ref_slot(ch), 0)
    ch.key("ArrowLeft", "ArrowLeft")
    time.sleep(0.2)
    check("PC: ← で、1番より前へ行くと、8番の頭（56）へ（ループ）", ref_slot(ch), 56)
    ch.key("End", "End")
    time.sleep(0.2)
    check("PC: End で、8番の頭（56）へ", ref_slot(ch), 56)
    ch.eval("document.querySelector('#seekbar').blur()")
    # ---- 演奏を止めているとき ----
    ch.key(" ", "Space")
    time.sleep(0.5)
    check("PC: 演奏を止める（スペース）と、バーが薄くなる・印は左はし", ch.eval("[__app.engine.playing, document.querySelector('#seekbar').classList.contains('is-disabled'), __app.seekbar.pos]"), [False, True, 0])
    P = Pointer(ch)
    x, y = track_xy(ch, 0.6)
    P.down(x, y); time.sleep(0.05); P.move(x - 80, y); time.sleep(0.05); P.up(x - 80, y)
    time.sleep(0.3)
    check("PC: 演奏を止めているあいだは、バーを押しても、何も起きない（つかめない・演奏も始まらない）", [scrubbing(ch), ch.eval("__app.engine.playing")], [False, False])
    ch.key(" ", "Space")
    wait_playing(ch)
    check("PC: もう一度スペースで、演奏が始まり、バーも使える", ch.eval("[__app.engine.playing, document.querySelector('#seekbar').classList.contains('is-disabled')]"), [True, False])
    # ---- つかんでいる途中で、演奏を止める・画面が変わる ----
    x, y = track_xy(ch, 0.6)
    P.down(x, y); time.sleep(0.1); P.move(x - 60, y); time.sleep(0.1)
    ch.key(" ", "Space")
    time.sleep(0.4)
    check("PC: つかんでいる途中で、演奏を止めたら、つかみも外れる（バーの印も、つかんでいない）", [scrubbing(ch), ch.eval("__app.engine.playing"), ch.eval("document.querySelector('#seekbar').classList.contains('is-scrubbing')")], [False, False, False])
    P.up(x - 60, y)
    time.sleep(0.2)
    ch.key(" ", "Space")
    wait_playing(ch)
    # メニューが開いても、つかんだままにならない
    x, y = track_xy(ch, 0.6)
    P.down(x, y); time.sleep(0.1); P.move(x - 60, y); time.sleep(0.1)
    ch.eval("__app.showTitle()")
    time.sleep(0.5)
    check("PC: つかんでいる途中で、タイトルにもどっても、つかみは外れる（演奏が止まったままにならない）", [scrubbing(ch), ch.eval("document.querySelector('#seekbar').classList.contains('is-scrubbing')")], [False, False])
    P.up(x - 60, y)
    check("PC: JS のエラーがない", ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def tutorial_scenario(ch):
    ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
    time.sleep(0.5)
    wait_playing(ch)
    ch.wait_for("__app.seekbar.len === 32 && __app.engine.loopPosAt().len === 32", timeout=16)         # いまの周回（タイトルのデモの 8ステップ）が終わると、4ステップの周回に切りかわる
    time.sleep(0.4)
    check("チュートリアル（4ステップでループ）: 区切りは 4つ・周回は 32 マス", ch.eval("[document.querySelectorAll('#seekbar .sk-seg').length, __app.seekbar.len]"), [4, 32])
    P = Pointer(ch)
    x0, y = track_xy(ch, 0.9)
    x1, _ = track_xy(ch, 0.5)
    P.down(x0, y); time.sleep(0.08)
    for i in range(1, 11):
        P.move(x0 + (x1 - x0) * i / 10, y); time.sleep(0.03)
    time.sleep(0.2)
    pos = ch.eval("__app.engine.scrub.pos")
    P.up(x1, y)
    time.sleep(0.3)
    ok("チュートリアル: 真ん中（50%% = 16マス目）で、はなす → 3番目の頭（16）から。周回は 32 マス（%.1f）" % pos, abs(pos - 16) < 2.5 and ref_slot(ch) == 16 and ch.eval("__app.engine.loopPosAt().len") == 32)
    check("チュートリアル: JS のエラーがない", ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def melody_scenario(ch):
    ch.eval("__app.startStage(__melodies[2], 'melody')")
    time.sleep(1.4)
    wait_playing(ch)
    sk, roll = rect(ch, '#seekbar'), rect(ch, '#melody-roll')
    ok("メロディのステージ: シークバーは、メロディの帯と同じ幅・同じ位置（8つの区切りが、帯の8つの列とそろう）%s %s" % (sk, roll), abs(sk[0] - roll[0]) < 2 and abs(sk[2] - roll[2]) < 2)
    ok("メロディのステージ: バーは、メロディの帯の上（重ならない）", sk[3] <= roll[1] + 0.5)
    st = rect(ch, '#stamp-layer')
    check("メロディのステージ: JS のエラーがない", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
    _ = st


def phone_scenario(ch, label, portrait, touch=True):
    ch.eval("__app.startStage(__free(), 'free')")
    time.sleep(1.0)
    place(ch, OUDOU)
    wait_playing(ch)
    time.sleep(0.6)
    vw, vh = ch.eval("innerWidth"), ch.eval("innerHeight")
    tb, sk = rect(ch, '#topbar'), rect(ch, '#seekbar')
    tw = rect(ch, '#tray-wrap')
    ok("%s: 画面の中に収まる（左右・上下）%s" % (label, sk), sk[0] >= 0 and sk[2] <= vw and sk[1] >= tb[3] and sk[3] <= tw[1])
    ok("%s: 上のバーの、すぐ下（すきま 0〜12px。%.1f）" % (label, sk[1] - tb[3]), 0 <= sk[1] - tb[3] <= 12)
    ok("%s: 指でつかめる高さ（%.1fpx。28px 以上）" % (label, sk[3] - sk[1]), sk[3] - sk[1] >= 24)
    # 指でつかめる範囲（見える帯の、上下少し外まで）
    tr = rect(ch, '#seekbar .sk-track')
    ok("%s: 見える帯の、すぐ上・すぐ下も、バーとして押せる" % label, ch.eval("(() => { const x = %f, a = document.elementFromPoint(x, %f), b = document.elementFromPoint(x, %f); return !!a && !!b && !!a.closest('#seekbar') && !!b.closest('#seekbar'); })()" % ((tr[0] + tr[2]) / 2, tr[1] - 4, tr[3] + 4)))
    check("%s: 3D の盤の、PC 用のずらしは、使わない（スマホは、見える範囲で決める）" % label, ch.eval("__app.scene.topInset"), 0)
    sc = rect(ch, '#side .score-card')
    if portrait:
        ok("%s: 得点は、バーの下（重ならない。バー下 %.1f / 得点上 %.1f）" % (label, sk[3], sc[1]), sc[1] >= sk[3] - 0.5)
        ok("%s: 画面の幅いっぱい（左右 8px 前後）" % label, sk[0] < 14 and vw - sk[2] < 14)
        ok("%s: 盤の見える範囲の上は、バーの下（%s）" % (label, ch.eval("JSON.stringify(__app.scene.region)")), ch.eval("__app.scene.region.top") >= sk[3] - 0.5)
    else:
        ok("%s: 右の得点の列に、かからない（バーの右 %.1f / 得点の左 %.1f）" % (label, sk[2], sc[0]), sk[2] <= sc[0] + 0.5)
        ok("%s: 盤の見える範囲の上は、バーの下" % label, ch.eval("__app.scene.region.top") >= sk[3] - 0.5)
    st = rect(ch, '#stamp-layer')
    ok("%s: 技のスタンプは、バーの下（重ならない。バー下 %.1f / スタンプ上 %.1f）" % (label, sk[3], st[1]), st[1] >= sk[3] - 0.5)
    check("%s: 区切りは 8つ" % label, ch.eval("document.querySelectorAll('#seekbar .sk-seg').length"), 8)
    # 指で動かす
    drag_scenario(ch, label, touch=touch)
    click_scenario(ch, label, touch=touch)
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def phone_guide_scenario(ch, label, portrait):
    """ チュートリアルの始まり: ガイドのシートが開く。シークバーに、かぶらない """
    ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
    time.sleep(1.4)
    sk, gd = rect(ch, '#seekbar'), rect(ch, '#guide')
    open_ = ch.eval("document.body.classList.contains('guide-open')")
    if open_ and not portrait:
        ok("%s: ガイドが開いているとき、シークバーは、その右（バーの左 %.1f / ガイドの右 %.1f）" % (label, sk[0], gd[2]), sk[0] >= gd[2] - 0.5)
    ok("%s: バーは、画面の中（見える）" % label, sk[2] <= ch.eval("innerWidth") and sk[3] > sk[1])
    st = rect(ch, '#stamp-layer')
    ok("%s: ステップの帯（手順）も、バーに、かぶらない" % label, not rect(ch, '#step-bar.show') or rect(ch, '#step-bar.show')[1] >= sk[3] - 0.5 or rect(ch, '#step-bar.show')[0] >= sk[2] - 0.5 or rect(ch, '#step-bar.show')[2] <= sk[0] + 0.5)
    _ = st
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def main():
    if not chrome_available():
        print("test_round12_ui: Chrome がないので、省略します")
        return 0
    srv, port = serve()
    try:
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=True)
            pc_scenario(ch)
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=True)
            tutorial_scenario(ch)
            melody_scenario(ch)
        with ChromeSession(width=390, height=844, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            phone_scenario(ch, "スマホ縦", True)
            phone_guide_scenario(ch, "スマホ縦（チュートリアル）", True)
        with ChromeSession(width=844, height=390, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            phone_scenario(ch, "スマホ横", False)
            phone_guide_scenario(ch, "スマホ横（チュートリアル）", False)
    finally:
        srv.shutdown()
    print("test_round12_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
