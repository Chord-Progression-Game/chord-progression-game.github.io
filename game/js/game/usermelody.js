// ユーザーのメロディ（フリープレイで、自動でつけた・自分で書いたメロディ）。画面（ui/melodystudio.js）が編集して、ゲームの音（engine）が鳴らす。
//   ・音は [開始のマス, 長さ（マス）, MIDI ノート番号]。1ステップ = 8マス（16分音符）、8ステップ = 64マス（1周）。主音は C（C4 = 60）
//   ・同じ高さの音が重なったときは、あとから置いた（動かした）ほうを優先して、もう一方を短くする（消えることもある）
//   ・元に戻す・やり直す（100回まで）。ドラッグのように、続けて変わる操作は、まとめて1回（beginEdit → commitEdit）
//   ・保存の形は、[[開始, 長さ, 高さ], ...]。壊れた音は、読み込むときに捨てる（sanitizeNotes）
// DOM には触れない。

import { LOOP_SLOTS } from '../core/melody.js';

export const NOTE_LO = 48;          // 編集できる、いちばん低い音（C3）
export const NOTE_HI = 96;          // いちばん高い音（C7）
export const MAX_NOTES = 160;       // 音の数の上限

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 保存してあった内容（や、プリセットのメロディ）を検査して、きれいにする。戻り値: [[開始, 長さ, 高さ], ...]（開始・高さの順）
export function sanitizeNotes(list, { max = MAX_NOTES, slots = LOOP_SLOTS } = {}) {
  if (!Array.isArray(list)) return [];
  const items = [];
  for (const n of list) {
    if (!Array.isArray(n) || n.length < 3) continue;
    const [s, l, m] = n;
    if (![s, l, m].every(Number.isInteger)) continue;
    if (s < 0 || s >= slots || l < 1 || m < NOTE_LO || m > NOTE_HI) continue;
    items.push({ s, l: Math.min(l, slots - s), m });
  }
  items.sort((a, b) => a.s - b.s || a.m - b.m);
  // 同じ高さで重なる音は、前の音を短くする
  const lastOf = new Map();
  const out = [];
  for (const it of items) {
    const prev = lastOf.get(it.m);
    if (prev && prev.s + prev.l > it.s) { prev.l = it.s - prev.s; if (prev.l < 1) out.splice(out.indexOf(prev), 1); }
    out.push(it); lastOf.set(it.m, it);
  }
  return out.slice(0, max).sort((a, b) => a.s - b.s || a.m - b.m).map((x) => [x.s, x.l, x.m]);
}

export const sameNotes = (a, b) => a.length === b.length && a.every((n, i) => n[0] === b[i][0] && n[1] === b[i][1] && n[2] === b[i][2]);

export class MelodyDoc {
  constructor(notes = []) {
    this._items = [];
    this._nextId = 1;
    this._undo = [];
    this._redo = [];
    this._editStart = null;
    this._listeners = new Set();
    this.version = 0;
    this._setItems(sanitizeNotes(notes));
  }

  // ---------- 見る ----------
  // 画面が使う: 開始・高さの順の、音の一覧。id は、編集しても変わらない（選んだ音の目印）
  get items() { return this._items.slice().sort((a, b) => a.s - b.s || a.m - b.m).map((x) => ({ ...x })); }
  get count() { return this._items.length; }
  item(id) { const it = this._items.find((x) => x.id === id); return it ? { ...it } : null; }
  // [[開始, 長さ, 高さ], ...]（開始・高さの順）。保存・音・採点に使う
  notes() { return this.items.map((x) => [x.s, x.l, x.m]); }
  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  // ---------- 変える ----------
  add(s, l, m) {
    if (this._items.length >= MAX_NOTES) return null;
    const it = this._fit({ id: this._nextId, s, l, m });
    if (!it) return null;
    return this._edit(() => { this._nextId++; this._items.push(it); this._settle(it); return it.id; });
  }
  remove(id) {
    if (!this._items.some((x) => x.id === id)) return false;
    return this._edit(() => { this._items = this._items.filter((x) => x.id !== id); return true; });
  }
  // 開始・長さ・高さのどれかを替える（fields: { s, l, m }。省くと、そのまま）
  set(id, fields) {
    const it = this._items.find((x) => x.id === id);
    if (!it) return false;
    const next = this._fit({ id, s: fields.s ?? it.s, l: fields.l ?? it.l, m: fields.m ?? it.m });
    if (!next || (next.s === it.s && next.l === it.l && next.m === it.m)) return false;
    return this._edit(() => { Object.assign(it, { s: next.s, l: next.l, m: next.m }); this._settle(it); return true; });
  }
  move(id, ds, dm) { const it = this._items.find((x) => x.id === id); return it ? this.set(id, { s: it.s + ds, m: it.m + dm }) : false; }
  clear() { if (!this._items.length) return false; return this._edit(() => { this._items = []; return true; }); }
  // 音を、まるごと入れかえる（自動でつけたメロディ・プリセット・元に戻すなど）
  replaceAll(notes) { return this._edit(() => { this._setItems(sanitizeNotes(notes)); return true; }); }

  // ドラッグのように、続けて変わる操作は、beginEdit() の次から commitEdit() まで、まとめて1回の「元に戻す」になる
  beginEdit() { if (this._editStart === null) this._editStart = this._snapshot(); }
  commitEdit() {
    if (this._editStart === null) return;
    const before = this._editStart; this._editStart = null;
    if (!sameNotes(before, this.notes())) { this._pushUndo(before); this._redo = []; }
    this._emit();
  }

  undo() {
    if (!this._undo.length) return false;
    this._redo.push(this._snapshot());
    this._setItems(this._undo.pop());
    this._emit();
    return true;
  }
  redo() {
    if (!this._redo.length) return false;
    this._undo.push(this._snapshot());
    this._setItems(this._redo.pop());
    this._emit();
    return true;
  }

  // ---------- 中のしくみ ----------
  _snapshot() { return this.notes(); }
  _pushUndo(snap) { this._undo.push(snap); if (this._undo.length > 100) this._undo.shift(); }
  _setItems(notes) { this._items = notes.map(([s, l, m]) => ({ id: this._nextId++, s, l, m })); }
  _fit(it) {
    const s = clamp(Math.round(it.s), 0, LOOP_SLOTS - 1), m = clamp(Math.round(it.m), NOTE_LO, NOTE_HI);
    const l = clamp(Math.round(it.l), 1, LOOP_SLOTS - s);
    return { id: it.id, s, l, m };
  }
  // いま変えた音 it を優先して、同じ高さで重なる音を、短くする（消えることもある）
  _settle(it) {
    for (const o of this._items.slice()) {
      if (o === it || o.m !== it.m) continue;
      if (o.s + o.l <= it.s || it.s + it.l <= o.s) continue;
      if (o.s < it.s) o.l = it.s - o.s;
      else if (o.s + o.l <= it.s + it.l) this._items = this._items.filter((x) => x !== o);
      else { const end = o.s + o.l; o.s = it.s + it.l; o.l = end - o.s; }
    }
  }
  _edit(fn) {
    const before = this._editStart === null ? this._snapshot() : null;
    const r = fn();
    if (before !== null) {
      if (!sameNotes(before, this.notes())) { this._pushUndo(before); this._redo = []; }
      this._emit();
    } else this._emit();                          // ドラッグの途中も、画面は、そのつど更新する（元に戻すの記録だけ、まとめる）
    return r;
  }
  _emit() { this.version++; for (const fn of this._listeners) fn(this); }
}
