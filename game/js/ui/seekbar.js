// シークバー（演奏の位置）。上のバーのすぐ下の真ん中（2026-11-25）。
//   演奏に合わせて、左から右へ動く（8つに区切った、8ステップぶんの帯。8番のあとは、1番にもどる）。
//   つかんで動かすと、DJ のように巻き戻し・早送りができる。動かしているあいだは演奏が止まって、巻き戻しの音だけが鳴る。はなすと、その位置から続く
//   画面の部品だけ。いまの位置は、呼ぶ側（app.js）が、毎フレーム update() で渡す。つかむ・動かす・はなすは、コールバックで知らせる:
//     onBegin(shownPos) → true なら、つかめた / onMove(pos) / onEnd(pos) / onKey({ delta | to })。pos は、周回の何マス目か（小数。1ステップ = 8マス）
import { h, clear } from './dom.js';

const SLOTS_PER_STEP = 8;
const MOVE_PX = 1.5;                                        // これより小さい指・マウスの動きは、動きとして数えない（止めているときの、ふるえで、音が鳴らないように）

export class SeekBar {
  constructor({ root, onBegin = () => false, onMove = () => {}, onEnd = () => {}, onKey = () => {} }) {
    Object.assign(this, { root, onBegin, onMove, onEnd, onKey });
    this.len = 64; this.pos = 0; this.enabled = false; this.dragging = false; this.pointerId = null; this.lastX = 0;
    this._shown = { step: -1, dir: 0, enabled: null, key: -1 };
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', '演奏の位置');
    root.setAttribute('aria-orientation', 'horizontal');
    root.title = 'ドラッグで、演奏の位置を動かします（左へ巻き戻し・右へ早送り）。はなすと、そこから続きます';
    this.build(this.len / SLOTS_PER_STEP);
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.finish(null));
    root.addEventListener('lostpointercapture', () => { if (this.dragging) this.finish(null); });
    root.addEventListener('keydown', (e) => this.key(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setEnabled(false);
  }

  // ステップの数（4 か 8）に合わせて、区切りを作りなおす
  build(steps) {
    this.steps = steps; this.len = steps * SLOTS_PER_STEP;
    this.fill = h('div', { class: 'sk-fill' });
    this.dirEl = h('span', { class: 'sk-dir', 'aria-hidden': 'true' });
    this.thumb = h('div', { class: 'sk-thumb' }, this.dirEl);
    this.track = h('div', { class: 'sk-track' },
      ...Array.from({ length: steps }, (_, i) => h('div', { class: `sk-seg${i === 3 && steps === 8 ? ' mid' : ''}` }, h('b', {}, String(i + 1)))),
      this.fill, this.thumb);
    clear(this.root).append(this.track);
    this.segs = [...this.track.querySelectorAll('.sk-seg')];
    this.root.setAttribute('aria-valuemin', '1');
    this.root.setAttribute('aria-valuemax', String(steps));
    this._shown.step = -1; this._shown.key = -1;
    this.setThumb(this.pos);
  }

  // 毎フレーム。info: { pos（周回の何マス目か）, len, enabled, dir（-1 巻き戻し・0・+1 早送り）}
  update(info) {
    if (info.len && info.len !== this.len && !this.dragging) this.build(Math.round(info.len / SLOTS_PER_STEP));
    this.setEnabled(!!info.enabled);
    if (!this.dragging) this.setThumb(info.enabled ? info.pos : 0);                // つかんでいる間は、指に合わせる
    const dir = this.dragging ? (info.dir || 0) : 0;
    if (dir !== this._shown.dir) {
      this._shown.dir = dir;
      this.root.classList.toggle('dir-back', dir < 0); this.root.classList.toggle('dir-fwd', dir > 0);
      this.dirEl.textContent = dir < 0 ? '◀◀' : dir > 0 ? '▶▶' : '';
    }
  }

  setEnabled(on) {
    if (on === this._shown.enabled) return;
    this._shown.enabled = on; this.enabled = on;
    this.root.classList.toggle('is-disabled', !on);
    this.root.setAttribute('aria-disabled', on ? 'false' : 'true');
    this.root.tabIndex = on ? 0 : -1;
    if (!on && this.dragging) this.finish(null);
  }

  setThumb(pos) {
    this.pos = Math.max(0, Math.min(this.len, pos));
    const f = this.len ? this.pos / this.len : 0;
    const key = Math.round(f * 2000);                                               // 0.05% きざみ（帯の幅 450px で、約 0.2px）。変わらないあいだは、書かない（毎フレームの、画面の再計算を、へらす）
    if (key !== this._shown.key) {
      this._shown.key = key;
      this.thumb.style.left = `${(f * 100).toFixed(3)}%`;
      this.fill.style.width = `${(f * 100).toFixed(3)}%`;
    }
    const step = Math.min(this.steps - 1, Math.floor(this.pos / SLOTS_PER_STEP));
    if (step !== this._shown.step) {                                                // 値の読み上げは、ステップが変わったときだけ
      this._shown.step = step;
      this.segs.forEach((el, i) => el.classList.toggle('now', i === step));                // いまのステップの数字を、差し色に
      this.root.setAttribute('aria-valuenow', String(step + 1));
      this.root.setAttribute('aria-valuetext', `${step + 1}番`);
    }
  }

  // 指・マウスの位置 → 周回の何マス目か（小数）
  posOf(e) {
    const r = this.track.getBoundingClientRect();
    const f = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    return Math.max(0, Math.min(1, f)) * this.len;
  }

  down(e) {
    if (!this.enabled || this.dragging) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (!this.onBegin(this.pos)) return;                                            // つかめなかった（演奏していない など）
    this.dragging = true; this.pointerId = e.pointerId; this.lastX = e.clientX;
    try { this.root.setPointerCapture(e.pointerId); } catch (err) { /* 何もしない */ }
    this.root.classList.add('is-scrubbing');
    const pos = this.posOf(e);
    this.setThumb(pos);
    this.onMove(pos);                                                               // バーの途中を押したときは、そこへ飛ぶ（短い「ひゅっ」という音）
  }

  move(e) {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    if (Math.abs(e.clientX - this.lastX) < MOVE_PX) return;                         // ふるえは、動きにしない（動かさずに止めているあいだは、無音）
    this.lastX = e.clientX;
    const pos = this.posOf(e);
    this.setThumb(pos);
    this.onMove(pos);
  }

  up(e) {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.finish(this.posOf(e));
  }

  // はなした（pos: はなした位置。null = つかんでいた位置のまま）
  finish(pos) {
    if (!this.dragging) return;
    const id = this.pointerId;
    this.dragging = false; this.pointerId = null;
    this.root.classList.remove('is-scrubbing');
    try { if (id !== null && this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id); } catch (err) { /* 何もしない */ }
    this.onEnd(pos === null ? this.pos : pos);
    if (document.activeElement === this.root) this.root.blur();                      // つかんだあとも、スペース・M などのショートカットが効くように
  }

  // 画面が切りかわるときなど: つかんでいたら、そこではなす
  cancel() { this.finish(null); }

  // キーボード（バーに、フォーカスがあるとき）: ← → で 1ステップ・Home・End
  key(e) {
    if (!this.enabled) return;
    let a = null;
    if (e.key === 'ArrowLeft') a = { delta: -SLOTS_PER_STEP };
    else if (e.key === 'ArrowRight') a = { delta: SLOTS_PER_STEP };
    else if (e.key === 'Home') a = { to: 0 };
    else if (e.key === 'End') a = { to: this.len - SLOTS_PER_STEP };
    else if (e.key === 'Escape') { this.root.blur(); return; }
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    this.onKey(a);
  }
}
