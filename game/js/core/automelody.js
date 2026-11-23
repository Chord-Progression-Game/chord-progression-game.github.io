// 自動でメロディをつける（できあがったコード進行 → メロディ）。ブラウザの外（テスト）でも動くように、DOM には触れない。
//
// ■ 考え方（ルールで作る。学習モデルではない。同じ種（seed）なら、いつも同じメロディになる）
//   1. リズム: 1ステップ（2拍）ごとの「型」を選んで、フレーズの形（A A' B C）に並べる。
//        1小節目 = A（問い）/ 2小節目 = Aの頭 + ちがう後ろ（答え）/ 3小節目 = B（対比）/ 4小節目 = 終わり（最後の音を長くのばす）
//      小節 = 2つのステップ（盤の2つの場所）
//   2. 音の高さ: 流れの形（山・波・下り・上り・高原）の目標に近づけながら、音を1つずつ選ぶ
//        ・強い拍・長い音には、コードの音と 9th だけを使う（テンションは 9th まで。11th・13th・♭9・♯9 は使わない）
//          9th は、調の音階の中にあるとき（と、ドミナント7th のとき）だけ。数も少なめ
//        ・短くて弱い拍の音は、音階の「経過音」（上と下の音を、順にうめる）・「刺繍音」（となりの音へ行って戻る）。ただし、11th・13th・7th（3和音の上）に聞こえる音は、経過音にも使わない
//        ・動きは、2度の順次進行が中心。5度以上の跳躍のあとは、反対へ戻る。同じ音の連続は少なく
//        ・和音が変わるところは、共通音（同じ音のまま）か、近い音へ。7th は下へ解決。導音（シ）は主音（ド）へ
//        ・2小節目・3小節目の動きは、1小節目とにせる（同じ動き方を、和音にあわせて、くり返す）
//        ・最後は、コードの音で、長く
//   3. tries 通り作って、いちばん良いものを採る。良さ = 和音との相性（core/melody.js の judgeMelody）+ なめらかさ + 山の形 + くり返し + 終わり方 + 輪の継ぎ目
//   和音が置かれていないステップには、音を置かない（お休み）。「→」は、前の和音のつづき。
//   条件・点数の一覧と、ルールの理由は docs/melody_studio.md。
//
// ■ メロディのデータ（core/melody.js と同じ）
//   notes: [[開始のマス, 長さ（マス）, MIDI ノート番号, 音の呼び名], ...]。1ステップ = 8マス（16分音符）、8ステップで 64マス。主音は C（C4 = 60）

import { SLOTS_PER_STEP, NUM_STEPS, LOOP_SLOTS, classifyNote, judgeMelody, noteName, secondChordAt } from './melody.js';
import { resolveChordAtStep } from './voicing.js';
import { MAJOR } from './chords.js';

export const AUTO = {
  lo: 67,                 // 音域の下（G4）
  hi: 89,                 // 音域の上（F6）
  centre: 78,             // 中心（F♯5。流れの形は、ここを中心にする）
  maxNine: 4,             // 9th を使う数の上限（強い拍・長い音の）
  tries: 360,             // 何通り作って、そのなかから選ぶか
  maxLeap: 9,             // 跳躍の上限（半音の数。長6度）。これより大きい動きは作らない
};

// ---------- リズムの型（1ステップ = 8マス）----------
// [開始のマス, 長さ]。マスは16分音符。短くて拍の頭でない音（長さ 2 以下で、開始が 0・4 でない）は「経過音」の役。それ以外は、コードの音（か 9th）
export const CELLS = {
  H: [[0, 8]],                                    // 2分音符
  Q2: [[0, 4], [4, 4]],                           // 4分 4分
  QEE: [[0, 4], [4, 2], [6, 2]],                  // 4分 8分 8分
  EEQ: [[0, 2], [2, 2], [4, 4]],                  // 8分 8分 4分
  DQE: [[0, 6], [6, 2]],                          // 付点4分 8分
  EEEE: [[0, 2], [2, 2], [4, 2], [6, 2]],         // 8分 ×4
  SYN: [[0, 2], [2, 4], [6, 2]],                  // 8分 4分 8分（シンコペーション）
  TRES: [[0, 3], [3, 3], [6, 2]],                 // 3 + 3 + 2（アクセントが、ずれる）
  QRE: [[0, 4], [6, 2]],                          // 4分 8分休み 8分（息つぎ）
};

