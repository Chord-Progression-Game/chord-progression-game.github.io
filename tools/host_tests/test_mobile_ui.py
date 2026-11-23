#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
スマホ（iPhone の大きさ・タッチ）で、ゲームが動くかを、本物の Chrome（スマホの画面・指の操作を再現）で確かめる（2026-11-23）。
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
  縦持ち・横持ちで、配置の切り替わり（シート・手順の帯・横にはみ出さない）/ 指の操作（タップで選んで置く・ダブルタップで次の場所・
  長押しのメニュー・横になぞるとトレイが動く・上へなぞって持ち上げる・技の枠をタップ）/ 編集画面（タップで音を置く）
実行:  python3 tools/host_tests/test_mobile_ui.py
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, center, open_game  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def place_board(ch, spec):
    ch.eval("__app.game.clear()")
    for i, n in enumerate(spec.split()):
        if n != "-":
            ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n))
    time.sleep(0.25)


def card_xy(ch, cid):
    ch.eval("(() => { const c = document.querySelector('#tray .pc[data-id=\"%d\"]'); if (c) c.scrollIntoView({ inline: 'center', block: 'nearest' }); })()" % cid)
    time.sleep(0.2)
    return center(ch, '#tray .pc[data-id="%d"]' % cid)


def cid(ch, name):
    return ch.eval("__app.table.byName(%r).id" % name)


def no_overflow(ch):
    return ch.eval("document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1")


