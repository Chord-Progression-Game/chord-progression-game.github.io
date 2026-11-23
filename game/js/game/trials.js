// チャレンジステージ（2026-11-23）: ステージごとに「条件」が課され、その条件を守ったまま、ノルマの得点をめざす。
//   ・条件（rules）は、データで書く。盤の駒・判定の結果から、いま守れているかを、いつも調べる（evaluateTrial）。DOM には触れない
//   ・クリア = 条件が全部そろっていて、盤の得点がノルマ以上のとき、「できた！ 提出する」を押す。星 = ノルマ・ノルマの1.4倍・1.8倍
//   ・使える駒（pieces）は、トレイを、その駒だけにする。実機の盤では、駒を制限できないので、「使える駒だけ」の条件としても調べる
//   ・内部の名前は 'trial'（画面の名前は「チャレンジステージ」）。前の「チャレンジ」（90秒の得点競争）は、画面の名前が「タイムアタック」になった（内部の名前は 'challenge' のまま。保存ずみの記録を、そのまま使うため）
import { TRICKS } from '../core/tricks.js';

export const TRIAL_PIECES_LV12 = ['Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅵm', 'ⅠM7', 'Ⅱm', 'Ⅲm', 'ⅣM7', 'Ⅴ7', 'Ⅵm7'];
export const TRIAL_PIECES_LV123 = [...TRIAL_PIECES_LV12, 'Ⅰ7', 'Ⅱm7', 'Ⅲm7', 'Ⅲ7', 'Ⅶm7-5'];

// ---------------------------------------------------------------- 条件の種類
//   { type: 'kind', kind, variant?, min }   その技を、min 回以上 決める（variant があれば、その形だけ）
//   { type: 'group', group, min }           その仲間（motion = つながり / cadence = 終止 / named = 名前のついた進行 / borrowed = 借用和音）の技を、min 回以上
//   { type: 'kinds', min }                  ちがう種類の技を、min 種類以上
//   { type: 'combo', min }                  技を、min 個以上、つなげる（コンボ）
//   { type: 'sense', min }                  ジャッジの加点（耳に馴染む並び・なめらかな声）の合計が、min 点以上
//   { type: 'only', names }                 使える駒は、これだけ
//   { type: 'use', names }                  これらの駒を、ぜんぶ使う
//   { type: 'level', min }                  Lv. が min 以上の駒を、1つ以上使う
//   { type: 'max', n } / { type: 'min', n } 駒（「→」を含む。分割したマスは、前半・後半とも 1つずつ）の数が、n 以下 / n 以上
//   { type: 'fill' }                        8つの場所を、ぜんぶ使う（分割したマスも、1か所）
//   { type: 'noDup' } / { type: 'maxSame', n }   同じ駒を、2回以上使わない / n 回までにする
//   { type: 'ban', kind }                   その技は、使わない
//   { type: 'at', slot, names }             slot 番目（0 から）は、この駒のどれか
//   { type: 'noOddity' }                    冒頭のドミナント（？）を、出さない
const nameOfKind = (kind, variant) => { const t = TRICKS[kind]; return variant || (t && (t.sub || t.name)) || kind; };
const GROUP_NAMES = { motion: 'つながりの技', cadence: '終止の技', named: '名前のついた進行', borrowed: '借用和音の技' };

// 盤と判定の結果から、条件の調べ物に使う数を集める
//   split: 分割したマス（1つのマスに、前半・後半の2つのコード）の、後半のコードの ID の配列（省いてもよい）。後半の駒も、1つの駒として数える（「→」を含む駒の数・同じ駒の数・使える駒…）
function context(board, analysis, table, split = null) {
  const pieces = [];                                     // 盤の上の駒（「→」を除く。分割したマスの後半も）
  let placed = 0;                                        // 盤の上の駒の数（「→」を含む。分割したマスの後半も）
  let slots = 0;                                         // 駒のある場所の数
  board.forEach((id, slot) => {
    if (id === null || id === undefined) return;
    slots++; placed++;
    if (id !== table.repeatId) { const c = table.byId(id); if (c) pieces.push({ slot, chord: c }); }
    const sid = split ? split[slot] : null;
    if (sid !== null && sid !== undefined) { placed++; const c2 = table.byId(sid); if (c2) pieces.push({ slot, chord: c2, half: 1 }); }
  });
  const ins = analysis.instances || [];
  return { board, split, analysis, table, pieces, placed, slots, ins };
}

