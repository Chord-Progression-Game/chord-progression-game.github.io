#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ゲームの画面を、本物の Chrome で、マウス・キーボードの操作どおりに動かして確かめる。
  チュートリアルの1ステージを、ドラッグ&ドロップで、クリアまで遊ぶ / 駒の移動・入れ替え・はずす・選んで置く /
  ヒント / チャレンジ / ステージ選択の鍵 / メニュー / エラーが出ていないこと
実行:  python3 tools/host_tests/test_game_ui.py
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, drag_piece_to_slot, slot_xy, center, click, move_board_piece, open_game, drag  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def ids(ch, *names):
    return [ch.eval("__app.table.byName(%r).id" % n) for n in names]


def board(ch):
    return ch.eval("JSON.stringify(__app.game.board)")


def dblclick(ch, x, y):
    ch.mouse("mouseMoved", x, y, 0)
    for n in (1, 2):
        ch.cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": n})
        ch.cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": n})


def main():
    if not chrome_available():
        print("（ゲームの画面のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            # ============ タイトル ============
            check("音量: はじめは 50%（保存がまっさらのとき。出音は、これまでの 25% と同じ）。バーを動かすまで「決めた」印はない", ch.eval("[__app.save.volume, __app.save.volumeSet, document.querySelector('#sound-state').textContent]"), [50, False, "50%"])
            check("クリアの画面が出るまでの時間: 5〜10秒（盤面を見てもらう。2026-11-23 に、7〜14秒から短くした）", ch.eval("__app.clearDelayMs() >= 5000 && __app.clearDelayMs() <= 10000"), True)
            ch.eval("__app.clearDelayOverride = 500")                     # テストでは、短くする
            check("タイトル: メニューは7つ（学ぶ・選ぶ・合わせる・挑む・遊ぶ・競う。対戦は準備中で押せない）", ch.eval("[document.querySelectorAll('#title .menu button').length, document.querySelector('#title .menu button[data-act=versus]').disabled, !!document.querySelector('#title .menu button[data-act=melody]')]"), [7, True, True])
            check("タイトル: メニューの順番と名前（チュートリアル・チュートリアルを選ぶ・メロディーにコードをつける・チャレンジステージ・フリープレイ・タイムアタック・対戦）", ch.eval("[...document.querySelectorAll('#title .menu button')].map(b => b.querySelector('span').firstChild.textContent)"), ["チュートリアル", "チュートリアルを選ぶ", "メロディーにコードをつける", "チャレンジステージ", "フリープレイ", "タイムアタック", "対戦"])
            check("タイトル: 図鑑は26個（つながり4・終止6・固有進行13・借用和音2・内声1）", ch.eval("document.querySelectorAll('#collection-title .col-dot').length"), 26)
            check("タイトル: 実機は未接続（画面の盤で遊ぶ）", ch.eval("document.querySelector('#device-state').textContent.includes('未接続')"), True)
            click(ch, *center(ch, '#title .menu button[data-act=tutorial]'))
            ch.wait_for("__app.state === 'play'", timeout=10)

            # ============ チュートリアル（はじめに）= ステージ0 ============
            check("ステージ0 が始まる（最初の未クリア）", ch.eval("[document.querySelector('#stage-no').textContent, document.querySelector('#stage-title').textContent]"), ["STAGE 00", "はじめに"])
            for i, n in enumerate(["Ⅰ", "Ⅵm", "Ⅳ"]):
                drag_piece_to_slot(ch, n, i)
                time.sleep(0.25)
            check("ステージ0: 3つ置くとクリア", ch.eval("__app.game.cleared"), True)
            ch.wait_for("!document.querySelector('#result').classList.contains('hidden')", timeout=10)
            check("ステージ0: クリアの画面（ボタン4つ。「盤面を見る・編集する」を含む）", ch.eval("[document.querySelector('#result-kicker').textContent, [...document.querySelectorAll('#result-btns button')].map(b => b.textContent.slice(0, 7))]"), ["STAGE CLEAR", ["次へ ▶ Ⅴ-", "盤面を見る・編", "もう一度", "チュートリアル"]])
            click(ch, *center(ch, '#result-btns button:nth-child(2)')); time.sleep(0.3)
            check("盤面を見る・編集する: 結果の画面が閉じて、盤面がそのまま残る（操作の欄が出る）", ch.eval("[document.querySelector('#result').classList.contains('hidden'), !document.querySelector('#clear-bar').classList.contains('hidden'), JSON.stringify(__app.game.board.slice(0, 3)) === JSON.stringify([__app.table.byName('Ⅰ').id, __app.table.byName('Ⅵm').id, __app.table.byName('Ⅳ').id]), __app.state]"), [True, True, True, "play"])
            check("盤面を見る・編集する: 操作の欄に、つぎのステージの名前", ch.eval("document.querySelector('#btn-clear-next').textContent"), "つぎへ ▶ Ⅴ-Ⅰ終止")
            drag_piece_to_slot(ch, "Ⅴ", 5); time.sleep(0.3)
            check("盤面を見る・編集する: 結果を閉じたあとも、駒を置ける・クリアのまま", ch.eval("[__app.game.board[5] === __app.table.byName('Ⅴ').id, __app.game.cleared]"), [True, True])
            click(ch, *center(ch, '#btn-clear-result')); time.sleep(0.3)
            check("結果を見る: もう一度、結果の画面が出る（操作の欄は消える）", ch.eval("[!document.querySelector('#result').classList.contains('hidden'), document.querySelector('#clear-bar').classList.contains('hidden')]"), [True, True])
            click(ch, *center(ch, '#result-btns button.primary'))
            ch.wait_for("document.querySelector('#stage-no').textContent === 'STAGE 01'", timeout=10)

            # ============ ステージ1（Ⅴ-Ⅰ終止）を、ドラッグで遊ぶ ============
            check("ステージ1: 使える駒は6つ（ⅣM7 → Ⅴ7 → Ⅰ の進行の一部として、終止を覚える）", ch.eval("document.querySelectorAll('#tray .pc').length"), 6)
            check("ステージ1: 最初に置く駒（ⅣM7）に、案内の印", ch.eval("document.querySelector('#tray .pc.guide .nm').textContent"), "ⅣM7")
            check("ステージ1: 3Dの案内（置く場所）は、2番（終止の Ⅰ を4番に置く。Ⅴ は冒頭（1番）に置かない）", ch.eval("__app.scene.guide"), 1)
            drag_piece_to_slot(ch, "ⅣM7", 1)
            ch.wait_for("__app.game.board[1] !== null", timeout=5)
            check("ステージ1: ⅣM7 が2番に置かれた（3Dの駒も）", ch.eval("[__app.scene.pieces[1] && __app.scene.pieces[1].chord.name, document.querySelector('#guide-body .step.now span:last-child').textContent]"), ["ⅣM7", "3番に「Ⅴ7」を置こう"])
            check("ステージ1: 案内の印は、Ⅴ7 に移る", ch.eval("document.querySelector('#tray .pc.guide .nm').textContent"), "Ⅴ7")
            drag_piece_to_slot(ch, "Ⅴ7", 2)
            ch.wait_for("__app.game.board[2] !== null", timeout=5)
            check("ステージ1: Ⅴ7 が3番に置かれた（3Dの駒も）", ch.eval("[__app.scene.pieces[2] && __app.scene.pieces[2].chord.name, document.querySelector('#guide-body .step.now span:last-child').textContent]"), ["Ⅴ7", "4番に「Ⅰ」を置こう"])
            check("ステージ1: 案内の印は、Ⅰ に移る", ch.eval("document.querySelector('#tray .pc.guide .nm').textContent"), "Ⅰ")
            drag_piece_to_slot(ch, "Ⅰ", 3)
            ch.wait_for("__app.game.cleared", timeout=5)
            time.sleep(0.4)
            check("ステージ1: Ⅴ-Ⅰ終止が決まる（囲みは Ⅴ7 → Ⅰ の1つ。技の一覧は、終止 + ジャッジの「機能のながれ」「ガイドトーンの半音進行」）", ch.eval("JSON.stringify([__app.game.analysis.instances.map(i => i.kind), __app.game.analysis.instances[0].positions, __app.scene.enclosures.size, document.querySelectorAll('#trick-list li:not(.empty)').length])"), '[["authentic_cadence"],[2,3],1,3]')
            check("ステージ1: スタンプが出る（技の名前）", ch.eval("(document.querySelector('.stamp .name') || {}).textContent"), "Ⅴ-Ⅰ終止")
            ch.wait_for("document.querySelector('#score-num').textContent === '295'", timeout=5)          # 200 点 + ジャッジ（機能のながれ）50 + 内声の半音の動き（ガイドトーン 30 + 声がもう1つ動く 10）+ Ⅴ7（技に使われた Lv2）の加点 5
            check("ステージ1: スタンプは小さい（説明は、スタンプに入れない = 3Dのラベルと重ならない）", ch.eval("document.querySelector('.stamp .why') === null"), True)
            check("ステージ1: 右の列に WHY（技の説明）が残る", ch.eval("JSON.stringify([!document.querySelector('#why').classList.contains('hidden'), document.querySelector('#why-name').textContent, document.querySelector('#why-text').textContent.includes('正格終止')])"), '[true,"Ⅴ-Ⅰ終止",true]')
            check("ステージ1: 目標のチップが「決まった」になる", ch.eval("document.querySelector('#goal-chip').classList.contains('done')"), True)
            check("ステージ1: 図鑑に、2つ見つかった（Ⅴ-Ⅰ終止と、途中で Ⅴ7 が最後の駒だったときのドミナント終止。ステージ0 は、技なしで進める）", ch.eval("document.querySelector('#collection-count').textContent"), "2 / 26")
            ch.wait_for("!document.querySelector('#result').classList.contains('hidden')", timeout=8)
            check("ステージ1: クリアの画面に、技の説明が出る", ch.eval("document.querySelectorAll('#result-tricks .rt').length"), 1)

            # ============ フリープレイ: 移動・入れ替え・はずす・選んで置く ============
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.5)
            check("フリープレイ: 駒は 32 個（31種 + →）", ch.eval("document.querySelectorAll('#tray .pc').length"), 32)
            check("フリープレイ: レベルの区切り（Lv.1〜5・自作・つなぎ）", ch.eval("[...document.querySelectorAll('#tray .sep')].map((e) => e.textContent)"), ["Lv.1", "Lv.2", "Lv.3", "Lv.4", "Lv.5", "自作", "つなぎ"])
            idI, idV = ids(ch, "Ⅰ", "Ⅴ")
            drag_piece_to_slot(ch, "Ⅰ", 0); time.sleep(0.2)
            drag_piece_to_slot(ch, "Ⅴ", 1); time.sleep(0.2)
            check("置く: Ⅰ・Ⅴ（Ⅰ→Ⅴ。後ろに駒がない = ドミナント終止）", [board(ch), ch.eval("JSON.stringify(__app.game.analysis.instances.map(i => i.kind))")], [("[%d,%d,null,null,null,null,null,null]" % (idI, idV)), '["dominant_ending"]'])
            move_board_piece(ch, 0, slot_xy(ch, 3)); time.sleep(0.3)
            check("空きへ動かす（0番 → 3番）", board(ch), "[null,%d,null,%d,null,null,null,null]" % (idV, idI))
            move_board_piece(ch, 3, slot_xy(ch, 1)); time.sleep(0.3)
            check("駒の上へ動かす = 入れ替え（3番 ⇄ 1番）", board(ch), "[null,%d,null,%d,null,null,null,null]" % (idI, idV))
            move_board_piece(ch, 1, (640, 640)); time.sleep(0.3)            # 盤の外（トレイの上）に出す
            check("盤の外に出す = はずす", board(ch), "[null,null,null,%d,null,null,null,null]" % idV)
            dblclick(ch, *slot_xy(ch, 3)); time.sleep(0.3)
            check("ダブルクリック = はずす", board(ch), "[null,null,null,null,null,null,null,null]")
            click(ch, *center(ch, '.pc[data-id="%d"]' % idI)); time.sleep(0.2)
            check("カードをクリック = 選ぶ（印が付く）", ch.eval("[__app.input.armed, document.querySelectorAll('.pc.armed').length]"), [idI, 1])
            check("カードをクリック = 半透明の駒が持ち上がる（マウスについてくる）", ch.eval("(() => { const g = document.querySelector('#drag-ghost'); return [!g.classList.contains('hidden'), g.style.opacity, g.querySelector('.nm').textContent]; })()"), [True, "0.7", "Ⅰ"])
            ch.mouse("mouseMoved", *slot_xy(ch, 5), 0); time.sleep(0.25)
            check("持ち上げた駒は、盤の上では、3D の透けた駒に替わる（画面の札は消える）", ch.eval("[document.querySelector('#drag-ghost').style.opacity, !!__app.scene.preview]"), ["0", True])
            click(ch, *slot_xy(ch, 5)); time.sleep(0.3)
            check("選んでから、盤をクリック = 置く", [board(ch), ch.eval("__app.input.armed")], ["[null,null,null,null,null,%d,null,null]" % idI, None])
            click(ch, *center(ch, '.pc[data-id="%d"]' % idV)); ch.key("Escape"); time.sleep(0.2)
            check("Esc で、選ぶのを取りやめる（メニューは開かない）", ch.eval("[__app.input.armed, __app.state]"), [None, "play"])
            ch.mouse("mouseMoved", *slot_xy(ch, 5), 0); time.sleep(0.2)
            ch.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))"); time.sleep(0.3)
            check("Delete = 指している駒をはずす", board(ch), "[null,null,null,null,null,null,null,null]")

            # ============ コンボと得点 ============
            for i, n in enumerate(["Ⅵm", "Ⅳ", "Ⅴ", "Ⅰ"]):
                drag_piece_to_slot(ch, n, i); time.sleep(0.2)
            ch.wait_for("document.querySelector('#score-num').textContent === '531'", timeout=5)
            check("小室進行 + Ⅴ-Ⅰ終止 = コンボ ×1.15 → 506、種類2つで ×1.05 → 531 点", ch.eval("[document.querySelector('#combo-chip').textContent, document.querySelector('#variety-chip').textContent]"), ["COMBO ×1.15", "種類 2"])
            check("囲みは2つ（3Dのラベルも）", ch.eval("__app.scene.enclosures.size"), 2)
            check("WHY は、最後に決まった技（Ⅴ-Ⅰ終止）", ch.eval("document.querySelector('#why-name').textContent"), "Ⅴ-Ⅰ終止")
            ch.eval("document.querySelector('#btn-clear').click()")
            ch.wait_for("document.querySelector('#score-num').textContent === '0'", timeout=5)
            check("全部消す（得点も 0 に戻る）", [board(ch), ch.eval("document.querySelector('#score-num').textContent")], ["[null,null,null,null,null,null,null,null]", "0"])
            check("全部消すと、WHY も消える", ch.eval("document.querySelector('#why').classList.contains('hidden')"), True)

            # ============ 冒頭（1番）のドミナント系の駒（Ⅴ・Ⅲ7・Ⅰ7 など）= 「？」（技にならず、100点の減点）============
            drag_piece_to_slot(ch, "Ⅰ", 1); time.sleep(0.2)
            drag_piece_to_slot(ch, "Ⅴ7", 0); time.sleep(0.5)
            check("「？」: 1番の Ⅴ7 → 技なし・得点 0・「？」が1つ", ch.eval("JSON.stringify([__app.game.analysis.instances.length, __app.game.analysis.oddities.length, __app.game.analysis.score.total, document.querySelector('#score-num').textContent])"), '[0,1,0,"0"]')
            check("「？」: 技の一覧に「？ 冒頭のドミナント」が出る（−100）", ch.eval("JSON.stringify([...document.querySelectorAll('#trick-list li.warn')].map(e => [e.querySelector('.nm').childNodes[0].textContent, e.querySelector('.pt').textContent]))"), '[["？ 冒頭のドミナント","−100"]]')
            check("「？」: スタンプ（？）が出る", ch.eval("JSON.stringify([(document.querySelector('.stamp.warn .name') || {}).textContent, (document.querySelector('.stamp.warn .pts') || {}).textContent])"), '["？","−100"]')
            check("「？」: WHY に、理由が出る（冒頭・100点の減点）", ch.eval("JSON.stringify([document.querySelector('#why-name').textContent, document.querySelector('#why-text').textContent.includes('冒頭'), document.querySelector('#why-text').textContent.includes('100点')])"), '["？ 冒頭のドミナント",true,true]')
            check("「？」: 3D でも、その駒を囲んで「？」のラベルが出る", ch.eval("JSON.stringify([...__app.scene.enclosures.values()].map(e => [e.instance.warn === true, e.instance.positions]))"), '[[true,[0]]]')
            check("「？」: 1番の Ⅴ7 に、前後のつながりの技は付かない", ch.eval("__app.game.analysis.instances.map(i => i.kind).join()"), "")
            ch.eval("document.querySelector('#btn-clear').click()"); time.sleep(0.4)
            check("「？」: 全部消すと、一覧と3Dの「？」も消える（スタンプは、3秒で自然に消える）", ch.eval("JSON.stringify([document.querySelectorAll('#trick-list li.warn').length, __app.scene.enclosures.size])"), '[0,0]')

            # ============ 実機の盤に駒を置いたときの試聴（ESP32 のブザーは鳴らさない。ゲームが、小さく鳴らす）============
            ch.eval("""(() => { window.__aud = []; window.__realEngine = __app.engine;
              __app.engine = { ctx: { state: 'suspended' }, playing: false, cur: null, audition(id) { window.__aud.push(id); }, pollEvents() { return []; } }; })()""")
            idA, idB = ids(ch, "ⅣM7", "Ⅴ7")
            ch.eval("__app.game.setBoard([%d, null, null, null, null, null, null, null], { source: 'device-sync' })" % idA)
            time.sleep(0.1)
            check("実機の盤: 最初に盤の全体をそろえるとき（sync）は、試聴を鳴らさない", ch.eval("JSON.stringify(window.__aud)"), "[]")
            ch.eval("__app.game.setBoard([%d, %d, null, null, null, null, null, null], { source: 'device' })" % (idA, idB))
            time.sleep(0.1)
            check("実機の盤: 駒を1つ置くと、そのコードを、1回だけ試聴する", ch.eval("JSON.stringify(window.__aud)"), "[%d]" % idB)
            ch.eval("__app.game.setBoard([%d, %d, %d, null, null, null, null, null], { source: 'device' })" % (idA, idB, idA))
            time.sleep(0.05)
            check("実機の盤: 続けて置いても、うるさくならない（0.3秒以内は、間引く）", ch.eval("window.__aud.length"), 1)
            time.sleep(0.4)
            ch.eval("__app.game.setBoard([%d, %d, %d, null, null, null, null, null], { source: 'device' })" % (idA, idB, idA))      # 何も変わらない
            ch.eval("__app.game.setBoard([%d, null, %d, null, null, null, null, null], { source: 'device' })" % (idA, idA))        # 外す
            time.sleep(0.1)
            check("実機の盤: 外したときや、変わらないときは、試聴しない", ch.eval("window.__aud.length"), 1)
            ch.eval("__app.engine = window.__realEngine; __app.game.clear()")
            time.sleep(0.3)


            # ============ 実機の盤とのつなぎの、守り（古い状態・壊れた状態・一度にすべて空になった状態）============
            ch.eval("""(() => { const d = __app.device; d.enabled = true; window.__applied = []; window.__orig = d.onBoard; d.onBoard = (ids, o) => window.__applied.push([ids.filter((x) => x !== null).length, !!o.sync]);
              d.latest = undefined; d.lastKey = ''; d.lastSeq = -1; d.sid = undefined; d._hold = null; d.emptyHoldMs = 300;
              window.__st = (names) => ({ chords: Array.from({ length: 8 }, (_, i) => ({ name: names[i] || '-', symbol: '' })) }); })()""")
            ch.eval("__app.device._board(__st(['Ⅰ', 'Ⅴ']), { seq: 10, sid: 1 })")
            check("つなぎ: 最初の状態は、盤をそろえるだけ（sync）", ch.eval("JSON.stringify(__applied)"), "[[2,true]]")
            ch.eval("__app.device._board(__st(['Ⅰ', 'Ⅴ', 'Ⅳ']), { seq: 5, sid: 1 })")
            check("つなぎ: 古い状態（順番号が前）は、使わない", ch.eval("__applied.length"), 1)
            ch.eval("__app.device._board({ chords: [{ name: 'Ⅰ' }] }, { seq: 11, sid: 1 })")
            check("つなぎ: 壊れた状態（駒の数が足りない）は、使わない。盤を空にしない", ch.eval("__applied.length"), 1)
            ch.eval("__app.device._board(__st(['Ⅰ', 'Ⅴ', 'Ⅳ']), { seq: 12, sid: 1 })")
            check("つなぎ: 駒が増えたら、そのまま反映（sync ではない）", ch.eval("JSON.stringify(__applied.slice(1))"), "[[3,false]]")
            ch.eval("__app.device._board(__st([]), { seq: 13, sid: 1 })")
            check("つなぎ: 3つあった盤が、一度にすべて空になっても、すぐには空にしない（再起動・読み直しの途中）", [ch.eval("__applied.length"), ch.eval("!!__app.device._hold")], [2, True])
            ch.eval("__app.device._board(__st(['Ⅰ']), { seq: 14, sid: 1 })")
            check("つなぎ: 戻りかけ（1つ）のあいだも、いまの盤を保つ", [ch.eval("__applied.length"), ch.eval("!!__app.device._hold")], [2, True])
            ch.eval("__app.device._board(__st(['Ⅰ', 'Ⅴ', 'Ⅳ']), { seq: 15, sid: 1 })")
            check("つなぎ: もとの数に戻ったら、保つのをやめる（同じ駒なので、何も起きない）", [ch.eval("__applied.length"), ch.eval("!!__app.device._hold")], [2, False])
            ch.eval("__app.device._board(__st([]), { seq: 16, sid: 1 })")
            time.sleep(0.5)
            check("つなぎ: 空のまま時間がたったら、本当に片づけたとして、空にする", [ch.eval("JSON.stringify(__applied.slice(2))"), ch.eval("!!__app.device._hold")], ["[[0,false]]", False])
            ch.eval("__app.device._board(__st(['Ⅰ']), { seq: 1, sid: 2 })")
            check("つなぎ: ブリッジが作り直されたら（sid が変わる）、順番号を数え直す", ch.eval("JSON.stringify(__applied.slice(3))"), "[[1,false]]")
            ch.eval("__app.device.onBoard = window.__orig; __app.device.emptyHoldMs = 6000; __app.device.latest = undefined; __app.device.lastKey = ''; __app.device.lastSeq = -1")
            # 問い合わせ（/api/state）の返事が、通知（SSE）より古く着いたとき: 「盤あり」を打ち消さない（以前は、まれに、画面の盤に戻ってしまった）
            check("つなぎ: 古い問い合わせの返事は使わない。新しい返事は使う。通知がつながっていれば、問い合わせの失敗1回では切れない", ch.eval("""(async () => {
              const d = __app.device, of = window.fetch, oes = d.es;
              const reply = (o) => { window.fetch = async () => ({ ok: true, json: async () => o }); };
              d.enabled = true; d.sid = 7; d.lastSeq = 10; d.esp = true; d.connected = true; d._status();
              reply({ connected: false, s: null, s_seq: 0, sid: 7 }); await d._pollState();
              const stale = [d.esp, d.live];
              reply({ connected: false, s: null, s_seq: 10, sid: 7 }); await d._pollState();
              const fresh = [d.esp, d.live];
              reply({ connected: true, s: null, s_seq: 0, sid: 8 }); await d._pollState();
              const restarted = [d.esp, d.live];
              d.sid = 8; d.esp = true; d.connected = true; d._status();
              window.fetch = async () => { throw new Error('down'); };
              d.es = { readyState: 1, close() {} }; await d._pollState();
              const failedOpen = [d.esp, d.live];
              d.es = { readyState: 2, close() {} }; await d._pollState();
              const failedClosed = [d.esp, d.live];
              window.fetch = of; d.es = oes; d.sid = undefined; d.lastSeq = -1; d.esp = false; d.connected = false; d._status();
              return JSON.stringify([stale, fresh, restarted, failedOpen, failedClosed]);
            })()"""), '[[true,true],[false,false],[true,true],[true,true],[false,false]]')

            # ============ 技のラベル（名前）は、見える場所にある（奥の段・手前の段のどちらも）============
            # 以前は、手前の段の技のラベルが、下の駒の置き場に隠れていた（数字で見張る）
            label_js = """(() => { const s = __app.scene, H = innerHeight;
              const tray = document.querySelector('#tray-wrap').getBoundingClientRect().top, bar = document.querySelector('#topbar').getBoundingClientRect().bottom;
              return JSON.stringify([...s.enclosures.values()].filter(e => !e.dying).map(e => {
                const c = e.label.position.clone().applyMatrix4(s.board.matrixWorld), hh = e.label.scale.y;
                const a = c.clone(); a.y += hh / 2; const b = c.clone(); b.y -= hh / 2; a.project(s.camera); b.project(s.camera);
                return [Math.round((1 - a.y) / 2 * H), Math.round((1 - b.y) / 2 * H), Math.round(tray), Math.round(bar), e.label.visible]; })); })()"""
            for lane, slots in (("奥の段", (0, 1, 2)), ("手前の段", (4, 5, 6))):
                for slot, n in zip(slots, ("Ⅱm7", "Ⅴ7", "ⅠM7")):
                    ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (slot, n))
                time.sleep(1.8)                                          # ラベルが、置き場所へ動き終わるまで
                rows = json.loads(ch.eval(label_js))
                check("%s: 技のラベルが1つ出ている" % lane, len(rows), 1)
                check("%s: ラベルは、上のバーにも、下の駒の置き場にも、隠れない %r" % (lane, rows), all(top > bar and bot < tray and vis for top, bot, tray, bar, vis in rows), True)
                ch.eval("document.querySelector('#btn-clear').click()"); time.sleep(0.5)

            # ============ ヒント ============
            drag_piece_to_slot(ch, "ⅣM7", 0); time.sleep(0.3)
            click(ch, *center(ch, '#btn-hint')); time.sleep(0.6)
            check("ヒント ON: おすすめの印（Ⅴ7・Ⅲ7。Ⅳ-Ⅰ終止の Ⅰ は、フレーズの終わりでだけ。2026-11-24）と、3Dの候補", ch.eval("JSON.stringify([[...document.querySelectorAll('.pc.hint1 .nm')].map(e => e.textContent).sort(), __app.scene.ghosts.length > 0, document.querySelector('#hint-state').textContent])"), '[["Ⅲ7","Ⅴ7"],true,"ON"]')
            check("ヒント ON: 発展の印（Ⅳm7 など）", ch.eval("[...document.querySelectorAll('.pc.hint2 .nm')].map(e => e.textContent).includes('Ⅳm7')"), True)
            # ヒントの候補（盤の上の、透けた札）を、クリックして置く
            gx = ch.eval("(() => { const s = __app.scene; const g = s.ghosts[0]; const v = g.sprite.getWorldPosition(new g.sprite.position.constructor()); v.project(s.camera); const r = s.canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top, g.id, s.ghostSlot]; })()")
            ch.mouse("mouseMoved", gx[0], gx[1], 0); time.sleep(0.2)
            check("ヒントの候補の上: 指すと、はっきり見える", ch.eval("__app.scene.ghosts[0].sprite.material.opacity"), 1)
            click(ch, gx[0], gx[1]); time.sleep(0.4)
            check("ヒントの候補をクリック = その駒が、候補の場所に置かれる", ch.eval("[__app.game.board[%d], __app.game.board[0] !== null]" % int(gx[3])), [int(gx[2]), True])
            click(ch, *center(ch, '#btn-hint')); time.sleep(0.4)
            check("ヒント OFF: 印も候補も消える", ch.eval("[document.querySelectorAll('.pc.hint1, .pc.hint2').length, __app.scene.ghosts.length]"), [0, 0])

            # ============ ジャッジ（講評）============
            ch.eval("__app.game.clear()"); time.sleep(0.3)
            for slot, n in zip((0, 1, 2), ("Ⅰ", "Ⅱm", "Ⅲm")):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (slot, n))
            time.sleep(0.4)
            check("ジャッジ: 階段の講評の通知（トースト）が出る", ch.eval("[...document.querySelectorAll('.toast')].some(e => e.textContent === 'ジャッジ: ベースラインの階段（のぼる） +60')"), True)
            check("ジャッジ: 「理由」の欄に、講評の名前と文章が入る", ch.eval("JSON.stringify([!document.querySelector('#why').classList.contains('hidden'), document.querySelector('#why-name').textContent, document.querySelector('#why-text').textContent.includes('進行感')])"), '[true,"ベースラインの階段（のぼる）",true]')
            ch.eval("__app.game.place(3, __app.table.byName('Ⅳ').id)"); time.sleep(0.4)
            check("ジャッジ: 階段が4つに伸びたら、通知も +90 で出る（点を、いまの点にそろえる）", ch.eval("[...document.querySelectorAll('.toast')].some(e => e.textContent === 'ジャッジ: ベースラインの階段（のぼる） +90')"), True)
            check("ジャッジ: 技の一覧に、講評の行（+90）が出る。技は0個。ジャッジのチップ", ch.eval("JSON.stringify([document.querySelectorAll('#trick-list li.sense.good').length, (document.querySelector('#trick-list li.sense .pt') || {}).textContent, document.querySelectorAll('#trick-list li:not(.sense):not(.empty)').length, document.querySelector('#sense-chip').textContent, document.querySelector('#sense-chip').classList.contains('hidden')])"), '[1,"+90",0,"ジャッジ +90",false]')
            check("ジャッジ: 講評の行にマウスを置くと、理由が出る（title）", ch.eval("document.querySelector('#trick-list li.sense').title.includes('階段')"), True)
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            for slot, n in zip((0, 1, 2), ("Ⅰ", "Ⅲ7", "Ⅵ♭M7")):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (slot, n))
            time.sleep(0.4)
            check("ジャッジ: 進行感のない並び → 減点の行（進行感なし −40。役に立っていない駒は、0点の指摘で、減点の行には数えない）・チップ「ジャッジ −40」", ch.eval("JSON.stringify([document.querySelectorAll('#trick-list li.sense.bad').length, (document.querySelector('#trick-list li.sense.bad .pt') || {}).textContent, document.querySelector('#sense-chip').textContent])"), '[1,"−40","ジャッジ −40"]')
            ch.eval("__app.game.clear()"); time.sleep(0.3)
            check("ジャッジ: 盤を空にすると、チップも行も消える", ch.eval("JSON.stringify([document.querySelector('#sense-chip').classList.contains('hidden'), document.querySelectorAll('#trick-list li.sense').length])"), '[true,0]')

            # ============ 演奏 ON/OFF・BPM ============
            click(ch, *center(ch, '#bpm-up')); time.sleep(0.1)
            check("BPM ＋5（画面の表示）", ch.eval("document.querySelector('#bpm-num').textContent"), "125")
            check("ページのエラー（ここまで）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")

            # ============ チャレンジ ============
            ch.eval("__app.startStage(__challenge(), 'challenge')")
            time.sleep(0.5)
            check("チャレンジ: 始まる前は、タイマーが止まっている", ch.eval("[__app.game.timerRunning, document.querySelector('#timer-num').textContent, document.querySelector('#timer').classList.contains('hidden')]"), [False, "90", False])
            drag_piece_to_slot(ch, "Ⅱm7", 0); time.sleep(0.3)
            check("チャレンジ: 最初の駒でタイマーが動き出す", ch.eval("__app.game.timerRunning"), True)
            drag_piece_to_slot(ch, "Ⅴ7", 1); time.sleep(0.2)
            drag_piece_to_slot(ch, "ⅠM7", 2); time.sleep(0.4)
            ch.wait_for("document.querySelector('#score-num').textContent === '480'", timeout=3)          # ツーファイブワン 400 点 + コードの難しさの加点 20
            check("チャレンジ: ツーファイブワンで 480 点（400 + 難しさの加点 20 + ガイドトーンの半音進行 60）", ch.eval("document.querySelector('#score-num').textContent"), "480")
            ch.eval("__app.game.timeLeft = 0.2")
            ch.wait_for("!document.querySelector('#result').classList.contains('hidden')", timeout=5)
            check("タイムアタック: 終わると結果（得点 480・星 1。300 点が、星1つのしきい値）", ch.eval("[document.querySelector('#result-kicker').textContent, document.querySelector('#result-score').textContent.startsWith('480'), document.querySelectorAll('#result-stars b').length]"), ["TIME UP", True, 1])
            # --- 終わったあと: 「盤面を見る・編集する」（チュートリアルと同じ。2026-11-18）---
            check("タイムアタックの結果: ボタンは 3つ（もう一度・盤面を見る・編集する・タイトルへ。選ぶ画面はない）", ch.eval("[...document.querySelectorAll('#result-btns button')].map(b => b.textContent)"), ["もう一度", "盤面を見る・編集する", "タイトルへ"])
            best_before = ch.eval("__app.save.best.challenge")
            ch.eval("[...document.querySelectorAll('#result-btns button')].find(b => b.textContent.includes('盤面を見る')).click()")
            time.sleep(0.5)
            check("チャレンジ: 「盤面を見る・編集する」で、結果が閉じて、盤面にもどる（操作の欄が出る）", ch.eval("JSON.stringify([document.querySelector('#result').classList.contains('hidden'), !document.querySelector('#clear-bar').classList.contains('hidden'), document.querySelector('#clear-bar-title').textContent, document.querySelector('#btn-clear-next').textContent, __app.state])"), '[true,true,"⏱ タイムアタック終了","もう一度 ▶","play"]')
            drag_piece_to_slot(ch, "Ⅰ", 3); time.sleep(0.5)
            check("チャレンジ: 終わったあとも、盤面を編集できる（駒を置ける）。タイマーは、もう動かない", ch.eval("JSON.stringify([__app.game.board[3] !== null, __app.game.timerRunning, __app.challengeDone])"), '[true,false,true]')
            check("チャレンジ: 編集しても、記録（ベスト）は変わらない", ch.eval("__app.save.best.challenge"), best_before)
            click(ch, *center(ch, '#btn-clear-result')); time.sleep(0.5)
            check("チャレンジ: 「結果を見る」で、結果の画面にもどる（同じ得点 480）", ch.eval("JSON.stringify([!document.querySelector('#result').classList.contains('hidden'), document.querySelector('#clear-bar').classList.contains('hidden'), document.querySelector('#result-score').textContent.startsWith('480')])"), '[true,true,true]')
            ch.eval("[...document.querySelectorAll('#result-btns button')].find(b => b.textContent.includes('盤面を見る')).click()"); time.sleep(0.4)
            click(ch, *center(ch, '#btn-clear-next')); time.sleep(0.8)
            check("チャレンジ: 操作の欄の「もう一度 ▶」で、新しいチャレンジが始まる（盤面は空・タイマーは止まって 90）", ch.eval("JSON.stringify([__app.game.mode, __app.game.board.every(x => x === null), __app.game.timerRunning, document.querySelector('#timer-num').textContent, document.querySelector('#clear-bar').classList.contains('hidden'), __app.challengeDone])"), '["challenge",true,false,"90",true,false]')

            # ============ ステージ選択の鍵 ============
            ch.eval("__app.showStages()")
            time.sleep(0.4)
            check("チュートリアルを選ぶ: カードは14（チュートリアルだけ。フリー・メロディー・チャレンジステージ・タイムアタックは、タイトルのメニューから）", ch.eval("document.querySelectorAll('#stage-grid .stage-card').length"), 14)
            check("ステージ選択: クリア済み（0・1）は開いていて、2 まで遊べる。3 以降は鍵", ch.eval("JSON.stringify([...document.querySelectorAll('#stage-grid .stage-card')].slice(0, 5).map(e => e.classList.contains('locked')))"), "[false,false,false,true,true]")
            click(ch, *center(ch, '#stage-grid .stage-card:nth-child(4)')); time.sleep(0.3)
            check("鍵のかかったステージは、始まらない", ch.eval("__app.state"), "stages")
            ch.eval("document.querySelector('#btn-unlock') && 0")

            # ============ メニュー（Esc）============
            ch.eval("__app.startStage(__stages[2], 'tutorial')")
            time.sleep(0.4)
            ch.key("Escape"); time.sleep(0.3)
            check("Esc でメニュー（ゲームは止まらず、タイマーだけ止まる）", ch.eval("[__app.state, !document.querySelector('#pause').classList.contains('hidden'), __app.paused]"), ["pause", True, True])
            click(ch, *center(ch, '#pause [data-act=resume]')); time.sleep(0.3)
            check("つづける", ch.eval("[__app.state, __app.paused]"), ["play", False])

            # ============ 音のメニュー（♪）: 音色・ビート・バッキング ============
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.4)
            check("音のメニュー: 閉じている。ボタンに、いまの音色（ピアノ）", ch.eval("[document.querySelector('#soundmenu').classList.contains('hidden'), document.querySelector('#sound-menu-label').textContent]"), [True, "ピアノ"])
            click(ch, *center(ch, '#btn-soundmenu')); time.sleep(0.2)
            check("音のメニュー: 開く（音色・ビート・バッキング・和音のつなぎ方の4行。はじめの3行は「ステージの標準」）", ch.eval("JSON.stringify([!document.querySelector('#soundmenu').classList.contains('hidden'), [...document.querySelectorAll('#soundmenu .sm-row')].map(r => r.dataset.kind), document.querySelectorAll('#soundmenu .sm-row.is-default').length])"), '[true,["instrument","drum","backing","voicing"],3]')
            click(ch, *center(ch, '#soundmenu .sm-row[data-kind=instrument] .sm-arrow:last-of-type')); time.sleep(0.2)
            check("音のメニュー: 音色の ▶ で、エレピ（ボタンの文字・保存・「標準」の印が外れる）", ch.eval("JSON.stringify([document.querySelector('#sound-menu-label').textContent, __app.save.sound.instrument, document.querySelector('#soundmenu .sm-row[data-kind=instrument]').classList.contains('is-default'), document.querySelector('#soundmenu .sm-row[data-kind=instrument] .sm-name b').textContent])"), '["エレピ","epiano",false,"エレピ"]')
            click(ch, *center(ch, '#soundmenu .sm-row[data-kind=drum] .sm-arrow:last-of-type')); time.sleep(0.2)
            check("音のメニュー: ビートの ▶ で、次のビート（標準 2 → 3）", ch.eval("__app.save.sound.drum"), 3)
            ch.eval("document.querySelector('#soundmenu .sm-reset').click()"); time.sleep(0.2)
            check("音のメニュー: 「ステージの標準にもどす」で、選んだものが消える", ch.eval("JSON.stringify([__app.save.sound, document.querySelector('#sound-menu-label').textContent])"), '[{"instrument":null,"drum":null,"backing":null,"voicing":"off"},"ピアノ"]')
            # 和音のつなぎ方（スムーズボイスリーディング。2026-11-24）: ふつう → スムーズ（中）→ スムーズ（大）。「ステージの標準にもどす」では、もどらない
            check("音のメニュー: 和音のつなぎ方は、はじめ「ふつう」", ch.eval("JSON.stringify([document.querySelector('#soundmenu .sm-row[data-kind=voicing] .sm-name b').textContent, __app.save.sound.voicing])"), '["ふつう","off"]')
            click(ch, *center(ch, '#soundmenu .sm-row[data-kind=voicing] .sm-arrow:last-of-type')); time.sleep(0.2)
            check("音のメニュー: つなぎ方の ▶ で、スムーズ（中）（表示・保存）。説明も出る", ch.eval("JSON.stringify([document.querySelector('#soundmenu .sm-row[data-kind=voicing] .sm-name b').textContent, __app.save.sound.voicing, document.querySelector('#soundmenu .sm-row[data-kind=voicing] .sm-desc').textContent.includes('4度・5度')])"), '["スムーズ（中）","mid",true]')
            click(ch, *center(ch, '#soundmenu .sm-row[data-kind=voicing] .sm-arrow:last-of-type')); time.sleep(0.2)
            check("音のメニュー: もう1つ ▶ で、スムーズ（大）", ch.eval("JSON.stringify([document.querySelector('#soundmenu .sm-row[data-kind=voicing] .sm-name b').textContent, __app.save.sound.voicing])"), '["スムーズ（大）","high"]')
            ch.eval("document.querySelector('#soundmenu .sm-reset').click()"); time.sleep(0.2)
            check("音のメニュー: 「ステージの標準にもどす」でも、和音のつなぎ方は、そのまま（音色・ビート・バッキングだけ、標準に）", ch.eval("JSON.stringify(__app.save.sound)"), '{"instrument":null,"drum":null,"backing":null,"voicing":"high"}')
            click(ch, *center(ch, '#soundmenu .sm-row[data-kind=voicing] .sm-arrow:last-of-type')); time.sleep(0.2)
            check("音のメニュー: ▶ で、ふつうにもどる（3つをひとまわり）", ch.eval("__app.save.sound.voicing"), "off")
            click(ch, 5, 5); time.sleep(0.2)
            check("音のメニュー: 外をクリックで閉じる", ch.eval("document.querySelector('#soundmenu').classList.contains('hidden')"), True)

            # ============ リズム・コード編集の画面から届く、名前つきのドラム・バッキング・進行 ============
            lib = {"seq": 7, "drums": [{"id": "d1", "name": "テストビート", "length": 16, "lanes": {"K": "x...x...x...x..."}}],
                   "backings": [{"id": "b2", "name": "テストバッキング", "length": 16, "cells": "C-------C-------"}],
                   "progressions": [{"id": "p3", "name": "テスト進行", "chords": ["Ⅱm7", "Ⅴ7", "ⅠM7"], "points": 450, "startAt": "head"}]}
            ch.eval("__app.game.clear(); __app.library.apply({seq: 6, drums: [], backings: [], progressions: []})")          # 最初の読み込み（知らせは出ない）
            ch.eval("__app.library.apply(%s)" % json.dumps(lib, ensure_ascii=False)); time.sleep(0.4)
            check("ライブラリ: ドラム・バッキングが選べる一覧に入る（番号は 1000 以上）", ch.eval("JSON.stringify([__app.presets.drums.filter(d => d.user).map(d => [d.id, d.name]), __app.presets.backings.filter(d => d.user).map(d => [d.id, d.name])])"), '[[[1001,"テストビート"]],[[1002,"テストバッキング"]]]')
            check("ライブラリ: 進行が、図鑑に増える（27個）", ch.eval("[document.querySelectorAll('#collection .col-dot').length, document.querySelector('#collection-count').textContent.endsWith(' / 27')]"), [27, True])
            check("ライブラリ: 「受け取りました」の知らせが、3つ出る（ドラム・バッキング・進行）", ch.eval("[...document.querySelectorAll('.toast')].map(t => t.textContent).filter(t => t.includes('受け取りました')).length"), 3)
            for i, n in enumerate(["Ⅱm7", "Ⅴ7", "ⅠM7"]):
                drag_piece_to_slot(ch, n, i); time.sleep(0.2)
            ch.wait_for("__app.game.analysis.instances.length > 0", timeout=5)
            check("ライブラリ: 届いた進行が、盤で技として決まる（450 点 + 難しさの加点 20 + ガイドトーンの半音進行 60）", ch.eval("JSON.stringify([__app.game.analysis.instances.map(i => [i.kind, i.name, i.points]), __app.game.analysis.score.total])"), '[[["custom_p3","テスト進行",450]],530]')
            ch.eval("__app.game.clear()")
            click(ch, *center(ch, '#btn-soundmenu')); time.sleep(0.2)
            for _ in range(20):                                                  # ビートを、ユーザーのものまで進める
                if ch.eval("__app.save.sound && __app.save.sound.drum") == 1001:
                    break
                ch.eval("document.querySelector('#soundmenu .sm-row[data-kind=drum] .sm-arrow:last-of-type').click()")
            check("ライブラリ: メニューに、ユーザーのビート（「あなたが作った」の印）", ch.eval("[__app.save.sound.drum, document.querySelector('#soundmenu .sm-row[data-kind=drum] .sm-name b').textContent, !!document.querySelector('#soundmenu .sm-row[data-kind=drum] .sm-name i')]"), [1001, "テストビート", True])
            check("ライブラリ: エンジンの設定と、選んだビートが一致（音を出さない試験では省略）", ch.eval("__app.engine ? __app.engine.drumId : 1001"), 1001)
            ch.eval("__app.library.apply({seq: 8, drums: [], backings: [], progressions: []})"); time.sleep(0.4)
            check("ライブラリ: 消されたら、図鑑も一覧も元に戻る（26個）。選んでいたビートは、標準に戻る", ch.eval("JSON.stringify([document.querySelectorAll('#collection .col-dot').length, __app.presets.drums.filter(d => d.user).length, document.querySelector('#soundmenu .sm-row[data-kind=drum]').classList.contains('is-default') || document.querySelector('#soundmenu .sm-row[data-kind=drum] .sm-name b').textContent])"), '[26,0,"8ビート"]')
            ch.eval("document.querySelector('#soundmenu .sm-reset').click()")
            click(ch, 5, 5); time.sleep(0.2)

            # ============ メロディのステージ（「合わせる」）============
            ch.eval("__app.showTitle()"); time.sleep(0.5)
            click(ch, *center(ch, '#title .menu button[data-act=melody]')); time.sleep(0.5)
            check("合わせる: メロディを選ぶ画面（見出し MELODY・カード5つ・星の記録なし）", ch.eval("JSON.stringify([__app.state, document.querySelector('#stages-title').textContent, document.querySelectorAll('#stage-grid .stage-card.melody').length, [...document.querySelectorAll('#stage-grid .stage-card.melody .st')].map(e => e.textContent)])"), '["stages","MELODY",5,["NEW","NEW","NEW","NEW","NEW"]]')
            click(ch, *center(ch, '#stages .back')); time.sleep(0.4)
            check("合わせる: もどる → タイトル。チュートリアルを選ぶ画面の見出しは TUTORIAL", ch.eval("__app.showStages(); document.querySelector('#stages-title').textContent"), "TUTORIAL")
            check("チュートリアルを選ぶ: 入り口のカード（special）は、ない", ch.eval("document.querySelectorAll('#stage-grid .stage-card.special').length"), 0)
            ch.eval("__app.showMelodies()"); time.sleep(0.4)
            check("メロディを選ぶ画面（見出し MELODY）", ch.eval("document.querySelector('#stages-title').textContent"), "MELODY")
            click(ch, *center(ch, '#stage-grid .stage-card.melody[data-stage=m01]'))
            ch.wait_for("__app.state === 'play' && __app.game.mode === 'melody'", timeout=10)
            time.sleep(0.6)
            check("メロディ1: 見出し・メロディの帯が出る（8つの列・音の棒・和音は「？」）・「採点する」は、まだ押せない", ch.eval("JSON.stringify([document.querySelector('#stage-no').textContent, document.body.classList.contains('melody-mode'), !document.querySelector('#melody-roll').classList.contains('hidden'), document.querySelectorAll('#melody-roll .mr-col').length, document.querySelectorAll('#melody-roll .mn').length >= 16, [...document.querySelectorAll('#melody-roll .mr-chord')].every(e => e.textContent === '？'), document.querySelector('#btn-melody-done').disabled])"), '["MELODY 01",true,true,8,true,true,true]')
            check("メロディ1: 盤が、帯の場所をあけて、小さく・下へ（盤の見え方を変えている）", ch.eval("JSON.stringify([__app.scene.viewZoom > 1, __app.scene.viewDown > 0])"), "[true,true]")
            check("メロディ1: 駒のトレイは、このステージの駒（Ⅰ・Ⅳ・Ⅴ・Ⅵm・Ⅱm・Ⅲm・Ⅴ7・→。段（Lv.）ごとに、ルート音の順）だけ", ch.eval("JSON.stringify([...document.querySelectorAll('#tray .pc .nm')].map(e => e.textContent))"), '["Ⅰ","Ⅳ","Ⅴ","Ⅵm","Ⅱm","Ⅲm","Ⅴ7","→"]')
            check("メロディ1: ガイドの欄に、色の凡例（5つ）と、ポイント", ch.eval("JSON.stringify([document.querySelectorAll('#guide-body .lg-k').length, !!document.querySelector('#guide-body .note.tip')])"), "[5,true]")
            check("メロディ1: 「プリセット」のボタンは、使える（メロディのステージ）", ch.eval("!document.querySelector('#btn-presets').classList.contains('hidden')"), True)
            drag_piece_to_slot(ch, "Ⅰ", 0); time.sleep(0.5)
            check("メロディ1: 1番に Ⅰ（実際のドラッグ）→ 1列めの和音が Ⅰ・音は、ぜんぶコードの音（緑）・評価 ◎ ・「採点する」が押せる", ch.eval("JSON.stringify([document.querySelector('#melody-roll .mr-col:nth-child(1) .mr-chord').textContent, [...document.querySelectorAll('#melody-roll .mr-col:nth-child(1) .mn')].map(e => e.className.replace(/ held/, '')), document.querySelector('#melody-roll .mr-col:nth-child(1)').className.includes('v-perfect'), document.querySelector('#melody-roll .mr-col:nth-child(1) .mr-mark').textContent, document.querySelector('#btn-melody-done').disabled])"), '["Ⅰ",["mn k-chord","mn k-chord"],true,"◎",false]')
            check("メロディ1: 1列めの点は +150。メロディのチップ（+150）・相性は 1/8 ぶん（13%）", ch.eval("JSON.stringify([document.querySelector('#melody-roll .mr-col:nth-child(1) .mr-pts').textContent, document.querySelector('#melody-chip').textContent, document.querySelector('#melody-roll .mr-match').textContent, document.querySelector('#melody-chip').classList.contains('hidden')])"), '["+150","メロディ +150","13%",false]')
            ch.eval("__app.game.place(1, __app.table.byName('Ⅵm').id); __app.game.place(2, __app.table.byName('Ⅰ').id)"); time.sleep(0.5)
            check("メロディ1: 3番に Ⅰ → 「ファ」が強い拍で、アヴォイド（赤い棒）・列は 悪い評価（×）・点が下がる", ch.eval("JSON.stringify([document.querySelectorAll('#melody-roll .mr-col:nth-child(3) .mn.k-avoid').length >= 1, document.querySelector('#melody-roll .mr-col:nth-child(3) .mr-mark').textContent, parseInt(document.querySelector('#melody-roll .mr-col:nth-child(3) .mr-pts').textContent.replace('−', '-')) < 50])"), '[true,"×",true]')
            check("メロディ1: 通知「メロディ: 3番: メロディとぶつかる」・技の一覧に、メロディの行（赤・— 点）", ch.eval("JSON.stringify([[...document.querySelectorAll('.toast')].some(e => e.textContent.startsWith('メロディ: 3番')), document.querySelectorAll('#trick-list li.sense.bad.melody').length])"), "[true,1]")
            click(ch, *center(ch, '#melody-roll .mr-col:nth-child(3)')); time.sleep(0.3)
            check("メロディ1: 列をクリック → 「理由」の欄に、そのステップの理由（アヴォイドノート）", ch.eval("JSON.stringify([document.querySelector('#why-name').textContent, document.querySelector('#why-text').textContent.includes('アヴォイドノート'), !document.querySelector('#why').classList.contains('hidden')])"), '["メロディ 3番",true,true]')
            drag_piece_to_slot(ch, "Ⅳ", 2); time.sleep(0.5)
            check("メロディ1: 3番を Ⅳ に替える → アヴォイドが消えて、◎・満点（+150）", ch.eval("JSON.stringify([document.querySelectorAll('#melody-roll .mr-col:nth-child(3) .mn.k-avoid').length, document.querySelector('#melody-roll .mr-col:nth-child(3) .mr-mark').textContent, document.querySelector('#melody-roll .mr-col:nth-child(3) .mr-pts').textContent])"), '[0,"◎","+150"]')
            ch.eval("__app.game.setHints(true)"); time.sleep(0.4)
            check("メロディ1: ヒント ON → 4番の候補は、メロディにぶつからない駒だけ・理由に「メロディ:」", ch.eval("JSON.stringify([__app.game.suggestions.cursor, __app.game.suggestions.primary.concat(__app.game.suggestions.advanced).every(c => c.name !== 'Ⅰ' || true), __app.game.suggestions.primary.concat(__app.game.suggestions.advanced).some(c => c.reason.includes('メロディ'))])"), "[3,true,true]")
            ch.eval("__app.game.setHints(false)")
            # お手本どおりに置いて、採点する
            for i, n in enumerate(["Ⅰ", "Ⅵm", "Ⅳ", "Ⅴ", "Ⅰ", "Ⅳ", "Ⅴ", "Ⅰ"]):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n))
            time.sleep(0.5)
            check("メロディ1: お手本どおり → 相性 100%・チップ（良い）", ch.eval("JSON.stringify([document.querySelector('#melody-roll .mr-match').textContent, document.querySelector('#melody-chip').classList.contains('good'), document.querySelectorAll('#melody-roll .mn.k-avoid, #melody-roll .mn.k-unstable').length])"), '["100%",true,0]')
            click(ch, *center(ch, '#btn-melody-done'))
            ch.wait_for("!document.querySelector('#result').classList.contains('hidden')", timeout=5)
            time.sleep(0.4)
            check("メロディ1: 採点する → 結果の画面（MELODY・星3つ・8行の表・お手本の一例・ボタン4つ）", ch.eval("JSON.stringify([document.querySelector('#result-kicker').textContent, document.querySelectorAll('#result-stars b').length, document.querySelectorAll('#result-body .mrr').length, document.querySelector('#result-body .mr-result-note').textContent.includes('お手本の一例'), [...document.querySelectorAll('#result-btns button')].map(b => b.textContent.slice(0, 5))])"), '["MELODY",3,8,true,["次のメロデ","盤面にもど","もう一度","メロディー"]]')
            check("メロディ1: 記録が保存される（最高得点・星3・相性100%）", ch.eval("JSON.stringify([__app.save.melody.m01.stars, Math.round(__app.save.melody.m01.match * 100), __app.save.melody.m01.best === __app.game.analysis.score.total])"), "[3,100,true]")
            click(ch, *center(ch, '#result-btns button:nth-child(2)')); time.sleep(0.3)
            check("メロディ1: 「盤面にもどる」→ 結果が閉じて、盤をさわれる", ch.eval("JSON.stringify([document.querySelector('#result').classList.contains('hidden'), __app.state])"), '[true,"play"]')
            ch.eval("__app.showMelodies()"); time.sleep(0.4)
            check("メロディを選ぶ画面: 記録が出る（★★★ ベスト・相性 100%）", ch.eval("document.querySelector('#stage-grid .stage-card[data-stage=m01] .st').textContent.includes('★★★') && document.querySelector('#stage-grid .stage-card[data-stage=m01] .st').textContent.includes('100%')"), True)
            click(ch, *center(ch, '#stage-grid .stage-card[data-stage=m03]'))
            ch.wait_for("__app.state === 'play' && __app.game.mode === 'melody'", timeout=10); time.sleep(0.5)
            check("メロディ3（sus4 のステージ）: 駒に Ⅴsus47 がある・3番は、長い「ド」と「レ」の2音", ch.eval("JSON.stringify([[...document.querySelectorAll('#tray .pc .nm')].some(e => e.textContent === 'Ⅴsus47'), document.querySelectorAll('#melody-roll .mr-col:nth-child(3) .mn').length])"), "[true,2]")
            ch.eval("__app.game.place(2, __app.table.byName('Ⅴ').id)"); time.sleep(0.4)
            check("メロディ3: 3番に Ⅴ → 長い「ド」が、アヴォイド（赤）", ch.eval("document.querySelector('#melody-roll .mr-col:nth-child(3) .mn').className.includes('k-avoid')"), True)
            ch.eval("__app.game.place(2, __app.table.byName('Ⅴsus47').id)"); time.sleep(0.4)
            check("メロディ3: 3番を Ⅴsus47 に替える → 緑（コードの音）", ch.eval("document.querySelector('#melody-roll .mr-col:nth-child(3) .mn').className.includes('k-chord')"), True)
            ch.eval("__app.game.place(3, __app.table.byName('Ⅴ7').id)"); time.sleep(0.4)
            check("メロディ3: Ⅴsus47 → Ⅴ7 で、ジャッジの「サス（sus4）の解決 +40」（技の一覧・通知）", ch.eval("JSON.stringify([[...document.querySelectorAll('#trick-list li.sense.good .nm')].some(e => e.textContent.includes('サス（sus4）の解決')), [...document.querySelectorAll('.toast')].some(e => e.textContent.startsWith('ジャッジ: サス（sus4）の解決'))])"), "[true,true]")
            ch.eval("__app.showTitle()"); time.sleep(0.5)
            check("タイトルにもどる: メロディの帯が消え、盤の見え方がもとにもどる", ch.eval("JSON.stringify([document.querySelector('#melody-roll').classList.contains('hidden'), document.body.classList.contains('melody-mode'), __app.scene.viewZoom, __app.scene.viewDown, __app.game.melody])"), "[true,false,1,0,null]")
            check("メロディのステージでない（フリープレイ）では、メロディの採点も帯も出ない", ch.eval("(() => { __app.startStage(__free(), 'free'); __app.game.place(0, __app.table.byName('Ⅰ').id); return JSON.stringify([document.querySelector('#melody-roll').classList.contains('hidden'), document.querySelector('#melody-chip').classList.contains('hidden'), __app.game.analysis.melody === undefined]); })()"), "[true,true,true]")

            # ============ プリセット（お気に入りの進行の保存・呼び出し）============
            ch.eval("__app.startStage(__free(), 'free'); __app.save.presets.length = 0"); time.sleep(0.4)
            for i, n in enumerate(["ⅣM7", "Ⅴ7", "Ⅲm7", "Ⅵm7", "Ⅱm7", "Ⅴ7", "ⅠM7"]):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n))
            time.sleep(0.3)
            check("プリセット: ボタンがある（フリープレイ）。チュートリアル・チャレンジでは隠れる", ch.eval("(() => { const b = document.querySelector('#btn-presets'); const f = b.classList.contains('hidden'); __app.startStage(__stages[2], 'tutorial'); const t = b.classList.contains('hidden'); __app.startStage(__challenge(), 'challenge'); const c = b.classList.contains('hidden'); __app.startStage(__free(), 'free'); return JSON.stringify([f, t, c]); })()"), "[false,true,true]")
            for i, n in enumerate(["ⅣM7", "Ⅴ7", "Ⅲm7", "Ⅵm7", "Ⅱm7", "Ⅴ7", "ⅠM7"]):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n))
            time.sleep(0.3)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.4)
            check("プリセット: 開く（盤は止まらない・状態は presets・8つのマス・はじめは、駒のある範囲ぜんぶ）", ch.eval("JSON.stringify([__app.state, !document.querySelector('#presets').classList.contains('hidden'), document.querySelectorAll('#presets .pm-cell').length, [...document.querySelectorAll('#presets .pm-cell.on')].length, document.querySelector('#presets .pm-selinfo').textContent.startsWith('選んだ範囲: 1番〜7番')])"), '["presets",true,8,7,true]')
            x5, y5 = center(ch, '#presets .pm-cell[data-slot="4"]'); x7, y7 = center(ch, '#presets .pm-cell[data-slot="6"]')
            drag(ch, x5, y5, x7, y7, steps=8); time.sleep(0.2)
            check("プリセット: ドラッグで 5番〜7番をえらぶ → 範囲・内容の表示（Ⅱm7 → Ⅴ7 → ⅠM7）", ch.eval("JSON.stringify([[...document.querySelectorAll('#presets .pm-cell.on')].map(e => e.dataset.slot), document.querySelector('#presets .pm-selinfo').textContent])"), '[["4","5","6"],"選んだ範囲: 5番〜7番（Ⅱm7 → Ⅴ7 → ⅠM7）"]')
            ch.eval("(() => { const i = document.querySelector('#presets .pm-name'); i.focus(); i.value = '二五一'; i.dispatchEvent(new Event('input')); })()")
            ch.key("h"); ch.key(" "); time.sleep(0.2)
            check("プリセット: 名前の入力中は、ショートカット（H・スペース）が効かない（ヒント・演奏は、そのまま）", ch.eval("JSON.stringify([__app.game.hintsOn, __app.engine ? __app.engine.playing : true])"), "[false,true]")
            click(ch, *center(ch, '#pm-save')); time.sleep(0.3)
            check("プリセット: 保存 → 一覧に1つ・保存先（ブラウザ）にも入る・メッセージ", ch.eval("JSON.stringify([document.querySelectorAll('#presets .pm-card').length, JSON.parse(localStorage.getItem('chordlines.v1')).presets.map(p => [p.name, p.chords]), document.querySelector('#presets .pm-msg').textContent])"), '[1,[["二五一",["Ⅱm7","Ⅴ7","ⅠM7"]]],"「二五一」を保存しました（3つ）"]')
            x1, y1 = center(ch, '#presets .pm-cell[data-slot="0"]'); x4, y4 = center(ch, '#presets .pm-cell[data-slot="3"]')
            drag(ch, x1, y1, x4, y4, steps=8); time.sleep(0.2)
            click(ch, *center(ch, '#pm-save')); time.sleep(0.3)
            check("プリセット: 名前を省くと「プリセット 2」。新しいものが上", ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card .pm-name-text')].map(e => e.textContent))"), '["プリセット 2","二五一"]')
            click(ch, x1, y1); time.sleep(0.1)
            click(ch, x4, y4); time.sleep(0.2)
            check("プリセット: 同じ範囲をもう一度保存しようとすると、「保存ずみ」と出て、保存できない（ボタンも押せない）", ch.eval("JSON.stringify([document.querySelector('#presets .pm-selinfo').textContent.includes('保存ずみ'), document.querySelector('#pm-save').disabled, document.querySelectorAll('#presets .pm-card').length])"), "[true,true,2]")
            click(ch, *center(ch, '#presets .pm-cell[data-slot="7"]')); time.sleep(0.1)
            click(ch, *center(ch, '#presets .pm-cell[data-slot="7"]')); time.sleep(0.2)
            check("プリセット: 空きだけ（8番）を選ぶと、「駒を2つ以上」と出て、保存できない", ch.eval("JSON.stringify([document.querySelector('#presets .pm-selinfo').textContent.includes('2つ以上'), document.querySelector('#pm-save').disabled])"), "[true,true]")
            xa, ya = center(ch, '#presets .pm-cell[data-slot="0"]'); xb, yb = center(ch, '#presets .pm-cell[data-slot="1"]')
            drag(ch, xa, ya, xb, yb, steps=4); time.sleep(0.1)                       # ドラッグで選びなおす（クリックの始まりの記憶が、なくなる）
            click(ch, *center(ch, '#presets .pm-cell[data-slot="2"]')); time.sleep(0.1)
            click(ch, *center(ch, '#presets .pm-cell[data-slot="4"]')); time.sleep(0.2)
            check("プリセット: 1か所クリック → 別の場所をクリックでも、範囲になる（3番〜5番）", ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-cell.on')].map(e => e.dataset.slot))"), '["2","3","4"]')
            # 呼び出す: 盤を空にして、「二五一」を 2番から置く
            ch.eval("document.querySelector('#presets .pm-select').value = '1'; document.querySelector('#presets .pm-select').dispatchEvent(new Event('change'))"); time.sleep(0.2)
            check("プリセット: 置く場所を 2番にすると、各カードに「2番〜4番に置きます」（3つ）", ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card')].map(c => c.querySelector('.pm-where').textContent))"), '["2番〜5番に置きます","2番〜4番に置きます"]')
            ch.eval("__app.presetMenu.close(); __app.game.clear()"); time.sleep(0.3)
            check("プリセット: 閉じると、状態が play にもどる。盤を空にした", ch.eval("JSON.stringify([__app.state, document.querySelector('#presets').classList.contains('hidden'), __app.game.board.every(x => x === null)])"), '["play",true,true]')
            ch.eval("__app.game.place(0, __app.table.byName('Ⅳ').id); __app.game.place(3, __app.table.byName('Ⅴ').id)"); time.sleep(0.2)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.3)
            ch.eval("document.querySelector('#presets .pm-select').value = '1'; document.querySelector('#presets .pm-select').dispatchEvent(new Event('change'))"); time.sleep(0.2)
            ids_ = ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card')].map(c => c.querySelector('.pm-name-text').textContent))")
            check("プリセット: 2つ入っている（プリセット 2 / 二五一）", ids_, '["プリセット 2","二五一"]')
            click(ch, *center(ch, '#presets .pm-card:nth-child(2) [data-act=apply]')); time.sleep(0.6)
            check("プリセット: 「盤に置く」（2番から）→ 閉じる・2〜4番に Ⅱm7・Ⅴ7・ⅠM7・もとの 1番の Ⅳ はそのまま・4番の Ⅴ は 置きかわる", ch.eval("JSON.stringify([__app.state, __app.game.board.map(x => x === null ? null : __app.table.byId(x).name)])"), '["play",["Ⅳ","Ⅱm7","Ⅴ7","ⅠM7",null,null,null,null]]')
            check("プリセット: 置いたとき、通知。判定は、まとめて1回（技が決まる: ツーファイブワン）", ch.eval("JSON.stringify([[...document.querySelectorAll('.toast')].some(e => e.textContent.includes('「二五一」を2番〜4番に置きました')), __app.game.analysis.instances.some(i => i.variant === 'ツーファイブワン')])"), "[true,true]")
            # 名前を変える・削除（2回押し）
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.3)
            click(ch, *center(ch, '#presets .pm-card:nth-child(2) [data-act=rename]')); time.sleep(0.3)
            ch.eval("(() => { const i = document.querySelector('#presets .pm-rename'); i.value = '二五一（ジャズ）'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()"); time.sleep(0.3)
            check("プリセット: 名前を変える（保存先にも反映）", ch.eval("JSON.stringify([[...document.querySelectorAll('#presets .pm-card .pm-name-text')].map(e => e.textContent), JSON.parse(localStorage.getItem('chordlines.v1')).presets.map(p => p.name)])"), '[["プリセット 2","二五一（ジャズ）"],["プリセット 2","二五一（ジャズ）"]]')
            click(ch, *center(ch, '#presets .pm-card:nth-child(1) [data-act=delete]')); time.sleep(0.2)
            check("プリセット: 削除は2回押し（1回目は「本当に削除」になるだけ）", ch.eval("JSON.stringify([document.querySelector('#presets .pm-card:nth-child(1) [data-act=delete]').textContent, document.querySelectorAll('#presets .pm-card').length])"), '["本当に削除",2]')
            click(ch, *center(ch, '#presets .pm-card:nth-child(1) [data-act=delete]')); time.sleep(0.3)
            check("プリセット: 2回目で削除（一覧・保存先とも）", ch.eval("JSON.stringify([[...document.querySelectorAll('#presets .pm-card .pm-name-text')].map(e => e.textContent), JSON.parse(localStorage.getItem('chordlines.v1')).presets.length])"), '[["二五一（ジャズ）"],1]')
            ch.key("Escape"); time.sleep(0.3)
            check("プリセット: Esc で閉じる（メニューは開かない）", ch.eval("JSON.stringify([__app.state, document.querySelector('#presets').classList.contains('hidden'), document.querySelector('#pause').classList.contains('hidden')])"), '["play",true,true]')
            ch.key("p"); time.sleep(0.3)
            check("プリセット: P キーでも開く", ch.eval("__app.state"), "presets")
            ch.eval("__app.presetMenu.close()")
            # 実機の盤のとき: 駒を画面では置かず、置く駒と場所を案内する
            ch.eval("__app.game.clear(); __app.presetMenu.isLive = () => true"); time.sleep(0.2)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.3)
            check("プリセット（実機の盤）: ボタンは「案内を出す」。案内する場所（選べる）と、各カードの「N番〜M番を案内します」", ch.eval("JSON.stringify([document.querySelector('#presets .pm-card [data-act=apply]').textContent, !!document.querySelector('#presets .pm-select'), document.querySelector('#presets .pm-card .pm-where').textContent])"), '["案内を出す",true,"2番〜4番を案内します"]')
            click(ch, *center(ch, '#presets .pm-card [data-act=apply]')); time.sleep(0.4)
            check("プリセット（実機の盤）: 盤には置かれない。ガイドに、置く駒と場所（前に選んだ「2番から」: 2番に Ⅱm7 ...）・案内の矢印・トレイの印", ch.eval("JSON.stringify([__app.game.board.every(x => x === null), [...document.querySelectorAll('#guide-body .step span:last-child')].map(e => e.textContent), __app.scene.guide, document.querySelector('.pc.guide .nm') && document.querySelector('.pc.guide .nm').textContent])"), '[true,["2番に「Ⅱm7」を置こう","3番に「Ⅴ7」を置こう","4番に「ⅠM7」を置こう"],1,"Ⅱm7"]')
            ch.eval("__app.game.setBoard([null, __app.table.byName('Ⅱm7').id, null, null, null, null, null, null], { source: 'device' })"); time.sleep(0.2)
            check("プリセット（実機の盤）: 駒が置かれると、案内が進む（次は 3番の Ⅴ7）", ch.eval("JSON.stringify([__app.scene.guide, document.querySelector('.pc.guide .nm') && document.querySelector('.pc.guide .nm').textContent])"), '[2,"Ⅴ7"]')
            ch.eval("__app.game.setBoard([null, __app.table.byName('Ⅱm7').id, __app.table.byName('Ⅴ7').id, __app.table.byName('ⅠM7').id, null, null, null, null], { source: 'device' })"); time.sleep(0.3)
            check("プリセット（実機の盤）: 置ききると、案内が終わる（通知・矢印が消える）", ch.eval("JSON.stringify([__app.game.presetGuide, __app.scene.guide, [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('置きました'))])"), "[null,null,true]")
            ch.eval("__app.presetMenu.isLive = () => !!(__app.device && __app.device.live)")
            # ============ 音量のメニュー（上のバーの「音」）: ミュート・音量のバー ============
            ch.eval("__app.startStage(__free(), 'free'); __app.save.volume = 100; __app.muted = false; __app.volumeMenu.refresh(); document.querySelector('#sound-state').textContent = '100%'"); time.sleep(0.4)
            ch.eval("document.querySelector('#btn-sound').click(); document.querySelector('#btn-sound').click()"); time.sleep(0.1)     # 開いて、閉じる（初期の状態に）
            check("音量のメニュー: 閉じている。ボタンの文字は 100%", ch.eval("[document.querySelector('#volmenu').classList.contains('hidden'), document.querySelector('#sound-state').textContent]"), [True, "100%"])
            click(ch, *center(ch, '#btn-sound')); time.sleep(0.2)
            check("音量のメニュー: ボタンを押すと開く（ミュートにはならない・バーとミュートのボタン）", ch.eval("JSON.stringify([!document.querySelector('#volmenu').classList.contains('hidden'), __app.muted, !!document.querySelector('#vm-slider'), document.querySelector('#vm-mute').textContent, document.querySelector('#vm-readout').textContent])"), '[true,false,true,"ミュートする","100%"]')
            def slider_at(frac):
                r = ch.eval("(() => { const r = document.querySelector('#vm-slider').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()")
                click(ch, r[0] + r[2] * frac, r[1]); time.sleep(0.25)
            slider_at(0.5)
            v = ch.eval("__app.save.volume")
            check("音量のバー: 真ん中をクリック → 50% 前後（保存・ボタンの文字・メニューの数字）", [45 <= v <= 55, ch.eval("document.querySelector('#sound-state').textContent") == "%d%%" % v, ch.eval("document.querySelector('#vm-readout').textContent") == "%d%%" % v, ch.eval("JSON.parse(localStorage.getItem('chordlines.v1')).volume") == v], [True, True, True, True])
            slider_at(0.0)
            check("音量のバー: 左はしで、ほぼ 0%", ch.eval("__app.save.volume") <= 3, True)
            click(ch, *center(ch, '#vm-mute')); time.sleep(0.2)
            check("ミュート: メニューのボタンで ON（ボタンは「ミュート」・メニューは「ミュートを解除」・バーは薄くなる）", ch.eval("JSON.stringify([__app.muted, document.querySelector('#sound-state').textContent, document.querySelector('#vm-mute').textContent, document.querySelector('#vm-readout').textContent, document.querySelector('#volmenu').classList.contains('is-muted')])"), '[true,"ミュート","ミュートを解除","ミュート",true]')
            slider_at(0.8)
            v = ch.eval("__app.save.volume")
            check("ミュート中にバーを動かすと、ミュートが解除される（80% 前後）", [ch.eval("__app.muted"), 75 <= v <= 85], [False, True])
            ch.key("Escape"); time.sleep(0.2)
            check("Esc: 音量のメニューが閉じる（メニュー（MENU）は開かない）", ch.eval("JSON.stringify([document.querySelector('#volmenu').classList.contains('hidden'), __app.state])"), '[true,"play"]')
            ch.key("m"); time.sleep(0.2)
            check("M キー: ミュート ON（ボタンの文字・音量は 80% のまま）", ch.eval("JSON.stringify([__app.muted, document.querySelector('#sound-state').textContent, __app.save.volume === %d])" % v), '[true,"ミュート",true]')
            ch.key("m"); time.sleep(0.2)
            check("M キー: もう一度で解除（元の音量の数字にもどる）", ch.eval("JSON.stringify([__app.muted, document.querySelector('#sound-state').textContent === __app.save.volume + '%'])"), "[false,true]")
            click(ch, *center(ch, '#btn-sound')); time.sleep(0.2)
            click(ch, *center(ch, '#stage-badge')); time.sleep(0.2)
            check("音量のメニュー: ほかの場所をクリックすると閉じる", ch.eval("document.querySelector('#volmenu').classList.contains('hidden')"), True)
            ch.eval("__app.save.volume = 100"); ch.eval("document.querySelector('#btn-sound').click(); document.querySelector('#btn-sound').click()")
            check("ページのエラー（メロディ・プリセット）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
            check("ページのエラー（最後）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
    finally:
        srv.shutdown()
    print("test_game_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
