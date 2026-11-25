#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第13弾（2026-11-25）の画面のテスト。本物の Chrome（スマホの画面・指の操作を再現）で、ユーザーと同じ道すじで確かめる。
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
  ① 演奏を止めているときも、シークバーを指で動かせる: つかめる・動かしている間だけ音が鳴る・はなしても演奏は始まらない・演奏ボタンで、その位置から始まる・止めると、位置は はじめにもどる
  ② メロディの画面: 音を、ダブルタップ（ダブルクリック）で消せる（指・マウス）。ゆっくり2回・ちがう音を続けてタップ・選んだ音が2つのとき、は消えない／押した音だけが消える
  ③ パッシング・ディミニッシュ: ご指定の例（ⅣM7 ／ Ⅲ7｜Ⅴ♯dim7 ／ Ⅵm7 ／ Ⅰ7）を置くと、技の一覧に、丸サ進行と、パッシング・ディミニッシュの、両方が出る（PC・スマホ縦）
実行:  python3 tools/host_tests/test_round13_ui.py
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


def center(ch, sel):
    l, t, r, b = rect(ch, sel)
    return (l + r) / 2, (t + b) / 2


def track_xy(ch, frac):
    l, t, r, b = rect(ch, '#seekbar .sk-track')
    return l + (r - l) * frac, (t + b) / 2


def gain(ch):
    return ch.eval("(() => { const s = __app.engine.scrubSound; return s && s.out ? s.out.gain.value : -1; })()")


def place(ch, names, start=0):
    for i, n in enumerate(names):
        ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (start + i, n))
        time.sleep(0.15)


def wait_playing(ch):
    ch.wait_for("!!__app.engine && __app.engine.playing && __app.engine.ctx.state === 'running' && __app.engine.loopPosAt().pos > 0.5", timeout=20)


# ============ ① 演奏を止めているときの、シークバー（指）============
def scenario_stopped_seek_touch(ch, label):
    ch.eval("__app.startStage(__free(), 'free')")
    time.sleep(1.0)
    place(ch, OUDOU)
    wait_playing(ch)
    time.sleep(0.4)
    # 演奏ボタンをタップして止める（指）
    x, y = center(ch, '#btn-play')
    ch.tap(x, y)
    time.sleep(0.5)
    check("%s: 演奏ボタンをタップして、演奏が止まる。バーは、薄くならない" % label, ch.eval("[__app.engine.playing, document.querySelector('#seekbar').classList.contains('is-disabled'), __app.engine.cueSlot]"), [False, False, 0])
    # 指で、バーを動かす（止めているあいだ）
    x0, y = track_xy(ch, 0.7)
    x1, _ = track_xy(ch, 0.25)
    ch.touch_event("touchStart", [(x0, y)])
    time.sleep(0.15)
    check("%s: 止めているときも、指でつかめる（つかんだ状態。演奏は止まったまま）" % label, ch.eval("[!!__app.engine.scrub, __app.engine.playing, document.querySelector('#seekbar').classList.contains('is-scrubbing')]"), [True, False, True])
    gains = []
    for i in range(1, 21):
        ch.touch_event("touchMove", [(x0 + (x1 - x0) * i / 20, y)])
        time.sleep(0.03)
        gains.append(gain(ch))
    ok("%s: 止めているときも、動かしている間は、巻き戻しの音が鳴る（最大 %.3f）" % (label, max(gains)), max(gains) > 0.05)
    time.sleep(0.6)
    ok("%s: 指を止めている間は、無音（%.4f）" % (label, gain(ch)), 0 <= gain(ch) < 0.005)
    ok("%s: 3D の盤の「いま」の印が、つかんだ位置（3番目）についてくる" % label, ch.eval("__app.scene.playStep") == 2)
    ch.touch_event("touchEnd", [])
    time.sleep(0.3)
    cue = ch.eval("__app.engine.cueSlot")
    check("%s: 指をはなしても、演奏は始まらない。位置（ステップの頭 = 16）が決まる" % label, [ch.eval("!!__app.engine.scrub"), ch.eval("__app.engine.playing"), cue, round(ch.eval("__app.seekbar.pos"))], [False, False, 16, 16])
    # 演奏ボタンをタップ: その位置から始まる
    x, y = center(ch, '#btn-play')
    ch.tap(x, y)
    wait_playing(ch)
    check("%s: 演奏ボタンのタップで、その位置（16）から始まる" % label, [ch.eval("__app.engine.playing"), ch.eval("__app.engine.refSlot"), ch.eval("__app.engine.cueSlot")], [True, 16, 0])
    ok("%s: 始まったあとの位置は、16 から進む（%.1f）" % (label, ch.eval("__app.engine.loopPosAt().pos")), 16 <= ch.eval("__app.engine.loopPosAt().pos") < 28)
    # もう一度止める → はじめにもどる
    x, y = center(ch, '#btn-play')
    ch.tap(x, y)
    time.sleep(0.5)
    check("%s: もう一度止めると、位置は はじめ（0）にもどる" % label, ch.eval("[__app.engine.playing, __app.engine.cueSlot, __app.seekbar.pos]"), [False, 0, 0])
    # 止めているときの、バーの途中をタップ: 短い音 + 位置が決まる
    x, y = track_xy(ch, 0.5 + 0.009)
    ch.touch_event("touchStart", [(x, y)])
    time.sleep(0.05)
    g = gain(ch)
    ch.touch_event("touchEnd", [])
    time.sleep(0.3)
    check("%s: 止めているとき、バーの途中をタップすると、短い音が鳴って、位置が決まる（32）。演奏は始まらない" % label, [g > 0.03, ch.eval("__app.engine.cueSlot"), ch.eval("__app.engine.playing")], [True, 32, False])
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


