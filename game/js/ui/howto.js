// 使い方の画面（操作と機能の説明）。タイトルの「使い方」・上のバーの「？」・? キーで開く。
//   文字だけの説明（ガイド）のかわりに、絵（動く図）で見せる。ページごとに、図 + 短い文。◀ ▶・矢印キーで進む。Esc で閉じる。
//   図は、HTML と CSS だけ（画像ファイルなし）。色は、ゲームの駒の色（トニック = 黄・サブドミナント = 青・ドミナント = 赤）。動きは、css/howto.css。
//   画面の部品だけ。開く・閉じるときの状態は、呼ぶ側（app.js）が決める（取り込みの画面と同じやり方）。
import { h, clear } from './dom.js';

// ---- 図の部品 ----
const pc = (name, fn = 'T', cls = '') => h('span', { class: `ht-pc ${fn} ${cls}` }, name);
const cell = (n, content = null, cls = '', i = n - 1) => h('div', { class: `ht-cell ${cls}`, style: { '--i': i } }, h('i', {}, n), content);
// 8つの場所（盤）。items: { 番号(1〜): [名前, 働き] または 'target'（空きの目印）または null }
const board = (items = {}, { run = false, cols = 8, extra = [] } = {}) => h('div', { class: `ht-board${run ? ' run' : ''}`, style: { '--cols': cols } },
  ...Array.from({ length: cols }, (_, k) => {
    const it = items[k + 1];
    if (Array.isArray(it)) return cell(k + 1, pc(it[0], it[1], it[2] || ''));
    if (it === 'target') return cell(k + 1, null, 'target');
    return cell(k + 1, null, it === 'rest' ? 'rest' : 'empty');
  }), ...extra);
const tray = (names) => h('div', { class: 'ht-tray' }, ...names.map(([n, fn]) => pc(n, fn)));
const tag = (text, cls = '') => h('span', { class: `ht-tag ${cls}` }, text);
const row = (...kids) => h('div', { class: 'ht-row' }, ...kids);
const art = (...kids) => h('div', { class: 'ht-art' }, ...kids);

