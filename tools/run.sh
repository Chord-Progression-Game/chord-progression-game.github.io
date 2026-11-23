#!/bin/sh
# ブリッジ（ESP32 → 仮想MIDIポート）を動かす。--gm を付けると、Mac標準のGM音源（ピアノ＋ドラム）も一緒に動かす。
#   使い方（プロジェクトのフォルダで）:
#     sh tools/run.sh          # ブリッジだけ。GarageBand などで鳴らすとき（ドラムは DRUM OFF のまま）
#     sh tools/run.sh --garageband   # GarageBand を先に開いておき、その「仮想入力」にも直接送る（GarageBand が仮想ポートを見つけないとき）
#     sh tools/run.sh --gm     # ブリッジ＋GM音源。ピアノもドラムも鳴らすとき（GarageBand は閉じる）
#   終了は Ctrl+C。※ PlatformIO の Serial Monitor は、先に閉じておく（同じポートを取り合う）。
cd "$(dirname "$0")/.."
GM=0
EXTRA=""
for a in "$@"; do
  [ "$a" = "--gm" ] && GM=1
  [ "$a" = "--garageband" ] && EXTRA="--to GarageBand"
done
if [ ! -x tools/.venv/bin/python ]; then echo "先に  sh tools/setup_bridge.sh  を実行してください"; exit 1; fi
if [ $GM = 1 ]; then
  if [ ! -x tools/gm_synth/gm_synth ]; then echo "先に  sh tools/gm_synth/build.sh  を実行してください"; exit 1; fi
  tools/gm_synth/gm_synth &
  SYNTH=$!
  trap 'kill $SYNTH 2>/dev/null' EXIT INT TERM
  sleep 1
fi
tools/.venv/bin/python tools/midi_bridge.py $EXTRA
