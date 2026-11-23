#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ゲームのフローチャート（画面の流れ・1回の操作で起きること・システムの構成）を、SVG で作る。
  実行: python3 docs/make_game_flow_svg.py   → docs/game_flow_screens.svg / game_flow_loop.svg / game_flow_system.svg
  PNG にする: sh docs/render_game_flow.sh
ゲームの画面と同じ配色（暗い背景・技ごとの色）。内容は、game/js/app.js と game/js/game/stages.js の実装そのまま。
文字のはみ出しは、作るときに自動で検査して、警告を出す（目で見て直す前に、数字で気づける）。
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BG, PANEL, LINE, TEXT, DIM = "#0b0d14", "#151a28", "#2c3550", "#eef2fb", "#98a3bb"
ACC, TEAL, RED, BLUE, PURPLE, GREEN = "#ffe27a", "#66ffcc", "#ff6a3d", "#5aa9ff", "#b48cff", "#9be15d"
GRAY, ARW = "#6c7a96", "#8fa0c8"
FONT = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Helvetica Neue',Arial,sans-serif"

WARNINGS = []


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tw(s, size):
    """文字列の、おおよその幅（px）。全角 = 1em、半角 = 約0.58em。はみ出しの検査用。"""
    w = 0.0
    for ch in s:
        o = ord(ch)
        if o < 0x80:
            w += size * (0.32 if ch in " .,:;!|'`()[]/\\-_" else 0.62 if (ch.isupper() or ch.isdigit()) else 0.56)
        elif o < 0x2000:
            w += size * 0.7
        else:
            w += size * 1.0
    return w


def check_fit(s, size, avail, where):
    need = tw(s, size)
    if need > avail:
        WARNINGS.append("はみ出し（%d > %d）: %s … %s" % (need, avail, where, s))


def rounded(pts, r=10):
    """折れ線を、角だけ丸めたパスにする。"""
    if len(pts) < 3:
        return "M" + " L".join("%g,%g" % p for p in pts)
    d = "M%g,%g" % pts[0]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        l1 = math.hypot(p0[0] - p1[0], p0[1] - p1[1]) or 1
        l2 = math.hypot(p2[0] - p1[0], p2[1] - p1[1]) or 1
        rr = min(r, l1 / 2, l2 / 2)
        a = (p1[0] + (p0[0] - p1[0]) / l1 * rr, p1[1] + (p0[1] - p1[1]) / l1 * rr)
        b = (p1[0] + (p2[0] - p1[0]) / l2 * rr, p1[1] + (p2[1] - p1[1]) / l2 * rr)
        d += " L%g,%g Q%g,%g %g,%g" % (a[0], a[1], p1[0], p1[1], b[0], b[1])
    return d + " L%g,%g" % pts[-1]