const countKind = (ctx, kind, variant) => ctx.ins.filter((i) => i.kind === kind && (!variant || i.variant === variant)).length;

// 条件 1つ: { text, ok, now }（now = いまの様子の短い文）
function checkRule(rule, ctx) {
  const names = ctx.pieces.map((p) => p.chord.name);
  switch (rule.type) {
    case 'kind': { const n = countKind(ctx, rule.kind, rule.variant); return { text: `「${nameOfKind(rule.kind, rule.variant)}」を ${rule.min}回以上 決める`, ok: n >= rule.min, now: `いま ${n}回` }; }
    case 'group': { const n = ctx.ins.filter((i) => i.group === rule.group).length; return { text: `${GROUP_NAMES[rule.group] || rule.group}を ${rule.min}回以上 決める`, ok: n >= rule.min, now: `いま ${n}回` }; }
    case 'kinds': { const n = ctx.analysis.score.kinds || 0; return { text: `ちがう種類の技を ${rule.min}種類以上`, ok: n >= rule.min, now: `いま ${n}種類` }; }
    case 'combo': { const n = ctx.analysis.score.combo || 0; return { text: `技を ${rule.min}つ以上 つなげる（コンボ）`, ok: n >= rule.min, now: `いま ${n}つ` }; }
    case 'sense': { const n = ctx.analysis.score.senseGood || 0; return { text: `ジャッジの加点を ${rule.min}点以上（耳に馴染む並び・なめらかな声）`, ok: n >= rule.min, now: `いま +${n}` }; }
    case 'only': { const bad = [...new Set(names.filter((n) => !rule.names.includes(n)))]; return { text: `使える駒は ${rule.names.join('・')} だけ`, ok: bad.length === 0, now: bad.length ? `${bad.join('・')} は使えません` : '' }; }
    case 'use': { const miss = rule.names.filter((n) => !names.includes(n)); return { text: `${rule.names.join('・')} を使う`, ok: miss.length === 0, now: miss.length ? `あと ${miss.join('・')}` : '' }; }
    case 'level': { const top = Math.max(0, ...ctx.pieces.map((p) => p.chord.level || 0)); return { text: `Lv.${rule.min} 以上の駒を 1つ以上 使う`, ok: top >= rule.min, now: top ? `いちばん高いのは Lv.${top}` : '' }; }
    case 'max': return { text: `駒は ${rule.n}つまで`, ok: ctx.placed <= rule.n, now: `いま ${ctx.placed}つ` };
    case 'min': return { text: `駒を ${rule.n}つ以上 置く`, ok: ctx.placed >= rule.n, now: `いま ${ctx.placed}つ` };
    case 'fill': return { text: '8つの場所を、ぜんぶ使う', ok: ctx.slots >= ctx.board.length, now: `いま ${ctx.slots}か所` };
    case 'noDup': { const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]; return { text: '同じ駒は、2回使わない', ok: dup.length === 0, now: dup.length ? `${dup.join('・')} が重なっています` : '' }; }
    case 'maxSame': { const cnt = {}; names.forEach((n) => { cnt[n] = (cnt[n] || 0) + 1; }); const over = Object.keys(cnt).filter((n) => cnt[n] > rule.n); return { text: `同じ駒は ${rule.n}回まで`, ok: over.length === 0, now: over.length ? `${over.join('・')} が多すぎます` : '' }; }
    case 'ban': { const n = countKind(ctx, rule.kind, rule.variant); return { text: `「${nameOfKind(rule.kind, rule.variant)}」は 使わない`, ok: n === 0, now: n ? `いま ${n}回 決まっています` : '' }; }
    case 'at': { const id = ctx.board[rule.slot]; const c = id === null || id === undefined ? null : ctx.table.byId(id); const ok = !!c && rule.names.includes(c.name); return { text: `${rule.slot + 1}番は ${rule.names.join(' か ')}`, ok, now: c ? c.name : '空き' }; }       // 分割したマスは、前半の駒
    case 'noOddity': { const n = (ctx.analysis.oddities || []).length; return { text: '冒頭に、ドミナント（？）を置かない', ok: n === 0, now: n ? '「？」が出ています' : '' }; }
    default: return { text: String(rule.type), ok: false, now: '' };
  }
}

