#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第11弾（2026-11-24 夜）の画面のテスト。ご依頼 2 件を、本物の Chrome で、ユーザーと同じ道すじで確かめる。
  ① 音量のポップアップで、ドラムとバッキングの音量を、別々に決められる
     ・バーは3本（全体・ドラム・バッキング）。ドラム・バッキングは、はじめ 50%（標準の大きさ）
     ・本物のマウスでバーを動かす → 保存・メニューの数字・エンジンの通り道（ドラム・バッキング）が、それぞれ変わる。ほかは変わらない
     ・「標準にもどす」・ブラウザを読み込み直しても残る・「進み具合をリセット」でも残る
     ・スマホ（縦・横。指の操作・音あり）: 画面の中に、全部見える・指で動かせる
  ② もとの駒をもとにしたコードは、もとの駒と同じ段ではなく、「自作」の段に並ぶ
     ・以前の版で保存した、レベルつきの自作コード（lvRule なし）は、読み込むときに、「自作」の段に移る（一度だけ）
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
実行:  python3 tools/host_tests/test_round11_ui.py
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, open_game, center, click  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def slider_at(ch, kind, frac):
    """ 本物のマウスで、バーの、左はしから frac の位置をクリック """
    sel = '#vm-slider' if kind == 'master' else '#vm-%s' % kind
    r = ch.eval("(() => { const r = document.querySelector(%r).getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()" % sel)
    click(ch, r[0] + r[2] * frac, r[1])
    time.sleep(0.3)


def gains(ch):
    time.sleep(0.4)                                   # 音量の変更は、少しずつ（なめらかに）効くので、落ち着くのを待つ
    return json.loads(ch.eval("JSON.stringify(__app.engine ? { drums: __app.engine.drumBus.gain.value / 0.57, backing: __app.engine.pianoBus.gain.value / 0.9, melody: __app.engine.melodyBus.gain.value, sfx: __app.engine.sfxBus.gain.value, audition: __app.engine.auditionBus.gain.value } : null)"))


def near(a, b, tol=0.06):
    return abs(a - b) <= tol


