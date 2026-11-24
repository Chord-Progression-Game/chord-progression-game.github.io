#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第8弾（2026-11-24）の再発防止テスト。ユーザーが画像で報告した不具合と、スマホの指の操作を、本物の Chrome（スマホの画面・指の操作を再現）で確かめる。
  ※ 本物の iPhone（Safari）では、動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
  ① 技のスタンプが、メインメニュー（タイトル・ステージ選択）にかぶさらない: 「リズムを取り込む」を開いて閉じたあとも（スマホの縦・横。音あり）
     画面の切り替えの記録（body の data-screen = 土台の画面 / data-overlay = 重ねた画面）が、見えている画面と、いつも一致する
  ② 分割したマスの前半の駒が、コードの追加・編集・削除のあとも、半分の幅のまま（正方形にもどらない）
  ③ ガイドを開いているあいだも、盤が見える（縦: シートの上 / 横: 欄の右。トレイの駒は、かくさない）
  ④ 指の操作: 範囲選択（コードの編集・メロディの画面）・空きをなぞるとスクロール（音は置かない）・空きのタップで置く・選んだ音を、まとめて動かす
実行:  python3 tools/host_tests/test_round8_ui.py
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

# 見えている画面と、body の記録が、一致しているか（土台の画面は、ちょうど1つ。重ねた画面は、0か1つ）
CONSISTENT = """(() => {
  const vis = (id) => !document.querySelector('#' + id).classList.contains('hidden');
  const bases = ['splash', 'title', 'stages', 'hud'].filter(vis);
  const overs = ['pause', 'presets', 'studio', 'chordlab', 'trickdetail', 'libimport', 'howto', 'result'].filter(vis);
  const d = document.body.dataset;
  return JSON.stringify({ ok: bases.length === 1 && overs.length <= 1 && d.screen === bases[0] && (d.overlay || '') === (overs[0] || ''), bases, overs, screen: d.screen, overlay: d.overlay || '' });
})()"""
STAMP_DISPLAY = "getComputedStyle(document.querySelector('#stamp-layer')).display"


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def consistent(ch):
    r = json.loads(ch.eval(CONSISTENT))
    return r["ok"] or r


def wait_demo(ch, secs=14):
    """ タイトルの背景のデモが、技を決めるまで待つ（技のスタンプが出る状況にする）"""
    end = time.time() + secs
    while time.time() < end:
        if ch.eval("__app.game.analysis && __app.game.analysis.instances.length > 0"):
            return True
        time.sleep(0.4)
    return False