// 作風。cells = 型の出やすさ / leap = 跳躍をきらう強さ（大きいほど、順次進行）/ tie = 次のステップの頭へ、同じ音をつなぐ（シンコペーション）確率
export const STYLES = {
  lyrical: { id: 'lyrical', name: 'なめらか', hint: 'ゆったり。長めの音が多い', cells: { H: 2, Q2: 3, QEE: 3, DQE: 3, EEQ: 2, SYN: 1 }, leap: 1.0, tie: 0.18, repeat: 0.55, end: { H: 6, DQE: 2, Q2: 2 } },
  groove: { id: 'groove', name: 'リズミカル', hint: '8分音符とシンコペーション', cells: { SYN: 3, TRES: 2, QEE: 2, EEQ: 2, EEEE: 2, QRE: 2, Q2: 1, DQE: 1 }, leap: 0.85, tie: 0.34, repeat: 0.8, end: { H: 4, DQE: 3, Q2: 3 } },
  simple: { id: 'simple', name: 'やさしい', hint: '4分音符が中心。音が少なめ', cells: { H: 3, Q2: 4, DQE: 2, QEE: 1 }, leap: 1.3, tie: 0.08, repeat: 0.25, end: { H: 7, Q2: 2, DQE: 1 } },
};
export const STYLE_IDS = Object.keys(STYLES);

// 流れの形（中心からの半音の数。ステップごと）
const CONTOURS = {
  arch: [0, 2, 4, 2, 3, 5, 2, -1],
  wave: [2, 0, 3, 1, 4, 2, 3, 0],
  descend: [5, 3, 4, 1, 4, 2, 0, -2],
  climb: [-3, -1, 1, 2, 0, 3, 5, 1],
  plateau: [1, 2, 2, 3, 2, 4, 3, 0],
};

// ---------- 道具 ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weighted(rng, entries) {
  let sum = 0;
  for (const [, w] of entries) sum += w;
  let r = rng() * sum;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}
const diatonic = (p) => MAJOR.includes(((p % 12) + 12) % 12);
const isEmptyStep = (s) => !s.chord;

