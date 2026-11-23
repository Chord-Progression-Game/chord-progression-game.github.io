// メロディの画面（上のバーの「♪ メロディ」）。DTM のピアノロールのように、メロディを書く・直す・自動でつける。
//   ・上: いまの盤の8つの和音（ステップ 1〜8）。和音の構成音の行は、うっすら色がつく（緑 = コードの音 / 水色 = 9th）。盤の和音は、ここでは変えない
//   ・真ん中: ピアノロール。64マス（16分音符）× 音の高さ。空いているところをクリックで音を置く（そのままドラッグで長さ）
//       音をドラッグで動かす / 右はしをドラッグで長さを変える / 右クリックか Delete で消す / 矢印キーで1マス・半音ずつ動かす
//       音の色 = いまの和音に対しての聞こえ方（緑 = コードの音 / 水色 = テンション / 灰 = 経過音 / 黄 = 不安定 / 赤 = アヴォイド）
//   ・上の道具: 自動でメロディをつける（作風・9th を使うか）/ 音の長さ / 元に戻す・やり直す / 聴く
//   ・下: 相性・選んだ音の説明 / プリセットに保存（コードと、このメロディを、いっしょに）
//   画面の部品だけ。音の編集は game/usermelody.js（MelodyDoc）・自動作曲は core/automelody.js・採点は core/melody.js。
import { h, clear } from './dom.js';
import { judgeMelody, VERDICT, KIND_TEXT, SLOTS_PER_STEP, NUM_STEPS, LOOP_SLOTS, midiName } from '../core/melody.js';
import { generateMelody, STYLES, STYLE_IDS, spellNotes } from '../core/automelody.js';
import { NOTE_LO, NOTE_HI } from '../game/usermelody.js';

