// プリセットの画面（上のバーの「☆ プリセット」）。気に入った進行を、保存して、呼び出す。
//   ・上: いまの盤の8つの場所が並ぶ。保存したい部分を、ドラッグでえらぶ（1か所をクリック → 別の場所をクリック、でも範囲になる）→ 名前をつけて「保存する」
//   ・フリープレイで、メロディ（♪ メロディの画面でつけたもの）が、選んだ範囲にあるときは、「メロディもいっしょに保存する」（コードとメロディのプリセット）
//   ・下: 保存したプリセットの一覧。「盤に置く」で、えらんだ場所から、駒が置かれる（メロディつきなら、メロディも。実機の盤のときは、置く駒と場所を、案内する）
//   画面の部品だけ。保存・置き方の決まりは game/presets.js、盤の操作は app.js（onApply）。
import { h, clear } from './dom.js';
import { makePreset, placementPlan, sliceMelody, MAX_NAME, MAX_PRESETS } from '../game/presets.js';

const FN_COLOR = { T: 'var(--T)', SD: 'var(--SD)', D: 'var(--D)', X: 'var(--X)', R: 'var(--R)' };
const REASONS = {
  few: '駒を2つ以上えらんでください（空きだけの範囲は保存できません）',
  range: '保存する範囲をえらんでください',
  full: `プリセットは${MAX_PRESETS}個までです。いらないものを削除してください`,
};

