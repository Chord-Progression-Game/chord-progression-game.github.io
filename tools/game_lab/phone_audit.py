#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
スマホ（iPhone など）の画面を、全部の場面で撮って、レイアウトの不具合を自動で探す道具（2026-11-23）。
  ・縦持ち・横持ち・小さい画面で、ゲームの全部の画面（タイトル・ステージ選択・遊ぶ画面・メニュー・編集画面・結果…）を、本物の Chrome のスマホ表示で撮る
  ・撮るたびに、ページの中で「点検」を走らせる:
      vertical-text … 1文字ずつ縦に折り返された文字（幅が文字の大きさの2.4倍より狭いのに、高さがある）
      offscreen     … 画面の外にはみ出した部品（横になぞる入れ物の中は除く）
      overlap       … 大きな部品どうしの重なり（上のバー・得点・メロディの帯・手順の帯・ガイド・クリアの欄・トレイ・スタンプ・通知・メニュー）
      tiny-target   … 指で押すには小さい（28px 未満）ボタン
      tiny-text     … 小さすぎる文字（9.5px 未満）
      page-scroll   … ページ全体が横にはみ出している
  ・撮った画像は、4枚ずつ 1枚の見本（contact sheet）にまとめる（目で見るときの手間を減らす）
  ※ 本物の iPhone（Safari）では動かしていない。Chrome のスマホ表示（幅・タッチ・ユーザーエージェント）での確認
使い方:
    python3 tools/game_lab/phone_audit.py 出力フォルダ [--sizes 390x844,375x667,844x390] [--only 名前の一部]
終了コード: 不具合が見つかれば 1
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools", "host_tests"))
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
from game_driver import serve, open_game  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

LINT_JS = r"""
(() => {
  const vw = innerWidth, vh = innerHeight, issues = [];
  const desc = (el) => el.id ? '#' + el.id : ((typeof el.className === 'string' && el.className.trim()) ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase());
  const textOf = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
  const shown = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; } return true; };
  const hScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  const root = document.querySelector('#ui');
  for (const el of root.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize), txt = textOf(el);
    if (txt.length >= 3 && r.width < fs * 2.4 && r.height > fs * 2.4 && !/^[0-9.+−-]+$/.test(txt) && !/vertical/.test(cs.writingMode)) issues.push({ t: 'vertical-text', el: desc(el), text: txt.slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) });
    if (txt.length >= 1 && fs < 9.5 && !el.closest('.mr-no, .col-dot')) issues.push({ t: 'tiny-text', el: desc(el), text: txt.slice(0, 12), fs: Math.round(fs * 10) / 10 });
    const isBtn = el.tagName === 'BUTTON' || (typeof el.className === 'string' && /(^|\s)(chip|mini|pcadd)(\s|$)/.test(el.className));
    if (isBtn && (r.width < 28 || r.height < 28) && !el.closest('.cl-note, .ms-note, .mr-col')) issues.push({ t: 'tiny-target', el: desc(el), text: (el.textContent || '').trim().slice(0, 10), w: Math.round(r.width), h: Math.round(r.height) });
    if ((r.right > vw + 2 || r.left < -2) && !hScroller(el) && (txt || isBtn) && cs.pointerEvents !== 'none' && !el.closest('#stamp-layer')) issues.push({ t: 'offscreen', el: desc(el), text: (txt || el.textContent || '').trim().slice(0, 12), left: Math.round(r.left), right: Math.round(r.right), vw });
  }
  if (document.documentElement.scrollWidth > vw + 1) issues.push({ t: 'page-scroll', sw: document.documentElement.scrollWidth, vw });
  // 画面の文字に、うっかり「null」「undefined」「NaN」「[object …]」が出ていない
  { const m = /(^|[^A-Za-z0-9_])(null|undefined|NaN)([^A-Za-z0-9_]|$)|\[object /.exec(document.querySelector('#ui').innerText || ''); if (m) issues.push({ t: 'stray-text', text: m[0].trim() }); }
  // 大きな部品どうしの重なり
  const BLOCKS = ['#topbar', '#side .score-card', '#melody-roll', '#step-bar', '#guide', '#clear-bar', '#tray-wrap', '#stamp-layer .stamp', '#toasts .toast', '.soundmenu', '#side'];
  const rects = [];
  for (const sel of BLOCKS) for (const el of document.querySelectorAll(sel)) { if (!shown(el)) continue; const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue; if (sel === '#side' && !document.body.classList.contains('side-open')) continue; rects.push({ sel, el, r }); }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w <= 6 || h <= 6) continue;
    const area = w * h, small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
    if ((a.sel === '.soundmenu' || b.sel === '.soundmenu') && [a.sel, b.sel].some((x) => x === '#tray-wrap' || x === '#toasts .toast')) continue;      // 音のメニュー（シート）が、トレイ・知らせの上に出るのは、設計どおり
    if (area / small > 0.12) issues.push({ t: 'overlap', a: a.sel, b: b.sel, pct: Math.round(100 * area / small) });
  }
  return JSON.stringify(issues);
})()
"""