def main():
    if not chrome_available():
        print("（スマホ表示のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        # ============ 縦持ち（iPhone 14 の大きさ）============
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            check("縦持ち: スマホの配置になる（is-phone・指の端末）", ch.eval("[document.body.classList.contains('is-phone'), document.body.classList.contains('is-touch'), __app.scene.light]"), [True, True, True])
            check("縦持ち: タイトルは、横にはみ出さない", no_overflow(ch), True)
            ch.eval("__app.showStages()"); time.sleep(0.4)
            check("縦持ち: ステージ選択は、2列・横にはみ出さない", ch.eval("[getComputedStyle(document.querySelector('#stage-grid')).gridTemplateColumns.split(' ').length, document.documentElement.scrollWidth <= window.innerWidth + 1]"), [2, True])
            # ---- チュートリアル: ガイドのシート・手順の帯 ----
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')"); time.sleep(0.9)
            check("縦持ち・チュートリアル: 始まりに、ガイドのシートが開く", ch.eval("[document.body.classList.contains('guide-open'), getComputedStyle(document.querySelector('#guide')).display]"), [True, "block"])
            check("縦持ち・チュートリアル: 手順の帯に「2番に ⅣM7 を置こう」", ch.eval("[document.querySelector('#step-bar').classList.contains('show'), document.querySelector('#step-bar').textContent]"), [True, "12番に「ⅣM7」を置こう"])
            ch.eval("document.querySelector('#guide-toggle').click()"); time.sleep(0.4)
            check("縦持ち: シートの「−」で、ガイドがとじる", ch.eval("[document.body.classList.contains('guide-open'), getComputedStyle(document.querySelector('#guide')).display]"), [False, "none"])
            check("縦持ち: 技の一覧・理由は、ふだんしまってある（得点だけ見える）", ch.eval("[getComputedStyle(document.querySelector('#trick-list')).display, document.querySelector('#score-num').getBoundingClientRect().top > 0]"), ["none", True])
            # ---- フリープレイ ----
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
            check("縦持ち・フリープレイ: 横にはみ出さない・トレイは下・盤は、上のバーとトレイの間", ch.eval("""(() => { const tb = document.querySelector('#topbar').getBoundingClientRect(), tw = document.querySelector('#tray-wrap').getBoundingClientRect();
                const p = __app.scene.slotToScreen(0, 0.4), q = __app.scene.slotToScreen(7, 0.4);
                return [document.documentElement.scrollWidth <= window.innerWidth + 1, Math.round(tw.bottom) === window.innerHeight, p.y > tb.bottom && q.y < tw.top, p.x > 0 && q.x < window.innerWidth]; })()"""), [True, True, True, True])
            # ---- タップで、選んで → 盤をタップ ----
            v7 = cid(ch, "Ⅴ7")
            x, y = card_xy(ch, v7)
            ch.tap(x, y); time.sleep(0.4)
            check("タップ: 駒を選ぶ（持ち上げの印）。盤には置かない", ch.eval("[__app.input.armed, __app.game.board.every((x) => x === null)]"), [v7, True])
            sx, sy = ch.eval("(() => { const p = __app.scene.slotToScreen(2, 0.4); return [p.x, p.y]; })()")
            ch.tap(sx, sy); time.sleep(0.5)
            check("タップ: つづけて盤をタップ（3番）で、置ける", ch.eval("[__app.game.board[2], __app.input.armed]"), [v7, None])
            # ---- ダブルタップで、次の場所 ----
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            for name in ("Ⅰ", "Ⅵm"):
                x, y = card_xy(ch, cid(ch, name))
                ch.tap(x, y); time.sleep(0.08); ch.tap(x, y); time.sleep(0.4)
            check("ダブルタップ: 盤の次の場所に、順に置く（1番・2番）", ch.eval("JSON.stringify(__app.game.board.slice(0, 3))"), json.dumps([cid(ch, "Ⅰ"), cid(ch, "Ⅵm"), None]).replace(" ", ""))
            # ---- 上へなぞって持ち上げて置く ----
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            x, y = card_xy(ch, cid(ch, "Ⅳ"))
            ch.touch_drag(x, y, sx, sy, steps=14); time.sleep(0.5)
            check("なぞる: 駒を、盤の上まで引き上げて離すと、置ける", ch.eval("__app.game.board[2]"), cid(ch, "Ⅳ"))
            # ---- 横になぞると、トレイが動く（駒は、選ばれない）----
            ch.eval("document.querySelector('#tray').scrollLeft = 0; __app.input.cancel()"); time.sleep(0.2)
            x, y = center(ch, '#tray .pc[data-id="%d"]' % cid(ch, "Ⅰ"))
            before = ch.eval("document.querySelector('#tray').scrollLeft")
            ch.touch_drag(x + 120, y, x - 160, y, steps=14); time.sleep(0.6)
            check("横になぞる: トレイが動く（スクロール）。駒は、選ばれない・置かれない", ch.eval("[document.querySelector('#tray').scrollLeft > %d + 40, __app.input.armed, __app.game.board.filter((x) => x !== null).length]" % before), [True, None, 1])
            # ---- 長押しで、メニュー ----
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            x, y = card_xy(ch, cid(ch, "Ⅴ7"))
            ch.touch_event("touchStart", [(x, y)]); time.sleep(0.75); ch.touch_event("touchEnd", []); time.sleep(0.4)
            check("長押し: 右クリックと同じメニュー（コードを編集）が出る。駒は、選ばれない", ch.eval("[!document.querySelector('#chordmenu').classList.contains('hidden'), [...document.querySelectorAll('#chordmenu .cm-item')].map((e) => e.textContent), __app.input.armed]"), [True, ["コードを編集"], None])
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[0].click()"); time.sleep(0.6)
            check("長押し → 編集: 編集画面が開く。全画面（横にはみ出さない）", ch.eval("[__app.state, document.documentElement.scrollWidth <= window.innerWidth + 1, document.querySelector('.cl-card').getBoundingClientRect().width >= window.innerWidth - 1]"), ["chordlab", True, True])
            # ---- 編集画面: タップで音を置く・ダブルタップで消す ----
            ch.eval("__app.chordLab.s.notes = []; __app.chordLab.recompute()"); time.sleep(0.2)
            def lab_tap(m):
                ch.eval("(() => { const lab = __app.chordLab, sc = document.querySelector('.cl-scroll'); const y = (84 - %d) * lab.rh; sc.scrollTop = Math.max(0, y - sc.clientHeight / 2); })()" % m)
                time.sleep(0.12)
                px, py = ch.eval("(() => { const g = document.querySelector('.cl-grid').getBoundingClientRect(); const lab = __app.chordLab; return [g.left + g.width / 2, g.top + (84 - %d) * lab.rh + lab.rh / 2]; })()" % m)
                ch.tap(px, py); time.sleep(0.2)
                return px, py
            for m in (57, 60, 64, 67, 71):
                lab_tap(m)
            check("編集画面（指）: 行をタップで、音が置かれる（A C E G B → Am9）", [ch.eval("JSON.stringify(__app.chordLab.s.notes)"), ch.eval("__app.chordLab.cands[0].symbol")], ["[57,60,64,67,71]", "Am9"])
            px, py = lab_tap(71)
            ch.tap(px, py); time.sleep(0.1)
            check("編集画面（指）: 音をタップ → もう一度（ダブルタップ）で消える", ch.eval("JSON.stringify(__app.chordLab.s.notes)"), "[57,60,64,67]")
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.4)
            # ---- 技の枠をタップ・技の一覧 ----
            place_board(ch, "ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7")
            time.sleep(1.2)
            ins = ch.eval("JSON.stringify(__app.game.analysis.instances.findIndex((i) => i.kind === 'oudou'))")
            r = json.loads(ch.eval("JSON.stringify(__app.scene.labelScreenRect(__app.game.analysis.instances[%s]))" % ins))
            ch.tap(r["x"] + r["w"] / 2 + 6, r["y"]); time.sleep(0.6)
            check("技の枠をタップ: 詳細が開く（枠より、少し外側を押しても、当たる）。全画面・横にはみ出さない", ch.eval("[__app.state, document.querySelector('.td-card').getBoundingClientRect().width >= window.innerWidth - 1, document.documentElement.scrollWidth <= window.innerWidth + 1]"), ["trickdetail", True, True])
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.4)
            ch.tap(*center(ch, '#btn-side-toggle')); time.sleep(0.5)
            check("「技 ▾」: タップで、技の一覧が開く / もう一度でとじる", ch.eval("[document.body.classList.contains('side-open'), getComputedStyle(document.querySelector('#trick-list')).display, document.querySelector('#btn-side-toggle').textContent]"), [True, "flex", "技 ▴"])
            ch.tap(*center(ch, '#btn-side-toggle')); time.sleep(0.3)
            check("「技 ▴」: もう一度でとじる", ch.eval("document.body.classList.contains('side-open')"), False)
            ch.eval("document.querySelector('#btn-presets').click()"); time.sleep(0.5)
            check("プリセット（縦持ち）: 全画面・横にはみ出さない", ch.eval("[document.querySelector('.preset-card').getBoundingClientRect().width >= window.innerWidth - 1, document.documentElement.scrollWidth <= window.innerWidth + 1]"), [True, True])
            ch.eval("__app.presetMenu.close()"); time.sleep(0.3)
            ch.eval("document.querySelector('#btn-studio').click()"); time.sleep(0.6)
            check("メロディの画面（縦持ち）: 全画面・ページは、横にはみ出さない（ピアノロールだけ、横になぞる）", ch.eval("[document.querySelector('.ms-card').getBoundingClientRect().width >= window.innerWidth - 1, document.documentElement.scrollWidth <= window.innerWidth + 1, document.querySelector('.ms-scroll').scrollWidth > document.querySelector('.ms-scroll').clientWidth]"), [True, True, True])
            ch.eval("__app.studio.close()"); time.sleep(0.3)
            check("ページのエラー（縦持ち）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")

        # ============ 横持ち（iPhone 14 の横）============
        with ChromeSession(width=844, height=390, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            check("横持ち: スマホの配置になる", ch.eval("[document.body.classList.contains('is-phone'), __app.scene.light]"), [True, True])
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
            check("横持ち・フリープレイ: 横にはみ出さない。上のバー・トレイは、画面の中。盤は、2つの間", ch.eval("""(() => { const tb = document.querySelector('#topbar').getBoundingClientRect(), tw = document.querySelector('#tray-wrap').getBoundingClientRect();
                const p = __app.scene.slotToScreen(0, 0.4), q = __app.scene.slotToScreen(7, 0.4);
                return [document.documentElement.scrollWidth <= window.innerWidth + 1, tb.height < 70, Math.round(tw.bottom) === window.innerHeight, p.y > tb.bottom && q.y < tw.top]; })()"""), [True, True, True, True])
            place_board(ch, "ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7")
            time.sleep(1.0)
            check("横持ち: 右の列に、得点と技の一覧が見える（技の枠もタップできる）", ch.eval("[document.querySelector('#score-num').getBoundingClientRect().right <= window.innerWidth, getComputedStyle(document.querySelector('#trick-list')).display]"), [True, "flex"])
            ins = ch.eval("JSON.stringify(__app.game.analysis.instances.findIndex((i) => i.kind === 'oudou'))")
            r = json.loads(ch.eval("JSON.stringify(__app.scene.labelScreenRect(__app.game.analysis.instances[%s]))" % ins))
            ch.tap(r["x"], r["y"]); time.sleep(0.6)
            check("横持ち: 技の枠をタップで、詳細が開く", ch.eval("__app.state"), "trickdetail")
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.4)
            ch.eval("document.querySelector('#btn-chord-new').click()"); time.sleep(0.6)
            check("横持ち: 編集画面が開く。画面の中におさまる", ch.eval("[__app.state, document.querySelector('.cl-card').getBoundingClientRect().bottom <= window.innerHeight + 1, document.documentElement.scrollWidth <= window.innerWidth + 1]"), ["chordlab", True, True])
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.4)
            check("ページのエラー（横持ち）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")

        # ============ 音を読み込んだ状態（iPhone）: 消音スイッチ対策の、無音の <audio> が、画面を固めないか ============
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            f0 = ch.eval("window.__frames"); time.sleep(1.0); f1 = ch.eval("window.__frames")
            check("iPhone + 音あり: 音が読み込まれ、無音の <audio>（0.5秒・くり返し）が動く。画面は、固まらない（1秒で 20 フレーム以上）", ch.eval("[!!__app.engine, !!__app.keepAlive, __app.keepAlive && __app.keepAlive.loop, __app.keepAlive && __app.keepAlive.src.startsWith('blob:')]"), [True, True, True, True])
            check("iPhone + 音あり: 画面が、動き続ける", f1 - f0 >= 20, True)
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(1.0)
            check("iPhone + 音あり: フリープレイが始まる（駒 32）。エラーなし", ch.eval("[document.querySelectorAll('#tray .pc').length, JSON.stringify(window.__errors || [])]"), [32, "[]"])
            ch.eval("__app.game.place(0, __app.table.byName('Ⅰ').id)"); time.sleep(0.6)
            check("iPhone + 音あり: 演奏が始まる（エンジンが動く）", ch.eval("__app.engine.playing"), True)

        # ============ PC の大きさでは、PC の配置のまま ============
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.5)
            check("PC の大きさ: スマホの配置にならない（ボタン・帯は出ない）", ch.eval("[document.body.classList.contains('is-phone'), getComputedStyle(document.querySelector('#btn-side-toggle')).display, getComputedStyle(document.querySelector('#btn-guide-toggle')).display, getComputedStyle(document.querySelector('#guide')).display, __app.scene.light]"), [False, "none", "none", "block", False])
    finally:
        srv.shutdown()
    print("test_mobile_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
