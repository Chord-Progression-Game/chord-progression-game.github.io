# sound_lab — 「ESP32 の中で音を作れるか」を測った道具（2026-10-19）

結果と考察は `docs/standalone_plan.md`。ここには、**測定を再現するための道具**を入れてあります。
本番のファーム（`src/`）とは無関係です。ここの測定用プログラムを書き込むと、本番のファームは消えます（登録データ NVS は消えません）。
測ったあとは、必ず本番のファームを書き込み直してください（`pio run -t upload`）。

| 場所 | 中身 |
|---|---|
| `esp32_synthbench/` | 自作の軽いサンプル再生・FM・リバーブの、速さの測定（音データは合成した波形。アンプなし） |
| `esp32_tsfbench/` | TinySoundFont（SF2 エンジン）で、本物の GM 音源データを動かす測定。**波形を Mac と照合**し、リアルタイムに間に合うかも見る |
| `esp32_tsfbench/tsf_esp32_speedup.patch` | ESP32-S3 向けの高速化（位置を整数に、フィルターを float に）。`src/tsf.h` には適用済み |
| `sf2trim.py` | SF2 から、指定したプリセット（とドラムのキー）だけを残した小さな SF2 を作る |
| `sf2size.py` | SF2 の中の、プリセットごとのサンプルの大きさを数える |
| `render.cpp` | MIDI の記録（`events.txt`）を、TinySoundFont で WAV にする（Mac で動く） |
| `make_events.py` | 実機から録った MIDI（`capture_*.json`）を `events.txt` と `events.h` にする |
| `capture_8pieces_drum2_backing6.json` | 8枚の駒（ドラム2番・バッキング6番、BPM120）の、実機の MIDI の記録（時刻つき） |

## 使い方（Mac）

```sh
# 音源（SF2）を入手（32MB。ライセンスは GeneralUser GS License v2.0）
curl -L -o GeneralUser-GS.sf2 https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2
# 必要なものだけに絞る（グランドピアノ + エレピ + 本機が使うドラム8種）→ 約 3.6MB
python3 sf2trim.py GeneralUser-GS.sf2 trimmed.sf2 0:0 0:4 128:0:keys=36,38,37,42,46,39,51,49
# 演奏データ → WAV
python3 make_events.py capture_8pieces_drum2_backing6.json
curl -L -o tsf.h https://raw.githubusercontent.com/schellingb/TinySoundFont/master/tsf.h
clang++ -O2 -std=c++14 -x c++ render.cpp -o render
./render events.txt out.wav trimmed.sf2 0          # 最後の数字 = ピアノの音色（0 = グランドピアノ、4 = エレピ）
./render events.txt scale.wav trimmed.sf2 0 scale  # ドレミファソラシド（2回）
```

## ESP32 で測る

`esp32_tsfbench/` で `pio run -t upload`（パーティションを 16MB 用に変えてあります。NVS の場所は標準と同じで、変えていません）→ 音源データ（SF2）を **0x800000** に書き込む:
```sh
~/.platformio/penv/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 --port /dev/cu.usbmodemXXXX --baud 921600 write_flash 0x800000 trimmed_pd.sf2
```
（`trimmed_pd.sf2` = `sf2trim.py ... 0:0 128:0:keys=...`、ピアノとドラムだけ）。シリアルモニターで結果が出ます（約 3 分）。

## 注意

- `tsf.h` は MIT ライセンス（ファイルの冒頭に記載）。
- GeneralUser GS の権利は `docs/standalone_plan.md` の 2-4。
