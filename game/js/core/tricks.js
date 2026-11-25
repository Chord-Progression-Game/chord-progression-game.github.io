// トリック（コード進行の技）の判定。ブラウザの外（テスト）でも動くように、DOM には触れない。
//
// ■ 考え方
//   ・盤（8つの位置）に並んだ駒を、時間の順に並べて、「隣り合うコードのつながり」を見る。
//   ・判定は度数（ルートの高さ・コードの種類）で行うので、キーを変えても結果は変わらない。
//   ・技は、1つのつながり（辺）を、1つの技だけが「取る」。長い・特別な技ほど優先して取る（優先度の高い順）。
//       → 画面で囲む範囲が重ならず、点数も二重に数えない。
//   ・隣り合う技が、駒を共有してつながると「コンボ」。同じ種類の技の繰り返しは点が下がる。多くの種類を使うと倍率が上がる。
//   ・技にならなかったつながりは、「性質」（ルートの動き・共通音・色）で描写する（画面の「オリジナル」。この描写では、点は変わらない）。
//     そのうえで、ジャッジ（sense.js。2026-11-16 に追加）が、耳に馴染む並びを加点、進行感のない並びを減点・指摘する（docs/judge_report.md）。
//
// ■ 技は、3つの仲間に分かれる（TRICKS の group）。「どこで成立するか」が、仲間ごとに違う
//   ・motion（つながり）: ドミナントモーション・弱進行・半音下。盤の、どこにあっても成立する
//   ・cadence（終止）  : Ⅴ-Ⅰ終止・ドミナント終止・ピカルディ終止・偽終止・バックドア進行（2026-11-18 に、終止の仲間になった）。フレーズの終わり
//                        （4番・8番の駒。または、その後に続く駒がないとき）で成立する   → PATTERNS の end: 'phrase'
//   ・named（固有進行）: 王道進行・小室進行など、名前のついた決まった並び。1番か5番から始まっていないと成立しない
//                        （たまたま 2〜4番に Ⅵm・Ⅳ・Ⅴ が並んでも、小室進行にはならない）   → PATTERNS の startAt: [0, 4]
//
// ■ 冒頭（1番）に、ドミナント系の駒（Ⅴ・Ⅲ7・Ⅰ7 など）が来ると、不自然（？）。その駒は、どの技にも使われず（コンボもとれず）、100点の減点。
//   （ドミナントモーションの得点を狙って、頭に置くのを防ぐ。2026-11-18 に、5番は対象から外れた。減点は、冒頭の1番だけ）
//   例外: ラグタイム進行のように、ドミナントが4度ずつ連なって Ⅴ に着き、そのあとに Ⅰ が2つぶん以上続くとき。8小節ブルース（Ⅰ7 から）
//
// ■ ループのつなぎ目（8番 → 1番）: 盤は輪になって演奏される。つなぎ目をまたいで、進行系の技（つながり: ドミナントモーション・弱進行・半音下。ツーファイブワンを含む）も、成立する
//
// ■ 技の定義は、すべて、このファイルの TRICKS と PATTERNS にある（点数も）。違っていたら、ここだけ直せば動く。

import { REPEAT_ID, degreeLabel } from './chords.js';
import { judge, senseTotals, idleCritique, endsPhrase, thirdPc, isMinorIv, isIvPlain, isDominantV, isTonicFamily, isSus, isSubstitute, borrowKey, SUB_VARIANTS, naturalAfterBorrowed, SENSE } from './sense.js';

export const PHRASE = 4;                 // 1フレーズ = 4つの位置（1〜4番・5〜8番）。フレーズの頭 = 位置 0 と 4（1番・5番）。冒頭（減点の対象）= 位置 0（1番）だけ
export const HEAD_V_PENALTY = 100;       // 冒頭（1番）の、ドミナント系の駒（Ⅴ・Ⅲ7・Ⅰ7 など）の減点