class Svg:
    def __init__(self, name, w, h, title, subtitle=None):
        self.name, self.w, self.h = name, w, h
        self.body = []
        self.markers = {}
        self.body.append('<rect width="%d" height="%d" fill="url(#bg)"/>' % (w, h))
        self.text(40, 56, title, 30, TEXT, 800)
        if subtitle:
            self.text(40, 88, subtitle, 16, DIM, 500, avail=w - 80, where="subtitle")

    def marker(self, color):
        mid = "m" + color.lstrip("#")
        if mid not in self.markers:
            self.markers[mid] = ('<marker id="%s" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
                                 '<path d="M0,0 L10,5 L0,10 z" fill="%s"/></marker>' % (mid, color))
        return mid

    def text(self, x, y, s, size=16, fill=TEXT, weight=600, anchor="start", opacity=1.0, avail=None, where=""):
        if avail is not None:
            check_fit(s, size, avail, "%s/%s" % (self.name, where))
        self.body.append('<text x="%g" y="%g" font-size="%g" fill="%s" font-weight="%d" text-anchor="%s" opacity="%g">%s</text>' %
                         (x, y, size, fill, weight, anchor, opacity, esc(s)))

    def box(self, x, y, w, h, color=LINE, fill=PANEL, r=14, stroke=2, glow=False, dash=None):
        self.body.append('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" stroke="%s" stroke-width="%g"%s%s/>' %
                         (x, y, w, h, r, fill, color, stroke, ' filter="url(#glow)"' if glow else "", ' stroke-dasharray="%s"' % dash if dash else ""))

    def band(self, x, y, w, h, color, caption):
        """レーン（帯）。うっすらした背景と、左の色の線、左上の見出し。"""
        self.body.append('<rect x="%g" y="%g" width="%g" height="%g" rx="20" fill="#0e1220" stroke="#1b2238" stroke-width="1.5"/>' % (x, y, w, h))
        self.body.append('<rect x="%g" y="%g" width="5" height="%g" rx="2.5" fill="%s" opacity="0.85"/>' % (x + 1, y + 18, h - 36, color))
        self.text(x + 22, y + 28, caption, 14, color, 800, avail=600, where="band")

    def node_h(self, n_sub, kicker):
        top = 50 if kicker else 30
        return top + 24 + 20 * max(0, n_sub - 1) + 18

    def node(self, x, y, w, title, sub=(), color=LINE, kicker=None, h=None, glow=False, dash=None, title_size=19, sub_size=14, sub_fill=DIM):
        """箱。h を省くと、行数から自動で決める。下の y を返す。"""
        h = h or self.node_h(len(sub), kicker)
        self.box(x, y, w, h, color, glow=glow, dash=dash)
        ty = y + 30
        if kicker:
            self.text(x + 16, y + 24, kicker, 12, color if color != LINE else DIM, 900)
            ty = y + 50
        self.text(x + 16, ty, title, title_size, TEXT, 800, avail=w - 32, where=title)
        for i, s in enumerate(sub):
            self.text(x + 16, ty + 24 + i * 20, s, sub_size, sub_fill, 500, avail=w - 32, where=title)
        last = ty + 24 + 20 * max(0, len(sub) - 1) + 12
        if last > y + h:
            WARNINGS.append("箱から縦にはみ出し: %s/%s（高さ %d 必要 %d）" % (self.name, title, h, last - y))
        return y + h

    def arrow(self, pts, color=ARW, width=2.5, dash=None, label=None, label_pos=None, label_color=None, head=True, label_size=13):
        self.body.append('<path d="%s" fill="none" stroke="%s" stroke-width="%g"%s%s/>' %
                         (rounded(pts), color, width, ' stroke-dasharray="%s"' % dash if dash else "", ' marker-end="url(#%s)"' % self.marker(color) if head else ""))
        if label:
            lx, ly = label_pos if label_pos else ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2 - 8)
            self.text(lx, ly, label, label_size, label_color or DIM, 700, "middle")

    def legend(self, x, y, items):
        self.text(x, y + 14, "凡例", 14, DIM, 800)
        x += 60
        for col, nm in items:
            self.body.append('<rect x="%g" y="%g" width="18" height="18" rx="5" fill="%s"/>' % (x, y, col))
            self.text(x + 26, y + 15, nm, 14, TEXT, 600)
            x += 26 + tw(nm, 14) + 34
        return x

    def save(self):
        defs = ('<defs>'
                '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
                '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1019"/><stop offset="1" stop-color="#07080c"/></linearGradient>'
                + "".join(self.markers.values()) + '</defs>')
        head = '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="%s">' % (self.w, self.h, self.w, self.h, FONT)
        with open(os.path.join(HERE, self.name + ".svg"), "w", encoding="utf-8") as f:
            f.write("\n".join([head, defs] + self.body + ["</svg>"]))
        print("できました:", self.name + ".svg", "（%d × %d）" % (self.w, self.h))