// 音の呼び名（ドレミ）。和音の構成音は、その和音の書き方にそろえる（C7 の 7th は「シ♭」・G♯dim7 は「ソ♯」）。それ以外の音は、和音に ♭ があれば ♭ で・なければ ♯ で書く
const SOLFEGE = { C: 'ド', D: 'レ', E: 'ミ', F: 'ファ', G: 'ソ', A: 'ラ', B: 'シ' };
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const spellCache = new Map();
function chordSpellings(chord) {
  if (spellCache.has(chord.id)) return spellCache.get(chord.id);
  const map = new Map();
  for (const t of String(chord.notes || '').split(/\s+/).filter(Boolean)) {
    const m = /^([A-G])([#♯♭b]?)$/.exec(t);
    if (!m) continue;
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === '♭' || m[2] === 'b' ? -1 : 0;
    const pc = (LETTER_PC[m[1]] + acc + 12) % 12;
    if (!map.has(pc)) map.set(pc, SOLFEGE[m[1]] + (acc === 1 ? '♯' : acc === -1 ? '♭' : ''));
  }
  const entry = { map, flats: String(chord.notes || '').includes('♭') };
  spellCache.set(chord.id, entry);
  return entry;
}
export function spellPitch(pc, chord) {
  pc = ((pc % 12) + 12) % 12;
  if (!chord || chord.isRepeat) return noteName(pc, false);
  const { map, flats } = chordSpellings(chord);
  return map.get(pc) || noteName(pc, flats);
}

// 音の呼び名（4つ目）を、そのステップの和音にあわせてつける。編集した音にも使う。split: 分割したマスの、後半の和音の ID の配列（省いてもよい）。2拍目の頭（4マス目）から後ろの音は、後半の和音で
export function spellNotes(notes, board, table, split = null) {
  return notes.map(([start, len, midi]) => {
    const k = Math.max(0, Math.min(NUM_STEPS - 1, Math.floor(start / SLOTS_PER_STEP)));
    const id = resolveChordAtStep(board, k, table);
    const chord2 = start % SLOTS_PER_STEP >= SLOTS_PER_STEP / 2 ? secondChordAt(split, k, table) : null;
    const chord = chord2 || (id === null ? null : table.byId(id));
    return [start, len, midi, spellPitch(midi, chord)];
  });
}

// 9th が、そのコードで使えるか。コードの上のテンションとして働く（core/melody.js の表）+ 調の音階の中にある + ドミナント7th なら、音階の外でも使える
export function nineOk(chord) {
  if (!chord || chord.isRepeat) return false;
  const pc = (chord.rootPc + 2) % 12;
  const c = classifyNote(chord, pc);
  if (!(c.cat === 'tension' && c.label === '9th')) return false;
  if (MAJOR.includes(pc)) return true;
  return chord.type === 'dom7' && MAJOR.includes(chord.rootPc);
}

// 8つのステップの、和音と、使ってよい音（強い拍・長い音用）。split: 分割したマスの、後半の和音の ID の配列（省いてもよい）。
//   分割したマスの info[k].second に、後半の和音の情報が入る（infoAtSlot が、マスの中の位置で、前半・後半を選ぶ）
export function stepInfo(board, table, tension = true, split = null) {
  const make = (chord, k) => {
    const nine = tension && nineOk(chord) ? (chord.rootPc + 2) % 12 : -1;
    const tones = new Set(chord.pcs);
    const strong = new Set(tones);
    if (nine >= 0) strong.add(nine);
    return { k, chord, tones, strong, nine };
  };
  const info = Array.from({ length: NUM_STEPS }, (_, k) => {
    const id = resolveChordAtStep(board, k, table);
    const chord = id === null ? null : table.byId(id);
    if (!chord || chord.isRepeat) return { k, chord: null, tones: new Set(), strong: new Set(), nine: -1 };
    const first = make(chord, k);
    const c2 = secondChordAt(split, k, table);
    if (c2) first.second = make(c2, k);
    return first;
  });
  info.split = split;
  return info;
}
// マスの中の位置（0〜7）の、和音の情報（分割したマスの後半は、後半の和音）
export const infoAtSlot = (info, k, slotInStep) => (slotInStep >= SLOTS_PER_STEP / 2 && info[k].second ? info[k].second : info[k]);

// ---------- リズムを決める ----------
function pickCells(st, rng) {
  const pool = Object.entries(st.cells);
  const draw = (exclude = []) => weighted(rng, pool.filter(([n]) => !exclude.includes(n)));
  const a1 = draw(), a2 = draw([a1]), c2 = draw([a2]);
  const b1 = rng() < 0.45 ? a1 : draw([a1]), b2 = draw([b1]);
  const end = weighted(rng, Object.entries(st.end));
  return [a1, a2, a1, c2, b1, b2, rng() < 0.5 ? a1 : b1, end];
}

// ---------- 音の動きの費用（小さいほど良い）----------
function intervalCost(ai, leapK) {
  switch (ai) {
    case 0: return 0.9;
    case 1: case 2: return 0;
    case 3: return 0.45;
    case 4: return 0.7;
    case 5: return 1.3 * leapK;
    case 6: return 4.5;
    case 7: return 2.0 * leapK;
    case 8: return 4.0;
    case 9: return 4.8;
    default: return ai <= 12 ? 8 : 30;
  }
}
// コードの音の「役」ごとの好み（ルートからの半音の数）。3度・7度（コードの色を決める音）を、少し好む。9th は、少なめに
function roleCost(chord, pc, nine) {
  if (pc === nine) return 0.55;
  const iv = (((pc - chord.rootPc) % 12) + 12) % 12;
  if (iv === 3 || iv === 4) return -0.45;
  if (iv === 10 || iv === 11) return -0.25;
  if (iv === 7) return 0.1;
  if (iv === 5 && (chord.type === 'sus47' || chord.type === 'sus4')) return -0.1;
  return 0;
}

// 音の高さを選んで、音の一覧を作る（1通り）
function compose(info, st, tension, rng) {
  const cellNames = pickCells(st, rng);
  const events = [];
  for (let k = 0; k < NUM_STEPS; k++) {
    if (isEmptyStep(info[k])) continue;
    CELLS[cellNames[k]].forEach(([s, l], j) => {
      const parts = info[k].second && s < SLOTS_PER_STEP / 2 && s + l > SLOTS_PER_STEP / 2 ? [[s, SLOTS_PER_STEP / 2 - s], [SLOTS_PER_STEP / 2, s + l - SLOTS_PER_STEP / 2]] : [[s, l]];       // 分割したマス: 2拍目の頭をまたぐ音は、前半・後半に分けて、それぞれの和音の音にする
      parts.forEach(([ps, pl], jj) => events.push({ step: k, j: j * 2 + jj, start: k * SLOTS_PER_STEP + ps, len: pl, ornament: pl <= 2 && ps % 4 !== 0, pitch: null, ivl: 0, mirror: null, cell: cellNames[k] }));
    });
  }
  if (!events.length) return null;
  // 2小節目・3小節目などで、同じ型のところは、前の動きをまねる（動き方をそろえる）
  const byStep = Array.from({ length: NUM_STEPS }, () => []);
  for (const ev of events) byStep[ev.step].push(ev);
  for (let k = 2; k < NUM_STEPS; k++) {
    for (const back of [4, 2]) {
      const m = k - back;
      if (m >= 0 && byStep[m].length && cellNames[m] === cellNames[k]) { byStep[k].forEach((ev, j) => { ev.mirror = byStep[m][j] || null; }); break; }
    }
  }
  const names = Object.keys(CONTOURS);
  const contour = CONTOURS[names[Math.floor(rng() * names.length)]];
  const A = contour.map((o) => AUTO.centre + o + Math.round((rng() - 0.5) * 2));
  const target = (ev) => { const a = A[ev.step], b = A[Math.min(NUM_STEPS - 1, ev.step + 1)]; return a + (b - a) * ((ev.start % SLOTS_PER_STEP) / SLOTS_PER_STEP); };

  // 1) 強い拍・長い音（本命の音）
  const lastOfStep = (ev) => byStep[ev.step][byStep[ev.step].length - 1] === ev;
  let prev = null, prev2 = null, prevChord = null, nineCount = 0;
  for (const ev of events) {
    if (ev.ornament) continue;
    const s = infoAtSlot(info, ev.step, ev.start % SLOTS_PER_STEP);
    const phraseEnd = lastOfStep(ev) && (ev.step === 3 || ev.step === 7);
    const finalNote = ev.step === 7 && lastOfStep(ev);
    let best = null, bestCost = Infinity;
    for (let p = AUTO.lo; p <= AUTO.hi; p++) {
      const pc = p % 12;
      if (!s.strong.has(pc)) continue;
      if (pc === s.nine && (phraseEnd || nineCount >= AUTO.maxNine)) continue;        // フレーズの終わりと、使いすぎのときは、9th にしない
      if (finalNote && !s.tones.has(pc)) continue;
      let c = Math.abs(p - target(ev)) * 0.33;
      if (prev !== null) {
        const iv = p - prev, ai = Math.abs(iv);
        if (ai > AUTO.maxLeap) continue;
        c += intervalCost(ai, st.leap);
        if (prev2 !== null) {
          const last = prev - prev2;
          if (Math.abs(last) >= 5) { if (Math.sign(iv) === Math.sign(last) && iv !== 0) c += 2.4; else if (ai <= 2) c -= 0.7; }      // 跳躍のあとは、反対へ戻る
          if (iv === 0 && prev2 === prev) c += 2.5;                                                                                     // 同じ音を、3回続けない
        }
        if (prevChord && prevChord !== s.chord) {                                                                                     // 和音が変わるところ
          const was7th = prevChord.semitones.length >= 4 && ((prev % 12) === (prevChord.rootPc + prevChord.semitones[3]) % 12);
          if (was7th && iv < 0 && ai <= 2) c -= 0.5;                                                                                  // 7th は、下へ解決
          if ((prev % 12) === 11 && iv === 1 && (s.chord.rootPc === 0 || s.chord.rootPc === 9)) c -= 0.8;                             // 導音（シ）は、主音（ド）へ
          if (iv === 0) c -= 0.5;                                                                                                     // 共通音
        }
        if (ev.mirror && ev.mirror.pitch !== null) c += 0.45 * Math.abs(iv - ev.mirror.ivl);                                           // 前の小節と、動き方をそろえる
      }
      c += roleCost(s.chord, pc, s.nine);
      if (p > AUTO.hi - 2 || p < AUTO.lo + 2) c += 1.0;
      if (finalNote && s.chord.fn === 'T') { const iv = (pc - s.chord.rootPc + 12) % 12; if (iv === 0) c -= 1.5; else if (iv === 3 || iv === 4) c -= 0.9; }     // トニックでの終わりは、ルートか3度（ルートのほうが、おさまりがよい）
      c += rng() * 0.9;
      if (c < bestCost) { bestCost = c; best = p; }
    }
    if (best === null) {                                                                                                              // 跳躍の制限で、候補が空になったとき: 制限なしで、いちばん近い音
      let d = Infinity;
      for (let p = AUTO.lo; p <= AUTO.hi; p++) if (s.strong.has(p % 12) && (!finalNote || s.tones.has(p % 12)) && Math.abs(p - (prev === null ? target(ev) : prev)) < d) { d = Math.abs(p - (prev === null ? target(ev) : prev)); best = p; }
    }
    if (best === null) return null;
    ev.pitch = best;
    ev.ivl = prev === null ? 0 : best - prev;
    if (best % 12 === s.nine) nineCount++;
    prev2 = prev; prev = best; prevChord = s.chord;
  }

  // 2) 短くて弱い拍の音（経過音・刺繍音）
  const passingBetween = (a, b) => {
    const dir = Math.sign(b - a);
    if (!dir) return null;
    for (let q = a + dir; q !== b; q += dir) if (diatonic(q)) return q;
    return null;
  };
  const neighbour = (a, up) => { const d = up ? 1 : -1; for (let q = a + d; Math.abs(q - a) <= 2; q += d) if (diatonic(q)) return q; return null; };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.ornament) continue;
    let P = null; for (let j = i - 1; j >= 0; j--) if (events[j].pitch !== null) { P = events[j]; break; }
    let N = null; for (let j = i + 1; j < events.length; j++) if (!events[j].ornament) { N = events[j]; break; }
    let q = null;
    if (P && N && P.pitch !== N.pitch && Math.abs(P.pitch - N.pitch) <= 7) q = passingBetween(P.pitch, N.pitch);             // 経過音（上と下の音を、順にうめる）
    else if (P && N && P.pitch === N.pitch) {                                                                                  // 刺繍音（となりへ行って戻る）
      const up = neighbour(P.pitch, true), down = neighbour(P.pitch, false);
      const sc = infoAtSlot(info, ev.step, ev.start % SLOTS_PER_STEP);
      const bad = (x) => x === null || classifyNote(sc.chord, x % 12).cat === 'avoid';
      q = bad(down) && !bad(up) ? up : bad(up) && !bad(down) ? down : (rng() < 0.55 ? down : up);
    }
    if (q !== null) { const c = classifyNote(infoAtSlot(info, ev.step, ev.start % SLOTS_PER_STEP).chord, q % 12); if (c.cat === 'tension' && (c.label !== '9th' || !tension)) q = null; }         // 経過音でも、9th より上のテンション（11th・13th・7th）に聞こえる音は使わない（9th を使わない設定のときは、9th も）
    if (q !== null && q >= AUTO.lo - 1 && q <= AUTO.hi + 1) { ev.pitch = q; continue; }
    // 置ける音がない: 前の音をくり返す（8分音符の、同じ音の連打は、よくある動き）か、のばす（つながっていないときは、休みのまま）
    if (P && P.start + P.len === ev.start && P.pitch !== null && st.repeat > rng() && !(P.ornament)) { ev.pitch = P.pitch; ev.repeated = true; continue; }
    ev.drop = true;
    if (P && P.start + P.len === ev.start && !P.ornament) P.len += ev.len;
  }

  // 3) 次のステップの頭と、同じ音なら、つなぐ（シンコペーション）
  for (let k = 0; k < NUM_STEPS - 1; k++) {
    const a = byStep[k], b = byStep[k + 1];
    if (!a.length || !b.length) continue;
    const L = a[a.length - 1], F = b[0];
    if (L.ornament || L.drop || F.ornament || F.drop || L.pitch === null || L.pitch !== F.pitch) continue;
    if (L.start % SLOTS_PER_STEP < 4 || L.start + L.len !== F.start) continue;
    if (!infoAtSlot(info, k, L.start % SLOTS_PER_STEP).strong.has(L.pitch % 12) || !info[k + 1].strong.has(F.pitch % 12)) continue;
    if (rng() < st.tie) { L.len += F.len; F.drop = true; F.tied = true; }
  }

  const notes = events.filter((e) => !e.drop && e.pitch !== null).map((e) => [e.start, Math.min(e.len, LOOP_SLOTS - e.start), e.pitch]);
  notes.sort((x, y) => x[0] - y[0] || x[2] - y[2]);
  return { notes, cells: cellNames };
}

