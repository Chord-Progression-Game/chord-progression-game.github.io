// メロディの帯（「メロディにコードをつける」ステージ）。画面の上に、流れているメロディを、8つのステップに分けて見せる。
//   ・1つ1つの音（棒）の色 = いまの和音に対しての聞こえ方（緑 = コードの音 / 水色 = テンション / 赤 = アヴォイド / 黄 = 不安定 / 灰 = 経過音）。和音がまだないステップは、白っぽい
//   ・ステップごとに、置いてある和音・そのステップの点・評価の記号（◎ ○ △ ×）。いまの再生位置の線も動く
//   ・ステップの列をクリックすると、その理由が出る（onPick）
//   画面の部品だけ。メロディの判定は core/melody.js、盤の状態は game.js。呼ばれた内容を描くだけ。
import { h, clear } from './dom.js';
import { stepSegments, VERDICT, KIND_TEXT, SLOTS_PER_STEP, NUM_STEPS } from '../core/melody.js';

// 音の棒の色の凡例（ガイドの欄にも出す）
export const legendEl = (h2) => h2('div', { class: 'mr-legend' }, ...['chord', 'tension', 'passing', 'unstable', 'avoid'].map((k) => h2('span', { class: `lg-k k-${k}` }, KIND_TEXT[k])));

const FN_VAR = { T: 'var(--T)', SD: 'var(--SD)', D: 'var(--D)', X: 'var(--X)', R: 'var(--R)' };
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

export class MelodyView {
  constructor({ root, table, onPick = () => {}, onDone = () => {} }) {
    this.root = root;
    this.table = table;
    this.onPick = onPick;
    this.stage = null;
    this.cols = [];
    this.segs = [];
    this.playhead = null;
    this.last = null;
    this.doneBtn = null;
    this.onDone = onDone;
  }

  // メロディを、帯に並べる（ステージが始まるとき）
  show(stage) {
    this.stage = stage;
    const mel = stage.melody;
    const root = clear(this.root);
    const lo = Math.min(...mel.notes.map((n) => n[2])) - 1, hi = Math.max(...mel.notes.map((n) => n[2])) + 1;
    const rows = hi - lo + 1;
    this.title = h('span', { class: 'mr-title' }, stage.title);
    this.match = h('b', { class: 'mr-match' }, '0%');
    this.total = h('b', { class: 'mr-total' }, '+0');
    this.doneBtn = h('button', { class: 'chip primary', id: 'btn-melody-done', onclick: () => this.onDone() }, 'できた！ 採点する');
    const head = h('div', { class: 'mr-head' },
      h('b', { class: 'mr-label' }, 'MELODY'), this.title,
      h('span', { class: 'mr-stat' }, '相性 ', this.match, h('i', {}, '／ メロディの点 '), this.total),
      this.doneBtn);
    this.grid = h('div', { class: 'mr-grid', style: { '--rows': rows } });
    this.cols = [];
    this.segs = [];
    const all = stepSegments(mel);
    for (let k = 0; k < NUM_STEPS; k++) {
      const notes = h('div', { class: 'mr-notes' });
      for (const s of all[k]) {
        const el = h('div', { class: 'mn k-none', title: `${s.name}（${KIND_TEXT.none}）`, style: { '--x': `${(s.from / SLOTS_PER_STEP) * 100}%`, '--w': `${(s.len / SLOTS_PER_STEP) * 100}%`, '--r': String(s.midi - lo) } });
        if (!s.attack) el.classList.add('held');
        notes.append(el);
        this.segs.push({ el, step: k, index: s.index, seg: s });
      }
      const chord = h('div', { class: 'mr-chord' }, '—');
      const pts = h('div', { class: 'mr-pts' }, '');
      const mark = h('div', { class: 'mr-mark' }, '');
      notes.append(h('span', { class: 'mr-no' }, String(k + 1)));
      const col = h('div', { class: 'mr-col v-missing', dataset: { step: String(k) }, onclick: () => this.onPick(k) },
        notes, chord, h('div', { class: 'mr-foot' }, mark, pts));
      this.cols.push({ col, notes, chord, pts, mark });
      this.grid.append(col);
    }
    this.playhead = h('div', { class: 'mr-playhead' });
    this.grid.append(this.playhead);
    this._step = -1; this.last = null;
    root.append(head, this.grid);
    root.classList.remove('hidden');
  }

  hide() { this.root.classList.add('hidden'); this.stage = null; }
  get visible() { return !this.root.classList.contains('hidden'); }

  // 盤が変わったとき: result = analysis.melody（core/melody.js の judgeMelody の結果）
  update(result) {
    if (!result || !this.stage) return;
    const pct = Math.round(result.match * 100);
    this.match.textContent = `${pct}%`;
    this.total.textContent = signed(result.total);
    this.match.parentElement.classList.toggle('good', pct >= 80);
    result.steps.forEach((st, k) => {
      const c = this.cols[k];
      const v = VERDICT[st.verdict] || VERDICT.rest;
      c.col.className = `mr-col v-${st.verdict}${this.last && this.last.steps[k] && this.last.steps[k].verdict !== st.verdict ? ' flash' : ''}`;
      const chord = st.chord ? this.table.byName(st.chord) : null;
      c.chord.textContent = chord ? chord.name : (st.hasNotes ? '？' : '');
      c.chord.style.setProperty('--c', chord ? FN_VAR[chord.fn] || 'var(--line-2)' : 'var(--line-2)');
      c.chord.classList.toggle('empty', !chord);
      c.mark.textContent = v.mark;
      c.pts.textContent = st.hasNotes && chord ? `${signed(st.points)}${st.bonus ? ` ＋${st.bonus}` : ''}` : '';
      c.col.title = st.hasNotes ? `${k + 1}番${chord ? `（${chord.name}）` : ''}: ${v.text}` : v.text;
    });
    for (const s of this.segs) {
      const it = result.steps[s.step].items.find((x) => x.index === s.index);
      const kind = it ? it.kind : 'none';
      s.el.className = `mn k-${kind}${s.seg.attack ? '' : ' held'}`;
      s.el.title = it && it.text ? it.text : `${s.seg.name}（${KIND_TEXT.none}）`;
    }
    // 変わった列を、ちょっと光らせる（次の更新で、もとにもどる）
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.cols.forEach((c) => c.col.classList.remove('flash')), 700);
    this.last = result;
  }

  // 再生位置（0〜1。1周のうち、どこか）。null で消す
  setPlayhead(fraction) {
    if (!this.playhead) return;
    if (fraction === null || fraction === undefined) { this.playhead.style.opacity = '0'; return; }
    this.playhead.style.opacity = '1';
    this.playhead.style.left = `${fraction * 100}%`;
    const step = Math.min(NUM_STEPS - 1, Math.floor(fraction * NUM_STEPS));
    if (step !== this._step) { this._step = step; this.cols.forEach((c, i) => c.col.classList.toggle('now', i === step)); }
  }

  // 「採点する」ボタンを、いま押せるか（和音が1つでもあるとき）
  setDoneEnabled(on) { if (this.doneBtn) this.doneBtn.disabled = !on; }
}

