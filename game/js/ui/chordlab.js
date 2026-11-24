// コードの編集画面（フリープレイ）。トレイの「＋」・駒の右クリック（長押し）・「コードを編集」ボタンから開く。
//   DTM のピアノロールのように、音を置いて、自分のコードを作る。もとの駒を「編集」したときも、もとの駒は書きかえずに、新しい自作コードとして足す（2026-11-23 のご指定）。
//   ・左: ピアノロール。空いているところをクリック（タップ）で音を置く / 空いているところをドラッグすると、四角でかこんだ音を、まとめて選べる（Shift・Ctrl/⌘ で選びたす・Ctrl/⌘+A で全部。「範囲選択」のボタンを入れると、タップで1つずつ選びたす・はずす。スマホ向き）/
//     音（選んだ音ぜんぶ）をドラッグで上下に動かす / 音をダブルクリック（ダブルタップ）・右クリック・× ・Delete で消す / 鍵盤をクリックで、その音が鳴る
//   ・右: 名前の候補（構成音から自動。例: E G# C D G → Eaug7(♯9)・A C E G B → Am9）/ 自分で名前をつける / レベル（未設定のまま、でもよい）/ 色 / 形 / 見本
//   ・保存すると、盤とトレイの駒が、すぐ変わる。自作コードは、ブラウザに保存されて、次に立ち上げても、そのまま残る
//   画面の部品だけ。名前の判定・保存の形は core/chordbook.js、保存・削除は game/chordstore.js。
import { h, clear } from './dom.js';
import { cardEl } from './hud.js';
import { Chord } from '../core/chords.js';
import { detectChord, recordToRaw, normalizeNotes, SHAPES, SHAPE_NAMES, COLORS, NOTE_LO, NOTE_HI, MAX_TONES, MIN_TONES, MAX_SYMBOL, MAX_CUSTOM } from '../core/chordbook.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteLabel = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;                    // C4 = 真ん中のド
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ROLE_CLASS = (role) => (role === 'R' ? 'root' : role === '3' || role === 'b3' ? 'third' : role === '5' || role === 'b5' || role === '#5' ? 'fifth' : role === '7' || role === 'b7' || role === 'bb7' ? 'seventh' : role === '?' ? 'x' : 'ext');
const ROLE_TEXT = { R: 'ルート', '3': '3度', b3: '短3度', '5': '5度', b5: '♭5', '#5': '♯5', '7': '長7度', b7: '短7度', bb7: '減7度', '6': '6度', '9': '9th', b9: '♭9', '#9': '♯9', '11': '11th', '#11': '♯11', '13': '13th', b13: '♭13', sus4: 'sus4', sus2: 'sus2', '?': '？' };
const ROLE_SHORT = { R: 'R', '3': '3', b3: '♭3', '5': '5', b5: '♭5', '#5': '♯5', '7': '7', b7: '♭7', bb7: '𝄫7', '6': '6', '9': '9', b9: '♭9', '#9': '♯9', '11': '11', '#11': '♯11', '13': '13', b13: '♭13', sus4: '4', sus2: '2', '?': '？' };
const REASONS = {
  few: `音を${MIN_TONES}つ以上、置いてください`,
  full: `自作コードは${MAX_CUSTOM}個までです。いらないものを削除してください`,
  missing: 'このコードは、もうありません',
};
const DOUBLE_MS = 350;

