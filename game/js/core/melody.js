// メロディとの相性（「メロディにコードをつける」ステージの採点）。ブラウザの外（テスト）でも動くように、DOM には触れない。
//
// ■ 考え方
//   流れているメロディの音（1つ1つ）が、そのとき鳴っている和音に対して、どう聞こえるかを、4つに分ける（classifyNote）。判定は、主音（Ⅰ = C）からの半音の数で行う。
//     chord   : コードの音（和音の構成音。7th を足した和音なら、7th も）            … 安定。いちばん良い
//     tension : テンション（9th・11th・13th など。和音に色をつけて、使ってよい音）… 良い（おしゃれ）
//     avoid   : アヴォイドノート（和音の構成音の、半音上の音。短9度でぶつかって、濁る）… 悪い
//     passing : どれでもない音。短くて弱い拍なら、経過音として問題なし。長い音・強い拍だと「不安定」になる（少し減点）
//   音の「重み」= 長さ × 拍の強さ。和音が変わる瞬間（ステップの頭）の音ほど重く、短く弱い拍の音は、軽い。
//   1ステップ（= 2拍。盤の1つの場所）ごとに、重みつきの平均（-1〜+1）を出して、点にする。
//   さらに、強い拍で、メロディが「テンション」になっていて、濁りのないステップには、ボーナス。
//   点数は仮。条件・点数の一覧は docs/melody_mode.md。
//
// ■ メロディのデータ
//   notes: [[開始のマス, 長さ（マス）, MIDI ノート番号, 音の呼び名（省略可。'ラ♭' など）], ...]。1ステップ = 8マス（16分音符）、8ステップで 64マス（1周）。主音は C（C4 = 60）。
//   parseMelody('E5:4 G5:4 | A5:4 C6:4 | ...') で、文字から作れる（音名:長さ。r = 休み。| は見やすさの区切り）。

import { MAJOR } from './chords.js';
import { resolveChordAtStep } from './voicing.js';

export const SLOTS_PER_STEP = 8;
export const NUM_STEPS = 8;
export const LOOP_SLOTS = SLOTS_PER_STEP * NUM_STEPS;

// 点数（仮）
export const MELODY_SCORE = {
  stepMax: 150,                                  // 1ステップの満点（すべての音が、コードの音・テンション）。8ステップで 1200点（名前のついた進行の、よい得点と、同じくらい）
  value: { chord: 1, tension: 1, passing: 0, unstable: -0.25, avoid: -1 },
  beat: { head: 1.6, second: 1.3, offbeat: 1.0, weak: 0.7, held: 1.0 },       // 拍の強さ: ステップの頭 / 2拍目 / 8分の裏 / 16分の裏 / 前のステップから、のびている音
  tensionBonus: 40,                              // 強い拍のテンション（濁りなし）のステップ1つにつき
  tensionBonusSteps: 3,                          // ボーナスをもらえるステップの数の上限
  stars: { match1: 0.6, match2: 0.9, progression3: 0.5 },     // 星1: 相性 60% 以上 / 星2: 相性 90% 以上 / 星3: 星2 + コード進行の点が、お手本の 5割以上
};

