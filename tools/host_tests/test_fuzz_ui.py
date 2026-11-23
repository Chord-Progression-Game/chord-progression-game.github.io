#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
画面の「でたらめ操作」のテスト（2026-11-23）。ボタン・メニュー・駒の操作・画面の切り替えを、でたらめな順番で大量にくり返して、
いつも守られているはずの決まり（不変条件）が、こわれないかを調べる。人が思いつかない組み合わせで起きる不具合（開いた画面が閉じない・結果が出ない・
画面と中身がずれる…）を、見つけるための道具。種（seed）を決めてあるので、同じ操作が再現できる。失敗したら、直前の操作の記録を出す。
  確かめる決まり:
    ・JS のエラーがない
    ・開いている画面（モーダル）は、同時に 1つだけ。「開いている」と覚えている状態と、画面の見え方が一致する（以前は、結果の画面が重なると、ずれた）
    ・遊ぶ画面（play）のときは、モーダルが出ていない / タイトル・ステージ選択のときは、その画面が出ている
    ・盤の中身と 3D の駒が一致する（分割したマスの後半も）/ 分割したマスの決まり（空きは分けない・前半と後半は別の駒）
    ・クリアの結果が出るはずの時刻をすぎても、出ていない（別の画面を開いていないのに）ことがない
    ・知らせ（トースト）が、積み上がりすぎない
