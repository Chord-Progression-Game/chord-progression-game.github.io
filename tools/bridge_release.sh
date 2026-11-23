#!/bin/sh
# ブリッジを「解除」する: ESP32 のポートを閉じて、「つなぐ」まで開き直さない。
#   PlatformIO の Serial Monitor で、確認・操作・駒の登録をするときに使う（同じポートを2つが読むと、文字が化けたり、途切れたりする）。
#   解除中は、Mac から音が鳴らない。終わったら  sh tools/bridge_connect.sh（PlatformIO の「ブリッジ接続」）でつなぐ。
cd "$(dirname "$0")/.."
URL="http://127.0.0.1:8765"
if ! curl -s -m 2 "$URL/api/state" >/dev/null; then
  echo "ブリッジは動いていません（ポートは空いています。Serial Monitor を、そのまま使えます）。"
  exit 0
fi
curl -s -m 10 -X POST -H "Content-Type: application/json" -d '{"action":"release"}' "$URL/api/bridge" >/dev/null
python3 - "$URL" <<'PY'
import json, sys, time, urllib.request
url = sys.argv[1]
for _ in range(10):
    with urllib.request.urlopen(url + "/api/state", timeout=3) as r:
        ser = json.loads(r.read().decode("utf-8")).get("serial", {})
    if ser.get("released") and not ser.get("open"):
        print("✓ ブリッジを解除しました。ESP32 のポートは空いています。Serial Monitor を使えます。")
        print("  解除中は、Mac から音が鳴りません。終わったら:  sh tools/bridge_connect.sh  （PlatformIO の「ブリッジ接続」、または画面の「ブリッジをつなぐ」）")
        sys.exit(0)
    time.sleep(0.3)
print("✗ 解除できませんでした（ブリッジが常駐モードでない可能性。sh tools/chordtoy_agent.sh update を試してください）")
sys.exit(1)
PY
