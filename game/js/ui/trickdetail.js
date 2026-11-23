// 技の詳細の画面。盤の上の技の枠（名前と点数の四角）・右の「技」の一覧の行・「理由」の欄の「くわしく」を押すと開く。
//   ・どんな技か / いつ決まるか / この盤での点数のしくみ / 固有進行なら、その進行が使われている曲（名前だけ。歌詞・メロディは出さない）
//   画面の部品だけ。中身は core/trickinfo.js（trickDetail）が作る。
import { h, clear } from './dom.js';
import { trickDetail } from '../core/trickinfo.js';
import { SONGS } from '../core/songs.js';

const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

export class TrickDetail {
  constructor({ root, onOpen = () => {}, onClose = () => {}, audition = null }) {
    Object.assign(this, { root, onOpen, onClose, audition });
    this.isOpen = false;
    this.current = null;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });          // 外側（暗いところ）をクリックしても、閉じる
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
  }

  show(ins) {
    const d = trickDetail(ins);
    if (!d) return false;
    this.current = ins;
    this.build(d);
    this.root.classList.remove('hidden');
    if (!this.isOpen) { this.isOpen = true; this.onOpen(); }
    const body = this.root.querySelector('.td-body'); if (body) body.scrollTop = 0;
    return true;
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false; this.current = null;
    this.root.classList.add('hidden');
    clear(this.root);
    this.onClose();
  }

  build(d) {
    const card = h('div', { class: 'card td-card', role: 'dialog', 'aria-label': `${d.name}の詳細`, style: { '--c': d.color } });
    const head = h('div', { class: 'td-head' },
      h('div', { class: 'td-titles' },
        h('span', { class: 'td-group' }, d.groupLabel),
        h('h3', { id: 'td-name' }, d.name, d.sub ? h('small', {}, d.sub) : null),
        h('div', { class: 'td-chords', id: 'td-chords' }, d.chordsLine, d.symbolsLine ? h('small', {}, d.symbolsLine) : null)),
      h('button', { class: 'chip', id: 'td-close', onclick: () => this.close() }, '閉じる'));
    const body = h('div', { class: 'td-body' });

    if (d.warn) {
      body.append(this.section('どうして「？」？', h('p', {}, d.explain)),
        this.section('いつ出る？', h('p', {}, d.condition)),
        this.section('点数', h('p', {}, `${signed(d.total)}点（減点）。場所: ${d.positions.join('・')}番`)));
    } else {
      body.append(this.section('どんな技？', h('p', {}, d.explain), d.groupNote ? h('p', { class: 'td-note' }, d.groupNote) : null));
      if (d.variants.length > 1 || (d.variants.length === 1 && !d.variants[0].here)) {
        body.append(this.section('形のちがい', ...d.variants.map((v) => h('div', { class: `td-var${v.here ? ' here' : ''}` }, h('b', {}, v.name, v.here ? h('em', {}, 'いま盤にある形') : null), h('p', {}, v.text)))));
      }
      body.append(this.section('いつ決まる？', h('p', {}, d.condition)));
      body.append(this.pointsSection(d));
      body.append(this.songsSection(d));
    }
    card.append(head, body);
    clear(this.root).append(card);
  }

  section(title, ...children) { return h('section', { class: 'td-sec' }, h('h4', {}, title), ...children.filter(Boolean)); }

  // 点数: 基本の点 → 同じ種類の技の繰り返し・コンボの倍率 → この盤での点
  pointsSection(d) {
    const p = d.points;
    const rows = [h('div', { class: 'td-pts' },
      h('span', {}, '基本の点'), h('b', {}, `${p.base}`),
      p.extra ? [h('span', {}, '形の上乗せ'), h('b', {}, signed(p.extra))] : null,
      h('span', {}, '同じ種類の繰り返し'), h('b', {}, `×${p.repeatMult}`),
      h('span', {}, 'コンボ'), h('b', {}, `×${p.comboMult}`),
      h('span', { class: 'sum' }, 'この盤での点'), h('b', { class: 'sum' }, `${p.total}`))];
    return this.section('点数のしくみ', ...rows,
      h('p', { class: 'td-note' }, `同じ種類の技は、2回目から点が下がります（${p.repeatRule.map((m) => `×${m}`).join('・')}…）。隣り合う技が駒をつないでいるとコンボの倍率がつきます。${d.seam ? 'ループのつなぎ目の技は、単独で、コンボには数えません。' : ''}`));
  }

  // この進行が使われている曲の例（固有進行など。名前だけ）
  songsSection(d) {
    const s = d.songs;
    if (!s) {
      if (d.group === 'named' && !d.custom) return this.section('この進行が使われている曲', h('p', { class: 'td-note' }, '曲の例は、まだ調べていません。'));
      return null;
    }
    const intro = [];
    if (s.viaMaruSa) intro.push(h('p', { class: 'td-note' }, 'ⅣM7 → Ⅲ7 → Ⅵm7 の形は「丸サ進行」と呼ばれます。次の曲が、この形を使っています。'));
    intro.push(h('p', { class: 'td-note' }, '曲の一部分（サビ・Aメロなど）で使われていることが多く、調やコードの細かい形は曲ごとに違います。資料に載っていた例で、歌詞やメロディは出していません。'));
    if (s.noJapanese) intro.push(h('p', { class: 'td-note warn' }, '日本の曲の例は、確認できていません。'));
    const list = h('ul', { class: 'td-songs', id: 'td-songs' }, ...s.list.map((x) => h('li', { class: x.en ? 'en' : 'jp' },
      h('span', { class: 'st' }, x.t), h('span', { class: 'sa' }, x.a),
      x.part ? h('span', { class: 'sp' }, x.part) : null, x.note ? h('span', { class: 'sn' }, x.note) : null)));
    return this.section(`この進行が使われている曲（${s.list.length}）`, ...intro, list, h('p', { class: 'td-src' }, `資料: ${s.sourceLabels.join(' / ')}`));
  }
}

export { SONGS };
