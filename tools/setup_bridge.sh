#!/bin/sh
# PC側のブリッジ（midi_bridge.py）に必要な部品を、このフォルダの中だけにインストールする。
# 使い方（プロジェクトのフォルダで）:  sh tools/setup_bridge.sh
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt
echo "できました。次のコマンドで、ブリッジを動かせます:"
echo "  tools/.venv/bin/python tools/midi_bridge.py --test    # ESP32なしで、音源の確認"
echo "  tools/.venv/bin/python tools/midi_bridge.py           # ESP32につないで動かす"
