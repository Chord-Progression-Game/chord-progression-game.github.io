#!/bin/sh
# ファームのプリセットから、編集画面用の presets.json を作り直す。使い方（プロジェクトのフォルダで）:  sh tools/rhythm_editor/gen_presets.sh
set -e
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
g++ -std=gnu++11 -Isrc tools/host_tests/dump_presets.cpp src/rhythm.cpp -o "$OUT/dump"
"$OUT/dump" > tools/rhythm_editor/presets.json
echo "できました: tools/rhythm_editor/presets.json"