// ---------- できばえ（センス）----------
// 良さの点（大きいほど良い）と、画面に出す説明。notes は、呼び名つき（spellNotes 済み）
export function tasteScore(notes, board, table, info, cells = null) {
  const mel = { notes };
  const j = judgeMelody(board, mel, table, info.split || null);
  const seq = notes.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  let stepwise = 0, leaps = 0, big = 0, reps = 0, mids = 0, n = 0;
  for (let i = 1; i < seq.length; i++) {
    const d = Math.abs(seq[i][2] - seq[i - 1][2]);
    n++;
    if (d <= 2) stepwise++;
    if (d >= 5) leaps++;
    if (d >= 5 && d <= 9) mids++;
    if (d >= 8) big++;
    if (d === 0) reps++;
  }
  const stepRatio = n ? stepwise / n : 1, leapRatio = n ? leaps / n : 0;
  let nines = 0;
  for (const [start, , midi] of seq) { const s = infoAtSlot(info, Math.min(NUM_STEPS - 1, Math.floor(start / SLOTS_PER_STEP)), start % SLOTS_PER_STEP); if (s.chord && s.nine >= 0 && midi % 12 === s.nine) nines++; }
  const pcs = new Set(seq.map((x) => x[2] % 12)).size;
  const lo = Math.min(...seq.map((x) => x[2])), hi = Math.max(...seq.map((x) => x[2]));
  const chordSteps = info.filter((s) => s.chord).length || 1;
  const perStep = seq.length / chordSteps;
  const last = seq[seq.length - 1], first = seq[0];
  const lastStep = infoAtSlot(info, Math.min(NUM_STEPS - 1, Math.floor(last[0] / SLOTS_PER_STEP)), last[0] % SLOTS_PER_STEP);
  const endsWell = !!lastStep.chord && lastStep.tones.has(last[2] % 12) && last[1] >= 4;
  const shorts = seq.filter((x) => x[1] <= 2).length;
  const variety = cells ? new Set(cells.filter((_, k) => info[k].chord)).size : 3;
  // 1小節目と3小節目の、動きの向きの似かた
  const dirs = (a, b) => seq.filter((x) => x[0] >= a * SLOTS_PER_STEP && x[0] < b * SLOTS_PER_STEP).map((x, i, arr) => (i ? Math.sign(x[2] - arr[i - 1][2]) : 0)).slice(1);
  const d1 = dirs(0, 2), d3 = dirs(4, 6);
  let same = 0;
  for (let i = 0; i < Math.min(d1.length, d3.length); i++) if (d1[i] === d3[i]) same++;
  const motif = d1.length && d3.length ? same / Math.max(d1.length, d3.length) : 0;
  const seam = Math.abs(first[2] - last[2]);
  // いちばん高い音（山）が、後ろのフレーズ（5〜7番）にあるか。最高音を、何回も使いすぎていないか
  const peakStep = Math.floor(seq.reduce((m, x) => (x[2] > m[2] ? x : m), seq[0])[0] / SLOTS_PER_STEP);
  const peakCount = seq.filter((x) => x[2] === hi).length;
  const heavy = Math.max(...[...new Set(seq.map((x) => x[2]))].map((p) => seq.filter((x) => x[2] === p).length));
  let total = 60 * j.match - 25 * (j.counts.avoid + j.counts.unstable);
  total += 8 * stepRatio - 14 * Math.max(0, leapRatio - 0.2) - 6 * big - 1.5 * Math.max(0, reps - 3) + 1.6 * Math.min(mids, 3);
  total += nines >= 1 && nines <= 3 ? 4 : nines > 4 ? -5 * (nines - 4) : 0;
  total += Math.min(pcs, 7) * 1.5 + (hi - lo >= 8 && hi - lo <= 15 ? 4 : hi - lo > 17 ? -5 : -3);
  total += perStep >= 2.1 && perStep <= 3.6 ? 3 : perStep < 1.7 ? -5 : -2;
  total += (variety >= 3 ? 3 : -5) + (variety >= 4 ? 1.5 : 0) + (shorts >= 3 && shorts <= 12 ? 3 : shorts < 2 ? -4 : 0);
  total += (peakStep >= 4 && peakStep <= 6 ? 3 : 0) - 2 * Math.max(0, peakCount - 2) - 2 * Math.max(0, heavy - 4);
  total += 6 * motif + (endsWell ? (last[1] >= 6 ? 5 : 3) : -6) + (seam <= 5 ? 3 : seam >= 9 ? -4 : 0);
  return { total, match: j.match, tensionNotes: j.counts.tension, avoid: j.counts.avoid, unstable: j.counts.unstable, stepRatio, leapRatio, nines, pcs, range: [lo, hi], notes: seq.length, perStep, motif, endsWell, seam, variety, shorts, peakStep, judge: j };
}