export class PresetMenu {
  constructor({ root, table, store, getBoard, getMelody = () => [], isLive, onApply, onOpen = () => {}, onClose = () => {} }) {
    Object.assign(this, { root, table, store, getBoard, getMelody, isLive, onApply, onOpen, onClose });
    this.withMelody = true;       // メロディもいっしょに保存するか（メロディがあるときの、チェックボックス）
    this.isOpen = false;
    this.sel = [0, 7];            // えらんだ範囲（両端を含む）
    this.anchor = null;           // ドラッグの始まり
    this.pending = null;          // 1か所だけクリックしたとき、つぎのクリックで、範囲にするための、始まりの場所
    this.start = 0;               // 呼び出すときの、始める場所（0〜7）
    this.renaming = null;
    this.confirming = null;
    this.newId = null;
    this.msg = null;              // { text, kind: 'ok' | 'warn' }
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });         // 外側（暗いところ）をクリックしても、閉じる
    window.addEventListener('pointerup', () => this.endDrag());                               // ドラッグは、マスの外で離しても、終わる（1回だけ登録する）
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen && !(this.renaming)) { this.close(); e.preventDefault(); } });
  }

  // ---------- 開く・閉じる ----------
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.sel = this.allRange(); this.anchor = null; this.pending = null; this.renaming = null; this.confirming = null; this.newId = null; this.msg = null;
    this.build();
    this.root.classList.remove('hidden');
    this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearTimeout(this._confirmTimer);
    this.root.classList.add('hidden');
    clear(this.root);
    this.onClose();
  }

  // 盤が変わったとき（実機の駒が動いたときなど）
  refresh() {
    if (!this.isOpen) return;
    this.renderStrip(); this.renderInfo();
  }

  // 駒のある範囲（最初の駒〜最後の駒）。駒がなければ、ぜんぶ
  allRange() {
    const b = this.getBoard();
    const first = b.findIndex((x) => x !== null && x !== undefined);
    if (first < 0) return [0, 7];
    let last = 7; while (last > first && (b[last] === null || b[last] === undefined)) last--;
    return [first, last];
  }

  // ---------- 骨組み ----------
  build() {
    const card = h('div', { class: 'card preset-card', role: 'dialog', 'aria-label': 'プリセット' });
    this.strip = h('div', { class: 'pm-strip' });
    this.info = h('div', { class: 'pm-selinfo' });
    this.nameInput = h('input', { class: 'pm-name', type: 'text', maxlength: String(MAX_NAME), placeholder: '名前（省略すると「プリセット 1」のようにつきます）', 'aria-label': 'プリセットの名前' });
    this.nameInput.addEventListener('input', () => this.renderInfo());
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.save(); } e.stopPropagation(); });
    this.saveBtn = h('button', { class: 'chip primary', id: 'pm-save', onclick: () => this.save() }, '保存する');
    this.melInput = h('input', { type: 'checkbox', id: 'pm-with-melody', checked: this.withMelody, onchange: (e) => { this.withMelody = e.target.checked; this.renderInfo(); } });
    this.melRow = h('label', { class: 'pm-melrow hidden' }, this.melInput, h('span', { id: 'pm-melody-text' }));
    this.msgEl = h('div', { class: 'pm-msg' });
    this.startBox = h('div', { class: 'pm-start' });
    this.list = h('div', { class: 'pm-list' });
    this.listTitle = h('div', { class: 'pm-title' });
    card.append(
      h('div', { class: 'pm-head' }, h('h3', {}, '☆ プリセット'), h('button', { class: 'chip', id: 'pm-close', onclick: () => this.close() }, '閉じる')),
      h('section', { class: 'pm-sec' },
        h('div', { class: 'pm-title' }, 'いまの盤から保存', h('small', {}, '保存したい部分をドラッグでえらぶ（ぜんぶでも一部でも）')),
        this.strip, this.info, this.melRow,
        h('div', { class: 'pm-save' }, this.nameInput, this.saveBtn), this.msgEl),
      h('section', { class: 'pm-sec' }, this.listTitle, this.startBox, this.list));
    clear(this.root).append(card);
    this.attachStrip();
    this.renderStrip(); this.renderInfo(); this.renderList();
  }

  // ---------- 上: いまの盤（範囲をえらぶ）----------
  cellAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const c = el && el.closest ? el.closest('.pm-cell') : null;
    return c && this.strip.contains(c) ? Number(c.dataset.slot) : -1;
  }
  attachStrip() {
    const range = (a, b) => [Math.min(a, b), Math.max(a, b)];
    this.strip.addEventListener('pointerdown', (e) => {
      const i = this.cellAt(e);
      if (i < 0) return;
      e.preventDefault();
      if (this.pending !== null && this.pending !== i) { this.sel = range(this.pending, i); this.pending = null; this.anchor = null; }      // 1か所クリック → 別の場所をクリック: 範囲
      else { this.anchor = i; this.sel = [i, i]; }
      this.msg = null;
      this.renderStrip(); this.renderInfo();
    });
    this.strip.addEventListener('pointermove', (e) => {
      if (this.anchor === null || !(e.buttons & 1)) return;
      const j = this.cellAt(e);
      if (j < 0) return;
      const next = range(this.anchor, j);
      if (next[0] !== this.sel[0] || next[1] !== this.sel[1]) { this.sel = next; this.renderStrip(); this.renderInfo(); }
    });
    this.strip.addEventListener('pointerup', () => this.endDrag());
  }
  // ドラッグ（範囲のえらびかた）の終わり。1か所だけなら、次のクリックで、範囲にできるように、始まりの場所を覚えておく
  endDrag() {
    if (this.anchor === null) return;
    this.pending = this.sel[0] === this.sel[1] ? this.sel[0] : null;
    this.anchor = null;
  }

  renderStrip() {
    const b = this.getBoard();
    const box = clear(this.strip);
    for (let i = 0; i < 8; i++) {
      const id = b[i];
      const c = id !== null && id !== undefined ? this.table.byId(id) : null;
      const on = i >= this.sel[0] && i <= this.sel[1];
      box.append(h('div', { class: `pm-cell${on ? ' on' : ''}${c ? '' : ' empty'}`, dataset: { slot: String(i) }, style: { '--c': c ? FN_COLOR[c.fn] || 'var(--line-2)' : 'var(--line)' } },
        h('span', { class: 'n' }, String(i + 1)), h('b', {}, c ? c.name : '—')));
    }
  }

  // 保存の前の、確認（えらんだ範囲・駒）と、保存できるか
  preview() {
    return makePreset({ name: '', board: this.getBoard(), from: this.sel[0], to: this.sel[1], table: this.table, existing: this.store.list(), melody: this.withMelody ? this.getMelody() : null });
  }
  renderInfo() {
    const r = this.preview();
    if (r.ok) {
      this.info.textContent = `選んだ範囲: ${r.from + 1}番〜${r.to + 1}番（${r.preset.chords.map((n) => n || '・').join(' → ')}）${r.preset.melody ? ` ／ メロディ ${r.preset.melody.length}音` : ''}`;
      this.info.classList.remove('warn');
    } else {
      this.info.textContent = r.reason === 'duplicate' ? `同じ進行が「${r.existing}」として保存ずみです` : (REASONS[r.reason] || '');
      this.info.classList.add('warn');
    }
    this.saveBtn.disabled = !r.ok;
    this.renderMelodyRow();
    this.msgEl.textContent = this.msg ? this.msg.text : '';
    this.msgEl.className = `pm-msg${this.msg ? ` ${this.msg.kind}` : ''}`;
  }

  // メロディのチェックボックス: メロディが、選んだ範囲にあるときだけ出す
  renderMelodyRow() {
    const all = this.getMelody();
    if (!all.length) { this.melRow.classList.add('hidden'); return; }
    const r = makePreset({ name: '', board: this.getBoard(), from: this.sel[0], to: this.sel[1], table: this.table, existing: [], melody: all });
    const n = r.ok && r.preset.melody ? r.preset.melody.length : sliceMelody(all, this.sel[0], this.sel[1]).length;
    this.melRow.classList.remove('hidden');
    this.melInput.disabled = n === 0;
    this.melRow.querySelector('#pm-melody-text').textContent = n ? `メロディもいっしょに保存する（選んだ範囲に ${n}音）` : '選んだ範囲には、メロディがありません';
  }

  save() {
    const r = this.store.add({ name: this.nameInput.value, board: this.getBoard(), from: this.sel[0], to: this.sel[1], melody: this.withMelody ? this.getMelody() : null });
    if (r.ok) {
      this.newId = r.preset.id;
      this.msg = { text: `「${r.preset.name}」を保存しました（${r.preset.chords.filter((x) => x !== null).length}つ${r.preset.melody ? `・メロディ ${r.preset.melody.length}音` : ''}）`, kind: 'ok' };
      this.nameInput.value = '';
      this.renderList();
    } else {
      this.msg = { text: r.reason === 'duplicate' ? `同じ進行が「${r.existing}」として保存ずみです` : (REASONS[r.reason] || '保存できませんでした'), kind: 'warn' };
    }
    this.renderInfo();
  }

  // ---------- 下: 保存したプリセット ----------
  renderList() {
    const items = this.store.list();
    const live = !!this.isLive();
    this.listTitle.replaceChildren('保存したプリセット', h('small', {}, `${items.length} / ${MAX_PRESETS}`));
    // 置く場所
    const sel = h('select', { class: 'pm-select', id: 'pm-start', 'aria-label': '置く場所', onchange: (e) => { this.start = Number(e.target.value); this.renderList(); } },
      ...Array.from({ length: 8 }, (_, i) => h('option', { value: String(i), selected: i === this.start }, `${i + 1}番から`)));
    clear(this.startBox).append(
      live ? h('span', {}, '実機の盤を使っています。「案内を出す」で置く駒と場所がガイドと盤に出ます。案内する場所: ') : h('span', {}, '置く場所: '),
      sel,
      live ? null : h('small', {}, '（置く範囲の駒は置きかわります）'));
    const box = clear(this.list);
    if (!items.length) { box.append(h('div', { class: 'pm-empty' }, 'まだありません。気に入った進行ができたら上で範囲をえらんで保存しよう。')); return; }
    for (const p of items) box.append(this.card(p, live));
  }

  card(p, live) {
    const plan = placementPlan(p, this.start, this.table);
    const nameEl = this.renaming === p.id
      ? (() => {
        const inp = h('input', { class: 'pm-rename', type: 'text', maxlength: String(MAX_NAME), value: p.name, 'aria-label': '新しい名前' });
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { this.store.rename(p.id, inp.value); this.renaming = null; this.renderList(); }
          else if (e.key === 'Escape') { this.renaming = null; this.renderList(); e.preventDefault(); }
        });
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        return inp;
      })()
      : h('b', { class: 'pm-name-text' }, p.name);
    const chips = p.chords.map((nm) => {
      if (nm === null) return h('span', { class: 'pm-chip rest', title: 'お休み（空き）' }, '・');
      const c = this.table.byName(nm);
      if (!c) return h('span', { class: 'pm-chip rest', title: 'いまは、ないコード（削除した自作コードなど）。置くときは、空きになります' }, `？${nm}`);
      return h('span', { class: 'pm-chip', style: { '--c': c.color || FN_COLOR[c.fn] || 'var(--line-2)' }, title: c.symbol }, nm);
    });
    const del = this.confirming === p.id
      ? h('button', { class: 'chip danger', dataset: { act: 'delete' }, onclick: () => { clearTimeout(this._confirmTimer); this.store.remove(p.id); this.confirming = null; this.renderList(); } }, '本当に削除')
      : h('button', { class: 'chip', dataset: { act: 'delete' }, onclick: () => { this.confirming = p.id; clearTimeout(this._confirmTimer); this._confirmTimer = setTimeout(() => { this.confirming = null; if (this.isOpen) this.renderList(); }, 3000); this.renderList(); } }, '削除');
    return h('div', { class: `pm-card${p.id === this.newId ? ' new' : ''}`, dataset: { id: p.id } },
      h('div', { class: 'pm-card-head' }, nameEl, h('span', { class: 'pm-count' }, `${plan.count}つ`), p.melody ? h('span', { class: 'pm-mel', title: 'メロディもいっしょに保存されています' }, `♪ メロディ ${p.melody.length}音`) : null,
        h('span', { class: 'pm-where' }, `${plan.start + 1}番〜${plan.end + 1}番${live ? 'を案内します' : 'に置きます'}`)),
      h('div', { class: 'pm-chips' }, chips),
      h('div', { class: 'pm-actions' },
        h('button', { class: 'chip primary', dataset: { act: 'apply' }, onclick: () => { this.onApply(p, this.start); this.close(); } }, live ? '案内を出す' : '盤に置く'),
        h('button', { class: 'chip', dataset: { act: 'rename' }, onclick: () => { this.renaming = this.renaming === p.id ? null : p.id; this.renderList(); } }, '名前'),
        del));
  }
}