SHEET_HTML = """<!doctype html><meta charset=utf-8><style>body{margin:0;background:#222;font:12px sans-serif;color:#eee}
.row{display:flex;gap:8px;padding:8px}.c{flex:none}.c img{display:block;width:%dpx;border:1px solid #555}.c div{padding:2px 0}</style><div class=row>%s</div>"""


def sheet(paths, labels, out, width):
    cells = "".join('<div class=c><img src="file://%s"><div>%s</div></div>' % (p, l) for p, l in zip(paths, labels))
    html = os.path.join(os.path.dirname(out), "_sheet.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write(SHEET_HTML % (width, cells))
    total = (width + 10) * len(paths) + 16
    with ChromeSession(width=total, height=1200, dpr=1) as ch:
        ch.open("file://" + html)
        time.sleep(0.8)
        h = int(ch.eval("document.body.scrollHeight") or 900)
        ch.cdp.call("Emulation.setDeviceMetricsOverride", {"width": total, "height": h, "deviceScaleFactor": 1, "mobile": False})
        time.sleep(0.4)
        ch.screenshot(out)
    os.remove(html)


class Audit:
    def __init__(self, out, width, height, only=None):
        self.out, self.width, self.height, self.only = out, width, height, only
        self.shots = []
        self.problems = []

    def snap(self, ch, name, note=""):
        if self.only and self.only not in name:
            return
        time.sleep(0.35)
        import json
        issues = json.loads(ch.eval(LINT_JS) or "[]")
        groups = {}
        for it in issues:
            key = (it["t"], it.get("el") or "%s|%s" % (it.get("a"), it.get("b")))
            if key in groups:
                groups[key]["n"] += 1
            else:
                groups[key] = dict(it, n=1)
        uniq = list(groups.values())
        path = os.path.join(self.out, "%s_%dx%d.png" % (name, self.width, self.height))
        ch.screenshot(path)
        self.shots.append((path, name))
        for it in uniq:
            self.problems.append((name, it))
        print("  %-26s 点検: %s" % (name, "ok" if not uniq else "%d 件" % len(uniq)))


def run_size(w, h, out, only):
    a = Audit(out, w, h, only)
    srv, port = serve()
    with ChromeSession(width=w, height=h, mobile=True, dpr=2, touch=True, ua=UA) as ch:
        ch.open("http://127.0.0.1:%d/index.html" % port)
        ch.wait_for("window.__ready === true && window.__frames > 5", timeout=60)
        a.snap(ch, "01_splash")
        ch.eval("__app.begin(false).then(() => true)")
        ch.wait_for("__app.state === 'title'", timeout=60)
        # タイトル: デモで技が決まった瞬間
        for _ in range(16):
            if ch.eval("document.querySelectorAll('#stamp-layer > *').length"):
                break
            time.sleep(0.7)
        a.snap(ch, "02_title_demo")
        ch.eval("__app.showStages()")
        a.snap(ch, "03_tutorial_select")
        ch.eval("__app.showMelodies()")
        a.snap(ch, "04_melody_select")
        if ch.eval("typeof __app.showTrials === 'function'"):
            ch.eval("__app.showTrials()")
            a.snap(ch, "05_trial_select")
        # 取り込みの画面（公開ページ用）
        ch.eval("__app.libImport.open()")
        a.snap(ch, "06_import_dialog")
        ch.eval("__app.libImport.close()")
        # 使い方の画面（動く図。10ページ。第10弾）
        for k in range(int(ch.eval("__app.howto.pages.length"))):
            ch.eval("__app.howto.close(); __app.howto.open(%d)" % k)
            a.snap(ch, "07_howto_%02d" % (k + 1))
        ch.eval("__app.howto.close()")
        # チュートリアル
        ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
        time.sleep(0.8)
        a.snap(ch, "10_tutorial_guide_open")
        ch.eval("document.querySelector('#guide-toggle').click()")
        a.snap(ch, "11_tutorial_guide_closed")
        # フリープレイ
        ch.eval("__app.startStage(__free(), 'free')")
        time.sleep(0.8)
        a.snap(ch, "20_free_empty")
        ch.eval("(()=>{const t=__app.table; ['ⅣM7','Ⅴ7','Ⅲm7','Ⅵm7','Ⅱm7','Ⅴ7','ⅠM7','Ⅰ'].forEach((n,i)=>__app.game.place(i,t.byName(n).id)); return true})()")
        time.sleep(0.8)
        a.snap(ch, "21_free_full")
        ch.eval("(()=>{const t=__app.table; __app.game.placeAt(1,'R',t.byName('Ⅲ7').id); __app.game.placeAt(3,'L',t.byName('Ⅱm7').id); return true})()")
        time.sleep(0.6)
        a.snap(ch, "21b_free_split")
        ch.eval("document.querySelector('#btn-side-toggle').click()")
        a.snap(ch, "22_free_side_open")
        ch.eval("document.querySelector('#btn-side-toggle').click()")
        ch.eval("document.querySelector('#btn-hint').click()")
        a.snap(ch, "23_free_hints")
        ch.eval("document.querySelector('#btn-hint').click()")
        ch.eval("__app.game.clear()")
        ch.eval("document.querySelector('#btn-soundmenu').click()")
        a.snap(ch, "30_soundmenu")
        ch.eval("document.querySelector('#btn-soundmenu').click()")
        ch.eval("document.querySelector('#btn-sound').click()")
        a.snap(ch, "31_volumemenu")
        ch.eval("document.querySelector('#btn-sound').click()")
        ch.eval("document.querySelector('#btn-menu').click()")
        a.snap(ch, "32_pause")
        ch.eval("document.querySelector('#pause [data-act=resume]').click()")
        ch.eval("__app.presetMenu.open()")
        a.snap(ch, "40_presets")
        ch.eval("__app.presetMenu.close()")
        ch.eval("__app.studio.open()")
        a.snap(ch, "41_melody_studio")
        ch.eval("__app.studio.close()")
        ch.eval("__app.chordLab.openNew()")
        a.snap(ch, "42_chord_lab")
        ch.eval("__app.chordLab.close()")
        ch.eval("(()=>{const t=__app.table; ['ⅣM7','Ⅴ7','Ⅲm7','Ⅵm7'].forEach((n,i)=>__app.game.place(i,t.byName(n).id)); return true})()")
        time.sleep(0.6)
        ch.eval("(()=>{const i=__app.game.analysis.instances[0]; if (i) __app.trickDetail.show(i); return true})()")
        a.snap(ch, "43_trick_detail")
        ch.eval("__app.trickDetail.close()")
        # メロディのステージ
        ch.eval("__app.startStage(__melodies[2], 'melody')")
        time.sleep(1.0)
        a.snap(ch, "50_melody_stage")
        ch.eval("(()=>{const t=__app.table; ['Ⅵm','Ⅳ','Ⅰ','Ⅴ','Ⅵm','Ⅳ','Ⅰ','Ⅴ'].forEach((n,i)=>__app.game.place(i,t.byName(n).id)); return true})()")
        time.sleep(0.6)
        a.snap(ch, "51_melody_stage_full")
        ch.eval("document.querySelector('#btn-melody-done').click()")
        time.sleep(0.5)
        a.snap(ch, "52_melody_result")
        # チャレンジ（タイムアタック）
        ch.eval("__app.startStage(__challenge(), 'challenge')")
        time.sleep(0.8)
        ch.eval("(()=>{const t=__app.table; ['ⅣM7','Ⅴ7','Ⅲm7','Ⅵm7'].forEach((n,i)=>__app.game.place(i,t.byName(n).id)); return true})()")
        a.snap(ch, "60_timeattack")
        ch.eval("__app.game.timeLeft = 0.05")
        time.sleep(0.8)
        a.snap(ch, "61_timeattack_result")
        # チャレンジステージ（新）
        if ch.eval("Array.isArray(window.__trials) && window.__trials.length > 0"):
            ch.eval("__app.startStage(__trials[0], 'trial')")
            time.sleep(0.9)
            a.snap(ch, "70_trial_stage")
            ch.eval("document.querySelector('#btn-guide-toggle').click()")
            a.snap(ch, "71_trial_guide")
        # チュートリアルのクリア画面
        ch.eval("__app.clearDelayOverride = 300")
        ch.eval("__app.startStage(__stages.find(s => s.id === 't01'), 'tutorial')")
        time.sleep(0.6)
        ch.eval("(()=>{const t=__app.table; __app.game.place(1,t.byName('ⅣM7').id); __app.game.place(2,t.byName('Ⅴ7').id); __app.game.place(3,t.byName('Ⅰ').id); return true})()")
        time.sleep(1.4)
        a.snap(ch, "80_clear_result")
    srv.shutdown()
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--sizes", default="390x844,375x667,430x932,844x390")
    ap.add_argument("--only", default=None)
    ap.add_argument("--sheet", type=int, default=4, help="見本（contact sheet）に並べる枚数")
    args = ap.parse_args()
    if not chrome_available():
        print("（Chrome が見つからないので省略）")
        return 0
    os.makedirs(args.out, exist_ok=True)
    total = 0
    for sz in args.sizes.split(","):
        w, h = [int(x) for x in sz.split("x")]
        print("== %dx%d ==" % (w, h))
        a = run_size(w, h, args.out, args.only)
        for name, it in a.problems:
            print("  [%s] %s" % (name, it))
        total += len(a.problems)
        paths = [p for p, _ in a.shots]
        labels = [n for _, n in a.shots]
        for i in range(0, len(paths), args.sheet):
            sheet(paths[i:i + args.sheet], labels[i:i + args.sheet], os.path.join(args.out, "sheet_%dx%d_%02d.png" % (w, h, i // args.sheet)), 360 if w < h else 640)
    print("不具合の候補: %d 件" % total)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
