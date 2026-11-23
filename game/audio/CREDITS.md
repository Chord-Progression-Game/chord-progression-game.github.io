# 音・部品の出どころ（クレジット）

ゲーム（`game/`）が使っている、他の人が作った素材です。**卒展などで公開するときは、下の表記を、作品のクレジットに入れてください。**
（ライセンスの条文は、配布元で、公開の前にもう一度確認してください。ここに書いたのは、取り込んだ時点の控えです）

## ピアノの音（`piano/*.mp3`、21個）
- **Salamander Grand Piano**（Alexander Holm 作）。ライセンス: **CC BY 3.0**（作者の表記が必要）
- 取り込み元: Tone.js が配っている変換済みの音（`https://tonejs.github.io/audio/salamander/` の C2〜C7 の、短3度ごとの21個）
- 使い方: 鳴らしたい高さに近い音を、再生の速さを変えて鳴らす（`js/audio/engine.js`）

## ドラムの音（`drums/*.wav`、8個）
- **GeneralUser GS**（S. Christian Collins 作）の、GM のドラムキットから、`tools/sound_lab` の道具で書き出したもの
  キック / スネア / サイドスティック / クローズハット / オープンハット / クラップ / ライド / クラッシュ
- ライセンス: GeneralUser GS License（配布元: `https://github.com/mrbumpy409/GeneralUser-GS`）。**公開前に、条文の確認をお願いします**（私は、細かい条件までは確認していません）

## 3D 表示（`vendor/three/`）
- **three.js** r168（MIT License。`vendor/three/LICENSE`）。`RoundedBoxGeometry`・`RoomEnvironment`・ポストプロセス（`EffectComposer` など）も、three.js の一部（MIT）
- ネットにつながらなくても動くように、ファイルをそのまま置いてある（読み込み元の変更・更新はしていない）

## フォント
- 画面の文字は、Mac に入っているフォント（日本語はヒラギノ角ゴ、英字の見出しは Helvetica Neue / Avenir Next など）を使う。フォントのファイルは同梱していない
- ネットから読み込むものは、何もない（オフラインでも動く）

## この作品のオリジナル部分
- ゲームの仕組み・判定（`js/core/tricks.js` ほか）、画面（`js/render/`・`css/`）、効果音（`js/audio/sfx.js`。その場の和音から合成）、駒のデータ（ファーム `src/chords.cpp` から自動生成）は、この作品のもの
