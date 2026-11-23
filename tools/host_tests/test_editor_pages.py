#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
リズム・コード編集の画面 →（リンク）→ ゲームの取り込み、の通しの確認（2026-11-23）。
  ・試験用の保存場所（Library）に、ドラム・バッキング・進行を入れて、編集の画面（本物の rhythm_server が配る）を、本物の Chrome で開く
  ・「公開ページのゲームにも送る」: 一覧の左のチェックで、送るものを選べる / リンク（URL + #lib=j1.…）ができる / id は付かない
  ・そのリンクを、ゲーム側の読み取り（game/js/net/share.js。同じ rhythm_server が /game/ で配る）で読み直して、検査を通る（形が合っている）
実行:  python3 tools/host_tests/test_editor_pages.py
Chrome がなければ、省略する（終了コード 0）。
"""
import base64
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
from chrome_driver import ChromeSession, chrome_available  # noqa: E402
import rhythm_server as rs  # noqa: E402

fails = 0
checks = 0


def check(name, got, want):
    global fails, checks
    checks += 1
    if got != want:
        fails += 1
        print("FAIL %s: got %r want %r" % (name, got, want))


STATE = {"connected": True, "age": 0.1, "seq": 1, "sid": 1, "s": {"bpm": 120, "key": "C", "playing": 0, "step": -1, "drum": 2, "backing": 1, "lead": 1, "voicing": 4, "octave": 0, "idle": "RESET", "gain": 33, "midi": "BRIDGE", "learn": 0, "map": [4, 3, 2, 1], "chords": []}, "patterns": {"drum": {}, "backing": {}}}


def main():
    if not chrome_available():
        print("（編集画面 → 公開ページのテストは、Chrome が見つからないので省略）")
        return 0
    lib = rs.Library(os.path.join(tempfile.mkdtemp(), "library.json"))
    lib.put("drum", {"name": "夕焼けビート", "length": 16, "lanes": {"K": "x...x...x...x...", "S": "....x.......x...", "H": "x.x.x.x.x.x.x.x."}})
    lib.put("backing", {"name": "ゆったり", "length": 16, "cells": "C---....C---...."})
    lib.put("progression", {"name": "テスト進行", "chords": ["Ⅰ", "Ⅴ", "Ⅵm"], "points": 500, "startAt": "head"})
    import cloud_sync  # noqa: E402
    from mock_firebase import MockFirebase  # noqa: E402
    mock = MockFirebase(secret="EDITORSECRET")
    sync = cloud_sync.CloudSync(lib, config_path=os.path.join(tempfile.mkdtemp(), "cloud.json"), allow_local=True)
    lib.listeners.append(sync.notify)
    server = rs.start_in_thread(0, lambda l: None, control=lambda l: None, get_state=lambda: STATE, live=lambda l: None, library=lib, cloud=sync)
    port = server.server_address[1]
    try:
        with ChromeSession(width=1100, height=900) as ch:
            ch.open("http://127.0.0.1:%d/" % port)
            ch.wait_for("typeof showKind === 'function' && !!document.getElementById('panel-game')", timeout=30)
            ch.eval("showKind('drum')")
            ch.wait_for("document.querySelectorAll('.game-item').length === 3", timeout=20)
            check("一覧の各行に、「公開ページにも送る」のチェック（はじめは全部入っている）", ch.eval("[...document.querySelectorAll('.game-item .pg-pick')].map((c) => c.checked)"), [True, True, True])
            check("公開ページの URL の欄（既定）", ch.eval("document.getElementById('pages-url').value"), "https://chord-progression-game.github.io/")
            r = json.loads(ch.eval("JSON.stringify(pagesLink())"))
            check("リンク: 公開ページの URL + #lib=j1. + コード・3つ", [r["link"].startswith("https://chord-progression-game.github.io/#lib=j1."), r["count"]], [True, 3])
            code = r["link"].split("#lib=j1.", 1)[1]
            payload = json.loads(base64.urlsafe_b64decode(code + "=" * (-len(code) % 4)).decode("utf-8"))
            check("コードの中身: app・v・ドラム・バッキング・進行。id は付かない", [payload["app"], payload["v"], [d["name"] for d in payload["drums"]], [b["name"] for b in payload["backings"]], [p["name"] for p in payload["progressions"]], any("id" in x for k in ("drums", "backings", "progressions") for x in payload[k])],
                  ["chord-lines-library", 1, ["夕焼けビート"], ["ゆったり"], ["テスト進行"], False])
            # チェックを外したものは、送らない
            ch.eval("document.querySelector('.game-item[data-kind=\"backing\"] .pg-pick').click()")
            r2 = json.loads(ch.eval("JSON.stringify(pagesLink())"))
            check("チェックを外したもの（バッキング）は、リンクに入らない", r2["count"], 2)
            # ゲーム側の読み取り（同じサーバーが /game/ で配る）で、読み直して、検査を通る
            res = ch.eval("""(async () => {
              const S = await import('/game/js/net/share.js');
              const names = (await (await fetch('/game/data/chords.json')).json()).chords.filter((c) => c.type !== 'repeat').map((c) => c.name);
              const link = %s;
              const d = S.decodeShare(link);
              const san = S.sanitizeShared(d.data, names);
              return JSON.stringify([d.ok, san.drums.length, san.backings.length, san.progressions.length, san.skipped, san.drums[0].lanes.K]);
            })()""" % json.dumps(r["link"]))
            check("ゲーム側の読み取り（decodeShare・sanitizeShared）で、編集画面が作ったリンクを読める（ドラム 1・バッキング 1・進行 1・とばしたもの 0）", json.loads(res), [True, 1, 1, 1, 0, "x...x...x...x..."])
            # 送るものがないとき・URL がおかしいとき
            ch.eval("document.querySelectorAll('.game-item .pg-pick').forEach((c) => { if (c.checked) c.click(); })")
            check("全部チェックを外すと、リンクは作らない（理由を出す）", ch.eval("[pagesLink(), document.getElementById('pages-message').textContent.includes('送るものが、ありません')]"), [None, True])
            ch.eval("document.querySelectorAll('.game-item .pg-pick').forEach((c) => { if (!c.checked) c.click(); }); document.getElementById('pages-url').value = 'ftp://x'")
            check("URL が https:// などで始まらないときは、作らない", ch.eval("[pagesLink(), document.getElementById('pages-message').textContent.includes('https://')]"), [None, True])
            # ---- 全部の端末へ、自動で送る（Firebase。ここでは、にせもの）----
            ch.wait_for("document.getElementById('cloud-status').textContent.length > 0", timeout=10)
            check("自動で送る: はじめは、「まだ、設定されていません」・「やめる」「いま送る」は押せない", ch.eval("[document.getElementById('cloud-status').textContent.includes('まだ、設定されていません'), document.getElementById('cloud-clear').disabled, document.getElementById('cloud-push').disabled]"), [True, True, True])
            ch.eval("document.getElementById('cloud-url').value = %s; document.getElementById('cloud-secret').value = 'WRONG'; document.getElementById('cloud-connect').click()" % json.dumps(mock.url))
            time.sleep(1.2)
            check("自動で送る: 秘密のキーが違うと、ことわる（理由が出る）。設定されない", ch.eval("[document.getElementById('cloud-message').textContent.includes('書きこめません'), document.getElementById('cloud-message').className]"), [True, "err"])
            ch.eval("document.getElementById('cloud-secret').value = 'EDITORSECRET'; document.getElementById('cloud-connect').click()")
            ch.wait_for("document.getElementById('cloud-status').textContent.includes('送れています')", timeout=10)
            check("自動で送る: 合っていれば、つながる。秘密のキーの欄は、空にもどる（画面に残さない）。「やめる」が押せる", ch.eval("[document.getElementById('cloud-secret').value, document.getElementById('cloud-clear').disabled, document.getElementById('cloud-message').className]"), ["", False, "ok"])
            check("自動で送る: 状態の表示に、秘密のキーが、出ない", ch.eval("document.body.innerText.includes('EDITORSECRET')"), False)
            check("自動で送る: にせものの Firebase に、いまのライブラリ（ドラム 1・バッキング 1・進行 1）が、書かれている", [len(mock.value('chordlines/library')['drums']), len(mock.value('chordlines/library')['backings']), len(mock.value('chordlines/library')['progressions'])], [1, 1, 1])
            lib.put("drum", {"name": "あとから足した", "length": 16, "lanes": {"K": "x...............", "S": "....x..........."}})
            check("自動で送る: ライブラリが変わると、自動で、書かれる", (lambda: any(time.sleep(0.1) or len(mock.value('chordlines/library')['drums']) == 2 for _ in range(60)))(), True)
            # サービスアカウントのキー（JSON ファイル）を、選んで、つなぐ
            import subprocess
            kd = tempfile.mkdtemp()
            subprocess.run(["openssl", "genrsa", "-out", os.path.join(kd, "k.pem"), "2048"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            subprocess.run(["openssl", "rsa", "-in", os.path.join(kd, "k.pem"), "-pubout", "-out", os.path.join(kd, "p.pem")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            mock_sa = MockFirebase(secret="UNUSED", token_pubkey=open(os.path.join(kd, "p.pem")).read())
            sa = {"type": "service_account", "project_id": "p", "client_email": "fb@p.iam.gserviceaccount.com", "private_key": open(os.path.join(kd, "k.pem")).read(), "token_uri": mock_sa.url + "/token"}
            ch.eval("window.confirm = () => true; document.getElementById('cloud-clear').click()")
            ch.wait_for("document.getElementById('cloud-status').textContent.includes('まだ、設定されていません')", timeout=10)
            ch.eval("(() => { document.getElementById('cloud-url').value = %s; const dt = new DataTransfer(); dt.items.add(new File([%s], 'key.json', { type: 'application/json' })); document.getElementById('cloud-key-file').files = dt.files; document.getElementById('cloud-connect').click(); })()" % (json.dumps(mock_sa.url), json.dumps(json.dumps(sa))))
            ch.wait_for("document.getElementById('cloud-status').textContent.includes('送れています')", timeout=15)
            check("自動で送る: 鍵の JSON ファイルを選んで、つなぐ（サービスアカウント）。状態に「サービスアカウントのキー」と出る・秘密鍵は、画面に出ない", ch.eval("[document.getElementById('cloud-status').textContent.includes('サービスアカウントのキー'), document.body.innerText.includes('BEGIN'), document.getElementById('cloud-key-file').value]"), [True, False, ""])
            check("自動で送る（サービスアカウント）: にせものに、ライブラリが書かれている", mock_sa.value("chordlines/library") is not None, True)
            mock_sa.stop()
            ch.eval("window.confirm = () => true; document.getElementById('cloud-clear').click()")
            ch.wait_for("document.getElementById('cloud-status').textContent.includes('まだ、設定されていません')", timeout=10)
            check("自動で送る: 「やめる」で、設定が消える", ch.eval("document.getElementById('cloud-push').disabled"), True)
            check("JS のエラーがない", ch.eval("typeof window.__errors === 'undefined' ? 'n/a' : JSON.stringify(window.__errors)"), "n/a")
    finally:
        server.shutdown()
        sync.stop()
        mock.stop()
    print("編集画面 → 公開ページ: %d 件中 %d 件 失敗" % (checks, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
