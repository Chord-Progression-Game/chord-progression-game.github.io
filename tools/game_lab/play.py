# -*- coding: utf-8 -*-
"""ゲームを、本物の Chrome で動かして、画面を撮る（見た目の確認・自動操作の道具）。
   使い方:  python3 tools/game_lab/play.py 出力フォルダ       （既定の流れで、何枚か撮る）"""
import os, sys, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'host_tests'))
from chrome_driver import ChromeSession
from game_driver import center, drag, slot_xy, drag_piece_to_slot, serve, click  # noqa: E402

def errors(ch):
    return ch.eval('JSON.stringify(window.__errors || [])') + ' ' + str(ch.eval('window.__error || ""'))

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    srv, port = serve()
    try:
        with ChromeSession(width=1280, height=720) as ch:
            ch.open('http://127.0.0.1:%d/index.html' % port)
            ch.wait_for('window.__ready === true && window.__frames > 10', timeout=60)
            time.sleep(1.0)
            ch.screenshot(os.path.join(out, '01_splash.png'))
            print('エラー（起動）:', errors(ch))
            # 音を読み込んで、タイトルへ（クリックと同じ）
            ch.eval('__app.begin(true).then(() => true)')
            ch.wait_for("__app.state === 'title'", timeout=60)
            print('音の状態:', ch.eval('__app.engine ? __app.engine.ctx.state : "なし"'), ' ピアノ:', ch.eval('__app.engine ? __app.engine.pianoBuffers.length : 0'), ' ドラム:', ch.eval('__app.engine ? Object.keys(__app.engine.drumBuffers).length : 0'))
            time.sleep(7.5)
            ch.screenshot(os.path.join(out, '02_title_demo.png'))
            print('エラー（タイトル）:', errors(ch))
            print('デモの盤:', ch.eval('JSON.stringify(__app.game.board)'), ' 技:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => i.name + (i.variant ? "/" + i.variant : "")))'))
            # --- チュートリアル 1（Ⅴ-Ⅰ終止）を、実際にドラッグして遊ぶ ---
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '03_tutorial_start.png'))
            drag_piece_to_slot(ch, 'ⅣM7', 1)
            time.sleep(0.9)
            ch.screenshot(os.path.join(out, '04_placed_first.png'))
            print('盤:', ch.eval('JSON.stringify(__app.game.board)'))
            drag_piece_to_slot(ch, 'Ⅴ7', 2); time.sleep(0.4)
            drag_piece_to_slot(ch, 'Ⅰ', 3)
            time.sleep(0.7)
            ch.screenshot(os.path.join(out, '05_trick_formed.png'))
            print('技:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => i.name))'), ' クリア:', ch.eval('__app.game.cleared'))
            time.sleep(3.8)
            ch.screenshot(os.path.join(out, '06_stage_clear.png'))
            print('エラー（遊んだあと）:', errors(ch))
            # --- フリープレイ + ヒント ---
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.6)
            drag_piece_to_slot(ch, 'ⅣM7', 0)
            time.sleep(0.5)
            ch.eval("document.querySelector('#btn-hint').click()")
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '07_free_hint.png'))
            print('ヒント:', ch.eval('JSON.stringify(__app.game.suggestions && {p: __app.game.suggestions.primary.map(c=>c.name), a: __app.game.suggestions.advanced.map(c=>c.name)})'))
            # --- コンボの盤（小室 + Ⅴ-Ⅰ終止）---
            for i, n in enumerate(['Ⅵm', 'Ⅳ', 'Ⅴ', 'Ⅰ']):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i + 4 if False else i, n))  # 置き直す
            ch.eval("__app.game.clear()")
            for i, n in enumerate(['Ⅵm', 'Ⅳ', 'Ⅴ', 'Ⅰ']):
                drag_piece_to_slot(ch, n, i); time.sleep(0.35)
            time.sleep(1.0)
            ch.screenshot(os.path.join(out, '08_free_combo.png'))
            print('コンボの盤:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => [i.name, i.total, i.comboMult]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            # --- 小節の頭（1番）の Ⅴ = 「？」---
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            drag_piece_to_slot(ch, 'Ⅰ', 1); time.sleep(0.3)
            drag_piece_to_slot(ch, 'Ⅴ7', 0); time.sleep(0.9)
            ch.screenshot(os.path.join(out, '12_oddity.png'))
            print('？の盤:', ch.eval('JSON.stringify([__app.game.analysis.oddities.map(o => [o.chords[0], o.startPos + 1, o.total]), __app.game.analysis.score.total])'))
            # --- 固有進行は、5番からでも成立（5〜8番に 50年代進行）+ 1〜4番に カデンツ ---
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            for i, n in enumerate(['Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅰ']):
                drag_piece_to_slot(ch, n, i); time.sleep(0.3)
            for i, n in enumerate(['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅴ']):
                drag_piece_to_slot(ch, n, 4 + i); time.sleep(0.3)
            time.sleep(1.4)
            ch.screenshot(os.path.join(out, '13_named_two.png'))
            print('固有進行の盤:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => [i.name, i.startPos + 1, i.total]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            # --- ジャッジ（講評）: ベースラインの階段（加点）→ 進行感のない並び（減点）---
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            for i, n in enumerate(['Ⅰ', 'Ⅱm', 'Ⅲm', 'Ⅳ']):
                drag_piece_to_slot(ch, n, i); time.sleep(0.3)
            time.sleep(1.0)
            ch.screenshot(os.path.join(out, '14_judge_good.png'))
            print('ジャッジ（加点）:', ch.eval('JSON.stringify(__app.game.analysis.critiques.map(c => [c.name, c.points]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            for i, n in enumerate(['Ⅰ', 'Ⅲ7', 'Ⅵ♭M7']):                          # 下の駒の列に、見えていない駒（右へ送らないと見えない）は、画面の API で置く
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n)); time.sleep(0.3)
            time.sleep(1.0)
            ch.screenshot(os.path.join(out, '15_judge_bad.png'))
            print('ジャッジ（減点）:', ch.eval('JSON.stringify(__app.game.analysis.critiques.map(c => [c.name, c.points]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            # --- 借用和音（サブドミナントマイナー: Ⅳ → Ⅳm7 → Ⅰ）---
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            for i, n in enumerate(['Ⅳ', 'Ⅳm7', 'Ⅰ']):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n)); time.sleep(0.3)
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '16_borrowed_sdm.png'))
            print('借用和音:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => [i.name, i.variant, i.total]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            # --- 下の駒をクリックで持ち上げる（半透明の駒が、マウスについてくる）---
            ch.eval("__app.game.clear()")
            time.sleep(0.4)
            drag_piece_to_slot(ch, 'Ⅰ', 0); time.sleep(0.3)
            cx, cy = center(ch, '.pc[data-id="%d"]' % ch.eval("__app.table.byName('Ⅴ7').id"))
            ch.mouse('mousePressed', cx, cy, 1); ch.mouse('mouseReleased', cx, cy, 1); time.sleep(0.3)
            sx, sy = slot_xy(ch, 5)
            ch.mouse('mouseMoved', sx, sy, 0); time.sleep(0.6)
            ch.screenshot(os.path.join(out, '17_tray_lift.png'))
            print('持ち上げ:', ch.eval('__app.input.armed'))
            ch.key('Escape'); time.sleep(0.3)
            # --- チュートリアルのクリア: 盤面が見えたまま、少し待って、結果の画面 → 「盤面を見る・編集する」---
            ch.eval("__app.clearDelayOverride = 1500")
            ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
            time.sleep(1.0)
            drag_piece_to_slot(ch, 'ⅣM7', 1); time.sleep(0.4)
            drag_piece_to_slot(ch, 'Ⅴ7', 2); time.sleep(0.4)
            drag_piece_to_slot(ch, 'Ⅰ', 3); time.sleep(0.7)
            ch.screenshot(os.path.join(out, '18_clear_wait.png'))
            ch.wait_for("!document.querySelector('#result').classList.contains('hidden')", timeout=8)
            time.sleep(0.6)
            ch.screenshot(os.path.join(out, '19_clear_result.png'))
            ch.eval("[...document.querySelectorAll('#result button')].find(b => b.textContent.includes('盤面を見る')).click()")
            time.sleep(0.8)
            ch.screenshot(os.path.join(out, '20_clear_bar.png'))
            print('クリアの後の操作:', ch.eval("JSON.stringify([__app.state, !document.querySelector('#clear-bar').classList.contains('hidden')])"))
            ch.eval("__app.clearDelayOverride = null")
            # --- メロディにコードをつける（2026-11-17）---
            ch.eval("__app.showMelodies()")
            time.sleep(0.7)
            ch.screenshot(os.path.join(out, '21_melody_select.png'))
            ch.eval("__app.startStage(__melodies[0], 'melody')")
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '22_melody_start.png'))
            for i, n in enumerate(['Ⅰ', 'Ⅵm']):
                drag_piece_to_slot(ch, n, i); time.sleep(0.3)
            for i, n in enumerate(['Ⅰ', 'Ⅴ', 'Ⅰ', 'Ⅳ']):                              # 3番の Ⅰ は、ファがぶつかる（アヴォイド）。6番の Ⅳ は、合う
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i + 2, n)); time.sleep(0.25)
            time.sleep(1.4)
            ch.screenshot(os.path.join(out, '23_melody_avoid.png'))
            print('メロディ（3番にⅠ）:', ch.eval('JSON.stringify(__app.game.analysis.melody.steps.map(s => [s.chord, s.points, s.verdict]))'), ' 合計', ch.eval('__app.game.analysis.score.total'))
            click(ch, *center(ch, '#melody-roll .mr-col:nth-child(3)')); time.sleep(0.4)
            ch.screenshot(os.path.join(out, '24_melody_why.png'))
            for i, n in enumerate(['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅴ', 'Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅰ']):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n)); time.sleep(0.15)
            time.sleep(1.0)
            click(ch, *center(ch, '#btn-melody-done')); time.sleep(0.9)
            ch.screenshot(os.path.join(out, '25_melody_result.png'))
            print('メロディ（お手本）:', ch.eval('JSON.stringify([__app.game.analysis.score.total, Math.round(__app.game.analysis.score.melodyMatch * 100), __app.save.melody.m01])'))
            ch.eval("document.querySelector('#result').classList.add('hidden'); __app.state = 'play'")
            # --- プリセット（お気に入りの進行の保存・呼び出し）---
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.8)
            for i, n in enumerate(['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7', 'Ⅱm7', 'Ⅴ7', 'ⅠM7']):
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (i, n)); time.sleep(0.12)
            time.sleep(0.6)
            click(ch, *center(ch, '#btn-presets')); time.sleep(0.5)
            x5, y5 = center(ch, '#presets .pm-cell[data-slot="4"]'); x7, y7 = center(ch, '#presets .pm-cell[data-slot="6"]')
            drag(ch, x5, y5, x7, y7, steps=8); time.sleep(0.2)
            ch.eval("(() => { const i = document.querySelector('#presets .pm-name'); i.value = '二五一のおしゃれ'; i.dispatchEvent(new Event('input')); })()")
            ch.screenshot(os.path.join(out, '26_preset_select.png'))
            click(ch, *center(ch, '#pm-save')); time.sleep(0.3)
            x1, y1 = center(ch, '#presets .pm-cell[data-slot="0"]'); x4, y4 = center(ch, '#presets .pm-cell[data-slot="3"]')
            drag(ch, x1, y1, x4, y4, steps=8); time.sleep(0.2)
            ch.eval("(() => { const i = document.querySelector('#presets .pm-name'); i.value = '王道'; i.dispatchEvent(new Event('input')); })()")
            click(ch, *center(ch, '#pm-save')); time.sleep(0.5)
            ch.screenshot(os.path.join(out, '27_preset_list.png'))
            print('プリセット:', ch.eval('JSON.stringify(__app.save.presets.map(p => [p.name, p.chords.join(" ")]))'))
            ch.eval("__app.presetMenu.close(); __app.game.clear(); __app.save.presets.length = 0")
            print('エラー（メロディ・プリセット）:', errors(ch))
            # --- ステージ選択 ---
            ch.eval("__app.showStages()")
            time.sleep(0.8)
            ch.screenshot(os.path.join(out, '09_stages.png'))
            # --- チャレンジ ---
            ch.eval("__app.startStage(__challenge(), 'challenge')")
            time.sleep(0.6)
            drag_piece_to_slot(ch, 'Ⅱm7', 0); time.sleep(0.3)
            drag_piece_to_slot(ch, 'Ⅴ7', 1); time.sleep(0.3)
            drag_piece_to_slot(ch, 'ⅠM7', 2); time.sleep(1.3)
            ch.screenshot(os.path.join(out, '10_challenge.png'))
            ch.eval("__app.game.timeLeft = 0.2")
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '11_challenge_end.png'))
            print('エラー（最後）:', errors(ch))
            # --- 2026-11-18: 終止のチュートリアル（ピカルディ終止 = ⅣM7 → Ⅴ7 → Ⅵsus4 → Ⅵ）と、進行の頭のヒント ---
            ch.eval("__app.game.save.unlockAll = true")
            ch.eval("__app.startStage(__stages.find(s => s.id === 't11'), 'tutorial')")
            time.sleep(0.9)
            for slot, nm in [(0, 'ⅣM7'), (1, 'Ⅴ7'), (2, 'Ⅵsus4'), (3, 'Ⅵ')]:
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (slot, nm)); time.sleep(0.2)
            time.sleep(1.4)
            ch.screenshot(os.path.join(out, '28_tutorial_picardy.png'))
            print('ピカルディ:', ch.eval('JSON.stringify(__app.game.analysis.instances.map(i => [i.kind, i.variant, i.positions]))'))
            ch.eval("__app.startStage(__free(), 'free')")
            time.sleep(0.8)
            ch.eval("__app.game.setHints(true)"); time.sleep(0.8)
            ch.screenshot(os.path.join(out, '29_hint_head_empty.png'))
            for slot, nm in [(0, 'ⅣM7'), (1, 'Ⅴ7'), (2, 'Ⅲm7'), (3, 'Ⅵm7')]:
                ch.eval("__app.game.place(%d, __app.table.byName(%r).id)" % (slot, nm)); time.sleep(0.2)
            time.sleep(1.2)
            ch.screenshot(os.path.join(out, '30_hint_head_after_oudou.png'))
            print('頭のヒント:', ch.eval("JSON.stringify(__app.game.suggestions && [__app.game.suggestions.cursor, __app.game.suggestions.primary.map(x => x.name), __app.game.suggestions.advanced.map(x => x.name)])"))
            print('エラー（追加の画面）:', errors(ch))
    finally:
        srv.shutdown()
