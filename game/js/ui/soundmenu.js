// 音のメニュー（音色・ビート・バッキング）。上のバーの「♪」を押すと開く。
//   ◀ ▶ で、1つずつ切り替える。選んだものは、ステージの標準より優先（「ステージの標準にもどす」で、戻る）。
//   画面の部品だけ。何を選べるか・いま何か は、呼ぶ側（app.js）が model で渡す。選んだら onPick(kind, id) を呼ぶ。
import { h, clear } from './dom.js';

const ROWS = [['instrument', '音色'], ['drum', 'ビート'], ['backing', 'バッキング']];

export class SoundMenu {
  constructor({ root, button, label, getModel, onPick, onReset }) {
    Object.assign(this, { root, button, label, getModel, onPick, onReset });
    this.isOpen = false;
    button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    root.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.isOpen = true; this.root.classList.remove('hidden'); this.button.classList.add('on'); this.render(); }
  close() { this.isOpen = false; this.root.classList.add('hidden'); this.button.classList.remove('on'); }

  // 上のバーのボタンの文字（いまの音色）を、更新する
  refreshLabel() { const m = this.getModel(); const cur = m.instrument.options.find((o) => o.id === m.instrument.value); this.label.textContent = cur ? cur.name : ''; }

  render() {
    this.refreshLabel();
    if (!this.isOpen) return;
    const m = this.getModel();
    const box = clear(this.root);
    box.append(h('div', { class: 'sm-head' }, h('b', {}, 'サウンド'), h('span', {}, '音色とリズムをえらぶ')));
    for (const [kind, title] of ROWS) {
      const row = m[kind];
      const idx = Math.max(0, row.options.findIndex((o) => o.id === row.value));
      const cur = row.options[idx];
      const step = (d) => this.onPick(kind, row.options[(idx + d + row.options.length) % row.options.length].id);
      box.append(h('div', { class: `sm-row${row.isStageDefault ? ' is-default' : ''}`, dataset: { kind } },
        h('div', { class: 'sm-label' }, title, row.isStageDefault ? h('em', {}, 'ステージの標準') : null),
        h('div', { class: 'sm-pick' },
          h('button', { class: 'sm-arrow', 'aria-label': `${title}を前へ`, onclick: () => step(-1) }, '◀'),
          h('div', { class: 'sm-name' }, h('b', {}, cur ? cur.name : '—'), cur && cur.user ? h('i', {}, 'あなたが作った') : null),
          h('button', { class: 'sm-arrow', 'aria-label': `${title}を次へ`, onclick: () => step(1) }, '▶')),
        cur && cur.desc ? h('div', { class: 'sm-desc' }, cur.desc) : null));
    }
    box.append(h('div', { class: 'sm-foot' },
      h('button', { class: 'sm-reset', onclick: () => this.onReset() }, 'ステージの標準にもどす'),
      h('span', {}, 'リズム・コード編集の画面で名前をつけて「ゲームに送る」と、ここに増えます')));
  }
}
