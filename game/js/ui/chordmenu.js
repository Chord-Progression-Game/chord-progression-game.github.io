// 駒を右クリック（スマホでは、長押し）したときに出る、小さなメニュー（編集・削除・もとにもどす）。画面の部品だけ。
//   items: [{ label, onClick, danger?: true（2回押すと実行。まちがって消さないように）, hint? }]
//   touch: true（長押しで開いたとき）: 指の上にメニューが出るので、指を離したときの「押したこと」を、0.5秒のあいだ、無視する。メニューは、指のすぐ上に出す
import { h, clear } from './dom.js';

export class ChordMenu {
  constructor({ root }) {
    this.root = root;
    this.isOpen = false;
    this._armed = null;
    document.addEventListener('pointerdown', (e) => { if (this.isOpen && !this.root.contains(e.target)) this.close(); }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
  }

  open({ x, y, title = '', items = [], touch = false }) {
    clear(this.root);
    this._guardUntil = touch ? performance.now() + 500 : 0;
    if (title) this.root.append(h('div', { class: 'cm-title' }, title));
    for (const it of items) {
      const b = h('button', { class: `cm-item${it.danger ? ' danger' : ''}`, type: 'button', title: it.hint || '' }, it.label);
      b.addEventListener('click', () => {
        if (performance.now() < this._guardUntil) return;                          // 長押しで開いた直後の、指を離したときの「押したこと」は、無視する
        if (it.danger && this._armed !== b) {                                    // 削除は、2回押して実行
          if (this._armed) this._armed.textContent = this._armed.dataset.label;
          this._armed = b; b.dataset.label = it.label; b.textContent = 'もう一度押すと実行'; b.classList.add('armed');
          clearTimeout(this._armTimer); this._armTimer = setTimeout(() => { if (this._armed === b) { b.textContent = it.label; b.classList.remove('armed'); this._armed = null; } }, 3000);
          return;
        }
        this.close();
        it.onClick();
      });
      this.root.append(b);
    }
    this.root.classList.remove('hidden');
    this.isOpen = true;
    const w = this.root.offsetWidth, hh = this.root.offsetHeight;
    this.root.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`;
    const above = touch && y - hh - 24 >= 6;                                       // 指で開いたときは、指のすぐ上に（指でかくれないように）
    this.root.style.top = `${Math.max(6, Math.min(above ? y - hh - 24 : y, window.innerHeight - hh - 6))}px`;
    const first = this.root.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this._armed = null;
    clearTimeout(this._armTimer);
    this.root.classList.add('hidden');
    clear(this.root);
  }
}
