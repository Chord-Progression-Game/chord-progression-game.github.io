#!/bin/sh
# Serial Monitor を、ブリッジと取り合わずに開く: 開く前にブリッジを解除し、閉じたら、自動でブリッジをつなぎ直す。
#   PlatformIO の Project Tasks > Custom の「Serial Monitor（ブリッジ自動解除）」から使う（または  sh tools/monitor_safe.sh）
#   閉じるには、Serial Monitor の中で Ctrl+C（または Ctrl+]）。
cd "$(dirname "$0")/.."
sh tools/bridge_release.sh
finish() {
  echo ""
  echo "Serial Monitor を閉じました。ブリッジをつなぎ直します…"
  sh tools/bridge_connect.sh
}
trap finish EXIT
trap 'exit 130' INT TERM
if [ -n "$MONITOR_CMD" ]; then sh -c "$MONITOR_CMD"; else "$HOME/.platformio/penv/bin/pio" device monitor; fi
