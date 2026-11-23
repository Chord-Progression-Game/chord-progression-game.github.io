// 音量のメニュー。上のバーの「音」のボタンを押すと開く。ミュート（M キーと同じ）と、全体の音量のバー（0〜100%）。
//   画面の部品だけ。いまの値は、呼ぶ側（app.js）が getModel() で渡す。変えたら onVolume(%) / onMute() を呼ぶ。
//   バーをつかんでいる間に作りなおすと、つかんだ手がはずれるので、開いたときに1回だけ作って、あとは refresh() で、文字だけ更新する。
import { h, clear } from './dom.js';

export class VolumeMenu {
  constructor({ root, button, getModel, onVolume, onMute, onRelease = () => {} }) {
    Object.assign(this, { root, button, getModel, onVolume, onMute, onRelease });
    this.isOpen = false;
    button.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    root.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.isOpen = true; this.root.classList.remove('hidden'); this.button.classList.add('menu-open'); this.build(); }
  close() { this.isOpen = false; this.root.classList.add('hidden'); this.button.classList.remove('menu-open'); }

  build() {
    const m = this.getModel();
    this.slider = h('input', { class: 'vm-slider', id: 'vm-slider', type: 'range', min: '0', max: '100', step: '1', value: String(m.percent), 'aria-label': '全体の音量' });
    this.slider.addEventListener('input', () => this.onVolume(Number(this.slider.value)));
    this.slider.addEventListener('change', () => this.onRelease());                 // はなしたとき: 音を1つ鳴らして、大きさを聴けるように
    this.slider.addEventListener('pointerup', () => this.slider.blur());            // つかんだあと、M キーなどのショートカットが効くように
    this.readout = h('b', { class: 'vm-readout', id: 'vm-readout' });
    this.muteBtn = h('button', { class: 'vm-mute', id: 'vm-mute', onclick: () => this.onMute() });
    clear(this.root).append(
      h('div', { class: 'sm-head' }, h('b', {}, '音量'), h('span', {}, '全体の大きさ')),
      h('div', { class: 'vm-row' }, h('span', { class: 'vm-lo', 'aria-hidden': 'true' }, '小'), this.slider, h('span', { class: 'vm-hi', 'aria-hidden': 'true' }, '大'), this.readout),
      h('div', { class: 'sm-foot' }, this.muteBtn, h('span', {}, 'M キーでもミュートできます')));
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
  }
}