def mix_scenario(ch, label, touch=False):
    ch.eval("__app.save.mix = { drums: 50, backing: 50 }; __app.save.volume = 50; __app.muted = false; __app.startStage(__free(), 'free'); true")
    time.sleep(0.9)
    ch.eval("document.querySelector('#btn-sound').click()"); time.sleep(0.3)
    sliders = json.loads(ch.eval("JSON.stringify([...document.querySelectorAll('#volmenu .vm-slider')].map((e) => [e.id, e.value]))"))
    check("%s: バーは3本（全体・ドラム・バッキング）。ドラム・バッキングは、はじめ 50%%" % label, sliders, [["vm-slider", "50"], ["vm-drums", "50"], ["vm-backing", "50"]])
    check("%s: 見出しの文字（ドラム・バッキング・全体）" % label, ch.eval("[...document.querySelectorAll('#volmenu .vm-label')].map((e) => e.textContent)"), ["全体", "ドラム", "バッキング"])
    check("%s: 「標準にもどす」は、すでに標準なので、押せない" % label, ch.eval("document.querySelector('#vm-mixreset').disabled"), True)
    g = gains(ch)
    check("%s: エンジンの通り道は、標準（ドラム・バッキングとも 倍率 1。試聴・メロディ・効果音は別）" % label, [near(g["drums"], 1, 0.01), near(g["backing"], 1, 0.01)], [True, True])
    # 範囲に、全部見える（スマホは、画面の下から出るシート）
    r = json.loads(ch.eval("JSON.stringify((() => { const m = document.querySelector('#volmenu').getBoundingClientRect(); const ids = ['vm-slider', 'vm-drums', 'vm-backing', 'vm-mixreset', 'vm-mute']; return { inside: ids.every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), top: m.top, bottom: m.bottom, vh: innerHeight, vw: innerWidth }; })())"))
    check("%s: 3本のバー・ボタンが、画面の中に、全部見える（切り取られない）%s" % (label, r), r["inside"], True)
    # ドラムのバー
    if touch:
        ch.eval("(() => { const e = document.querySelector('#vm-drums'); e.value = 25; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()")
        time.sleep(0.4)
    else:
        slider_at(ch, 'drums', 0.25)
    mix = json.loads(ch.eval("JSON.stringify(__app.save.mix)"))
    check("%s: ドラムのバーを動かす → ドラムだけ変わる（25%% 前後）・バッキングは 50%%" % label, [20 <= mix["drums"] <= 30, mix["backing"]], [True, 50])
    check("%s: メニューの数字・保存" % label, [ch.eval("document.querySelector('#vm-drums-readout').textContent") == "%d%%" % mix["drums"], json.loads(ch.eval("localStorage.getItem('chordlines.v1')"))["mix"] == mix, ch.eval("document.querySelector('#vm-readout').textContent")], [True, True, "50%"])
    g = gains(ch)
    check("%s: エンジン: ドラムの通り道だけが、小さくなる（倍率 約 0.5）。バッキング・全体は、そのまま %s %s" % (label, mix, g), [near(g["drums"], mix["drums"] / 50), near(g["backing"], 1, 0.01), ch.eval("__app.save.volume")], [True, True, 50])
    check("%s: 「標準にもどす」が、押せるようになる" % label, ch.eval("document.querySelector('#vm-mixreset').disabled"), False)
    # バッキングのバー
    if touch:
        ch.eval("(() => { const e = document.querySelector('#vm-backing'); e.value = 80; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()")
        time.sleep(0.4)
    else:
        slider_at(ch, 'backing', 0.8)
    mix2 = json.loads(ch.eval("JSON.stringify(__app.save.mix)"))
    g = gains(ch)
    check("%s: バッキングのバーを動かす → バッキングだけ変わる（80%% 前後・倍率 約 1.6）。ドラムは、そのまま" % label, [75 <= mix2["backing"] <= 85, mix2["drums"] == mix["drums"], near(g["backing"], mix2["backing"] / 50), near(g["drums"], mix["drums"] / 50)], [True, True, True, True])
    check("%s: 試聴・メロディ・効果音の通り道は、動かない" % label, [near(g["audition"], 0.9, 0.01), near(g["melody"], 0.9, 0.01), near(g["sfx"], 0.7, 0.01)], [True, True, True])
    # ミュートとは別（ミュートは全体だけ）
    ch.eval("document.querySelector('#vm-mute').click()"); time.sleep(0.3)
    check("%s: ミュートしても、ドラム・バッキングの設定は、そのまま" % label, json.loads(ch.eval("JSON.stringify(__app.save.mix)")), mix2)
    ch.eval("document.querySelector('#vm-mute').click()"); time.sleep(0.2)
    # 「標準にもどす」
    ch.eval("document.querySelector('#vm-mixreset').click()"); time.sleep(0.4)
    g = gains(ch)
    check("%s: 「標準にもどす」→ 両方 50%%（全体の音量は、そのまま）。バー・数字・エンジン" % label, [json.loads(ch.eval("JSON.stringify(__app.save.mix)")), ch.eval("[document.querySelector('#vm-drums').value, document.querySelector('#vm-backing').value, document.querySelector('#vm-drums-readout').textContent, document.querySelector('#vm-backing-readout').textContent]"), near(g["drums"], 1, 0.01) and near(g["backing"], 1, 0.01), ch.eval("__app.save.volume")], [{"drums": 50, "backing": 50}, ["50", "50", "50%", "50%"], True, 50])
    check("%s: 「標準にもどす」のあと、ボタンは、また押せない" % label, ch.eval("document.querySelector('#vm-mixreset').disabled"), True)
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def persist_scenario(ch, port):
    """ 読み込み直しても・「進み具合をリセット」でも、残る """
    ch.eval("__app.save.mix = { drums: 30, backing: 70 }; __app.save.volumeSet = true; true")
    ch.eval("document.querySelector('#btn-sound').click(); (() => { const e = document.querySelector('#vm-drums'); e.value = 30; e.dispatchEvent(new Event('input')); })()"); time.sleep(0.3)
    open_game(ch, port, audio=True)
    check("読み込み直し: ドラム 30%・バッキング 70% が残っている（エンジンにも反映）", [json.loads(ch.eval("JSON.stringify(__app.save.mix)")), near(gains(ch)["drums"], 0.6), near(gains(ch)["backing"], 1.4)], [{"drums": 30, "backing": 70}, True, True])
    ch.eval("window.confirm = () => true; document.querySelector('#btn-reset').click()"); time.sleep(0.6)
    check("「進み具合をリセット」でも、ドラム・バッキングの音量は残る", json.loads(ch.eval("JSON.stringify([__app.save.mix, JSON.parse(localStorage.getItem('chordlines.v1')).mix])")), [{"drums": 30, "backing": 70}, {"drums": 30, "backing": 70}])
    # 壊れた保存でも、動く
    ch.eval("localStorage.setItem('chordlines.v1', JSON.stringify({ mix: { drums: 'x', backing: 999 } })); true")
    open_game(ch, port, audio=False)
    check("壊れた保存（ドラムが文字・バッキングが 999）→ 標準 50%・上限 100%", json.loads(ch.eval("JSON.stringify(__app.save.mix)")), {"drums": 50, "backing": 100})


