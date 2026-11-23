// メロディのステージ（「メロディにコードをつける」）。流れているメロディに、コード進行をつける。
//   ・コード進行としての採点（技・ジャッジ。ふだんと同じ）+ メロディとの相性の採点（core/melody.js）の合計が、得点
//   ・メロディは、どれも、このゲームのために書いた、オリジナル（C メジャー。1周 = 8ステップ = 4小節。1ステップ = 2拍）
//   ・answer は、お手本の一例（正解ではない。ほかにも、合う並びはある）。テストと、星の基準（お手本の得点）に使う
//
//   id / no / title / sub / goalText / color : ステージの名前・見出し
//   pieces : 使える駒（駒の名前）。null なら、ぜんぶ
//   bpm / drumId / backingId : 標準のテンポ・ビート・バッキング（ユーザーが選んだものが、あれば、そちらが優先）
//   text   : メロディ（core/melody.js の parseMelody の書き方。音名:長さ（マス）。1ステップ = 8マス）
//   answer : お手本の一例（8つの駒）
//   intro / outro / tips : はじめの説明 / おわりの説明 / 画面に出す、ひとこと

import { parseMelody } from '../core/melody.js';
import { analyze } from '../core/tricks.js';
import { judgeMelody, MELODY_SCORE } from '../core/melody.js';

const BASIC = ['Ⅰ', 'Ⅱm', 'Ⅲm', 'Ⅳ', 'Ⅴ', 'Ⅵm', 'Ⅴ7', '→'];

