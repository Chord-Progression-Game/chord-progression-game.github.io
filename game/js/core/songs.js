// 「この進行が使われている曲」の一覧（固有進行の詳細に出す）。DOM には触れない。
//
//   ・曲名・アーティスト名だけ（歌詞・メロディは使わない）。ウェブの解説・Wikipedia に、その進行の例として載っていたものだけを入れた（2026-11-23 に調べた）。
//     出どころは、曲ごとの src（SOURCES）。出典の URL・調べた日・食い違いは docs/songs_sources.md に書いてある。
//   ・曲の「一部分」（サビ・Aメロなど）で使われていることが多い。調も、コードの細かい形（Ⅴ7 や ⅣM7 など）も、曲ごとに違う。part に、分かっている部分を書いた。
//   ・私は耳で確かめていない（資料に書いてあったことを、そのまま入れた）。資料どうしで食い違うものは、入れていない（例: Pretender は、王道進行ではなく、カノン進行の変形と紹介されていたので、カノン進行のほうに入れた）。
//   ・日本の曲を優先したが、資料で確かめられなかった進行は、洋楽・クラシックの例だけ。そのときは、noJapanese: true（画面に「日本の曲の例は、確認できていません」と出す）。
//   ・キーは、技の kind（tricks.js の TRICKS のキー）。カノン進行は、弱進行の変形なので 'weak_motion|カノン進行'

export const SOURCES = {
  rag: 'RAG MUSIC（定番のコード進行まとめ）',
  utaten: 'UtaTen（コード進行の解説）',
  nippon: 'nippon.com（Just The Two of Us 進行の解説）',
  wiki: 'Wikipedia',
  biechi: 'The Komuro Progression（解説記事）',
  jazz: 'antonjazz.com（Backdoor ii-V の解説）',
};

