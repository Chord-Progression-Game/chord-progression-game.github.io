#!/bin/sh
# gm_synth（Mac標準のGM音源アプリ）を作る。使い方（プロジェクトのフォルダで）:  sh tools/gm_synth/build.sh
#   ※ Mac のコマンドラインツールに、Swift のモジュール定義が二重になっている不具合があるときのための回避策を含む
#     （swiftc が "redefinition of module 'SwiftBridging'" と言う場合）。
set -e
cd "$(dirname "$0")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "// empty" > "$TMP/empty.modulemap"
cat > "$TMP/overlay.yaml" <<YAML
{ "version": 0, "case-sensitive": "false",
  "roots": [ { "type": "directory", "name": "/Library/Developer/CommandLineTools/usr/include/swift",
    "contents": [ { "type": "file", "name": "module.modulemap", "external-contents": "$TMP/empty.modulemap" } ] } ] }
YAML
if swiftc -swift-version 5 -O gm_synth.swift -o gm_synth 2>/dev/null; then :; else
  swiftc -swift-version 5 -O -vfsoverlay "$TMP/overlay.yaml" -Xcc -ivfsoverlay -Xcc "$TMP/overlay.yaml" gm_synth.swift -o gm_synth 2>&1 | grep -v "warning: forming" | grep -i "error" || true
fi
test -x gm_synth && echo "できました: tools/gm_synth/gm_synth" || { echo "作れませんでした"; exit 1; }