def scenario_stamps(ch, label):
    """ 報告の再現: タイトル → 「リズムを取り込む」を開いて閉じる。ステージ選択も """
    ch.eval("document.body.classList.add('web-only')")        # 公開ページ（https）と同じに（取り込みのボタンが出る）
    demo = wait_demo(ch)
    check("%s: タイトルの背景のデモが、技を決めている（スタンプが出る状況）" % label, demo, True)
    check("%s: タイトル: 記録 = 土台 title・重ねなし。技のスタンプは出さない" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval("document.body.dataset.overlay"), ch.eval(STAMP_DISPLAY)], [True, "title", "", "none"])
    ch.eval("document.querySelector('#btn-import').click()"); time.sleep(0.5)
    check("%s: 「リズムを取り込む」を開く: 土台は title のまま・重ねは libimport。スタンプは出さない" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval("document.body.dataset.overlay"), ch.eval(STAMP_DISPLAY)], [True, "title", "libimport", "none"])
    ch.eval("document.querySelector('#li-close').click()"); time.sleep(0.5)
    check("%s: 閉じる: 土台は title・重ねなし（報告の不具合: ここで土台が libimport のままだった）。スタンプは出さない" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval("document.body.dataset.overlay"), ch.eval(STAMP_DISPLAY), ch.eval("__app.state")], [True, "title", "", "none", "title"])
    time.sleep(2.5)                                           # デモの技が、また決まる時間を待つ（閉じたあとでも、スタンプが、メニューにかぶさらない）
    check("%s: 閉じて数秒たっても、スタンプは出ない（見えない）" % label, ch.eval("[%s, [...document.querySelectorAll('#stamp-layer .stamp')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length]" % STAMP_DISPLAY), ["none", 0])
    # 開く → 閉じる を、くり返しても、ずれない
    for i in range(3):
        ch.eval("document.querySelector('#btn-import').click()"); time.sleep(0.25)
        ch.eval("document.querySelector('#li-close').click()"); time.sleep(0.25)
    check("%s: 取り込みの画面を3回、開け閉めしても、記録は、ずれない" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval(STAMP_DISPLAY)], [True, "title", "none"])
    ch.eval("__app.showStages()"); time.sleep(0.5)
    check("%s: ステージ選択: 土台は stages。スタンプは出さない" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval(STAMP_DISPLAY)], [True, "stages", "none"])
    ch.eval("document.querySelector('#btn-import') && document.querySelector('#btn-import').click()"); time.sleep(0.3)
    ch.eval("document.querySelector('#li-close') && document.querySelector('#li-close').click()"); time.sleep(0.3)
    check("%s: ステージ選択から、取り込みを開け閉めしても、記録は、ずれない" % label, [consistent(ch), ch.eval("document.body.dataset.screen")], [True, "stages"])
    # 遊ぶ画面では、スタンプを出す（出さない設定が、残っていない）
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
    check("%s: フリープレイ: 土台は hud。スタンプの層は、出せる（none ではない）" % label, [consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval(STAMP_DISPLAY) != "none"], [True, "hud", True])
    # 遊びながら、メニュー・プリセットなどの上の画面を、開け閉めしても、一致する
    for name, opener, closer in (("プリセット", "document.querySelector('#btn-presets').click()", "document.querySelector('#pm-close').click()"),
                                  ("メロディの画面", "document.querySelector('#btn-studio').click()", "__app.studio.close()")):
        ch.eval(opener); time.sleep(0.5)
        ok_open = consistent(ch)
        ch.eval(closer); time.sleep(0.5)
        check("%s: フリープレイ: %sを開く・閉じる: どちらも、見えている画面と記録が一致" % (label, name), [ok_open, consistent(ch), ch.eval("document.body.dataset.screen"), ch.eval("__app.state")], [True, True, "hud", "play"])


def half_widths(ch):
    return ch.eval("""(() => { const g = (p) => { if (!p) return null; const b = p.group.userData.tile.geometry; b.computeBoundingBox(); return +(b.boundingBox.max.x - b.boundingBox.min.x).toFixed(2); };
      const s = __app.scene; return [3, 6].map((i) => [g(s.pieces[i]), g(s.pieces2[i])]); })()""")


def scenario_split(ch):
    """ 分割したマス: 自作コードを足す・編集する・消すと、全部の駒を描き直す。前半の駒が、正方形（1.34）にもどらない """
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
    ch.eval("(() => { const G = __app.game, t = __app.table; G.place(3, t.byName('Ⅱm7').id); G.placeAt(3, 'R', t.byName('Ⅴ7').id); G.place(6, t.byName('Ⅳ').id); G.placeAt(6, 'L', t.byName('Ⅰ').id); })()"); time.sleep(0.6)
    check("分割: 置いた直後は、前半・後半とも、半分の幅（0.62）。分けていないマスは 1.34", [half_widths(ch), ch.eval("[__app.game.board[4], __app.game.split.filter((x) => x !== null && x !== undefined).length]")[1]], [[[0.62, 0.62], [0.62, 0.62]], 2])
    ch.eval("window.__cid = __app.chordStore.addCustom({ notes: [52, 56, 60, 62, 67] }).id"); time.sleep(0.6)
    check("分割: 自作コードを足したあとも、前半は半分の幅のまま（報告の不具合: 正方形 1.34 にもどった）", half_widths(ch), [[0.62, 0.62], [0.62, 0.62]])
    ch.eval("__app.game.place(0, __app.table.byName('Ⅰ').id)"); time.sleep(0.4)
    ch.eval("__app.chordStore.addCustom({ notes: [48, 55, 59, 64] })"); time.sleep(0.5)
    check("分割: もう一つ足しても、分けていないマス（1番）の駒は、ふつうの幅 1.34・分けたマスは半分", ch.eval("""(() => { const g = (p) => { const b = p.group.userData.tile.geometry; b.computeBoundingBox(); return +(b.boundingBox.max.x - b.boundingBox.min.x).toFixed(2); }; return [g(__app.scene.pieces[0]), g(__app.scene.pieces[3]), g(__app.scene.pieces2[3])]; })()"""), [1.34, 0.62, 0.62])
    ch.eval("__app.chordStore.removeCustom(window.__cid)"); time.sleep(0.5)
    check("分割: 自作コードを消したあとも、分けたマスの前半・後半は、半分の幅のまま", half_widths(ch), [[0.62, 0.62], [0.62, 0.62]])