# ============ ② メロディの画面: ダブルタップ・ダブルクリックで、音を消す ============
def studio_note_xy(ch, slot, midi):
    """ メロディの画面: (マス, 音の高さ) が、画面の中ほどに来るようにスクロールして、その位置（画面の座標）を返す """
    ch.eval("""(() => { const s = __app.studio, sc = s.el.scroll; sc.scrollTop = Math.max(0, (96 - %d) * s.rh + s.el.head.offsetHeight - sc.clientHeight / 2);
      sc.scrollLeft = Math.max(0, (%d + 0.5) * s.cw + s.el.keys.offsetWidth - sc.clientWidth / 2); })()""" % (midi, slot))
    time.sleep(0.2)
    return ch.eval("(() => { const s = __app.studio, r = s.el.grid.getBoundingClientRect(); return [r.left + (%d + 0.5) * s.cw, r.top + (96 - %d + 0.5) * s.rh]; })()" % (slot, midi))


def notes(ch):
    return ch.eval("JSON.stringify(__app.melodyDoc.items.map((n) => [n.s, n.l, n.m]).sort((a, b) => a[0] - b[0] || a[2] - b[2]))").replace(" ", "")


def scenario_studio_double_tap(ch, label, touch):
    ch.eval("__app.startStage(__free(), 'free')")
    time.sleep(0.8)
    place(ch, ['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅴ7'])
    ch.eval("document.querySelector('#btn-studio').click()")
    time.sleep(0.8)
    check("%s: メロディの画面が開く" % label, ch.eval("__app.state"), "studio")

    def tap(x, y):
        if touch:
            ch.tap(x, y)
        else:
            ch.mouse("mouseMoved", x, y, 0)
            ch.mouse("mousePressed", x, y, 1)
            ch.mouse("mouseReleased", x, y, 0)

    base = "[[0,2,72],[4,2,74],[8,12,76]]"
    ch.eval("__app.melodyDoc.replaceAll([[0,2,72],[4,2,74],[8,12,76]]); __app.studio.select(null)")
    time.sleep(0.4)
    x, y = studio_note_xy(ch, 4, 74)
    tap(x, y)
    time.sleep(0.1)
    check("%s: 1回タップ: 音は消えない（選ばれるだけ）" % label, [notes(ch), ch.eval("__app.studio.sel.size")], [base, 1])
    tap(x, y)
    time.sleep(0.3)
    check("%s: ダブルタップ（同じ音を、続けて2回）: その音が消える。ほかの音は残る・選びも消える" % label, [notes(ch), ch.eval("__app.studio.sel.size"), ch.eval("document.querySelectorAll('#studio .ms-note').length")], ["[[0,2,72],[8,12,76]]", 0, 2])
    x_u, y_u = center(ch, '#ms-undo')
    tap(x_u, y_u)
    time.sleep(0.3)
    check("%s: ダブルタップで消したあとも、元に戻せる（1回で、もとの3つ）" % label, notes(ch), base)
    time.sleep(0.5)
    x, y = studio_note_xy(ch, 4, 74)
    tap(x, y)
    time.sleep(0.6)
    tap(x, y)
    time.sleep(0.3)
    check("%s: 間があいた2回（0.6秒）は、ダブルタップではない。消えない" % label, notes(ch), base)
    time.sleep(0.5)
    x2, y2 = studio_note_xy(ch, 0, 72)
    x, y = studio_note_xy(ch, 4, 74)
    tap(x, y)
    time.sleep(0.1)
    x2, y2 = studio_note_xy(ch, 0, 72)
    tap(x2, y2)
    time.sleep(0.3)
    check("%s: ちがう音を、続けてタップしても、消えない" % label, notes(ch), base)
    # 選んだ音が2つのとき: 押した音だけが消える
    ch.eval("__app.melodyDoc.replaceAll([[0,2,72],[4,2,74],[8,12,76]]); __app.studio.select(null)")
    time.sleep(0.3)
    ch.eval("__app.studio.setSel([__app.melodyDoc.items[0].id, __app.melodyDoc.items[1].id], __app.melodyDoc.items[1].id)")
    time.sleep(0.1)
    x, y = studio_note_xy(ch, 4, 74)
    tap(x, y)
    time.sleep(0.1)
    tap(x, y)
    time.sleep(0.3)
    check("%s: 選んだ音が2つあるときの、ダブルタップ: 押した音だけが消える" % label, [notes(ch), ch.eval("document.querySelectorAll('#studio .ms-note').length")], ["[[0,2,72],[8,12,76]]", 2])
    # 空きを2回タップしても、音が2つ増えるだけで、消える音はない（空きのダブルタップは、消さない）
    ch.eval("__app.melodyDoc.replaceAll([[0,2,72]]); __app.studio.select(null)")
    time.sleep(0.3)
    x, y = studio_note_xy(ch, 40, 70)
    tap(x, y)
    time.sleep(0.2)
    n1 = ch.eval("__app.melodyDoc.count")
    tap(x, y)
    time.sleep(0.3)
    check("%s: 空きのタップで、音が置かれる（2つになる）。置いた直後に、その音を、もう一度タップしても、消えない（置くタップは、ダブルタップの1回目に数えない）" % label, [n1, ch.eval("__app.melodyDoc.count")], [2, 2])
    ch.eval("__app.studio.close()")
    time.sleep(0.4)
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