const SOURCES = [
  {
    id: 'm01', no: 1, title: 'はじめてのメロディ', sub: 'コードの音に合わせよう', color: '#e2be54', bpm: 96, pieces: BASIC,
    text: 'E5:4 G5:4 | A5:4 C6:2 E6:2 | F5:4 A5:2 C6:2 | G5:4 F5:2 D5:2 | E5:6 D5:2 | F5:4 A5:2 C6:2 | B5:4 G5:2 F5:2 | C6:8',
    answer: ['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅴ', 'Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅰ'],
    intro: ['画面の上の帯が流れているメロディです。メロディに合うと思う和音を1〜8番に置いてみましょう。メロディは1番の和音から、8番の和音まで1周します。',
      'メロディの音がいま鳴っている和音の「構成音」（コードトーン）だと、安定して聞こえます（緑の帯）。',
      '気をつけたいのは「アヴォイドノート」。和音の構成音の半音上の音は、ぶつかって濁ります（赤の帯）。たとえば、Ⅰ（ド・ミ・ソ）の上で長く鳴る「ファ」。',
      '短くて弱い拍の音は通りすぎるだけの「経過音」なので、そんなに気にしなくて大丈夫です（灰色の帯）。'],
    tips: ['「ファ」の音が長く・強く鳴るところは、Ⅰ以外の和音がよく合います。'],
    outro: ['メロディの強い拍の音が和音の構成音になるように、和音を選ぶのがハーモナイズ（メロディに和音をつけること）の基本です。', 'メロディに合う和音は、1つとは限りません。いろいろ、試してみましょう。'],
  },
  {
    id: 'm02', no: 2, title: 'いろどりのテンション', sub: '9th・13th でおしゃれに', color: '#66a0dc', bpm: 88,
    pieces: ['Ⅰ', 'Ⅱm', 'Ⅲm', 'Ⅳ', 'Ⅴ', 'Ⅵm', 'ⅠM7', 'Ⅱm7', 'Ⅲm7', 'ⅣM7', 'Ⅴ7', 'Ⅵm7', 'Ⅰ7', '→'],
    text: 'D5:4 E5:2 G5:2 | B5:4 A5:2 G5:2 | A5:2 G5:2 F5:4 | F5:4 E5:4 | B5:4 C6:2 A5:2 | G5:4 F5:2 A5:2 | D6:2 B5:2 F5:4 | E6:6 D6:2',
    answer: ['ⅠM7', 'Ⅲm7', 'ⅣM7', 'Ⅴ7', 'Ⅵm7', 'Ⅱm7', 'Ⅴ7', 'ⅠM7'],
    intro: ['和音の構成音のほかにもメロディに使ってよい音があります。それが「テンション」（9th・11th・13th など）です。和音に色がつきます（水色の帯）。',
      '例: ⅠM7（ド・ミ・ソ・シ）の上の「レ」は 9th、「ラ」は 13th。コードの音ではないのにおしゃれに響きます。メロディが強い拍でテンションになっていて、濁りがないと、ボーナスです。',
      'テンションにも使えない音（アヴォイド）があります。ⅠM7 の上の「ファ」（11th）は、ミと半音でぶつかるので避けます。'],
    tips: ['7th の和音（M7・m7・7）を使うと、メロディの音がテンションとして、生きるところが増えます。'],
    outro: ['コードの音 → テンション → コードの音。安定と色づけを行き来すると、メロディがきれいに聞こえます。'],
  },
  {
    id: 'm03', no: 3, title: 'せつない Ⅵm', sub: 'sus4 とその解決', color: '#b48cff', bpm: 92,
    pieces: ['Ⅰ', 'Ⅱm', 'Ⅲm', 'Ⅳ', 'Ⅴ', 'Ⅵm', 'Ⅴ7', 'Ⅴsus47', 'ⅣM7', 'Ⅵm7', 'Ⅱm7', '→'],
    text: 'A5:4 C6:2 E6:2 | F5:4 A5:2 C6:2 | C6:6 D6:2 | G5:2 B5:2 F5:4 | E6:4 C6:2 A5:2 | F5:4 A5:4 | D6:2 B5:2 F5:4 | C6:8',
    answer: ['Ⅵm', 'Ⅳ', 'Ⅴsus47', 'Ⅴ7', 'Ⅵm', 'Ⅳ', 'Ⅴ7', 'Ⅰ'],
    intro: ['3番ではメロディが「ド」を長くのばします。「ド」は、Ⅴ（ソ・シ・レ）の上では、「シ」と半音でぶつかる、アヴォイドです。',
      'そこで、Ⅴsus47（ソ・ド・レ・ファ）。「ド」が和音の音になります。そして、次の和音（Ⅴ7）でメロディの「ド」→「シ」と、下りるのと一緒に、sus4 の「ド」（4度）が半音下がって「シ」（3度）へ解決します。',
      'sus4 から、同じルートの和音（Ⅴ7 など）へ内声が動くと、加点されます。'],
    tips: ['3番の「ド」の長い音に、Ⅴ や Ⅴ7 を置くと、ぶつかります。'],
    outro: ['メロディの音を和音の構成音にしてしまう（sus4）のも、ぶつかりを避ける、ひとつの方法です。'],
  },
  {
    id: 'm04', no: 4, title: 'ちょっと 寄り道', sub: '♯のついた音はドミナントのサイン', color: '#e2704a', bpm: 100, pieces: null,
    text: 'E5:4 G5:4 | G#5:4 B5:2 D6:2 | A5:4 C6:4 | C#6:4 E6:2 G5:2 | D6:4 A5:2 F5:2 | F#5:4 A5:2 C6:2 | G5:2 B5:2 F5:4 | C6:8',
    answer: ['Ⅰ', 'Ⅲ7', 'Ⅵm', 'Ⅵ7', 'Ⅱm7', 'Ⅱ7', 'Ⅴ7', 'Ⅰ'],
    intro: ['このメロディには、「ソ♯」「ド♯」「ファ♯」とドレミの外の音（♯のついた音）が出てきます。',
      '「ソ♯」は、Ⅲ7（ミ・ソ♯・シ・レ）の3度の音。「ド♯」は Ⅵ7、「ファ♯」は Ⅱ7 の3度の音。このように、♯のついた音は、「次の和音を引っぱる、ドミナント7th」のサインです（セカンダリードミナント）。',
      '強い拍に、♯のついた音がきたら、そのドミナントを置いてみましょう。'],
    tips: ['「ソ♯」は2番、「ド♯」は4番、「ファ♯」は6番に出てきます。'],
    outro: ['ドミナント7th が次の和音を引っぱって、連なる進行（セカンダリードミナントの連鎖）になりました。', 'メロディの「ドレミの外の音」は、和音を選ぶ、大きなヒントです。'],
  },
  {
    id: 'm05', no: 5, title: 'ほのかな影', sub: 'ラ♭の音は、Ⅳm のサイン', color: '#d19b83', bpm: 90, pieces: null,
    text: 'E5:4 G5:4 | A5:4 C6:2 E6:2 | F5:4 A5:2 C6:2 | Ab5:4 C6:2 F5:2 | G5:4 E5:4 | D6:4 A5:2 F5:2 | D6:2 B5:2 F5:4 | C6:8',
    answer: ['Ⅰ', 'Ⅵm', 'Ⅳ', 'Ⅳm7', 'Ⅰ', 'Ⅱm7', 'Ⅴ7', 'Ⅰ'],
    intro: ['4番でメロディが「ラ♭」を長く鳴らします。ドレミの音階にない、短調の響きの音です。',
      '「ラ♭」は、Ⅳm7（ファ・ラ♭・ド・ミ♭）の3度の音。明るい曲に短調から和音を借りてくる「サブドミナントマイナー」です。Ⅳ や Ⅰ の上では、「ラ」や「ソ」とぶつかります。',
      'ラ♭ → ソ（5番）と半音下がって、Ⅰ に解決する流れもせつなくて、きれいです。'],
    tips: ['「ラ♭」が長く鳴る4番にどの和音が合うか、試してみよう。'],
    outro: ['借りてきた和音（Ⅳm7）がメロディの「ラ♭」を、和音の音にしてくれました。', 'メロディがふだんの調の外に出るとき、和音も借り物を使うと、ぴったり合います。'],
  },
];

