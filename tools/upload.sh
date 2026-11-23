#!/bin/sh
# ファームを書き込む。
#   ・常駐のブリッジ（tools/chordtoy_agent.sh）がポートを使っているので、先に止めて、書き込んだあと、また始める
#   ・このフォルダ名には括弧「( )」が入っていて、PlatformIO の書き込みコマンドが途中で壊れる（引用符なしでパスを並べるため）。
#     そこで、ビルドだけ PlatformIO に任せ、書き込みは esptool を、パスを引用符で囲んで直接呼ぶ
#   sh tools/upload.sh            （ポートは /dev/cu.usbmodem* を自動で探す）
#   sh tools/upload.sh /dev/cu.usbmodemXXXX
#   VSCode の Upload ボタン（pio run -t upload）からも、platformio.ini の upload_command 経由で、ここが呼ばれる（--no-build 付き）
cd "$(dirname "$0")/.."
BUILD_FIRST=1
if [ "$1" = "--no-build" ]; then BUILD_FIRST=0; shift; fi
PIO="$HOME/.platformio/penv/bin/pio"
PY="$HOME/.platformio/penv/bin/python"
ESPTOOL="$HOME/.platformio/packages/tool-esptoolpy/esptool.py"
BUILD=".pio/build/freenove_esp32_s3_wroom"
BOOT_APP0="$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"

PORT="$1"
if [ -z "$PORT" ]; then
  for p in /dev/cu.usbmodem* /dev/cu.usbserial*; do [ -e "$p" ] && PORT="$p" && break; done
fi
if [ -z "$PORT" ]; then echo "ボードが見つかりません（/dev/cu.usbmodem* がない）。USB をつないでください。"; exit 1; fi

if [ $BUILD_FIRST = 1 ]; then
  echo "== ビルド =="
  "$PIO" run || exit $?
fi

RUNNING=0
if launchctl print "gui/$(id -u)/jp.chordtoy.bridge" >/dev/null 2>&1; then RUNNING=1; sh tools/chordtoy_agent.sh stop; sleep 1; fi
# PlatformIO の Serial Monitor が、同じポートを開いていると、書き込めない。それだけは、閉じる（ほかのプログラムは、閉じない）
for PID in $(lsof -t "$PORT" 2>/dev/null); do
  if ps -p "$PID" -o command= | grep -q "device monitor"; then echo "Serial Monitor（PID $PID）を閉じます（書き込みのため。終わったら、もう一度開いてください）"; kill "$PID"; sleep 1; fi
done
if lsof "$PORT" >/dev/null 2>&1; then
  echo "ポート $PORT を、ほかのプログラムが使っています:"; lsof "$PORT"
  echo "（シリアルモニタなどを閉じてから、もう一度）"
  [ $RUNNING = 1 ] && sh tools/chordtoy_agent.sh start
  exit 1
fi

echo "== 書き込み ($PORT) =="
"$PY" "$ESPTOOL" --chip esp32s3 --port "$PORT" --baud 921600 --before default_reset --after hard_reset \
  write_flash -z --flash_mode dio --flash_freq 80m --flash_size 8MB \
  0x0000 "$BUILD/bootloader.bin" 0x8000 "$BUILD/partitions.bin" 0xe000 "$BOOT_APP0" 0x10000 "$BUILD/firmware.bin"
RESULT=$?
if [ $RESULT = 0 ]; then
  echo "== 書き込み成功 =="
  echo ""
  echo "   === 音について（大事）==="
  echo "   ESP32 自身は、ピアノやドラムの音を出しません。Mac から鳴ります（GarageBand のピアノ・ドラム、ゲーム）。"
  echo "   ブリッジが ESP32 につながっていないと、Mac から音は鳴りません。（この書き込みのあと、ブリッジは自動で再開します）"
  echo "   === Serial Monitor を使うとき（確認・操作・駒の登録）==="
  echo "   同じポートをブリッジと取り合うと、文字化け・切断が起きます。先にブリッジを「解除」します（解除中は、音が鳴りません）。"
  echo "   おすすめ: PlatformIO の Project Tasks > Custom > 「Serial Monitor（ブリッジ自動解除）」（閉じると、自動でつなぎ直す）"
  echo "   手動: 「ブリッジ解除」→ Monitor で作業 →「ブリッジ接続」 ／ ブラウザの画面のボタン ／ sh tools/bridge_release.sh と sh tools/bridge_connect.sh"
  echo ""
  echo "   ブラウザの画面（Command を押しながらクリックで開く）:"
  echo "     リズム・コード編集（GarageBand の MIDI）: http://127.0.0.1:8765/"
  echo "     ゲーム: http://127.0.0.1:8765/game/"
else
  echo "== 書き込み失敗（コード $RESULT）=="
fi
if [ $RUNNING = 1 ]; then sleep 2; sh tools/chordtoy_agent.sh start; fi
exit $RESULT