def scenario_guide_board(ch, w, h, portrait):
    """ チュートリアルの始まり（ガイドが開いている）で、盤が、ガイドの下にかくれない """
    ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')"); time.sleep(1.4)
    g = json.loads(ch.eval("""JSON.stringify((() => { const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const pts = [0, 3, 4, 7].map((i) => __app.scene.slotToScreen(i, 0.4));
      return { open: document.body.classList.contains('guide-open'), guide: r('#guide'), tray: r('#tray-wrap'), top: r('#topbar'), side: r('#side .score-card'), xs: pts.map((p) => p.x), ys: pts.map((p) => p.y) }; })())"""))
    label = "%dx%d" % (w, h)
    check("%s ガイド: チュートリアルの始まりに、ガイドが開く" % label, g["open"], True)
    if portrait:
        check("%s ガイド（縦）: 盤の8つのマスが、ガイドのシートの上・上のバーの下に見える（シートの下にかくれない）" % label, [min(g["ys"]) > g["top"]["b"], max(g["ys"]) < g["guide"]["t"]], [True, True])
        check("%s ガイド（縦）: 盤は、横にはみ出さない" % label, [min(g["xs"]) > 0, max(g["xs"]) < w], [True, True])
    else:
        check("%s ガイド（横）: ガイドの欄は、下のトレイの駒をかくさない（トレイの上で止まる）" % label, g["guide"]["b"] <= g["tray"]["t"] + 1, True)
        if w >= 800:
            check("%s ガイド（横）: 盤の駒が、ガイドの欄の右・得点の列の左に収まる" % label, [min(g["xs"]) - 20 >= g["guide"]["r"], max(g["xs"]) + 20 <= g["side"]["l"]], [True, True])
    ch.eval("document.querySelector('#guide-toggle').click()"); time.sleep(0.6)
    g2 = json.loads(ch.eval("""JSON.stringify((() => { const pts = [0, 3, 4, 7].map((i) => __app.scene.slotToScreen(i, 0.4)); const tw = document.querySelector('#tray-wrap').getBoundingClientRect(), tb = document.querySelector('#topbar').getBoundingClientRect();
      return { open: document.body.classList.contains('guide-open'), xs: pts.map((p) => p.x), ys: pts.map((p) => p.y), trayTop: tw.top, topBottom: tb.bottom }; })())"""))
    check("%s ガイドを閉じる: 盤は、上のバーとトレイのあいだに見える" % label, [g2["open"], min(g2["ys"]) > g2["topBottom"], max(g2["ys"]) < g2["trayTop"]], [False, True, True])
    if not portrait and w >= 800:
        check("%s ガイドを閉じる（横）: 盤は、ほぼ画面のまん中にもどる" % label, abs((min(g2["xs"]) + max(g2["xs"])) / 2 - w / 2) < 40, True)


def lab_row_xy(ch, midi, fx=0.5):
    """ コードの編集画面の、ある音の行の、画面の位置（指で押す場所）。その行が、見えるように、スクロールする """
    ch.eval("(() => { const lab = __app.chordLab, sc = document.querySelector('.cl-scroll'); sc.scrollTop = Math.max(0, (84 - %d) * lab.rh - sc.clientHeight / 2); })()" % midi)
    time.sleep(0.12)
    return ch.eval("(() => { const g = document.querySelector('.cl-grid').getBoundingClientRect(); const lab = __app.chordLab; return [g.left + g.width * %f, g.top + (84 - %d) * lab.rh + lab.rh / 2]; })()" % (fx, midi))