// ---------- 入口 ----------
// board: 8つの駒（コードID か null）。opts: { seed, style: 'lyrical'|'groove'|'simple', tension: 9th を使うか, tries }
// 戻り値: { ok, notes（呼び名つき）, slots: 64, seed, style, tension, score, report }。和音がなければ { ok: false, reason: 'nochord' }
export function generateMelody(board, table, opts = {}) {
  const style = STYLES[opts.style] ? opts.style : 'lyrical';
  const st = STYLES[style];
  const tension = opts.tension !== false;
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : 1;
  const tries = Math.max(1, opts.tries || AUTO.tries);
  const split = Array.isArray(opts.split) ? opts.split : null;                          // 分割したマスの、後半の和音（省くと、マスごとに1つの和音）
  const info = stepInfo(board, table, tension, split);
  if (!info.some((s) => s.chord)) return { ok: false, reason: 'nochord', notes: [], slots: LOOP_SLOTS, seed, style, tension };
  let best = null;
  for (let i = 0; i < tries; i++) {
    const rng = mulberry32((Math.imul(seed, 2654435761) + Math.imul(i + 1, 40503)) >>> 0);
    const cand = compose(info, st, tension, rng);
    if (!cand || !cand.notes.length) continue;
    const notes = spellNotes(cand.notes, board, table, split);
    const sc = tasteScore(notes, board, table, info, cand.cells);
    if (!best || sc.total > best.score) best = { notes, score: sc.total, report: sc, cells: cand.cells };
  }
  if (!best) return { ok: false, reason: 'failed', notes: [], slots: LOOP_SLOTS, seed, style, tension };
  return { ok: true, notes: best.notes, slots: LOOP_SLOTS, seed, style, tension, score: best.score, report: best.report, cells: best.cells };
}

