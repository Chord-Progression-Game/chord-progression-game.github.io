#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自作コード・コードの編集・ダブルクリックで置く・技の詳細（2026-11-23）を、本物の Chrome で、マウス・キーボードの操作どおりに動かして確かめる。
  トレイのダブルクリック / 「＋」→ ピアノロールで音を置く → 名前の候補 → 保存 → トレイ・盤・判定 / 右クリックのメニュー（編集・削除・もとにもどす）/
  「コードを編集」ボタン（選ぶ・投げ入れる・持ち上げた駒）/ 保存が残る（読み込み直し）/ チュートリアルでは、もとの駒だけ /
  技の枠のクリック → 詳細（曲の例）/ ループのつなぎ目の指摘
実行:  python3 tools/host_tests/test_chordbook_ui.py
Chrome（/Applications/Google Chrome.app）がなければ、省略する（終了コード 0）。
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, center, click, open_game, drag  # noqa: E402

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
        if n == "-":
            continue
        ch.eval("__app.game.place(%d, %s)" % (i, "__app.table.repeatId" if n == "→" else "__app.table.byName(%r).id" % n))
    time.sleep(0.25)


def right_click(ch, x, y):
    ch.mouse("mouseMoved", x, y, 0)
    ch.cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "right", "buttons": 2, "clickCount": 1})
    ch.cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "right", "buttons": 0, "clickCount": 1})


def card_xy(ch, cid):
    """トレイの駒の中心（見えるところまで、トレイをスクロールする）"""
    ch.eval("(() => { const c = document.querySelector('#tray .pc[data-id=\"%d\"]'); if (c) c.scrollIntoView({ inline: 'center', block: 'nearest' }); })()" % cid)
    time.sleep(0.15)
    return center(ch, '#tray .pc[data-id="%d"]' % cid)


def cid(ch, name):
    return ch.eval("__app.table.byName(%r).id" % name)


def lab_xy(ch, m):
    """ピアノロールの、音の高さ m の行の中心（見えるところまで、スクロールする）"""
    return ch.eval("""(() => { const lab = __app.chordLab, sc = document.querySelector('.cl-scroll'), g = document.querySelector('.cl-grid');
        const y = (84 - %d) * lab.rh; if (y < sc.scrollTop + 10 || y > sc.scrollTop + sc.clientHeight - 20) sc.scrollTop = Math.max(0, y - sc.clientHeight / 2);
        const r = g.getBoundingClientRect(); return [r.left + r.width / 2, r.top + (84 - %d) * lab.rh + lab.rh / 2]; })()""" % (m, m))


def lab_click(ch, m):
    x, y = lab_xy(ch, m)
    time.sleep(0.05)
    x, y = lab_xy(ch, m)
    ch.mouse("mouseMoved", x, y, 0)
    ch.mouse("mousePressed", x, y, 1)
    ch.mouse("mouseReleased", x, y, 0)
    time.sleep(0.12)


def lab_notes(ch):
    return ch.eval("JSON.stringify(__app.chordLab.s.notes)")


def open_lab_new(ch):
    ch.eval("document.querySelector('#btn-chord-new').click()")
    ch.wait_for("__app.state === 'chordlab'", timeout=10)
    time.sleep(0.3)


