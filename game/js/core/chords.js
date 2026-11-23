// コードの表（ファームの src/chords.cpp から作った game/data/chords.json）を、ゲームで使いやすくする。
//   ・駒の「度数」「種類」「ルートの高さ」などから、判定に使う性質を求める
//   ・駒の見た目（形・色）に使う「働き」（トニック系・サブドミナント系・ドミナント系・色づけ）を決める
//     ※ 働きの分け方は、ゲームの見た目のための仮の分け方（駒のデザインは、あなたが決める）
// ブラウザの外（テスト）でも動くように、DOM には触れない。

import { sanitizeChordbook, recordToRaw, uniqueName, CUSTOM_ID_BASE } from './chordbook.js';

export const REPEAT_ID = 99;

// 長音階・自然短音階の音（主音からの半音の数）
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];

// 度数のローマ数字（表示用）。♭ は「Ⅱ♭7」のように、数字のあとに付ける（ファームの表記と同じ）
const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];

export class Chord {
  constructor(raw) {
    Object.assign(this, raw);                 // id, menu, level, name, degree, accidental, type, rootPc, semitones, symbol, notes
    this.isRepeat = raw.type === 'repeat';
    const set = new Set();
    for (const s of raw.semitones) set.add((((raw.rootPc + s) % 12) + 12) % 12);                 // 転回形のように、ルートより下の音（マイナス）があっても、0〜11 にする
    this.pcs = this.isRepeat ? [] : [...set].sort((a, b) => a - b);        // 構成音の高さ（主音からの半音。0〜11）
    // 長音階の外の音の数（＝「色」の濃さ）
    this.colour = this.pcs.filter((p) => !MAJOR.includes(p)).length;
    // 短調の響き: 自然短音階の中の音だけでできていて、長音階の中だけではない（例: Ⅳm7・Ⅴm7・Ⅵ♭M7・Ⅶ♭7・Ⅲ♭M7）
    this.minorFlavor = !this.isRepeat && this.pcs.every((p) => NAT_MINOR.includes(p)) && !this.pcs.every((p) => MAJOR.includes(p));
    this.fn = functionOf(this);
  }
}

// 駒の「働き」（見た目用）。T=トニック系（安定）/ SD=サブドミナント系（広がり）/ D=ドミナント系（緊張）/ X=色づけ・借用・経過
// 自作コード用の種類（dim・aug・sus2・mM7・other）は、働きを決めるときだけ、近い種類として扱う
const FN_TYPE = { mM7: 'min7', dim: 'min', aug: 'maj', sus2: 'sus4' };
function functionOf(c) {
  if (c.isRepeat) return 'R';
  const t = FN_TYPE[c.type] || c.type;
  if (t === 'dom7') return 'D';                                                    // ドミナント7th は、どのルートでも、緊張（Ⅳ7 など、自作コード用。もとの駒は、下の表と同じ結果）
  switch (c.rootPc) {
    case 0: return t === 'dom7' ? 'D' : 'T';                                        // Ⅰ ⅠM7 = T / Ⅰ7 = D（Ⅳへのドミナント）
    case 2: return t === 'dom7' ? 'D' : (t === 'min' || t === 'min7' ? 'SD' : 'X');  // Ⅱm Ⅱm7 = SD / Ⅱ7 = D
    case 4: return t === 'dom7' ? 'D' : 'T';                                        // Ⅲm Ⅲm7 = T / Ⅲ7 = D
    case 5: return t === 'min7' || t === 'min6' || t === 'maj' || t === 'maj7' ? 'SD' : 'X';   // Ⅳ ⅣM7 Ⅳm7 Ⅳm6
    case 7: return (t === 'maj' || t === 'dom7' || t === 'sus47') ? 'D' : 'X';      // Ⅴ Ⅴ7 Ⅴsus47 = D / Ⅴm7 = X
    case 9: return t === 'dom7' ? 'D' : 'T';                                        // Ⅵm Ⅵm7 = T / Ⅵ7 = D
    case 11: return 'D';                                                            // Ⅶm7-5
    case 10: return t === 'dom7' ? 'D' : 'X';                                       // Ⅶ♭7
    case 1: return t === 'dom7' ? 'D' : 'X';                                        // Ⅱ♭7（裏コード）= D / Ⅱ♭M7 = X
    default: return 'X';                                                            // Ⅲ♭M7 Ⅲ♭m6 Ⅳ#m7-5 Ⅴ#dim7 Ⅵ♭M7
  }
}

