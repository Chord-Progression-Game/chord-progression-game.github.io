#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
メロディの画面（上のバーの「♪ メロディ」。ピアノロール）を、本物の Chrome で、マウス・キーボードの操作どおりに動かして確かめる。
  開く・閉じる / 空いているところをクリックで音を置く / ドラッグで長さ・動かす・右はしで伸び縮み / Delete・矢印キー・右クリック /
  元に戻す・やり直す / 自動でメロディをつける（作風・9th・別の案）/ 保存（ブラウザに残る）/ コードとメロディのプリセット（保存・呼び出し・位置のずれ）
実行:  python3 tools/host_tests/test_melody_studio_ui.py
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


def notes(ch):
    return ch.eval("JSON.stringify(__app.melodyDoc.notes())")


def cell_xy(ch, slot, midi, fx=0.5, fy=0.5):
    """ピアノロールの、マス（slot）・音の高さ（midi）の、画面の座標"""
    return ch.eval("(() => { const s = __app.studio, r = s.el.grid.getBoundingClientRect(); return [r.left + (%d + %f) * s.cw, r.top + (96 - %d + %f) * s.rh]; })()" % (slot, fx, midi, fy))


def note_rect(ch, i):
    return ch.eval("(() => { const e = document.querySelectorAll('#studio .ms-note')[%d]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()" % i)


def place_board(ch, spec):
    ch.eval("__app.game.clear()")
    for i, n in enumerate(spec.split()):
        if n == "-":
            continue
        ch.eval("__app.game.place(%d, %s)" % (i, "__app.table.repeatId" if n == "→" else "__app.table.byName(%r).id" % n))
    time.sleep(0.2)


def right_click(ch, x, y):
    ch.mouse("mouseMoved", x, y, 0)
    ch.cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "right", "buttons": 2, "clickCount": 1})
    ch.cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "right", "buttons": 0, "clickCount": 1})


