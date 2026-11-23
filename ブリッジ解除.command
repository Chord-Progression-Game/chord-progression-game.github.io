#!/bin/sh
# Finder でダブルクリックすると、ブリッジを「解除」します（Serial Monitor を使う前に。つなぎ直すのは「ブリッジ接続.command」）
cd "$(dirname "$0")" && sh tools/bridge_release.sh
echo ""
echo "（このウィンドウは、閉じて大丈夫です）"