// ------------------------------------------------------------
// 技の種類。name は、画面に出す名前。sub は、よく知られた名前（あれば、そちらを大きく出す）
// ------------------------------------------------------------
export const TRICKS = {
  dominant_motion: {
    no: 1, group: 'motion', name: 'ドミナントモーション', color: '#e2704a',
    explain: 'ルートが完全5度下がる（＝完全4度上がる）進行を「強進行」といいます。次のコードを強く引っぱる力があります。ゲームの音も、ベースが5度下へ動いて、終止した感じになります。',
    variants: {
      '強進行': 'ルートが完全5度下へ（4度上へ）動きます。コードが次のコードを「引っぱる」動きです。',
      'セカンダリードミナント': 'Ⅴ7 のような「ドミナント」が Ⅰ 以外のコードへ向かう動き。ほんの一瞬そのコードが仮のトニック（主役）になります。',
      'ツーファイブワン': 'Ⅱm7 → Ⅴ7 → ⅠM7。強進行が2回つながったジャズの基本の形です。',
    },
  },
  weak_motion: {
    no: 2, group: 'motion', name: '弱進行', color: '#66a0dc',
    explain: 'ルートが完全5度上がる（＝4度下がる）進行を「弱進行」といいます。力は弱いけれどふわっと穏やかで安定した動きです。',
    variants: {
      'カノン進行': 'Ⅰ→Ⅴ→Ⅵm→Ⅲm→Ⅳ（→Ⅰ→Ⅳ→Ⅴ）。パッヘルベルの「カノン」で知られる弱進行を軸にした定番の流れです。1番から並べると決まります。',
      'カノン進行（完全な形）': 'Ⅰ→Ⅴ→Ⅵm→Ⅲm→Ⅳ→Ⅰ→Ⅳ→Ⅴ。盤の8つを使い切るカノン進行の完全な形です。',
    },
  },
  half_step_down: {
    no: 3, group: 'motion', name: '半音下への進行', color: '#aa8adc',
    explain: 'ルートが半音下がる進行。なめらかに「沈む」ような動きになります。',
    variants: {
      '裏コード': 'Ⅴ7 の代わりに ♭Ⅱ7 を使います。ドミナントと同じ「ファ」と「シ」（トライトーン）を共有しながら半音下がって Ⅰ へ解決します。',
    },
  },
  authentic_cadence: {
    no: 4, group: 'cadence', name: 'Ⅴ-Ⅰ終止', color: '#e2be54',
    explain: 'Ⅴ（またはⅤ7）から Ⅰ へ進む、いちばん強い終止（正格終止）です。「終わった」と感じます。Ⅴ7 の「シ」が「ド」へ、「ファ」が「ミ」へ解決します。フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {},
  },
  dominant_ending: {
    no: 5, group: 'cadence', name: 'ドミナント終止', color: '#5ecbbd',
    explain: 'Ⅰ・Ⅵm・Ⅳ系のコードから Ⅴ系へ進んで終わる終止（半終止）。ドミナントで終わるので「まだ続く…」という余韻が残ります。フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {},
  },
  picardy: {
    no: 6, group: 'cadence', name: 'ピカルディ終止', color: '#e28cb2',
    explain: 'Ⅵm（イ短調の主和音）で終わるはずのところを、長三和音の Ⅵ で終える終止。短調の暗い響きの最後だけが、ふっと明るくなります。Ⅲ7・Ⅴ・Ⅴ7・Ⅱm・Ⅵm・Ⅵsus4 のあとの、フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {
      'サスつき': 'Ⅵsus4 → Ⅵ。サス（4度の音）が半音さがって長三和音の3度へ。ほどけるように解決して最後だけが明るくなります。',
    },
  },
  iv_iii_vi: {
    no: 7, group: 'named', name: 'Ⅳ-Ⅲ-Ⅵ進行', color: '#52bd95',
    explain: 'Ⅳ→Ⅲ→Ⅵ。半音下がってから強進行で Ⅵm へ。切なくておしゃれな響きになります。1番か5番から並べると決まります。（ⅣM7→Ⅲ7→Ⅵm7 なら「丸サ進行」）',
    variants: {},
  },
  iv_v_vi: {
    no: 8, group: 'named', name: 'Ⅳ-Ⅴ-Ⅵ進行', color: '#97ca62',
    explain: 'Ⅳ→Ⅴ→Ⅵ。階段をのぼるように上がっていく進行。期待をふくらませて切ない Ⅵm に着きます。1番か5番から並べると決まります。',
    variants: {},
  },
  oudou: {
    no: 9, group: 'named', name: 'Ⅳ-Ⅴ-Ⅲ-Ⅵ進行', sub: '王道進行', color: '#e25c97',
    explain: 'Ⅳ→Ⅴ→Ⅲm→Ⅵm。J-POP の定番「王道進行」。盛り上がってから切なく着地します。（Ⅲは Ⅲ7 でも決まります）Ⅴ が Ⅰ に着かず Ⅵm で終わるので、偽終止のような余韻が残ります。1番か5番から並べると決まります。',
    variants: {},
  },
  komuro: {
    no: 10, group: 'named', name: '小室進行', color: '#e2a752',
    explain: 'Ⅵm→Ⅳ→Ⅴ。小室哲哉さんの曲によく使われたことからこう呼ばれます（続けて Ⅰ に着く Ⅵm→Ⅳ→Ⅴ→Ⅰ の形でも知られます）。哀愁があって力強い進行です。1番か5番から並べると決まります。',
    variants: {},
  },
  deceptive_cadence: {
    no: 11, group: 'cadence', name: '偽終止', color: '#b999dc',
    explain: 'フレーズの終わりを Ⅵm（Ⅵm7）で終える終止。とくに Ⅴ（Ⅴ7）のあとで Ⅰ に行くと思わせて Ⅵm（または Ⅵ♭M7）へ着くと、期待をはぐらかされる「偽の終止」になります。終わりきらない切ない余韻が残ります。前のコードは何でもかまいません。フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {},
  },
  maru_sa: {
    no: 12, group: 'named', name: '丸サ進行', color: '#4cc2ad',
    explain: 'ⅣM7→Ⅲ7→Ⅵm7（→Ⅴm7→Ⅰ7）。椎名林檎「丸の内サディスティック」で広まった進行で、「Just The Two of Us」の進行とも呼ばれます。Ⅲ7 が Ⅵm7 を引っぱって、浮遊感のある切ない響きになります。1番か5番から並べると決まります。',
    variants: {
      'Ⅰ7まで': 'ⅣM7→Ⅲ7→Ⅵm7→Ⅰ7。丸サ進行に Ⅰ7 を足した形です。Ⅰ7 は次の Ⅳ へ向かうドミナントとして働きます。',
      '完全な形': 'ⅣM7→Ⅲ7→Ⅵm7→Ⅴm7→Ⅰ7。Ⅴm7→Ⅰ7 がツーファイブのように働いて、最初の Ⅳ へ戻る力が生まれます。',
    },
  },
  fifties: {
    no: 13, group: 'named', name: '50年代進行', color: '#e2b74a',
    explain: 'Ⅰ→Ⅵm→Ⅳ→Ⅴ。1950年代のドゥーワップなどで定番になった進行（「Stand By Me」など）。素朴であたたかい響きです。1番か5番から並べると決まります。',
    variants: {},
  },
  pop_punk: {
    no: 14, group: 'named', name: 'ポップパンク進行', color: '#e27d79',
    explain: 'Ⅰ→Ⅴ→Ⅵm→Ⅳ。ポップスやロックで世界中の曲に使われている定番の4コードです。明るさと切なさが交互にやってきます。1番か5番から並べると決まります。',
    variants: {},
  },
  junkan: {
    no: 15, group: 'named', name: '循環コード', color: '#76c2dc',
    explain: 'Ⅰ→Ⅵm→Ⅱm→Ⅴ（「イチ・ロク・ニー・ゴー」）。Ⅴ のあとまた Ⅰ へ戻れるので、ぐるぐる回り続けられます。ジャズや歌謡曲の定番です。1番か5番から並べると決まります。',
    variants: {},
  },
  andalusian: {
    no: 16, group: 'named', name: 'アンダルシア進行', color: '#e29756',
    explain: 'Ⅵm→Ⅴ→Ⅳ→Ⅲ（Key=C なら Am→G→F→E）。ルートが階段を下りていく、スペインの民族音楽に由来する進行。情熱的で緊張感があります。1番か5番から並べると決まります。',
    variants: {},
  },
  ragtime: {
    no: 17, group: 'named', name: 'ラグタイム進行', color: '#c3cf60',
    explain: 'Ⅲ7→Ⅵ7→Ⅱ7→Ⅴ7→Ⅰ。ドミナント7th が5度ずつ下がって連なる進行。ラグタイムなどで使われ、弾むような響きになります。冒頭（1番）から並べて、最後の Ⅰ を2つぶん以上（Ⅰ・Ⅰ か Ⅰ →）つづけると決まります。ドミナントが連なっても、Ⅰ にしっかり着くので、冒頭の Ⅲ7 は減点されません。',
    variants: {},
  },
  backdoor: {
    no: 18, group: 'cadence', name: 'バックドア進行', color: '#9e8adc',
    explain: 'Ⅳm7→Ⅶ♭7→ⅠM7。ふつうの「Ⅱm7→Ⅴ7→Ⅰ」を表玄関とすると、こちらは「裏口」から入る終止。Ⅶ♭7 は同主短調から借りてきたドミナントです。ジャズで使われます。フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {},
  },
  full_cadence: {
    no: 19, group: 'named', name: 'Ⅰ-Ⅳ-Ⅴ-Ⅰ進行', sub: 'カデンツ', color: '#7e9adc',
    explain: 'Ⅰ→Ⅳ→Ⅴ→Ⅰ。安定（T）→広がり（S）→緊張（D）→安定（T）と動く、和声の基本の終止の形「カデンツ」です。1番か5番から並べると決まります。',
    variants: {},
  },
  confirmation: {
    no: 21, group: 'named', name: 'コンファーメーション', color: '#caa660',
    explain: 'ⅠM7→Ⅶm7♭5→Ⅲ7→Ⅵm7（→Ⅴm7→Ⅰ7）。ビバップの名曲「Confirmation」（チャーリー・パーカー）に由来する進行で、J-POP でも使われます。ドミナントが次々に連なって、おしゃれにぐいぐい進みます。「→」でのばしてもかまいません。1番か5番から並べると決まります。',
    variants: {
      '完全な形': 'ⅠM7→Ⅶm7♭5→Ⅲ7→Ⅵm7→Ⅴm7→Ⅰ7。Ⅵm7 のあと Ⅴm7→Ⅰ7 まで続く全体の形です。最後の Ⅰ7 は次の Ⅳ へ向かうドミナントになります。',
    },
  },
  // ---- 借用和音（2026-11-16）: 短調から借りてきた和音（サブドミナントマイナー）と、その代理 ----
  sdm: {
    no: 22, group: 'borrowed', name: 'サブドミナントマイナー', color: '#c9965f',
    explain: 'Ⅳm（Ⅳm7・Ⅳm6）は、Ⅳ（ファ・ラ・ド）の「ラ」を「ラ♭」に変えた、短調から借りてきた和音。明るい曲にふっとせつない影を落とします。そのあと Ⅰ・Ⅴ などへ自然に着地すると技になります（着地できない借用は唐突に聞こえます）。',
    variants: {
      'Ⅳ→Ⅳm→Ⅰ': 'Ⅳ→Ⅳm→Ⅰ。Ⅳ の「ラ」が半音さがって「ラ♭」になり、そのまま「ソ」（Ⅰ・Ⅴ の音）へ。半音ずつ下がるなめらかでせつない着地です。',
    },
  },
  sdm_sub: {
    no: 23, group: 'borrowed', name: 'サブドミナントマイナーの代理', color: '#d19b83',
    explain: 'サブドミナントマイナー（Ⅳm）の代わりに使える短調の色の和音（Ⅱ♭M7・Ⅵ♭M7・Ⅶ♭7）と、同じ短調から借りてきた和音（Ⅲ♭M7・Ⅲ♭m6）。借りてきた和音のあとに Ⅰ・Ⅴ などの自然な和音が続くと技になります。',
    variants: {
      'ネアポリタン': 'Ⅱ♭M7（ネアポリタン）は Ⅱ（レ）を半音下げたほの暗い和音。サブドミナントの働きをして、Ⅰ や Ⅴ へ着地するとドラマチックに聞こえます。',
      'ネアポリタン進行': 'Ⅱ♭M7→Ⅴ→Ⅰ。ほの暗い Ⅱ♭M7 から Ⅴ へ進んで Ⅰ に解決する、クラシック由来のドラマチックな進行です。',
      '♭Ⅵ': 'Ⅵ♭M7（♭Ⅵ）は短調から借りてきた、ふくらみのある和音。Ⅳm7 と構成音が3つ共通で、代わりに使えます。Ⅶ♭7・Ⅴ などへ進むと広がりのある映画のような響きになります。',
      '♭Ⅶ': 'Ⅶ♭7（♭Ⅶ）は Ⅰ へ向かう柔らかいドミナント。Ⅴ7 よりふわっとブルージーに解決します。',
      '♭Ⅲ': 'Ⅲ♭M7（♭Ⅲ）は短調から借りてきた明るい影の和音。Ⅳ・Ⅵ♭M7・Ⅶ♭7 などへ階段のように続きます。',
      '♭Ⅲm6': 'Ⅲ♭m6 はほの暗くゆらぐ響きの借用和音。Ⅱm7・Ⅱ♭M7・Ⅰ・Ⅴ などへ進むと自然に聞こえます。',
    },
  },
  plagal_cadence: {
    no: 24, group: 'cadence', name: 'Ⅳ-Ⅰ終止', sub: 'プラガル終止', color: '#d6a35e',
    explain: 'Ⅳ（ⅣM7）から Ⅰ（ⅠM7）へ進む終止。変格終止、讃美歌の「アーメン」の響きから「アーメン終止」とも呼ばれます。Ⅴ-Ⅰ終止ほど強くはありませんが、やわらかく、おだやかに終わります。Ⅴ-Ⅰ終止のあとに足されることも、よくあります。フレーズの終わり（4番・8番、または最後の駒）で決まります。',
    variants: {},
  },
  cliche: {
    no: 25, group: 'inner', name: 'クリシェ', sub: 'ライン・クリシェ', color: '#8cc7b0',
    explain: '同じ和音（同じルート）が続くあいだ、内側の声が、半音ずつ、同じ向きに動き続ける技（ライン・クリシェ）。ルートと3度は動かさず、5度・6度・7度などの1つの声が、なめらかな線を描きます（Ⅰ→ⅠM7→Ⅰ7 の「ド → シ → シ♭」・Ⅰ→Ⅰaug→Ⅰ6→Ⅰ7 の「ソ → ソ♯ → ラ → シ♭」・Ⅵm→ⅥmM7→Ⅵm7→Ⅵm6 の「ラ → ソ♯ → ソ → ファ♯」など）。同じ和音を長くのばすときに、動きと切なさを足せます。盤の、どの位置でも決まります。',
    variants: {
      '4つの和音': '同じルートの和音が4つ続いて、半音の線が3回動きます。ⅠM7→Ⅰ7→Ⅰ6 のあとに Ⅰaug をつなぐ、のように、さらに長くなるほど、聞きごたえがあります。',
      '5つの和音': '同じルートの和音が5つ続いて、半音の線が4回動きます。',
    },
  },
  passing_dim: {
    no: 26, group: 'motion', name: 'パッシング・ディミニッシュ', color: '#a99be0',
    explain: 'ディミニッシュ（dim7）が、前か後のコードの、半音上か半音下にあるとき、経過の和音として加点される技（Ⅴ♯dim7 → Ⅵm7 は「ソ♯ → ラ」。ルートが半音でつながるので、次のコードへ強く解決します）。進行そのものは、ディミニッシュを飛ばして数えます（ⅣM7 → Ⅲ7｜Ⅴ♯dim7 → Ⅵm7 → Ⅰ7 は、丸サ進行として決まります）。盤の、どの位置でも決まります。',
    variants: {
      'のぼる形': '前のコードから、半音ずつのぼって、次のコードへ（例: Ⅴ → Ⅴ♯dim7 → Ⅵm）。',
      'くだる形': '前のコードから、半音ずつくだって、次のコードへ（例: Ⅵm → Ⅴ♯dim7 → Ⅴ）。',
      '行って、もどる形': '前のコードの、半音上か半音下の dim7 へ寄り道して、同じルートのコードへもどります（例: Ⅵm → Ⅴ♯dim7 → Ⅵm7）。',
      '次のコードの半音下から': 'dim7 のルートが、次のコードの半音下。次のコードへ、導音のように、強く解決します（例: Ⅴ♯dim7 → Ⅵm7。前のコードが Ⅲ7 でも決まります）。',
      '次のコードの半音上から': 'dim7 のルートが、次のコードの半音上。半音さがって、次のコードへ解決します（例: Ⅴ♯dim7 → Ⅴ7）。',
      '前のコードの半音上へ': '前のコードの、半音上に dim7 を置きます（例: Ⅴ → Ⅴ♯dim7）。',
      '前のコードの半音下へ': '前のコードの、半音下に dim7 を置きます（例: Ⅵm → Ⅴ♯dim7）。',
    },
  },
  blues8: {
    no: 20, group: 'named', name: 'ブルース進行', color: '#6a95dc',
    explain: 'Ⅰ→Ⅴ→Ⅳ→Ⅳ→Ⅰ→Ⅴ→Ⅰ→Ⅴ。ブルースの形のひとつ。定番は12小節ですが盤は8つなので、8小節の形です。1番から8番までぜんぶ使います。',
    variants: {
      '8小節ブルース': 'Ⅰ→Ⅴ→Ⅳ→Ⅳ→Ⅰ→Ⅴ→Ⅰ→Ⅴ。盤の8つを使い切るブルースの形です。',
    },
  },
};