// ステージの条件・ノルマを、いまの盤で調べる。戻り値: { rules: [{ text, ok, now }], allOk, score, norm, normOk, ready, okCount }
//   ready = 条件が全部そろっていて、得点がノルマ以上（「提出する」を押せる）
export function evaluateTrial(stage, board, analysis, table, split = null) {
  const ctx = context(board, analysis, table, split);
  const rules = (stage.rules || []).map((r) => checkRule(r, ctx));
  // 使える駒の制限は、トレイで、すでにかけている。実機の盤で、使えない駒を置いたときのために、条件としても調べる
  if (stage.pieces) {
    const bad = [...new Set(ctx.pieces.map((p) => p.chord.name).filter((n) => !stage.pieces.includes(n)))];
    if (bad.length) rules.push({ text: 'このステージで使える駒だけを使う', ok: false, now: `${bad.join('・')} は使えません` });
  }
  const score = analysis.score.total;
  const allOk = rules.every((r) => r.ok);
  const normOk = score >= stage.norm;
  return { rules, allOk, score, norm: stage.norm, normOk, ready: allOk && normOk && ctx.placed > 0, okCount: rules.filter((r) => r.ok).length };
}

// 星: ノルマ以上 = 1 / ノルマの 1.4倍 = 2 / 1.8倍 = 3
export function trialStars(stage, score) { return (stage.stars || [stage.norm, Math.round(stage.norm * 1.4), Math.round(stage.norm * 1.8)]).filter((s) => score >= s).length; }

const T = (o) => ({ bpm: 110, drumId: 2, backingId: 1, ...o, stars: [o.norm, Math.round((o.norm * 1.4) / 10) * 10, Math.round((o.norm * 1.8) / 10) * 10] });