// ---- ページ ----
//   title: 見出し / lead: 1行の説明 / art: 図を作る関数 / notes: 短い説明（3つまで）
export const HOWTO_PAGES = [
  {
    id: 'intro', title: 'コードをならべて、技にする',
    lead: '下の駒（コード）を、上の8つの場所にならべます。つながりが「技」になると、点が入ります。',
    art: () => art(
      board({ 1: ['Ⅱm7', 'SD'], 2: ['Ⅴ7', 'D'], 3: ['ⅠM7', 'T'], 4: ['Ⅵm7', 'T'] }, { extra: [h('div', { class: 'ht-brace', style: { '--from': 1, '--span': 3 } }, tag('ツーファイブワン +400', 'trick'))] }),
      row(tag('得点 420', 'num'), tag('COMBO ×1.15', 'num'), tag('種類 2', 'num')),
      tray([['Ⅰ', 'T'], ['Ⅳ', 'SD'], ['Ⅴ7', 'D'], ['Ⅵm', 'T'], ['Ⅱm7', 'SD'], ['ⅠM7', 'T']])),
    notes: ['ならべた駒は、1番から8番まで、くり返し演奏されます。', '技が決まるたびに、得点とコンボがふえます。', '決まった技は、右の「図鑑」に集まります。'],
  },
  {
    id: 'place', title: '駒をおく',
    lead: '置きかたは3つ。やりやすいものを使ってください。',
    art: () => art(
      h('div', { class: 'ht-stage' },
        board({ 1: ['Ⅰ', 'T'], 2: 'target' }),
        h('div', { class: 'ht-gap' }),
        tray([['Ⅰ', 'T'], ['Ⅳ', 'SD'], ['Ⅴ7', 'D'], ['Ⅵm', 'T'], ['Ⅱm7', 'SD']]),
        h('div', { class: 'ht-fly' }, pc('Ⅴ7', 'D'))),
      row(tag('① ドラッグ'), tag('② 押す → 押す'), tag('③ ダブルクリック'))),
    notes: ['① 駒をつかんで、場所までドラッグして、はなします。', '② 駒を押して、置きたい場所を押します（スマホはこちらが楽です）。', '③ 下の駒をダブルクリック（2回タップ）すると、盤のいちばん右の駒の、つぎの場所に置かれます。置いた駒は、持ち上げて動かす・盤の外に出すと、はずれます。'],
  },
  {
    id: 'rest', title: '「→」と、休み',
    lead: '「→」は、前の和音をのばします。空きの場所は、休みです。',
    art: () => art(
      board({ 1: ['Ⅰ', 'T'], 2: ['→', 'R'], 3: 'rest', 4: ['Ⅳ', 'SD'] }, { cols: 4 }),
      h('div', { class: 'ht-wave' }, h('span', { class: 'long' }, 'Ⅰ をのばす（2マス）'), h('span', { class: 'gap' }, '休み'), h('span', { class: 'one' }, 'Ⅳ'))),
    notes: ['「→」の駒は、すぐ左の和音を、もう1マス、のばします。', '空きの場所は、和音が鳴らない休み。ドラムは、そのまま鳴ります。', '同じ駒を2つ続けても、「→」と同じ扱いで、点は同じです。'],
  },
  {
    id: 'play', title: '演奏と、ループ',
    lead: 'スペースキーで、演奏のオン・オフ。1番から8番まで進んで、また1番にもどります。',
    art: () => art(
      board({ 1: ['Ⅰ', 'T'], 2: ['Ⅵm', 'T'], 3: ['Ⅳ', 'SD'], 4: ['Ⅴ7', 'D'], 5: ['Ⅰ', 'T'], 6: ['Ⅵm', 'T'], 7: ['Ⅳ', 'SD'], 8: ['Ⅴ7', 'D'] }, { run: true }),
      h('div', { class: 'ht-loop' }, h('span', {}, '8番のあとは、1番へ（ループ）')),
      row(tag('スペース = 演奏', 'num'), tag('BPM 120', 'num'), tag('1マス = 2拍', 'num'))),
    notes: ['上の「− ＋」で、速さ（BPM）を変えられます。', '8番から1番へのつながり（ループのつなぎ目）も、技になります。', 'チュートリアルは、駒が4つ以内なら、4マスでループします。'],
  },
  {
    id: 'trick', title: '技と、得点',
    lead: '名前のついたつながりが「技」。ならべるほど、組み合わせるほど、点がふえます。',
    art: () => art(
      board({ 1: ['Ⅳ', 'SD'], 2: ['Ⅴ7', 'D'], 3: ['Ⅰ', 'T'] }, { extra: [
        h('div', { class: 'ht-brace', style: { '--from': 1, '--span': 2 } }, tag('ドミナントモーション +100', 'trick')),
        h('div', { class: 'ht-brace', style: { '--from': 2, '--span': 2 } }, tag('Ⅴ-Ⅰ終止 +200', 'trick'))] }),
      row(tag('技がつながる = COMBO ×1.15', 'num'), tag('種類がふえる = ボーナス', 'num'))),
    notes: ['盤の上の技の名前・右の「技」の一覧を押すと、くわしい説明と、その進行が使われている曲が出ます。', '同じ技のくり返しは、点が下がります。ちがう技をつなぐと、コンボと種類で、点がふえます。', '名前のつかないつながりも、耳に馴染むものは加点、進行感のないものは減点（ジャッジ）。'],
  },
  {
    id: 'hint', title: 'ヒント',
    lead: '次に置く場所に、候補の札が出ます。札を押すと、その駒が置かれます。',
    art: () => art(
      h('div', { class: 'ht-stage ghosts' },
        board({ 1: ['Ⅰ', 'T'], 2: ['Ⅵm', 'T'], 3: ['Ⅳ', 'SD'], 4: 'target' }),
        h('div', { class: 'ht-ghosts' },
          h('div', { class: 'g2' }, h('span', { class: 'ht-ghost' }, 'Ⅱm7'), h('span', { class: 'ht-ghost' }, 'Ⅳm7'), h('em', {}, '発展')),
          h('div', { class: 'g1' }, h('span', { class: 'ht-ghost on' }, 'Ⅰ'), h('span', { class: 'ht-ghost on' }, 'Ⅴ7'), h('em', {}, 'おすすめ'))))),
    notes: ['「ヒント」ボタン（H キー）で、オン・オフ。', '濃い札は、おすすめ（技が決まる・いつもの流れ）。うすい札は、発展（変わった続き。新しい発見）。', '下の駒にも、「おすすめ」「発展」の印が出ます。駒にマウスを乗せると、理由が見られます。'],
  },
  {
    id: 'split', title: '1つの場所を、前半と後半に',
    lead: '駒のある場所の、左がわ・右がわに別の駒を重ねると、1拍ずつの2つのコードになります。',
    art: () => art(
      h('div', { class: 'ht-split' },
        h('div', { class: 'ht-bigcell' }, pc('Ⅱm7', 'SD'), pc('Ⅴ7', 'D'), h('em', { class: 'a' }, '前半 1拍'), h('em', { class: 'b' }, '後半 1拍')),
        h('div', { class: 'ht-zones' },
          h('div', { class: 'z l' }, h('b', {}, '左がわ'), h('span', {}, '前半に')),
          h('div', { class: 'z m' }, h('b', {}, 'まん中'), h('span', {}, '置きかえ')),
          h('div', { class: 'z r' }, h('b', {}, '右がわ'), h('span', {}, '後半に'))))),
    notes: ['はずすときは、はずしたい側の駒を、持ち上げます。', 'フリープレイ・タイムアタック・チャレンジステージで使えます（実機の盤では、使えません）。', '分けたこと自体は、採点されません。技の判定は、前半・後半を、それぞれ1つのコードとして見ます。'],
  },
  {
    id: 'tray', title: '下の駒と、自作コード',
    lead: '駒は、むずかしさ（Lv.）の順にならんでいます。自分のコードも作れます。',
    art: () => art(
      h('div', { class: 'ht-lv' },
        ...[['Lv.1', [['Ⅰ', 'T'], ['Ⅳ', 'SD'], ['Ⅴ', 'D'], ['Ⅵm', 'T']]], ['Lv.2', [['ⅠM7', 'T'], ['Ⅱm', 'SD'], ['Ⅴ7', 'D']]], ['Lv.3', [['Ⅱm7', 'SD'], ['Ⅲ7', 'D']]], ['…', []]].map(([lv, ps]) => h('div', { class: 'col' }, h('b', {}, lv), ...ps.map(([n, fn]) => pc(n, fn)))),
        h('div', { class: 'col mine' }, h('b', {}, '自作'), h('span', { class: 'ht-plus' }, '＋'))),
      h('div', { class: 'ht-roll' }, ...[[6, 4, 1], [6, 3, 0], [6, 2, 0], [6, 1, 0], [52, 3, 1], [52, 2, 0], [52, 1, 0], [52, 0, 0]].map(([x, r, root]) => h('i', { class: root ? 'root' : '', style: { '--x': x, '--r': r } })), h('span', {}, '音を置いて、コードを作る'))),
    notes: ['「＋」か、駒を右クリック（スマホは長押し）で、コードの編集画面が開きます（フリープレイ）。', '自作したコードも、技・ジャッジ・ヒントの対象になります。', 'コードの難しさの加点は、技に使った駒にだけ、つきます。'],
  },
  {
    id: 'bar', title: '上のバーの道具',
    lead: '音・プリセット・メロディは、上のバーから。',
    art: () => art(
      h('div', { class: 'ht-bar' }, tag('ヒント OFF'), tag('☆ プリセット'), tag('♪ メロディ'), tag('♪ ピアノ ▾', 'on'), tag('音 50%')),
      h('div', { class: 'ht-menu' },
        ...[['音色', 'ピアノ'], ['ビート', '8ビート'], ['バッキング', 'ロング'], ['和音のつなぎ方', 'スムーズ（中）']].map(([k, v]) => h('div', { class: 'r' }, h('em', {}, k), h('b', {}, '◀  ', v, '  ▶'))))),
    notes: ['♪（音色）: 音色・ビート・バッキング・和音のつなぎ方を選びます。スムーズにすると、前の和音から、音の動きが少なくなるようにつなぎます。', '音: 全体・ドラム・バッキングの音量とミュート（M キー）。☆ プリセット: 気に入った進行の保存と呼び出し。', '♪ メロディ: メロディを自動でつけたり、書いたりできます（フリープレイ）。'],
  },
  {
    id: 'modes', title: 'あそびかた',
    lead: 'タイトルから、遊びかたを選びます。',
    art: () => art(
      h('div', { class: 'ht-modes' },
        ...[['学ぶ', 'チュートリアル', '技をひとつずつ'], ['選ぶ', 'チュートリアルを選ぶ', '好きな技から練習'], ['合わせる', 'メロディーにコードをつける', 'メロディに和音を'], ['挑む', 'チャレンジステージ', '条件を守って、ノルマへ'], ['遊ぶ', 'フリープレイ', '全部の駒で自由に'], ['競う', 'タイムアタック', '90秒で高得点']].map(([a, b, c]) => h('div', { class: 'm' }, h('b', {}, a), h('span', {}, b, h('em', {}, c)))))),
    notes: ['はじめてなら、「学ぶ」から。技の見つけかたを、ひとつずつ覚えられます。', '実機（駒を読み取る盤）をつなぐと、本物の駒を置いて遊べます（パソコンで、ブリッジを動かしているとき）。', 'この説明は、いつでも、タイトルの「使い方」か、上のバーの「？」から見られます。'],
  },
];