# ============================================================================
# 1. 画面の流れ（タイトルから）
# ============================================================================
def screens():
    s = Svg("game_flow_screens", 2000, 1450, "CHORD LINES（仮題）  ゲームのフローチャート — 画面の流れ",
            "タイトルから、結果まで。実装したプロトタイプの流れそのまま（2026-11-17 に、メロディにコードをつける・プリセットを追加。2026-11-18 に、メロディをつける・書く画面を追加）")

    # --- 上の段: 起動 → タイトル（+ 実機・図鑑）、どの場面でも使えるもの ---
    s.node(70, 140, 250, "起動", ["クリック / Enter で", "音が使えるようになる", "（音源を読み込む）"], ACC, "SPLASH")
    s.node(400, 120, 330, "タイトル", ["背景で、自動デモが", "進行を組み立てて鳴らす", "（技が決まる演出つき）"], TEAL, "TITLE", h=170, glow=True)
    s.arrow([(320, 205), (400, 205)])
    s.node(800, 120, 340, "実機の盤（任意）", ["ESP32 + RC522 8台。つながると", "画面の盤が、実機の駒で動く"], BLUE, "DEVICE")
    s.arrow([(800, 175), (730, 175)], BLUE, dash="6 5")
    s.node(800, 250, 340, "図鑑（23個の技）", ["見つけた技が、色で点灯する", "（タイトル・ゲーム中に表示）"], PURPLE, "COLLECTION")
    s.arrow([(800, 305), (765, 305), (765, 255), (730, 255)], PURPLE, dash="6 5")
    s.node(1200, 120, 770, "どの場面でも（ゲーム中）",
           ["MENU / Esc … つづける・やりなおす・ステージ選択・タイトルへ",
            "ヒント（H キー）… 次の候補が、うっすら出る（画面の盤なら、クリックで置ける）",
            "演奏 ON/OFF（Space）・音 ON/OFF（M）・BPM ± 5",
            "駒: ドラッグ / クリックで持ち上げて置く / ダブルクリック・Delete ではずす / Esc",
            "実機の盤: つながっていれば、ボタン「盤 実機 / 画面」で切り替えられる",
            "進み具合（クリア・図鑑・ベスト）: ブラウザに保存。「進み具合をリセット」で消せる",
            "プリセット（☆）… 進行（とメロディ）を保存・呼び出し（フリープレイ・メロディ）",
            "メロディ（♪）… 自動でつける・ピアノロールで書く・直す（フリープレイ。docs/melody_studio.md）",
            "デモ用: タイトルの「ぜんぶ開く（デモ用）」で、ステージの鍵を外せる"], ACC, "ALWAYS", h=288, sub_size=15)

    # --- タイトルから、各レーンへの幹線（左端） ---
    s.arrow([(565, 290), (565, 392), (26, 392), (26, 1134)], ARW, head=False)
    s.text(300, 382, "タイトルのボタンから選ぶ", 13, DIM, 700, "middle")

    # --- レーン1: チュートリアル / ステージ ---
    y0 = 410
    s.band(50, y0, 1920, 250, GREEN, "学ぶ ─ チュートリアル（ステージ0〜13）")
    ny, nh = y0 + 59, 112                                   # 番号つきの箱の上端と高さ
    s.node(70, ny - 10, 290, "チュートリアル / ステージ選択", ["順に進む（ステージ 0〜13）", "または、好きなステージから", "（鍵は、前のクリアで開く）"], GREEN, "TUTORIAL / STAGES", title_size=17)
    cy1 = ny - 10 + 130 / 2
    s.arrow([(26, cy1), (70, cy1)], GREEN)
    xs = [410, 720, 1030, 1340, 1650]
    steps = [("① 説明（GUIDE）", ["その技が、なぜ気持ちいいか", "音楽用語なしの言葉で説明"], GREEN),
             ("② 駒を置く", ["「N番に〇〇を置こう」と案内", "ヒントは、選んで出せる", "駒を押すと、その和音が鳴る"], GREEN),
             ("③ 技が決まる", ["その場で: 囲み + 名前 + 理由", "次の拍で: 効果音 + 演出", "スコア・コンボ・図鑑が更新"], ACC),
             ("④ クリア判定", ["お手本どおりでなくても、", "進行の最後まで置けばクリア"], GREEN),
             ("⑤ 結果（STAGE CLEAR）", ["盤を見る時間（7〜14秒）のあと", "次へ / 盤面を見る・編集する /", "もう一度 / ステージ選択"], GREEN)]
    for x, (t, sub, col) in zip(xs, steps):
        s.node(x, ny, 270, t, sub, col, h=nh, glow=(col == ACC), title_size=17)
    cy = ny + nh / 2
    s.arrow([(360, cy1), (410, cy)], GREEN)
    for a, b in zip(xs[:-1], xs[1:]):
        s.arrow([(a + 270, cy), (b, cy)])
    s.arrow([(xs[2] + 135, ny), (xs[2] + 135, ny - 26), (xs[1] + 135, ny - 26), (xs[1] + 135, ny)], DIM, dash="6 5",
            label="決まらない → 置き直す", label_pos=((xs[1] + xs[2]) / 2 + 135, ny - 34), label_color=DIM)
    s.arrow([(xs[4] + 135, ny + nh), (xs[4] + 135, ny + nh + 40), (xs[0] + 135, ny + nh + 40), (xs[0] + 135, ny + nh)], GREEN,
            label="次のステージへ（最後のステージの次は、フリープレイへ）", label_pos=((xs[0] + xs[4]) / 2 + 135, ny + nh + 64), label_color=GREEN, label_size=14)

    # --- レーン2: フリープレイ / チャレンジ ---
    y1 = 690
    s.band(50, y1, 1920, 310, TEAL, "遊ぶ ─ フリープレイ / チャレンジ")
    fy, chy = y1 + 35, y1 + 175
    s.node(70, fy, 290, "フリープレイ", ["全部の駒（31種 + →）で自由に", "23種の技を、全部見つけよう"], TEAL, "FREE PLAY")
    s.node(70, chy, 290, "チャレンジ", ["90秒で、高得点を狙う", "（最初の駒を置くと、スタート）"], RED, "CHALLENGE")
    fcy, ccy = fy + 55, chy + 55
    mid = (fcy + ccy) / 2
    ay = mid - nh / 2
    ax, bx, cx, dx, ex = 420, 700, 1050, 1340, 1660            # 箱の左端。幅は 240 / 240 / 250 / 280 / 280
    aw, bw, cw, dw, ew = 240, 240, 250, 280, 280
    s.arrow([(26, fcy), (70, fcy)], TEAL)
    s.arrow([(26, ccy), (70, ccy)], RED)
    s.arrow([(360, fcy), (390, fcy), (390, mid), (ax, mid)], TEAL)
    s.arrow([(360, ccy), (390, ccy), (390, mid)], RED, head=False)
    s.node(ax, ay, aw, "駒を置く・動かす", ["ドラッグ / クリックで置く", "動かす・入れ替える・はずす"], TEAL, h=nh, title_size=17)
    s.node(bx, ay, bw, "判定 → 得点", ["点 = 技の点 × 繰り返し", "× コンボ × 種類の多さ", "技にならない所は ORIGINAL"], ACC, h=nh, glow=True, title_size=17)
    s.arrow([(ax + aw, mid), (bx, mid)])
    s.arrow([(bx + bw / 2, ay), (bx + bw / 2, ay - 26), (ax + aw / 2, ay - 26), (ax + aw / 2, ay)], DIM, dash="6 5",
            label="組み替える", label_pos=((ax + aw / 2 + bx + bw / 2) / 2, ay - 34), label_color=DIM)
    s.node(cx, ay, cw, "タイムアップ", ["90秒で終わり。いちばん", "高かった盤の得点を採用"], RED, "CHALLENGE", h=nh + 20, title_size=17)
    s.arrow([(bx + bw, mid), (cx, mid)], RED)
    s.text((bx + bw + cx) / 2, mid - 30, "チャレンジ", 13, RED, 700, "middle")           # 隙間が狭いので、2行に分ける
    s.text((bx + bw + cx) / 2, mid - 14, "のとき", 13, RED, 700, "middle")
    s.node(dx, ay, dw, "結果（TIME UP）", ["得点・★・ベスト", "★は 500 / 1000 / 1800", "もう一度 / ステージ選択 / タイトル"], RED, h=nh + 20, title_size=17)
    s.arrow([(cx + cw, mid), (dx, mid)], RED)
    s.node(ex, ay, ew, "対戦（準備中）", ["同じ条件・同じ時間で作って、", "得点と音楽を比べる", "（チャレンジを交代で遊ぶ形）"], GRAY, "VERSUS", h=nh + 20, dash="8 6", title_size=17)
    s.arrow([(dx + dw, mid), (ex, mid)], GRAY, dash="8 6")

    # --- レーン3: メロディにコードをつける（2026-11-17）---
    y2 = 1020
    MEL = "#6fb7d9"
    s.band(50, y2, 1920, 250, MEL, "合わせる ─ メロディにコードをつける（5つのメロディ）")
    my = y2 + 59
    s.node(70, my - 10, 290, "メロディを選ぶ", ["タイトルの「合わせる」から。", "ステージ選択の中からも入れる", "（記録: ★・ベスト・相性）"], MEL, "MELODY", title_size=17)
    mcy = my - 10 + 130 / 2
    s.arrow([(26, mcy), (70, mcy)], MEL)
    mxs = [410, 720, 1030, 1340, 1650]
    msteps = [("① メロディが流れる", ["画面の上の「帯」に、音が出る", "盤は、少し小さく・下へ", "和音・ドラムと同じテンポ"], MEL),
              ("② 和音を置く", ["1〜8番に、合う和音を置く", "プリセットも、使える", "ヒント: メロディに合う和音だけ"], MEL),
              ("③ 音を判定（置いた瞬間）", ["緑 = コードの音 / 水色 = テンション", "赤 = アヴォイド / 黄 = 不安定", "灰 = 経過音（短くて弱い拍）"], ACC),
              ("④ 得点", ["コード進行の点（技・ジャッジ）", "+ メロディとの相性の点", "（満点 1,200 + ボーナス 最大 120）"], ACC),
              ("⑤ 採点する → 結果", ["★（相性 60% / 90% / + 進行の点）", "ステップごとの表・お手本の一例", "次のメロディ / 盤面にもどる / …"], MEL)]
    for x, (t, sub, col) in zip(mxs, msteps):
        s.node(x, my, 270, t, sub, col, h=nh, glow=(col == ACC), title_size=17)
    mcy2 = my + nh / 2
    s.arrow([(360, mcy), (410, mcy2)], MEL)
    for a, b in zip(mxs[:-1], mxs[1:]):
        s.arrow([(a + 270, mcy2), (b, mcy2)])
    s.arrow([(mxs[3] + 135, my), (mxs[3] + 135, my - 26), (mxs[1] + 135, my - 26), (mxs[1] + 135, my)], DIM, dash="6 5",
            label="ぶつかる音がある → 和音を替える", label_pos=((mxs[1] + mxs[3]) / 2 + 135, my - 34), label_color=DIM)
    s.arrow([(mxs[4] + 135, my + nh), (mxs[4] + 135, my + nh + 40), (mxs[0] + 135, my + nh + 40), (mxs[0] + 135, my + nh)], MEL,
            label="次のメロディへ / もう一度", label_pos=((mxs[0] + mxs[4]) / 2 + 135, my + nh + 64), label_color=MEL, label_size=14)

    # --- 凡例・注 ---
    s.legend(50, 1320, [(GREEN, "チュートリアル"), (TEAL, "フリープレイ"), (RED, "チャレンジ"), (MEL, "メロディ"), (BLUE, "実機の盤"), (PURPLE, "図鑑"), (ACC, "技が決まる瞬間")])
    s.text(50, 1376, "※ 対戦は、まだ作っていません（チャレンジを交代で遊んで比べる形を想定）。", 14, DIM, 500)
    s.text(50, 1400, "※ 画面の仮の盤（マウス）と、実機の盤（ESP32 + RC522）は、同じゲームを、同じように動かします。", 14, DIM, 500)
    s.text(50, 1424, "※ メロディの採点のルールは docs/melody_mode.md。プリセット（上のバーの ☆）は、実機の盤のとき、置く駒と場所を案内します。", 14, DIM, 500)
    s.save()