def scenario_lab_touch(ch):
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
    ch.eval("__app.chordLab.openNew()"); time.sleep(0.6)
    ch.eval("(() => { const lab = __app.chordLab; lab.s.notes = [57, 60, 64, 67, 71]; lab.s.sel = new Set(); lab.s.selected = null; lab.recompute(); })()"); time.sleep(0.3)
    check("編集画面（指）: 5つの音で始める", ch.eval("JSON.stringify(__app.chordLab.s.notes)"), "[57,60,64,67,71]")
    # ---- ふつうのモード: 空きを縦になぞる = スクロール。音は、置かない ----
    ch.eval("document.querySelector('.cl-scroll').scrollTop = 0"); time.sleep(0.15)
    x, y = ch.eval("(() => { const g = document.querySelector('.cl-grid').getBoundingClientRect(), sc = document.querySelector('.cl-scroll').getBoundingClientRect(); return [g.left + 3, sc.top + sc.height / 2]; })()")
    st0 = ch.eval("document.querySelector('.cl-scroll').scrollTop")
    ch.touch_drag(x, y + 90, x, y - 90, steps=14); time.sleep(0.7)
    check("編集画面（指）: 空いているところを縦になぞると、スクロールする（音は、置かれない）", ch.eval("[document.querySelector('.cl-scroll').scrollTop > %d + 30, __app.chordLab.s.notes.length]" % st0), [True, 5])
    check("編集画面（指）: ふつうのモードでは、グリッドは、縦のスクロールを、指にゆずる（touch-action: pan-y）", ch.eval("getComputedStyle(document.querySelector('.cl-grid')).touchAction"), "pan-y")
    # ---- 範囲選択のモード ----
    ch.eval("document.querySelector('#cl-selmode').click()"); time.sleep(0.2)
    check("編集画面（指）: 「範囲選択」を入れると、グリッドの touch-action が none（なぞって、四角でかこめる）", [ch.eval("__app.chordLab.selecting"), ch.eval("getComputedStyle(document.querySelector('.cl-grid')).touchAction")], [True, "none"])
    ch.eval("(() => { const lab = __app.chordLab, sc = document.querySelector('.cl-scroll'); sc.scrollTop = Math.max(0, (84 - 67) * lab.rh - sc.clientHeight / 2); })()"); time.sleep(0.15)
    g = ch.eval("(() => { const g = document.querySelector('.cl-grid').getBoundingClientRect(), lab = __app.chordLab; return [g.left, g.top, g.width, lab.rh]; })()")
    gl, gt, gw, rh = g
    x0, y0 = gl + 12, gt + (84 - 71) * rh + 1                       # 空き（音は、左右 6% のあきをあけて置かれる）。左はしから 12px 内側
    x1, y1 = gl + gw * 0.5, gt + (84 - 64) * rh + rh - 1
    check("編集画面（指）: 四角のはじまりは、空きの場所（音の上ではない）", ch.eval("(() => { const e = document.elementFromPoint(%f, %f); return !!(e && e.closest('.cl-grid') && !e.closest('.cl-note')); })()" % (x0, y0)), True)
    ch.touch_drag(x0, y0, x1, y1, steps=14); time.sleep(0.5)
    check("編集画面（指）: 四角でかこむと、ふれた3つの音（71・67・64）が選ばれる", ch.eval("JSON.stringify([...__app.chordLab.s.sel].sort((a, b) => a - b))"), "[64,67,71]")
    check("編集画面（指）: かこんだあとも、音の数は、そのまま（置かれていない）", ch.eval("__app.chordLab.s.notes.length"), 5)
    ch.eval("document.querySelector('#cl-del').click()"); time.sleep(0.3)
    check("編集画面（指）: 選んだ音を「消す」と、まとめて消える", ch.eval("JSON.stringify(__app.chordLab.s.notes)"), "[57,60]")
    ch.eval("document.querySelector('#cl-selmode').click()"); time.sleep(0.2)
    check("編集画面（指）: 「範囲選択」を切ると、touch-action: pan-y にもどる", [ch.eval("__app.chordLab.selecting"), ch.eval("getComputedStyle(document.querySelector('.cl-grid')).touchAction")], [False, "pan-y"])
    ch.eval("document.querySelector('#cl-close').click()"); time.sleep(0.4)