// 冒頭（1番）のドミナント系の駒（？）の説明
export const HEAD_V = {
  id: 'head_v', name: '？', title: '冒頭のドミナント', color: '#969eb0',
  reason: 'Ⅴ・Ⅲ7・Ⅰ7 のような「ドミナント」は「次へ進みたい」響きなので、いちばん最初に置くと落ち着かず、なんだか不自然（？）です。技にならず、コンボもとれず、100点の減点。2番以降に置いてみよう（5番は大丈夫です）。ラグタイム進行（Ⅰ を2つぶん以上つづける）なら、冒頭でも認められます。',
};

// 点数（仮。遊びながら調整する）
//   2026-11-24 に、配分を見直した（ご指摘: 名前のついた進行の点と倍率が、内声・ほかの技にくらべて大きすぎる / 駒を載せれば載せるだけ点がふえる「載せ得」）
//     ① 名前のついた進行の基本の点を、約6割に / コンボの倍率を、最大 ×3 → ×1.6 に / 種類の数の倍率を、1種類ごとに +10% → +5% に
//     ② 駒をふやしても、技や耳に馴染むつながりに使われていない駒は、右の「技」の欄に、0点の指摘で出す（sense.js の idle。第10弾で、−15 の減点をやめた）。※ 同じ和音が続く = 「→」と同じ（buildSegments が1つにまとめる）ので、減点はない（第9弾で、−20 を削除）
//     ③ 「コードの難しさ」の加点は、技や、耳に馴染むつながりに使われた駒だけ（使われていない難しい駒を、ならべても、点にならない）
//   名前のついた進行は、その進行を、ふつうのつながりに分けたときの合計より、いつも高くなるようにしてある（テストで確かめている）
export const SCORE = {
  repeatMult: [1, 0.6, 0.4, 0.3, 0.2],       // 同じ種類の技の、1回目・2回目・…（5回目以降は 0.2）
  comboMult: [1, 1, 1.15, 1.3, 1.45, 1.6],   // つながった技の数（0, 1, 2, 3, 4, 5以上）
  varietyStep: 0.05,                         // 種類が1つ増えるごとに +5%
  headVPenalty: HEAD_V_PENALTY,
  // コードの難しさ（駒のレベル）のボーナス: 盤の上で、技に使われた「ちがう駒」ごとに、1回だけ足す。Lv1 は 0（技の点だけ）。技の倍率には、含めない
  levelBonus: { 1: 0, 2: 5, 3: 10, 4: 20, 5: 30 },
};

// ------------------------------------------------------------
// 駒の条件（マッチャー）
//   on(ルートの高さ[], コードの種類[])。ルートの高さは、主音からの半音数（Ⅰ=0 Ⅳ=5 Ⅴ=7 Ⅵ=9 ♭Ⅱ=1 …）
// ------------------------------------------------------------
const MAJ = ['maj', 'maj7'];
const DOM = ['dom7'];
const SUS = ['sus47'];

const on = (pcs, types) => (c) => !c.isRepeat && pcs.includes(c.rootPc) && types.includes(c.type);
const I = on([0], MAJ);
const IV = on([5], MAJ);
const V = on([7], [...MAJ.slice(0, 1), ...DOM]);          // Ⅴ（長三和音）・Ⅴ7
const V_ANY = on([7], ['maj', ...DOM, ...SUS]);           // Ⅴ・Ⅴ7・Ⅴsus47
const VIm = on([9], ['min', 'min7']);
const IIIm = on([4], ['min', 'min7']);
const III_ANY = on([4], [...DOM, 'min', 'min7']);         // Ⅲ7・Ⅲm・Ⅲm7（Ⅳ-Ⅲ-Ⅵ のⅢ）
const IIm = on([2], ['min', 'min7']);
const VI_ANY = on([9], [...DOM, 'min', 'min7']);          // Ⅵm・Ⅵm7・Ⅵ7（循環コードのⅥ）
const IV_MAJ7 = on([5], ['maj7']);
const III7 = on([4], DOM);
const VIm7 = on([9], ['min7']);
const Vm7 = on([7], ['min7']);
const I7 = on([0], DOM);
const VI7 = on([9], DOM);
const II7 = on([2], DOM);
const V7 = on([7], DOM);
const IVm7 = on([5], ['min7']);
const VII_FLAT7 = on([10], DOM);
const BLUES_I = on([0], [...MAJ, ...DOM]);                // ブルースの Ⅰ（Ⅰ・ⅠM7・Ⅰ7）
const BLUES_V = V;                                        // ブルースの Ⅴ（Ⅴ・Ⅴ7）
const VI_MINOR = (c) => !c.isRepeat && c.rootPc === 9 && ['min', 'min7'].includes(c.type);        // Ⅵm・Ⅵm7（偽終止の行き先）
const VI_FLAT_MAJ7 = (c) => !c.isRepeat && c.rootPc === 8 && c.type === 'maj7';                  // 借用のⅥ♭M7（Ⅴ のあとだけ、偽終止）
const VI_MAJOR = on([9], ['maj']);                                                                  // Ⅵ（長三和音。Key=C なら A）。ピカルディ終止の着地点
const PICARDY_FROM = (c) => !c.isRepeat && ((c.rootPc === 4 && c.type === 'dom7')                   // Ⅲ7（イ短調の Ⅴ7）
  || (c.rootPc === 7 && ['maj', 'dom7', 'sus47'].includes(c.type))                                  // Ⅴ・Ⅴ7・Ⅴsus47（イ短調の ♭Ⅶ。アンダルシアやロックの終わり方）
  || (c.rootPc === 2 && ['min', 'min7'].includes(c.type))                                           // Ⅱm・Ⅱm7（イ短調の Ⅳm。アーメン終止の形）
  || (c.rootPc === 9 && ['min', 'min7', 'sus4', 'sus47'].includes(c.type)));                        // Ⅵm・Ⅵm7（主和音が、短三和音から長三和音へ）・Ⅵsus4（サス）
const DOMINANT_ENDING_FROM = (c) => !c.isRepeat && ((c.rootPc === 0 && MAJ.includes(c.type)) || (c.rootPc === 9 && ['min', 'min7'].includes(c.type)) || (c.rootPc === 5 && [...MAJ, 'min7', 'min6'].includes(c.type)));   // Ⅰ系・Ⅵm系・Ⅳ系

// 辺（2つのコード）の、ルートの動き（上向きに何半音か。0〜11）
const rootMotion = (a, b) => (((b.rootPc - a.rootPc) % 12) + 12) % 12;

// ---- クリシェ（ライン・クリシェ）の判定（2026-11-24）----
//   同じルートの和音が続くあいだ、内側の声（3度以外。ルート・5度・6度・7度など）が、半音ずつ、同じ向きに動き続けること（出典: docs/theory_audit.md の「2026-11-24 の追加」）。
//   例: Ⅰ → ⅠM7 → Ⅰ7（ド → シ → シ♭）/ Ⅰ → Ⅰaug → Ⅰ6 → Ⅰ7（ソ → ソ♯ → ラ → シ♭）/ Ⅵm → ⅥmM7 → Ⅵm7 → Ⅵm6（ラ → ソ♯ → ソ → ファ♯）
//   evs: 並びの駒（2つ以上でも調べられる。ヒントが「途中」を調べるときのため）。3度が変わる（長 ↔ 短）ものは、クリシェではない（3度は動かさない）
const ANY_PIECE = (c) => !c.isRepeat;
export function isLineCliche(evs) {
  if (!evs || evs.length < 2) return false;
  const cs = evs.map((e) => e.chord);
  if (cs.some((c) => c.isRepeat)) return false;
  const root = cs[0].rootPc, third = thirdPc(cs[0]);
  if (cs.some((c) => c.rootPc !== root || thirdPc(c) !== third)) return false;
  for (const d of [1, 11]) {
    for (const p0 of cs[0].pcs) {
      let cur = p0, ok = p0 !== third;
      for (let k = 1; ok && k < cs.length; k++) { cur = (cur + d) % 12; ok = cs[k].pcs.includes(cur) && cur !== third; }
      if (ok) return true;
    }
  }
  return false;
}