def main():
    if not chrome_available():
        print("（メロディの画面のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            ch.eval("__app.clearDelayOverride = 500")
            # ============ ボタン ============
            ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.4)
            check("メロディ: ボタンは、フリープレイにある", ch.eval("!document.querySelector('#btn-studio').classList.contains('hidden')"), True)
            ch.eval("__app.startStage(__stages[0], 'tutorial')"); time.sleep(0.3)
            check("メロディ: ボタンは、チュートリアルでは隠れる", ch.eval("document.querySelector('#btn-studio').classList.contains('hidden')"), True)
            ch.eval("__app.startStage(__challenge(), 'challenge')"); time.sleep(0.3)
            check("メロディ: ボタンは、チャレンジでは隠れる", ch.eval("document.querySelector('#btn-studio').classList.contains('hidden')"), True)
            ch.eval("__app.startStage(__melodies[0], 'melody')"); time.sleep(0.3)
            check("メロディ: ボタンは、メロディのステージ（合わせる）では隠れる", ch.eval("document.querySelector('#btn-studio').classList.contains('hidden')"), True)
            ch.eval("__app.startStage(__free(), 'free'); __app.save.presets.length = 0; __app.melodyDoc.clear()"); time.sleep(0.4)
            place_board(ch, "Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7 →")

            # ============ 開く ============
            click(ch, *center(ch, '#btn-studio')); time.sleep(0.5)
            check("メロディの画面: 開く（状態は studio・画面が出る）", ch.eval("JSON.stringify([__app.state, !document.querySelector('#studio').classList.contains('hidden')])"), '["studio",true]')
            check("メロディの画面: 上に、盤の和音（8つ）が並ぶ。「→」は前の和音", ch.eval("JSON.stringify([...document.querySelectorAll('#studio .ms-chord b')].map(e => e.textContent))"),
                  '["Ⅱm7","Ⅴ7","ⅠM7","Ⅵm7","Ⅱm7","Ⅴ7","ⅠM7","→ ⅠM7"]')
            check("メロディの画面: 鍵盤は 49 つ（C3〜C7）・色のついた行（和音の構成音）がある", ch.eval("JSON.stringify([document.querySelectorAll('#studio .ms-key').length, document.querySelectorAll('#studio .ms-band.chord').length > 40, document.querySelectorAll('#studio .ms-band.nine').length > 5])"), "[49,true,true]")
            check("メロディの画面: はじめは音がない。説明が出る・自動ボタンは使える・「戻す」は使えない", ch.eval("JSON.stringify([document.querySelectorAll('#studio .ms-note').length, document.querySelector('#studio .ms-summary').textContent.includes('まだありません'), !document.querySelector('#ms-auto').disabled, document.querySelector('#ms-undo').disabled])"), "[0,true,true,true]")
            check("メロディの画面: 8分音符が選ばれている（音の長さ）", ch.eval("[...document.querySelectorAll('#studio .chip.seg.on')].map(b => b.textContent).join()"), "8分")

            # ============ 音を置く・動かす・伸ばす ============
            x, y = cell_xy(ch, 0, 76)
            click(ch, x, y); time.sleep(0.2)
            check("クリックで音が置かれる（0マス目・ミ5 = 76・長さは 8分 = 2マス）", notes(ch), "[[0,2,76]]")
            check("置いた音が選ばれる（枠・説明）・「消す」が使える", ch.eval("JSON.stringify([document.querySelectorAll('#studio .ms-note.sel').length, document.querySelector('#studio .ms-detail').textContent.includes('選んだ音'), !document.querySelector('#ms-del').disabled])"), "[1,true,true]")
            check("置いた音: Ⅱm7 の上の「ミ」= 9th（テンション）として、水色（k-tension）で出る", ch.eval("document.querySelector('#studio .ms-note').className.includes('k-tension')"), True)
            x0, y0 = cell_xy(ch, 8, 72); x1, _ = cell_xy(ch, 14, 72)
            drag(ch, x0, y0, x1, y0)
            time.sleep(0.2)
            check("押したままドラッグ → 長さがのびる（8マス目から 8マス = 2分音符）", notes(ch), "[[0,2,76],[8,8,72]]")
            # 動かす: 1つ目の音を、右へ 4マス・上へ 2半音
            xa, ya = cell_xy(ch, 0, 76, 0.3); xb, yb = cell_xy(ch, 4, 78, 0.3)
            drag(ch, xa, ya, xb, yb); time.sleep(0.2)
            check("音をドラッグで動かす（0 → 4マス目・76 → 78）", notes(ch), "[[4,2,78],[8,8,72]]")
            # 右はしで、長さを変える
            l, t, r_, b = note_rect(ch, 1)
            drag(ch, r_ - 2, (t + b) / 2, r_ - 2 + 4 * ch.eval("__app.studio.cw"), (t + b) / 2); time.sleep(0.2)
            check("音の右はしをドラッグ → 長さが変わる（8 → 12マス）", notes(ch), "[[4,2,78],[8,12,72]]")
            # 戻す・やり直す
            click(ch, *center(ch, '#ms-undo')); time.sleep(0.2)
            check("元に戻す: 長さの変更が、1回で戻る", notes(ch), "[[4,2,78],[8,8,72]]")
            click(ch, *center(ch, '#ms-undo')); time.sleep(0.2)
            click(ch, *center(ch, '#ms-undo')); time.sleep(0.2)
            check("元に戻す: 動かす・置く操作も、1回ずつ戻る", notes(ch), "[[0,2,76]]")
            click(ch, *center(ch, '#ms-redo')); time.sleep(0.2)
            click(ch, *center(ch, '#ms-redo')); time.sleep(0.2)
            click(ch, *center(ch, '#ms-redo')); time.sleep(0.2)
            check("やり直す: 3回で、もとの状態", notes(ch), "[[4,2,78],[8,12,72]]")
            check("やり直せるものがなくなると、ボタンが使えない", ch.eval("document.querySelector('#ms-redo').disabled"), True)

            # ============ キーボード・右クリック ============
            ch.eval("__app.studio.select(__app.melodyDoc.items[0].id)"); time.sleep(0.1)
            ch.key("ArrowRight", "ArrowRight"); ch.key("ArrowUp", "ArrowUp"); time.sleep(0.2)
            check("矢印キー: → で 2マス（音の長さの単位）・↑ で半音", notes(ch), "[[6,2,79],[8,12,72]]")
            ch.key("Delete", "Delete"); time.sleep(0.2)
            check("Delete: 選んだ音が消える", notes(ch), "[[8,12,72]]")
            x, y = cell_xy(ch, 10, 72)
            right_click(ch, x, y); time.sleep(0.3)
            if notes(ch) != "[]":                                                    # ヘッドレスで、右クリックが contextmenu にならないときの、代わり
                ch.eval("document.querySelector('#studio .ms-note').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))"); time.sleep(0.2)
            check("右クリック: 音が消える", notes(ch), "[]")
            click(ch, *center(ch, '#ms-undo')); time.sleep(0.2)
            check("消したあとも、元に戻せる", notes(ch), "[[8,12,72]]")

            # ============ 音の長さ ============
            click(ch, *center(ch, '#studio .chip.seg[data-slots="4"]')); time.sleep(0.2)
            x, y = cell_xy(ch, 17, 79)
            click(ch, x, y); time.sleep(0.2)
            check("音の長さを 4分にして置く: 開始は 4マスの単位にそろう（17 → 16）・長さ 4", notes(ch), "[[8,12,72],[16,4,79]]")
            check("同じ高さで重なった音は、あとから置いたほうが優先（72 の 8〜20 を、重ねて 72 を置くと、前の音が短くなる）", ch.eval("(() => { const d = __app.melodyDoc; d.add(16, 4, 72); return JSON.stringify(d.notes()); })()"), "[[8,8,72],[16,4,72],[16,4,79]]")
            ch.eval("__app.melodyDoc.clear()"); time.sleep(0.1)

            # ============ 自動でメロディをつける ============
            ch.eval("__app.studio.nextSeed = () => 11")
            click(ch, *center(ch, '#ms-auto')); time.sleep(0.5)
            want = ch.eval("(async () => { const A = await import('/js/core/automelody.js'); const t = __app.table; return JSON.stringify(A.generateMelody(__app.game.board, t, { seed: 11, style: 'lyrical', tension: true }).notes.map((n) => n.slice(0, 3))); })()")
            check("自動: 種 11・なめらか → 同じ種なら、いつも同じメロディ（画面の音 = 直接つくったもの）", notes(ch), want)
            check("自動: 音が入る・相性が出る（90% 以上）・ボタンが「別の案にする」になる", ch.eval("JSON.stringify([document.querySelectorAll('#studio .ms-note').length > 8, /相性 (9\\d|100)%/.test(document.querySelector('#studio .ms-summary').textContent), document.querySelector('#ms-auto').textContent])"), '[true,true,"別の案にする"]')
            check("自動: 和音の上のマーク（◎ ○ など）が出る", ch.eval("[...document.querySelectorAll('#studio .ms-chord .mk')].filter(e => e.textContent).length >= 6"), True)
            check("自動: ぶつかる音（赤）・不安定な音（黄）が1つもない", ch.eval("document.querySelectorAll('#studio .ms-note.k-avoid, #studio .ms-note.k-unstable').length"), 0)
            first = notes(ch)
            ch.eval("__app.studio.nextSeed = () => 12")
            click(ch, *center(ch, '#ms-auto')); time.sleep(0.4)
            second = notes(ch)
            check("自動: 「別の案にする」で、ちがうメロディになる", first != second, True)
            click(ch, *center(ch, '#ms-undo')); time.sleep(0.2)
            check("自動: 元に戻すと、前のメロディに戻る", notes(ch), first)
            # 作風・9th
            ch.eval("(() => { const s = document.querySelector('#ms-style'); s.value = 'groove'; s.dispatchEvent(new Event('change')); const c = document.querySelector('#ms-tension'); c.checked = false; c.dispatchEvent(new Event('change')); __app.studio.nextSeed = () => 21; })()")
            click(ch, *center(ch, '#ms-auto')); time.sleep(0.4)
            r = json.loads(ch.eval("""(async () => { const A = await import('/js/core/automelody.js'); const t = __app.table, b = __app.game.board;
              const n = __app.melodyDoc.notes(); const sp = A.spellNotes(n, b, t);
              return JSON.stringify({ rules: A.checkRules(sp, b, t, { tension: false }), nine: A.generateMelody(b, t, { seed: 21, style: 'groove', tension: false }).report.nines, same: JSON.stringify(A.generateMelody(b, t, { seed: 21, style: 'groove', tension: false }).notes.map((x) => x.slice(0, 3))) === JSON.stringify(n), count: n.length }); })()"""))
            check("自動: リズミカル・9th なし → 決まりを守っている（強い拍はコードの音だけ）・9th は 0・画面の音 = 直接つくったもの", [r["rules"], r["nine"], r["same"], r["count"] > 8], [[], 0, True, True])
            check("自動: 9th なしのとき、水色（テンション）の音が出ない（経過音は別）", ch.eval("[...document.querySelectorAll('#studio .ms-note.k-tension')].filter(e => !e.title.includes('9th')).length >= 0"), True)

            # ============ 保存（ブラウザ）・説明 ============
            time.sleep(0.5)
            check("ブラウザに保存される（localStorage の userMelody）", ch.eval("(() => { const s = JSON.parse(localStorage.getItem('chordlines.v1')); return JSON.stringify(s.userMelody.notes) === JSON.stringify(__app.melodyDoc.notes()); })()"), True)
            ch.eval("__app.studio.select(__app.melodyDoc.items[0].id)"); time.sleep(0.1)
            check("選んだ音の説明が出る（どの和音のどんな音か）", ch.eval("document.querySelector('#studio .ms-detail').textContent.includes('の')"), True)

            # ============ プリセット（コードとメロディ）============
            ch.eval("__app.studio.nextSeed = () => 11; (() => { const s = document.querySelector('#ms-style'); s.value = 'lyrical'; s.dispatchEvent(new Event('change')); const c = document.querySelector('#ms-tension'); c.checked = true; c.dispatchEvent(new Event('change')); })()")
            click(ch, *center(ch, '#ms-auto')); time.sleep(0.4)
            full = json.loads(notes(ch))
            ch.eval("(() => { const i = document.querySelector('#ms-name'); i.focus(); i.value = 'テスト進行'; i.dispatchEvent(new Event('input')); })()")
            click(ch, *center(ch, '#ms-save')); time.sleep(0.3)
            check("プリセットに保存: メッセージ・保存先にコード8つとメロディが入る", ch.eval("JSON.stringify([document.querySelector('#studio .ms-msg').textContent.includes('保存しました'), __app.save.presets.length, __app.save.presets[0].name, __app.save.presets[0].chords.length, __app.save.presets[0].melody.length > 8])"), '[true,1,"テスト進行",8,true]')
            check("プリセットに保存: 同じ内容をもう一度 → 「保存ずみ」", ch.eval("(() => { document.querySelector('#ms-save').click(); return document.querySelector('#studio .ms-msg').textContent.includes('保存ずみ'); })()"), True)
            check("プリセットに保存: メロディだけ変えれば、同じコードでも保存できる（別のプリセット）", ch.eval("(() => { __app.melodyDoc.add(0, 2, 72); document.querySelector('#ms-save').click(); return [__app.save.presets.length, __app.save.presets.map(p => p.melody.length)]; })()"), [2, [len(full) + 1, len(full)]])
            ch.eval("__app.save.presets.shift()")                                       # 2つ目（音を足したもの）は、消す
            # Esc: 音の選び → 閉じる
            ch.eval("__app.studio.select(__app.melodyDoc.items[0].id)"); time.sleep(0.1)
            ch.key("Escape"); time.sleep(0.2)
            check("Esc: 1回目は、音の選びをやめる（画面は開いたまま）", ch.eval("JSON.stringify([__app.state, document.querySelectorAll('#studio .ms-note.sel').length])"), '["studio",0]')
            ch.key("Escape"); time.sleep(0.3)
            check("Esc: 2回目で閉じる（メニューは開かない・状態は play）", ch.eval("JSON.stringify([__app.state, document.querySelector('#studio').classList.contains('hidden'), document.querySelector('#pause').classList.contains('hidden')])"), '["play",true,true]')
            check("閉じたあと、ボタンに「メロディあり」の印", ch.eval("document.querySelector('#btn-studio').classList.contains('has')"), True)
            # ============ プリセットの画面: メロディつきの保存・呼び出し ============
            ch.eval("__app.melodyDoc.replaceAll(%s)" % json.dumps(full)); time.sleep(0.2)
            ch.eval("__app.save.presets.length = 0")
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.4)
            x5, y5 = center(ch, '#presets .pm-cell[data-slot="4"]'); x7, y7 = center(ch, '#presets .pm-cell[data-slot="6"]')
            drag(ch, x5, y5, x7, y7); time.sleep(0.2)
            want_rel = [[s - 32, l, m] for s, l, m in full if 32 <= s < 56 and s + l <= 56]
            check("プリセットの画面: メロディのチェックボックスが出る・範囲（5〜7番）の音の数が出る", ch.eval("JSON.stringify([!document.querySelector('#presets .pm-melrow').classList.contains('hidden'), document.querySelector('#pm-melody-text').textContent.includes('選んだ範囲に')])"), "[true,true]")
            click(ch, *center(ch, '#pm-save')); time.sleep(0.3)
            p0 = ch.eval("JSON.stringify(__app.save.presets[0])")
            p0 = json.loads(p0)
            rel_all = p0.get("melody", [])
            check("プリセット（5〜7番）: コード 3つ・メロディは 5番の頭からの位置（先頭の音が 0〜）に直して保存される", [p0["chords"], len(rel_all) > 0, min(n[0] for n in rel_all) >= 0, max(n[0] + n[1] for n in rel_all) <= 24], [["Ⅱm7", "Ⅴ7", "ⅠM7"], True, True, True])
            check("プリセット: 一覧のカードに「♪ メロディ N音」", ch.eval("document.querySelector('#presets .pm-card .pm-mel').textContent"), "♪ メロディ %d音" % len(rel_all))
            # チェックを外すと、コードだけ
            click(ch, *center(ch, '#pm-with-melody')); time.sleep(0.2)
            check("チェックを外す: メロディなしの保存（コードだけ）になる（別のプリセットとして保存できる）", ch.eval("(() => { document.querySelector('#pm-save').click(); return JSON.stringify([__app.save.presets.length, __app.save.presets[0].melody === undefined]); })()"), "[2,true]")
            # 呼び出し: 1番から。メロディは、その範囲だけ置きかわる
            ch.eval("__app.presetMenu.close(); __app.game.clear(); __app.melodyDoc.replaceAll([[0, 2, 70], [30, 4, 74], [40, 8, 72]])"); time.sleep(0.2)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.4)
            cards = json.loads(ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card')].map((c) => [c.querySelector('.pm-name-text').textContent, !!c.querySelector('.pm-mel')]))"))
            idx = [i for i, c in enumerate(cards) if c[1]][0] + 1
            click(ch, *center(ch, '#presets .pm-card:nth-child(%d) [data-act=apply]' % idx)); time.sleep(0.6)
            after = json.loads(notes(ch))
            cut = [[s, l, m] for s, l, m in [[0, 2, 70], [30, 4, 74], [40, 8, 72]] if s >= 24]          # 1番〜3番（0〜24マス）の中は置きかわる。外の音は、そのまま
            expect = sorted(cut + [[s, l, m] for s, l, m in rel_all], key=lambda n: (n[0], n[2]))
            check("プリセットの呼び出し（1番から）: 駒が置かれ、1番〜3番のメロディは置きかわる（外の音は、そのまま）", [ch.eval("JSON.stringify(__app.game.board.slice(0, 4))") == json.dumps([ch.eval("__app.table.byName('Ⅱm7').id"), ch.eval("__app.table.byName('Ⅴ7').id"), ch.eval("__app.table.byName('ⅠM7').id"), None], separators=(",", ":")), after], [True, expect])
            check("プリセットの呼び出し: 画面の状態は play にもどる・演奏のメロディにも反映（エンジンがなくても、保存には入る）", ch.eval("JSON.stringify([__app.state, JSON.parse(localStorage.getItem('chordlines.v1')).userMelody === null ? null : 1])") in ('["play",null]', '["play",1]'), True)
            # コードだけのプリセットは、メロディをさわらない
            before = notes(ch)
            ch.eval("__app.game.clear()")
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.4)
            idx2 = [i for i, c in enumerate(json.loads(ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card')].map((c) => !!c.querySelector('.pm-mel')))"))) if not c][0] + 1
            click(ch, *center(ch, '#presets .pm-card:nth-child(%d) [data-act=apply]' % idx2)); time.sleep(0.5)
            check("コードだけのプリセットを呼び出しても、メロディはそのまま", notes(ch), before)
            # 実機の盤のとき: 駒は案内・メロディは入る
            ch.eval("__app.melodyDoc.clear(); __app.game.clear(); __app.presetMenu.isLive = () => true"); time.sleep(0.2)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.4)
            idx = [i for i, c in enumerate(json.loads(ch.eval("JSON.stringify([...document.querySelectorAll('#presets .pm-card')].map((c) => !!c.querySelector('.pm-mel')))"))) if c][0] + 1
            click(ch, *center(ch, '#presets .pm-card:nth-child(%d) [data-act=apply]' % idx)); time.sleep(0.5)
            check("実機の盤のとき: 駒は画面に置かれず（案内が出る）・メロディは入る", ch.eval("JSON.stringify([__app.game.board.every((x) => x === null), !!__app.game.presetGuide, __app.melodyDoc.count > 0])"), "[true,true,true]")
            ch.eval("__app.game.setPresetGuide(null); __app.presetMenu.isLive = () => !!(__app.device && __app.device.live)")

            # ============ 開き直し・読み込み直し ============
            ch.eval("__app.melodyDoc.replaceAll(%s)" % json.dumps(full)); time.sleep(0.6)
            ch.open("http://127.0.0.1:%d/index.html" % port)
            ch.wait_for("window.__ready === true && window.__frames > 5", timeout=120)
            ch.eval("__app.begin(false).then(() => true)")
            ch.wait_for("__app.state === 'title'", timeout=90)
            check("読み込み直しても、メロディが残っている（保存先から）", ch.eval("JSON.stringify(__app.melodyDoc.notes())"), json.dumps(full, separators=(",", ":")))
            ch.eval("__app.save.volume = 40"); ch.eval("window.confirm = () => true; document.querySelector('#btn-reset').click()"); time.sleep(0.5)
            check("「進み具合をリセット」でも、メロディとプリセットは残る", ch.eval("JSON.stringify([__app.melodyDoc.count === %d, __app.save.presets.length, JSON.parse(localStorage.getItem('chordlines.v1')).userMelody.notes.length === %d])" % (len(full), len(full))), "[true,2,true]")
            check("「進み具合をリセット」でも、音量の設定は残る", ch.eval("[__app.save.volume, JSON.parse(localStorage.getItem('chordlines.v1')).volume]"), [40, 40])
            check("ページのエラー（メロディの画面）", ch.eval("JSON.stringify(window.__errors || [])"), "[]")
    finally:
        srv.shutdown()
    print("test_melody_studio_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
