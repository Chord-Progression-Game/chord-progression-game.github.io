#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第10弾（2026-11-24）の画面のテスト。使い方の画面（動く図で、操作と機能を説明）を、本物の Chrome で確かめる。
  ① タイトルの「使い方」から開く・◀ ▶・矢印キー・点・Esc・最後のページの「閉じる」。はじめは印（attn）が付いていて、開くと消える
  ② 遊ぶ画面（フリープレイ）で、? キー・上のバーの「？」から開く。開いている間は状態が howto で、閉じると play にもどる（演奏は、スペースキーでは止まらない）
  ③ 全ページ: 見出し・1行の説明・図・説明（3つまで）がある。JS のエラーがない
  ④ スマホ（縦・横。指の操作・音あり）: 全面で開く・横にはみ出さない・図が切れない（本文がスクロールする）・閉じられる
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
実行:  python3 tools/host_tests/test_round10_ui.py
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

VISIBLE = "(id) => !document.querySelector('#' + id).classList.contains('hidden')"


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def key(ch, k):
    ch.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: %s, bubbles: true, cancelable: true }))" % json.dumps(k))
    time.sleep(0.15)


def counter(ch):
    return ch.eval("(document.querySelector('.ht-count') || {}).textContent || ''")


def scenario_title(ch, label):
    check("%s: タイトルの「使い方」の印（はじめて）" % label, ch.eval("document.querySelector('#btn-howto-title').classList.contains('attn')"), True)
    check("%s: 閉じている" % label, ch.eval("document.querySelector('#howto').classList.contains('hidden')"), True)
    click(ch, *center(ch, '#btn-howto-title')); time.sleep(0.5)
    check("%s: 開く（土台 title・重ね howto。1 / 10）" % label, ch.eval("JSON.stringify([!document.querySelector('#howto').classList.contains('hidden'), document.body.dataset.screen, document.body.dataset.overlay, document.querySelector('.ht-count').textContent, __app.state, __app.howto.isOpen])"), '[true,"title","howto","1 / 10","title",true]')
    check("%s: 開いたら、印が消える・保存される" % label, ch.eval("JSON.stringify([document.querySelector('#btn-howto-title').classList.contains('attn'), __app.save.howtoSeen])"), '[false,true]')
    check("%s: 点は 10 個・いまのページに印" % label, ch.eval("JSON.stringify([document.querySelectorAll('.ht-dot').length, document.querySelectorAll('.ht-dot.on').length, [...document.querySelectorAll('.ht-dot')].findIndex(d => d.classList.contains('on'))])"), '[10,1,0]')
    check("%s: 1ページ目は「まえ」が押せない" % label, ch.eval("document.querySelector('#ht-prev').disabled"), True)
    click(ch, *center(ch, '#ht-next')); time.sleep(0.3)
    check("%s: 「つぎ」で 2 / 10" % label, counter(ch), "2 / 10")
    key(ch, 'ArrowRight')
    check("%s: → キーで 3 / 10" % label, counter(ch), "3 / 10")
    key(ch, 'ArrowLeft'); key(ch, 'ArrowLeft'); key(ch, 'ArrowLeft')
    check("%s: ← キーで 1 / 10 まで（それより前には行かない）" % label, counter(ch), "1 / 10")
    click(ch, *center(ch, '.ht-dot:nth-child(5)')); time.sleep(0.3)
    check("%s: 点を押すと、5 / 10" % label, counter(ch), "5 / 10")
    # 全ページ: 見出し・説明・図・説明
    rows = []
    for i in range(10):
        ch.eval("__app.howto.go(%d)" % i); time.sleep(0.1)
        rows.append(json.loads(ch.eval("JSON.stringify([!!document.querySelector('.ht-card h3').textContent.trim(), document.querySelector('.ht-lead').textContent.length > 10, !!document.querySelector('.ht-art .ht-board, .ht-art .ht-row, .ht-art .ht-lv, .ht-art .ht-modes, .ht-art .ht-split, .ht-art .ht-bar'), document.querySelectorAll('.ht-notes li').length])")))
    check("%s: 全10ページに、見出し・説明・図・説明（1〜3つ）がある" % label, all(r[0] and r[1] and r[2] and 1 <= r[3] <= 3 for r in rows), True)
    ch.eval("__app.howto.go(9)"); time.sleep(0.1)
    check("%s: 最後のページの右のボタンは「閉じる」" % label, ch.eval("document.querySelector('#ht-next').textContent"), "閉じる")
    click(ch, *center(ch, '#ht-next')); time.sleep(0.4)
    check("%s: 閉じる（土台 title・重ねなし）" % label, ch.eval("JSON.stringify([document.querySelector('#howto').classList.contains('hidden'), document.body.dataset.screen, document.body.dataset.overlay, __app.howto.isOpen])"), '[true,"title","",false]')
    ch.eval("__app.howto.open(3)"); time.sleep(0.3)
    key(ch, 'Escape')
    check("%s: Esc で閉じる" % label, ch.eval("JSON.stringify([document.querySelector('#howto').classList.contains('hidden'), __app.howto.isOpen, __app.state])"), '[true,false,"title"]')
    ch.eval("__app.howto.open(0)"); time.sleep(0.3)
    click(ch, 6, 6); time.sleep(0.3)
    check("%s: 外（暗いところ）を押して閉じる" % label, ch.eval("__app.howto.isOpen"), False)