実行:  python3 tools/host_tests/test_fuzz_ui.py [操作の回数（既定 260）] [seed]
Chrome がなければ、省略する（終了コード 0）。
"""
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, open_game  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

PIECES = ["Ⅰ", "Ⅳ", "Ⅴ", "Ⅵm", "ⅠM7", "Ⅱm", "Ⅲm", "ⅣM7", "Ⅴ7", "Ⅵm7", "Ⅱm7", "Ⅲm7", "Ⅲ7", "Ⅵ7", "Ⅱ♭7", "Ⅳm7", "Ⅴsus47", "→"]

INVARIANTS = r"""
(() => {
  const bad = [];
  const A = window.__app, g = A.game;
  if ((window.__errors || []).length) bad.push('JS のエラー: ' + window.__errors.slice(-2).join(' / '));
  const modals = [...document.querySelectorAll('.screen.modal')].filter((e) => !e.classList.contains('hidden'));
  if (modals.length > 1) bad.push('モーダルが同時に ' + modals.length + ' つ出ている: ' + modals.map((e) => e.id).join(','));
  const vis = (id) => !document.querySelector('#' + id).classList.contains('hidden');
  const pairs = [['trickdetail', A.trickDetail.isOpen], ['presets', A.presetMenu.isOpen], ['studio', A.studio.isOpen], ['chordlab', A.chordLab.isOpen], ['libimport', A.libImport.isOpen]];
  for (const [id, open] of pairs) if (open !== vis(id)) bad.push(id + ': 「開いている」と覚えている状態（' + open + '）と、見え方（' + vis(id) + '）がちがう');
  if (A.state === 'play' && modals.length) bad.push('遊ぶ画面（play）なのに、モーダルが出ている: ' + modals.map((e) => e.id).join(','));
  if (A.state === 'title' && !vis('title')) bad.push('state=title なのに、タイトルが出ていない');
  if (A.state === 'stages' && !vis('stages')) bad.push('state=stages なのに、選ぶ画面が出ていない');
  if (A.state === 'pause' && !vis('pause')) bad.push('state=pause なのに、メニューが出ていない');
  if (A.state === 'result' && !vis('result')) bad.push('state=result なのに、結果の画面が出ていない');
  if (A.state !== 'result' && vis('result') && A.state !== 'splash') bad.push('結果の画面が出ているのに、state=' + A.state);
  if (!['splash', 'title', 'stages', 'play', 'pause', 'result', 'presets', 'studio', 'chordlab', 'trickdetail', 'libimport'].includes(A.state)) bad.push('知らない状態: ' + A.state);
  // 盤の決まり
  for (let i = 0; i < 8; i++) {
    const f = g.board[i], s = g.split[i];
    if (s !== null && s !== undefined && (f === null || f === undefined || f === A.table.repeatId)) bad.push('分割の決まり: ' + (i + 1) + '番が空き・「→」なのに、後半がある');
    if (s !== null && s !== undefined && s === f) bad.push('分割の決まり: ' + (i + 1) + '番の前半と後半が、同じ駒');
    const p1 = A.scene.pieces[i], p2 = A.scene.pieces2[i];
    const want1 = f !== null && f !== undefined ? A.table.byId(f) : null, want2 = s !== null && s !== undefined ? A.table.byId(s) : null;
    if ((p1 ? p1.chord : null) !== (want1 || null)) bad.push('3D と盤がちがう: ' + (i + 1) + '番の前半（盤 ' + (want1 && want1.name) + ' / 3D ' + (p1 && p1.chord.name) + '）');
    if ((p2 ? p2.chord : null) !== (want2 || null)) bad.push('3D と盤がちがう: ' + (i + 1) + '番の後半（盤 ' + (want2 && want2.name) + ' / 3D ' + (p2 && p2.chord.name) + '）');
    if (p1 && want2 && !p1.half) bad.push('3D: ' + (i + 1) + '番は分割しているのに、前半の駒が、半分の大きさでない');
    if (p1 && !want2 && p1.half) bad.push('3D: ' + (i + 1) + '番は分割していないのに、前半の駒が、半分の大きさ');
  }
  // クリアの結果が出るはずなのに出ていない
  if (A.clearPending && A.clearPending === g.stage && g.cleared && A.state === 'play' && performance.now() > (A.clearDueAt || 0) + 2500 && !vis('result') && document.querySelector('#clear-bar').classList.contains('hidden')) bad.push('クリアの結果が、出るはずの時刻をすぎても、出ていない');
  if (document.querySelectorAll('#toasts .toast').length > 4) bad.push('知らせが積み上がっている: ' + document.querySelectorAll('#toasts .toast').length);
  return JSON.stringify(bad);
})()
"""


def actions(rng, phone):
    """ 操作の一覧: (重み, 名前, JS) を返す関数のリスト。JS は、ページの中で実行する """
    def piece():
        return rng.choice(PIECES)

    def slot():
        return rng.randrange(8)

    def js_place():
        return "(() => { const g = __app.game, t = __app.table; const c = t.byName(%r); if (c) g.place(%d, c.id); return 1; })()" % (piece(), slot())

    def js_place_at():
        return "(() => { const g = __app.game, t = __app.table; const c = t.byName(%r); if (c) g.placeAt(%d, %r, c.id); return 1; })()" % (piece(), slot(), rng.choice("LRC"))

    def js_remove():
        h = rng.choice(["null", "0", "1"])
        return "(() => { __app.game.remove(%d, { half: %s }); return 1; })()" % (slot(), h)

    def js_move():
        return "(() => { __app.game.moveFromBoard(%d, %s, %d, %r); return 1; })()" % (slot(), rng.choice(["null", "0", "1"]), slot(), rng.choice("LRC"))

    def js_start():
        kind = rng.choice(["tutorial", "free", "challenge", "trial", "melody"])
        if kind == "tutorial":
            return "(() => { __app.save.unlockAll = true; __app.startStage(__stages[%d], 'tutorial'); return 1; })()" % rng.randrange(14)
        if kind == "trial":
            return "(() => { __app.save.unlockAll = true; __app.startStage(__trials[%d], 'trial'); return 1; })()" % rng.randrange(9)
        if kind == "melody":
            return "(() => { __app.startStage(__melodies[%d], 'melody'); return 1; })()" % rng.randrange(5)
        if kind == "challenge":
            return "(() => { __app.startStage(__challenge(), 'challenge'); return 1; })()"
        return "(() => { __app.startStage(__free(), 'free'); return 1; })()"

    def js_click(sel):
        return "(() => { const e = document.querySelector(%r); if (e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none') e.click(); return 1; })()" % sel

    def js_key(k):
        return "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: %r, bubbles: true })); return 1; })()" % k

    base = [
        (14, "駒を置く", js_place), (8, "左右に置く", js_place_at), (5, "はずす", js_remove), (4, "動かす", js_move),
        (3, "全部消す", lambda: js_click('#btn-clear')),
        (5, "ステージを始める", js_start),
        (2, "タイトルへ", lambda: "(() => { __app.showTitle(); return 1; })()"),
        (2, "チュートリアルを選ぶ", lambda: "(() => { __app.showStages(); return 1; })()"),
        (1, "メロディーを選ぶ", lambda: "(() => { __app.showMelodies(); return 1; })()"),
        (1, "チャレンジステージを選ぶ", lambda: "(() => { __app.showTrials(); return 1; })()"),
        (4, "メニュー", lambda: js_click('#btn-menu')),
        (3, "メニュー: つづける", lambda: js_click('#pause [data-act=resume]')),
        (1, "メニュー: やりなおす", lambda: js_click('#pause [data-act=restart]')),
        (1, "メニュー: 選ぶ", lambda: js_click('#pause [data-act=stages]')),
        (4, "技の詳細を開く", lambda: "(() => { const i = (__app.game.analysis.instances || [])[0]; if (i && __app.state === 'play') __app.trickDetail.show(i); return 1; })()"),
        (3, "技の詳細を閉じる", lambda: "(() => { __app.trickDetail.close(); return 1; })()"),
        (3, "プリセットを開く", lambda: js_click('#btn-presets')),
        (2, "プリセットを閉じる", lambda: "(() => { __app.presetMenu.close(); return 1; })()"),
        (2, "メロディの画面を開く", lambda: js_click('#btn-studio')),
        (2, "メロディの画面を閉じる", lambda: "(() => { __app.studio.close(); return 1; })()"),
        (2, "コードの編集を開く", lambda: "(() => { if (__app.state === 'play' && __app.game.mode === 'free') __app.chordLab.openNew(); return 1; })()"),
        (2, "コードの編集を閉じる", lambda: "(() => { __app.chordLab.close(); return 1; })()"),
        (2, "取り込みを開く", lambda: "(() => { __app.libImport.open(); return 1; })()"),
        (2, "取り込みを閉じる", lambda: "(() => { __app.libImport.close(); return 1; })()"),
        (3, "音のメニュー", lambda: js_click('#btn-soundmenu')),
        (3, "音量のメニュー", lambda: js_click('#btn-sound')),
        (3, "Esc", lambda: js_key('Escape')),
        (1, "スペース", lambda: js_key(' ')),
        (2, "ヒント", lambda: js_click('#btn-hint')),
        (1, "演奏", lambda: js_click('#btn-play')),
        (1, "BPM", lambda: js_click(rng.choice(['#bpm-up', '#bpm-down']))),
        (2, "技のシート", lambda: js_click('#btn-side-toggle')),
        (2, "ガイドのシート", lambda: js_click('#btn-guide-toggle')),
        (2, "メロディ: 採点", lambda: js_click('#btn-melody-done')),
        (2, "チャレンジステージ: 提出", lambda: js_click('#btn-trial-done')),
        (2, "タイムアップ", lambda: "(() => { if (__app.game.mode === 'challenge' && __app.game.timerRunning) __app.game.timeLeft = 0.03; return 1; })()"),
        (2, "クリアを早める", lambda: "(() => { __app.clearDelayOverride = %d; return 1; })()" % rng.choice([100, 400, 900])),
        (2, "結果のボタン", lambda: "(() => { const bs = [...document.querySelectorAll('#result-btns button')]; if (bs.length) bs[%d %% bs.length].click(); return 1; })()" % rng.randrange(4)),
        (1, "クリアの欄", lambda: js_click(rng.choice(['#btn-clear-result', '#btn-clear-next']))),
        (1, "コードを編集（ボタン）", lambda: js_click('#btn-chord-edit')),
    ]
    return base


def pick(rng, acts):
    total = sum(w for w, _, _ in acts)
    r = rng.uniform(0, total)
    for w, n, f in acts:
        r -= w
        if r <= 0:
            return n, f()
    return acts[-1][1], acts[-1][2]()


def run_one(label, w, h, mobile, n_actions, seed, port):
    rng = random.Random(seed)
    fails = []
    log = []
    kw = dict(width=w, height=h)
    if mobile:
        kw.update(mobile=True, dpr=2, touch=True, ua=UA)
    with ChromeSession(**kw) as ch:
        open_game(ch, port, audio=False)
        ch.eval("__app.clearDelayOverride = 600; true")
        acts = actions(rng, mobile)
        for i in range(n_actions):
            name, js = pick(rng, acts)
            log.append(name)
            try:
                ch.eval(js)
            except RuntimeError as e:
                fails.append((i, name, "操作の途中で例外: " + str(e)[:200]))
                break
            time.sleep(rng.choice([0.02, 0.05, 0.1, 0.2, 0.45]))
            bad = json.loads(ch.eval(INVARIANTS))
            if bad:
                fails.append((i, name, "; ".join(bad)))
                break
        # 最後に、少し待って、もう一度（遅れて起きる不具合）
        if not fails:
            time.sleep(2.8)
            bad = json.loads(ch.eval(INVARIANTS))
            if bad:
                fails.append((n_actions, "（最後に待ったあと）", "; ".join(bad)))
    return fails, log


def main():
    if not chrome_available():
        print("（でたらめ操作のテストは、Chrome が見つからないので省略）")
        return 0
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 260
    seed0 = int(sys.argv[2]) if len(sys.argv) > 2 else 20261123
    srv, port = serve()
    total_fail = 0
    try:
        for label, w, h, mobile, seed in [("PC", 1280, 720, False, seed0), ("スマホ縦", 390, 844, True, seed0 + 1), ("スマホ横", 844, 390, True, seed0 + 2), ("タブレット縦", 768, 1024, True, seed0 + 3)]:
            fails, log = run_one(label, w, h, mobile, n, seed, port)
            if fails:
                total_fail += 1
                i, name, msg = fails[0]
                print("FAIL [%s seed=%d] 操作 %d「%s」のあと: %s" % (label, seed, i, name, msg))
                print("   直前の操作: " + " → ".join(log[-14:]))
            else:
                print("ok   [%s seed=%d] %d 回の操作で、決まりは、こわれなかった" % (label, seed, n))
    finally:
        srv.shutdown()
    print("でたらめ操作: %d 通り中 %d 通り 失敗" % (4, total_fail))
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main())