# ============================================================================
# 2. 1回の操作で、起きること（フィードバックの設計）
# ============================================================================
def loop():
    cols = [
        ("置く前", "手がかり（FEEDFORWARD）", BLUE, [
            ("駒のかたち・色（働き）", ["球 = 安定（トニック系）", "立方体 = 広がり（サブドミナント系）", "三角錐 = 緊張（ドミナント系）", "八面体 = 色づけ・借用"]),
            ("駒を押すと、和音が鳴る", ["置く前に、その駒の響きを聴ける"]),
            ("ヒント（選んで ON/OFF）", ["次の候補が、盤の上と駒の置き場に", "うっすら出る。おすすめ4つ・発展5つ", "（例: Ⅵm7 の次 → 5番に Ⅱm7 / 発展: Ⅳm7）", "メロディのステージ: 合う和音だけ"]),
            ("案内（チュートリアル）", ["「N番に〇〇を置こう」と、矢印で示す"])]),
        ("置いた瞬間", "すぐ見える・分かる", ACC, [
            ("駒が盤に落ちる", ["木のコツッという音 + 衝撃の輪"]),
            ("技を判定（すぐ）", ["つながりを、前後の駒との関係で見る", "判定は度数。キーを変えても同じ"]),
            ("囲む + 名前を表示", ["技の部分を、色つきの枠と流れる線で囲み", "名前・点数・コンボを、ラベルで出す"]),
            ("技にならなかったつながり", ["性質で描写（ORIGINAL）", "例: 「全音上・共通音が多く、なめらか」"]),
            ("ジャッジ（講評）", ["耳に馴染む並びは加点", "進行感のない並びは減点", "階段 +60〜 / 進行感なし −40 など"]),
            ("メロディとの相性", ["メロディの音を、和音ごとに色分け", "コードの音・テンション・アヴォイド", "相性の点が、得点に足される"])]),
        ("次の拍（0〜0.5秒）", "音と演出", RED, [
            ("スタンプ（TRICK!）", ["技の名前・点数・「なぜ」の説明", "初めての技には NEW"]),
            ("効果音（拍に合わせる）", ["その和音の音を、高い音域で「きらっ」", "（いつも、音楽と調和する）", "コンボのときは、さらに音が重なる"]),
            ("演出", ["光の粒・衝撃波・画面の光・少しスロー", "カメラが、ぐっと寄る"]),
            ("得点・図鑑", ["スコアが増える。コンボ ×1.5 / ×2 …", "23個の技の図鑑が、色で点灯する"])]),
        ("演奏中（ループ）", "再生位置が通る", TEAL, [
            ("再生位置が、位置1→8を進む", ["1ステップ = 2拍（BPM 120 で 1周 8秒）", "ドラムは、駒がなくても鳴る"]),
            ("技の最後のコードで、光る", ["通るたびに、枠が光り、小さく「きらっ」", "（初めて決まったときほど、大きくはない）"]),
            ("和音は、前の音に近い高さで", ["ボイスリーディング。実機の演奏と同じ規則", "ピアノ + ドラム（GM）"])]),
        ("組み替える", "スコアを伸ばす", PURPLE, [
            ("得点の組み立て", ["技の点 × 同じ技の繰り返し（2回目 ×0.6…）", "× コンボ（つながる数 ×1.5〜）", "× 種類の多さ（+10%ずつ）"]),
            ("定番だけでは、伸びにくい", ["同じ技の繰り返しは、点が下がる", "違う種類を、つなげるほど高得点"]),
            ("パー（目標点）", ["ミッションごとの目標を、星で示す予定", "（チャレンジは ★ 500 / 1000 / 1800）"])]),
    ]
    iw, gap_i = 300, 14

    def ih(rows):
        return 50 + 20 * len(rows)
    content = max(sum(ih(r) + gap_i for _, r in items) - gap_i for _, _, _, items in cols)
    col_h = 92 + content + 20
    W = 40 + 5 * 340 + 4 * 20 + 40
    top = 130
    notes_y = top + col_h + 46
    s = Svg("game_flow_loop", W, int(notes_y + 70), "CHORD LINES（仮題）  1回の操作で、起きること — フィードバックの設計",
            "「選んだ後にフィードバックがあるのでは、判断材料がない」への答え: 置く前の手がかり → 置いた瞬間 → 拍に合わせて → 演奏中 → 結果")
    for i, (t, sub, col, items) in enumerate(cols):
        x = 40 + i * 360
        s.box(x, top, 340, col_h, col, fill="#10141f", stroke=2)
        s.text(x + 20, top + 38, t, 24, TEXT, 800)
        s.text(x + 20, top + 66, sub, 14, col, 800)
        y = top + 92
        for ttl, rows in items:
            h = ih(rows)
            s.box(x + 20, y, iw, h, col, fill="#171d2e", r=10, stroke=1.5)
            s.text(x + 34, y + 26, ttl, 16, TEXT, 800, avail=iw - 28, where=ttl)
            for k, r in enumerate(rows):
                s.text(x + 34, y + 50 + k * 20, r, 13, DIM, 500, avail=iw - 28, where=ttl)
            y += h + gap_i
        if i < 4:
            s.arrow([(x + 340, top + col_h / 2), (x + 360, top + col_h / 2)], ACC, width=3)
    s.text(40, notes_y, "判定の考え方", 17, ACC, 800)
    s.text(40, notes_y + 28, "名前の付いた技の一覧だけでは、一覧にない進行が「何も起きない」になる → つながりを「性質」（ルートの動き・共通音・色）で見て、", 15, TEXT, 600, avail=W - 80, where="notes")
    s.text(40, notes_y + 52, "性質のパターンに名前を付けたものが「技」。技にならないつながりも、描写する。そのうえで「ジャッジ」（ルールの審判）が、耳に馴染む並びを加点、進行感のない並びを減点・指摘する（sus4 の解決も加点）。", 15, TEXT, 600, avail=W - 80, where="notes")
    s.save()


