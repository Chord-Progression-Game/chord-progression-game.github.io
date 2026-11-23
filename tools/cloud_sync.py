# -*- coding: utf-8 -*-
"""
リズム・コード編集の画面で作った、ドラム・バッキング・進行（ライブラリ）を、公開ページ（GitHub Pages）のゲームへ、リアルタイムで送る（2026-11-24）。

■ しくみ
  ・Firebase Realtime Database（無料枠。Google のサービス）に、ライブラリ全体を、1つの JSON として書きこむ（REST の PUT）。
  ・公開ページのゲームは、同じ場所を、読むだけ（EventSource で、変わった瞬間に届く。届かないときは、数秒ごとに読み直す）。→ game/js/net/cloud.js
  ・書きこめるのは、この Mac のブリッジだけ（秘密のキーを持っているため）。読むのは、だれでも（公開）。
  ・書きこむための鍵は、2通り（どちらか1つ）:
      ① サービスアカウントのキー（JSON ファイル。Firebase の「プロジェクトの設定 → サービス アカウント → 新しい秘密鍵を生成」でもらう。いま、Google がすすめている方法）
         → この中の秘密鍵で、1時間だけ使える「アクセス トークン」を作って（OAuth2）、それで書きこむ。署名は、Mac にある openssl の命令で行う（追加のソフトは、いらない）。
      ② Database secret（古い方式。まだ使えるが、新しいプロジェクトでは、見つからないことがある）
  ・鍵は、この Mac の ~/Library/Application Support/ChordToy/cloud.json（自分だけが読める設定: chmod 600）にだけ保存する。
    画面・ログ・ゲームのファイル（GitHub に上がるもの）には、出さない。
  ・設定していなければ、何もしない（これまでどおり、ローカルのゲームだけに届く）。

■ 設定のしかた: docs/cloud_setup.md（Firebase のプロジェクトを作る → ルール → 秘密のキー → 編集の画面に入れる）

■ 送る内容: { app: 'chord-lines-library', v: 1, at: 送った時刻（ミリ秒）, seq: ライブラリの番号, drums: […], backings: […], progressions: […] }
    （ゲーム側が、受け取ったときに、ブリッジと同じ厳しさで検査する。net/share.js の sanitizeShared）

標準の Python だけで動く（urllib）。ネットワークの失敗では、ブリッジを止めない（あとで、くり返し送りなおす）。
"""
import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

APP = "chord-lines-library"
VERSION = 1
DEFAULT_PATH = "chordlines/library"
HOST_OK = re.compile(r"^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$")
PATH_OK = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,4}$")
TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email"
RETRY_SECONDS = (5, 15, 45, 120)          # 失敗したときの、待ち時間（だんだん長く。いちばん長いのが、くり返す）
DEBOUNCE = 0.4                            # 変更が続くときは、まとめて送る（秒）


def default_config_path():
    return os.environ.get("CHORDTOY_CLOUD") or os.path.join(os.path.expanduser("~"), "Library", "Application Support", "ChordToy", "cloud.json")


def check_url(url, allow_local=False):
    """ データベースの URL を検査して、「https://〜.firebaseio.com」の形にそろえる。正しくなければ ValueError """
    if not isinstance(url, str):
        raise ValueError("データベースの URL が、文字ではありません")
    u = url.strip().rstrip("/")
    m = re.match(r"^(https?)://([^/?#:]+)(:\d+)?$", u)
    if not m:
        raise ValueError("データベースの URL の形が正しくありません（例: https://あなたの名前-default-rtdb.firebaseio.com）")
    scheme, host = m.group(1), m.group(2).lower()
    if allow_local and host in ("127.0.0.1", "localhost"):
        return u
    if scheme != "https" or not HOST_OK.match(host):
        raise ValueError("データベースの URL は、https:// で始まって、firebaseio.com か firebasedatabase.app で終わるものです")
    return "https://" + host + (m.group(3) or "")