# ============ ③ パッシング・ディミニッシュ（ご指定の例）============
def scenario_passing_dim(ch, label):
    ch.eval("__app.startStage(__free(), 'free')")
    time.sleep(1.0)
    ch.eval("(() => { __app.game.clear(); })()")
    time.sleep(0.2)
    # ⅣM7 ／ Ⅲ7｜Ⅴ♯dim7 ／ Ⅵm7 ／ Ⅰ7（1マスを半割 = 前半 Ⅲ7・後半 Ⅴ♯dim7）
    ch.eval("""(() => { const G = __app.game, t = __app.table;
      G.place(0, t.byName('ⅣM7').id); G.place(1, t.byName('Ⅲ7').id); G.place(2, t.byName('Ⅵm7').id); G.place(3, t.byName('Ⅰ7').id);
      G.placeAt(1, 'R', t.byName('Ⅴ#dim7').id); })()""")
    time.sleep(0.8)
    check("%s: 準備: 分割したマスの後半が Ⅴ♯dim7" % label, ch.eval("[__app.game.board.slice(0, 4).map((id) => __app.table.byId(id).name), __app.table.byId(__app.game.split[1]).name]"), [["ⅣM7", "Ⅲ7", "Ⅵm7", "Ⅰ7"], "Ⅴ#dim7"])
    ch.eval("document.body.classList.add('side-open')") if label.startswith("スマホ") else None
    time.sleep(0.3)
    rows = jeval(ch, "[...document.querySelectorAll('#trick-list li')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())")
    ok("%s: 技の一覧に、丸サ進行が出る（%s）" % (label, " / ".join(rows)[:120]), any("丸サ" in r for r in rows))
    ok("%s: 技の一覧に、パッシング・ディミニッシュが出る" % label, any("パッシング" in r for r in rows))
    ok("%s: 「進行感がない」「唐突」などの減点は、出ない" % label, not any(("進行感" in r or "唐突" in r) for r in rows))
    check("%s: 点数が、dim を足す前（490）より高い（742）" % label, ch.eval("__app.game.analysis.score.total"), 742)
    # 技の詳細: パッシング・ディミニッシュの説明に、新しい定義が出る
    ch.eval("[...document.querySelectorAll('#trick-list li.clickable')].find((e) => /パッシング/.test(e.textContent)).click()")
    time.sleep(0.5)
    txt = ch.eval("document.querySelector('#trickdetail') ? document.querySelector('#trickdetail').textContent : ''")
    ok("%s: 技の詳細に、「半音上か半音下」の説明が出る" % label, "半音" in txt and "飛ばして" in txt)
    ch.key("Escape", "Escape")
    time.sleep(0.4)
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def main():
    if not chrome_available():
        print("（第13弾の画面のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        # ① 止めているときのシークバー（スマホ縦・横。指。音あり）
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            scenario_stopped_seek_touch(ch, "スマホ縦")
        with ChromeSession(width=844, height=390, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            scenario_stopped_seek_touch(ch, "スマホ横")
        # ② メロディの画面のダブルタップ（スマホ縦の指・PC のマウス）
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            scenario_studio_double_tap(ch, "スマホ縦（指）", True)
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            scenario_studio_double_tap(ch, "PC（マウス）", False)
        # ③ パッシング・ディミニッシュ
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            scenario_passing_dim(ch, "PC")
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            scenario_passing_dim(ch, "スマホ縦")
    finally:
        srv.shutdown()
    print("test_round13_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
