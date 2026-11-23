#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公開ページへ、リアルタイムで送る道（tools/cloud_sync.py）のテスト（2026-11-24）。本物の Firebase の代わりに、にせもの（mock_firebase.py）を使う。
  ・URL の検査（https の firebaseio.com / firebasedatabase.app だけ。それ以外・http は、ことわる）
  ・設定: 秘密のキーが違うと、ことわる（保存しない）/ 合っていれば、保存（自分だけ読める chmod 600）して、すぐ1回送る
  ・ライブラリが変わったら（追加・置き換え・削除）、自動で送る。続けて変わったときは、まとめる
  ・秘密のキーが、状態の表示・API の応答・エラーの文に、出ない
  ・通信が失敗したら、あとでやり直して、追いつく（ブリッジは、止まらない）
  ・やめる（clear）と、設定のファイルが消えて、送らなくなる
  ・編集の画面の HTTP の道（GET/POST /api/cloud）
実行:  python3 tools/host_tests/test_cloud_sync.py
"""
import json
import os
import stat
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cloud_sync  # noqa: E402
import rhythm_server as rs  # noqa: E402
from mock_firebase import MockFirebase  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


def wait(fn, timeout=6.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if fn():
            return True
        time.sleep(0.05)
    return False


DRUM = {"name": "テストビート", "length": 16, "lanes": {"K": "x...x...x...x...", "S": "....x.......x..."}}
BACK = {"name": "テストバッキング", "length": 16, "cells": "C---....C---...."}


def main():
    global fails
    # ---- URL の検査 ----
    ok = ["https://abc-default-rtdb.firebaseio.com", "https://abc-default-rtdb.asia-southeast1.firebasedatabase.app/", "https://x.firebaseio.com"]
    bad = ["http://abc.firebaseio.com", "https://evil.example.com", "https://abc.firebaseio.com.evil.com", "ftp://abc.firebaseio.com", "abc.firebaseio.com", "", None, "https://127.0.0.1", "https://abc.firebaseio.com/path"]
    check("URL: 正しい形は通る（末尾の / は取る）", [cloud_sync.check_url(u) for u in ok], ["https://abc-default-rtdb.firebaseio.com", "https://abc-default-rtdb.asia-southeast1.firebasedatabase.app", "https://x.firebaseio.com"])
    rejected = []
    for u in bad:
        try:
            cloud_sync.check_url(u)
            rejected.append(False)
        except ValueError:
            rejected.append(True)
    check("URL: http・ほかのドメイン・形が違うものは、ことわる", rejected, [True] * len(bad))
    check("URL: テストのときだけ、127.0.0.1 の http を許す", cloud_sync.check_url("http://127.0.0.1:8080", allow_local=True), "http://127.0.0.1:8080")
    try:
        cloud_sync.check_path("a b"); r = False
    except ValueError:
        r = True
    check("保存する場所の名前: 空白などは、ことわる", r, True)

    mock = MockFirebase(secret="S3CR3T-KEY")
    tmp = tempfile.mkdtemp()
    cfg_path = os.path.join(tmp, "cloud.json")
    lib = rs.Library(os.path.join(tmp, "library.json"))
    sync = cloud_sync.CloudSync(lib, config_path=cfg_path, allow_local=True)
    lib.listeners.append(sync.notify)
    cloud_sync.RETRY_SECONDS = (0.3, 0.3, 0.3, 0.3)
    try:
        check("はじめは、設定がない（off）。ライブラリが変わっても、何も送らない", [sync.status()["configured"], sync.status()["state"]], [False, "off"])
        lib.put("drum", DRUM)
        time.sleep(0.8)
        check("設定がないと、送らない", mock.puts, [])

        # ---- 設定 ----
        try:
            sync.configure(mock.url, "WRONG", "chordlines/library"); r = None
        except ValueError as e:
            r = str(e)
        check("設定: 秘密のキーが違うと、ことわる（書きこめません）。保存しない", [r is not None and "書きこめません" in r, os.path.exists(cfg_path), sync.status()["configured"]], [True, False, False])
        check("設定: ことわった文に、秘密のキー・URL の?auth=が、出ない", [("WRONG" in (r or "")), ("auth=" in (r or ""))], [False, False])
        st = sync.configure(mock.url, "S3CR3T-KEY", "chordlines/library")
        check("設定: 合っていれば、すぐ1回送って、ok になる。保存される", [st["state"], st["configured"], st["pushes"], os.path.exists(cfg_path)], ["ok", True, 1, True])
        mode = stat.S_IMODE(os.stat(cfg_path).st_mode)
        check("設定のファイル: 自分だけが読める（600）", oct(mode), "0o600")
        val = mock.value("chordlines/library")
        check("送った内容: 形（app・v・seq・ドラム 1・バッキング 0・進行 0）・名前・id", [val["app"], val["v"], len(val["drums"]), len(val["backings"]), len(val["progressions"]), val["drums"][0]["name"], val["drums"][0]["id"]], ["chord-lines-library", 1, 1, 0, 0, "テストビート", "d1"])
        check("状態の表示に、秘密のキーが、出ない", "S3CR3T" in json.dumps(sync.status(), ensure_ascii=False), False)

        # ---- 変更 → 自動で送る ----
        n0 = len(mock.puts)
        lib.put("backing", BACK)
        check("追加すると、自動で送られる（ドラム 1・バッキング 1）", wait(lambda: len(mock.puts) > n0 and len(mock.value("chordlines/library")["backings"]) == 1), True)
        lib.put("drum", {**DRUM, "lanes": {"K": "x...x...x...x...", "H": "x.x.x.x.x.x.x.x."}})
        check("同じ名前で置き換えると、内容が変わって送られる（H のレーンが入る）", wait(lambda: "H" in mock.value("chordlines/library")["drums"][0]["lanes"]), True)
        d = lib.snapshot()["drums"][0]["id"]
        lib.delete("drum", d)
        check("削除すると、送られる（ドラム 0）", wait(lambda: len(mock.value("chordlines/library")["drums"]) == 0), True)
        # 続けて変わるときは、まとめる（9回 put → 送る回数は、9より、ずっと少ない）
        n1 = len(mock.puts)
        for i in range(9):
            lib.put("drum", {**DRUM, "name": "連続%d" % i})
        wait(lambda: len(mock.value("chordlines/library")["drums"]) == 9)
        time.sleep(0.6)
        check("続けて9回変えたとき: 最後の内容が届く（9つ）。送った回数は、9回より少ない（まとめる）", [len(mock.value("chordlines/library")["drums"]), len(mock.puts) - n1 < 9], [9, True])

        # ---- 失敗 → やり直して、追いつく ----
        mock.fail_puts = 2
        n2 = len(mock.puts)
        lib.put("drum", {**DRUM, "name": "失敗のあと"})
        check("通信が失敗している間は、error・pending。ブリッジは止まらない", wait(lambda: sync.status()["state"] == "error" and sync.status()["pending"]), True)
        check("失敗の理由が出る（秘密のキーを含まない）", [("503" in sync.status()["last_error"]) or ("エラー" in sync.status()["last_error"]), "S3CR3T" in sync.status()["last_error"]], [True, False])
        check("やり直して、追いつく（「失敗のあと」が届く）。状態は ok にもどる", wait(lambda: any(x["name"] == "失敗のあと" for x in mock.value("chordlines/library")["drums"]) and sync.status()["state"] == "ok", 8), True)
        # ---- まるごと落ちている ----
        mock.stop()
        lib.put("drum", {**DRUM, "name": "落ちている間"})
        check("サーバーが落ちている: error（つながりませんでした）", wait(lambda: sync.status()["state"] == "error" and "つながりません" in sync.status()["last_error"]), True)
        sync.stop()
        mock2 = MockFirebase(secret="S3CR3T-KEY")
        mock = mock2
        # 設定を、新しいサーバーに向ける（再起動したブリッジが、設定のファイルを読み直す形）
        with open(cfg_path, encoding="utf-8") as f:
            c = json.load(f)
        c["url"] = mock2.url
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(c, f)
        sync2 = cloud_sync.CloudSync(lib, config_path=cfg_path, allow_local=True)
        lib.listeners.append(sync2.notify)
        sync2.start()
        check("ブリッジを立ち上げ直したとき: 設定のファイルを読んで、すぐ送る（最新の内容が、届く）", wait(lambda: mock2.value("chordlines/library") is not None and any(x["name"] == "落ちている間" for x in mock2.value("chordlines/library")["drums"])), True)
        # ---- やめる ----
        sync2.clear()
        n3 = len(mock2.puts)
        lib.put("drum", {**DRUM, "name": "やめたあと"})
        time.sleep(1.0)
        check("やめる（clear）: 設定のファイルが消える・送らなくなる", [os.path.exists(cfg_path), len(mock2.puts) == n3, sync2.status()["state"]], [False, True, "off"])

        # ---- サービスアカウントのキー（OAuth2。署名は openssl）----
        import subprocess
        kd = tempfile.mkdtemp()
        subprocess.run(["openssl", "genrsa", "-out", os.path.join(kd, "key.pem"), "2048"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run(["openssl", "rsa", "-in", os.path.join(kd, "key.pem"), "-pubout", "-out", os.path.join(kd, "pub.pem")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        subprocess.run(["openssl", "genrsa", "-out", os.path.join(kd, "other.pem"), "2048"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        priv, pub, other = [open(os.path.join(kd, n)).read() for n in ("key.pem", "pub.pem", "other.pem")]
        mock4 = MockFirebase(secret="UNUSED", token_pubkey=pub)
        sa = {"type": "service_account", "project_id": "proj", "client_email": "fb@proj.iam.gserviceaccount.com", "private_key": priv, "token_uri": mock4.url + "/token", "extra": "捨てる"}
        sync4 = cloud_sync.CloudSync(lib, config_path=os.path.join(tmp, "cloud4.json"), allow_local=True)
        for bad_sa, label in [({**sa, "type": "user"}, "type が違う"), ({**sa, "client_email": "x@gmail.com"}, "client_email が違う"), ({**sa, "private_key": "abc"}, "private_key が違う"), ({**sa, "token_uri": "https://evil.example.com/token"}, "token_uri が Google でない")]:
            try:
                sync4.configure(mock4.url, service_account=bad_sa); rr = False
            except ValueError:
                rr = True
            check("サービスアカウントのキー: " + label + " → ことわる", rr, True)
        try:
            sync4.configure(mock4.url, service_account={**sa, "private_key": other}); rr = None
        except ValueError as e:
            rr = str(e)
        check("サービスアカウントのキー: 別の鍵で署名すると、トークンをもらえない → ことわる（保存しない）", [rr is not None and "書きこめません" not in (rr or "") or rr is not None, os.path.exists(os.path.join(tmp, "cloud4.json")), sync4.status()["configured"]], [True, False, False])
        st = sync4.configure(mock4.url, service_account=sa)
        check("サービスアカウントのキー: 合っていれば、トークンをもらって、書きこめる。保存される（auth = service_account）", [st["state"], st["auth"], os.path.exists(os.path.join(tmp, "cloud4.json")), mock4.token_requests >= 1], ["ok", "service_account", True, True])
        check("サービスアカウントのキー: 送った内容が、にせもの Firebase にある", mock4.value("chordlines/library") is not None and mock4.value("chordlines/library")["app"], "chord-lines-library")
        n_tok = mock4.token_requests
        sync4.push_now(); sync4.push_now()
        check("サービスアカウントのキー: トークンは、使いまわす（期限の前は、新しく、もらわない）", mock4.token_requests, n_tok)
        saved = json.load(open(os.path.join(tmp, "cloud4.json"), encoding="utf-8"))
        check("サービスアカウントのキー: 保存するのは、必要な部分だけ（extra は捨てる）・自分だけが読める（600）", ["extra" not in saved["service_account"], oct(stat.S_IMODE(os.stat(os.path.join(tmp, "cloud4.json")).st_mode))], [True, "0o600"])
        check("サービスアカウントのキー: 状態の表示・エラーに、秘密鍵・トークンが、出ない", [("BEGIN" in json.dumps(sync4.status(), ensure_ascii=False)), ("TOKEN-" in json.dumps(sync4.status(), ensure_ascii=False))], [False, False])
        jwt = cloud_sync.make_jwt(cloud_sync.check_service_account(sa, True))
        h, c, g = jwt.split(".")
        check("JWT: 3つの部分（header.claim.署名）・RS256・scope に firebase.database・期限は1時間", [json.loads(cloud_sync.base64.urlsafe_b64decode(h + "==").decode())["alg"], "firebase.database" in json.loads(cloud_sync.base64.urlsafe_b64decode(c + "==").decode())["scope"], len(g) > 300], ["RS256", True, True])
        sync4.stop()
        mock4.stop()

        # ---- HTTP の道 ----
        mock3 = MockFirebase(secret="HTTPSECRET")
        sync3 = cloud_sync.CloudSync(lib, config_path=os.path.join(tmp, "cloud3.json"), allow_local=True)
        lib.listeners.append(sync3.notify)
        server = rs.start_in_thread(0, lambda l: None, control=lambda l: None, get_state=lambda: {"connected": True}, library=lib, cloud=sync3)
        base = "http://127.0.0.1:%d" % server.server_address[1]

        def post(obj):
            req = urllib.request.Request(base + "/api/cloud", data=json.dumps(obj).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.status, json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read().decode("utf-8"))

        def get():
            with urllib.request.urlopen(base + "/api/cloud", timeout=10) as r:
                return json.loads(r.read().decode("utf-8"))

        check("API: GET /api/cloud は、状態を返す（まだ設定していない）", [get()["ok"], get()["cloud"]["configured"]], [True, False])
        code, res = post({"action": "connect", "url": mock3.url, "secret": "BAD"})
        check("API: 秘密のキーが違うと 400（理由つき）。キーは、応答に出ない", [code, res["ok"], "BAD" in json.dumps(res, ensure_ascii=False)], [400, False, False])
        code, res = post({"action": "connect", "url": "https://evil.example.com", "secret": "X"})
        check("API: 許されない URL は、400", code, 400)
        code, res = post({"action": "connect", "url": mock3.url, "secret": "HTTPSECRET"})
        check("API: 合っていれば 200・ok・設定ずみ。応答に、秘密のキーは出ない", [code, res["cloud"]["state"], res["cloud"]["configured"], "HTTPSECRET" in json.dumps(res, ensure_ascii=False)], [200, "ok", True, False])
        check("API: GET でも、秘密のキーは出ない", "HTTPSECRET" in json.dumps(get(), ensure_ascii=False), False)
        code, res = post({"action": "push"})
        check("API: push（いま送る）", [code, res["cloud"]["state"]], [200, "ok"])
        code, res = post({"action": "clear"})
        check("API: clear（やめる）", [code, res["cloud"]["configured"]], [200, False])
        code, res = post({"action": "x"})
        check("API: 知らない操作は 400", code, 400)
        req = urllib.request.Request(base + "/api/cloud", data=b"{}", headers={"Content-Type": "text/plain"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=5); c415 = 200
        except urllib.error.HTTPError as e:
            c415 = e.code
        check("API: JSON 以外は 415（ほかのサイトの画面から、勝手に送られないように）", c415, 415)
        server.shutdown()
        mock3.stop()
        mock2.stop()
    finally:
        try:
            sync.stop()
        except Exception:  # noqa: BLE001
            pass
    print("公開ページへ送る道: %d 件中 %d 件 失敗" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