// ---------- 音名 ----------
const NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const NAMES_FLAT = ['ド', 'レ♭', 'レ', 'ミ♭', 'ミ', 'ファ', 'ソ♭', 'ソ', 'ラ♭', 'ラ', 'シ♭', 'シ'];
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteName = (pc, flats = false) => (flats ? NAMES_FLAT : NAMES)[((pc % 12) + 12) % 12];
export const midiName = (midi) => `${noteName(midi)}${Math.floor(midi / 12) - 1}`;
// 'Ab5' → 'ラ♭'、'G#5' → 'ソ♯'、'E5' → 'ミ'（書いたとおりの呼び名）
function spellOf(text) {
  const m = /^([A-G])([#b]?)/.exec(text);
  const pc = LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return noteName(pc, m[2] === 'b');
}

// 'E5' 'F#4' 'Bb5' → MIDI ノート番号（C4 = 60）
export function midiOf(text) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(text);
  if (!m) throw new Error(`音名が読めません: ${text}`);
  return 12 * (Number(m[3]) + 1) + LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// 'E5:4 G5:4 | r:2 C6:6' → [[開始のマス, 長さ, MIDI], ...]
export function parseMelody(text) {
  const notes = [];
  let slot = 0;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (tok === '|') continue;
    const [name, lenText] = tok.split(':');
    const len = Number(lenText);
    if (!Number.isInteger(len) || len < 1) throw new Error(`長さが読めません: ${tok}`);
    if (name !== 'r') notes.push([slot, len, midiOf(name), spellOf(name)]);
    slot += len;
  }
  return { notes, slots: slot };
}

// ---------- 和音とメロディの音の関係 ----------
// 和音の種類ごとに、「使ってよい音」（テンション）。キー = ルートからの半音の数、値 = 呼び名
const TENSIONS = {
  maj:    { 2: '9th', 6: '♯11th', 9: '13th' },
  maj7:   { 2: '9th', 6: '♯11th', 9: '13th' },
  min:    { 2: '9th', 5: '11th', 9: '13th' },
  min7:   { 2: '9th', 5: '11th', 9: '13th' },
  dom7:   { 1: '♭9th', 2: '9th', 3: '♯9th', 6: '♯11th', 8: '♭13th', 9: '13th' },     // ドミナントは、オルタード（♭9・♯9・♯11・♭13）も、使ってよい
  min7b5: { 2: '9th', 5: '11th', 8: '♭13th' },
  dim7:   { 2: '9th', 5: '11th', 8: '♭13th', 11: '7th' },
  sus47:  { 2: '9th', 9: '13th' },
  sus4:   { 2: '9th', 9: '13th', 10: '7th' },     // 3和音のサス（Ⅵsus4）。7th は、テンションとして使ってよい
  min6:   { 2: '9th', 5: '11th' },
};
const EXTRA_AVOID = { sus47: [4], sus4: [4] };            // sus4 の和音の上の、3度の音（4度の音と、半音でぶつかる）

const ROLE_NAMES = { 0: 'ルート', 3: '3度', 4: '3度', 5: '4度', 6: '5度（♭5）', 7: '5度', 9: '6度', 10: '7度', 11: '7度' };

// pc: 主音からの半音の数（0〜11）。戻り値: { cat: 'chord'|'tension'|'avoid'|'passing', label: 呼び名, iv: ルートからの半音, because?: 半音下にある、コードの音の名前（avoid のとき）}
export function classifyNote(chord, pc) {
  pc = ((pc % 12) + 12) % 12;
  const iv = (((pc - chord.rootPc) % 12) + 12) % 12;
  if (chord.pcs.includes(pc)) {
    let label = ROLE_NAMES[iv] || `${iv}`;
    if (chord.type === 'dim7' && iv === 9) label = '7度（♭♭7）';
    return { cat: 'chord', label, iv };
  }
  const tens = TENSIONS[chord.type] || {};
  if (tens[iv]) return { cat: 'tension', label: tens[iv], iv };
  // 3和音（Ⅰ・Ⅱm など）に、その調の音階にある 7th を足した音は、7th として、使ってよい
  if ((chord.type === 'maj' || chord.type === 'min') && (iv === 10 || iv === 11) && MAJOR.includes(pc)) return { cat: 'tension', label: '7th', iv };
  const below = chord.pcs.find((cp) => (cp + 1) % 12 === pc);
  if (below !== undefined || (EXTRA_AVOID[chord.type] || []).includes(iv)) return { cat: 'avoid', label: 'アヴォイド', iv, because: below !== undefined ? noteName(below) : null };
  return { cat: 'passing', label: '', iv };
}

// ---------- メロディの音を、ステップごとに切り分ける ----------
// 戻り値: 長さ NUM_STEPS の配列。各要素は、そのステップに、かかっている音の一覧
//   { index: メロディの何番目の音か, midi, pc, name（呼び名）, step, from（ステップの中の、始まりのマス 0〜7）, len（このステップの中の長さ）, attack（このステップで鳴り始めるか）, ornament（短くて弱い拍の音か）, weight }
const segCache = new WeakMap();
export function stepSegments(melody) {
  if (segCache.has(melody)) return segCache.get(melody);
  const steps = Array.from({ length: NUM_STEPS }, () => []);
  melody.notes.forEach(([start, len, midi, spell], index) => {
    const ornament = len <= 2 && start % 4 !== 0;                                   // 8分音符より短く、拍の頭でない音
    for (let k = 0; k < NUM_STEPS; k++) {
      const a = Math.max(start, k * SLOTS_PER_STEP), b = Math.min(start + len, (k + 1) * SLOTS_PER_STEP);
      if (b <= a) continue;
      const attack = start >= k * SLOTS_PER_STEP, from = a - k * SLOTS_PER_STEP;
      const beat = !attack ? MELODY_SCORE.beat.held : from === 0 ? MELODY_SCORE.beat.head : from === 4 ? MELODY_SCORE.beat.second : from % 2 === 0 ? MELODY_SCORE.beat.offbeat : MELODY_SCORE.beat.weak;
      steps[k].push({ index, midi, pc: midi % 12, name: spell || noteName(midi % 12), step: k, from, len: b - a, attack, ornament, weight: (b - a) * beat });
    }
  });
  segCache.set(melody, steps);
  return steps;
}

// 1つの音（切り分けたもの）が、この和音に対して、どう聞こえるか。ornament（経過音）の扱いを含めた、最終の種類
//   kind: 'chord' | 'tension' | 'passing'（短くて弱い。OK） | 'unstable'（長い・強いのに、どの役でもない） | 'avoid'
export function judgeSegment(chord, seg) {
  const c = classifyNote(chord, seg.pc);
  let kind = c.cat;
  if (c.cat === 'avoid' && seg.ornament) kind = 'passing';                          // 短くて弱い拍なら、ぶつかっても、通りすぎるだけ
  else if (c.cat === 'passing') kind = seg.ornament ? 'passing' : 'unstable';
  return { ...c, kind, value: MELODY_SCORE.value[kind] };
}

// 強い拍・長い音か（テンションのボーナスの対象。経過音ではない）
const isStrong = (seg) => seg.attack && !seg.ornament && (seg.from % 4 === 0 || seg.len >= 4);

// あるステップの、重みつきの平均（-1〜+1）。メロディの音がなければ null
export function stepFit(melody, step, chord) {
  const segs = stepSegments(melody)[step];
  if (!segs.length || !chord || chord.isRepeat) return null;
  let sum = 0, w = 0;
  for (const s of segs) { sum += judgeSegment(chord, s).value * s.weight; w += s.weight; }
  return sum / w;
}

// 「この和音を置くと、メロディの音が、どう聞こえるか」を、短い文にする（ヒントの理由）。例: 「ミ・ソ が コードの音、レ が 9th（テンション）」
export function fitSummary(melody, step, chord) {
  const segs = stepSegments(melody)[step];
  if (!segs || !segs.length || !chord || chord.isRepeat) return '';
  const chordTones = [], tensions = [];
  for (const s of segs) {
    if (s.ornament) continue;                                                            // 短くて弱い拍の音は、言わない
    const j = judgeSegment(chord, s);
    if (j.kind === 'chord' && !chordTones.includes(s.name)) chordTones.push(s.name);
    else if (j.kind === 'tension') tensions.push(`${s.name} が ${j.label}`);
  }
  const parts = [];
  if (chordTones.length) parts.push(`${chordTones.join('・')} が コードの音`);
  if (tensions.length) parts.push(`${[...new Set(tensions)].join('・')}（テンション）`);
  return parts.join('、');
}

const kindText = {
  chord: (n, ch, c) => `「${n}」は ${ch.name} の${c.label}（コードの音）。安定して聞こえます。`,
  tension: (n, ch, c) => `「${n}」は ${ch.name} の${c.label}（テンション）。和音に色がついておしゃれに聞こえます。`,
  avoid: (n, ch, c) => `「${n}」は ${ch.name} の アヴォイドノート。コードの音「${c.because || ''}」の半音上でぶつかって濁ります。`,
  unstable: (n, ch) => `「${n}」は ${ch.name} のどの役でもない音。長く・強く鳴るので少し不安定です。`,
  passing: (n, ch, c) => `「${n}」は短くて弱い拍の音。${c.cat === 'avoid' ? 'ぶつかる音ですが、通りすぎるだけなので' : '経過音として'}問題ありません。`,
};

// 1ステップの結果を、1行にまとめる（結果の表）。例: 「ミ・ソ はコードの音 ／ レ(9th) はテンション」
function briefOf(items) {
  const names = { chord: [], tension: [], avoid: [], unstable: [], passing: [] };
  for (const it of items) {
    const label = it.kind === 'tension' ? `${it.name}(${it.label})` : it.name;
    if (names[it.kind] && !names[it.kind].includes(label)) names[it.kind].push(label);
  }
  const parts = [];
  if (names.chord.length) parts.push(`${names.chord.join('・')} はコードの音`);
  if (names.tension.length) parts.push(`${names.tension.join('・')} はテンション`);
  if (names.avoid.length) parts.push(`${names.avoid.join('・')} がアヴォイド`);
  if (names.unstable.length) parts.push(`${names.unstable.join('・')} が不安定`);
  if (names.passing.length) parts.push(`${names.passing.join('・')} は経過音`);
  return parts.join(' ／ ');
}

// ---------- 採点 ----------
// board: 8つの駒（コードID か null）。melody: { notes }。戻り値の steps[k]: そのステップの結果
export function judgeMelody(board, melody, table) {
  const all = stepSegments(melody);
  const steps = [];
  const counts = { chord: 0, tension: 0, passing: 0, unstable: 0, avoid: 0 };
  let total = 0, maxPoints = 0, bonusSteps = 0, scored = 0;
  for (let k = 0; k < NUM_STEPS; k++) {
    const segs = all[k];
    const id = resolveChordAtStep(board, k, table);
    const chord = id === null ? null : table.byId(id);
    if (!segs.length) { steps.push({ step: k, chord: chord ? chord.name : null, hasNotes: false, items: [], score: null, points: 0, bonus: 0, verdict: 'rest', text: 'メロディのお休み', brief: 'メロディのお休み' }); continue; }
    maxPoints += MELODY_SCORE.stepMax;
    if (!chord) {
      steps.push({ step: k, chord: null, hasNotes: true, items: segs.map((s) => ({ ...s, kind: 'none', cat: 'none', label: '', value: 0 })), score: null, points: 0, bonus: 0, verdict: 'missing', text: 'このステップに和音がまだありません', brief: '和音がまだありません' });
      continue;
    }
    scored++;
    const items = segs.map((s) => {
      const j = judgeSegment(chord, s);
      counts[j.kind]++;
      return { ...s, ...j, text: kindText[j.kind](s.name, chord, j) };
    });
    const w = items.reduce((a, s) => a + s.weight, 0);
    const score = items.reduce((a, s) => a + s.value * s.weight, 0) / w;
    const points = Math.round(score * MELODY_SCORE.stepMax);
    // ボーナス: 強い拍に、テンションがあり、濁りのない（avoid・不安定がない）ステップ
    const clean = items.every((s) => s.kind !== 'avoid' && s.kind !== 'unstable');
    const bonus = clean && score >= 0.8 && items.some((s) => s.kind === 'tension' && isStrong(s)) && bonusSteps < MELODY_SCORE.tensionBonusSteps ? MELODY_SCORE.tensionBonus : 0;
    if (bonus) bonusSteps++;
    const worst = items.reduce((m, s) => Math.min(m, s.value), 1);
    const verdict = score >= 0.8 && clean ? (items.some((s) => s.kind === 'tension') ? 'color' : 'perfect') : worst < 0 && score < 0.3 ? 'bad' : worst < 0 ? 'mixed' : 'good';
    steps.push({ step: k, chord: chord.name, symbol: chord.symbol, hasNotes: true, items, score, points, bonus, verdict, text: items.map((s) => s.text).join(' '), brief: briefOf(items) });
    total += points + bonus;
  }
  const sumPoints = steps.reduce((a, s) => a + s.points, 0);
  const bonus = steps.reduce((a, s) => a + s.bonus, 0);
  return { steps, total, sumPoints, bonus, maxPoints, match: maxPoints ? Math.max(0, sumPoints) / maxPoints : 0, scored, notesSteps: steps.filter((s) => s.hasNotes).length, counts };
}

// 評価の短い呼び名（星・画面の記号）
export const VERDICT = {
  color: { mark: '◎', text: 'コードの音・テンションできれいに合っている' },
  perfect: { mark: '◎', text: 'コードの音でぴったり合っている' },
  good: { mark: '○', text: '合っている' },
  mixed: { mark: '△', text: '合っているところとぶつかるところがある' },
  bad: { mark: '×', text: 'ぶつかっている' },
  missing: { mark: '—', text: '和音がまだない' },
  rest: { mark: '', text: 'メロディのお休み' },
};

// 音の種類の、画面の呼び名
export const KIND_TEXT = { chord: 'コードの音', tension: 'テンション', passing: '経過音', unstable: '不安定', avoid: 'アヴォイド', none: '和音なし' };