// ---- パッシング・ディミニッシュの判定（2026-11-24。2026-11-25 に、ご指定で作りなおし）----
//   ディミニッシュ（dim7・dim）が、前か後のコードの、半音上か半音下にあるとき、経過の和音（パッシング・ディミニッシュ）として、加点する。
//   進行そのものは、そのディミニッシュを飛ばして、評価する（例: ⅣM7 → Ⅲ7｜Ⅴ♯dim7 → Ⅵm7 → Ⅰ7 は、Ⅴ♯dim7 を飛ばして、丸サ進行。Ⅴ♯dim7 → Ⅵm7 の「ソ♯ → ラ」が、パッシング・ディミニッシュ）
//   ・となりが、ディミニッシュではないコードで、ルートが半音はなれているときだけ（となりが「？」の駒のときは、使わない）
//   ・前と後の両方が半音はなれているときは、3つのコード（前・dim・後）で、1つの技（のぼる形・くだる形・行って、もどる形）。片方だけのときは、dim とそのとなりの、2つのコード
const isDimChord = (c) => !!c && !c.isRepeat && (c.type === 'dim7' || c.type === 'dim');
// 並び seg の中の、パッシング・ディミニッシュ（経過の dim）の位置（イベント番号）の一覧
export function passingDimIndexes(seg) {
  const out = [];
  for (let i = 0; i < seg.length; i++) {
    const d = seg[i];
    if (d.blocked || !isDimChord(d.chord)) continue;
    const anchor = (e) => !!e && !e.blocked && !e.chord.isRepeat && !isDimChord(e.chord) && [1, 11].includes(rootMotion(d.chord, e.chord));
    if (anchor(seg[i - 1]) || anchor(seg[i + 1])) out.push(i);
  }
  return out;
}

// 並び seg から、経過の dim を飛ばした並び（chain）を作る。ornaments: 飛ばした dim の一覧 { idx（seg の中の番号）, prev・next（となりのイベント。半音でつながっているものだけ。なければ null）}
//   dim を飛ばしたら、同じコードが並んだ（Ⅵm → dim → Ⅵm）ときは、同じコードの連続 = 「→」と同じ（1つにまとめる）。もとのイベントは、書きかえない（まとめるときは、写しを使う）
//   map: seg の番号 → chain の番号（飛ばした dim は -1）
export function chainOf(seg) {
  const idx = passingDimIndexes(seg);
  if (!idx.length) return { chain: seg, ornaments: [], map: seg.map((_, i) => i) };
  const skip = new Set(idx);
  const chain = [], map = new Array(seg.length).fill(-1);
  seg.forEach((ev, i) => {
    if (skip.has(i)) return;
    const last = chain[chain.length - 1];
    if (last && last.chord === ev.chord) chain[chain.length - 1] = { ...last, last: ev.last, positions: [...last.positions, ...ev.positions] };
    else chain.push(ev);
    map[i] = chain.length - 1;
  });
  const near = (d, e) => (e && !e.blocked && !e.chord.isRepeat && !isDimChord(e.chord) && [1, 11].includes(rootMotion(d.chord, e.chord)) ? e : null);
  const ornaments = idx.map((i) => ({ idx: i, ev: seg[i], prev: near(seg[i], seg[i - 1]), next: near(seg[i], seg[i + 1]), prevIdx: i - 1, nextIdx: i + 1 }));
  return { chain, ornaments, map };
}

// 経過の dim の技の、形の名前（variants）。前・次: となりのイベント（半音はなれているものだけ。なければ null）
function passingDimVariant(prev, d, next) {
  if (prev && next) {
    const up = rootMotion(prev.chord, d.chord) === 1 && rootMotion(d.chord, next.chord) === 1;
    const down = rootMotion(prev.chord, d.chord) === 11 && rootMotion(d.chord, next.chord) === 11;
    return up ? 'のぼる形' : down ? 'くだる形' : '行って、もどる形';
  }
  if (next) return rootMotion(d.chord, next.chord) === 1 ? '次のコードの半音下から' : '次のコードの半音上から';
  return rootMotion(prev.chord, d.chord) === 1 ? '前のコードの半音上へ' : '前のコードの半音下へ';
}

// セカンダリードミナント: ドミナント（ドミナント7th。Ⅵ の長三和音も、Ⅱm のドミナント）が、Ⅰ（主和音）以外のコードへ、ルートが4度上がって進む動き（Ⅴ7→Ⅰ は、ふつうのドミナントなので、含めない）
function isSecondaryDominant(a, b) { return (a.type === 'dom7' || (a.type === 'maj' && a.rootPc === 9)) && b.rootPc !== 0; }

// ドミナント系の駒か（次のコードを強く引っぱる駒）: Ⅴ系（Ⅴ・Ⅴ7・Ⅴm7・Ⅴsus47）・ドミナント7th（Ⅰ7・Ⅱ7・Ⅲ7・Ⅵ7・Ⅶ♭7・Ⅱ♭7）・Ⅵ（長三和音。Ⅱm のドミナント）・Ⅴ#dim7
export function isDominantType(c) {
  return !!c && !c.isRepeat && (c.rootPc === 7 || c.type === 'dom7' || c.type === 'dim7' || (c.rootPc === 9 && c.type === 'maj'));
}

// 冒頭（1番）に置かれた、ドミナント系の駒か（2026-11-18: 以前は 1番と5番の Ⅴ。いまは 1番だけ。Ⅲ7・Ⅰ7 などの、セカンダリードミナントも）。
//   「→」でのばしただけの位置は、数えない。例外（ラグタイム進行など）は、buildSegments が、blocked を外す
export function isHeadV(ev) {
  return !!ev && !!ev.chord && isDominantType(ev.chord) && ev.first === 0;
}

// 冒頭のドミナント系の駒の減点を、許す形（seg = 1番から始まる並び）:
//   ① ドミナント（7th。最後は Ⅴ系）が、4度ずつ上がって連なり（Ⅲ7→Ⅵ7→Ⅱ7→Ⅴ7。Ⅴ7 だけでもよい）、そのあとに、Ⅰ・ⅠM7 が2つぶん以上続く（Ⅰ・Ⅰ、または Ⅰ →）
//   ② 8小節ブルース（Ⅰ7 から始まる形）
function headExempt(seg) {
  let k = 0;
  while (k < seg.length) {
    const c = seg[k].chord;
    const domChain = c.type === 'dom7' || (c.rootPc === 7 && (c.type === 'maj' || c.type === 'sus47'));
    if (!domChain || (k > 0 && rootMotion(seg[k - 1].chord, c) !== 5)) break;
    k++;
  }
  if (k >= 1 && seg[k - 1].chord.rootPc === 7 && k < seg.length) {
    const e = seg[k], tonic = (x) => x && x.chord.rootPc === 0 && (x.chord.type === 'maj' || x.chord.type === 'maj7');
    if (tonic(e) && (e.last - e.first >= 1 || tonic(seg[k + 1]))) return true;
  }
  return PATTERNS.some((p) => p.kind === 'blues8' && p.steps.length <= seg.length && p.steps.every((m, i) => m(seg[i].chord)) && (!p.check || p.check(seg.slice(0, p.steps.length), {})));
}

// ------------------------------------------------------------
// 技のパターン（優先度 tier の高い順に、つながりを取っていく）
//   steps: 並びのコードの条件 / points: 点数 / check: 追加の条件 / bonus: 本来の形のときの上乗せ
//   startAt: [0, 4] … 最初の駒が、この位置（0 = 1番、4 = 5番）にあるときだけ成立する（固有進行）
//   end: 'phrase' … 最後の駒が、フレーズの終わり（4番・8番）か、その後に続く駒がないときだけ成立する（終止）
//   extend: [{ steps, points, variant }, ...] … 続けて、この並びが来ると、長い形（上乗せの点）。長いものから順に書く
//   prefer: ヒント用。「この次は、これがおすすめ」の駒の名前（ステップごと）
//   hintAdvanced: ヒント用。この技が決まる駒は、「おすすめ」ではなく「発展」に出す（特別な終わり方なので）
// ------------------------------------------------------------
const HEAD = [0, 4];   // 固有進行が始まれる位置（1番・5番）