// 画面・ゲームが使う、ステージの形にする
function makeStage(src) {
  const { notes, slots } = parseMelody(src.text);
  return {
    id: src.id, no: src.no, mode: 'melody', title: src.title, sub: src.sub, color: src.color, bpm: src.bpm, pieces: src.pieces === undefined ? null : src.pieces,
    drumId: 2, backingId: 1, goal: null, solution: [],
    goalText: 'メロディに合う和音を1〜8番に置こう', doneText: '採点しました',
    melody: { id: src.id, notes, slots, text: src.text },
    answer: src.answer, intro: src.intro, outro: src.outro, tips: src.tips || [],
  };
}
export const MELODY_STAGES = SOURCES.map(makeStage);

// ---------- 得点 ----------
// コード進行の得点（技・ジャッジ。ふだんと同じ）+ メロディとの相性。res は analyze() の結果。メロディの結果を足して、合計を作り直す（0点より下にはならない）
export function applyMelody(res, board, melody, table) {
  const m = judgeMelody(board, melody, table);
  res.melody = m;
  res.score.melody = m.total;
  res.score.melodyMatch = m.match;
  res.score.total = Math.max(0, res.score.raw + m.total);
  return res;
}

// 盤のメロディとの相性で、気になるところ（ぶつかる音・不安定な音）を、ジャッジの講評（critiques）と同じ形の行にする。点は、メロディの合計に入っているので、0点（— と出す）
export function meloNotes(m) {
  const rows = [];
  for (const st of m.steps) {
    if (!st.hasNotes || !st.chord) continue;
    const bad = st.items.filter((i) => i.kind === 'avoid' || i.kind === 'unstable');
    if (!bad.length) continue;
    const avoid = bad.some((i) => i.kind === 'avoid');
    rows.push({
      id: `melody|bad|${st.step}`, kind: 'bad', group: 'melody', variant: null, sub: null,
      name: `${st.step + 1}番: ${avoid ? 'メロディとぶつかる' : 'メロディが不安定'}`, title: `${st.step + 1}番: ${avoid ? 'メロディとぶつかる' : 'メロディが不安定'}`,
      points: 0, color: '#e0674d', positions: [st.step], chords: [st.chord], startPos: st.step, endPos: st.step, endFirst: st.step,
      reason: `${bad.map((i) => i.text).join(' ')} 和音を替えてみよう。右上の「ヒント」を ON にすると、この場所に合う和音の候補が出ます。`,
    });
  }
  return rows;
}

// お手本の得点（星の基準）。ステージごとに、いちど計算して覚えておく
const parCache = new Map();
export function melodyPar(stage, table) {
  if (parCache.has(stage.id)) return parCache.get(stage.id);
  const board = stage.answer.map((n) => { const c = table.byName(n); if (!c) throw new Error(`知らない駒: ${n}`); return c.id; });
  const res = applyMelody(analyze(board, table), board, stage.melody, table);
  const par = { total: res.score.total, melody: res.score.melody, match: res.score.melodyMatch, progression: res.score.raw };
  parCache.set(stage.id, par);
  return par;
}

// 星（0〜3）。3つの条件を、順に満たしていく（星1: 相性 60% 以上 / 星2: 相性 90% 以上 / 星3: 星2 + コード進行の点が、お手本の 5割以上）
//   res: 採点した盤（analysis）。par: お手本の得点（melodyPar）。戻り値: { stars, conds: [{ ok, text }] }
export function melodyStars(res, par) {
  const S = MELODY_SCORE.stars, match = res.score.melodyMatch || 0, prog = res.score.raw;
  const need3 = Math.round(par.progression * S.progression3);
  const c1 = match >= S.match1, c2 = c1 && match >= S.match2, c3 = c2 && prog >= need3;
  return {
    stars: (c1 ? 1 : 0) + (c2 ? 1 : 0) + (c3 ? 1 : 0),
    conds: [
      { ok: c1, text: `星1: メロディとの相性が ${Math.round(S.match1 * 100)}% 以上（いま ${Math.round(match * 100)}%）` },
      { ok: c2, text: `星2: 相性が ${Math.round(S.match2 * 100)}% 以上` },
      { ok: c3, text: `星3: そのうえでコード進行の点（技・ジャッジ）が ${need3} 点以上（お手本の${Math.round(S.progression3 * 10)}割。いま ${prog} 点）` },
    ],
  };
}
