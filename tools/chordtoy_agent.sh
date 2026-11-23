#!/bin/sh
# ブリッジ（ESP32 → 仮想MIDIポート → GarageBand）を、Mac にログインしたときから、自動で動かしておく（常駐）。
#   ESP32 を USB（UART側）につなぐだけで、GarageBand（AUMIDISynth のトラック）から音が出る。ターミナルに打つ必要はない。
#   リズム編集の画面: http://127.0.0.1:8765/
#
#   sh tools/chordtoy_agent.sh install     自動で動かす設定を入れて、いますぐ始める
#   sh tools/chordtoy_agent.sh update      tools/ の変更を、動かす側にコピーし直して、再起動する
#   sh tools/chordtoy_agent.sh uninstall   設定を消す（元に戻る）
#   sh tools/chordtoy_agent.sh stop        いったん止める（ログインし直すまで）。★ファームの書き込み・Serial Monitor の前に必ず
#   sh tools/chordtoy_agent.sh start       止めていたのを、また始める
#   sh tools/chordtoy_agent.sh status      動いているか
#   sh tools/chordtoy_agent.sh log         最近の表示（ブリッジの画面に出る文字）
#
# 仕組み: macOS は、自動で動くプログラムが「書類」フォルダの中を読むのを禁じている。そのため、ブリッジの実行に必要なファイルだけを、
#   ~/Library/Application Support/ChordToy にコピーして動かす。tools/ の中身を変えたら、sh tools/chordtoy_agent.sh update で、コピーし直す。
#
# 動いている間は、ブリッジが ESP32 のシリアルポートを使っているので、ファームの書き込み（PlatformIO の Upload）や
# Serial Monitor は、ポートがふさがっていてできない。先に stop する（書き込みは sh tools/upload.sh が、stop → 書き込み → start を自動でする）。
LABEL=jp.chordtoy.bridge
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HOME/Library/Application Support/ChordToy"
PY="$DEST/venv/bin/python"
LOG="$HOME/Library/Logs/chordtoy_bridge.log"
DOMAIN="gui/$(id -u)"

# 実行に必要なファイルを、保護されていない場所にコピーする
sync_files() {
  SRC_PY="$ROOT/tools/.venv/bin/python"
  if [ ! -x "$SRC_PY" ]; then echo "先に  sh tools/setup_bridge.sh  を実行してください"; return 1; fi
  mkdir -p "$DEST/tools"
  cp "$ROOT/tools/midi_bridge.py" "$ROOT/tools/rhythm_server.py" "$DEST/tools/" || return 1
  rm -rf "$DEST/tools/rhythm_editor" && cp -R "$ROOT/tools/rhythm_editor" "$DEST/tools/rhythm_editor" || return 1
  # ゲーム（http://127.0.0.1:8765/game/ で配る）。テストの一時ファイルは、持っていかない
  rm -rf "$DEST/game" && cp -R "$ROOT/game" "$DEST/game" && rm -rf "$DEST/game/test/_generated" || return 1
  if [ ! -x "$PY" ]; then
    python3 -m venv "$DEST/venv" || return 1
    SITE=$(cd "$ROOT/tools/.venv/lib" && ls -d python3.*/site-packages | head -1)
    cp -R "$ROOT/tools/.venv/lib/$SITE/." "$DEST/venv/lib/$SITE/" || return 1
  fi
  return 0
}

case "$1" in
  install)
    sync_files || exit 1
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$DEST/tools/midi_bridge.py</string>
    <string>--daemon</string>
  </array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>EnvironmentVariables</key>
  <dict><key>PYTHONUNBUFFERED</key><string>1</string></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    launchctl bootstrap "$DOMAIN" "$PLIST" && echo "入れました。ログインするたびに、自動で動きます。いまも動き始めました。" && echo "  画面: http://127.0.0.1:8765/   止める: sh tools/chordtoy_agent.sh stop   消す: sh tools/chordtoy_agent.sh uninstall"
    ;;
  update)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    sync_files || exit 1
    sleep 1
    launchctl bootstrap "$DOMAIN" "$PLIST" && echo "コピーし直して、再起動しました。"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -rf "$DEST"
    rm -f "$PLIST" && echo "消しました。自動では動かなくなりました（sh tools/run.sh で、これまでどおり手で動かせます）。"
    ;;
  stop)
    # 終了コードではなく、実際に動いていたかで表示を決める（止まる途中だと、bootout が失敗を返すことがある）
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
      i=0
      while launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.25; i=$((i + 1)); done   # 止まりきるまで待つ（最大5秒）
      if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
        echo "止められませんでした。もう一度 stop を試してください。"; exit 1
      fi
      echo "止めました（ログインし直すか、start で、また始まります）。"
    else
      echo "動いていませんでした。"
    fi
    ;;
  start)
    [ -f "$PLIST" ] || { echo "まだ入れていません。先に  sh tools/chordtoy_agent.sh install"; exit 1; }
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "すでに動いています。"
    elif launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
      echo "始めました。"
    else
      echo "始められませんでした。sh tools/chordtoy_agent.sh log で、理由を見てください。"; exit 1
    fi
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "動いています。"; launchctl print "$DOMAIN/$LABEL" | grep -E "state =|pid =|last exit" | head -3
      curl -s -m 2 http://127.0.0.1:8765/api/state >/dev/null; sleep 1.5   # 画面が見ている間だけ ESP32 に状態を頼むので、1回目は呼び水
      curl -s -m 2 http://127.0.0.1:8765/api/state | python3 -c "import sys,json; d=json.load(sys.stdin); print('ESP32 と接続:', d.get('connected'))" 2>/dev/null
    else
      [ -f "$PLIST" ] && echo "入っていますが、いまは止まっています（start で始まります）。" || echo "入っていません（install で入れます）。"
    fi
    ;;
  log)
    tail -n 40 "$LOG" 2>/dev/null || echo "まだ表示がありません。"
    ;;
  *)
    sed -n 2,16p "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
