#!/bin/sh
# ブリッジ（常駐。ESP32 の MIDI を、GarageBand などへ流す = Mac から音を鳴らす役）を、ESP32 につなぐ。1回で済む。
#   ・ブリッジが動いていなければ、始める
#   ・PlatformIO の Serial Monitor が、ESP32 のポートを使っていたら、閉じる（開いている間、ブリッジは退くため）
#   ・つながるまで、待つ
#   使い方: sh tools/bridge_connect.sh   （PlatformIO の Project Tasks > Custom の「ブリッジ接続」、Finder の「ブリッジ接続.command」、ブラウザの画面のボタンも、同じ）
cd "$(dirname "$0")/.."
URL="http://127.0.0.1:8765"
state() { curl -s -m 2 "$URL/api/state"; }

if ! state >/dev/null; then
  echo "ブリッジが動いていません。始めます…"
  sh tools/chordtoy_agent.sh start || { echo "（まだ入れていないときは: sh tools/chordtoy_agent.sh install）"; exit 1; }
  i=0; while [ $i -lt 10 ] && ! state >/dev/null; do sleep 1; i=$((i+1)); done
  if ! state >/dev/null; then echo "ブリッジが応答しません。sh tools/chordtoy_agent.sh log を見てください。"; exit 1; fi
fi

curl -s -m 10 -X POST -H "Content-Type: application/json" -d '{"action":"connect"}' "$URL/api/bridge" >/dev/null

python3 - "$URL" <<'PY'
import json, sys, time, urllib.request
url = sys.argv[1]
def st():
    with urllib.request.urlopen(url + "/api/state", timeout=3) as r:
        return json.loads(r.read().decode("utf-8"))
d = None
for _ in range(16):                      # 最大 約8秒、待つ
    d = st()
    if d.get("serial", {}).get("open"):
        break
    time.sleep(0.5)
ser = d.get("serial", {})
if ser.get("open"):
    print("✓ ブリッジは ESP32 につながりました。Mac から音を鳴らせます。")
    print("  GarageBand の MIDI 入力: 「ESP32 Chord Prototype」（トラックの音源は Apple の AUMIDISynth など。README 6-5）")
    print("  音は、ESP32 が再生中のときに鳴ります（画面の START、または Serial Monitor で START）")
    sys.exit(0)
print("✗ ブリッジは、まだ ESP32 につながっていません。")
busy = ser.get("busy") or []
if busy:
    for h in busy:
        print("  ポートを使っているプログラム: PID %s  %s" % (h["pid"], h["command"][-80:]))
    print("  → そのプログラムを閉じてください（Serial Monitor 以外は、自動では閉じません）")
elif not ser.get("port"):
    print("  ESP32 が見つかりません。USB ケーブル（UART 側のポート）のつなぎ方を確かめてください。")
sys.exit(1)
PY
RC=$?
if [ $RC = 0 ]; then
  echo ""
  echo "ブラウザの画面（Command を押しながらクリックで開く）:"
  echo "  リズム・コード編集（GarageBand の MIDI）: $URL/"
  echo "  ゲーム: $URL/game/"
fi
exit $RC
