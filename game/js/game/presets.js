// プリセット: 自分で気に入った進行の響きを、（一部でも、ぜんぶでも）選んで、名前をつけて保存して、いつでも呼び出す。
//   ・形: { id, name, chords: ['ⅣM7', 'Ⅴ7', null, '→', ...], melody?: [[開始, 長さ, 高さ], ...], at }
//       chords は、盤の、つながった範囲（2〜8つ）。空き（休み）は null、「→」は '→'。範囲の前後の空きは、切り落とす
//       melody（なくてもよい）: その範囲にかかるメロディの音。開始は、範囲の左端（1つ目のコード）からのマス（1ステップ = 8マス）。範囲の外にはみ出す音は切る
//   ・駒は、コードの「名前」（ⅣM7 など）で覚える。キーに依存しない（度数）ので、どの調でも、同じ響き
//   ・保存先は、ブラウザ（save.presets。localStorage）。ゲームの進み具合と同じところ
//   ・呼び出すときは、始める場所（1〜8番）を選ぶ。置く範囲の駒は置きかわる（空きの指定は、空きになる）。メロディつきなら、その範囲のメロディも置きかわる（メロディのないプリセットは、メロディをさわらない）
// DOM には触れない（画面は ui/presetmenu.js）。

import { writeSave } from './save.js';
import { SLOTS_PER_STEP } from '../core/melody.js';
import { sanitizeNotes, sameNotes } from './usermelody.js';

export const MAX_PRESETS = 30;      // 保存できる数
export const MAX_NAME = 20;         // 名前の長さ（文字）
export const NUM_SLOTS = 8;

// ---------- メロディつきのプリセット ----------
// 盤の from〜to（0〜7。両端を含む）にかかるメロディの音を、範囲の左端からの位置にして取り出す。範囲をはみ出す音は切る
export function sliceMelody(notes, from, to) {
  const a = from * SLOTS_PER_STEP, b = (to + 1) * SLOTS_PER_STEP, out = [];
  for (const [s, l, m] of notes || []) { const x = Math.max(s, a), y = Math.min(s + l, b); if (y > x) out.push([x - a, y - x, m]); }
  return out;
}
// 範囲 [a, b)（マス）のメロディを空ける。範囲をまたぐ音は、切る
export function cutNotes(notes, a, b) {
  const out = [];
  for (const [s, l, m] of notes || []) {
    const e = s + l;
    if (e <= a || s >= b) { out.push([s, l, m]); continue; }
    if (s < a) out.push([s, a - s, m]);
    if (e > b) out.push([b, e - b, m]);
  }
  return out;
}
// 呼び出したあとのメロディ: 置いた範囲のメロディを、プリセットのメロディに置きかえる（plan は placementPlan の結果）。メロディのないプリセットは、そのまま
export function applyMelodyPlan(current, plan) {
  if (!plan.melody) return sanitizeNotes(current || []);
  return sanitizeNotes([...cutNotes(current || [], plan.melodyFrom, plan.melodyTo), ...plan.melody]);
}

const clampName = (s) => [...String(s || '').trim()].slice(0, MAX_NAME).join('');
export const sameChords = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// 分割したマス（1つのマスに、前半・後半の2つのコード）の、後半のコードの名前の並び（chords と同じ長さ。分割がなければ、すべて null）。保存の形: preset.half（分割がないプリセットには、付けない）
export const halfOf = (p) => (Array.isArray(p.half) && p.half.length === p.chords.length ? p.half : p.chords.map(() => null));

// 前後の空き（null）を切り落とす
export function trimChords(list) {
  let a = 0, b = list.length;
  while (a < b && list[a] === null) a++;
  while (b > a && list[b - 1] === null) b--;
  return { chords: list.slice(a, b), offset: a };
}

