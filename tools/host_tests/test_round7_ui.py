#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第7弾（2026-11-23）の画面操作のテスト。本物の Chrome（PC・スマホの画面・指の操作）で確かめる。
  ・クリアの結果が、別の画面（技の詳細など）を開いていても、閉じたあとで出る（以前は出なかった）
  ・スマホ縦持ち: タイトルの背景で、技のスタンプが出ない / 音・音量のメニューが、画面の直下に出て、見える・閉じられる /
    メロディの帯が、画面の幅におさまる（縦に折り返された文字がない）・盤が帯の下にある / 結果のボタンが、2列
  ・タイムアタック・チュートリアルを選ぶ・メニューの名前と順番
  ・チャレンジステージ: 選ぶ画面・条件の一覧・提出ボタン・結果
  ・分割したマス: 駒のあるマスの、左・右にドラッグして置く（前半・後半）/ まん中は置きかえ / 半分だけはずす / 指（タップ）でも
  ・結果が出るときに、開いていた画面が、きちんと閉じる（あとで、また開ける）
実行:  python3 tools/host_tests/test_round7_ui.py
Chrome がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, center, open_game, drag, click  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def cid(ch, name):
    return ch.eval("__app.table.byName(%r).id" % name)


def board_names(ch):
    return ch.eval("JSON.stringify([__app.game.board.map(i => i === null ? '-' : __app.table.byId(i).name).join(' '), __app.game.split.map(i => i === null ? '-' : __app.table.byId(i).name).join(' ')])")


def slot_point(ch, slot, dx_px=0, dy_px=8):
    p = ch.eval("(() => { const p = __app.scene.slotToScreen(%d, 0.4); return [p.x, p.y]; })()" % slot)
    return p[0] + dx_px, p[1] + dy_px


def tray_center(ch, name):
    c = cid(ch, name)
    ch.eval("(() => { const e = document.querySelector('#tray .pc[data-id=\"%d\"]'); if (e) e.scrollIntoView({ inline: 'center', block: 'nearest' }); })()" % c)
    time.sleep(0.15)
    return center(ch, '#tray .pc[data-id="%d"]' % c)


def cell_px(ch):
    """ 1マスの、画面の上の幅（px）を、隣のマスとの間隔から """
    a = slot_point(ch, 0)
    b = slot_point(ch, 1)
    return abs(b[0] - a[0])