export const PATTERNS = [
  // ---- tier 100: 4つ以上の、名前のついた進行 ----
  // 王道進行: Ⅳ→Ⅴ→Ⅲ→Ⅵm。Ⅲ は、Ⅲm・Ⅲm7 のほか、Ⅲ7 でもよい（Ⅲ7 の王道も、よく使われる）
  { id: 'oudou', kind: 'oudou', tier: 100, startAt: HEAD, steps: [IV, V, III_ANY, VIm], points: 380, prefer: [['ⅣM7', 'Ⅳ'], ['Ⅴ7', 'Ⅴ'], ['Ⅲm7', 'Ⅲm'], ['Ⅵm7', 'Ⅵm']] },
  // 丸サ進行: ⅣM7→Ⅲ7→Ⅵm7（3つ）。続けて Ⅰ7（4つ）、Ⅴm7→Ⅰ7（5つ）なら、長い形
  { id: 'maru_sa', kind: 'maru_sa', tier: 98, startAt: HEAD, steps: [IV_MAJ7, III7, VIm7], points: 300,
    extend: [{ steps: [Vm7, I7], points: 300, variant: '完全な形' }, { steps: [I7], points: 120, variant: 'Ⅰ7まで' }],
    prefer: [['ⅣM7'], ['Ⅲ7'], ['Ⅵm7'], ['Ⅴm7', 'Ⅰ7'], ['Ⅰ7']] },
  // コンファーメーション: ⅠM7→Ⅶm7♭5→Ⅲ7→Ⅵm7（4つ）。続けて Ⅴm7→Ⅰ7 なら、完全な形（6つ）。「→」は、つなぎ目として無視する。ツーファイブワン（Ⅶm7♭5→Ⅲ7→Ⅵm7）より優先
  { id: 'confirmation', kind: 'confirmation', tier: 97, startAt: HEAD, steps: [I, on([11], ['min7b5']), III7, VIm7], points: 400,
    extend: [{ steps: [Vm7, I7], points: 280, variant: '完全な形' }], prefer: [['ⅠM7', 'Ⅰ'], ['Ⅶm7-5'], ['Ⅲ7'], ['Ⅵm7'], ['Ⅴm7'], ['Ⅰ7']] },
  // ブルース進行（8小節）: Ⅰ→Ⅴ→Ⅳ→Ⅳ→Ⅰ→Ⅴ→Ⅰ→Ⅴ。Ⅳ をのばす（Ⅳ → ）形でもよい
  { id: 'blues8', kind: 'blues8', variant: '8小節ブルース', tier: 96, startAt: [0], steps: [BLUES_I, BLUES_V, IV, IV, BLUES_I, BLUES_V, BLUES_I, BLUES_V], points: 550,
    prefer: [['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ'], ['Ⅳ'], ['Ⅳ'], ['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ'], ['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ']] },
  { id: 'blues8_held', kind: 'blues8', variant: '8小節ブルース', tier: 96, startAt: [0], steps: [BLUES_I, BLUES_V, IV, BLUES_I, BLUES_V, BLUES_I, BLUES_V], points: 550,
    check: (evs) => evs.length < 3 || evs[2].last - evs[2].first === 1, prefer: [['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ'], ['Ⅳ'], ['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ'], ['Ⅰ7', 'Ⅰ'], ['Ⅴ7', 'Ⅴ']] },
  // カノン進行: Ⅰ→Ⅴ→Ⅵm→Ⅲm→Ⅳ（5つ）。続けて Ⅰ→Ⅳ→Ⅴ（合わせて8つ）なら、完全な形
  { id: 'canon', kind: 'weak_motion', variant: 'カノン進行', tier: 95, startAt: [0], steps: [I, V, VIm, IIIm, IV], points: 300,
    extend: [{ steps: [I, IV, V], points: 300, variant: 'カノン進行（完全な形）' }], prefer: [['Ⅰ'], ['Ⅴ'], ['Ⅵm'], ['Ⅲm'], ['Ⅳ'], ['Ⅰ'], ['Ⅳ'], ['Ⅴ']] },
  // ---- tier 92: 4つの、名前のついた進行 ----
  // ラグタイム進行（2026-11-18）: 冒頭（1番）から。Ⅲ7→Ⅵ7→Ⅱ7→Ⅴ7 のあと、Ⅰ が2つぶん以上（Ⅰ →・Ⅰ Ⅰ）。ドミナントが冒頭に来るので、この形のときだけ、冒頭の減点を外す（headExempt）
  { id: 'ragtime_held', kind: 'ragtime', tier: 92, startAt: [0], steps: [III7, VI7, II7, V7, I], points: 800,
    check: (evs) => evs.length < 5 || evs[4].last - evs[4].first >= 1, prefer: [['Ⅲ7'], ['Ⅵ7'], ['Ⅱ7'], ['Ⅴ7'], ['ⅠM7', 'Ⅰ']] },
  { id: 'ragtime', kind: 'ragtime', tier: 92, startAt: [0], steps: [III7, VI7, II7, V7, I, I], points: 800, prefer: [['Ⅲ7'], ['Ⅵ7'], ['Ⅱ7'], ['Ⅴ7'], ['ⅠM7', 'Ⅰ'], ['ⅠM7', 'Ⅰ']] },
  { id: 'junkan', kind: 'junkan', tier: 92, startAt: HEAD, steps: [I, VI_ANY, IIm, V], points: 300, prefer: [['ⅠM7', 'Ⅰ'], ['Ⅵm7', 'Ⅵm', 'Ⅵ7'], ['Ⅱm7', 'Ⅱm'], ['Ⅴ7', 'Ⅴ']] },
  { id: 'fifties', kind: 'fifties', tier: 92, startAt: HEAD, steps: [I, VIm, IV, V], points: 300, prefer: [['Ⅰ', 'ⅠM7'], ['Ⅵm', 'Ⅵm7'], ['Ⅳ', 'ⅣM7'], ['Ⅴ', 'Ⅴ7']] },
  { id: 'pop_punk', kind: 'pop_punk', tier: 92, startAt: HEAD, steps: [I, V, VIm, IV], points: 300, prefer: [['Ⅰ', 'ⅠM7'], ['Ⅴ', 'Ⅴ7'], ['Ⅵm', 'Ⅵm7'], ['Ⅳ', 'ⅣM7']] },
  { id: 'andalusian', kind: 'andalusian', tier: 92, startAt: HEAD, steps: [VIm, V, IV, III7], points: 330, prefer: [['Ⅵm', 'Ⅵm7'], ['Ⅴ', 'Ⅴ7'], ['Ⅳ', 'ⅣM7'], ['Ⅲ7']] },
  { id: 'full_cadence', kind: 'full_cadence', tier: 92, startAt: HEAD, steps: [I, IV, V, I], points: 400, prefer: [['Ⅰ', 'ⅠM7'], ['Ⅳ', 'ⅣM7'], ['Ⅴ', 'Ⅴ7'], ['Ⅰ', 'ⅠM7']] },
  // ---- tier 90: 3つの、名前のついた進行 ----
  { id: 'komuro', kind: 'komuro', tier: 90, startAt: HEAD, steps: [VIm, IV, V], points: 240, prefer: [['Ⅵm7', 'Ⅵm'], ['ⅣM7', 'Ⅳ'], ['Ⅴ7', 'Ⅴ']] },
  { id: 'iv_iii_vi', kind: 'iv_iii_vi', tier: 90, startAt: HEAD, steps: [IV, III_ANY, VIm], points: 240, prefer: [['ⅣM7', 'Ⅳ'], ['Ⅲ7', 'Ⅲm7'], ['Ⅵm7', 'Ⅵm']] },
  { id: 'iv_v_vi', kind: 'iv_v_vi', tier: 90, startAt: HEAD, steps: [IV, V, VIm], points: 380, prefer: [['ⅣM7', 'Ⅳ'], ['Ⅴ7', 'Ⅴ'], ['Ⅵm7', 'Ⅵm']] },
  // バックドア進行: Ⅳm7→Ⅶ♭7→Ⅰ。終止の形（2026-11-18）なので、フレーズの終わりで成立する（1番か5番から、ではない）
  { id: 'backdoor', kind: 'backdoor', tier: 90, end: 'phrase', steps: [IVm7, VII_FLAT7, I], points: 280, prefer: [['Ⅳm7'], ['Ⅶ♭7'], ['ⅠM7', 'Ⅰ']] },
  // ---- tier 88〜86: 内声・経過の技（2026-11-24）----
  // クリシェ: 同じルートの和音が3つ以上続いて、内側の声が、半音ずつ動き続ける。4つなら +100・5つなら +150
  { id: 'cliche', kind: 'cliche', tier: 88, steps: [ANY_PIECE, ANY_PIECE, ANY_PIECE], check: (evs) => isLineCliche(evs), points: 150,
    extend: [{ steps: [ANY_PIECE, ANY_PIECE], check: (evs) => isLineCliche(evs), points: 150, variant: '5つの和音' }, { steps: [ANY_PIECE], check: (evs) => isLineCliche(evs), points: 100, variant: '4つの和音' }],
    advancedHint: true, hintAdvanced: true, noStartHint: true },
  // パッシング・ディミニッシュ（2026-11-25 作りなおし）: dim7 が、前か後のコードの、半音上か半音下にあるとき。進行は、dim を飛ばして評価する（analyze の、ふつうの取り合いには入らない。chainOf と、下の ornament の処理が決める）。
  //   ここは、点数・ヒントの定義（ヒントは、「発展」に出す）
  { id: 'passing_dim', kind: 'passing_dim', tier: 86, ornament: true, steps: [ANY_PIECE, (c) => isDimChord(c)], check: () => false, points: 120,
    advancedHint: true, hintAdvanced: true, noStartHint: true },
  // ---- tier 85: ツーファイブワン（強進行が2回つながる。短調の ⅶm7-5→Ⅲ7→Ⅵm7 なども含む）----
  { id: 'two_five_one', kind: 'dominant_motion', variant: 'ツーファイブワン', tier: 85,
    steps: [(c) => !c.isRepeat && ['min', 'min7', 'min7b5'].includes(c.type), (c) => !c.isRepeat && (c.type === 'dom7' || (c.type === 'maj' && c.rootPc === 7)),
            (c) => !c.isRepeat && ['maj', 'maj7', 'min', 'min7'].includes(c.type)],
    // evs が 2つなら、前の2つだけ見る（ヒントが「途中」を調べるときにも使う）
    check: (evs) => rootMotion(evs[0].chord, evs[1].chord) === 5 && (evs.length < 3 || rootMotion(evs[1].chord, evs[2].chord) === 5), points: 400,
    prefer: [['Ⅱm7', 'Ⅱm'], ['Ⅴ7'], ['ⅠM7', 'Ⅰ']] },
  // ---- tier 80: 終止（2つのコード。フレーズの終わりでだけ成立する）----
  { id: 'authentic_cadence', kind: 'authentic_cadence', tier: 80, end: 'phrase', steps: [V_ANY, I], points: 200 },
  // プラガル終止（変格終止・アーメン終止）: Ⅳ（ⅣM7）→ Ⅰ（ⅠM7）。Ⅴ-Ⅰ終止より、やわらかい。2026-11-24 に追加（出典: docs/theory_audit.md の「2026-11-24 の追加」）
  { id: 'plagal', kind: 'plagal_cadence', tier: 80, end: 'phrase', steps: [IV, I], points: 160, prefer: [['Ⅳ', 'ⅣM7'], ['Ⅰ', 'ⅠM7']] },
  // ピカルディ終止: 短調の主和音 Ⅵm で終わるところを、長三和音の Ⅵ で終える。直前は、イ短調で終止に向かう和音（Ⅲ7 = Ⅴ7 / Ⅴ・Ⅴ7 = ♭Ⅶ / Ⅱm = Ⅳm / Ⅵm = 主和音 / Ⅵsus4 = サス）
  { id: 'picardy', kind: 'picardy', tier: 80, end: 'phrase', steps: [PICARDY_FROM, VI_MAJOR], points: 200, hintAdvanced: true,
    bonus: (evs) => (isSus(evs[0].chord) ? { points: 50, variant: 'サスつき' } : null),
    soft: () => true },     // soft = ヒントでは、フレーズの終わり（4番・8番）でだけ出す（2026-11-24 から、Ⅲ7・Ⅵm 系からの形も。3番に Ⅵ（長三和音）を勧めるのは不自然、というご指摘。Ⅵsus4 → Ⅵ は、サスの解決の流れで、いつでも出る）
  // 偽終止: Ⅵm（Ⅵm7）で終わる。前のコードは何でもよい（ただし、同じルートへの繰り返しは除く）。本来の形（Ⅴ → Ⅵm）は、上乗せの点。Ⅴ のあとなら、借用のⅥ♭M7 でもよい
  { id: 'deceptive_cadence', kind: 'deceptive_cadence', tier: 80, end: 'phrase', steps: [(c) => !c.isRepeat, VI_MINOR], check: (evs) => evs[0].chord.rootPc !== evs[1].chord.rootPc, points: 150,
    bonus: (evs) => (V_ANY(evs[0].chord) ? { points: 50 } : null),
    soft: (evs) => !V_ANY(evs[0].chord) },        // soft = どのコードのあとでも成立する形（ヒントでは、おすすめにしない。小節の終わりでだけ出す）
  { id: 'deceptive_cadence_flat6', kind: 'deceptive_cadence', tier: 80, end: 'phrase', steps: [V_ANY, VI_FLAT_MAJ7], points: 200, hintAdvanced: true },       // hintAdvanced = ヒントでは、おすすめではなく発展（借用和音の偽終止。第10弾）
  { id: 'dominant_ending', kind: 'dominant_ending', tier: 80, end: 'phrase', steps: [DOMINANT_ENDING_FROM, V_ANY], points: 100 },
  // ---- tier 82〜75: 借用和音（サブドミナントマイナーと、その代理）。Ⅳ→Ⅳm→Ⅰ（Ⅴ）は、終止（80）より先に取る（技として、いちばん高く評価する）。ほかは、名前のついた進行・終止が取らなかったつながりで、自然に着地したとき ----
  { id: 'sdm_classic', kind: 'sdm', tier: 82, variant: 'Ⅳ→Ⅳm→Ⅰ', advancedHint: true, steps: [isIvPlain, isMinorIv, (c) => isTonicFamily(c) || isDominantV(c)], points: 220 },
  { id: 'neapolitan', kind: 'sdm_sub', tier: 83, variant: 'ネアポリタン進行', advancedHint: true, steps: [on([1], ['maj7']), isDominantV, isTonicFamily], points: 300 },
  { id: 'sdm', kind: 'sdm', tier: 75, steps: [isMinorIv, (c) => !c.isRepeat], check: (evs) => naturalAfterBorrowed(evs[0].chord, evs[1].chord), points: 90 },
  { id: 'sdm_sub', kind: 'sdm_sub', tier: 75, steps: [isSubstitute, (c) => !c.isRepeat], check: (evs) => naturalAfterBorrowed(evs[0].chord, evs[1].chord), points: 70,
    bonus: (evs) => ({ points: 0, variant: SUB_VARIANTS[borrowKey(evs[0].chord)] || null }) },
  // ---- tier 70: 裏コード（♭Ⅱ7 → Ⅰ）----
  { id: 'ura', kind: 'half_step_down', variant: '裏コード', tier: 70, steps: [on([1], DOM), I], points: 250 },
  // ---- tier 60: ふつうのつながり（ルートの動きだけで決まる。どこでも成立する）----
  { id: 'strong', kind: 'dominant_motion', tier: 60, steps: [(c) => !c.isRepeat, (c) => !c.isRepeat],
    check: (evs) => rootMotion(evs[0].chord, evs[1].chord) === 5, points: 100,
    bonus: (evs) => (isSecondaryDominant(evs[0].chord, evs[1].chord) ? { points: 50, variant: 'セカンダリードミナント' } : { points: 0, variant: '強進行' }) },
  { id: 'weak', kind: 'weak_motion', tier: 60, steps: [(c) => !c.isRepeat, (c) => !c.isRepeat], check: (evs) => rootMotion(evs[0].chord, evs[1].chord) === 7, points: 60 },
  { id: 'half_down', kind: 'half_step_down', tier: 60, steps: [(c) => !c.isRepeat, (c) => !c.isRepeat], check: (evs) => rootMotion(evs[0].chord, evs[1].chord) === 11, points: 80 },
];