// 盤（board: コードID か null が、8つ）の、from〜to（0〜7。両端を含む）を、プリセットにする。
// 戻り値: { ok: true, preset } / { ok: false, reason: 'range'（範囲が正しくない）| 'few'（駒が2つ未満）| 'duplicate'（同じ進行が、すでにある。existing に、その名前）| 'full'（いっぱい） }
export function makePreset({ name = '', board, split = null, from, to, table, existing = [], now = Date.now(), melody = null }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= NUM_SLOTS || from > to) return { ok: false, reason: 'range' };
  const raw = board.slice(from, to + 1).map((id) => {
    if (id === null || id === undefined) return null;
    const c = table.byId(id);
    return c ? c.name : null;                           // 知らない駒は、空き扱い
  });
  const { chords, offset } = trimChords(raw);
  // 分割したマスの、後半のコード（前半の駒があるマスだけ）
  let half = split ? split.slice(from + offset, from + offset + chords.length).map((id, i) => { const c = id === null || id === undefined || chords[i] === null ? null : table.byId(id); return c && !c.isRepeat ? c.name : null; }) : null;
  if (half && half.every((x) => x === null)) half = null;
  if (chords.filter((x) => x !== null).length + (half ? half.filter((x) => x !== null).length : 0) < 2) return { ok: false, reason: 'few' };
  const rel = melody ? sanitizeNotes(sliceMelody(melody, from + offset, from + offset + chords.length - 1)) : [];
  const dup = existing.find((p) => sameChords(p.chords, chords) && sameChords(halfOf(p), half || chords.map(() => null)) && sameNotes(p.melody || [], rel));
  if (dup) return { ok: false, reason: 'duplicate', existing: dup.name };
  if (existing.length >= MAX_PRESETS) return { ok: false, reason: 'full' };
  const preset = { id: `p${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name: clampName(name) || defaultName(existing), chords, at: now };
  if (rel.length) preset.melody = rel;
  if (half) preset.half = half;
  return { ok: true, preset, from: from + offset, to: from + offset + chords.length - 1 };
}

// 名前を省いたときの名前: プリセット 1、プリセット 2、…（すでにある名前と、重ならない）
export function defaultName(existing) {
  const used = new Set(existing.map((p) => p.name));
  for (let n = existing.length + 1; n < 10000; n++) { const nm = `プリセット ${n}`; if (!used.has(nm)) return nm; }
  return 'プリセット';
}

// ブラウザに保存してあった内容を、検査して、きれいにする（壊れていても、ゲームが動くように）
//   keepUnknown: ふつうは、知らない名前の駒を含むプリセットは、捨てる。ゲームでは true にして、残す（自作コードを削除したあとでも、プリセットを失わない。置くときは、その駒だけ、空きになる）
export function sanitizePresets(list, table, { keepUnknown = false } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.chords)) continue;
    const chords = p.chords.map((x) => (x === null ? null : (typeof x === 'string' && (table.byName(x) || (keepUnknown && x.length > 0 && x.length <= 24)) ? x : undefined)));
    if (chords.length < 2 || chords.length > NUM_SLOTS || chords.includes(undefined)) continue;
    const { chords: trimmed, offset } = trimChords(chords);
    // 分割したマスの、後半のコード（chords と同じ長さの、名前か null の並び。形が合わなければ、分割は、捨てる）
    let half = null;
    if (Array.isArray(p.half) && p.half.length === chords.length && p.half.every((x, i) => x === null || (typeof x === 'string' && chords[i] !== null && (table.byName(x) || (keepUnknown && x.length > 0 && x.length <= 24))))) {
      half = p.half.slice(offset, offset + trimmed.length);
      if (half.every((x) => x === null)) half = null;
    }
    if (trimmed.filter((x) => x !== null).length + (half ? half.filter((x) => x !== null).length : 0) < 2) continue;
    const entry = { id: typeof p.id === 'string' && p.id ? p.id : `p${out.length}x${Math.floor(Math.random() * 1e6).toString(36)}`, name: clampName(p.name) || `プリセット ${out.length + 1}`, chords: trimmed, at: Number.isFinite(p.at) ? p.at : 0 };
    if (half) entry.half = half;
    const melody = Array.isArray(p.melody) ? sanitizeNotes(sliceMelody(sanitizeNotes(p.melody, { slots: NUM_SLOTS * SLOTS_PER_STEP }), offset, offset + trimmed.length - 1)) : [];
    if (melody.length) entry.melody = melody;
    out.push(entry);
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

// 呼び出すときの置き方。start（0〜7）から、駒を並べる。8つの場所に収まらなければ、左へずらす
// 戻り値: { start, end, entries: [{ slot, id（null = 空きにする）, name, second（分割したマスの、後半のコードの ID。なければ null）, secondName }], count（駒の数。後半の駒も）}
export function placementPlan(preset, start, table) {
  const len = preset.chords.length;
  const s = Math.max(0, Math.min(NUM_SLOTS - len, Number.isFinite(start) ? Math.floor(start) : 0));
  const half = halfOf(preset);
  const entries = preset.chords.map((name, i) => {
    const c = name === null ? null : table.byName(name);
    const sname = c ? half[i] : null, c2 = sname === null ? null : table.byName(sname);
    return { slot: s + i, id: c ? c.id : null, name, missing: name !== null && !c, second: c2 && !c2.isRepeat ? c2.id : null, secondName: sname, secondMissing: sname !== null && !c2 };     // 知らない駒（削除した自作コードなど）は、空きにする（missing）。後半の駒が、ないときは、分割しない
  });
  const a = s * SLOTS_PER_STEP;
  return { start: s, end: s + len - 1, entries, count: entries.filter((e) => e.id !== null).length + entries.filter((e) => e.second !== null).length, missing: [...entries.filter((e) => e.missing).map((e) => e.name), ...entries.filter((e) => e.secondMissing).map((e) => e.secondName)],
    melody: preset.melody && preset.melody.length ? preset.melody.map(([x, l, m]) => [x + a, l, m]) : null, melodyFrom: a, melodyTo: (s + len) * SLOTS_PER_STEP };
}

// 保存したプリセットの、出し入れ（save.presets）。画面とゲームが、同じものを見る
export class PresetStore {
  constructor(save, table) {
    this.save = save;
    this.table = table;
    this.save.presets = sanitizePresets(save.presets, table, { keepUnknown: true });
  }
  list() { return this.save.presets; }
  get(id) { return this.save.presets.find((p) => p.id === id) || null; }

  // from〜to を保存する（melody: 盤の上の位置のメロディ [[開始, 長さ, 高さ], ...]。省くと、コードだけ）。makePreset の結果を、そのまま返す（保存できたときだけ、保存する）
  add({ name, board, split = null, from, to, melody = null }) {
    const r = makePreset({ name, board, split, from, to, table: this.table, existing: this.save.presets, melody });
    if (r.ok) { this.save.presets.unshift(r.preset); writeSave(this.save); }       // 新しいものが、上
    return r;
  }
  rename(id, name) {
    const p = this.get(id); const nm = clampName(name);
    if (!p || !nm) return false;
    p.name = nm; writeSave(this.save); return true;
  }
  remove(id) {
    const i = this.save.presets.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.save.presets.splice(i, 1); writeSave(this.save); return true;
  }
}
