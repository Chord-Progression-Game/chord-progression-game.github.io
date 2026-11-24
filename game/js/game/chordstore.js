// 自作コードの、出し入れ（保存・追加・変更・削除）。画面とゲームが、同じものを見る。DOM には触れない。
//   ・もとの駒は、書きかえない。もとの駒を「編集」したときは、新しい自作コードとして足す（2026-11-23 のご指定。以前は、もとの駒を上書きしていた）
//   ・保存先は、ブラウザ（save.chordbook。localStorage）。ゲームを立ち上げ直しても、そのまま残る（右クリックで削除するか、編集画面から削除しない限り）
//   ・性質（種類・ルート・構成音の相対位置）は、保存せず、コード表（chords.js の ChordTable.setLayer）が、読み込むたびに作る
//   ・自作コードは、フリープレイだけで使える（チュートリアル・タイムアタック・チャレンジステージ・メロディのステージは、もとの駒だけ。ChordTable の mode）
import { writeSave } from './save.js';
import { detectChord, makeRecord, normalizeNotes, semitonesOf, sanitizeChordbook, uniqueName, HOME_C, MIN_TONES, MAX_CUSTOM, CUSTOM_ID_BASE } from '../core/chordbook.js';

const sameArray = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// lvRule: 保存してある自作コードの「レベル」の決まりの版。2 = 2026-11-24 夜から（もとの駒をもとにしたコードは、もとの駒と同じ段には入れず、「自作」の段に並べる）
const LEVEL_RULE = 2;

export class ChordStore {
  constructor(save, table) {
    this.save = save;
    this.table = table;
    this.listeners = [];
    this.save.chordbook = sanitizeChordbook(save.chordbook, new Set(table.baseList.filter((c) => !c.isRepeat).map((c) => c.id)));
    this.migrated = this._migrateEdits();
    const ruleBefore = this.save.chordbook.lvRule;
    this.levelsMoved = this._migrateLevels();
    table.setLayer(this.save.chordbook);
    if (this.migrated || this.levelsMoved || ruleBefore !== LEVEL_RULE) writeSave(this.save);
  }

  // 以前の版では、もとの駒をもとにしてつくったコードが、もとの駒と同じレベルの段に入っていた。
  // いまは、「自作」の段に並べる（ご指定）。もとの駒をもとにしたかは、保存からは分からないので、保存してあるレベルを、一度だけ、すべて未設定にする（編集画面で、選びなおせる）。外した数を返す
  _migrateLevels() {
    const lay = this.save.chordbook;
    if ((lay.lvRule || 0) >= LEVEL_RULE) return 0;
    let n = 0;
    for (const r of lay.custom) if (r.level !== null && r.level !== undefined) { r.level = null; n++; }
    lay.lvRule = LEVEL_RULE;
    return n;
  }

  // 以前の版では、もとの駒を編集すると、その駒を上書きしていた（layer.edits）。いまは、もとの駒は書きかえないので、
  // 上書きしてあった内容は、新しい自作コードに引っ越して、もとの駒は、もとの姿にもどす。引っ越した数を返す
  _migrateEdits() {
    const lay = this.save.chordbook;
    const ids = Object.keys(lay.edits || {}).map(Number).sort((a, b) => a - b);
    if (!ids.length) return 0;
    const taken = new Set(this.table.baseList.map((c) => c.name));
    for (const r of lay.custom) taken.add(r.name);
    let n = 0;
    for (const id of ids) {
      const rec = lay.edits[id];
      if (rec && lay.custom.length < MAX_CUSTOM) {
        const raw = { ...rec };
        const sameNotesAsBase = (() => { const b = this.table.baseById(id); return b && sameArray(raw.notes, [...new Set(b.semitones.map((s) => HOME_C + b.rootPc + s))].sort((a, c) => a - c)) && raw.rootPc === b.rootPc; })();
        const dup = lay.custom.some((r) => r.rootPc === raw.rootPc && sameArray(r.notes, raw.notes));
        if (!sameNotesAsBase && !dup) {
          const cid = Math.max(lay.nextId, CUSTOM_ID_BASE);
          raw.id = cid; raw.name = uniqueName(raw.name, taken); taken.add(raw.name);
          raw.level = null;                                                // もとの駒をもとにしたコードは、もとの駒と同じ段には入れない（「自作」の段）
          lay.custom.push(raw); lay.nextId = cid + 1; n++;
        }
      }
    }
    lay.edits = {};
    return n;
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

  // 自作コードを削除する。戻り値: 消したか
  removeCustom(id) {
    const i = this.layer.custom.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.layer.custom.splice(i, 1);
    this._commit({ type: 'remove', id });
    return true;
  }
}