// ------------------------------------------------------------
// 盤 → 時間の順に並んだコード（イベント）
//   board: 長さ numSteps の配列。null（空き）か、コードID（「→」= 99 を含む）
//   split: 分割したマス（1つのマスに、前半・後半の2つのコード）の、後半のコードの ID（分割していなければ null）の配列。省いてもよい（2026-11-23）
//   ・空きは休み。つながりが切れる（前後は、つながらない）
//   ・「→」は、前のコードを、もう1ステップのばす（前が空きなら休み）
//   戻り値: segments = 休みで区切った、コードの並び。各イベントは { chord, first, last, positions, blocked, half }
//   ・blocked: 冒頭（1番）のドミナント系の駒（例外を除く）。技には使わない（？）
//   ・half: 分割したマスの、前半 = 0・後半 = 1（分割していなければ null）。前半と後半は、同じマスの番号（first・last）を持つ。技の位置の決まり（固有進行は、1番・5番の頭から / 終止は、フレーズの終わりの、いちばん最後のコード）は、この half を見る
// ------------------------------------------------------------
export function buildSegments(board, table, split = null) {
  const segments = [];
  let cur = null;
  for (let pos = 0; pos < board.length; pos++) {
    const id = board[pos];
    if (id === null || id === undefined) { cur = null; continue; }
    if (id === table.repeatId || id === REPEAT_ID) {
      if (cur && cur.length) { const ev = cur[cur.length - 1]; ev.last = pos; ev.positions.push(pos); }
      else cur = null;
      continue;
    }
    const chord = table.byId(id);
    if (!chord) { cur = null; continue; }               // 知らないコード（未登録）は休み
    if (!cur) { cur = []; segments.push(cur); }
    const second0 = split && split[pos] !== null && split[pos] !== undefined ? table.byId(split[pos]) : null;
    const second = second0 && !second0.isRepeat && second0 !== chord ? second0 : null;                       // 前半と同じ和音の後半は、分割とみなさない（1つのマスと同じ）
    const prev = cur.length ? cur[cur.length - 1] : null;
    if (prev && prev.chord === chord) {                 // 同じ和音が続く = 「→」と同じ（2026-11-24。ご指定: 点数が「→」と同じになるように。駒を並べるだけで、駒の数がふえるわけではない）
      prev.last = pos; prev.positions.push(pos);
    } else {
      const ev = { chord, first: pos, last: pos, positions: [pos], blocked: false, half: second ? 0 : null };
      ev.blocked = isHeadV(ev);
      cur.push(ev);
    }
    if (second) cur.push({ chord: second, first: pos, last: pos, positions: [pos], blocked: false, half: 1 });       // 分割したマスの、後半のコード（前半と同じマスの番号）
  }
  const head = segments.find((s) => s[0].first === 0);
  if (head && head[0].blocked && headExempt(head)) head[0].blocked = false;      // ラグタイム進行・ブルースなどは、冒頭のドミナントを認める
  return segments;
}

// 技の目印（画面が、「新しく決まった技」と「前からある技」を見分けるのに使う）
export function instanceKey(ins) { return `${ins.id}|${ins.startPos}|${ins.endPos}|${ins.variant || ''}`; }

