#!/bin/sh
# docs/game_flow_*.svg を、PNG にする（Chrome のヘッドレスで描く。2倍の細かさ）。
#   使い方: python3 docs/make_game_flow_svg.py && sh docs/render_game_flow.sh
#   大きさは、SVG の先頭の width / height から読む（図を変えても、ここは直さなくてよい）。
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for name in game_flow_screens game_flow_loop game_flow_system; do
  head=$(grep -m1 '<svg ' "$name.svg")
  w=$(printf '%s' "$head" | sed -n 's/.* width="\([0-9]*\)".*/\1/p')
  h=$(printf '%s' "$head" | sed -n 's/.* height="\([0-9]*\)".*/\1/p')
  prof=$(mktemp -d)        # 専用のプロファイル（ふだん使っている Chrome が開いていても、そちらにつながらず、止まらないように）
  "$CHROME" --headless=new --user-data-dir="$prof" --no-first-run --hide-scrollbars --force-device-scale-factor=2 --window-size=$w,$h --screenshot="$PWD/$name.png" "file://$PWD/$name.svg" >/dev/null 2>&1
  rm -rf "$prof"
  echo "できました: $name.png（$w × $h を 2倍）"
done
