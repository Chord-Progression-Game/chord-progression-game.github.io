#!/bin/sh
# ゲームを、Chrome で開く（サーバーも一緒に動かす）。
#   sh tools/game.sh              普通に開く
#   sh tools/game.sh kiosk        全画面で開く（展示用）
#   sh tools/game.sh 8801         ポートを変える
#   sh tools/game.sh lan          同じ Wi-Fi のスマホからも開ける（スマホ用の URL が出る。実機の盤は、スマホでは使えない）
# 実機の盤（ESP32）を使うときは、先にブリッジを動かしておく（常駐していれば、そのまま）。
cd "$(dirname "$0")/.."
KIOSK=""
LAN=""
PORT=8800
for a in "$@"; do
  case "$a" in
    kiosk) KIOSK="--kiosk" ;;
    lan) LAN="--lan" ;;
    [0-9]*) PORT="$a" ;;
  esac
done
exec python3 tools/game_server.py --open $KIOSK $LAN --port "$PORT"