def scenario_play(ch, label, touch=False):
    if touch:
        ch.tap(*center(ch, '#title .menu button[data-act=free]'))
    else:
        click(ch, *center(ch, '#title .menu button[data-act=free]'))
    ch.wait_for("__app.state === 'play'", timeout=30)
    time.sleep(0.8)
    ch.eval("__app.game.place(0, __app.table.byName('Ⅰ').id); __app.game.place(1, __app.table.byName('Ⅴ7').id)"); time.sleep(0.3)
    key(ch, '?')
    check("%s: 遊ぶ画面で ? キー → 開く（状態 howto。盤はそのまま）" % label, ch.eval("JSON.stringify([__app.howto.isOpen, __app.state, document.body.dataset.overlay, __app.game.board.slice(0, 2).every((x) => x !== null)])"), '[true,"howto","howto",true]')
    playing = ch.eval("!!(__app.engine && __app.engine.playing)")
    key(ch, ' ')
    check("%s: 開いている間は、スペースキーで演奏が切りかわらない" % label, ch.eval("!!(__app.engine && __app.engine.playing)"), playing)
    key(ch, 'Escape')
    check("%s: Esc で閉じると、遊ぶ画面にもどる" % label, ch.eval("JSON.stringify([__app.howto.isOpen, __app.state, document.body.dataset.overlay])"), '[false,"play",""]')
    ch.eval("document.querySelector('#btn-howto').scrollIntoView({ inline: 'center', block: 'nearest' })"); time.sleep(0.3)         # スマホ: 上のバーは、横になぞって動かす
    if touch:
        ch.tap(*center(ch, '#btn-howto'))
    else:
        click(ch, *center(ch, '#btn-howto'))
    time.sleep(0.4)
    check("%s: 上のバーの「？」でも開く" % label, ch.eval("JSON.stringify([__app.howto.isOpen, __app.state])"), '[true,"howto"]')
    ch.eval("document.querySelector('#ht-close').click()"); time.sleep(0.3)
    check("%s: 「閉じる」で、遊ぶ画面にもどる" % label, ch.eval("JSON.stringify([__app.howto.isOpen, __app.state])"), '[false,"play"]')
    # メニュー（MENU）の「使い方」: メニューを閉じて、使い方を開く。閉じると、遊ぶ画面
    ch.eval("__app.howto.isOpen && __app.howto.close()"); time.sleep(0.2)
    key(ch, 'Escape'); time.sleep(0.3)
    check("%s: メニューが開く（使い方のボタンがある）" % label, ch.eval("JSON.stringify([__app.state, !!document.querySelector('#pause [data-act=howto]')])"), '["pause",true]')
    if touch:
        ch.tap(*center(ch, '#pause [data-act=howto]'))
    else:
        click(ch, *center(ch, '#pause [data-act=howto]'))
    time.sleep(0.5)
    check("%s: メニューの「使い方」で、使い方が開く（メニューは閉じる）" % label, ch.eval("JSON.stringify([__app.howto.isOpen, __app.state, document.body.dataset.overlay])"), '[true,"howto","howto"]')
    key(ch, 'Escape')
    check("%s: 閉じると、遊ぶ画面" % label, ch.eval("__app.state"), "play")
    # ほかの画面（メニュー）が開いているときは、開かない
    key(ch, 'Escape'); time.sleep(0.3)
    state = ch.eval("__app.state")
    if state == 'pause':
        key(ch, '?')
        check("%s: メニューが開いているときは、? キーでも開かない" % label, ch.eval("__app.howto.isOpen"), False)
        key(ch, 'Escape')
    check("%s: JS のエラーがない" % label, ch.eval("JSON.stringify(window.__errors || [])"), "[]")