// t: 曲名 / a: アーティスト / part: 使われている部分（分かるものだけ）/ note: ひとこと / src: 資料 / en: 洋楽・クラシック（日本の曲でない）
export const SONGS = {
  oudou: [
    { t: '夜に駆ける', a: 'YOASOBI', src: 'rag' },
    { t: 'ロビンソン', a: 'スピッツ', src: 'rag' },
    { t: '瞳をとじて', a: '平井堅', src: 'rag' },
    { t: '愛のままにわがままに 僕は君だけを傷つけない', a: 'B\'z', src: 'rag' },
    { t: '怪物', a: 'YOASOBI', src: 'rag' },
    { t: 'I LOVE...', a: 'Official髭男dism', part: 'サビの頭', note: 'Ⅲm7 と Ⅵm7 のあいだに Ⅴ♯dim7 を足した形', src: 'utaten' },
    { t: '桜華爛漫', a: 'KEYTALK', part: 'サビ', src: 'utaten' },
    { t: '君はロックを聴かない', a: 'あいみょん', src: 'utaten' },
  ],
  komuro: [
    { t: 'Get Wild', a: 'TM NETWORK', src: 'rag' },
    { t: 'Body Feels EXIT', a: '安室奈美恵', src: 'wiki' },
    { t: 'LOVE LOVE LOVE', a: 'DREAMS COME TRUE', part: 'サビ', src: 'biechi' },
    { t: '愛唄', a: 'GReeeeN', src: 'utaten' },
    { t: 'survival dAnce', a: 'TRF', src: 'utaten' },
    { t: 'だから僕は音楽を辞めた', a: 'ヨルシカ', part: 'サビ', src: 'biechi' },
  ],
  maru_sa: [
    { t: '丸の内サディスティック', a: '椎名林檎', note: '転調の部分を省くと、A♭M7 → G7 → Cm7 → E♭7（Key=C なら ⅣM7 → Ⅲ7 → Ⅵm7 → Ⅰ7 にあたる並び）', src: 'nippon' },
    { t: 'Just The Two of Us', a: 'Grover Washington Jr.', note: '元になった曲（ボーカルは Bill Withers）', src: 'nippon', en: true },
    { t: 'つつみ込むように…', a: 'MISIA', src: 'nippon' },
    { t: '接吻', a: 'ORIGINAL LOVE', src: 'nippon' },
    { t: 'A Perfect Sky', a: 'BONNIE PINK', src: 'nippon' },
    { t: '夜に駆ける', a: 'YOASOBI', note: '要所で使われているとの紹介', src: 'nippon' },
    { t: 'I LOVE...', a: 'Official髭男dism', part: 'Aメロ・Bメロ（サビは別の進行）', src: 'nippon' },
  ],
  fifties: [
    { t: 'あの娘にタッチ', a: 'THE BLUE HEARTS', note: '1991年', src: 'wiki' },
    { t: '宝物', a: 'THE BLUE HEARTS', note: '1993年', src: 'wiki' },
    { t: 'C.h.a.o.s.m.y.t.h.', a: 'ONE OK ROCK', note: '2011年', src: 'wiki' },
    { t: 'Stand by Me', a: 'Ben E. King', note: '1961年。この進行の別名「Stand By Me 進行」の由来', src: 'wiki', en: true },
    { t: 'Earth Angel', a: 'The Penguins', note: '1954年', src: 'wiki', en: true },
    { t: 'Heart and Soul', a: 'Larry Clinton', note: '1938年。この進行の別名「Heart and Soul 進行」の由来', src: 'wiki', en: true },
    { t: 'Every Breath You Take', a: 'The Police', note: '1983年', src: 'wiki', en: true },
  ],
  pop_punk: [
    { t: 'チェリー', a: 'スピッツ', note: 'RAG MUSIC では「レット・イット・ビー進行（1564進行）」。UtaTen はAメロをカノン進行の仲間と紹介', src: 'rag' },
    { t: 'もう少しだけ', a: 'YOASOBI', part: 'イントロ・Aメロ', note: '2021年', src: 'biechi' },
    { t: 'Let It Be', a: 'The Beatles', note: '1970年', src: 'biechi', en: true },
    { t: 'The Sign', a: 'Ace of Base', src: 'wiki', en: true },
  ],
  junkan: [
    { t: 'Last Christmas', a: 'Wham!', note: '「1625進行（循環進行）」の例', src: 'rag', en: true },
    { t: 'This Boy', a: 'The Beatles', note: '1963年', src: 'wiki', en: true },
    { t: 'All Right', a: 'Christopher Cross', note: '1983年', src: 'wiki', en: true },
    { t: 'Never Be the Same', a: 'Christopher Cross', note: '1980年', src: 'wiki', en: true },
  ],
  andalusian: [
    { t: 'Hit the Road Jack', a: 'Ray Charles', note: '主な構造が Ⅰ→♭Ⅶ→♭Ⅵ→Ⅴ（短調で Ⅵm→Ⅴ→Ⅳ→Ⅲ と同じ並びを下がる）', src: 'wiki', en: true },
    { t: 'Sultans of Swing', a: 'Dire Straits', src: 'wiki', en: true },
    { t: 'Smooth Criminal', a: 'Michael Jackson', part: 'サビ', src: 'wiki', en: true },
    { t: 'California Dreamin\'', a: 'The Mamas and the Papas', src: 'wiki', en: true },
    { t: 'Stray Cat Strut', a: 'The Stray Cats', src: 'wiki', en: true },
    { t: 'ピアノソナタ第14番「月光」第1楽章', a: 'ベートーヴェン', src: 'wiki', en: true },
  ],
  ragtime: [
    { t: 'Sweet Georgia Brown', a: 'Ben Bernie ほか', note: '1925年', src: 'wiki', en: true },
    { t: 'Five Foot Two, Eyes of Blue', a: 'Ray Henderson', note: '1925年', src: 'wiki', en: true },
    { t: 'Charleston', a: 'James P. Johnson', note: '1923年', src: 'wiki', en: true },
    { t: 'Ja-Da', a: 'Bob Carleton', note: '1918年', src: 'wiki', en: true },
    { t: 'Doxy', a: 'Sonny Rollins', note: '1954年', src: 'wiki', en: true },
    { t: 'Liebesträume（愛の夢）', a: 'リスト', note: '冒頭部分', src: 'wiki', en: true },
  ],
  backdoor: [
    { t: 'Lady Bird', a: 'Tadd Dameron', part: '3〜5小節目', src: 'jazz', en: true },
  ],
  full_cadence: [
    { t: '平均律クラヴィーア曲集 第2巻 ハ長調のプレリュード', a: 'J.S.バッハ', note: 'Ⅰ→Ⅳ→Ⅴ→Ⅰ の例として紹介', src: 'wiki', en: true },
    { t: 'ソナタ ニ短調 K.517', a: 'D.スカルラッティ', note: 'Ⅰ→Ⅳ→Ⅴ→Ⅰ の例として紹介', src: 'wiki', en: true },
  ],
  blues8: [
    { t: 'Key to the Highway', a: 'Big Bill Broonzy', note: 'Ⅰ7→Ⅴ7→Ⅳ7→Ⅳ7→Ⅰ7→Ⅴ7→Ⅰ7→Ⅴ7 の8小節ブルース（盤の並びと同じ）', src: 'wiki', en: true },
    { t: 'Slow Down', a: 'J. B. Lenoir', note: '同じ並びの8小節ブルース', src: 'wiki', en: true },
    { t: 'Worried Life Blues', a: 'Big Maceo', note: '1941年。「いちばん一般的な8小節ブルース」と紹介（Ⅴ が5小節目に来る別の形）', src: 'wiki', en: true },
  ],
  iv_v_vi: [
    { t: '打上花火', a: 'DAOKO × 米津玄師', note: 'Ⅳ→Ⅴ→Ⅵm→Ⅰ（4561進行）。Ⅳ→Ⅴ→Ⅵm の部分が、この進行', src: 'rag' },
  ],
  confirmation: [
    { t: 'Confirmation', a: 'チャーリー・パーカー', note: '1945年。ビバップの名曲。ドミナントが連なる「Bird changes」の代表', src: 'wiki', en: true },
  ],
  'weak_motion|カノン進行': [
    { t: '負けないで', a: 'ZARD', src: 'rag' },
    { t: 'マリーゴールド', a: 'あいみょん', part: 'Aメロ・サビ', src: 'utaten' },
    { t: '愛をこめて花束を', a: 'Superfly', part: 'Aメロ・サビ', src: 'utaten' },
    { t: '終わりなき旅', a: 'Mr.Children', part: 'Aメロ・サビ（アレンジあり）', src: 'utaten' },
    { t: 'Pretender', a: 'Official髭男dism', part: 'イントロ・Aメロ（少し変形）', src: 'utaten' },
    { t: 'ハレ晴レユカイ', a: '平野綾・茅原実里・後藤邑子', part: 'Aメロ・サビ', src: 'utaten' },
    { t: 'いつも何度でも', a: '木村弓', part: '後半', src: 'utaten' },
    { t: 'カノン', a: 'パッヘルベル', note: '1680年ごろ。この進行の名前のもと', src: 'rag', en: true },
    { t: 'Basket Case', a: 'Green Day', part: '歌い出し・Aメロ', src: 'utaten', en: true },
  ],
};
SONGS['weak_motion|カノン進行（完全な形）'] = SONGS['weak_motion|カノン進行'];
// Ⅳ-Ⅲ-Ⅵ進行は、ⅣM7→Ⅲ7→Ⅵm7 の形が『丸サ進行』。同じ曲が当てはまる（この形のとき、画面に、そう書く）
SONGS.iv_iii_vi = SONGS.maru_sa;

// 日本の曲の例が、資料で確かめられなかった進行（画面に、そう書く）
export const NO_JAPANESE = ['junkan', 'andalusian', 'ragtime', 'backdoor', 'full_cadence', 'blues8', 'confirmation'];

// 技（instance）に合う曲の一覧。{ list, viaMaruSa, noJapanese, sourceLabels } または null（曲の例がない技）
export function songsFor(ins) {
  if (!ins) return null;
  const key = ins.variant && SONGS[`${ins.kind}|${ins.variant}`] ? `${ins.kind}|${ins.variant}` : ins.kind;
  const list = SONGS[key];
  if (!list || !list.length) return null;
  const used = [...new Set(list.map((s) => s.src))];
  return {
    key,
    list: list.slice(),
    japanese: list.filter((s) => !s.en).length,
    viaMaruSa: ins.kind === 'iv_iii_vi',
    noJapanese: !list.some((s) => !s.en),
    sourceLabels: used.map((k) => SOURCES[k]),
  };
}