def studio_view(ch, slot, midi):
    """ メロディの画面: (マス, 音の高さ) が、画面の中ほどに来るようにスクロールして、その位置（画面の座標）を返す """
    ch.eval("""(() => { const s = __app.studio, sc = s.el.scroll; sc.scrollTop = Math.max(0, (96 - %d) * s.rh + s.el.head.offsetHeight - sc.clientHeight / 2);
      sc.scrollLeft = Math.max(0, (%d + 0.5) * s.cw + s.el.keys.offsetWidth - sc.clientWidth / 2); })()""" % (midi, slot))
    time.sleep(0.15)
    x, y = ch.eval("(() => { const s = __app.studio, r = s.el.grid.getBoundingClientRect(); return [r.left + (%d + 0.5) * s.cw, r.top + (96 - %d + 0.5) * s.rh]; })()" % (slot, midi))
    hit = ch.eval("(() => { const e = document.elementFromPoint(%f, %f); return !!(e && e.closest('.ms-grid')); })()" % (x, y))
    return x, y, hit


def scenario_studio_touch(ch):
    ch.eval("__app.startStage(__free(), 'free')"); time.sleep(0.8)
    ch.eval("(() => { __app.game.clear(); const G = __app.game, t = __app.table; ['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅴ7'].forEach((n, i) => G.place(i, t.byName(n).id)); })()"); time.sleep(0.5)
    ch.eval("document.querySelector('#btn-studio').click()"); time.sleep(0.8)
    check("メロディの画面（指）: 開く", ch.eval("__app.state"), "studio")
    ch.eval("(() => { const d = __app.studio.doc; d.clear(); d.add(8, 8, 62); d.add(16, 8, 64); d.add(32, 8, 67); })()"); time.sleep(0.4)
    check("メロディの画面（指）: 3つの音で始める", ch.eval("__app.studio.doc.count"), 3)
    # ---- ふつうのモード: 空きを横になぞる = スクロール。音は、置かない ----
    x, y, hit = studio_view(ch, 40, 72)
    check("メロディの画面（指）: 空きの場所は、指で押せる（グリッドに当たる）", hit, True)
    sl0 = ch.eval("__app.studio.el.scroll.scrollLeft")
    ch.touch_drag(x + 100, y, x - 100, y, steps=14); time.sleep(0.7)
    check("メロディの画面（指）: 空いているところを横になぞると、スクロールする（音は、置かれない）", ch.eval("[__app.studio.el.scroll.scrollLeft > %d + 30, __app.studio.doc.count]" % sl0), [True, 3])
    check("メロディの画面（指）: ふつうのモードでは、グリッドは、なぞりを指にゆずる（touch-action: pan-x pan-y）", ch.eval("getComputedStyle(document.querySelector('.ms-grid')).touchAction"), "pan-x pan-y")
    # ---- 空きのタップ = 音を置く ----
    x, y, hit = studio_view(ch, 48, 70)
    ch.tap(x, y); time.sleep(0.4)
    check("メロディの画面（指）: 空きをタップすると、音が1つ置かれる", ch.eval("[__app.studio.doc.count, __app.studio.doc.items.some((it) => it.m === 70 && it.s >= 44 && it.s <= 48)]"), [4, True])
    ch.eval("(() => { const s = __app.studio; s.doc.remove(s.doc.items.find((it) => it.m === 70).id); })()"); time.sleep(0.2)
    # ---- 範囲選択のモード ----
    ch.eval("document.querySelector('#ms-selmode').click()"); time.sleep(0.2)
    check("メロディの画面（指）: 「範囲選択」を入れると、グリッドの touch-action が none", [ch.eval("__app.studio.selecting"), ch.eval("getComputedStyle(document.querySelector('.ms-grid')).touchAction")], [True, "none"])
    ch.eval("(() => { const s = __app.studio, sc = s.el.scroll; sc.scrollTop = Math.max(0, (96 - 64) * s.rh + s.el.head.offsetHeight - sc.clientHeight / 2); sc.scrollLeft = Math.max(0, 16 * s.cw + s.el.keys.offsetWidth - sc.clientWidth / 2); })()"); time.sleep(0.2)
    gl, gt, cw, rh, vis = ch.eval("(() => { const s = __app.studio, r = s.el.grid.getBoundingClientRect(), sc = s.el.scroll.getBoundingClientRect(); return [r.left, r.top, s.cw, s.rh, sc.left + s.el.keys.offsetWidth]; })()")
    x0, y0 = vis + 16, gt + (96 - 66) * rh + 1                      # 空き（見えている左はし = 鍵盤の列のとなりから 16px 内側。8マス目より左・62 と 64 の上）
    x1, y1 = gl + 20 * cw, gt + (96 - 61) * rh - 1                  # 62 と 64 をかこむ（67 は、かこまない）
    hit0 = ch.eval("(() => { const e = document.elementFromPoint(%f, %f); return !!(e && e.closest('.ms-grid') && !e.closest('.ms-note')); })()" % (x0, y0))
    check("メロディの画面（指）: 四角のはじまりは、空きの場所（音の上ではない）", hit0, True)
    ch.touch_drag(x0, y0, x1, y1, steps=14); time.sleep(0.5)
    ids = ch.eval("JSON.stringify([...__app.studio.sel].map((id) => __app.studio.doc.item(id).m).sort((a, b) => a - b))")
    check("メロディの画面（指）: 四角でかこむと、ふれた2つの音（62・64）が選ばれる。音は増えない", [ids, ch.eval("__app.studio.doc.count")], ["[62,64]", 3])
    ch.eval("document.querySelector('#ms-selmode').click()"); time.sleep(0.2)
    # ---- まとめて動かす（ふつうのモードで、選んだ音の1つを、指でドラッグ）----
    before = ch.eval("JSON.stringify(__app.studio.doc.items.map((it) => [it.id, it.s, it.m]))")
    x, y, hit = studio_view(ch, 20, 64)
    # 64 の音（16〜24マス）の、まん中あたりから、右へ 2マスぶん、動かす
    sx, sy = ch.eval("(() => { const s = __app.studio, r = s.el.grid.getBoundingClientRect(); return [r.left + 18 * s.cw, r.top + (96 - 64 + 0.5) * s.rh]; })()")
    ch.touch_drag(sx, sy, sx + 2 * ch.eval("__app.studio.cw"), sy, steps=10); time.sleep(0.5)
    after = json.loads(ch.eval("JSON.stringify(__app.studio.doc.items.map((it) => [it.id, it.s, it.m]))"))
    b = {i: (s, m) for i, s, m in json.loads(before)}
    moved = sorted((a[1] - b[a[0]][0]) for a in after if a[2] in (62, 64))
    still = [a[1] - b[a[0]][0] for a in after if a[2] == 67]
    check("メロディの画面（指）: 選んだ2つの音を、指でドラッグすると、まとめて同じだけ動く。選んでいない音は、動かない", [len(set(moved)) == 1 and moved[0] > 0, still], [True, [0]])
    ch.eval("__app.studio.close()"); time.sleep(0.4)


