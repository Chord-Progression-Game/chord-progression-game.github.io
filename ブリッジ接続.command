#!/bin/sh
# Finder でダブルクリックすると、ブリッジを ESP32 につなぎます（ターミナルが開いて、結果が出ます）
cd "$(dirname "$0")" && sh tools/bridge_connect.sh
echo ""
echo "（このウィンドウは、閉じて大丈夫です）"
