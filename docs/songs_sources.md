# 「この進行が使われている曲」の出典（技の詳細に出す曲の一覧）

- 作成: 2026-11-23 ／ ゲームでの場所: `game/js/core/songs.js`（`SONGS`・`SOURCES`）。画面: 技の枠・「技」の一覧の行・「理由」の「くわしく」→ 技の詳細。
- あなたの依頼: 「固有進行が現れた場合にその枠をクリックすると、その進行が使われている有名な曲（できるだけ日本の曲）の名前も表示するようにしてください」「『今の進行はこの曲の一部だよ』というのがあると、アーティストとの距離感を近く感じたり、自己肯定感やモチベーションが上がる」
- **曲名・アーティスト名だけ**を出します（歌詞・メロディは出しません。権利の問題を避けるため）。
- **私は耳で確認していません。** ウェブの解説・Wikipedia に、その進行の例として載っていたものを、そのまま入れました。曲の一部分（サビ・Aメロなど）で使われていることが多く、調やコードの細かい形（Ⅴ7 か Ⅴ か、ⅣM7 か Ⅳ か）は、曲ごとに違います。
- **資料どうしで食い違うものは、入れていません**（食い違いの例は、下の「食い違い」）。**学内発表・卒展で出すときは、ご自身で、楽譜・音源で確かめてください。**

## 出典（`SOURCES` の印）

| 印 | 資料 | 取得した内容 |
|---|---|---|
| `rag` | RAG MUSIC「作曲初心者も必見！定番のコード進行まとめ」（music.ragnet.co.jp/standard-chord-songs）、「王道進行」の曲の一覧（music.ragnet.co.jp/standard-chord-progression-songs） | 曲名と、その曲に当てはまる進行の名前（4561進行・丸サ進行・小室進行・カノン進行・王道進行・1564進行・1625進行など） |
| `utaten` | UtaTen「カノン進行」「王道進行」の解説（utaten.com/live/kanon-chord/ ほか）| 曲名と、使われている部分（Aメロ・サビなど） |
| `nippon` | nippon.com「J-POPを席巻する『Just The Two of Us』コード進行を読み解く」（www.nippon.com/ja/japan-topics/g01096/）| 丸サ進行が使われている日本の曲 |
| `wiki` | Wikipedia「'50s progression」「Andalusian cadence」「Ragtime progression」「Eight-bar blues」「I–IV–V–I」 | 曲名（年）。日本の曲は「'50s progression」の表に、THE BLUE HEARTS・ONE OK ROCK・安室奈美恵 などが載っていた |
| `biechi` | 「The Komuro Progression」（biechi.github.io/blog/2c538f/）| 小室進行・1564進行の曲 |
| `jazz` | antonjazz.com「Backdoor ii-V」 | バックドア進行の例（Lady Bird） |
| `tjps` | The Jazz Piano Site「Line Clichés」（www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-progressions/line-cliches/）。2026-11-24 に追加 | クリシェ（ライン・クリシェ）の曲の例（My Funny Valentine など）と、定義 |
| `gctb` | Guitar Composer's ToolBox「Descending Minor Cliché」（www.guitarcomposerstoolbox.com/chord-progressions/descending-minor-cliche-in-f/ ほか）。2026-11-24 に追加 | マイナーのクリシェを使う曲の例（Michelle・Time in a Bottle・Stairway to Heaven）。資料によって、長調のクリシェに入れるものもある |

## 進行ごとの、入れた曲