export class HowTo {
  constructor({ root, onOpen = () => {}, onClose = () => {}, canOpen = () => true, pages = HOWTO_PAGES }) {
    Object.assign(this, { root, onOpen, onClose, canOpen, pages });
    this.isOpen = false;
    this.index = 0;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });          // 外側（暗いところ）をクリックしても、閉じる
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { this.close(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { this.go(this.index + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.go(this.index - 1); e.preventDefault(); }
    });
  }

  open(index = 0) {
    if (this.isOpen) { this.go(index); return; }
    if (!this.canOpen()) return;                              // ほかの画面（メニュー・編集画面・結果など）が開いているときは、開かない
    this.isOpen = true;
    this.index = Math.max(0, Math.min(this.pages.length - 1, index));
    this.root.classList.remove('hidden');
    this.render();
    this.onOpen();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    clear(this.root);
    this.onClose();
  }

  go(i) {
    const n = Math.max(0, Math.min(this.pages.length - 1, i));
    if (n === this.index && this.root.firstChild) return;
    this.index = n;
    this.render();
  }

  render() {
    const p = this.pages[this.index], last = this.index === this.pages.length - 1;
    const card = h('div', { class: 'card ht-card', role: 'dialog', 'aria-label': '使い方', dataset: { page: p.id } },
      h('div', { class: 'ht-head' }, h('b', {}, '使い方'), h('h3', {}, p.title), h('span', { class: 'ht-count' }, `${this.index + 1} / ${this.pages.length}`),
        h('button', { class: 'chip', id: 'ht-close', onclick: () => this.close() }, '閉じる')),
      h('div', { class: 'ht-body' },
        h('p', { class: 'ht-lead' }, p.lead),
        p.art(),
        h('ul', { class: 'ht-notes' }, ...p.notes.map((n) => h('li', {}, n)))),
      h('div', { class: 'ht-foot' },
        h('button', { class: 'chip', id: 'ht-prev', disabled: this.index === 0, onclick: () => this.go(this.index - 1) }, '◀ まえ'),
        h('div', { class: 'ht-dots' }, ...this.pages.map((q, k) => h('button', { class: `ht-dot${k === this.index ? ' on' : ''}`, 'aria-label': `${k + 1}ページ: ${q.title}`, onclick: () => this.go(k) }))),
        h('button', { class: `chip${last ? ' primary' : ''}`, id: 'ht-next', onclick: () => (last ? this.close() : this.go(this.index + 1)) }, last ? '閉じる' : 'つぎ ▶')));
    clear(this.root).append(card);
    const body = card.querySelector('.ht-body'); if (body) body.scrollTop = 0;
  }
}
