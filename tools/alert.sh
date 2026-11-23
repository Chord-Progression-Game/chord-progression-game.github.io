#!/bin/sh
# 「指示を出したので、画面を見てください」の合図: ド（C4）を短く3回、それを3回。Mac のスピーカーで鳴らす
afplay -v 0.8 "$(dirname "$0")/alert_c4x3x3.m4a"