// ---------------------------------------------------------------- ステージ
// norm（ノルマ）は、仮の値。自然な盤（王道進行・小室進行・ツーファイブワンのくり返しなど）が、1〜2つ星になるように、決めた（2026-11-23。条件を守ったまま届くことは、game/test/game.test.js の探索で確かめてある）。遊びながら調整する
export const TRIAL_STAGES = [
  T({
    id: 'c01', no: 1, title: 'ドミナントを2回', sub: '強い引っぱりを、2回決める', color: '#e2704a', norm: 400, pieces: TRIAL_PIECES_LV12,
    rules: [{ type: 'kind', kind: 'dominant_motion', min: 2 }, { type: 'max', n: 6 }],
    intro: ['このモードでは、ステージごとに「条件」があります。条件を全部まもったまま、ノルマの得点をめざそう。', '「ドミナントモーション」は、ルートが完全4度上がる動き（例: Ⅱm → Ⅴ7 → ⅠM7）。これを2回決めます。使える駒は、やさしいものだけ。駒は6つまで。'],
    outro: ['強進行を、つなげて、2回決められました。', 'つぎは、少ない駒で、高い点をねらう条件です。'],
  }),
  T({
    id: 'c02', no: 2, title: '4つだけで', sub: '少ない駒で、名前のついた進行を', color: '#9be15d', norm: 600, pieces: null,
    rules: [{ type: 'max', n: 4 }, { type: 'group', group: 'named', min: 1 }],
    intro: ['駒は4つまで。そのなかで「名前のついた進行」（王道進行・小室進行など）を1つ決めます。', '名前のついた進行は、1番か5番から並べると決まります。4つで決まる進行を思い出してみよう。'],
    outro: ['4つの駒で、進行がまとまりました。', '少ない駒でも、並べ方しだいで、点は伸びます。'],
  }),
  T({
    id: 'c03', no: 3, title: 'ぜんぶちがう駒', sub: '同じ駒は、2回使わない', color: '#66a0dc', norm: 700, pieces: TRIAL_PIECES_LV123,
    rules: [{ type: 'noDup' }, { type: 'min', n: 6 }, { type: 'kinds', min: 2 }],
    intro: ['同じ駒は、2回使えません。6つ以上ならべて、2種類以上の技を決めます。', 'ルートの動きがちがう駒を、ならべていこう。'],
    outro: ['いろいろな駒を使うと、技の種類も増えます。', '種類が多いほど、得点の倍率が上がります。'],
  }),
  T({
    id: 'c04', no: 4, title: 'ジャズの入り口', sub: 'ツーファイブワンを2回', color: '#caa660', norm: 1200, pieces: TRIAL_PIECES_LV123,
    rules: [{ type: 'kind', kind: 'dominant_motion', variant: 'ツーファイブワン', min: 2 }, { type: 'use', names: ['Ⅱm7', 'Ⅴ7'] }],
    intro: ['「ツーファイブワン」（Ⅱm7 → Ⅴ7 → ⅠM7）を、2回決めます。Ⅱm7 と Ⅴ7 は、必ず使います。', '盤はループするので、8番から 1番へのつなぎ目も、使えます。'],
    outro: ['ジャズの基本の形を、くり返せました。', 'つぎは、強い引っぱりを、禁止します。'],
  }),
  T({
    id: 'c05', no: 5, title: 'ドミナントなしで', sub: '引っぱる動きは、使わない', color: '#b999dc', norm: 800, pieces: TRIAL_PIECES_LV123,
    rules: [{ type: 'ban', kind: 'dominant_motion' }, { type: 'min', n: 5 }, { type: 'kinds', min: 2 }],
    intro: ['「ドミナントモーション」（ルートが完全4度上がる動き）は、使えません。', 'Ⅴ → Ⅰ や Ⅱm → Ⅴ のような動きに、気をつけて。弱進行や、名前のついた進行を使おう。'],
    outro: ['強い引っぱりがなくても、ちゃんと形になりました。', 'つぎは、終わらせ方を決めます。'],
  }),
  T({
    id: 'c06', no: 6, title: '終わりを飾る', sub: '8番は Ⅰ か Ⅵm で、終止を決める', color: '#e28cb2', norm: 1200, pieces: null,
    rules: [{ type: 'at', slot: 7, names: ['Ⅰ', 'ⅠM7', 'Ⅵm', 'Ⅵm7'] }, { type: 'group', group: 'cadence', min: 1 }, { type: 'min', n: 6 }],
    intro: ['8番は Ⅰ・ⅠM7・Ⅵm・Ⅵm7 のどれか。そして「終止」の技（Ⅴ-Ⅰ終止・偽終止など）を、1つ決めます。', '終止は、フレーズの終わり（4番か8番）で決まります。'],
    outro: ['ちゃんと「おしまい」になる進行ができました。', 'つぎは、ちょっと変わった道をとおります。'],
  }),
  T({
    id: 'c07', no: 7, title: '裏からしかける', sub: '裏コードと、セカンダリードミナント', color: '#aa8adc', norm: 1000, pieces: null,
    rules: [{ type: 'kind', kind: 'half_step_down', min: 1 }, { type: 'kind', kind: 'dominant_motion', variant: 'セカンダリードミナント', min: 1 }, { type: 'level', min: 4 }],
    intro: ['「半音下への進行」（裏コード。Ⅱm7 → Ⅱ♭7 → ⅠM7 など）と「セカンダリードミナント」（Ⅰ 以外へ向かうドミナント）を、1つずつ。', 'Lv.4 以上の駒も、1つ使います。ふだんと違う色の和音を、さがそう。'],
    outro: ['いつもの道を、少しそれて、また戻ってきました。', 'つぎは、声のなめらかさに、こだわります。'],
  }),
  T({
    id: 'c08', no: 8, title: 'なめらかに', sub: 'ジャッジの加点を、しっかり集める', color: '#86c79a', norm: 1200, pieces: null,
    rules: [{ type: 'sense', min: 120 }, { type: 'kinds', min: 3 }, { type: 'noOddity' }],
    intro: ['名前のついた技だけでなく、耳に馴染む並び・なめらかな声の動き・ベースの階段なども、「ジャッジ」の加点になります。', 'ジャッジの加点を 120点以上。ちがう種類の技も3種類以上。冒頭に ドミナントを置くと「？」になるので、気をつけて。'],
    outro: ['技の名前がつかなくても、よい響きの並びは、ちゃんと点になります。', 'つぎは、いちばん大きな挑戦です。'],
  }),
  T({
    id: 'c09', no: 9, title: '満員御礼', sub: '8つの場所を使いきる', color: '#e2573c', norm: 3000, pieces: null,
    rules: [{ type: 'fill' }, { type: 'kinds', min: 4 }, { type: 'combo', min: 3 }, { type: 'noOddity' }],
    intro: ['8つの場所を、ぜんぶ使います。ちがう種類の技を4種類以上。技を3つ以上つなげて「コンボ」にします。', '駒どうしで、技を共有すると、つながって、倍率がのびます。'],
    outro: ['すべての条件を守って、高い得点に届きました。', 'チャレンジステージは、これで全部です。フリープレイで、自由に試してみよう。'],
  }),
];

export const nextTrialAfter = (stage) => { const i = TRIAL_STAGES.indexOf(stage); return i >= 0 && i + 1 < TRIAL_STAGES.length ? TRIAL_STAGES[i + 1] : null; };