// ------------------------------------------------------------
// ループのつなぎ目（8番 → 1番）。盤は輪になって演奏されるので、最後の駒と最初の駒も、つながっている（2026-11-18）。
//   つなぎ目をまたげるのは、進行系（つながり: ドミナントモーション・弱進行・半音下。ツーファイブワン・裏コードを含む）の技だけ。終止・固有進行は、またがない。
//   つなぎ目をまたぐ技は、駒を2〜3つ囲む（8番 → 1番。3つのときは 7番 → 8番 → 1番、または 8番 → 1番 → 2番）。コンボは、とらない（単独の技）。
//   ツーファイブワンは、駒どうしの1本のつながり（ふつうの強進行）がすでに取っていても、つなぎ目をまたぐ形に置きかえる（点が上がる）
// ------------------------------------------------------------
const SEAM_KINDS = ['dominant_motion', 'weak_motion', 'half_step_down'];
function seamPass(n, segments, claimed, claimedKinds, instances) {
  const si1 = segments.findIndex((sg) => sg[0].first === 0);
  const siN = segments.findIndex((sg) => sg[sg.length - 1].last === n - 1);
  if (si1 < 0 || siN < 0) return;
  const first = segments[si1], last = segments[siN];
  const B = first[0], A = last[last.length - 1];
  if (A === B || A.blocked || B.blocked) return;
  const A0 = last.length >= 2 ? last[last.length - 2] : null;
  const B1 = first.length >= 2 ? first[1] : null;
  const cands = [];
  if (A0 && A0 !== B) cands.push({ evs: [A0, A, B], inner: [[siN, last.length - 2]] });
  if (B1 && B1 !== A) cands.push({ evs: [A, B, B1], inner: [[si1, 0]] });
  cands.push({ evs: [A, B], inner: [] });
  const pats = PATTERNS.filter((pt) => !pt.custom && SEAM_KINDS.includes(pt.kind) && !pt.startAt && !pt.end).sort((a, b) => b.tier - a.tier);
  for (const pat of pats) {
    for (const c of cands) {
      if (c.evs.length !== pat.steps.length) continue;
      if (!pat.steps.every((m, k) => m(c.evs[k].chord)) || (pat.check && !pat.check(c.evs, { phrase: PHRASE }))) continue;
      if (c.inner.some(([si, idx]) => claimedKinds.get(`${si}:${idx}`) === 'named')) continue;          // 名前のついた技が取っている つながりは、使わない
      // 取りこまれる、ふつうの強進行・弱進行・半音下（1本のつながり）は、置きかえる
      for (const [si, idx] of c.inner) {
        const k = instances.findIndex((i) => i.segment === si && i.from === idx && i.to === idx + 1 && i.generic);
        if (k >= 0) instances.splice(k, 1);
        claimed.add(`${si}:${idx}`);
        claimedKinds.set(`${si}:${idx}`, pat.tier === 60 ? 'generic' : 'named');
      }
      const kind = TRICKS[pat.kind];
      let variant = pat.variant || null, extra = 0;
      if (pat.bonus) { const b = pat.bonus(c.evs); if (b) { extra += b.points; if (b.variant) variant = b.variant; } }
      if (!variant && pat.kind === 'dominant_motion') variant = isSecondaryDominant(c.evs[0].chord, c.evs[1].chord) ? 'セカンダリードミナント' : '強進行';
      const lastEv = c.evs[c.evs.length - 1];
      instances.push({
        id: `${pat.id}@loop`, kind: pat.kind, group: kind.group, variant, name: kind.name, sub: kind.sub || null, color: kind.color,
        segment: -1, from: -1, to: -1, seam: true,
        startPos: c.evs[0].first, endPos: lastEv.last, endFirst: lastEv.first,
        positions: c.evs.flatMap((e) => e.positions), chords: c.evs.map((e) => e.chord.name), symbols: c.evs.map((e) => e.chord.symbol),
        points: pat.points + extra, generic: pat.tier === 60, soft: false,
        reason: `${(variant && kind.variants[variant]) || kind.explain} ループして、${A.last + 1}番から 1番へつながるところで決まりました。`,
      });
      return;
    }
  }
}

// ------------------------------------------------------------
// 判定
// ------------------------------------------------------------
export function analyze(board, table, opts = {}) {
  const ctx = { phrase: opts.slotsPerPhrase || PHRASE };
  const rawSegments = buildSegments(board, table, opts.split);
  const chained = rawSegments.map((sg) => chainOf(sg));            // 経過の dim（パッシング・ディミニッシュ）を飛ばした並び。技・ジャッジは、これで探す（2026-11-25）
  const segments = chained.map((c) => c.chain);
  const claimed = new Set();                        // 取られたつながり "セグメント番号:イベント番号"（その番号のイベントから、次のイベントへ）
  const claimedKinds = new Map();                   // 取られたつながり → 'generic'（ふつうの強進行・弱進行・半音下）か 'named'（名前のついた技）。ジャッジの「解決」が使う
  const instances = [];

  // 冒頭（1番）のドミナント系の駒（？）: 技に使わない。100点の減点
  const oddities = [];
  segments.forEach((seg) => seg.forEach((ev) => {
    if (!ev.blocked) return;
    oddities.push({
      id: HEAD_V.id, kind: HEAD_V.id, variant: null, name: HEAD_V.name, sub: null, title: HEAD_V.title, color: HEAD_V.color, warn: true,
      startPos: ev.first, endPos: ev.last, endFirst: ev.first, positions: ev.positions.slice(),
      chords: [ev.chord.name], symbols: [ev.chord.symbol], penalty: SCORE.headVPenalty, points: -SCORE.headVPenalty, total: -SCORE.headVPenalty,
      chain: -1, comboMult: 1, reason: `冒頭（${ev.first + 1}番）に ${ev.chord.name}。${HEAD_V.reason}`,
    });
  }));

  const tiers = [...new Set(PATTERNS.map((p) => p.tier))].sort((a, b) => b - a);
  for (const tier of tiers) {
    // その優先度の、すべての候補を集める → 左から・長いものから取る
    const cands = [];
    segments.forEach((seg, si) => {
      for (const pat of PATTERNS.filter((p) => p.tier === tier && !p.ornament)) {
        const len = pat.steps.length;
        for (let i = 0; i + len <= seg.length; i++) {
          const evs = seg.slice(i, i + len);
          if (evs.some((e) => e.blocked)) continue;                         // 冒頭のドミナント系の駒（？）は、技に使わない
          if (pat.startAt && (!pat.startAt.includes(evs[0].first) || evs[0].half === 1)) continue;   // 固有進行: 1番か5番の頭から始まっていること（分割したマスの後半からは、始まらない）
          if (!pat.steps.every((m, k) => m(evs[k].chord))) continue;
          if (pat.check && !pat.check(evs, ctx)) continue;
          let total = len;
          let extraPoints = 0;
          let variant = pat.variant || null;
          for (const ex of pat.extend || []) {                               // 長い形（長いものから試す）
            const n = ex.steps.length;
            if (i + len + n > seg.length) continue;
            const more = seg.slice(i + len, i + len + n);
            if (more.some((e) => e.blocked) || !ex.steps.every((m, k) => m(more[k].chord))) continue;
            if (ex.check && !ex.check(seg.slice(i, i + len + n), ctx)) continue;          // 長い形だけの条件（クリシェが、4つ・5つと続いているか）
            total = len + n; extraPoints = ex.points; variant = ex.variant || variant;
            break;
          }
          if (pat.end === 'phrase' && !endsPhrase(seg, i + total - 1, ctx.phrase)) continue;   // 終止: フレーズの終わりでだけ（あとに、同じルートの和音がつづいて、終わりに着くときも。sense.js の endsPhrase）
          if (pat.bonus) { const b = pat.bonus(seg.slice(i, i + len)); if (b) { extraPoints += b.points; if (b.variant) variant = b.variant; } }
          cands.push({ pat, si, i, total, variant, extraPoints });
        }
      }
    });
    cands.sort((a, b) => a.si - b.si || a.i - b.i || b.total - a.total);
    for (const c of cands) {
      const edges = [];
      for (let k = 0; k < c.total - 1; k++) edges.push(`${c.si}:${c.i + k}`);
      if (edges.some((e) => claimed.has(e))) continue;
      edges.forEach((e) => { claimed.add(e); claimedKinds.set(e, c.pat.tier === 60 ? 'generic' : 'named'); });
      const seg = segments[c.si];
      const evs = seg.slice(c.i, c.i + c.total);
      const kind = TRICKS[c.pat.kind];
      let variant = c.variant;
      // 強進行の名前は、名前の付いた形ではない（ふつうの）つながりのときだけ、ここで決める
      if (!variant && c.pat.kind === 'dominant_motion') variant = isSecondaryDominant(evs[0].chord, evs[1].chord) ? 'セカンダリードミナント' : '強進行';
      instances.push({
        id: c.pat.id, kind: c.pat.kind, group: kind.group, variant, name: kind.name, sub: kind.sub || null, color: kind.color,
        segment: c.si, from: c.i, to: c.i + c.total - 1,                       // セグメントの中の、イベント番号（先頭と最後）
        startPos: evs[0].first, endPos: evs[evs.length - 1].last, endFirst: evs[evs.length - 1].first,
        positions: evs.flatMap((e) => e.positions), chords: evs.map((e) => e.chord.name), symbols: evs.map((e) => e.chord.symbol),
        points: c.pat.points + c.extraPoints, generic: c.pat.tier === 60, soft: !!(c.pat.soft && c.pat.soft(evs)),
        reason: (variant && kind.variants[variant]) || kind.explain,
      });
    }
  }
  if (board.length === 8) seamPass(board.length, segments, claimed, claimedKinds, instances);          // 8番 → 1番（ループのつなぎ目）の進行系の技
  // パッシング・ディミニッシュ: 飛ばした dim ごとに、1つの技（dim とそのとなりのコード。進行のつながり（claimed）は、取らない）
  chained.forEach((c, si) => {
    for (const o of c.ornaments) {
      const evs = [o.prev, o.ev, o.next].filter(Boolean);
      const variant = passingDimVariant(o.prev, o.ev, o.next);
      const kind = TRICKS.passing_dim, pat = PATTERNS.find((pp) => pp.id === 'passing_dim');
      const anchors = [o.prev ? c.map[o.prevIdx] : -1, o.next ? c.map[o.nextIdx] : -1].filter((k) => k >= 0);
      instances.push({
        id: 'passing_dim', kind: 'passing_dim', group: kind.group, variant, name: kind.name, sub: kind.sub || null, color: kind.color,
        segment: si, from: Math.min(...anchors), to: Math.max(...anchors),                 // となりのコード（chain の番号）。コンボは、この番号で、前後の技とつながる
        startPos: Math.min(...evs.map((e) => e.first)), endPos: Math.max(...evs.map((e) => e.last)), endFirst: evs[evs.length - 1].first,
        positions: evs.flatMap((e) => e.positions), chords: evs.map((e) => e.chord.name), symbols: evs.map((e) => e.chord.symbol),
        points: pat.points, generic: false, soft: false, reason: kind.variants[variant] || kind.explain,
      });
    }
  });
  instances.sort((a, b) => a.startPos - b.startPos || b.endPos - a.endPos);
  oddities.sort((a, b) => a.startPos - b.startPos);

  // ---- 点数 ----
  const seen = {};
  instances.forEach((ins) => {
    const n = (seen[ins.kind] = (seen[ins.kind] || 0) + 1);
    ins.repeatMult = SCORE.repeatMult[Math.min(n, SCORE.repeatMult.length) - 1];
  });
  // コンボ: 同じセグメントで、駒を共有してつながった技のかたまり
  const chains = [];
  for (const ins of instances) {
    const last = chains[chains.length - 1];
    if (last) {
      const prev = last[last.length - 1];
      if (prev.segment === ins.segment && ins.from <= prev.to) { last.push(ins); continue; }
    }
    chains.push([ins]);
  }
  let base = 0;
  const lines = [];
  chains.forEach((chain, ci) => {
    const mult = SCORE.comboMult[Math.min(chain.length, SCORE.comboMult.length - 1)];
    chain.forEach((ins) => {
      ins.chain = ci; ins.comboMult = mult;
      ins.total = Math.round(ins.points * ins.repeatMult * mult);
      base += ins.total;
      lines.push(ins);
    });
  });
  const kinds = new Set(instances.map((i) => i.kind));
  const variety = 1 + SCORE.varietyStep * Math.max(0, kinds.size - 1);
  const penalty = oddities.reduce((s, o) => s + o.penalty, 0);
  // ジャッジ（講評）: 名前のついた技にならなかったつながりを見て、耳に馴染む並びには加点、進行感のない並びには減点・指摘（sense.js）
  const critiques = judge(segments, claimed, { phrase: ctx.phrase, kinds: claimedKinds }).concat(board.length === 8 ? loopNote(board.length, segments, instances) : []);
  // 技・耳に馴染むつながり（加点の講評）に使われている位置。使われていない駒は、「コードの難しさ」の加点がつかず、盤に3つ以上の駒があるときは、0点の指摘（役に立っていない駒。減点はない）
  const inTrick = new Set(), inUse = new Set();
  for (const ins of instances) for (const p of ins.positions) { inTrick.add(p); inUse.add(p); }
  for (const c of critiques) if (c.points > 0) for (const p of c.positions) inUse.add(p);
  const isUsed = (ev) => ev.positions.some((p) => inUse.has(p));
  // コードの難しさのボーナス: 盤の上の、技に使われている「ちがう駒」ごとに、1回だけ（「→」と、「？」の駒は除く）。技に使われていない駒は、数えない
  const levelPieces = [];
  const usedIds = new Set();
  rawSegments.forEach((seg) => seg.forEach((ev) => {
    if (ev.blocked || ev.chord.isRepeat || !ev.positions.some((p) => inTrick.has(p)) || usedIds.has(ev.chord.id)) return;
    usedIds.add(ev.chord.id);
    const bonus = SCORE.levelBonus[ev.chord.level] || 0;
    if (bonus > 0) levelPieces.push({ pos: ev.first, name: ev.chord.name, symbol: ev.chord.symbol, level: ev.chord.level, bonus });
  }));
  levelPieces.sort((a, b) => a.pos - b.pos);
  const levelBonus = levelPieces.reduce((s, p) => s + p.bonus, 0);
  const pieces = segments.flatMap((seg) => seg.filter((ev) => !ev.blocked && !ev.chord.isRepeat));
  if (pieces.length >= 3) {
    const idle = pieces.filter((ev) => !isUsed(ev));
    if (idle.length) critiques.push(idleCritique(idle));
  }
  const sense = senseTotals(critiques);
  const raw = Math.round(base * variety) + levelBonus + sense.good - sense.bad - penalty;                     // 0点で切る前の合計（メロディのステージが、メロディの点を足してから、0点で切る）
  const total = Math.max(0, raw);                                                                               // 減点しても、0点より下にはならない

  // ---- 技にならなかったつながり（オリジナルの動き）を、性質で描写する ----
  const unclaimed = [];
  segments.forEach((seg, si) => {
    for (let i = 0; i + 1 < seg.length; i++) {
      if (claimed.has(`${si}:${i}`)) continue;
      unclaimed.push(describeEdge(seg[i], seg[i + 1]));
    }
  });

  return { segments, instances, oddities, levelPieces, critiques, chains, score: { base, variety, penalty, levelBonus, senseGood: sense.good, senseBad: sense.bad, raw, total, kinds: kinds.size, combo: Math.max(0, ...chains.map((c) => c.length)) }, unclaimed };
}