# ============================================================================
# 3. システムの構成
# ============================================================================
def system():
    s = Svg("game_flow_system", 1900, 700, "CHORD LINES（仮題）  システムの構成",
            "物理的な駒（入力）と、PC のゲーム。これまでに作った 8台の駒認識システムを、そのまま入力装置として使う")
    s.node(40, 150, 250, "コード駒", ["RFID タグ入り", "31種のコード + 「→」", "（新しい3つは、書き込み待ち）", "（デザインは、別に進行中）"], ACC, "PIECES", h=150)
    s.node(340, 150, 280, "盤（4×2 = 8か所）", ["RC522 リーダー ×8", "駒の置き・外し・入れ替えを", "約0.3秒で検出（影の対策つき）"], ACC, "BOARD", h=150)
    s.node(670, 150, 250, "ESP32-S3", ["駒 → コード → 位置の表", "（登録した駒の ID）", "状態を、文字で送る（USB）"], BLUE, "DEVICE", h=150)
    s.node(970, 150, 280, "ブリッジ", ["midi_bridge.py（常駐できる）", "文字 → 通知（SSE）", "ブラウザ向けの窓口 /api/"], BLUE, "BRIDGE", h=150)
    s.node(1300, 150, 280, "ゲームを配るサーバー", ["game_server.py", "ゲームのファイルを配り、", "/api/ をブリッジへ中継"], TEAL, "SERVER", h=150)
    s.node(1620, 120, 240, "ブラウザ（Chrome）", ["ゲーム本体", "3D 表示（three.js）", "技の判定・得点・ヒント", "ピアノ + ドラムを鳴らす", "（Web Audio）"], TEAL, "GAME", h=210, glow=True)
    for (a, b) in [(290, 340), (620, 670), (920, 970), (1250, 1300), (1580, 1620)]:
        s.arrow([(a, 225), (b, 225)], ACC)
    s.text(655, 134, "※ ゲームの間、ESP32 は駒を読んで送るだけ。音はゲームが鳴らす", 13, DIM, 500, "middle")

    s.node(1300, 400, 560, "画面の仮の盤（マウス・タッチ）", ["駒を、画面でドラッグ。実機がなくても、同じゲームが遊べる", "（実機の盤が、つながっていれば、自動で切り替わる）", "展示の予備にもなる"], TEAL, "VIRTUAL BOARD", h=130)
    s.arrow([(1740, 400), (1740, 330)], TEAL, dash="6 5")
    s.node(40, 400, 1200, "音の仕組み（ゲームの中）", [], PURPLE, "AUDIO", h=230)
    rows = ["ピアノ: Salamander Grand Piano のサンプル（CC BY 3.0）を、音の高さに合わせて鳴らす",
            "ドラム: GM のドラムキット（GeneralUser GS）。8種類の音（キック・スネア・ハイハット…）",
            "和音の高さ・リズムの鳴らし方: 実機ファーム（groove.cpp / voicing.cpp）と同じ規則。自動テストで、全組み合わせを照合済み",
            "技の効果音: そのときの和音の構成音を、高い音域で「きらっ」と鳴らす（音楽に、いつも調和する）。拍に合わせて予約",
            "時計: 画面ではなく、音の時計（AudioContext）。少し先まで予約するので、ずれない（1ステップ 1000ms ±1ms 以内を確認）"]
    for i, r in enumerate(rows):
        s.text(60, 500 + i * 27, r, 16, TEXT, 600, avail=1200 - 40, where="audio")
    s.text(40, 672, "※ ESP32 の内蔵音源・アンプ・Wi-Fi 画面は、PC につなぐ前提になったため、優先度を下げました（docs/standalone_plan.md は、参考として残してあります）。", 13, DIM, 500, avail=1820, where="footnote")
    s.save()


if __name__ == "__main__":
    screens()
    loop()
    system()
    if WARNINGS:
        print("\n注意: %d 件のはみ出しの疑い" % len(WARNINGS), file=sys.stderr)
        for w in WARNINGS:
            print("  ・" + w, file=sys.stderr)
        sys.exit(1)
    print("はみ出しの検査: 問題なし")