export class ChordTable {
  // ふだんは、ファームの表から作った、もとの駒だけ（mode 'base'）。フリープレイでは、自作コード・編集したコードを重ねる（mode 'user'。setLayer で内容を渡す）
  constructor(json) {
    this.key = json.key || 'C';
    this.repeatId = json.repeatId;
    this.baseList = json.chords.map((r) => new Chord(r));
    this._baseById = new Map(this.baseList.map((c) => [c.id, c]));
    if (this._baseById.size !== this.baseList.length || new Set(this.baseList.map((c) => c.name)).size !== this.baseList.length) throw new Error('コード表の id か name が重複しています');
    this.layer = { custom: [], edits: {}, nextId: CUSTOM_ID_BASE };      // 自作コード・編集（保存する形。chordbook.js）
    this.mode = 'base';
    this._rebuild();
  }

  // ---- 自作コード・編集した駒（フリープレイだけ）----
  setLayer(data) {
    this.layer = sanitizeChordbook(data, new Set(this.baseList.filter((c) => !c.isRepeat).map((c) => c.id)));
    this._rebuild();
  }
  setMode(mode) { const m = mode === 'user' ? 'user' : 'base'; if (m !== this.mode) { this.mode = m; this._rebuild(); } }

  _rebuild() {
    const user = this.mode === 'user';
    const taken = new Set(this.baseList.map((c) => c.name));
    const list = [];
    this._aliases = new Map();                                            // 編集して名前が変わったもとの駒: もとの名前 → ID（実機の駒・保存ずみのプリセットが、そのまま使えるように）
    for (const c of this.baseList) {
      const rec = user ? this.layer.edits[c.id] : null;
      if (!rec) { list.push(c); continue; }
      const raw = recordToRaw({ ...rec, name: rec.name }, { id: c.id, base: c });
      if (!raw) { list.push(c); continue; }
      taken.delete(c.name);
      raw.name = uniqueName(raw.name, taken); taken.add(raw.name);
      const ch = new Chord(raw);
      list.push(ch);
      if (c.name !== ch.name) this._aliases.set(c.name, c.id);
    }
    if (user) {
      for (const rec of this.layer.custom) {
        const raw = recordToRaw(rec, { id: rec.id });
        if (!raw) continue;
        raw.name = uniqueName(raw.name, taken); taken.add(raw.name);
        list.push(new Chord(raw));
      }
    }
    // 難しさ（Lv.）の順に並べる。Lv が未設定の自作コードは、Lv.5 のあと・「→」の前（安定な並べかえ: 同じ Lv のなかでは、もとの順 → 自作の順）
    const key = (c) => (c.isRepeat ? 6 : (c.level === null || c.level === undefined ? 5.5 : c.level));
    this.list = list.map((c, i) => [c, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map((x) => x[0]);
    this._byId = new Map(this.list.map((c) => [c.id, c]));
    this._byName = new Map(this.list.map((c) => [c.name, c]));
  }

  byId(id) { return this._byId.get(id) || null; }
  byName(name) { return this._byName.get(name) || (this._aliases.has(name) ? this._byId.get(this._aliases.get(name)) : null) || null; }
  baseById(id) { return this._baseById.get(id) || null; }                // もとの駒（編集する前）
  baseByName(name) { return this.baseList.find((c) => c.name === name) || null; }
  get repeat() { return this._byId.get(this.repeatId); }
  pieces() { return this.list.filter((c) => !c.isRepeat); }     // 音を持つ駒（「→」を除く）
  isCustom(id) { const c = this._byId.get(id); return !!c && !!c.custom; }
  isEdited(id) { const c = this._byId.get(id); return !!c && !!c.edited; }
  customChords() { return this.list.filter((c) => c.custom); }
}

export function degreeLabel(pc) {
  // 主音からの半音数 → 「Ⅳ」「♭Ⅱ」のような度数の名前（表示用）
  const flats = { 0: 'Ⅰ', 1: '♭Ⅱ', 2: 'Ⅱ', 3: '♭Ⅲ', 4: 'Ⅲ', 5: 'Ⅳ', 6: '♯Ⅳ', 7: 'Ⅴ', 8: '♭Ⅵ', 9: 'Ⅵ', 10: '♭Ⅶ', 11: 'Ⅶ' };
  return flats[((pc % 12) + 12) % 12];
}

export { ROMAN, MAJOR, NAT_MINOR };