export class ChordLab {
  constructor({ root, table, store, audition = () => {}, onOpen = () => {}, onClose = () => {}, onSaved = () => {} }) {
    Object.assign(this, { root, table, store, audition, onOpen, onClose, onSaved });
    this.isOpen = false;
    this.s = null;
    this.cands = [];
    this.undoStack = []; this.redoStack = [];
    this.rh = 13;
    this.drag = null;
    this.confirming = null;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });          // 外側（暗いところ）をクリックしても、閉じる
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => { if (this.isOpen) this.layout(); });
  }

  // ---------- 開く・閉じる ----------
  openNew(notes = []) {
    this.start({ mode: 'new', id: null, notes: normalizeNotes(notes), symbol: '', touched: false, level: null, color: null, shape: 'auto', title: 'コードをつくる' });
  }
  // 自作コードは、その場で書きかえる。もとの駒は、音と名前をもとにして、新しい自作コードをつくる（もとの駒は、そのまま）
  openEdit(id) {
    const c = this.table.byId(id);
    if (!c || c.isRepeat) return false;
    const notes = this.store.notesOf(id);
    const cands = detectChord(notes, { max: 12 });
    const auto = cands.find((x) => x.rootPc === c.rootPc) || cands[0];
    // もとの駒をもとにしてつくるコードは、もとの駒と同じレベルにはしない（「自作」の段に並べる。2026-11-24 夜のご指定）。自作コードの編集は、いまのレベルのまま
    const common = { notes, symbol: c.symbol, touched: !!auto && c.symbol !== auto.symbol, level: c.custom ? (c.level === undefined ? null : c.level) : null, color: c.color || null, shape: c.shape || 'auto', rootPc: c.rootPc };
    if (c.custom) this.start({ ...common, mode: 'custom', id, title: `自作コードを編集: ${c.symbol}` });
    else this.start({ ...common, mode: 'new', id: null, from: { id: c.id, name: c.name, symbol: c.symbol, level: c.level === undefined ? null : c.level }, title: `「${c.name}（${c.symbol}）」をもとに、自作コードをつくる` });
    return true;
  }
  start(state) {
    if (this.isOpen) this.close(true);
    this.s = { selected: null, sel: new Set(), selKey: null, msg: null, from: null, ...state };
    this.selecting = false;
    this.undoStack = []; this.redoStack = []; this.confirming = null; this.drag = null;
    this.isOpen = true;
    this.build();
    this.root.classList.remove('hidden');
    this.recompute(true);
    this.layout();
    this.scrollToNotes();
    this.onOpen();
  }
  close(silent = false) {
    if (!this.isOpen) return;
    this.isOpen = false; this.drag = null;
    clearTimeout(this._confirmTimer);
    this.root.classList.add('hidden');
    clear(this.root);
    if (!silent) this.onClose();
  }

  // ---------- 状態 ----------
  snapshot() { this.undoStack.push({ notes: this.s.notes.slice() }); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; }
  undo() { const p = this.undoStack.pop(); if (!p) return; this.redoStack.push({ notes: this.s.notes.slice() }); this.s.notes = p.notes; this.s.selected = null; this.s.sel = new Set(); this.recompute(); }
  redo() { const p = this.redoStack.pop(); if (!p) return; this.undoStack.push({ notes: this.s.notes.slice() }); this.s.notes = p.notes; this.s.selected = null; this.s.sel = new Set(); this.recompute(); }

  // 構成音が変わったとき: 名前の候補を作り直す。いま選んでいる読み方（ルート・名前）が、まだ候補にあれば、そのまま
  recompute(first = false) {
    const s = this.s;
    s.notes = normalizeNotes(s.notes);
    const keep = this.cands[s.candIndex || 0];
    this.cands = detectChord(s.notes, { max: 4 });
    let idx = 0;
    if (first && s.rootPc !== undefined) { const i = this.cands.findIndex((c) => c.rootPc === s.rootPc); if (i >= 0) idx = i; }
    else if (keep) { const i = this.cands.findIndex((c) => c.rootPc === keep.rootPc && c.suffix === keep.suffix); if (i >= 0) idx = i; }
    s.candIndex = idx;
    if (!s.touched) s.symbol = this.cands[idx] ? this.cands[idx].symbol : '';
    this.confirming = null;
    this.render();
  }
  cand() { return this.cands[this.s.candIndex] || null; }

  // 保存する内容を、見本の Chord（と、判定用の性質）にする
  previewChord() {
    const c = this.cand();
    if (!c) return null;
    const s = this.s;
    const rec = { notes: s.notes, rootPc: c.rootPc, symbol: (s.symbol || c.symbol).trim() || c.symbol, name: c.name, level: s.level, color: s.color, shape: s.shape };
    const raw = recordToRaw(rec, { id: s.id !== null ? s.id : 0 });
    return raw ? new Chord(raw) : null;
  }

  // ---------- 骨組み ----------
  build() {
    const s = this.s;
    const e = this.el = {};
    const card = h('div', { class: 'card cl-card', role: 'dialog', 'aria-label': s.title });
    e.card = card;
    e.title = h('h3', { id: 'cl-title' }, s.title);
    e.keys = h('div', { class: 'cl-keys' });
    e.rows = h('div', { class: 'cl-rows' });
    e.notes = h('div', { class: 'cl-notes' });
    e.ghost = h('div', { class: 'cl-ghost hidden' });
    e.box = h('div', { class: 'cl-marquee hidden' });
    e.grid = h('div', { class: 'cl-grid' }, e.rows, e.ghost, e.notes, e.box);
    e.body = h('div', { class: 'cl-body' }, e.keys, e.grid);
    e.scroll = h('div', { class: 'cl-scroll' }, e.body);
    e.hint = h('div', { class: 'cl-hint' }, '空いているところをクリックで音を置きます。空いているところをドラッグすると、四角でかこんだ音を、まとめて選べます（Shift で選びたす）。音をドラッグで上下に動かせます（選んだ音ぜんぶ）。ダブルクリックか × で消します。');
    e.undo = h('button', { class: 'chip', id: 'cl-undo', title: '元に戻す（Ctrl/⌘ + Z）', onclick: () => this.undo() }, '↶ 戻す');
    e.redo = h('button', { class: 'chip', id: 'cl-redo', title: 'やり直す（Ctrl/⌘ + Shift + Z）', onclick: () => this.redo() }, '↷ やり直す');
    e.del = h('button', { class: 'chip', id: 'cl-del', title: '選んだ音を消す（Delete）', onclick: () => this.removeSelected() }, '選んだ音を消す');
    e.selmode = h('button', { class: 'chip toggle', id: 'cl-selmode', title: '入れると、タップ（クリック）で、音を選びたす・はずす。空いているところをドラッグすると、四角でかこんで、まとめて選べる（入れなくても、パソコンでは、ドラッグで選べる）', onclick: () => { this.selecting = !this.selecting; this.renderRoll(); } }, h('span', { class: 'dot' }), '範囲選択 ', h('b', {}, 'OFF'));
    e.clear = h('button', { class: 'chip', id: 'cl-clear', onclick: () => { if (this.s.notes.length) { this.snapshot(); this.s.notes = []; this.s.selected = null; this.recompute(); } } }, '音を全部消す');
    e.play = h('button', { class: 'chip primary', id: 'cl-play', title: '和音を鳴らす（Space）', onclick: () => this.play(false) }, '▶ 和音で聴く');
    e.arp = h('button', { class: 'chip', id: 'cl-arp', onclick: () => this.play(true) }, 'ばらして聴く');
    e.cands = h('div', { class: 'cl-cands', id: 'cl-cands' });
    e.symbol = h('input', { class: 'pm-name', id: 'cl-symbol', type: 'text', maxlength: String(MAX_SYMBOL), placeholder: 'コード名（構成音から、自動で入ります）', 'aria-label': 'コード名' });
    e.symbol.addEventListener('input', () => { s.symbol = e.symbol.value; s.touched = true; this.renderPanel(); });
    e.symbol.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); this.save(); } ev.stopPropagation(); });
    e.auto = h('button', { class: 'chip', id: 'cl-auto', title: '構成音から決まる名前にもどす', onclick: () => { s.touched = false; this.recompute(); } }, '自動にする');
    e.degree = h('div', { class: 'cl-degree', id: 'cl-degree' });
    e.levels = h('div', { class: 'cl-levels', id: 'cl-levels' });
    e.colors = h('div', { class: 'cl-colors', id: 'cl-colors' });
    e.shapes = h('div', { class: 'cl-shapes', id: 'cl-shapes' });
    e.preview = h('div', { class: 'cl-preview', id: 'cl-preview' });
    e.info = h('div', { class: 'cl-info', id: 'cl-info' });
    e.msg = h('div', { class: 'pm-msg cl-msg', id: 'cl-msg' });
    e.save = h('button', { class: 'chip primary', id: 'cl-save', onclick: () => this.save() }, s.mode === 'new' ? 'コードを追加する' : '保存する');
    e.reset = h('button', { class: 'chip danger', id: 'cl-reset', onclick: () => this.confirmable('reset', () => this.resetOrDelete()) }, 'このコードを削除');
    e.close = h('button', { class: 'chip', id: 'cl-close', onclick: () => this.close() }, '閉じる');
    const side = h('div', { class: 'cl-side' },
      h('section', { class: 'cl-sec cl-previewsec' }, h('h4', {}, '見本', h('small', {}, '盤・トレイでの見え方')), h('div', { class: 'cl-prevrow' }, e.preview, e.info)),
      h('section', { class: 'cl-sec' }, h('h4', {}, '名前の候補', h('small', {}, '構成音から、自動で')), e.cands),
      h('section', { class: 'cl-sec' }, h('h4', {}, 'コード名', h('small', {}, '自分でつけてもよい')), h('div', { class: 'cl-namerow' }, e.symbol, e.auto), e.degree),
      h('section', { class: 'cl-sec' }, h('h4', {}, 'レベル', h('small', {}, '決めなくてもよい')), e.levels),
      h('section', { class: 'cl-sec' }, h('h4', {}, '駒の色'), e.colors),
      h('section', { class: 'cl-sec' }, h('h4', {}, '駒の形'), e.shapes));
    card.append(...[
      h('div', { class: 'pm-head' }, e.title, h('button', { class: 'chip', id: 'cl-close-top', onclick: () => this.close() }, '閉じる')),
      s.from ? h('p', { class: 'cl-fromnote', id: 'cl-fromnote' }, 'もとのコードは、そのままです。音を変えて「コードを追加する」を押すと、新しい自作コードとして足されます。') : null,         // null は、そのまま append すると「null」という文字になる。取りのぞく
      h('div', { class: 'cl-main' },
        h('div', { class: 'cl-left' },
          h('div', { class: 'cl-tools' }, e.play, e.arp, e.undo, e.redo, e.selmode, e.del, e.clear),
          e.scroll, e.hint),
        side),
      h('div', { class: 'cl-foot' }, e.msg, h('div', { class: 'cl-btns' }, e.reset, e.save, e.close))].filter(Boolean));
    clear(this.root).append(card);
    this.buildKeys();
    this.attachGrid();
    if (s.mode === 'new') e.reset.classList.add('hidden');
  }

  layout() {
    const e = this.el;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
    this.rh = Math.max(12, Math.round(rem * 1.0));
    const rows = NOTE_HI - NOTE_LO + 1;
    e.body.style.height = `${this.rh * rows}px`;
    e.card.style.setProperty('--rh', `${this.rh}px`);
    this.render();
  }
  scrollToNotes() {
    const e = this.el, ns = this.s.notes;
    const mid = ns.length ? Math.round(ns.reduce((a, x) => a + x, 0) / ns.length) : 58;
    e.scroll.scrollTop = Math.max(0, (NOTE_HI - mid) * this.rh - e.scroll.clientHeight / 2);
  }

  buildKeys() {
    const box = clear(this.el.keys);
    for (let m = NOTE_HI; m >= NOTE_LO; m--) {
      const black = BLACK.has(m % 12);
      box.append(h('div', { class: `cl-key${black ? ' black' : ''}${m % 12 === 0 ? ' c' : ''}`, dataset: { midi: String(m) }, title: noteLabel(m), onpointerdown: (ev) => { ev.preventDefault(); this.audition([m], { duration: 0.6 }); } }, m % 12 === 0 ? noteLabel(m) : ''));
    }
  }

  // ---------- 描く ----------
  render() { if (!this.isOpen) return; this.renderRoll(); this.renderPanel(); }

  renderRoll() {
    const e = this.el, s = this.s;
    const rows = clear(e.rows);
    for (let m = NOTE_HI; m >= NOTE_LO; m--) rows.append(h('div', { class: `cl-row${BLACK.has(m % 12) ? ' black' : ''}${m % 12 === 0 ? ' c' : ''}`, style: { top: `${(NOTE_HI - m) * this.rh}px`, height: `${this.rh}px` } }));
    const cand = this.cand();
    const role = new Map((cand ? cand.tones : []).map((t) => [t.midi, t]));
    const box = clear(e.notes);
    for (const m of s.notes) {
      const t = role.get(m);
      const sel = s.sel.has(m);
      box.append(h('div', { class: `cl-note k-${t ? ROLE_CLASS(t.role) : 'x'}${sel ? ' sel' : ''}`, dataset: { midi: String(m) }, title: `${noteLabel(m)}${t ? `（${ROLE_TEXT[t.role] || ''}）` : ''}`,
        style: { top: `${(NOTE_HI - m) * this.rh}px`, height: `${this.rh - 1}px` } },
        h('span', { class: 'cl-nlabel' }, t ? t.spelled : NAMES[m % 12], h('small', {}, `${Math.floor(m / 12) - 1}`)),
        h('span', { class: 'cl-nrole' }, t ? ROLE_SHORT[t.role] || '' : ''),
        sel && s.sel.size === 1 ? h('i', { class: 'cl-x', title: 'この音を消す', onpointerdown: (ev) => { ev.preventDefault(); ev.stopPropagation(); this.removeNote(m); } }, '×') : null));
    }
    e.undo.disabled = !this.undoStack.length; e.redo.disabled = !this.redoStack.length;
    e.del.disabled = !s.sel.size; e.clear.disabled = !s.notes.length;
    e.selmode.classList.toggle('on', this.selecting); e.selmode.querySelector('b').textContent = this.selecting ? 'ON' : 'OFF';
    e.grid.classList.toggle('selecting', this.selecting);
    e.play.disabled = e.arp.disabled = !s.notes.length;
  }

  renderPanel() {
    const e = this.el, s = this.s;
    const cand = this.cand();
    // 名前の候補
    const box = clear(e.cands);
    if (!this.cands.length) box.append(h('div', { class: 'cl-none' }, s.notes.length ? `音を${MIN_TONES}つ以上、置くと、名前の候補が出ます` : 'ピアノロールに音を置くと、名前の候補が出ます'));
    this.cands.forEach((c, i) => box.append(h('button', { class: `cl-cand${i === s.candIndex ? ' on' : ''}`, type: 'button', dataset: { index: String(i) }, title: `ルート: ${c.slash ? c.symbol.split('/')[0] : c.symbol}`, onclick: () => { s.candIndex = i; if (!s.touched) s.symbol = c.symbol; this.render(); } },
      h('b', {}, c.symbol), h('small', {}, `${c.name}${i === 0 ? '（いちばん自然な読み方）' : ''}`))));
    // コード名
    if (document.activeElement !== e.symbol) e.symbol.value = s.symbol || '';
    e.auto.disabled = !s.touched;
    e.degree.textContent = cand ? `度数の名前: ${cand.name}（盤の上・技の名前に出ます）／ 構成音: ${cand.notesText}` : '';
    // レベル
    const lv = clear(e.levels);
    [null, 1, 2, 3, 4, 5].forEach((n) => lv.append(h('button', { class: `chip seg${s.level === n ? ' on' : ''}`, type: 'button', dataset: { level: n === null ? '' : String(n) },
      title: n === null ? 'レベルを決めない（Lv.5 のあとの「自作」の段に並びます）' : `Lv.${n} の段に入ります`, onclick: () => { s.level = n; this.renderPanel(); } }, n === null ? '未設定' : `Lv.${n}`)));
    lv.append(h('small', { class: 'cl-lvnote' }, s.level === null ? `いまは「自作」の段（Lv.5 の右）${s.from && s.from.level ? `。もとの駒は Lv.${s.from.level} ですが、同じ段には入れません` : ''}` : '高いレベルのコードを使うと「コードの難しさ」の加点がつきます'));
    // 色
    const cb = clear(e.colors);
    cb.append(h('button', { class: `cl-sw auto${s.color === null ? ' on' : ''}`, type: 'button', title: '働きの色（トニック系=黄・広がり=青・緊張=赤・色づけ=紫）', onclick: () => { s.color = null; this.renderPanel(); } }, '自動'));
    COLORS.forEach((c) => cb.append(h('button', { class: `cl-sw${s.color === c ? ' on' : ''}`, type: 'button', style: { '--c': c }, title: c, onclick: () => { s.color = c; this.renderPanel(); } })));
    const custom = h('input', { class: 'cl-colorin', type: 'color', value: s.color || '#e9b93f', title: '好きな色', 'aria-label': '好きな色' });
    custom.addEventListener('input', () => { s.color = custom.value; this.renderPanel(); });
    cb.append(custom);
    // 形
    const sb = clear(e.shapes);
    SHAPES.forEach((k) => sb.append(h('button', { class: `cl-shape${s.shape === k ? ' on' : ''}`, type: 'button', dataset: { shape: k }, title: SHAPE_NAMES[k], onclick: () => { s.shape = k; this.renderPanel(); } },
      h('i', { class: 'ic', dataset: { shape: k === 'auto' ? '' : k } }), h('span', {}, SHAPE_NAMES[k]))));
    // 見本
    const pc = this.previewChord();
    clear(e.preview);
    if (pc) {
      e.preview.append(cardEl(pc));
      const fnName = { T: 'トニック系（安定）', SD: 'サブドミナント系（広がり）', D: 'ドミナント系（緊張）', X: '色づけ・借用', R: '' }[pc.fn] || '';
      e.info.textContent = `判定では「${pc.type}」・働きは「${fnName}」として扱います。${pc.level === null ? '' : ` Lv.${pc.level}`}`;
    } else { e.preview.append(h('div', { class: 'cl-none' }, '音を置くと、見本が出ます')); e.info.textContent = ''; }
    e.msg.textContent = s.msg ? s.msg.text : '';
    e.msg.className = `pm-msg cl-msg${s.msg ? ` ${s.msg.kind}` : ''}`;
    e.save.disabled = !cand || s.notes.length < MIN_TONES;
  }

  // ---------- 音の編集 ----------
  // 選んでいる音を、list にする（primary: いちばん新しく選んだ音）
  setSel(list, primary = null) {
    const s = this.s;
    s.sel = new Set(list);
    s.selected = s.sel.size ? (primary !== null && s.sel.has(primary) ? primary : [...s.sel].pop()) : null;
    this.renderRoll();
  }
  select(m) { this.setSel(m === null || m === undefined ? [] : [m], m); }
  selectAll() { this.setSel(this.s.notes); }
  addNote(m) {
    const s = this.s;
    if (s.notes.includes(m)) { this.select(m); return false; }
    if (s.notes.length >= MAX_TONES) { s.msg = { text: `1つのコードに置ける音は${MAX_TONES}つまでです`, kind: 'warn' }; this.renderPanel(); return false; }
    this.snapshot();
    s.notes = [...s.notes, m].sort((a, b) => a - b); s.sel = new Set([m]); s.selected = m; s.msg = null;
    this.recompute();
    this.audition([m], { duration: 0.6 });
    return true;
  }
  removeNote(m) {
    const s = this.s;
    if (m === null || m === undefined || !s.notes.includes(m)) return;
    this.snapshot();
    s.notes = s.notes.filter((x) => x !== m); s.sel.delete(m); if (s.selected === m) s.selected = s.sel.size ? [...s.sel].pop() : null; s.msg = null;
    this.recompute();
  }
  // 選んでいる音を、ぜんぶ消す
  removeSelected() {
    const s = this.s;
    if (!s.sel.size) return;
    this.snapshot();
    const set = s.sel;
    s.notes = s.notes.filter((x) => !set.has(x)); s.sel = new Set(); s.selected = null; s.msg = null;
    this.recompute();
  }
  moveNote(from, to) {
    const s = this.s;
    if (to === from || to < NOTE_LO || to > NOTE_HI || s.notes.includes(to)) return false;
    s.notes = s.notes.map((x) => (x === from ? to : x)).sort((a, b) => a - b);
    if (s.sel.has(from)) { s.sel.delete(from); s.sel.add(to); }
    if (s.selected === from) s.selected = to;
    this.recompute();
    return true;
  }
  // 選んでいる音ぜんぶ（いまの高さ: from）を、dm 半音、まとめて動かす。範囲の外・選んでいない音と重なるときは、動かさない（false）
  shiftNotes(from, dm) {
    const s = this.s;
    const moved = from.map((m) => m + dm);
    if (moved.some((m) => m < NOTE_LO || m > NOTE_HI)) return false;
    const rest = s.notes.filter((m) => !s.sel.has(m));
    if (moved.some((m) => rest.includes(m))) return false;
    s.notes = [...rest, ...moved].sort((a, b) => a - b);
    s.sel = new Set(moved); if (s.selected !== null) s.selected += dm;
    this.recompute();
    return true;
  }
  play(arpeggio) { const ns = this.s.notes; if (ns.length) this.audition(ns, { arpeggio, duration: arpeggio ? 1.6 : 1.4 }); }

  pointToMidi(ev) {
    const r = this.el.grid.getBoundingClientRect();
    return clamp(NOTE_HI - Math.floor((ev.clientY - r.top) / this.rh), NOTE_LO, NOTE_HI);
  }

  // 四角でかこむ（ドラッグの途中）: 四角にふれた音を選ぶ（Shift・Ctrl/⌘・「範囲選択」のモードなら、もとの選びに足す）
  updateMarquee(ev, d) {
    const s = this.s;
    const r = this.el.grid.getBoundingClientRect();
    const x1 = clamp(ev.clientX - r.left, 0, r.width), y1 = clamp(ev.clientY - r.top, 0, r.height);
    const x0 = clamp(d.x0 - r.left, 0, r.width), y0 = clamp(d.y0 - r.top, 0, r.height);
    const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
    const b = this.el.box;
    b.classList.remove('hidden');
    b.style.left = `${L}px`; b.style.top = `${T}px`; b.style.width = `${W}px`; b.style.height = `${H}px`;
    const hit = s.notes.filter((m) => { const nt = (NOTE_HI - m) * this.rh; return nt < T + H && nt + this.rh > T && r.width * 0.06 < L + W && r.width * 0.94 > L; });
    s.sel = new Set([...d.base, ...hit]);
    s.selected = hit.length ? hit[hit.length - 1] : (s.sel.size ? [...s.sel].pop() : null);
    for (const el of this.el.notes.children) el.classList.toggle('sel', s.sel.has(Number(el.dataset.midi)));
  }

  attachGrid() {
    const g = this.el.grid;
    g.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const n = ev.target.closest && ev.target.closest('.cl-note');
      if (!n) return;
      const m = Number(n.dataset.midi);
      if (this.s.sel.has(m) && this.s.sel.size > 1) this.removeSelected(); else this.removeNote(m);
    });
    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const noteEl = ev.target.closest && ev.target.closest('.cl-note');
      if (ev.target.closest && ev.target.closest('.cl-x')) return;
      const m = this.pointToMidi(ev);
      const s = this.s;
      const modifier = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      const additive = modifier || this.selecting;                                         // 選びたす（Shift・Ctrl/⌘・「範囲選択」のモード）
      if (noteEl) {                                                              // 音: 選ぶ・ドラッグで（選んだ音ぜんぶを）動かす
        const nm = Number(noteEl.dataset.midi);
        ev.preventDefault();
        g.setPointerCapture(ev.pointerId);
        if (additive) {
          if (s.sel.has(nm)) { s.sel.delete(nm); s.selected = s.sel.size ? [...s.sel].pop() : null; this.drag = { mode: 'none' }; this.renderRoll(); return; }
          s.sel.add(nm); s.selected = nm;
        } else if (!s.sel.has(nm)) { s.sel = new Set([nm]); s.selected = nm; }
        else s.selected = nm;                                                    // すでに選んでいる音: 選びなおさない（まとめて動かすため）
        this.snapshot();
        this.drag = { mode: 'move', from: [...s.sel].sort((a, b) => a - b), primary0: nm, y0: ev.clientY, moved: false, pointerId: ev.pointerId, additive, lastDm: 0 };
        this.audition([nm], { duration: 0.6 });
        this.renderRoll();
      } else if (ev.pointerType === 'touch' && !this.selecting) {                // 指（ふつうのモード）: タップ（動かさずに離す）で置く。縦になぞるときは、スクロール
        this.tap = { x: ev.clientX, y: ev.clientY, m, t: performance.now() };
      } else {                                                                    // マウス・ペン・「範囲選択」のモードの指: ドラッグで範囲選択 / 動かさずに離せば、音を置く（モードが ON なら、選びなおし）
        ev.preventDefault();
        g.setPointerCapture(ev.pointerId);
        this.drag = { mode: 'pending', x0: ev.clientX, y0: ev.clientY, m, additive, modifier, base: additive ? new Set(s.sel) : new Set(), pointerId: ev.pointerId, moved: false };
      }
    });
    g.addEventListener('pointermove', (ev) => {
      const d = this.drag;
      if (!d) { this.showGhost(ev); return; }
      if (d.mode === 'none') return;
      if (d.mode === 'pending') {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return;       // 動いていない: まだ、クリック（音を置く）かもしれない
        d.mode = 'marquee'; d.moved = true;
        this.el.ghost.classList.add('hidden');
      }
      if (d.mode === 'marquee') { this.updateMarquee(ev, d); return; }
      const want = -Math.round((ev.clientY - d.y0) / this.rh);                    // 動かしたい半音の数（ドラッグを始めた高さから）
      if (want === d.lastDm) return;
      for (let k = want; k !== d.lastDm; k += k > d.lastDm ? -1 : 1) {            // 行き止まり（範囲の外・選んでいないほかの音）なら、動かせるところまで
        if (this.shiftNotes(d.from.map((m) => m + d.lastDm), k - d.lastDm)) {
          d.lastDm = k; d.moved = true;
          this.s.selected = d.primary0 + k;
          this.audition([d.primary0 + k], { duration: 0.4 });
          break;
        }
      }
    });
    const up = (ev) => {
      const d = this.drag;
      if (d) {
        this.drag = null;
        if (d.mode === 'none') return;
        if (d.mode === 'pending') {                                              // 動かさずに離した
          if (this.selecting) { if (!d.modifier) this.setSel([]); }              // 「範囲選択」のモード: 空きのタップは、選びなおし（音は、置かない）
          else if (!d.modifier) this.addNote(d.m);                                // ふつう: そこに音を置く（Shift・Ctrl/⌘ を押していれば、置かない）
          return;
        }
        if (d.mode === 'marquee') { this.el.box.classList.add('hidden'); this.renderRoll(); return; }
        if (!d.moved) {                                                          // 動かさずに離した: 音を、ダブルクリック（ダブルタップ）で消す
          this.undoStack.pop();                                                  // 動かしていないので、戻す操作に積まない
          if (!d.additive && d.from.length > 1) { this.setSel([d.primary0], d.primary0); return; }        // 選んだ音を、動かさずに、クリックだけ: その1つだけの選びに
          const now = performance.now();
          if (this._lastTap && this._lastTap.m === this.s.selected && now - this._lastTap.t < DOUBLE_MS) { this._lastTap = null; this.removeNote(this.s.selected); return; }
          this._lastTap = { m: this.s.selected, t: now };
        } else this._lastTap = null;
        this.renderRoll();
        return;
      }
      if (this.tap) {
        const t = this.tap; this.tap = null;
        if (ev.type === 'pointerup' && Math.hypot(ev.clientX - t.x, ev.clientY - t.y) < 8 && performance.now() - t.t < 600) this.addNote(t.m);
      }
    };
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', () => { const d = this.drag; this.drag = null; this.tap = null; if (d && d.mode === 'marquee') this.el.box.classList.add('hidden'); if (d && d.mode === 'move' && !d.moved) this.undoStack.pop(); });
    g.addEventListener('pointerleave', () => this.el.ghost.classList.add('hidden'));
  }
  showGhost(ev) {
    const gh = this.el.ghost;
    if (this.selecting || ev.pointerType === 'touch' || !ev.target.closest || ev.target.closest('.cl-note')) { gh.classList.add('hidden'); return; }
    const m = this.pointToMidi(ev);
    gh.classList.remove('hidden');
    gh.style.top = `${(NOTE_HI - m) * this.rh}px`; gh.style.height = `${this.rh - 1}px`;
    gh.textContent = noteLabel(m);
  }

  // ---------- キーボード ----------
  onKey(ev) {
    if (!this.isOpen) return;
    const tag = ev.target && ev.target.tagName;
    const typing = tag === 'INPUT' && ev.target.type === 'text';
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Escape') { if (typing) { ev.target.blur(); ev.preventDefault(); return; } ev.preventDefault(); if (this.s.sel.size) this.setSel([]); else this.close(); return; }
    if (typing) return;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); this.redo(); return; }
    if (mod && (ev.key === 'a' || ev.key === 'A')) { ev.preventDefault(); this.selectAll(); return; }
    if (ev.key === ' ' && tag !== 'BUTTON') { ev.preventDefault(); if (!ev.repeat) this.play(false); return; }
    const s = this.s;
    if (!s.sel.size) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.removeSelected(); return; }
    const d = { ArrowUp: ev.shiftKey ? 12 : 1, ArrowDown: ev.shiftKey ? -12 : -1 }[ev.key];
    if (d) {
      ev.preventDefault();
      this.snapshot();
      const from = [...s.sel].sort((a, b) => a - b);
      if (this.shiftNotes(from, d)) this.audition([s.selected], { duration: 0.4 }); else this.undoStack.pop();
    }
  }

  // ---------- 保存・削除 ----------
  // 削除・もとにもどすは、2回押して実行（まちがって消さないように）
  confirmable(key, fn) {
    if (this.confirming === key) { clearTimeout(this._confirmTimer); this.confirming = null; this.el.reset.textContent = 'このコードを削除'; fn(); return; }
    this.confirming = key;
    this.el.reset.textContent = 'もう一度押すと実行';
    clearTimeout(this._confirmTimer);
    this._confirmTimer = setTimeout(() => { if (this.isOpen && this.confirming === key) { this.confirming = null; this.el.reset.textContent = 'このコードを削除'; } }, 3000);
  }
  resetOrDelete() {
    const s = this.s;
    if (s.mode !== 'custom') return;
    if (this.store.removeCustom(s.id)) { const id = s.id; this.close(true); this.onSaved({ type: 'remove', id }); this.onClose(); }
  }
  save() {
    const s = this.s, cand = this.cand();
    if (!cand || s.notes.length < MIN_TONES) { s.msg = { text: REASONS.few, kind: 'warn' }; this.renderPanel(); return; }
    const symbol = (s.symbol || '').trim();
    const args = { notes: s.notes, candidate: cand, symbol: symbol && symbol !== cand.symbol ? symbol : '', level: s.level, color: s.color, shape: s.shape };
    if (s.touched && symbol) args.symbol = symbol;
    const r = s.mode === 'new' ? this.store.addCustom(args) : this.store.updateCustom(s.id, args);
    if (!r.ok) {
      const fromSame = r.reason === 'duplicate' && s.from && r.same.id === s.from.id;
      s.msg = { text: fromSame ? `もとのコード「${r.same.name}（${r.same.symbol}）」と、同じ構成音です。音を変えてから、追加してください` : r.reason === 'duplicate' ? `同じ構成音のコード「${r.same.name}（${r.same.symbol}）」が、すでにあります` : REASONS[r.reason] || '保存できませんでした', kind: 'warn' };
      this.renderPanel();
      return;
    }
    const type = s.mode === 'new' ? 'add' : 'update';
    this.close(true);
    this.onSaved({ type, id: r.id });
    this.onClose();
  }
}