| 進行（`SONGS` のキー） | 入れた曲 | 日本の曲 |
|---|---|---|
| 王道進行 `oudou` | 夜に駆ける・ロビンソン・瞳をとじて・愛のままにわがままに 僕は君だけを傷つけない・怪物・I LOVE...（サビの頭）・桜華爛漫（サビ）・君はロックを聴かない | あり |
| 小室進行 `komuro` | Get Wild・Body Feels EXIT・LOVE LOVE LOVE（サビ）・愛唄・survival dAnce・だから僕は音楽を辞めた（サビ） | あり |
| 丸サ進行 `maru_sa`（Ⅳ-Ⅲ-Ⅵ進行 `iv_iii_vi` も、この曲を出す） | 丸の内サディスティック・Just The Two of Us・つつみ込むように…・接吻・A Perfect Sky・夜に駆ける（要所）・I LOVE...（Aメロ・Bメロ） | あり |
| カノン進行 `weak_motion｜カノン進行` | 負けないで・マリーゴールド・愛をこめて花束を・終わりなき旅・Pretender（イントロ・Aメロ。変形）・ハレ晴レユカイ・いつも何度でも・カノン（パッヘルベル）・Basket Case | あり |
| 50年代進行 `fifties` | あの娘にタッチ・宝物（THE BLUE HEARTS）・C.h.a.o.s.m.y.t.h.（ONE OK ROCK）・Stand by Me・Earth Angel・Heart and Soul・Every Breath You Take | あり |
| ポップパンク進行 `pop_punk` | チェリー・もう少しだけ（イントロ・Aメロ）・Let It Be・The Sign | あり |
| Ⅳ-Ⅴ-Ⅵ進行 `iv_v_vi` | 打上花火（Ⅳ→Ⅴ→Ⅵm→Ⅰ = 4561進行） | あり |
| 循環コード `junkan` | Last Christmas・This Boy・All Right・Never Be the Same | **確認できず**（洋楽のみ） |
| アンダルシア進行 `andalusian` | Hit the Road Jack・Sultans of Swing・Smooth Criminal（サビ）・California Dreamin'・Stray Cat Strut・月光第1楽章 | **確認できず** |
| ラグタイム進行 `ragtime` | Sweet Georgia Brown・Five Foot Two, Eyes of Blue・Charleston・Ja-Da・Doxy・Liebesträume | **確認できず** |
| バックドア進行 `backdoor` | Lady Bird（3〜5小節目） | **確認できず** |
| Ⅰ-Ⅳ-Ⅴ-Ⅰ進行（カデンツ）`full_cadence` | 平均律クラヴィーア曲集 第2巻のハ長調プレリュード（バッハ）・ソナタ ニ短調 K.517（スカルラッティ）| **確認できず** |
| ブルース進行（8小節）`blues8` | Key to the Highway・Slow Down・Worried Life Blues（別の形） | **確認できず** |
| コンファーメーション `confirmation` | Confirmation（チャーリー・パーカー）。**並びは、あなたの指定で、資料での裏づけは取っていません**（`progression_catalog.md`）| **確認できず** |

日本の曲の例を確認できなかった進行は、技の詳細に「日本の曲の例は、確認できていません」と出します。**あなたの知っている曲があれば、`songs.js` の `SONGS` に足せます**（`{ t: '曲名', a: 'アーティスト', part: '使われている部分', src: 'rag' }` の形）。

## 食い違い・調べ直しで直したこと

- **Pretender**: 最初は王道進行の例だと思っていたが、資料では、**カノン進行を少し変形したもの**（イントロ・Aメロ）として紹介されていた。王道進行には、入れていない。
- **チェリー（スピッツ）**: RAG MUSIC は「レット・イット・ビー進行（1564進行）」、UtaTen は「Aメロがカノン進行」と紹介（資料どうしが食い違う）。**ポップパンク進行（Ⅰ-Ⅴ-Ⅵm-Ⅳ = 1564）のほうに、RAG MUSIC の分類で入れた**。
- **夜に駆ける・I LOVE...**: 王道進行（RAG MUSIC・UtaTen）と、丸サ進行（nippon.com。「要所で」「Aメロ・Bメロで」）の、両方に載っていた。曲の中で、部分ごとに別の進行を使っていると思われるので、両方に入れた（部分の書き方に、違いがある）。
- **MISIA「つつみ込むように…」**: 丸サ進行（nippon.com）と、小室進行（UtaTen の、検索結果の要約）の両方に載っていた。**丸サ進行のほうだけ**に入れた（原文を、確認できたほうを使った）。
- **Hit the Road Jack**: Wikipedia の本文に、アーティスト名の記載はなかった（レイ・チャールズの曲として知られている）。
- **愛唄・survival dAnce（小室進行）・Pretender（カノン進行の変形）**: UtaTen のページを、直接取得できなかった（404）ので、**検索結果の抜粋に載っていた文**から入れた。ほかの曲は、ページの内容（要約）を、取得して確認した。確かめたいときは、UtaTen の「小室進行」「カノン進行」の解説を、見てほしい。

## 調べた日・調べ方

- 2026-11-23。ウェブ検索と、ページの取得（要約つき）で確認した。**ページの要約は、機械が作ったもの**なので、原文の細かい言い回しまでは、確認していない。
- 検索で見つからなかったもの: アンダルシア進行・ラグタイム進行・バックドア進行・循環コードの、日本の曲の例（2026-11-23 時点の、この調査では、確認できなかった）。