def main():
    if not chrome_available():
        print("（第8弾のスマホ表示のテストは、Chrome が見つからないので省略）")
        return 0
    srv, port = serve()
    try:
        # ============ ① スタンプ・画面の記録（音あり。縦・横）============
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            scenario_stamps(ch, "縦 390x844")
        with ChromeSession(width=844, height=390, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=True)
            scenario_stamps(ch, "横 844x390")
        # ============ ② 分割したマスの駒（PC・スマホ）============
        with ChromeSession(width=1280, height=720) as ch:
            open_game(ch, port, audio=False)
            scenario_split(ch)
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            scenario_split(ch)
        # ============ ③ ガイドを開いているあいだの、盤の位置 ============
        for (w, h, portrait) in ((390, 844, True), (375, 667, True), (430, 932, True), (844, 390, False), (932, 430, False)):
            with ChromeSession(width=w, height=h, mobile=True, dpr=2, touch=True, ua=UA) as ch:
                open_game(ch, port, audio=False)
                scenario_guide_board(ch, w, h, portrait)
        # ============ ④ 指の操作（編集画面）============
        with ChromeSession(width=390, height=844, mobile=True, dpr=2, touch=True, ua=UA) as ch:
            open_game(ch, port, audio=False)
            scenario_lab_touch(ch)
            scenario_studio_touch(ch)
    finally:
        srv.shutdown()
    print("test_round8_ui: checks=%d fails=%d" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
