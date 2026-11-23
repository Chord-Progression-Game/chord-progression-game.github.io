// 技の「詳細」（技の枠・一覧の行を押したときに出す内容）を作る。DOM には触れない。
//   技の定義は tricks.js（TRICKS・PATTERNS）、曲の一覧は songs.js。ここでは、それを、読みやすい形にまとめるだけ。
import { TRICKS, PATTERNS, HEAD_V, HEAD_V_PENALTY, SCORE } from './tricks.js';
import { songsFor } from './songs.js';

export const GROUP_LABELS = { motion: 'つながり', cadence: '終止', named: '固有進行', borrowed: '借用和音' };
export const GROUP_NOTES = {
  motion: 'となり合う2つの和音の「動き」で決まる技です。盤の、どの位置にあっても決まります。',
  cadence: '曲の区切り（フレーズの終わり）の形で決まる技です。4番・8番に着く（または、その後に駒が続かない）ときに決まります。',
  named: '名前のついた、決まった並びの進行です。たまたま途中に並んでも決まりません。',
  borrowed: '短調から借りてきた和音を、うまく使う技です。借りた和音のあとに、自然な和音が続くと決まります。',
};

// 技が決まる条件（その技ごとの、ことば）
const CONDITION_BY_ID = {
  ragtime: '冒頭（1番）から並べて、最後の Ⅰ を2つぶん以上（Ⅰ・Ⅰ か Ⅰ →）つづけると決まります。',
  ragtime_held: '冒頭（1番）から並べて、最後の Ⅰ を2つぶん以上（Ⅰ・Ⅰ か Ⅰ →）つづけると決まります。',
  blues8: '1番から8番まで、ぜんぶ使うと決まります（Ⅳ は「→」でのばしてもかまいません）。',
  blues8_held: '1番から8番まで、ぜんぶ使うと決まります（Ⅳ は「→」でのばしてもかまいません）。',
  canon: '1番から並べると決まります（8つ並べると「完全な形」でボーナス）。',
  backdoor: 'フレーズの終わり（4番・8番、または最後の駒）が ⅠM7（Ⅰ）になると決まります。どの位置から始めてもかまいません。',
  confirmation: '1番か5番から並べると決まります（「→」でのばしてもかまいません）。',
};

function patternOf(ins) {
  const id = String(ins.id || '').replace('@loop', '');
  return PATTERNS.find((p) => p.id === id) || null;
}

export function conditionText(ins, pat = patternOf(ins)) {
  if (ins.warn) return '冒頭（1番）に、ドミナント系の駒（Ⅴ・Ⅲ7・Ⅰ7 など）を置いたとき。';
  if (ins.seam) return 'ループのつなぎ目（8番 → 1番）で決まります。盤の8つが埋まっていて、8番と1番のあいだに休みがないときです。';
  if (pat && CONDITION_BY_ID[pat.id]) return CONDITION_BY_ID[pat.id];
  const kind = TRICKS[ins.kind];
  const group = kind ? kind.group : '';
  if (group === 'named') {
    if (pat && pat.startAt && pat.startAt.length === 1 && pat.startAt[0] === 0) return '1番から並べると決まります。';
    if (pat && pat.startAt) return '1番か5番から並べると決まります。';
    return 'どこからでも決まります。';
  }
  if (group === 'cadence') return 'フレーズの終わり（4番・8番、または、その後に駒が続かない位置）で決まります。';
  if (group === 'motion') return '盤の、どの位置でも決まります。';
  if (group === 'borrowed') return '借りてきた和音のあとに、自然な和音（Ⅰ・Ⅴなど）が続くと決まります。';
  return '';
}

// 技の枠の詳細。ins: 判定の結果の技（analyze の instances の1つ）か、「？」（oddities の1つ）
export function trickDetail(ins) {
  if (!ins) return null;
  if (ins.warn) {
    return {
      warn: true, id: ins.id, name: '？', title: ins.title || HEAD_V.title, color: ins.color || HEAD_V.color, groupLabel: '減点',
      chordsLine: ins.chords.join(' → '), symbolsLine: (ins.symbols || []).join(' → '), positions: ins.positions.map((p) => p + 1),
      explain: HEAD_V.reason, condition: conditionText(ins), penalty: ins.penalty || HEAD_V_PENALTY, total: ins.total, songs: null,
    };
  }
  const kind = TRICKS[ins.kind];
  if (!kind) return null;
  const pat = patternOf(ins);
  const variantText = ins.variant && kind.variants ? kind.variants[ins.variant] || null : null;
  const baseTitle = ins.sub && !ins.variant ? ins.sub : ins.name;
  return {
    warn: false, id: ins.id, kind: ins.kind, group: kind.group, groupLabel: GROUP_LABELS[kind.group] || '', groupNote: GROUP_NOTES[kind.group] || '',
    name: baseTitle, sub: ins.variant || (ins.sub ? ins.name : ''), color: ins.color, custom: !!kind.custom,
    chordsLine: ins.chords.join(' → '), symbolsLine: (ins.symbols || []).join(' → '), positions: ins.positions.map((p) => p + 1), seam: !!ins.seam,
    explain: variantText || kind.explain, general: kind.explain,
    variants: Object.entries(kind.variants || {}).map(([name, text]) => ({ name, text, here: name === ins.variant })),
    condition: conditionText(ins, pat),
    points: { base: pat ? pat.points : ins.points, extra: pat ? ins.points - pat.points : 0, instance: ins.points, repeatMult: ins.repeatMult, comboMult: ins.comboMult, total: ins.total, repeatRule: SCORE.repeatMult, comboRule: SCORE.comboMult },
    reason: ins.reason,
    songs: kind.custom ? null : songsFor(ins),
  };
}
