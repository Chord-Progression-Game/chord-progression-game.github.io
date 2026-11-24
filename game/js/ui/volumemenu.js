// 音量のメニュー。上のバーの「音」のボタンを押すと開く。ミュート（M キーと同じ）と、音量のバー3本（全体・ドラム・バッキング。どれも 0〜100%）。
//   画面の部品だけ。いまの値は、呼ぶ側（app.js）が getModel() で渡す。変えたら onVolume(%) / onMix(kind, %) / onMute() を呼ぶ。
//   ドラム・バッキングのバーは、はじめの値が 50%（これまでと同じ大きさ）。100% で 2倍・0% で無音（engine.js の mixGainFor）
//   バーをつかんでいる間に作りなおすと、つかんだ手がはずれるので、開いたときに1回だけ作って、あとは refresh() で、文字だけ更新する。
import { h, clear } from './dom.js';
import { mountPopup } from './layout.js';

const MIXES = [
  { kind: 'drums', label: 'ドラム', aria: 'ドラムの音量' },
  { kind: 'backing', label: 'バッキング', aria: 'バッキング（和音の伴奏）の音量' },
];

export class VolumeMenu {
  constructor({ root, button, getModel, onVolume, onMute, onMix = () => {}, onMixReset = () => {}, onRelease = () => {} }) {
    Object.assign(this, { root, button, getModel, onVolume, onMute, onMix, onMixReset, onRelease });
    this.isOpen = false;
    this.home = root.parentElement;                      // スマホでは、開くときに、画面の直下へ移す（soundmenu.js と同じ理由）
    button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    root.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.isOpen = true; mountPopup(this.root, this.home); this.root.classList.remove('hidden'); this.button.classList.add('menu-open'); this.build(); }
  close() { this.isOpen = false; this.root.classList.add('hidden'); this.button.classList.remove('menu-open'); }

  // バー1本（名前・つまみ・いまの値）。つかんだあと、M キーなどのショートカットが効くように blur する。はなしたときは、onRelease(kind)
  _slider(id, aria, kind, value, onInput) {
    const el = h('input', { class: 'vm-slider', id, type: 'range', min: '0', max: '100', step: '1', value: String(value), 'aria-label': aria });
    el.addEventListener('input', () => onInput(Number(el.value)));
    el.addEventListener('change', () => this.onRelease(kind));                      // はなしたとき: 音を鳴らして、大きさを聴けるように
    el.addEventListener('pointerup', () => el.blur());
    return el;
  }

  build() {
    const m = this.getModel();
    this.slider = this._slider('vm-slider', '全体の音量', 'master', m.percent, (v) => this.onVolume(v));
    this.readout = h('b', { class: 'vm-readout', id: 'vm-readout' });
    this.muteBtn = h('button', { class: 'vm-mute', id: 'vm-mute', onclick: () => this.onMute() });
    this.mix = {};
    const rows = MIXES.map(({ kind, label, aria }) => {
      const slider = this._slider(`vm-${kind}`, aria, kind, (m.mix || {})[kind] ?? m.mixDefault, (v) => this.onMix(kind, v));
      const readout = h('b', { class: 'vm-readout', id: `vm-${kind}-readout` });
      this.mix[kind] = { slider, readout };
      return h('div', { class: 'vm-row vm-mixrow', dataset: { kind } }, h('label', { class: 'vm-label', for: `vm-${kind}` }, label), slider, readout);
    });
    this.resetBtn = h('button', { class: 'vm-mute vm-mixreset', id: 'vm-mixreset', onclick: () => this.onMixReset() }, 'ドラム・バッキングを標準にもどす');
    clear(this.root).append(
      h('div', { class: 'sm-head' }, h('b', {}, '音量'), h('span', {}, '全体・ドラム・バッキング'), h('button', { class: 'sm-close', 'aria-label': '閉じる', onclick: () => this.close() }, '閉じる')),
      h('div', { class: 'vm-row' }, h('label', { class: 'vm-label', for: 'vm-slider' }, '全体'), this.slider, this.readout),
      h('div', { class: 'vm-mixbox' }, ...rows),
      h('div', { class: 'sm-foot' }, this.muteBtn, this.resetBtn, h('span', {}, 'ドラム・バッキングは、50% が標準の大きさです（100% で 2倍・0% で無音）。M キーでもミュートできます')));
    this.refresh();
  }

  // 値が変わったとき（M キーなど）に、開いている画面を合わせる
  refresh() {
    if (!this.isOpen || !this.slider) return;
    const m = this.getModel();
    if (document.activeElement !== this.slider) this.slider.value = String(m.percent);
    this.readout.textContent = m.muted ? 'ミュート' : `${m.percent}%`;
    this.root.classList.toggle('is-muted', !!m.muted);
    this.muteBtn.textContent = m.muted ? 'ミュートを解除' : 'ミュートする';
    let allDefault = true;
    for (const { kind } of MIXES) {
      const v = (m.mix || {})[kind] ?? m.mixDefault;
      const { slider, readout } = this.mix[kind];
      if (document.activeElement !== slider) slider.value = String(v);
      readout.textContent = `${v}%`;
      if (v !== m.mixDefault) allDefault = false;
    }
    this.resetBtn.disabled = allDefault;
  }
}
