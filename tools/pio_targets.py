# PlatformIO の「Custom」タスク（VSCode の PlatformIO > Project Tasks の Custom に並ぶ。コマンドは pio run -t <名前>）
#   クリック1つで、ブリッジを ESP32 につなぐ・画面を開く。
import os
import subprocess

Import("env")  # noqa: F821  （PlatformIO が渡す）

ROOT = env.subst("$PROJECT_DIR")  # noqa: F821


def run_script(script):
    def _run(*args, **kwargs):
        return subprocess.call(["sh", os.path.join(ROOT, "tools", script)])
    return _run


def open_url(url):
    def _run(*args, **kwargs):
        return subprocess.call(["open", url])
    return _run


env.AddCustomTarget(  # noqa: F821
    name="bridge_connect", dependencies=None, actions=[run_script("bridge_connect.sh")],
    title="ブリッジ接続", description="ESP32 と Mac の MIDI ブリッジをつなぐ（Serial Monitor は閉じる）。つながらないと、Mac から音が鳴らない", always_build=True)
env.AddCustomTarget(  # noqa: F821
    name="bridge_release", dependencies=None, actions=[run_script("bridge_release.sh")],
    title="ブリッジ解除（Serial Monitor 用）", description="ESP32 のポートを空ける。Serial Monitor で確認・操作・駒の登録をする前に。解除中は Mac から音が鳴らない", always_build=True)
env.AddCustomTarget(  # noqa: F821
    name="monitor_safe", dependencies=None, actions=[run_script("monitor_safe.sh")],
    title="Serial Monitor（ブリッジ自動解除）", description="ブリッジを解除してから Serial Monitor を開き、閉じたらブリッジをつなぎ直す（おすすめ）", always_build=True)
env.AddCustomTarget(  # noqa: F821
    name="open_editor", dependencies=None, actions=[open_url("http://127.0.0.1:8765/")],
    title="リズム・コード編集を開く", description="http://127.0.0.1:8765/", always_build=True)
env.AddCustomTarget(  # noqa: F821
    name="open_game", dependencies=None, actions=[open_url("http://127.0.0.1:8765/game/")],
    title="ゲームを開く", description="http://127.0.0.1:8765/game/", always_build=True)