def check_path(path):
    p = (path or DEFAULT_PATH).strip().strip("/")
    if not PATH_OK.match(p):
        raise ValueError("保存する場所の名前が正しくありません（英数字・- ・_ ・/ だけ）")
    return p


def check_service_account(obj, allow_local=False):
    """ サービスアカウントのキー（JSON）→ 必要な部分だけ取り出す。形が違えば ValueError """
    if not isinstance(obj, dict) or obj.get("type") != "service_account":
        raise ValueError("サービスアカウントのキー（Firebase でもらった JSON）では、ありません")
    mail, key = obj.get("client_email"), obj.get("private_key")
    if not isinstance(mail, str) or not re.match(r"^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$", mail):
        raise ValueError("キーの中の client_email が、正しくありません")
    if not isinstance(key, str) or "-----BEGIN" not in key or "PRIVATE KEY-----" not in key or len(key) > 6000:
        raise ValueError("キーの中の private_key が、正しくありません")
    uri = obj.get("token_uri") or TOKEN_URI
    if uri != TOKEN_URI and not (allow_local and re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/", str(uri))):
        raise ValueError("キーの中の token_uri が、Google のものではありません")
    return {"client_email": mail, "private_key": key, "token_uri": uri, "project_id": obj.get("project_id") if isinstance(obj.get("project_id"), str) else ""}


def _b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def make_jwt(sa, now=None):
    """ サービスアカウントの秘密鍵で、署名した JWT（OAuth2 の、トークンをもらうための申込書）を作る。署名は openssl の命令で（追加のソフトは、いらない）"""
    now = int(now if now is not None else time.time())
    head = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claim = _b64url(json.dumps({"iss": sa["client_email"], "scope": SCOPE, "aud": sa["token_uri"], "iat": now, "exp": now + 3600}, separators=(",", ":")).encode())
    signing_input = (head + "." + claim).encode("ascii")
    fd, path = tempfile.mkstemp(prefix="chordtoy_key_")
    try:
        os.write(fd, sa["private_key"].encode("utf-8"))
        os.close(fd)
        os.chmod(path, 0o600)
        r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", path], input=signing_input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        if r.returncode != 0 or not r.stdout:
            raise ValueError("秘密鍵で署名できませんでした（キーが、こわれていないか、確かめてください）")
        return head + "." + claim + "." + _b64url(r.stdout)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def snapshot_payload(library_snapshot):
    """ ライブラリ（Library.snapshot()）→ 送る内容 """
    s = library_snapshot
    return {"app": APP, "v": VERSION, "at": int(time.time() * 1000), "seq": s.get("seq", 0),
            "drums": s.get("drums", []), "backings": s.get("backings", []), "progressions": s.get("progressions", [])}


class CloudSync(object):
    def __init__(self, library, config_path=None, allow_local=None, opener=None):
        self.library = library
        self.config_path = config_path or default_config_path()
        self.allow_local = bool(os.environ.get("CHORDTOY_CLOUD_ALLOW_LOCAL")) if allow_local is None else allow_local
        self._open = opener or (lambda req, timeout: urllib.request.urlopen(req, timeout=timeout))
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stop_flag = False
        self.cfg = None                       # { url, path, secret } か { url, path, service_account }
        self._token = None                    # 作ってある、アクセス トークン（サービスアカウントのとき）と、使える期限
        self._token_exp = 0
        self.pending = False
        self._gen = 0                         # ライブラリが変わるたびに、ふえる（送っている間の変更を、見のがさないため）
        self.state = "off"                    # off | idle | pushing | ok | error
        self.last_ok = None
        self.last_error = ""
        self.pushes = 0
        self._thread = None
        self._load()

    # ---- 設定の保存・読み込み（秘密のキーは、このファイルにだけ）----
    def _load(self):
        try:
            with open(self.config_path, encoding="utf-8") as f:
                d = json.load(f)
            url = check_url(d.get("url"), self.allow_local)
            path = check_path(d.get("path"))
            secret, sa = d.get("secret"), d.get("service_account")
            if isinstance(sa, dict):
                self.cfg = {"url": url, "path": path, "service_account": check_service_account(sa, self.allow_local)}
            elif isinstance(secret, str) and secret.strip():
                self.cfg = {"url": url, "path": path, "secret": secret.strip()}
            else:
                return
            self.state = "idle"
        except (OSError, ValueError, TypeError):
            self.cfg = None

    def _save(self):
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        tmp = self.config_path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)          # 自分だけが読める
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, ensure_ascii=False)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.config_path)

    def configured(self):
        return self.cfg is not None

    def status(self):
        """ 画面に出す状態。秘密のキーは、入れない """
        with self.lock:
            return {"configured": self.cfg is not None, "url": self.cfg["url"] if self.cfg else "", "path": self.cfg["path"] if self.cfg else DEFAULT_PATH,
                    "auth": ("service_account" if self.cfg and "service_account" in self.cfg else "secret") if self.cfg else "",
                    "state": self.state, "pending": self.pending, "pushes": self.pushes, "last_ok": self.last_ok, "last_error": self.last_error,
                    "game_url": (self.cfg["url"] + "/" + self.cfg["path"] + ".json") if self.cfg else ""}

    # ---- 送る ----
    def _endpoint(self):
        return "%s/%s.json" % (self.cfg["url"], self.cfg["path"])

    def _friendly(self, e):
        """ 失敗の理由（秘密のキーを含む、URL・応答の中身は、出さない）"""
        if isinstance(e, urllib.error.HTTPError):
            if e.code in (401, 403):
                return "書きこめませんでした（%d）。鍵が違うか、データベースのルールが、書きこみをふさいでいます" % e.code
            if e.code == 404:
                return "データベースが見つかりません（404）。URL を確かめてください"
            return "データベースが、エラーを返しました（%d）" % e.code
        if isinstance(e, urllib.error.URLError):
            return "つながりませんでした（ネットワークを確かめてください）"
        return "送れませんでした（%s）" % type(e).__name__

    def _put_once(self):
        with self.lock:
            cfg = dict(self.cfg)
        payload = json.dumps(snapshot_payload(self.library.snapshot()), ensure_ascii=False).encode("utf-8")
        if len(payload) > 900000:
            raise ValueError("ライブラリが大きすぎて、送れません（いらないものを削除してください）")
        if "service_account" in cfg:
            auth = "access_token=" + urllib.parse.quote(self._access_token(cfg["service_account"]), safe="")
        else:
            auth = "auth=" + urllib.parse.quote(cfg["secret"], safe="")
        url = "%s/%s.json?%s" % (cfg["url"], cfg["path"], auth)
        req = urllib.request.Request(url, data=payload, method="PUT", headers={"Content-Type": "application/json; charset=utf-8"})
        with self._open(req, 12) as r:
            r.read(2000)

    def _access_token(self, sa):
        """ サービスアカウントの、アクセス トークン（1時間だけ有効）。期限の5分前までは、作ったものを使う """
        with self.lock:
            if self._token and time.time() < self._token_exp - 300:
                return self._token
        jwt = make_jwt(sa)
        data = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt}).encode("ascii")
        req = urllib.request.Request(sa["token_uri"], data=data, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
        with self._open(req, 12) as r:
            res = json.loads(r.read(20000).decode("utf-8"))
        tok = res.get("access_token")
        if not isinstance(tok, str) or not tok:
            raise ValueError("アクセス トークンをもらえませんでした")
        with self.lock:
            self._token, self._token_exp = tok, time.time() + float(res.get("expires_in") or 3600)
        return tok

    def push_now(self):
        """ すぐ送る（同じスレッドで）。戻り値: 状態の辞書。設定がなければ、何もしない """
        with self.lock:
            if self.cfg is None:
                return self.status()
            self.state = "pushing"
            gen0 = self._gen
        try:
            self._put_once()
            with self.lock:
                self.state, self.last_ok, self.last_error = "ok", int(time.time() * 1000), ""
                self.pending = self._gen != gen0               # 送っている間に、また変わっていたら、もう一度
                self.pushes += 1
        except Exception as e:  # noqa: BLE001  ネットワーク・書式・何でも: ブリッジは、止めない
            with self.lock:
                self.state = "error"
                self.last_error = str(e) if isinstance(e, ValueError) else self._friendly(e)
                self.pending = True
        return self.status()

    # ---- 設定を変える（画面から）----
    def configure(self, url, secret=None, path=None, test=True, service_account=None):
        """ 設定して、保存する。鍵は、service_account（キーの JSON の辞書）か secret（Database secret）のどちらか。
            test=True なら、すぐ1回送って、書きこめるかを確かめる（失敗したら、保存しない）。戻り値: 状態 """
        u = check_url(url, self.allow_local)
        p = check_path(path)
        if service_account is not None:
            cfg = {"url": u, "path": p, "service_account": check_service_account(service_account, self.allow_local)}
        else:
            if not isinstance(secret, str) or not secret.strip():
                raise ValueError("鍵（サービスアカウントのキー、または、秘密のキー）を入れてください")
            if len(secret.strip()) > 400 or re.search(r"\s", secret.strip()):
                raise ValueError("秘密のキーの形が正しくありません")
            cfg = {"url": u, "path": p, "secret": secret.strip()}
        with self.lock:
            old = self.cfg
            self.cfg = cfg
            self._token, self._token_exp = None, 0
            self.state = "idle"
        if test:
            st = self.push_now()
            if st["state"] != "ok":
                with self.lock:
                    self.cfg = old
                    self.state = "idle" if old else "off"
                raise ValueError(st["last_error"] or "送れませんでした")
        with self.lock:
            self._save()
        self.start()
        return self.status()

    def clear(self):
        with self.lock:
            self.cfg = None
            self._token, self._token_exp = None, 0
            self.state, self.pending, self.last_error = "off", False, ""
            try:
                os.remove(self.config_path)
            except OSError:
                pass
        return self.status()

    # ---- ライブラリが変わったら、送る（バックグラウンド）----
    def notify(self):
        """ ライブラリが変わったときに、呼ぶ。送る必要があることを、覚えて、働くスレッドを起こす """
        with self.lock:
            if self.cfg is None:
                return
            self._gen += 1
            self.pending = True
        self.wake.set()

    def start(self):
        with self.lock:
            if self._thread is not None and self._thread.is_alive():
                if self.cfg is not None:
                    self.pending = True
                    self.wake.set()
                return
            if self.cfg is None:
                return
            self.stop_flag = False
            self.pending = True
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()
            self.wake.set()

    def stop(self):
        self.stop_flag = True
        self.wake.set()

    def _worker(self):
        tries = 0
        while not self.stop_flag:
            with self.lock:
                need = self.pending and self.cfg is not None
            if not need:
                self.wake.wait(timeout=30)              # 送るものがないあいだは、知らせを待つ
                self.wake.clear()
                continue
            time.sleep(DEBOUNCE)                        # 続けて変わったとき、まとめる
            self.wake.clear()
            if self.stop_flag:
                break
            st = self.push_now()
            if st["state"] == "ok":
                tries = 0
                continue
            wait = RETRY_SECONDS[min(tries, len(RETRY_SECONDS) - 1)]       # 失敗: 少し待って、やり直す（待つあいだに、設定が変わったら、すぐ）
            tries += 1
            end = time.time() + wait
            while time.time() < end and not self.stop_flag:
                if self.wake.wait(timeout=min(0.5, max(0.05, end - time.time()))):
                    self.wake.clear()
                    break