def main():
    if not chrome_available():
        print("（自作コードのテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            ch.eval("window.confirm = () => true")
            # ============ ボタン・ステージごとの見え方 ============
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.5)
            vis = lambda sel: ch.eval("!document.querySelector(%r).classList.contains('hidden')" % sel)
            check("フリープレイ: 「コードを編集」「＋ コードをつくる」が見える", [vis('#btn-chord-edit'), vis('#btn-chord-new')], [True, True])
            check("フリープレイ: トレイに「＋」の駒（自作の段）。駒は 31 + 「→」", ch.eval("[!!document.querySelector('#btn-chord-add'), document.querySelectorAll('#tray .pc').length, document.querySelectorAll('#tray .pcadd').length]"), [True, 32, 1])
            check("フリープレイ: 「＋」は、Lv.5 の駒のあと・「→」の前（自作の段）", ch.eval("(() => { const kids = [...document.querySelector('#tray').children]; const add = kids.findIndex((e) => e.id === 'btn-chord-add'); const rep = kids.findIndex((e) => e.classList && e.classList.contains('pc') && e.dataset.fn === 'R'); const lastLv5 = kids.map((e, i) => (e.dataset && e.dataset.id && __app.table.byId(Number(e.dataset.id)) && __app.table.byId(Number(e.dataset.id)).level === 5 ? i : -1)).reduce((a, b) => Math.max(a, b), -1); return [lastLv5 < add, add < rep, [...document.querySelectorAll('#tray .sep')].map((e) => e.textContent).slice(-2)]; })()"), [True, True, ["自作", "つなぎ"]])
            ch.eval("__app.startStage(__stages[0], 'tutorial')"); time.sleep(0.3)
            check("チュートリアル: 「コードを編集」「＋ コードをつくる」「＋」は、出ない。コード表は、もとの駒だけ", ch.eval("[document.querySelector('#btn-chord-edit').classList.contains('hidden'), document.querySelector('#btn-chord-new').classList.contains('hidden'), !!document.querySelector('#btn-chord-add'), __app.table.mode]"), [True, True, False, "base"])
            ch.eval("__app.startStage(__challenge(), 'challenge')"); time.sleep(0.3)
            check("チャレンジ: 同じく、出ない", ch.eval("[document.querySelector('#btn-chord-edit').classList.contains('hidden'), !!document.querySelector('#btn-chord-add'), __app.table.mode]"), [True, False, "base"])
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.5)

            # ============ ダブルクリックで、盤の次の場所に置く ============
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            for name in ("Ⅰ", "Ⅵm", "Ⅳ"):
                x, y = card_xy(ch, cid(ch, name))
                click(ch, x, y); time.sleep(0.05); click(ch, x, y); time.sleep(0.25)
            check("ダブルクリック: 空の盤 → 1番・2番・3番に、順に置く", ch.eval("JSON.stringify(__app.game.board.slice(0, 4))"), json.dumps([cid(ch, "Ⅰ"), cid(ch, "Ⅵm"), cid(ch, "Ⅳ"), None]).replace(" ", ""))
            check("ダブルクリック: 駒は、持ち上がったまま（選ばれたまま）にならない", ch.eval("__app.input.armed"), None)
            ch.eval("__app.game.clear(); __app.game.place(5, __app.table.byName('Ⅰ').id)"); time.sleep(0.2)
            x, y = card_xy(ch, cid(ch, "Ⅳ")); click(ch, x, y); time.sleep(0.05); click(ch, x, y); time.sleep(0.25)
            check("ダブルクリック: いちばん右の駒（6番）の、次（7番）に置く（空きの 1〜5番は、とばす）", ch.eval("JSON.stringify(__app.game.board)"), json.dumps([None, None, None, None, None, cid(ch, "Ⅰ"), cid(ch, "Ⅳ"), None]).replace(" ", ""))
            ch.eval("__app.game.clear(); [0,1,2,3,4,5,6,7].forEach((i) => __app.game.place(i, __app.table.byName('Ⅰ').id))"); time.sleep(0.2)
            x, y = card_xy(ch, cid(ch, "Ⅳ")); click(ch, x, y); time.sleep(0.05); click(ch, x, y); time.sleep(0.25)
            check("ダブルクリック: 盤がいっぱいなら、置かない（Ⅰ が 8つのまま）", ch.eval("__app.game.board.every((x) => x === __app.table.byName('Ⅰ').id)"), True)
            check("ダブルクリック: いっぱいのときは、知らせる", ch.eval("[...document.querySelectorAll('#toasts .toast')].some((e) => /いっぱい/.test(e.textContent))"), True)
            # 1回だけクリック: 選ぶだけ（置かない）
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            x, y = card_xy(ch, cid(ch, "Ⅴ")); click(ch, x, y); time.sleep(0.6)
            check("1回のクリック: 駒を選ぶだけ。盤には置かない", ch.eval("[__app.input.armed === __app.table.byName('Ⅴ').id, __app.game.board.every((x) => x === null)]"), [True, True])
            ch.eval("__app.input.cancel()")

            # ============ 新しいコードを作る（ピアノロール）============
            open_lab_new(ch)
            check("編集画面: 「＋ コードをつくる」で開く。盤は操作できない状態", ch.eval("[__app.state, !!document.querySelector('#cl-title'), document.querySelector('#cl-title').textContent]"), ["chordlab", True, "コードをつくる"])
            for m in (52, 56, 60, 62, 67):                       # E3 G#3 C4 D4 G4
                lab_click(ch, m)
            check("編集画面: 空いているところをクリックで、音が置かれる（E3 G#3 C4 D4 G4）", lab_notes(ch), "[52,56,60,62,67]")
            check("編集画面: 名前の候補の1番目 = Eaug7(♯9)（ユーザーの例）", ch.eval("__app.chordLab.cands[0].symbol"), "Eaug7(♯9)")
            check("編集画面: コード名の欄に、自動で入る・度数の名前も出る", ch.eval("[document.querySelector('#cl-symbol').value, /Ⅲaug7\\(♯9\\)/.test(document.querySelector('#cl-degree').textContent)]"), ["Eaug7(♯9)", True])
            check("編集画面: 見本の駒が出る（球・立方体などは、選ぶまで、働きの形。ドミナントは緊張=赤）", ch.eval("[!!document.querySelector('#cl-preview .pc'), document.querySelector('#cl-preview .pc').dataset.fn]"), [True, "D"])
            # 音を動かす（ドラッグ）・消す（ダブルクリック）
            x, y = lab_xy(ch, 67); x2, y2 = lab_xy(ch, 69)
            drag(ch, x, y, x2, y2, steps=6)
            check("編集画面: 音をドラッグで上へ（G4 → A4）。名前の候補が変わる（Eaug7(♯9) → 別の読み方）", [lab_notes(ch), ch.eval("__app.chordLab.cands[0].symbol")], ["[52,56,60,62,69]", ch.eval("__app.chordLab.cands[0].symbol")])
            ch.eval("document.querySelector('#cl-undo').click()"); time.sleep(0.1)
            check("編集画面: 「戻す」でドラッグを元に戻せる", lab_notes(ch), "[52,56,60,62,67]")
            x, y = lab_xy(ch, 67)
            click(ch, x, y); time.sleep(0.08); click(ch, x, y); time.sleep(0.2)
            check("編集画面: 音をダブルクリックで消える（G4）", lab_notes(ch), "[52,56,60,62]")
            lab_click(ch, 67)
            check("編集画面: もう一度クリックで置き直す", lab_notes(ch), "[52,56,60,62,67]")
            # 名前・レベル・色・形
            ch.eval("(() => { const e = document.querySelector('#cl-symbol'); e.focus(); e.value = 'Eオルタード'; e.dispatchEvent(new Event('input', { bubbles: true })); })()"); time.sleep(0.1)
            check("編集画面: 自分で名前をつけられる（自動にもどすボタンが使えるようになる）", ch.eval("[__app.chordLab.s.symbol, __app.chordLab.s.touched, !document.querySelector('#cl-auto').disabled]"), ["Eオルタード", True, True])
            ch.eval("document.querySelector('#cl-levels [data-level=\"5\"]').click(); document.querySelector('#cl-colors .cl-sw:not(.auto)').click(); document.querySelector('#cl-shapes [data-shape=\"star\"]').click()"); time.sleep(0.15)
            check("編集画面: レベル 5・色・形（星）を選べる。見本に反映", ch.eval("[__app.chordLab.s.level, __app.chordLab.s.color, __app.chordLab.s.shape, document.querySelector('#cl-preview .pc').dataset.shape]"), [5, "#e9b93f", "star", "star"])
            check("編集画面: 保存前のコード表には、まだない", ch.eval("__app.table.customChords().length"), 0)
            ch.eval("document.querySelector('#cl-save').click()"); time.sleep(0.5)
            check("保存: 編集画面が閉じて、盤にもどる", ch.eval("__app.state"), "play")
            eid = ch.eval("__app.table.customChords()[0].id")
            check("保存: 自作コードが、コード表に入る（度数の名前・コード名・種類・レベル・色・形）", ch.eval("(() => { const c = __app.table.byId(%d); return [c.name, c.symbol, c.type, c.level, c.color, c.shape, c.custom, c.rootPc, c.fn]; })()" % eid), ["Ⅲaug7(♯9)", "Eオルタード", "dom7", 5, "#e9b93f", "star", True, 4, "D"])
            check("保存: トレイに駒が増える（Lv.5 の段。レベルを決めたので）", ch.eval("(() => { const c = document.querySelector('#tray .pc[data-id=\"%d\"]'); const seps = [...document.querySelectorAll('#tray .sep')].map((e) => e.textContent); return [!!c, c && c.classList.contains('custom'), c && c.dataset.shape, seps.includes('自作'), __app.table.list.filter((x) => x.level === 5 || x.id === %d).length]; })()" % (eid, eid)), [True, True, "star", True, 6])
            # 同じ構成音は、ことわる
            open_lab_new(ch)
            for m in (52, 56, 60, 62, 67):
                lab_click(ch, m)
            ch.eval("document.querySelector('#cl-save').click()"); time.sleep(0.3)
            check("保存: 同じ構成音のコードは、ことわる（画面は開いたまま・理由を出す）", ch.eval("[__app.state, /すでにあります/.test(document.querySelector('#cl-msg').textContent), __app.table.customChords().length]"), ["chordlab", True, 1])
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.3)
            # 2つめ: Am9（レベルは決めない）
            open_lab_new(ch)
            for m in (57, 60, 64, 67, 71):
                lab_click(ch, m)
            check("2つめ: A C E G B → Am9（ユーザーの例）", ch.eval("__app.chordLab.cands[0].symbol"), "Am9")
            ch.eval("document.querySelector('#cl-save').click()"); time.sleep(0.5)
            aid = ch.eval("__app.table.byName('Ⅵm9').id")
            check("2つめ: レベル未設定は、Lv.5 の右（自作の段）に入る。駒は、Lv.5 の駒のあと・「→」の前", ch.eval("(() => { const kids = [...document.querySelector('#tray').children]; const i = kids.findIndex((e) => e.dataset && e.dataset.id === '%d'); const rep = kids.findIndex((e) => e.dataset && e.dataset.fn === 'R'); return [i > 0, i < rep, document.querySelector('#tray .pc[data-id=\"%d\"] .lv').textContent, [...document.querySelectorAll('#tray .sep')].map((e) => e.textContent).slice(-2)]; })()" % (aid, aid)), [True, True, "自作", ["自作", "つなぎ"]])

            # ============ 自作コードで、進行を作る → 技・点数 ============
            place_board(ch, "ⅠM7 - Ⅵm7 Ⅱm7")
            ch.eval("__app.game.place(1, %d)" % eid); time.sleep(0.4)
            r = ch.eval("JSON.stringify(__app.game.analysis.instances.map((i) => [i.kind, i.variant, i.chords]))")
            check("自作コード: Eaug7(♯9)（dom7・Ⅲ）→ Ⅵm7 は、セカンダリードミナント（強進行）。もとの駒と同じ判定", "dominant_motion" in r and "セカンダリードミナント" in r, True)
            check("自作コード: 判定の技の和音の名前に、自作の名前が出る", ch.eval("__app.game.analysis.instances.some((i) => i.chords.includes('Ⅲaug7(♯9)'))"), True)
            lp = ch.eval("(() => { __app.game.place(4, %d); return __app.game.analysis.levelPieces.map((p) => [p.name, p.bonus]); })()" % aid)
            check("自作コード: 「コードの難しさ」の加点（Lv.5 = +40）が、1回つく。レベル未設定の Ⅵm9 は、つかない", [["Ⅲaug7(♯9)", 40] in lp, any(p[0] == "Ⅵm9" for p in lp)], [True, False])
            # ダブルクリックで、自作コードを置く
            ch.eval("__app.game.clear()"); time.sleep(0.2)
            x, y = card_xy(ch, eid); click(ch, x, y); time.sleep(0.05); click(ch, x, y); time.sleep(0.4)
            check("ダブルクリック: 自作コードも、盤の次の場所に置ける", ch.eval("__app.game.board[0]"), eid)
            check("3D の駒: 自作コードの駒が、盤に出る（星の形・選んだ色）", ch.eval("(() => { const p = __app.scene.pieces[0]; return [!!p, p && p.chord.id, p && p.chord.shape, p && p.chord.color]; })()"), [True, eid, "star", "#e9b93f"])

            # ============ 右クリックのメニュー ============
            x, y = card_xy(ch, eid); right_click(ch, x, y); time.sleep(0.3)
            check("右クリック: 自作コードのメニュー（編集・削除）", ch.eval("[!document.querySelector('#chordmenu').classList.contains('hidden'), [...document.querySelectorAll('#chordmenu .cm-item')].map((e) => e.textContent)]"), [True, ["コードを編集", "このコードを削除"]])
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[0].click()"); time.sleep(0.4)
            check("右クリック → 編集: 編集画面が、その駒の構成音で開く", ch.eval("[__app.state, __app.chordLab.s.mode, __app.chordLab.s.id, JSON.stringify(__app.chordLab.s.notes), __app.chordLab.s.symbol, __app.chordLab.s.shape]"), ["chordlab", "custom", eid, "[52,56,60,62,67]", "Eオルタード", "star"])
            lab_click(ch, 72)                                       # C5 を足す
            ch.eval("document.querySelector('#cl-save').click()"); time.sleep(0.5)
            check("自作コードの編集: 音を足して保存 → 名前が変わり、盤の駒も変わる（Ⅲaug7(♯9) に C5 = ♯5 が重なるので、読み方が変わる）", ch.eval("(() => { const c = __app.table.byId(%d); return [c.midi.length, __app.scene.pieces[0].chord.id === %d, __app.game.board[0]]; })()" % (eid, eid)), [6, True, eid])
            # 組み込みの駒（Ⅴ7）を右クリック
            x, y = card_xy(ch, cid(ch, "Ⅴ7")); right_click(ch, x, y); time.sleep(0.3)
            check("右クリック: もとの駒のメニューは、編集だけ（削除はできない）", ch.eval("[...document.querySelectorAll('#chordmenu .cm-item')].map((e) => e.textContent)"), ["コードを編集"])
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[0].click()"); time.sleep(0.4)
            v7 = cid(ch, "Ⅴ7")
            check("もとの駒の編集: Ⅴ7 の構成音（G B D F）で開く。名前の候補の1番目 = G7", ch.eval("[__app.chordLab.s.mode, JSON.stringify(__app.chordLab.s.notes), __app.chordLab.cands[0].symbol, document.querySelector('#cl-reset').disabled]"), ["base", "[55,59,62,65]", "G7", True])
            lab_click(ch, 69)                                       # A4 を足す（9th）
            check("もとの駒の編集: A を足すと G9", ch.eval("__app.chordLab.cands[0].symbol"), "G9")
            ch.eval("document.querySelector('#cl-save').click()"); time.sleep(0.5)
            check("もとの駒の編集: 保存 → Ⅴ7 は Ⅴ9（G9）に。同じ ID・同じ Lv。もとの名前 Ⅴ7 でも、同じ駒を指す（実機の駒・保存ずみのプリセット）", ch.eval("(() => { const c = __app.table.byId(%d); return [c.name, c.symbol, c.type, c.level, c.edited, __app.table.byName('Ⅴ7').id === %d]; })()" % (v7, v7)), ["Ⅴ9", "G9", "dom7", 2, True, True])
            check("もとの駒の編集: トレイのカードに「編」の印", ch.eval("document.querySelector('#tray .pc[data-id=\"%d\"]').classList.contains('edited')" % v7), True)
            x, y = card_xy(ch, v7); right_click(ch, x, y); time.sleep(0.3)
            check("編集ずみの駒のメニュー: 編集・もとにもどす", ch.eval("[...document.querySelectorAll('#chordmenu .cm-item')].map((e) => e.textContent)"), ["コードを編集", "もとにもどす"])
            items = ch.eval("document.querySelectorAll('#chordmenu .cm-item').length")
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[1].click()"); time.sleep(0.2)
            check("もとにもどす: 1回目は、確認（もう一度押すと実行）", ch.eval("[document.querySelectorAll('#chordmenu .cm-item')[1].textContent, __app.table.byId(%d).name]" % v7), ["もう一度押すと実行", "Ⅴ9"])
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[1].click()"); time.sleep(0.4)
            check("もとにもどす: 2回目で実行 → Ⅴ7（G7）にもどる", ch.eval("(() => { const c = __app.table.byId(%d); return [c.name, c.symbol, !!c.edited]; })()" % v7), ["Ⅴ7", "G7", False])

            # ============ 「コードを編集」ボタン ============
            ch.eval("document.querySelector('#btn-chord-edit').click()"); time.sleep(0.3)
            check("「コードを編集」: 押すと、選ぶ状態になる（トレイの駒が、枠で示される）", ch.eval("[document.body.classList.contains('edit-pick'), __app.editPick]"), [True, True])
            x, y = card_xy(ch, cid(ch, "Ⅵm")); click(ch, x, y); time.sleep(0.5)
            check("「コードを編集」→ 駒をクリック: その駒の編集画面が開く", ch.eval("[__app.state, __app.chordLab.s.id, __app.editPick]"), ["chordlab", cid(ch, "Ⅵm"), False])
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.3)
            ch.eval("document.querySelector('#btn-chord-edit').click()"); time.sleep(0.2)
            ch.key("Escape"); time.sleep(0.2)
            check("「コードを編集」: Esc で、選ぶのをやめる（メニューは開かない）", ch.eval("[__app.editPick, __app.state]"), [False, "play"])
            x, y = card_xy(ch, cid(ch, "Ⅳ")); bx, by = center(ch, '#btn-chord-edit')
            drag(ch, x, y, bx, by, steps=10); time.sleep(0.5)
            check("駒を「コードを編集」のボタンへ投げ入れる（ドラッグ）: その駒の編集画面が開く", ch.eval("[__app.state, __app.chordLab.s.id]"), ["chordlab", cid(ch, "Ⅳ")])
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.3)
            x, y = card_xy(ch, cid(ch, "Ⅱm7")); click(ch, x, y); time.sleep(0.5)
            check("駒をクリックで持ち上げた状態で「コードを編集」を押す: その駒の編集画面が開く", ch.eval("__app.input.armed"), cid(ch, "Ⅱm7"))
            ch.eval("document.querySelector('#btn-chord-edit').click()"); time.sleep(0.5)
            check("持ち上げた駒 → 編集画面（持ち上げは、終わる）", ch.eval("[__app.state, __app.chordLab.s.id, __app.input.armed]"), ["chordlab", cid(ch, "Ⅱm7"), None])
            ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.3)
            # 盤の駒を右クリック
            place_board(ch, "Ⅰ Ⅵm")
            bx, by = ch.eval("(() => { const p = __app.scene.slotToScreen(1, 0.4); return [p.x, p.y]; })()")
            right_click(ch, bx, by); time.sleep(0.3)
            check("盤の駒を右クリック: メニュー（編集）が出る", ch.eval("[!document.querySelector('#chordmenu').classList.contains('hidden'), document.querySelector('#chordmenu .cm-title').textContent]"), [True, "Ⅵm（Am）"])
            ch.key("Escape"); time.sleep(0.2)
            check("メニューは、Esc で閉じる（ゲームのメニューは開かない）", ch.eval("[document.querySelector('#chordmenu').classList.contains('hidden'), __app.state]"), [True, "play"])

            # ============ 保存が残る（読み込み直し）・リセットでも残る ============
            ch.eval("__app.game.clear(); __app.game.place(0, %d)" % aid); time.sleep(0.3)
            ch.open("http://127.0.0.1:%d/index.html" % port)
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=120)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=90)
            check("読み込み直しても、自作コードが残っている（タイトルでは、もとの駒だけ見える）", ch.eval("[__app.save.chordbook.custom.length, __app.table.mode, __app.table.list.length]"), [2, "base", 32])
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.5)
            check("フリープレイを始めると、自作コード（2つ）が、トレイに出る", ch.eval("[__app.table.customChords().map((c) => c.symbol), document.querySelectorAll('#tray .pc.custom').length]"), [["Eオルタード", "Am9"], 2])
            ch.eval("document.querySelector('#btn-menu').click()"); time.sleep(0.2)
            ch.eval("document.querySelector('#pause [data-act=\"title\"]').click()"); time.sleep(0.4)
            ch.eval("window.confirm = () => true; document.querySelector('#btn-reset').click()"); time.sleep(0.5)
            check("「進み具合をリセット」でも、自作コードは残る", ch.eval("[__app.save.chordbook.custom.length, JSON.parse(localStorage.getItem('chordlines.v1')).chordbook.custom.length]"), [2, 2])
            # ============ 削除 ============
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.5)
            aid = ch.eval("__app.table.byName('Ⅵm9').id")
            ch.eval("__app.game.place(2, %d)" % aid); time.sleep(0.3)
            x, y = card_xy(ch, aid); right_click(ch, x, y); time.sleep(0.3)
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[1].click()"); time.sleep(0.2)
            check("削除: 1回目は、確認（もう一度押すと実行）。まだ消えない", ch.eval("[document.querySelectorAll('#chordmenu .cm-item')[1].textContent, __app.table.customChords().length]"), ["もう一度押すと実行", 2])
            ch.eval("document.querySelectorAll('#chordmenu .cm-item')[1].click()"); time.sleep(0.5)
            check("削除: 2回目で実行。コード表・トレイ・盤から、なくなる", ch.eval("[__app.table.customChords().length, !!document.querySelector('#tray .pc[data-id=\"%d\"]'), __app.game.board[2], __app.save.chordbook.custom.length]" % aid), [1, False, None, 1])
            check("削除: 保存にも反映（読み込み直しても、もどらない）", ch.eval("JSON.parse(localStorage.getItem('chordlines.v1')).chordbook.custom.map((c) => c.symbol)"), ["Eオルタード"])

            # ============ プリセット: 自作コードを含む ============
            eid = ch.eval("__app.table.customChords()[0].id")
            place_board(ch, "ⅠM7 -")
            ch.eval("__app.game.place(1, %d); __app.game.place(2, __app.table.byName('Ⅵm7').id)" % eid); time.sleep(0.3)
            r = ch.eval("(() => { const r = __app.presetStore.add({ name: '自作入り', board: __app.game.board, from: 0, to: 2 }); return [r.ok, r.preset && r.preset.chords]; })()")
            check("プリセット: 自作コードを含む進行を保存できる（名前で覚える）", r, [True, ["ⅠM7", "Ⅲaug7(♯9)", "Ⅵm7"]])
            ch.eval("__app.chordStore.removeCustom(%d)" % eid); time.sleep(0.4)
            check("プリセット: 自作コードを削除しても、プリセットは残る", ch.eval("__app.presetStore.list().map((p) => p.name)"), ["自作入り"])
            place_board(ch, "")
            ch.eval("__app.presetMenu.onApply(__app.presetStore.list()[0], 0)"); time.sleep(0.4)
            check("プリセット: 削除ずみの自作コードがあっても、呼び出せる（その駒だけ、空きになる）", ch.eval("JSON.stringify(__app.game.board.slice(0, 3))"), json.dumps([cid(ch, "ⅠM7"), None, cid(ch, "Ⅵm7")]).replace(" ", ""))
            check("プリセット: 空きにした駒を、知らせる", ch.eval("[...document.querySelectorAll('#toasts .toast')].some((e) => /ない駒|いまはない/.test(e.textContent))"), True)

            # ============ 技の詳細 ============
            place_board(ch, "ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7")
            time.sleep(1.2)
            ins = ch.eval("JSON.stringify(__app.game.analysis.instances.findIndex((i) => i.kind === 'oudou'))")
            rect = ch.eval("JSON.stringify(__app.scene.labelScreenRect(__app.game.analysis.instances[%s]))" % ins)
            check("技の枠: 3D の枠（名前と点数の四角）が、画面に見えている", rect is not None and rect != "null", True)
            r = json.loads(rect)
            ch.mouse("mouseMoved", r["x"], r["y"], 0); time.sleep(0.2)
            check("技の枠: 上にマウスを置くと、カーソルが手の形になる", ch.eval("document.querySelector('#gl').style.cursor"), "pointer")
            click(ch, r["x"], r["y"]); time.sleep(0.6)
            check("技の枠をクリック: 詳細の画面が開く（王道進行）", ch.eval("[__app.state, document.querySelector('#td-name').textContent.slice(0, 4), !!document.querySelector('#td-songs')]"), ["trickdetail", "王道進行", True])
            check("技の詳細: 日本の曲が出る（夜に駆ける・ロビンソンなど）。資料の名前つき", ch.eval("(() => { const t = [...document.querySelectorAll('#td-songs li .st')].map((e) => e.textContent); return [t.includes('夜に駆ける'), t.includes('ロビンソン'), t.length >= 6, /RAG MUSIC/.test(document.querySelector('.td-src').textContent)]; })()"), [True, True, True, True])
            check("技の詳細: いつ決まる・点数のしくみも書いてある", ch.eval("(() => { const t = document.querySelector('.td-body').textContent; return [/1番か5番から並べると決まります/.test(t), /基本の点/.test(t), /この盤での点/.test(t)]; })()"), [True, True, True])
            ch.key("Escape"); time.sleep(0.3)
            check("技の詳細: Esc で閉じる（ゲームのメニューは開かない）", ch.eval("__app.state"), "play")
            ch.eval("__app.game.clear(); [['ⅣM7', 0], ['Ⅴ7', 1], ['Ⅲm7', 2], ['Ⅵm7', 3]].forEach(([n, i]) => __app.game.place(i, __app.table.byName(n).id))"); time.sleep(0.5)
            sx, sy = center(ch, '#stamp-layer .stamp')
            click(ch, sx, sy); time.sleep(0.5)
            check("技が決まったときの札（スタンプ）をクリックでも、詳細が開く", ch.eval("__app.state"), "trickdetail")
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.3)
            ch.eval("document.querySelector('#trick-list li.clickable').click()"); time.sleep(0.4)
            check("技の一覧の行をクリックでも、詳細が開く", ch.eval("__app.state"), "trickdetail")
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.3)
            ch.eval("document.querySelector('#why-more').click()"); time.sleep(0.4)
            check("「理由」の「くわしく」でも、詳細が開く", ch.eval("__app.state"), "trickdetail")
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.3)
            # 曲のない技（ふつうの強進行）・ループ
            place_board(ch, "Ⅰ Ⅵm7 Ⅱm7 Ⅴ7 Ⅰ Ⅵm7 Ⅱm7 Ⅴ7")
            time.sleep(1.0)
            check("ループのつなぎ目の技: 一覧に「ループ」と出る", ch.eval("[...document.querySelectorAll('#trick-list li small')].some((e) => /^ループ /.test(e.textContent))"), True)
            ch.eval("[...document.querySelectorAll('#trick-list li.clickable')].find((e) => /ループ /.test(e.textContent)).click()"); time.sleep(0.4)
            check("ループのつなぎ目の技の詳細: 条件に「8番 → 1番」", ch.eval("/ループのつなぎ目（8番 → 1番）/.test(document.querySelector('.td-body').textContent)"), True)
            ch.eval("document.querySelector('#td-close').click()"); time.sleep(0.3)
            place_board(ch, "- Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅱm7 Ⅴ7")
            time.sleep(0.8)
            check("8番の Ⅴ7 が、1番が空きで解決しないとき: 理由を指摘する（0点）", ch.eval("[...document.querySelectorAll('#trick-list li.sense.note')].some((e) => /ループのつなぎ目/.test(e.textContent))"), True)
            check("ページのエラー", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
    finally:
        srv.shutdown()
    print("test_chordbook_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