// 8番の駒がドミナント系（Ⅴ7 など）なのに、ループのつなぎ目（8番 → 1番）が技にならないとき、その理由を、0点の指摘で知らせる（2026-11-23。「Ⅴ7 が 8番にあるのに、ドミナントモーションが加点されない」という指摘から。技の取りこぼしではなく、解決先がない・つながらない場合の説明）
function loopNote(n, segments, instances) {
  if (instances.some((i) => i.seam)) return [];
  const siN = segments.findIndex((sg) => sg[sg.length - 1].last === n - 1);
  if (siN < 0) return [];
  const A = segments[siN][segments[siN].length - 1];
  if (A.blocked || !isDominantType(A.chord)) return [];
  const first = segments.find((sg) => sg[0].first === 0);
  const B = first ? first[0] : null;
  if (B === A) return [];
  const want = degreeLabel((A.chord.rootPc + 5) % 12);                          // ドミナントが、強く引っぱられていく先（4度上）
  const head = `${A.last + 1}番の ${A.chord.name}（ドミナント）は、ループして 1番へ向かいます。`;
  let text;
  if (!B) text = `${head}でも、1番が空き（休み）なので、つながりません。1番に ${want} の和音を置くと、ドミナントモーション（強進行）が決まります。`;
  else if (B.blocked) text = `${head}でも、1番の ${B.chord.name} は「？」（冒頭のドミナント）なので、つなげません。1番を ${want} の和音にすると、ドミナントモーション（強進行）が決まります。`;
  else text = `${head}1番は ${B.chord.name}。ルートの動きは「${MOTION_NAMES[rootMotion(A.chord, B.chord)]}」で、ドミナントモーション（ルートが4度上がる動き）にはなりません。1番を ${want} の和音にすると決まります。`;
  return [{ id: `loopnote|${A.last}`, kind: 'note', name: 'ループのつなぎ目', points: 0, positions: B ? [A.last, B.first] : [A.last], chords: B ? [A.chord.name, B.chord.name] : [A.chord.name], reason: text,
    color: '#aaa393', sub: null, variant: null, title: 'ループのつなぎ目', startPos: B ? Math.min(A.last, B.first) : A.last, endPos: B ? Math.max(A.last, B.first) : A.last, endFirst: A.last }];
}

const MOTION_NAMES = ['同じルート', '半音上', '全音上', '短3度上', '長3度上', '完全4度上', '増4度', '完全5度上', '短6度上', '長6度上', '全音下', '半音下'];
function describeEdge(a, b) {
  const m = rootMotion(a.chord, b.chord);
  const common = b.chord.pcs.filter((p) => a.chord.pcs.includes(p)).length;
  const tags = [MOTION_NAMES[m]];
  if (common >= 3) tags.push('共通音が多く、なめらか');
  else if (common === 0) tags.push('共通音がなく、意外');
  if (b.chord.minorFlavor || b.chord.colour >= 2) tags.push('色の濃い（借用）和音');
  return { from: a.chord.name, to: b.chord.name, startPos: a.first, endPos: b.last, motion: m, common, tags };
}

// ------------------------------------------------------------
// 盤の中の、技のある位置の一覧（画面で囲むのに使う）
// ------------------------------------------------------------
export function describeScore(result) {
  const t = result.instances.map((i) => `${i.name}${i.variant ? `（${i.variant}）` : ''} ${i.chords.join('→')} +${i.total}`);
  const o = (result.oddities || []).map((x) => `？ ${x.chords[0]}（${x.startPos + 1}番） ${x.total}`);
  const lv = result.score && result.score.levelBonus ? [`高度なコード +${result.score.levelBonus}`] : [];
  return [...t, ...lv, ...o].join(' / ');
}

// ------------------------------------------------------------
// ユーザーが作った固有進行（リズム・コード編集の画面で、名前をつけて、ゲームに送ったもの）
//   list: [{ id, name, chords: ['ⅣM7', ...], points, startAt: 'head' | 'any' }]
//   ・並びの駒は、名前（ⅣM7 など）が、そのまま合う駒だけ。「→」は、つなぎ目として無視する（ほかの固有進行と同じ）
//   ・startAt: 'head' = 1番か5番から始まるときだけ成立（標準。固有進行のルール）/ 'any' = どこからでも
//   ・同じ並びの、もとからある進行より、ユーザーの進行が先に取る（tier 101）
//   呼ぶたびに、前回のユーザーの進行は、すべて入れ替わる。戻り値: ユーザーの進行の kind の一覧
// ------------------------------------------------------------
const CUSTOM_COLORS = ['#cfb362', '#76c9a1', '#e2956d', '#8ea9dc', '#c595dc', '#e2889b', '#a1c36d', '#73c1c9'];
export function setCustomProgressions(list) {
  for (let i = PATTERNS.length - 1; i >= 0; i--) if (PATTERNS[i].custom) PATTERNS.splice(i, 1);
  for (const k of Object.keys(TRICKS)) if (TRICKS[k].custom) delete TRICKS[k];
  (list || []).forEach((p, n) => {
    if (!p || !Array.isArray(p.chords) || p.chords.length < 2) return;
    const kind = `custom_${p.id}`;
    const head = p.startAt !== 'any';
    TRICKS[kind] = {
      no: 101 + n, group: 'named', name: p.name, color: CUSTOM_COLORS[n % CUSTOM_COLORS.length], custom: true,
      explain: `あなたが作った進行「${p.name}」（${p.chords.join('→')}）。${head ? '1番か5番から並べると決まります。' : 'どこからでも決まります。'}`,
      variants: {},
    };
    PATTERNS.push({ id: kind, kind, tier: 101, custom: true, startAt: head ? HEAD : undefined, steps: p.chords.map((nm) => (c) => !c.isRepeat && c.name === nm),
      points: Number.isFinite(p.points) ? p.points : 150 * p.chords.length, prefer: p.chords.map((nm) => [nm]) });
  });
  return Object.keys(TRICKS).filter((k) => TRICKS[k].custom);
}
