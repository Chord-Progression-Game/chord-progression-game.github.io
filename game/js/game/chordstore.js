// 自作コード・編集したコードの、出し入れ（保存・追加・変更・削除・もとにもどす）。画面とゲームが、同じものを見る。DOM には触れない。
//   ・保存先は、ブラウザ（save.chordbook。localStorage）。ゲームを立ち上げ直しても、そのまま残る（右クリックで削除するか、編集画面から削除しない限り）
//   ・性質（種類・ルート・構成音の相対位置）は、保存せず、コード表（chords.js の ChordTable.setLayer）が、読み込むたびに作る
//   ・自作コードは、フリープレイだけで使える（チュートリアル・チャレンジ・メロディのステージは、もとの駒だけ。ChordTable の mode）
import { writeSave } from './save.js';
import { detectChord, makeRecord, normalizeNotes, semitonesOf, sanitizeChordbook, uniqueName, HOME_C, MIN_TONES, MAX_CUSTOM, CUSTOM_ID_BASE } from '../core/chordbook.js';

const sameArray = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class ChordStore {
  constructor(save, table) {
    this.save = save;
    this.table = table;
    this.listeners = [];
    this.save.chordbook = sanitizeChordbook(save.chordbook, new Set(table.baseList.filter((c) => !c.isRepeat).map((c) => c.id)));
    table.setLayer(this.save.chordbook);
  }
  get layer() { return this.save.chordbook; }
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  _commit(change) {
    this.table.setLayer(this.save.chordbook);
    this.save.chordbook = this.table.layer;              // 検査ずみの内容に、そろえる
    writeSave(this.save);
    for (const fn of this.listeners) fn(change);
  }

  // もとの駒・自作の駒の、いまの構成音（MIDI。キー C のときの高さ）。編集画面の、はじめの音
  notesOf(id) {
    const c = this.table.byId(id);
    if (!c || c.isRepeat) return [];
    return c.midi ? c.midi.slice() : [...new Set(c.semitones.map((s) => HOME_C + c.rootPc + s))].sort((a, b) => a - b);
  }

  // 同じルート・同じ構成音の駒が、すでにあるか（selfId の駒は、のぞく）。あれば、その駒
  findSame(notes, rootPc, selfId = null) {
    const semis = semitonesOf(notes, rootPc);
    return this.table.pieces().find((c) => c.id !== selfId && c.rootPc === rootPc && sameArray([...new Set(c.semitones)].sort((a, b) => a - b), [...new Set(semis)].sort((a, b) => a - b))) || null;
  }

  // 新しい自作コードを足す。戻り値: { ok: true, id } / { ok: false, reason: 'few' | 'full' | 'duplicate'（same に、同じ駒） }
  addCustom({ notes, candidate = null, symbol = '', level = null, color = null, shape = 'auto' }) {
    const ns = normalizeNotes(notes);
    if (ns.length < MIN_TONES) return { ok: false, reason: 'few' };
    if (this.layer.custom.length >= MAX_CUSTOM) return { ok: false, reason: 'full' };
    const cand = candidate || detectChord(ns)[0];
    if (!cand) return { ok: false, reason: 'few' };
    const same = this.findSame(ns, cand.rootPc);
    if (same) return { ok: false, reason: 'duplicate', same };
    const taken = new Set(this.table.list.map((c) => c.name));
    const id = Math.max(this.layer.nextId, CUSTOM_ID_BASE);
    const rec = makeRecord({ id, notes: ns, candidate: cand, symbol, level, color, shape, name: uniqueName(cand.name, taken) });
    this.layer.custom.push(rec);
    this.layer.nextId = id + 1;
    this._commit({ type: 'add', id });
    return { ok: true, id };
  }

  // 自作コードを、書きかえる
  updateCustom(id, { notes, candidate = null, symbol = '', level = null, color = null, shape = 'auto' }) {
    const i = this.layer.custom.findIndex((r) => r.id === id);
    if (i < 0) return { ok: false, reason: 'missing' };
    const ns = normalizeNotes(notes);
    if (ns.length < MIN_TONES) return { ok: false, reason: 'few' };
    const cand = candidate || detectChord(ns)[0];
    const same = this.findSame(ns, cand.rootPc, id);
    if (same) return { ok: false, reason: 'duplicate', same };
    const taken = new Set(this.table.list.filter((c) => c.id !== id).map((c) => c.name));
    const old = this.layer.custom[i];
    this.layer.custom[i] = makeRecord({ id, notes: ns, candidate: cand, symbol, level, color, shape, at: old.at, name: uniqueName(cand.name, taken) });
    this._commit({ type: 'update', id });
    return { ok: true, id };
  }

  // もとの駒を、書きかえる（編集）。もとと同じ内容になったら、編集は取りのぞく
  editBase(id, { notes, candidate = null, symbol = '', level = null, color = null, shape = 'auto' }) {
    const base = this.table.baseById(id);
    if (!base || base.isRepeat) return { ok: false, reason: 'missing' };
    const ns = normalizeNotes(notes);
    if (ns.length < MIN_TONES) return { ok: false, reason: 'few' };
    const cand = candidate || detectChord(ns)[0];
    const same = this.findSame(ns, cand.rootPc, id);
    if (same) return { ok: false, reason: 'duplicate', same };
    const taken = new Set(this.table.list.filter((c) => c.id !== id).map((c) => c.name));
    const baseNotes = [...new Set(base.semitones.map((s) => HOME_C + base.rootPc + s))].sort((a, b) => a - b);
    const baseCand = detectChord(baseNotes).find((c) => c.rootPc === base.rootPc);
    const unchanged = sameArray(ns, baseNotes) && cand.rootPc === base.rootPc && (!symbol || symbol === base.symbol) && !color && (!shape || shape === 'auto') && (level === null || level === base.level);
    if (unchanged) { delete this.layer.edits[id]; this._commit({ type: 'reset', id }); return { ok: true, id, reset: true }; }
    const name = cand.rootPc === base.rootPc && baseCand && cand.name === baseCand.name ? base.name : uniqueName(cand.name, taken);
    this.layer.edits[id] = makeRecord({ notes: ns, candidate: cand, symbol: symbol || (baseCand && cand.symbol === baseCand.symbol ? base.symbol : cand.symbol), level: level === null ? base.level : level, color, shape, name });
    this._commit({ type: 'edit', id });
    return { ok: true, id };
  }

  // 編集した駒を、もとにもどす / 自作コードを削除する。戻り値: 消したか
  resetBase(id) { if (!this.layer.edits[id]) return false; delete this.layer.edits[id]; this._commit({ type: 'reset', id }); return true; }
  removeCustom(id) {
    const i = this.layer.custom.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.layer.custom.splice(i, 1);
    this._commit({ type: 'remove', id });
    return true;
  }
}