def main():
    if not chrome_available():
        print("（第7弾の画面操作のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        # ====================== PC ======================
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            # ---- クリアの結果: 技の詳細を開いたまま、時刻をすぎても、閉じたあとで出る ----
            ch.eval("__app.clearDelayOverride = 1500")
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(0.8)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(1, t.byName('ⅣM7').id); g.place(2, t.byName('Ⅴ7').id); g.place(3, t.byName('Ⅰ').id); return true; })()")
            time.sleep(0.4)
            ch.eval("(() => { const i = __app.game.analysis.instances[0]; __app.trickDetail.show(i); return true; })()")
            time.sleep(0.3)
            check("技の詳細を開く: 状態は trickdetail", ch.eval("__app.state"), "trickdetail")
            time.sleep(2.2)                                                   # クリアの結果が出るはずの時刻を、すぎる
            check("詳細を開いている間は、クリアの結果は出ない", ch.eval("document.querySelector('#result').classList.contains('hidden')"), True)
            ch.eval("__app.trickDetail.close()")
            time.sleep(1.2)
            check("詳細を閉じると、クリアの結果が出る（以前は、出なかった）", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), document.querySelector('#result-kicker').textContent]"), [True, "STAGE CLEAR"])
            # メニュー・プリセットでも
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(0.6)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(1, t.byName('ⅣM7').id); g.place(2, t.byName('Ⅴ7').id); g.place(3, t.byName('Ⅰ').id); return true; })()")
            time.sleep(0.2)
            ch.eval("document.querySelector('#btn-menu').click()")
            time.sleep(2.0)
            check("メニューを開いている間は、クリアの結果は出ない", ch.eval("document.querySelector('#result').classList.contains('hidden')"), True)
            ch.eval("document.querySelector('#pause [data-act=resume]').click()")
            time.sleep(1.2)
            check("メニューから「つづける」: クリアの結果が出る", ch.eval("!document.querySelector('#result').classList.contains('hidden')"), True)
            # 結果が出るときに、開いていた画面が、きちんと閉じる（あとで、また開ける）
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.6)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(0, t.byName('Ⅱm7').id); g.place(1, t.byName('Ⅴ7').id); g.place(2, t.byName('ⅠM7').id); return true; })()")
            time.sleep(0.4)
            ch.eval("__app.trickDetail.show(__app.game.analysis.instances[0])")
            ch.eval("__app.soundMenu.open()")
            time.sleep(0.2)
            ch.eval("__app.startStage(__challenge(), 'challenge')")
            time.sleep(0.5)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(0, t.byName('Ⅱm7').id); return true; })()")
            ch.eval("__app.trickDetail.show({ kind: 'dominant_motion', variant: '強進行', name: 'ドミナントモーション', color: '#e2704a', chords: ['Ⅱm7', 'Ⅴ7'], positions: [0, 1], startPos: 0, endPos: 1, endFirst: 1, points: 100, total: 100, reason: 'x', id: 'x' })")
            ch.eval("__app.game.timeLeft = 0.05")
            time.sleep(0.9)
            check("タイムアタックが終わって結果が出る: 開いていた技の詳細・音のメニューは、きちんと閉じる", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), __app.trickDetail.isOpen, __app.soundMenu.isOpen, document.querySelector('#trickdetail').classList.contains('hidden')]"), [True, False, False, True])
            ch.eval("[...document.querySelectorAll('#result-btns button')].find(b => b.textContent.includes('盤面を見る')).click()")
            time.sleep(0.3)
            ch.eval("(() => { const i = __app.game.analysis.instances[0]; if (i) __app.trickDetail.show(i); return true; })()")
            time.sleep(0.2)
            check("結果を閉じたあと: 技の詳細を、また開ける（以前は、開いたままと覚えられていて、開けなかった）", ch.eval("[__app.state, !document.querySelector('#trickdetail').classList.contains('hidden')]"), ["trickdetail", True] if ch.eval("__app.game.analysis.instances.length > 0") else ["play", False])

            # ---- 名前・順番 ----
            ch.eval("__app.showTitle()")
            time.sleep(0.5)
            check("タイトルのメニュー: 順番と名前", ch.eval("[...document.querySelectorAll('#title .menu button')].map(b => b.querySelector('span').firstChild.textContent)"),
                  ["チュートリアル", "チュートリアルを選ぶ", "メロディーにコードをつける", "チャレンジステージ", "フリープレイ", "タイムアタック", "対戦"])
            click(ch, *center(ch, '#title .menu button[data-act=challenge]'))
            time.sleep(0.6)
            check("タイムアタック: 見出しは TIME ATTACK・タイマーがある", ch.eval("[document.querySelector('#stage-no').textContent, document.querySelector('#stage-title').textContent, !document.querySelector('#timer').classList.contains('hidden')]"), ["TIME ATTACK", "タイムアタック", True])
            ch.eval("document.querySelector('#btn-menu').click()")
            time.sleep(0.3)
            check("タイムアタックのメニュー: 「選ぶ」ボタンはない（フリー・タイムアタックには、選ぶ画面がない）", ch.eval("document.querySelector('#pause-stages').classList.contains('hidden')"), True)
            ch.eval("document.querySelector('#pause [data-act=title]').click()")
            time.sleep(0.5)

            # ---- チャレンジステージ ----
            click(ch, *center(ch, '#title .menu button[data-act=trial]'))
            time.sleep(0.5)
            check("チャレンジステージ: 選ぶ画面（9つ・最初だけ開いている）", ch.eval("[document.querySelector('#stages-title').textContent, document.querySelectorAll('#stage-grid .stage-card').length, document.querySelectorAll('#stage-grid .stage-card.locked').length]"), ["CHALLENGE STAGE", 9, 8])
            click(ch, *center(ch, '#stage-grid .stage-card[data-stage=c01]'))
            time.sleep(0.8)
            check("チャレンジステージ 1: 条件が出る・提出は押せない・メニューに「選ぶ」", ch.eval("[document.querySelector('#stage-no').textContent, document.querySelectorAll('.trial-rules .step').length, document.querySelector('#btn-trial-done').disabled]"), ["CHALLENGE 01", 2, True])
            for i, n in enumerate(["Ⅲm", "Ⅵm", "Ⅱm", "Ⅴ7", "ⅠM7"]):
                x0, y0 = tray_center(ch, n)
                x1, y1 = slot_point(ch, i)
                drag(ch, x0, y0, x1, y1)
                time.sleep(0.1)
            time.sleep(0.5)
            check("チャレンジステージ 1: ドラッグで置く → 条件がそろって、提出できる", ch.eval("[document.querySelector('#btn-trial-done').disabled, document.querySelector('#goal-chip').classList.contains('done')]"), [False, True])
            click(ch, *center(ch, '#btn-trial-done'))
            time.sleep(0.6)
            check("チャレンジステージ 1: 提出 → 結果（CHALLENGE CLEAR・星）", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), document.querySelector('#result-kicker').textContent, document.querySelectorAll('#result-stars b').length >= 1]"), [True, "CHALLENGE CLEAR", True])
            ch.eval("[...document.querySelectorAll('#result-btns button')].find(b => b.textContent.includes('チャレンジステージを選ぶ')).click()")
            time.sleep(0.5)
            check("結果の「チャレンジステージを選ぶ」→ 選ぶ画面・次（c02）が開いている", ch.eval("[__app.state, document.querySelectorAll('#stage-grid .stage-card.locked').length]"), ["stages", 7])
            ch.eval("__app.showStages()")
            time.sleep(0.3)
            check("チュートリアルを選ぶ: 見出し・カードはチュートリアルだけ", ch.eval("[document.querySelector('#stages-title').textContent, document.querySelector('#stages-sub').textContent, document.querySelectorAll('#stage-grid .stage-card').length]"), ["TUTORIAL", "チュートリアルを選ぶ", 14])

            # ---- 分割したマス（マウス）----
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.8)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(0, t.byName('Ⅱm7').id); g.place(1, t.byName('Ⅴ7').id); return true; })()")
            time.sleep(0.4)
            w = cell_px(ch)
            x0, y0 = tray_center(ch, "Ⅲm7")
            xr, yr = slot_point(ch, 1, dx_px=w * 0.28)
            drag(ch, x0, y0, xr, yr)
            time.sleep(0.4)
            check("ドラッグ: 駒のあるマス（2番）の右がわに落とす → 後半になる（前半は Ⅴ7）", board_names(ch), '["Ⅱm7 Ⅴ7 - - - - - -","- Ⅲm7 - - - - - -"]')
            x0, y0 = tray_center(ch, "ⅠM7")
            xl, yl = slot_point(ch, 1, dx_px=-w * 0.28)
            drag(ch, x0, y0, xl, yl)
            time.sleep(0.4)
            check("ドラッグ: 分けたマスの左がわに落とす → 前半が置きかわる", board_names(ch), '["Ⅱm7 ⅠM7 - - - - - -","- Ⅲm7 - - - - - -"]')
            x0, y0 = tray_center(ch, "Ⅰ")
            xc, yc = slot_point(ch, 0, dx_px=0)
            drag(ch, x0, y0, xc, yc)
            time.sleep(0.4)
            check("ドラッグ: 駒のあるマス（1番）の、まん中に落とす → 置きかえ（分けない）", board_names(ch), '["Ⅰ ⅠM7 - - - - - -","- Ⅲm7 - - - - - -"]')
            check("分割したマスは、3D でも、2つの半分の駒（前半・後半）", ch.eval("JSON.stringify([__app.scene.pieces[1] && __app.scene.pieces[1].half, !!__app.scene.pieces2[1], __app.scene.pieces[0].half, !!__app.scene.pieces2[0]])"), "[true,true,false,false]")
            # 持ち上げて、盤の上にいる間: 左右でプレビューが変わる
            x0, y0 = tray_center(ch, "Ⅳ")
            click(ch, x0, y0)                                      # クリックで選ぶ
            time.sleep(0.3)
            ch.mouse("mouseMoved", *slot_point(ch, 0, dx_px=w * 0.3), 0)
            time.sleep(0.3)
            z1 = ch.eval("[__app.input.hoverSlot, __app.input.hoverZone, __app.scene.preview && __app.scene.preview.zone]")
            ch.mouse("mouseMoved", *slot_point(ch, 0, dx_px=0), 0)
            time.sleep(0.3)
            z2 = ch.eval("[__app.input.hoverSlot, __app.input.hoverZone, __app.scene.preview && __app.scene.preview.zone]")
            ch.mouse("mouseMoved", *slot_point(ch, 4, dx_px=w * 0.3), 0)                # 空きのマス: いつも、そのマスに（まん中）
            time.sleep(0.3)
            z3 = ch.eval("[__app.input.hoverSlot, __app.input.hoverZone]")
            check("選んだ駒を、盤の上へ: 駒のあるマスの右 = R・まん中 = C。空きのマスは、右でも C", [z1, z2, z3], [[0, "R", "R"], [0, "C", "C"], [4, "C"]])
            click(ch, *slot_point(ch, 0, dx_px=w * 0.3))                                # クリックで置く: 右がわ
            time.sleep(0.4)
            check("クリックで置く（選んだ駒を、駒のあるマスの右がわに）→ 後半になる", board_names(ch), '["Ⅰ ⅠM7 - - - - - -","Ⅳ Ⅲm7 - - - - - -"]')
            # はずす: ダブルクリック（指した側の半分だけ）
            ch.mouse("mouseMoved", *slot_point(ch, 1, dx_px=w * 0.28), 0)
            time.sleep(0.2)
            px, py = slot_point(ch, 1, dx_px=w * 0.28)
            ch.cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": px, "y": py, "button": "left", "buttons": 1, "clickCount": 2})
            ch.cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": px, "y": py, "button": "left", "buttons": 0, "clickCount": 2})
            time.sleep(0.4)
            check("ダブルクリック: 指した側（2番の後半 Ⅲm7）だけが、はずれる。前半（ⅠM7）が、マスぜんたいに広がる", board_names(ch), '["Ⅰ ⅠM7 - - - - - -","Ⅳ - - - - - - -"]')
            # 盤の駒をドラッグして、盤の外へ: 持ち上げた半分だけ、はずれる
            ch.eval("(() => { const g = __app.game; g.clear(); g.place(0, __app.table.byName('Ⅰ').id); g.placeAt(0, 'R', __app.table.byName('Ⅴ7').id); return true; })()")
            time.sleep(0.4)
            xa, ya = slot_point(ch, 0, dx_px=w * 0.28)
            drag(ch, xa, ya, 640, 560)
            time.sleep(0.4)
            check("盤の駒（分けたマスの後半）を、トレイへドラッグ: 後半だけがはずれる", board_names(ch), '["Ⅰ - - - - - - -","- - - - - - - -"]')
            ch.eval("(() => { const g = __app.game; g.clear(); g.place(0, __app.table.byName('Ⅰ').id); g.placeAt(0, 'R', __app.table.byName('Ⅴ7').id); g.place(3, __app.table.byName('Ⅳ').id); return true; })()")
            time.sleep(0.3)
            xa, ya = slot_point(ch, 0, dx_px=-w * 0.28)
            xb, yb = slot_point(ch, 3, dx_px=0)
            drag(ch, xa, ya, xb, yb)
            time.sleep(0.4)
            check("分けたマスの前半（Ⅰ）を、駒のあるマス（4番 Ⅳ）のまん中へ: 置きかえ（前半が抜けて、後半 Ⅴ7 が広がる）", board_names(ch), '["Ⅴ7 - - Ⅰ - - - -","- - - - - - - -"]')
            # チュートリアルでは、分けない
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(0.8)
            ch.eval("__app.game.place(1, __app.table.byName('ⅣM7').id)")
            time.sleep(0.3)
            x0, y0 = tray_center(ch, "Ⅴ7")
            xr, yr = slot_point(ch, 1, dx_px=w * 0.28)
            drag(ch, x0, y0, xr, yr)
            time.sleep(0.4)
            check("チュートリアル: 駒のあるマスの右に落としても、分けない（置きかえ）", board_names(ch), '["- Ⅴ7 - - - - - -","- - - - - - - -"]')
            check("JS のエラーがない（PC）", ch.eval("JSON.stringify(window.__errors)"), "[]")

        # ====================== スマホ（縦持ち）======================
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            # タイトルの背景: 技のスタンプを出さない
            for _ in range(20):
                if ch.eval("__app.game.analysis.instances.length > 0"):
                    break
                time.sleep(0.6)
            time.sleep(0.4)
            check("スマホ縦持ち・タイトル: デモで技が決まっても、スタンプは、見えない（メニューにかぶさらない）", ch.eval("getComputedStyle(document.querySelector('#stamp-layer')).display"), "none")
            check("スマホ縦持ち・タイトル: 盤は、画面の中央（右へ寄せない）", ch.eval("__app.scene.shiftTarget"), 0)
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.9)
            # 音のメニュー・音量のメニュー: 画面の直下に移って、見える
            ch.eval("document.querySelector('#btn-soundmenu').click()")
            time.sleep(0.4)
            r = json.loads(ch.eval("JSON.stringify((() => { const m = document.querySelector('#soundmenu'), r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { parent: m.parentElement.id, hidden: m.classList.contains('hidden'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, onTop: !!e && m.contains(e) }; })())"))
            check("スマホ・音のメニュー: 画面の直下（#ui）に移って、画面の中に、全部見える（切り取られない）", [r["parent"], r["hidden"], r["left"] >= 0, r["right"] <= r["vw"], r["bottom"] <= r["vh"], r["top"] > 100, r["onTop"]], ["ui", False, True, True, True, True, True])
            check("スマホ・音のメニュー: 「閉じる」ボタンがある・押すと閉じる", ch.eval("(() => { const b = document.querySelector('#soundmenu .sm-close'); const ok = !!b && getComputedStyle(b).display !== 'none'; if (b) b.click(); return [ok, document.querySelector('#soundmenu').classList.contains('hidden')]; })()"), [True, True])
            ch.eval("document.querySelector('#btn-sound').click()")
            time.sleep(0.4)
            r = json.loads(ch.eval("JSON.stringify((() => { const m = document.querySelector('#volmenu'), r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { parent: m.parentElement.id, hidden: m.classList.contains('hidden'), bottom: r.bottom, vh: innerHeight, onTop: !!e && m.contains(e) }; })())"))
            check("スマホ・音量のメニュー: 画面の直下に移って、見える", [r["parent"], r["hidden"], r["bottom"] <= r["vh"], r["onTop"]], ["ui", False, True, True])
            ch.eval("document.querySelector('#vm-slider').value = 60; document.querySelector('#vm-slider').dispatchEvent(new Event('input')); true")
            check("スマホ・音量のメニュー: バーを動かすと、音量が変わる", ch.eval("__app.save.volume"), 60)
            ch.eval("document.querySelector('#volmenu .sm-close').click()")
            # PC の窓にもどすと、もとの場所（ボタンのすぐ下）にもどる
            # メロディの帯
            ch.eval("__app.startStage(__melodies[2], 'melody')")
            time.sleep(1.2)
            r = json.loads(ch.eval("""JSON.stringify((() => {
              const roll = document.querySelector('#melody-roll').getBoundingClientRect(), sc = document.querySelector('#side .score-card').getBoundingClientRect(), tw = document.querySelector('#tray-wrap').getBoundingClientRect();
              const bad = [...document.querySelectorAll('#melody-roll *')].filter((el) => { const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(''); const b = el.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(el).fontSize); return t.length >= 3 && b.width < fs * 2.4 && b.height > fs * 2.4; }).length;
              const p = __app.scene.slotToScreen(0, 0.4), q = __app.scene.slotToScreen(7, 0.4);
              return { rollL: roll.left, rollR: roll.right, vw: innerWidth, rollTop: roll.top, scBottom: sc.bottom, rollBottom: roll.bottom, trayTop: tw.top, bad, boardTop: Math.min(p.y, q.y), boardBottom: Math.max(p.y, q.y), pageW: document.documentElement.scrollWidth };
            })())"""))
            check("スマホ縦持ち・メロディの帯: 画面の幅におさまる・縦に折り返された文字がない・横にはみ出さない", [r["rollL"] >= 0, r["rollR"] <= r["vw"] + 1, r["bad"], r["pageW"] <= r["vw"] + 1], [True, True, 0, True])
            check("スマホ縦持ち・メロディの帯: 得点の下にある（かぶらない）", r["rollTop"] >= r["scBottom"], True)
            check("スマホ縦持ち・メロディの帯: 盤は、帯の下・トレイの上にある（盤の駒の位置が、帯にかぶらない）", [r["boardTop"] > r["rollBottom"], r["boardBottom"] < r["trayTop"]], [True, True])
            # スタンプ: 得点の下（メロディの帯の下）に出る
            ch.eval("(() => { const t = __app.table, g = __app.game; ['Ⅵm', 'Ⅳ', 'Ⅰ', 'Ⅴ'].forEach((n, i) => g.place(i, t.byName(n).id)); return true; })()")
            time.sleep(0.5)
            r = json.loads(ch.eval("JSON.stringify((() => { const s = document.querySelector('#stamp-layer .stamp'); if (!s) return { has: false }; const b = s.getBoundingClientRect(), roll = document.querySelector('#melody-roll').getBoundingClientRect(); return { has: true, below: b.top >= roll.bottom - 1 }; })())"))
            check("スマホ・メロディー: 技のスタンプは、帯の下に出る（帯にかぶらない）", r.get("below", True), True)
            ch.eval("__app.startStage(__trials[0], 'trial')")
            time.sleep(1.0)
            check("スマホ・チャレンジステージ: 上の細い帯に、条件の数・得点が出る（「null」などの余計な文字がない）", ch.eval("document.querySelector('#step-bar').textContent"), "1条件 1/2 ・ 得点 0/350")
            ch.eval("(() => { const t = __app.table, g = __app.game; ['Ⅲm', 'Ⅵm', 'Ⅱm', 'Ⅴ7', 'ⅠM7'].forEach((n, i) => g.place(i, t.byName(n).id)); return true; })()")
            time.sleep(0.5)
            check("スマホ・チャレンジステージ: 条件がそろうと、帯に「提出する」ボタンが出る", ch.eval("[document.querySelector('#step-bar').textContent, !!document.querySelector('#btn-trial-done-bar')]"), ["✓条件そろい・ノルマ達成！提出する", True])
            ch.eval("document.querySelector('#btn-trial-done-bar').click()")
            time.sleep(0.5)
            check("スマホ・チャレンジステージ: 帯の「提出する」→ 結果の画面", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), document.querySelector('#result-kicker').textContent]"), [True, "CHALLENGE CLEAR"])
            ch.eval("__app.startStage(__melodies[2], 'melody')")
            time.sleep(0.8)
            ch.eval("(() => { const t = __app.table, g = __app.game; ['Ⅵm', 'Ⅳ', 'Ⅰ', 'Ⅴ'].forEach((n, i) => g.place(i, t.byName(n).id)); return true; })()")
            time.sleep(0.5)
            ch.eval("document.querySelector('#btn-melody-done').click()")
            time.sleep(0.6)
            check("スマホ・結果のボタン: 2列（「次へ」は1行ぜんぶ）", ch.eval("(() => { const b = [...document.querySelectorAll('#result-btns button')].map((e) => e.getBoundingClientRect()); const cols = new Set(b.map((r) => Math.round(r.left))).size; return [b.length, cols, b[0].width > b[1].width * 1.7]; })()"), [4, 2, True])
            # 結果が出たとき: ガイドのシートが、結果の上に出ていない（モーダルのほうが上）
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(0.8)
            ch.eval("__app.clearDelayOverride = 300")
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(1, t.byName('ⅣM7').id); g.place(2, t.byName('Ⅴ7').id); g.place(3, t.byName('Ⅰ').id); return true; })()")
            time.sleep(1.4)
            check("スマホ・クリアの結果: 出たとき、ガイドのシートは、閉じている", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), document.body.classList.contains('guide-open'), getComputedStyle(document.querySelector('#guide')).display]"), [True, False, "none"])
            ch.eval("document.querySelector('#result-btns button:nth-child(2)').click()")
            time.sleep(0.3)
            # 分割したマス（指）
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.9)
            ch.eval("(() => { const t = __app.table, g = __app.game; g.place(0, t.byName('Ⅱm7').id); g.place(1, t.byName('Ⅴ7').id); return true; })()")
            time.sleep(0.4)
            w = cell_px(ch)
            x0, y0 = tray_center(ch, "Ⅲm7")
            ch.tap(x0, y0)
            time.sleep(0.3)
            check("スマホ・タップ: トレイの駒を選ぶ（持ち上げ）", ch.eval("__app.input.armed !== null"), True)
            xr, yr = slot_point(ch, 1, dx_px=w * 0.3)
            ch.tap(xr, yr)
            time.sleep(0.5)
            check("スマホ・タップ: 駒のあるマスの右がわを、タップ → 後半になる", board_names(ch), '["Ⅱm7 Ⅴ7 - - - - - -","- Ⅲm7 - - - - - -"]')
            check("スマホ: JS のエラーがない", ch.eval("JSON.stringify(window.__errors)"), "[]")
    finally:
        srv.shutdown()
    print("第7弾の画面操作: %d 件中 %d 件 失敗" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