def scenario_phone(ch, label, touch=True):
    """ スマホ: 全面・横にはみ出さない・図が切れない（本文がスクロールする）"""
    ch.eval("__app.howto.open(0)"); time.sleep(0.5)
    r = json.loads(ch.eval("JSON.stringify((() => { const c = document.querySelector('.ht-card').getBoundingClientRect(); return [Math.round(c.width) === innerWidth, c.height >= innerHeight * 0.94 && c.height <= innerHeight + 1, document.documentElement.scrollWidth <= innerWidth + 1]; })())"))
    check("%s: 全面で開く（幅が画面と同じ・高さは 94％以上。横持ちは、ほかの画面と同じく、上下に少し余白）・横にはみ出さない" % label, r, [True, True, True])
    bad = []
    for i in range(10):
        ch.eval("__app.howto.go(%d)" % i); time.sleep(0.15)
        info = json.loads(ch.eval("""JSON.stringify((() => {
          const body = document.querySelector('.ht-body'), art = document.querySelector('.ht-art'), card = document.querySelector('.ht-card').getBoundingClientRect();
          const a = art.getBoundingClientRect();
          const over = [...art.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > card.right + 1 || r.left < card.left - 1); }).length;
          return { artH: Math.round(a.height), clipped: art.scrollHeight > art.clientHeight + 2, bodyScrolls: body.scrollHeight > body.clientHeight + 1, over };
        })())"""))
        # 図は、つぶれて切れない（クリップされない）・横にはみ出す部品がない
        if info["clipped"] or info["over"]:
            bad.append((i + 1, info))
    check("%s: どのページも、図が切れず、横にはみ出さない %s" % (label, bad[:2]), bad, [])
    ch.eval("document.querySelector('#ht-close').click()"); time.sleep(0.3)
    check("%s: 閉じられる" % label, ch.eval("__app.howto.isOpen"), False)


def main():
    if not chrome_available():
        print("test_round10_ui: Chrome がないので、省略します")
        return 0
    srv, port = serve()
    try:
        # ---- PC ----
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            scenario_title(ch, "PC")
            scenario_play(ch, "PC")
        # ---- スマホ（縦・音あり・指の操作）----
        with ChromeSession(width=390, height=844, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            scenario_phone(ch, "スマホ縦（タイトル）")
            scenario_play(ch, "スマホ縦", touch=True)
            scenario_phone(ch, "スマホ縦（遊ぶ画面）")
        # ---- スマホ（横）----
        with ChromeSession(width=844, height=390, mobile=True, dpr=3, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            scenario_phone(ch, "スマホ横（タイトル）")
    finally:
        srv.shutdown()
    print("test_round10_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