const FN_VAR = { T: 'var(--T)', SD: 'var(--SD)', D: 'var(--D)', X: 'var(--X)', R: 'var(--R)' };
const LENGTHS = [{ slots: 1, label: '16分' }, { slots: 2, label: '8分' }, { slots: 4, label: '4分' }, { slots: 8, label: '2分' }];
const BLACK = new Set([1, 3, 6, 8, 10]);
const RANK = { avoid: 0, unstable: 1, none: 2, passing: 3, tension: 4, chord: 5 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const octaveOf = (m) => Math.floor(m / 12) - 1;                                // 音の高さの番号（ド4 = 真ん中のド）
const lengthName = (slots) => ({ 1: '16分音符', 2: '8分音符', 3: '付点8分音符', 4: '4分音符', 6: '付点4分音符', 8: '2分音符', 12: '付点2分音符', 16: '全音符' })[slots] || `${slots}マス`;

export class MelodyStudio {
  constructor({ root, table, doc, getBoard, audition = () => {}, isPlaying = () => false, togglePlay = () => {}, getEnabled = () => true, setEnabled = () => {}, onSavePreset = () => ({ ok: false }), onOpen = () => {}, onClose = () => {} }) {
    Object.assign(this, { root, table, doc, getBoard, audition, isPlaying, togglePlay, getEnabled, setEnabled, onSavePreset, onOpen, onClose });
    this.isOpen = false;
    this.snap = 2;                 // 音の長さ（置くとき・動かすときの単位。マス）
    this.selected = null;          // 選んでいる音の id
    this.style = 'lyrical';
    this.tension = true;
    this.generated = false;        // 自動でつけたことがあるか（ボタンの名前を替える）
    this.seed = 1;
    this.nextSeed = () => Math.floor(Math.random() * 4294967295);          // テストでは、固定の種に差しかえる
    this.drag = null;
    this.msg = null;
    this.judged = null;
    this.cw = 14; this.rh = 12;
    this._unsub = null;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => { if (this.isOpen) this.layout(); });
  }

  get visible() { return this.isOpen; }

  // ---------- 開く・閉じる ----------
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.selected = null; this.drag = null; this.msg = null;
    this.build();
    this.root.classList.remove('hidden');
    this.layout();
    this.refresh();
    this.scrollToNotes();
    this._unsub = this.doc.subscribe(() => { if (this.isOpen) this.refresh(true); });
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    if (this.drag) this.endDrag();
    this.isOpen = false;
    if (this._unsub) { this._unsub(); this._unsub = null; }
    this.root.classList.add('hidden');
    clear(this.root);
    this.onClose();
  }

  // 盤が変わったとき（実機の駒が動いたときなど）・メロディが変わったとき
  refresh(fromDoc = false) {
    if (!this.isOpen) return;
    this.judged = this.judge();
    this.renderChords(); this.renderNotes(); this.renderInfo(); this.renderTools();
    if (!fromDoc) this.renderBands();                       // 色のついた行は、盤の和音が変わったときだけ描きなおす（音を動かしている途中は、そのまま）
  }

  // ---------- 骨組み ----------
  build() {
    const card = h('div', { class: 'card ms-card', role: 'dialog', 'aria-label': 'メロディ' });
    this.el = {};
    const e = this.el;
    e.card = card;
    // 道具: 自動
    e.style = h('select', { class: 'pm-select', id: 'ms-style', 'aria-label': '作風', onchange: (ev) => { this.style = ev.target.value; this.renderTools(); } },
      ...STYLE_IDS.map((id) => h('option', { value: id, selected: id === this.style }, `${STYLES[id].name}`)));
    e.tension = h('input', { type: 'checkbox', id: 'ms-tension', checked: this.tension, onchange: (ev) => { this.tension = ev.target.checked; } });
    e.auto = h('button', { class: 'chip primary', id: 'ms-auto', onclick: () => this.generate() }, '自動でメロディをつける');
    e.styleHint = h('small', { class: 'ms-stylehint' });
    // 道具: 音の長さ・編集
    e.lens = LENGTHS.map((l) => h('button', { class: 'chip seg', dataset: { slots: String(l.slots) }, title: `${lengthName(l.slots)}（${l.slots}マス）単位で置く・動かす`, onclick: () => { this.snap = l.slots; this.renderTools(); } }, l.label));
    e.undo = h('button', { class: 'chip', id: 'ms-undo', title: '元に戻す（Ctrl/⌘ + Z）', onclick: () => this.doc.undo() }, '↶ 戻す');
    e.redo = h('button', { class: 'chip', id: 'ms-redo', title: 'やり直す（Ctrl/⌘ + Shift + Z）', onclick: () => this.doc.redo() }, '↷ やり直す');
    e.del = h('button', { class: 'chip', id: 'ms-del', title: '選んだ音を消す（Delete）', onclick: () => this.removeSelected() }, '選んだ音を消す');
    e.clear = h('button', { class: 'chip', id: 'ms-clear', onclick: () => this.clearAll() }, '全部消す');
    e.play = h('button', { class: 'chip toggle', id: 'ms-play', title: 'いまの盤の演奏を、止める・再生する（Space）', onclick: () => { this.togglePlay(); this.renderTools(); } }, h('span', { class: 'dot' }), '演奏 ', h('b', {}, 'ON'));
    e.on = h('button', { class: 'chip toggle', id: 'ms-melody-on', title: 'メロディを鳴らす・鳴らさない', onclick: () => { this.setEnabled(!this.getEnabled()); this.renderTools(); } }, h('span', { class: 'dot' }), 'メロディの音 ', h('b', {}, 'ON'));
    // ピアノロール
    e.chords = h('div', { class: 'ms-chords' });
    e.corner = h('div', { class: 'ms-corner' }, h('small', {}, 'ステップ'));
    e.head = h('div', { class: 'ms-headrow' }, e.corner, e.chords);
    e.keys = h('div', { class: 'ms-keys' });
    e.bands = h('div', { class: 'ms-bands' });
    e.notes = h('div', { class: 'ms-notes' });
    e.ghost = h('div', { class: 'ms-ghost hidden' });
    e.playhead = h('div', { class: 'ms-playhead' });
    e.vlines = h('div', { class: 'ms-vlines' });
    e.grid = h('div', { class: 'ms-grid', dataset: { role: 'roll' } }, e.bands, e.vlines, e.ghost, e.notes, e.playhead);
    e.body = h('div', { class: 'ms-body' }, e.keys, e.grid);
    e.scroll = h('div', { class: 'ms-scroll' }, e.head, e.body);
    e.summary = h('div', { class: 'ms-summary' });
    e.detail = h('div', { class: 'ms-detail' });
    e.name = h('input', { class: 'pm-name', id: 'ms-name', type: 'text', maxlength: '20', placeholder: 'プリセットの名前（省略すると「プリセット 1」のようにつきます）', 'aria-label': 'プリセットの名前' });
    e.name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); this.savePreset(); } ev.stopPropagation(); });
    e.save = h('button', { class: 'chip primary', id: 'ms-save', onclick: () => this.savePreset() }, 'コードとメロディをプリセットに保存');
    e.msg = h('div', { class: 'pm-msg ms-msg' });
    card.append(
      h('div', { class: 'pm-head' }, h('h3', {}, '♪ メロディ'), h('button', { class: 'chip', id: 'ms-close', onclick: () => this.close() }, '閉じる')),
      h('div', { class: 'ms-tools' },
        h('div', { class: 'ms-group ms-auto' }, e.style, h('label', { class: 'ms-check', title: 'テンションは 9th まで。11th・13th・♭9・♯9 は使いません' }, e.tension, '9th のテンション'), e.auto, e.styleHint),
        h('div', { class: 'ms-group' }, h('span', { class: 'ms-lab' }, '音の長さ'), ...e.lens, e.undo, e.redo, e.del, e.clear),
        h('div', { class: 'ms-group ms-right' }, e.play, e.on)),
      e.scroll,
      h('div', { class: 'ms-foot' }, e.summary, e.detail),
      h('div', { class: 'ms-save' }, e.name, e.save), e.msg);
    clear(this.root).append(card);
    this.attachGrid();
    this.buildKeys();
  }

  // 寸法: 1マスの幅・1半音の高さ。画面の大きさに合わせて（rem）、64マスが、ちょうど入るように
  layout() {
    const e = this.el;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
    this.rh = Math.max(10, Math.round(rem * 0.95));
    const keysW = Math.round(rem * 3.4);
    const avail = e.scroll.clientWidth - keysW - 2;
    this.cw = Math.max(window.matchMedia && window.matchMedia('(max-width: 900px) and (min-height: 521px), (max-height: 520px) and (max-width: 1000px)').matches ? 13 : 8, Math.floor(avail / LOOP_SLOTS));       // スマホでは、1マスを少し広く（横になぞって見る）
    e.card.style.setProperty('--cw', `${this.cw}px`);
    e.card.style.setProperty('--rh', `${this.rh}px`);
    e.card.style.setProperty('--keysw', `${keysW}px`);
    const rows = NOTE_HI - NOTE_LO + 1;
    e.grid.style.width = `${this.cw * LOOP_SLOTS}px`;
    e.grid.style.height = `${this.rh * rows}px`;
    e.keys.style.height = `${this.rh * rows}px`;
    this.refresh();
  }

  scrollToNotes() {
    const e = this.el, items = this.doc.items;
    const mid = items.length ? Math.round(items.reduce((a, x) => a + x.m, 0) / items.length) : 76;
    e.scroll.scrollTop = Math.max(0, (NOTE_HI - mid) * this.rh - e.scroll.clientHeight / 2 + this.rh * 2);
  }

  buildKeys() {
    const box = clear(this.el.keys);
    for (let m = NOTE_HI; m >= NOTE_LO; m--) {
      const black = BLACK.has(m % 12);
      box.append(h('div', { class: `ms-key${black ? ' black' : ''}${m % 12 === 0 ? ' c' : ''}`, dataset: { midi: String(m) }, title: midiName(m), onpointerdown: (ev) => { ev.preventDefault(); this.audition(m, 2); } }, m % 12 === 0 ? midiName(m) : ''));
    }
  }

  // ---------- 描く ----------
  boardChords() {
    const board = this.getBoard();
    return Array.from({ length: NUM_STEPS }, (_, k) => {
      const raw = board[k];
      if (raw === null || raw === undefined) return { raw: null, chord: null };
      const chord = raw === this.table.repeatId ? this.resolve(board, k) : this.table.byId(raw);
      return { raw, chord, repeat: raw === this.table.repeatId };
    });
  }
  resolve(board, k) {                                                          // 「→」は、前の駒の和音
    for (let j = 1; j < board.length; j++) {
      const p = (((k - j) % board.length) + board.length) % board.length;
      const r = board[p];
      if (r === null || r === undefined) return null;
      if (r !== this.table.repeatId) return this.table.byId(r);
    }
    return null;
  }

  renderChords() {
    const box = clear(this.el.chords);
    const cs = this.boardChords();
    const res = this.judged && this.judged.res;
    cs.forEach((c, k) => {
      const st = res ? res.steps[k] : null;
      const v = st && st.hasNotes ? VERDICT[st.verdict] || VERDICT.rest : null;
      box.append(h('div', { class: `ms-chord${c.chord ? '' : ' empty'}`, style: { '--c': c.chord ? FN_VAR[c.chord.fn] || 'var(--line-2)' : 'var(--line)' }, title: c.chord ? `${k + 1}番: ${c.chord.name}（${c.chord.symbol}）${v ? ` ${v.text}` : ''}` : `${k + 1}番: 和音なし` },
        h('span', { class: 'n' }, String(k + 1)), h('b', {}, c.chord ? (c.repeat ? `→ ${c.chord.name}` : c.chord.name) : '—'), h('span', { class: 'mk' }, v ? v.mark : '')));
    });
  }

  // 和音の構成音の行に、うっすら色をつける（どの高さが「コードの音」か見える）
  renderBands() {
    const box = clear(this.el.bands);
    const cs = this.boardChords();
    for (let m = NOTE_HI; m >= NOTE_LO; m--) box.append(h('div', { class: `ms-row${BLACK.has(m % 12) ? ' black' : ''}${m % 12 === 0 ? ' c' : ''}`, style: { top: `${(NOTE_HI - m) * this.rh}px` } }));
    cs.forEach((c, k) => {
      if (!c.chord) { box.append(h('div', { class: 'ms-nochord', style: { left: `${k * SLOTS_PER_STEP * this.cw}px`, width: `${SLOTS_PER_STEP * this.cw}px` } })); return; }
      const nine = (c.chord.rootPc + 2) % 12;
      for (let m = NOTE_LO; m <= NOTE_HI; m++) {
        const pc = m % 12;
        const kind = c.chord.pcs.includes(pc) ? 'chord' : pc === nine ? 'nine' : null;
        if (kind) box.append(h('div', { class: `ms-band ${kind}`, style: { left: `${k * SLOTS_PER_STEP * this.cw}px`, width: `${SLOTS_PER_STEP * this.cw}px`, top: `${(NOTE_HI - m) * this.rh}px` } }));
      }
    });
  }

  // 採点して、音ごとの聞こえ方を求める
  judge() {
    const board = this.getBoard();
    const items = this.doc.items;
    if (!items.length) return { res: null, info: new Map(), items };
    const notes = spellNotes(items.map((x) => [x.s, x.l, x.m]), board, this.table);
    const res = judgeMelody(board, { notes }, this.table);
    const info = new Map();
    items.forEach((it, i) => {
      let kind = 'chord', text = '', name = notes[i][3];
      let first = true;
      for (const st of res.steps) for (const x of st.items) {
        if (x.index !== i) continue;
        const kd = x.kind;
        if (first || RANK[kd] < RANK[kind]) { kind = kd; text = x.text || ''; first = false; }
        else if (x.attack && RANK[kd] === RANK[kind] && !text) text = x.text || '';
      }
      info.set(it.id, { kind: first ? 'none' : kind, text, name });
    });
    return { res, info, items };
  }

  renderNotes() {
    const box = clear(this.el.notes);
    const j = this.judged || { info: new Map(), items: this.doc.items };
    for (const it of j.items) {
      const inf = j.info.get(it.id) || { kind: 'none', name: '' };
      const w = it.l * this.cw - 1;
      box.append(h('div', {
        class: `ms-note k-${inf.kind}${it.id === this.selected ? ' sel' : ''}`, dataset: { id: String(it.id), start: String(it.s), len: String(it.l), midi: String(it.m) },
        style: { left: `${it.s * this.cw}px`, top: `${(NOTE_HI - it.m) * this.rh}px`, width: `${w}px`, height: `${this.rh - 1}px` },
        title: `${inf.name}${octaveOf(it.m)}${KIND_TEXT[inf.kind] ? `: ${KIND_TEXT[inf.kind]}` : ''}`,
      }, w >= 24 ? h('span', { class: 'ms-nlabel' }, inf.name) : null, h('i', { class: 'ms-grip' })));
    }
  }

  renderInfo() {
    const e = this.el, j = this.judged, res = j && j.res;
    const cs = this.boardChords();
    if (!cs.some((c) => c.chord)) {
      e.summary.textContent = '盤に和音がありません。先に盤へ和音を並べると、合う音（色のついた行）が見えて、自動でもつけられます。';
      e.summary.className = 'ms-summary warn';
    } else if (!res) {
      e.summary.textContent = 'メロディはまだありません。空いているところをクリックすると音が置けます（色のついた行に置くと、きれいに合います）。「自動でメロディをつける」もどうぞ。';
      e.summary.className = 'ms-summary';
    } else {
      const c = res.counts;
      e.summary.textContent = `和音との相性 ${Math.round(res.match * 100)}% ／ 音 ${j.items.length}つ（コードの音 ${c.chord}・テンション ${c.tension}・経過音 ${c.passing}・ぶつかる ${c.avoid}・不安定 ${c.unstable}）`;
      e.summary.className = `ms-summary${res.match >= 0.9 ? ' good' : ''}`;
    }
    const it = this.selected !== null ? this.doc.item(this.selected) : null;
    if (it) {
      const inf = (j && j.info.get(it.id)) || null;
      e.detail.textContent = `選んだ音: ${inf ? inf.name : ''}${octaveOf(it.m)} ／ ${it.s + 1}マス目から ${lengthName(it.l)} ／ ${inf && inf.text ? inf.text : '和音のないところです'}`;
    } else e.detail.textContent = '音をクリックすると、その音が和音にどう聞こえるかを説明します。';
    e.msg.textContent = this.msg ? this.msg.text : '';
    e.msg.className = `pm-msg ms-msg${this.msg ? ` ${this.msg.kind}` : ''}`;
  }

  renderTools() {
    const e = this.el;
    e.lens.forEach((b) => b.classList.toggle('on', Number(b.dataset.slots) === this.snap));
    e.undo.disabled = !this.doc.canUndo; e.redo.disabled = !this.doc.canRedo;
    e.del.disabled = this.selected === null; e.clear.disabled = this.doc.count === 0;
    const hasChord = this.boardChords().some((c) => c.chord);
    e.auto.disabled = !hasChord;
    e.auto.textContent = this.generated ? '別の案にする' : '自動でメロディをつける';
    e.styleHint.textContent = STYLES[this.style].hint;
    const playing = this.isPlaying();
    e.play.classList.toggle('on', playing); e.play.querySelector('b').textContent = playing ? 'ON' : 'OFF';
    const en = this.getEnabled();
    e.on.classList.toggle('on', en); e.on.querySelector('b').textContent = en ? 'ON' : 'OFF';
    e.save.disabled = this.boardChords().filter((c) => c.chord).length < 2;
  }

  // 再生位置（0〜1）。null で消す。毎フレーム呼ばれる
  setPlayhead(fraction) {
    if (!this.isOpen || !this.el) return;
    const p = this.el.playhead;
    if (fraction === null || fraction === undefined) { p.style.opacity = '0'; }
    else { p.style.opacity = '1'; p.style.left = `${fraction * LOOP_SLOTS * this.cw}px`; }
    const playing = this.isPlaying();
    if (playing !== this._lastPlaying) { this._lastPlaying = playing; this.renderTools(); }
  }

  // ---------- 自動 ----------
  generate() {
    const board = this.getBoard();
    this.seed = this.nextSeed();
    const r = generateMelody(board, this.table, { seed: this.seed, style: this.style, tension: this.tension });
    if (!r.ok) { this.msg = { text: '和音がないので、メロディをつけられません。先に盤へ和音を並べてください', kind: 'warn' }; this.renderInfo(); return; }
    this.doc.replaceAll(r.notes.map((n) => [n[0], n[1], n[2]]));
    this.generated = true;
    this.selected = null;
    this.msg = { text: `${STYLES[this.style].name}で、${r.notes.length}つの音をつけました（相性 ${Math.round(r.report.match * 100)}%）。気に入らなければ「別の案にする」か「元に戻す」`, kind: 'ok' };
    this.refresh(true);
    this.scrollToNotes();
  }

  // ---------- 編集 ----------
  select(id) { this.selected = id; this.renderNotes(); this.renderInfo(); this.renderTools(); }
  removeSelected() { if (this.selected === null) return; const id = this.selected; this.selected = null; this.doc.remove(id); }
  clearAll() { this.selected = null; this.doc.clear(); this.msg = { text: 'メロディを消しました。「元に戻す」で戻せます', kind: 'ok' }; this.renderInfo(); }

  pointToCell(ev) {
    const r = this.el.grid.getBoundingClientRect();
    return { slot: clamp(Math.floor((ev.clientX - r.left) / this.cw), 0, LOOP_SLOTS - 1), midi: clamp(NOTE_HI - Math.floor((ev.clientY - r.top) / this.rh), NOTE_LO, NOTE_HI), x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  attachGrid() {
    const g = this.el.grid;
    g.addEventListener('contextmenu', (ev) => {
      const n = ev.target.closest && ev.target.closest('.ms-note');
      ev.preventDefault();
      if (n) { const id = Number(n.dataset.id); if (this.selected === id) this.selected = null; this.doc.remove(id); }
    });
    g.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const noteEl = ev.target.closest && ev.target.closest('.ms-note');
      const c = this.pointToCell(ev);
      g.setPointerCapture(ev.pointerId);
      this.doc.beginEdit();
      if (noteEl) {
        const id = Number(noteEl.dataset.id), it = this.doc.item(id);
        if (!it) return;
        const rect = noteEl.getBoundingClientRect();
        const resize = ev.clientX >= rect.right - Math.max(6, Math.min(10, rect.width * 0.35));
        this.selected = id;
        this.drag = { mode: resize ? 'resize' : 'move', id, x0: ev.clientX, y0: ev.clientY, orig: it, moved: false };
        this.audition(it.m, Math.min(it.l, 4));
        this.renderNotes(); this.renderInfo(); this.renderTools();
      } else {
        const start = Math.floor(c.slot / this.snap) * this.snap;
        const id = this.doc.add(start, Math.min(this.snap, LOOP_SLOTS - start), c.midi);
        if (id === null) { this.doc.commitEdit(); return; }
        this.selected = id;
        this.drag = { mode: 'create', id, x0: ev.clientX, y0: ev.clientY, orig: this.doc.item(id), moved: false };
        this.audition(c.midi, this.snap);
        this.renderNotes(); this.renderInfo(); this.renderTools();
      }
    });
    g.addEventListener('pointermove', (ev) => {
      if (!this.drag) { this.showGhost(ev); return; }
      const d = this.drag;
      const dx = (ev.clientX - d.x0) / this.cw, dy = (ev.clientY - d.y0) / this.rh;
      if (d.mode === 'move') {
        const ds = Math.round(dx / this.snap) * this.snap, dm = -Math.round(dy);
        const before = this.doc.item(d.id);
        if (before && this.doc.set(d.id, { s: d.orig.s + ds, m: d.orig.m + dm })) {
          const now = this.doc.item(d.id);
          if (now && now.m !== before.m) this.audition(now.m, 2);              // 高さが変わったら、その音を鳴らす
          d.moved = true;
        }
      } else {                                                                  // resize / create: 長さ（snap 単位）
        const len = Math.max(this.snap, d.orig.l + Math.round(dx / this.snap) * this.snap);
        const cur = this.doc.item(d.id);
        if (cur && cur.l !== Math.min(len, LOOP_SLOTS - cur.s)) { this.doc.set(d.id, { l: len }); d.moved = true; }
      }
    });
    const up = () => this.endDrag();
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
    g.addEventListener('pointerleave', () => this.el.ghost.classList.add('hidden'));
  }
  endDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.doc.commitEdit();
    this.refresh(true);
  }
  // 置く場所の見本（うっすらした枠）
  showGhost(ev) {
    const gh = this.el.ghost;
    if (!ev.target.closest || ev.target.closest('.ms-note')) { gh.classList.add('hidden'); return; }
    const c = this.pointToCell(ev);
    const start = Math.floor(c.slot / this.snap) * this.snap;
    gh.classList.remove('hidden');
    gh.style.left = `${start * this.cw}px`; gh.style.top = `${(NOTE_HI - c.midi) * this.rh}px`; gh.style.width = `${this.snap * this.cw - 1}px`; gh.style.height = `${this.rh - 1}px`;
  }

  // ---------- キーボード ----------
  onKey(ev) {
    if (!this.isOpen) return;
    const tag = ev.target && ev.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Escape') { if (typing) return; ev.preventDefault(); if (this.selected !== null) this.select(null); else this.close(); return; }
    if (typing || tag === 'SELECT') return;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); if (ev.shiftKey) this.doc.redo(); else this.doc.undo(); return; }
    if (mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); this.doc.redo(); return; }
    if (ev.key === ' ') { ev.preventDefault(); if (!ev.repeat) { this.togglePlay(); this.renderTools(); } return; }
    if (this.selected === null) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.removeSelected(); return; }
    const step = { ArrowLeft: [-this.snap, 0], ArrowRight: [this.snap, 0], ArrowUp: [0, ev.shiftKey ? 12 : 1], ArrowDown: [0, ev.shiftKey ? -12 : -1] }[ev.key];
    if (step) {
      ev.preventDefault();
      const it = this.doc.item(this.selected);
      if (it && this.doc.move(this.selected, step[0], step[1])) { const now = this.doc.item(this.selected); if (now && now.m !== it.m) this.audition(now.m, 2); }
    }
  }

  // ---------- 保存 ----------
  savePreset() {
    const r = this.onSavePreset(this.el.name.value);
    if (r && r.ok) { this.msg = { text: `「${r.preset.name}」を保存しました（コード ${r.preset.chords.filter((x) => x !== null).length}つ${r.preset.melody ? `・メロディ ${r.preset.melody.length}音` : ''}）`, kind: 'ok' }; this.el.name.value = ''; }
    else if (r && r.reason === 'duplicate') this.msg = { text: `同じ内容が「${r.existing}」として保存ずみです`, kind: 'warn' };
    else if (r && r.reason === 'full') this.msg = { text: 'プリセットがいっぱいです。プリセットの画面で、いらないものを削除してください', kind: 'warn' };
    else this.msg = { text: '保存できませんでした（和音が2つ以上、並んでいる必要があります）', kind: 'warn' };
    this.renderInfo();
  }
}