def tray_info(ch, name):
    return json.loads(ch.eval("""JSON.stringify((() => {
      const kids = [...document.querySelector('#tray').children];
      const seps = kids.map((e, i) => [e, i]).filter(([e]) => e.classList && e.classList.contains('sep')).map(([e, i]) => [e.textContent, i]);
      const c = __app.table.byName(%r), i = kids.findIndex((e) => e.dataset && e.dataset.id === String(c.id));
      const my = seps.find((s) => s[0] === '自作'), lv5 = seps.find((s) => s[0] === 'Lv.5'), rep = seps.find((s) => s[0] === 'つなぎ');
      return { level: c.level, i, mySep: my ? my[1] : -1, lv5Sep: lv5 ? lv5[1] : -1, repSep: rep ? rep[1] : -1, seps: seps.map((s) => s[0]), pos: Object.fromEntries(seps) };
    })())""" % name))


def level_migration(ch, port):
    """ 以前の版で保存した、レベルつきの自作コードは、「自作」の段に移る。移したあとに、自分で決めたレベルは、残る """
    old = {
        "cleared": {}, "chordbook": {"custom": [
            {"id": 200, "notes": [55, 59, 62, 65, 69], "rootPc": 7, "symbol": "G9", "name": "Ⅴ9", "level": 2, "color": None, "shape": "auto", "at": 1},
            {"id": 201, "notes": [48, 52, 55, 59, 62], "rootPc": 0, "symbol": "CM9", "name": "Ⅰ9", "level": 5, "color": None, "shape": "auto", "at": 2}], "edits": {}, "nextId": 202},
    }
    ch.eval("localStorage.setItem('chordlines.v1', %s); true" % json.dumps(json.dumps(old)))
    open_game(ch, port, audio=False)
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(1.0)
    a, b = tray_info(ch, "Ⅴ9"), tray_info(ch, "Ⅰ9")
    check("以前の保存（Ⅴ9 は Lv.2・Ⅰ9 は Lv.5）: 読み込むと、レベルは外れて、「自作」の段に並ぶ（Lv.5 のあと・「→」の前）%s" % a["seps"], [a["level"], b["level"], a["mySep"] > a["lv5Sep"] >= 0, a["mySep"] < a["i"] < a["repSep"], b["mySep"] < b["i"] < b["repSep"]], [None, None, True, True, True])
    check("以前の保存: 移したことを、知らせる（トースト）", ch.eval("[...document.querySelectorAll('#toasts .toast')].some((e) => /2つを、「自作」の段に移しました/.test(e.textContent))"), True)
    check("以前の保存: 決まりの版が保存される（次からは、移さない）", json.loads(ch.eval("JSON.stringify(JSON.parse(localStorage.getItem('chordlines.v1')).chordbook.lvRule)")), 2)
    # 自分で決めたレベル（Lv.3）は、読み込み直しても残る
    ch.eval("__app.chordStore.updateCustom(%d, { notes: __app.chordStore.notesOf(%d), level: 3 })" % (a_id(ch, "Ⅴ9"), a_id(ch, "Ⅴ9"))); time.sleep(0.3)
    open_game(ch, port, audio=False)
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(1.0)
    a2 = tray_info(ch, "Ⅴ9")
    check("あとから決めたレベル（Ⅴ9 を Lv.3）は、読み込み直しても残る（Lv.3 の段に入る）。もう移さない", [a2["level"], "Lv.3" in a2["pos"], a2["i"] > a2["pos"].get("Lv.3", 10 ** 6) and a2["i"] < a2["pos"].get("Lv.4", a2["pos"].get("Lv.5", 10 ** 6))], [3, True, True])
    check("JS のエラーがない（移行）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def a_id(ch, name):
    return ch.eval("__app.table.byName(%r).id" % name)


def main():
    if not chrome_available():
        print("test_round11_ui: Chrome がないので、省略します")
        return 0
    srv, port = serve()
    try:
        # ---- PC（音あり）: 本物のマウス ----
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=True)
            mix_scenario(ch, "PC")
            persist_scenario(ch, port)
            level_migration(ch, port)
        # ---- スマホ縦（音あり・指の操作）----
        with ChromeSession(width=390, height=844, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            mix_scenario(ch, "スマホ縦", touch=True)
        # ---- スマホ横 ----
        with ChromeSession(width=844, height=390, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            mix_scenario(ch, "スマホ横", touch=True)
    finally:
        srv.shutdown()
    print("test_round11_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
