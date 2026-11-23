#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
リズム編集画面のサーバー（midi_bridge.py の中から動く。自分のパソコンの中だけ = 127.0.0.1）

  ブラウザの画面（tools/rhythm_editor/index.html）で、マス目をクリックして作ったドラム／バッキングのパターンを受け取り、
  ESP32 のコマンド（DRUM SET ... / BACKING SET ...）に変換して、ESP32 に送る。文字を打つ必要はない。

  送られてくる内容は厳しく検査する（文字・長さ・番号）。ESP32 に送るのは、DRUM / BACKING のコマンドだけ。
"""
import json
import mimetypes
import os
import queue
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
EDITOR_DIR = os.path.join(HERE, "rhythm_editor")
GAME_DIR = os.path.join(os.path.dirname(HERE), "game")   # ゲーム（game/）。/game/ で配る（常駐ブリッジの URL だけで、ゲームも開けるように）
MIME = {".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".mp3": "audio/mpeg", ".wav": "audio/wav",
        ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8"}

LANES = "KSPHOCRX"            # ファームの drumLaneFromLetter と同じ
USER_SLOTS = range(11, 21)    # 自分のパターンの置き場（ファームの PATTERN_ID_USER_FIRST〜LAST）
LENGTHS = (8, 16, 32)
DRUM_CHARS = set(".oxX")
BACKING_CHARS = set(".-CcBbDd1234")
HIT_CHARS = set("CcBbDd1234")
NAME_MAX_CHARS = 20


# ------------------------------------------------------------
# ゲーム用のライブラリ: 名前をつけた、ドラム・バッキング・固有進行
#   リズム・コード編集の画面で作って、ゲームが、リアルタイムで受け取る（変わるたびに、SSE で知らせる）。
#   ESP32 のスロット（11〜20）とは別。ファイル（JSON）に保存するので、ブリッジを作り直しても残る。
# ------------------------------------------------------------
class Library(object):
    KINDS = ("drum", "backing", "progression")
    LIMITS = {"drum": 40, "backing": 40, "progression": 60}
    PREFIX = {"drum": "d", "backing": "b", "progression": "p"}
    LISTS = {"drum": "drums", "backing": "backings", "progression": "progressions"}

    def __init__(self, path=None, chord_names=None, game_dir=GAME_DIR):
        self.path = path
        self.lock = threading.RLock()
        self._chords = list(chord_names) if chord_names else None
        self._game_dir = game_dir
        self.data = {"version": 1, "seq": 0, "next": 1, "drums": [], "backings": [], "progressions": []}
        self._load()

    # ---- 保存・読み込み ----
    def _load(self):
        if not self.path or not os.path.isfile(self.path):
            return
        try:
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
            for lst in self.LISTS.values():
                if isinstance(d.get(lst), list):
                    self.data[lst] = d[lst][: self.LIMITS[[k for k, v in self.LISTS.items() if v == lst][0]]]
            self.data["seq"] = int(d.get("seq", 0)); self.data["next"] = max(1, int(d.get("next", 1)))
        except (OSError, ValueError, TypeError):
            pass     # 壊れていたら、空から始める（ゲームは、標準の内容で遊べる）

    def _save(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps(self.data, ensure_ascii=False))

    # ---- 検査 ----
    def chord_names(self):
        if self._chords is None:
            try:
                with open(os.path.join(self._game_dir, "data", "chords.json"), encoding="utf-8") as f:
                    self._chords = [c["name"] for c in json.load(f)["chords"] if c.get("type") != "repeat"]
            except (OSError, ValueError, KeyError):
                self._chords = []
        return self._chords

    def _clean(self, kind, item):
        if kind not in self.KINDS:
            raise ValueError("種類は drum / backing / progression のどれかです")
        if not isinstance(item, dict):
            raise ValueError("内容が正しくありません")
        if not isinstance(item.get("name"), str) or not item["name"].strip():
            raise ValueError("名前をつけてください")
        name = _check_name(item)
        out = {"name": name}
        if kind == "drum":
            length = item.get("length")
            if not isinstance(length, int) or isinstance(length, bool) or length not in LENGTHS:
                raise ValueError("長さは 8 / 16 / 32 マスです")
            lanes = item.get("lanes")
            if not isinstance(lanes, dict) or not lanes:
                raise ValueError("ドラムの内容が正しくありません")
            clean = {}
            for k, v in lanes.items():
                if k not in LANES or not isinstance(v, str) or len(v) != length or not set(v) <= DRUM_CHARS:
                    raise ValueError("ドラムの内容が正しくありません（レーン %s は、%d 文字で、. o x X だけ）" % (k, length))
                if set(v) - {"."}:
                    clean[k] = v
            if not clean:
                raise ValueError("ドラムが、空です（どこかのマスを置いてください）")
            out.update(length=length, lanes=clean)
        elif kind == "backing":
            length = item.get("length")
            if not isinstance(length, int) or isinstance(length, bool) or length not in LENGTHS:
                raise ValueError("長さは 8 / 16 / 32 マスです")
            cells = item.get("cells")
            _check_backing_cells(cells, length)
            if not (set(cells) & HIT_CHARS):
                raise ValueError("バッキングが、空です（音を置いてください）")
            out.update(length=length, cells=cells)
        else:
            chords = item.get("chords")
            names = self.chord_names()
            if (not isinstance(chords, list) or not 2 <= len(chords) <= 8 or any(not isinstance(c, str) for c in chords)
                    or (names and any(c not in names for c in chords))):
                raise ValueError("進行は、2〜8個の駒（コード）の名前で、並べます")
            pts = item.get("points", 150 * len(chords))
            if not isinstance(pts, int) or isinstance(pts, bool) or not 50 <= pts <= 3000:
                raise ValueError("点数は 50〜3000 です")
            start = item.get("startAt", "head")
            if start not in ("head", "any"):
                raise ValueError("始まりの場所は head か any です")
            out.update(chords=list(chords), points=pts, startAt=start)
        return out

    # ---- 追加・置き換え・削除 ----
    def put(self, kind, item):
        """ 追加（または、同じ id・同じ名前を、置き換え）。戻り値: 保存した内容（id つき） """
        with self.lock:
            clean = self._clean(kind, item)
            lst = self.data[self.LISTS[kind]]
            found = None
            if isinstance(item.get("id"), str):
                found = next((x for x in lst if x["id"] == item["id"]), None)
            if found is None:
                found = next((x for x in lst if x["name"] == clean["name"]), None)     # 同じ名前で保存し直すと、上書き（作りながら、ゲームに送り続けられる）
            if found is None:
                if len(lst) >= self.LIMITS[kind]:
                    raise ValueError("これ以上、保存できません（%d個まで）。いらないものを削除してください" % self.LIMITS[kind])
                clean["id"] = "%s%d" % (self.PREFIX[kind], self.data["next"])
                self.data["next"] += 1
                lst.append(clean)
            else:
                clean["id"] = found["id"]
                lst[lst.index(found)] = clean
            self.data["seq"] += 1
            self._save()
            return clean

    def delete(self, kind, ident):
        with self.lock:
            if kind not in self.KINDS or not isinstance(ident, str):
                raise ValueError("削除する内容が正しくありません")
            lst = self.data[self.LISTS[kind]]
            found = next((x for x in lst if x["id"] == ident), None)
            if found is None:
                raise ValueError("見つかりません")
            lst.remove(found)
            self.data["seq"] += 1
            self._save()
            return found


def default_library_path():
    return os.environ.get("CHORDTOY_LIBRARY") or os.path.join(os.path.expanduser("~"), "Library", "Application Support", "ChordToy", "library.json")



def _check_name(req):
    name = req.get("name", "")
    if not isinstance(name, str):
        raise ValueError("名前が文字ではありません")
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in name):  # 改行などで、別のコマンドを混ぜられないように
        raise ValueError("名前に使えない文字があります")
    name = " ".join(name.split())  # 前後と連続の空白を整える
    if len(name) > NAME_MAX_CHARS:
        raise ValueError("名前は %d 文字までです" % NAME_MAX_CHARS)
    return name or "マイ・パターン"


def _check_common(req):
    slot = req.get("slot")
    if not isinstance(slot, int) or isinstance(slot, bool) or slot not in USER_SLOTS:
        raise ValueError("保存先は 11〜20 の番号です")
    length = req.get("length")
    if not isinstance(length, int) or isinstance(length, bool) or length not in LENGTHS:
        raise ValueError("長さは 8 / 16 / 32 マスです")
    return slot, length, _check_name(req), bool(req.get("select", True))


def _check_backing_cells(cells, length):
    if not isinstance(cells, str) or len(cells) != length or not set(cells) <= BACKING_CHARS:
        raise ValueError("バッキングの内容が正しくありません（%d文字、使える文字は . - C c B b D d 1 2 3 4）" % length)
    after_hit = False
    for c in cells:
        if c == "-":
            if not after_hit:
                raise ValueError("「-」（のばす）は、音（C B D 1〜4）か、別の「-」の直後にだけ置けます")
        else:
            after_hit = c in HIT_CHARS
    if not any(c in HIT_CHARS for c in cells):
        raise ValueError("音が1つもありません。マスに音を入れてください")


def build_drum_commands(req):
    """ {"kind":"drum","slot":11,"name":"..","length":16,"lanes":{"K":"x...",...},"select":true} → ESP32 のコマンドの行 """
    slot, length, name, select = _check_common(req)
    lanes = req.get("lanes")
    if not isinstance(lanes, dict):
        raise ValueError("レーンの内容がありません")
    lines = ["DRUM CLEAR %d" % slot, "DRUM LEN %d %d" % (slot, length)]
    any_hit = False
    for lane in LANES:  # 決まった順番で送る
        text = lanes.get(lane)
        if text is None:
            continue
        if not isinstance(text, str) or len(text) != length or not set(text) <= DRUM_CHARS:
            raise ValueError("レーン %s の内容が正しくありません（%d文字、使える文字は . o x X）" % (lane, length))
        if text.strip(".") == "":
            continue
        any_hit = True
        lines.append("DRUM SET %d %s %s" % (slot, lane, text))
    for lane in lanes:
        if lane not in LANES:
            raise ValueError("レーン「%s」は使えません（K S P H O C R X）" % lane)
    if not any_hit:
        raise ValueError("音が1つもありません。マスをクリックして、音を入れてください")
    lines.append("DRUM NAME %d %s" % (slot, name))
    if select:
        lines.append("DRUM %d" % slot)
    return lines


def build_backing_commands(req):
    """ {"kind":"backing","slot":11,"name":"..","length":16,"cells":"C-------...","select":true} → ESP32 のコマンドの行 """
    slot, length, name, select = _check_common(req)
    cells = req.get("cells")
    _check_backing_cells(cells, length)
    lines = ["BACKING CLEAR %d" % slot, "BACKING LEN %d %d" % (slot, length), "BACKING SET %d %s" % (slot, cells),
             "BACKING NAME %d %s" % (slot, name)]
    if select:
        lines.append("BACKING %d" % slot)
    return lines


def build_live_commands(req):
    """ ライブ編集: 変わったところだけを送る（速い）。保存先は、すでに ESP32 にあるパターン（先に「送る」で作ってある）。
        ドラム: {"kind":"drum","slot":11,"length":16,"lanes":{"K":"x..."}（変わったレーンだけ）,"name":".."（変えたときだけ）}
        バッキング: {"kind":"backing","slot":11,"length":16,"cells":"C---..."（全部）,"name":".."（変えたときだけ）} """
    if not isinstance(req, dict):
        raise ValueError("送られた内容が正しくありません")
    kind = req.get("kind")
    slot = req.get("slot")
    length = req.get("length")
    if not isinstance(slot, int) or isinstance(slot, bool) or slot not in USER_SLOTS:
        raise ValueError("保存先は 11〜20 の番号です")
    if not isinstance(length, int) or isinstance(length, bool) or length not in LENGTHS:
        raise ValueError("長さは 8 / 16 / 32 マスです")
    lines = []
    if kind == "drum":
        lanes = req.get("lanes", {})
        if not isinstance(lanes, dict):
            raise ValueError("レーンの内容がありません")
        for lane in LANES:
            if lane not in lanes:
                continue
            text = lanes[lane]
            if not isinstance(text, str) or len(text) != length or not set(text) <= DRUM_CHARS:
                raise ValueError("レーン %s の内容が正しくありません（%d文字、使える文字は . o x X）" % (lane, length))
            lines.append("DRUM SET %d %s %s" % (slot, lane, text))
        for lane in lanes:
            if lane not in LANES:
                raise ValueError("レーン「%s」は使えません（K S P H O C R X）" % lane)
    elif kind == "backing":
        cells = req.get("cells")
        if cells is not None:
            _check_backing_cells(cells, length)
            lines.append("BACKING SET %d %s" % (slot, cells))
    else:
        raise ValueError("種類は drum か backing です")
    if req.get("name") is not None:
        lines.append("%s NAME %d %s" % (kind.upper(), slot, _check_name(req)))
    if not lines:
        raise ValueError("変えるところがありません")
    return lines


def build_commands(req):
    if not isinstance(req, dict):
        raise ValueError("送られた内容が正しくありません")
    if req.get("kind") == "drum":
        return build_drum_commands(req)
    if req.get("kind") == "backing":
        return build_backing_commands(req)
    raise ValueError("種類は drum か backing です")


# ---------------------------------------------------------------------------
# ESP32 の状態（STATE コマンドの出力）を読む
# ---------------------------------------------------------------------------

_STATE_INTS = ("bpm", "playing", "step", "drum", "backing", "lead", "voicing", "gain")
_STATE_OPTIONAL_INTS = ("octave", "learn")   # 古いファームには、ない


def parse_state_line(line):
    """ "~S bpm=120 key=C playing=0 step=-1 drum=0 backing=1 lead=1 voicing=4 idle=RESET gain=33 midi=BRIDGE chords=Ⅰ,C;-,"
        → 辞書。この形でなければ None """
    if not line.startswith("~S "):
        return None
    d = {}
    for tok in line[3:].split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            d[k] = v
    try:
        for k in _STATE_INTS:
            d[k] = int(d[k])
        for k in _STATE_OPTIONAL_INTS:
            d[k] = int(d[k]) if k in d else 0
        chords = []
        for item in d.get("chords", "").split(";"):
            name, _, symbol = item.partition(",")
            chords.append({"name": name, "symbol": symbol})
        d["chords"] = chords
        # 位置ごとのリーダー番号（1から数える）。古いファームには、ない
        d["map"] = [int(x) for x in d["map"].split(",")] if d.get("map") else []
        d["key"] = d["key"]
        d["idle"] = d["idle"]
        d["midi"] = d["midi"]
    except (KeyError, ValueError):
        return None
    return d


def parse_step_line(line):
    """ "~T 3" → 3（いま始まったステップ。0から数える）/ "~T -1" → -1（止まった）。この形でなければ None。
        ファームが、ステップの始まりと、停止の瞬間に出す。STATE を問い合わせる（約0.7秒おき）より、ずっと早く画面に届く """
    if not line.startswith("~T "):
        return None
    try:
        step = int(line[3:].strip())
    except ValueError:
        return None
    return step if -1 <= step <= 99 else None


class EventHub:
    """ ESP32 からの出来事（ステップが進んだ、など）を、開いている画面すべてに、すぐ届けるための配り役。
        画面は /api/events（Server-Sent Events）でつなぎ、publish された出来事を受け取る。
        新しくつないだ画面には、直前の出来事を1つ送る（開いた直後から、いまの位置が分かる） """

    def __init__(self):
        self._lock = threading.Lock()
        self._subs = set()
        self._last = None
        self.game_clients = 0          # いまつないでいる「ゲーム」の画面の数（/api/events?client=game）
        self.on_game_clients = None    # 数が変わったときに呼ぶ関数(数)。ブリッジは、これで MIDI 出力を止めたり戻したりする

    def game_client(self, delta):
        with self._lock:
            self.game_clients = max(0, self.game_clients + delta)
            n = self.game_clients
        if self.on_game_clients:
            self.on_game_clients(n)

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self._lock:
            if self._last is not None:
                q.put_nowait(self._last)
            self._subs.add(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            self._subs.discard(q)

    def publish(self, event):
        with self._lock:
            self._last = event
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass   # 追いつけない画面の分は、あきらめる（次の出来事で追いつく）

    def close(self):
        """ つないでいる画面に、終わりを知らせる """
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(None)
            except queue.Full:
                pass


def parse_pattern_line(line):
    """ "~P drum 11 16 K=x...,S=.... 名前" / "~P backing 11 16 C------- 名前" → 辞書。なければ exists=False。形が違えば None """
    if not line.startswith("~P "):
        return None
    parts = line[3:].split(" ", 4)
    if len(parts) < 5:
        return None
    kind, ident, length, data, name = parts
    try:
        ident = int(ident)
        length = int(length)
    except ValueError:
        return None
    if kind not in ("drum", "backing"):
        return None
    if length == 0:
        return {"kind": kind, "id": ident, "exists": False}
    result = {"kind": kind, "id": ident, "exists": True, "length": length, "name": name}
    if kind == "drum":
        lanes = {}
        if data != "-":
            for item in data.split(","):
                lane, _, text = item.partition("=")
                lanes[lane] = text
        result["lanes"] = lanes
    else:
        result["cells"] = data
    return result


# ---------------------------------------------------------------------------
# 操作画面（BPM・キー・パターン選択など）の操作 → ESP32 のコマンド
# ---------------------------------------------------------------------------

KEY_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def _int_in(req, lo, hi, what):
    v = req.get("value")
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise ValueError("%s は %d〜%d の整数です" % (what, lo, hi))
    return v


def build_control_commands(req):
    """ {"action":"bpm","value":120} など → ESP32 のコマンドの行。使えない内容は ValueError """
    if not isinstance(req, dict):
        raise ValueError("送られた内容が正しくありません")
    action = req.get("action")
    if action == "bpm":
        return ["BPM %d" % _int_in(req, 30, 240, "BPM")]
    if action == "key":
        v = req.get("value")
        if v not in KEY_NAMES:
            raise ValueError("キーは %s のどれかです" % " ".join(KEY_NAMES))
        return ["KEY %s" % v]
    if action == "key_shift":
        v = req.get("value")
        if v not in (-1, 1) or isinstance(v, bool):
            raise ValueError("キーの上げ下げは -1 か +1 です")
        return ["KEY %s1" % ("+" if v > 0 else "-")]
    if action in ("drum", "backing"):
        v = _int_in(req, 0, 20, "パターン番号")
        name = action.upper()
        return ["%s OFF" % name] if v == 0 else ["%s %d" % (name, v)]
    if action == "lead":
        if not isinstance(req.get("value"), bool):
            raise ValueError("ON か OFF です")
        return ["LEAD ON" if req["value"] else "LEAD OFF"]
    if action == "voicing":
        v = req.get("value")
        if v not in (3, 4) or isinstance(v, bool):
            raise ValueError("音の数は 3 か 4 です")
        return ["VOICING %d" % v]
    if action in ("map_learn", "map_done", "map_cancel", "map_reset"):
        return ["MAP %s" % action[4:].upper()]
    if action == "map":
        v = req.get("value")
        if (not isinstance(v, list) or not 1 <= len(v) <= 8 or sorted(v) != list(range(1, len(v) + 1))
                or any(isinstance(x, bool) or not isinstance(x, int) for x in v)):
            raise ValueError("配置は、1〜台数の番号を、重ならないように並べます")
        return ["MAP " + " ".join(str(x) for x in v)]
    if action == "octave":
        return ["OCTAVE %d" % _int_in(req, -1, 3, "高さ")]
    if action == "play":
        if not isinstance(req.get("value"), bool):
            raise ValueError("再生は true か false です")
        return ["START" if req["value"] else "STOP"]
    if action == "autostart":
        if not isinstance(req.get("value"), bool):
            raise ValueError("自動再生は true か false です")
        return ["AUTOSTART ON" if req["value"] else "AUTOSTART OFF"]
    if action == "buzzer":   # 基板のブザーを鳴らすか（2026-11-18。夜中の作業・書き込みのときは OFF）
        if not isinstance(req.get("value"), bool):
            raise ValueError("ブザーは true（ON）か false（OFF）です")
        return ["BUZZER ON" if req["value"] else "BUZZER OFF"]
    if action == "status":   # 診断: ESP32 の状態（読み取りの時間・止め方・受信感度など）を、ブリッジのログに出す
        return ["STATUS"]
    if action == "shadowlog":   # 診断: 駒の判定の理由（[イベントの原因]・[読み取りの乱れ]・[読み取りの救済]・[影の判定]）を、ブリッジのログに出す
        if not isinstance(req.get("value"), bool):
            raise ValueError("診断ログは true か false です")
        return ["SHADOWLOG ON" if req["value"] else "SHADOWLOG OFF"]
    if action == "retest":   # 診断: リーダー n（value: 1〜8）の駒を、載せたまま、新しく置かれた駒として見つけ直すまでの時間を測る（結果は、ブリッジのログの [再検出] の行）
        return ["RETEST %d" % _int_in(req, 1, 8, "リーダー番号")]
    if action == "margin":   # 診断: 受信感度ごとの「読めた回数」（電波の余裕）。value: 1〜8 でそのリーダーだけ。なければ全部（数秒かかる）
        if req.get("value") is None:
            return ["MARGIN"]
        return ["MARGIN %d" % _int_in(req, 1, 8, "リーダー番号")]
    if action == "rstat":   # 診断: リーダーごとの読み取りの統計を、ブリッジのログに出す（value: "reset" なら、数え直す）
        if req.get("value") not in (None, "reset"):
            raise ValueError("統計は、表示（value なし）か、数え直し（value: reset）です")
        return ["RSTAT RESET" if req.get("value") == "reset" else "RSTAT"]
    raise ValueError("その操作は使えません")


def load_page():
    with open(os.path.join(EDITOR_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read()
    with open(os.path.join(EDITOR_DIR, "presets.json"), encoding="utf-8") as f:
        presets = f.read()
    return html.replace("__PRESETS__", presets)


def make_server(port, send_lines, status=None, control=None, get_state=None, refresh=None, live=None, events=None, game_dir=GAME_DIR, bridge=None, library=None):
    """ send_lines(lines): パターンの保存など、時間のかかるコマンドを ESP32 に送る関数。
        control(lines): BPM・キーなど、すぐ送りたいコマンドを送る関数。get_state(): 画面に見せる ESP32 の状態（辞書）。
        refresh(): 自分のパターンの一覧を、ESP32 から読み直す。status(): 接続状態の文字（省略可）。
        events: EventHub。あれば /api/events で、ESP32 の出来事（ステップの進み）を画面に即時に流す。
        game_dir: あれば、その中身を /game/ で配る（読み取り専用。外に出る道は通さない）。
        port=0 なら、空いている番号を自動で選ぶ。127.0.0.1 だけで待つ """
    page = load_page().encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        server_version = "RhythmEditor"

        def log_message(self, *args):  # 画面を汚さない
            pass

        def _host_ok(self):
            # 他のサイトから、この画面のふりをして送られること（DNS rebinding）を防ぐ: ホスト名を確かめる
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self._host_ok():
                return self._send(403, b"{}")
            if self.path in ("/", "/index.html"):
                return self._send(200, page, "text/html; charset=utf-8")
            if self.path.split("?")[0] == "/game":
                self.send_response(301); self.send_header("Location", "/game/"); self.send_header("Content-Length", "0"); self.end_headers()
                return
            if self.path.startswith("/game/") and game_dir:
                return self._send_game_file()
            if self.path == "/api/library":
                if library is None:
                    return self._send(404, json.dumps({"ok": False, "error": "ライブラリがありません"}, ensure_ascii=False).encode("utf-8"))
                return self._send(200, json.dumps({"ok": True, "library": library.snapshot()}, ensure_ascii=False).encode("utf-8"))
            if self.path == "/api/state":
                state = get_state() if get_state else {"connected": False}
                return self._send(200, json.dumps(state, ensure_ascii=False).encode("utf-8"))
            if self.path == "/api/status":
                text = status() if status else ""
                return self._send(200, json.dumps({"ok": True, "status": text}, ensure_ascii=False).encode("utf-8"))
            if self.path.split("?")[0] == "/api/events" and events is not None:
                # ?client=game: ゲームの画面。つながっている間、ブリッジは MIDI の出力を止める（音はゲームが鳴らすので、GarageBand などと二重に鳴らない）
                query = self.path.split("?", 1)[1] if "?" in self.path else ""
                return self._stream_events(is_game=("client=game" in query.split("&")))
            self._send(404, b"{}")

        def _send_game_file(self):
            rel = urllib.parse.unquote(self.path.split("?", 1)[0][len("/game/"):])
            if rel == "" or rel.endswith("/"):
                rel += "index.html"
            root = os.path.realpath(game_dir)
            full = os.path.realpath(os.path.join(root, rel))
            if not (full == root or full.startswith(root + os.sep)) or not os.path.isfile(full):   # game/ の外へ出る道（../）は通さない
                return self._send(404, b"{}")
            ext = os.path.splitext(full)[1].lower()
            ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as f:
                body = f.read()
            self._send(200, body, ctype)

        def _stream_events(self, is_game=False):
            # Server-Sent Events: つないだままにして、出来事が起きた瞬間に、1件ずつ流す
            q = events.subscribe()
            if is_game:
                events.game_client(+1)
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
                while True:
                    try:
                        ev = q.get(timeout=2)
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")   # つながっているか確かめる（切れていれば、ここで例外になって終わる）。2秒ごと: ゲームが閉じたことに、早く気づくため
                        self.wfile.flush()
                        continue
                    if ev is None:
                        break
                    self.wfile.write(("data: " + json.dumps(ev, ensure_ascii=False) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                events.unsubscribe(q)
                if is_game:
                    events.game_client(-1)

        def do_POST(self):
            if not self._host_ok():
                return self._send(403, b"{}")
            if self.path not in ("/api/save", "/api/live", "/api/control", "/api/refresh", "/api/bridge", "/api/library"):
                return self._send(404, b"{}")
            # JSON 以外(text/plain など)は受けない。他のサイトの画面から、勝手に送られるのを防ぐ
            if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
                return self._send(415, json.dumps({"ok": False, "error": "JSON ではありません"}, ensure_ascii=False).encode("utf-8"))
            try:
                size = int(self.headers.get("Content-Length") or 0)
                if size < 0 or size > 20000 or (size == 0 and self.path != "/api/refresh"):
                    raise ValueError("送られた内容の大きさが正しくありません")
                req = json.loads(self.rfile.read(size).decode("utf-8") or "{}")
                if self.path == "/api/refresh":
                    lines = []
                elif self.path == "/api/bridge":
                    if not isinstance(req, dict) or req.get("action") not in ("connect", "release"):
                        raise ValueError("その操作は使えません")
                    lines = []
                elif self.path == "/api/library":
                    if library is None:
                        raise ValueError("ライブラリがありません")
                    if not isinstance(req, dict) or req.get("op") not in ("put", "delete"):
                        raise ValueError("その操作は使えません")
                    if req["op"] == "put":
                        saved = library.put(req.get("kind"), req.get("item"))
                    else:
                        saved = library.delete(req.get("kind"), req.get("id"))
                    lines = []
                elif self.path == "/api/control":
                    lines = build_control_commands(req)
                elif self.path == "/api/live":
                    lines = build_live_commands(req)
                else:
                    lines = build_commands(req)
            except (ValueError, UnicodeDecodeError) as e:
                return self._send(400, json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8"))
            if self.path == "/api/bridge":
                result = bridge(req.get("action")) if bridge else {"ok": False, "error": "ブリッジの機能がありません"}
                return self._send(200, json.dumps(result, ensure_ascii=False).encode("utf-8"))
            if self.path == "/api/library":
                if events is not None:
                    events.publish({"type": "library", "seq": library.snapshot()["seq"], "t": int(time.time() * 1000)})    # ゲームに、すぐ知らせる
                return self._send(200, json.dumps({"ok": True, "item": saved, "seq": library.snapshot()["seq"]}, ensure_ascii=False).encode("utf-8"))
            if self.path == "/api/refresh":
                if refresh:
                    refresh()
            elif self.path == "/api/control":
                (control or send_lines)(lines)
            elif self.path == "/api/live":
                (live or send_lines)(lines)
            else:
                send_lines(lines)
            self._send(200, json.dumps({"ok": True, "lines": lines}, ensure_ascii=False).encode("utf-8"))

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def start_in_thread(port, send_lines, status=None, **kwargs):
    server = make_server(port, send_lines, status, **kwargs)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server