// ---------- 検査（テストと、画面の確認に使う）----------
// 自動でつけたメロディが、決まりを守っているか。守っていないところの一覧（空なら、すべて守っている）
export function checkRules(notes, board, table, { tension = true, split = null } = {}) {
  const bad = [];
  const info = stepInfo(board, table, tension, split);
  const sorted = notes.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  sorted.forEach(([start, len, midi], i) => {
    const where = `${i + 1}つ目（${start}マス・${noteName(midi % 12)}）`;
    if (!Number.isInteger(start) || !Number.isInteger(len) || len < 1 || start < 0 || start + len > LOOP_SLOTS) bad.push(`${where}: 位置か長さがおかしい`);
    if (midi < AUTO.lo - 1 || midi > AUTO.hi + 1) bad.push(`${where}: 音域の外`);
    const ornament = len <= 2 && start % 4 !== 0;
    for (let k = Math.floor(start / SLOTS_PER_STEP); k <= Math.floor((start + len - 1) / SLOTS_PER_STEP); k++) {
      // 分割したマスは、前半（0〜3マス目）・後半（4〜7マス目）に分けて、それぞれの和音で調べる。分割していないマスは、1つの和音
      const spans = info[k].second ? [[k * SLOTS_PER_STEP, info[k]], [k * SLOTS_PER_STEP + SLOTS_PER_STEP / 2, info[k].second]] : [[k * SLOTS_PER_STEP, info[k]]];
      spans.forEach(([a, s], h) => {
        const b = a + (info[k].second ? SLOTS_PER_STEP / 2 : SLOTS_PER_STEP);
        if (!(start < b && start + len > a)) return;
        if (!s.chord) { if (!h) bad.push(`${where}: 和音のないステップ ${k + 1} に音がある`); return; }
        const c = classifyNote(s.chord, midi % 12);
        const halfText = info[k].second ? (h ? '（後半）' : '（前半）') : '';
        if (!ornament) {
          const ok = c.cat === 'chord' || (c.cat === 'tension' && c.label === '9th' && tension);
          if (!ok) bad.push(`${where}: ステップ ${k + 1}${halfText}（${s.chord.name}）の強い拍・長い音が、コードの音でも 9th でもない（${c.cat} ${c.label}）`);
        } else if (c.cat === 'tension' && (c.label !== '9th' || !tension)) {
          bad.push(`${where}: ステップ ${k + 1}${halfText}（${s.chord.name}）の短い音が、9th より上のテンション（${c.label}）に聞こえる`);
        }
      });
    }
    if (i > 0 && sorted[i - 1][0] + sorted[i - 1][1] > start) bad.push(`${where}: 前の音と重なっている`);
    if (i > 0 && Math.abs(midi - sorted[i - 1][2]) > AUTO.maxLeap + 3) bad.push(`${where}: 跳躍が大きすぎる（${Math.abs(midi - sorted[i - 1][2])}半音）`);
  });
  return bad;
}
