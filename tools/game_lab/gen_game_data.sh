#!/bin/sh
# ファームの表から、ゲーム用のデータ（コードの表・リズムのプリセット）を作り直す。
#   使い方（プロジェクトのフォルダで）:  sh tools/game_lab/gen_game_data.sh
#   ゲームは、ファームと同じ表・同じパターンで動く（写しを手で持たない）。違いがあると、テストが知らせる。
set -e
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
mkdir -p game/data
g++ -std=gnu++11 -Isrc tools/host_tests/dump_chords.cpp src/chords.cpp -o "$OUT/dump_chords"
"$OUT/dump_chords" > game/data/chords.json
g++ -std=gnu++11 -Isrc tools/host_tests/dump_presets.cpp src/rhythm.cpp -o "$OUT/dump_presets"
"$OUT/dump_presets" > game/data/presets.json
echo "できました: game/data/chords.json  game/data/presets.json"
