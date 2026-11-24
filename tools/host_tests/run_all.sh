#!/bin/sh
# パソコンの上で動く自動テストを、すべて実行する（ESP32 もボードも不要）。
#   使い方（プロジェクトのフォルダで）:  sh tools/host_tests/run_all.sh
#   ※ ブリッジのテストには、先に  sh tools/setup_bridge.sh  が必要
set -e
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
CXX="g++ -std=gnu++11 -Wall -Wextra -Isrc"

echo "== コード定義・キー =="
$CXX tools/host_tests/test_chords.cpp src/chords.cpp -o "$OUT/t1"
"$OUT/t1"
echo "== ボイスリーディング（前のコードに近い高さ）=="
$CXX tools/host_tests/test_voicing.cpp src/voicing.cpp src/chords.cpp -o "$OUT/t2"
"$OUT/t2"
echo "== リズムのパターン（ドラム・バッキング）=="
$CXX tools/host_tests/test_rhythm.cpp src/rhythm.cpp -o "$OUT/t3"
"$OUT/t3"
echo "== グルーヴ（時間の管理・パターンの再生・BPM／キーの即時変更）=="
$CXX tools/host_tests/test_groove.cpp src/groove.cpp src/rhythm.cpp src/voicing.cpp src/chords.cpp -o "$OUT/t4"
"$OUT/t4"
echo "== コマンドの読み取り =="
$CXX tools/host_tests/test_cmd_parse.cpp src/cmd_parse.cpp -o "$OUT/t5"
"$OUT/t5"
echo "== リズム編集画面（サーバー・コマンド変換・プリセットの一致）=="
python3 tools/host_tests/test_rhythm_ui.py "$OUT/ui_commands.txt"
echo "== 位置とリーダーの対応（配置・覚えさせる）=="
$CXX tools/host_tests/test_layout.cpp src/layout.cpp -o "$OUT/tl"
"$OUT/tl"
echo "== 駒の持ち主を決める部品（隣のリーダーが読む「影」・動かす・ランダム）=="
$CXX tools/host_tests/test_array_tracker.cpp src/array_tracker.cpp -o "$OUT/tt"
"$OUT/tt"
SIM_SRC="tools/host_tests/test_firmware_sim.cpp tools/host_tests/sim/sim_hw.cpp src/commands.cpp src/player.cpp src/groove.cpp src/rhythm.cpp src/rhythm_print.cpp src/rhythm_store.cpp src/settings_store.cpp src/voicing.cpp src/chords.cpp src/cmd_parse.cpp src/board.cpp src/layout.cpp src/ui_util.cpp src/bridge_link.cpp"
echo "== ファームウェアの上位部分・4台構成（コマンド・再生・リズムの保存を、偽のボードで動かす）=="
$CXX -DNUM_READERS_CONFIG=4 -Itools/host_tests/sim $SIM_SRC -o "$OUT/t5s4"
SIM_COMMAND_FILE="$OUT/ui_commands.txt" SIM_STATE_FILE="$OUT/state_samples.txt" "$OUT/t5s4"
echo "== ファームウェアの上位部分・8台構成（8つの位置・MAP・覚えさせる）=="
$CXX -DNUM_READERS_CONFIG=8 -Itools/host_tests/sim $SIM_SRC -o "$OUT/t5s8"
"$OUT/t5s8"
echo "== STATE の行の形式（ファーム ⇔ ブリッジ）=="
python3 tools/host_tests/test_state_format.py "$OUT/state_samples.txt"
echo "== 操作・編集画面を、本物のブラウザで動かす =="
python3 tools/host_tests/test_ui_browser.py
python3 tools/host_tests/test_ui_realtime.py
echo "== 盤面（位置の状態）4台・8台 =="
$CXX -DNUM_READERS_CONFIG=4 tools/host_tests/test_board.cpp src/board.cpp src/layout.cpp -o "$OUT/t6a"
"$OUT/t6a"
$CXX -DNUM_READERS_CONFIG=8 tools/host_tests/test_board.cpp src/board.cpp src/layout.cpp -o "$OUT/t6b"
"$OUT/t6b"
echo "== ゲーム（game/）の部品: コードの表の一致・和音の高さ・トリックの判定・ヒント・音・進行（本物のブラウザ）=="
python3 tools/host_tests/test_game_js.py
echo "== ゲームの画面を、本物のブラウザで、マウスの操作どおりに動かす =="
python3 tools/host_tests/test_game_ui.py
echo "== メロディの画面（ピアノロール・自動でメロディをつける・コードとメロディのプリセット）を、本物のブラウザで、マウスの操作どおりに動かす =="
python3 tools/host_tests/test_melody_studio_ui.py
echo "== 自作コード・コードの編集・ダブルクリックで置く・技の詳細（曲の例）を、本物のブラウザで、マウスの操作どおりに動かす =="
python3 tools/host_tests/test_chordbook_ui.py
echo "== スマホ（iPhone の大きさ・タッチ。縦持ち・横持ち）で、ゲームが動くか（Chrome のスマホ表示）=="
python3 tools/host_tests/test_mobile_ui.py
echo "== 第7弾: クリアの結果・スマホ縦持ちの配置・チャレンジステージ・分割したマス（マウス・指の操作）=="
python3 tools/host_tests/test_round7_ui.py
echo "== 第8弾: スタンプ・画面の記録・分割の駒・ガイドと盤の位置・指の範囲選択（スマホの縦・横）=="
python3 tools/host_tests/test_round8_ui.py
echo "== 第10弾: 使い方の画面（動く図）。タイトル・遊ぶ画面・MENU から開く・矢印キー・Esc・スマホの縦・横 =="
python3 tools/host_tests/test_round10_ui.py
echo "== 第11弾: 音量のメニュー（ドラム・バッキングを別々に）・もとの駒をもとにしたコードは「自作」の段（マウス・指の操作）=="
python3 tools/host_tests/test_round11_ui.py
echo "== 第12弾: シークバー（演奏の位置・巻き戻し・早送り）。本物のマウス・指。PC・スマホの縦・横 =="
python3 tools/host_tests/test_round12_ui.py
echo "== 公開ページ（https。ブリッジなし）: リズム・コード編集の内容の取り込み =="
python3 tools/host_tests/test_pages_ui.py
echo "== 全端末への共有（にせの Firebase）: ブリッジが書く側・ゲームが読む側 =="
python3 tools/host_tests/test_cloud_sync.py
python3 tools/host_tests/test_cloud_game.py
echo "== 編集画面が作った「公開ページ用のリンク」を、ゲーム側の読み取りで読み直す（通しの確認）=="
python3 tools/host_tests/test_editor_pages.py
echo "== でたらめ操作（開いた画面・結果・盤と3Dの一致が、こわれないか。PC・スマホ縦・横・タブレット）=="
python3 tools/host_tests/test_fuzz_ui.py 200
echo "== ゲームを配るサーバーと、実機の盤とのつなぎ（疑似ESP32 + 本物のブリッジ + ブラウザ）=="
python3 tools/host_tests/test_game_server.py
echo "== MIDI メッセージ・ブリッジ用の行 =="
$CXX tools/host_tests/test_midi_protocol.cpp src/midi_protocol.cpp -o "$OUT/t7"
"$OUT/t7"
if [ -x tools/.venv/bin/python ]; then
  echo "== PC側ブリッジ（疑似ESP32 → 仮想MIDIポート）=="
  tools/.venv/bin/python tools/host_tests/test_bridge.py
else
  echo "（PC側ブリッジのテストは、tools/.venv がないのでスキップ。sh tools/setup_bridge.sh で用意できます）"
fi
echo "すべて合格しました。"
