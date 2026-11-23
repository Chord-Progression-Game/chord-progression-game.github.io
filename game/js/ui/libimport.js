// 取り込みの画面（公開ページ用）。リズム・コード編集の画面で作った、ドラム・バッキング・進行を、リンク・コード・ファイルから、ゲームに取り込む。
//   取り込んだものの一覧（種類・名前・削除）も出す。中身の読み書き・検査は net/share.js、保存・反映は app.js。ここは、画面の部品だけ。
//   onPreview(text) → { ok, error?, counts: { drums, backings, progressions, skipped } }（貼り付けた内容の、取り込む前の確認）
//   onImport(text)  → { ok, error?, added, updated, full, skipped }（取り込む。成功なら、保存・反映ずみ）
//   onRemove(kind, id) → 削除（保存・反映ずみ）
//   getCloud() → { enabled, state, lib }（公開ライブラリ: 全端末で共通。リアルタイムで届く。net/cloud.js。読むだけ）
import { h, clear } from './dom.js';
import { KIND_LABEL } from '../net/share.js';

const SUMMARY = (c) => `ドラム ${c.drums}・バッキング ${c.backings}・進行 ${c.progressions}${c.skipped ? `（読み込めないもの ${c.skipped}）` : ''}`;

export class LibImport {
  constructor({ root, getLibrary, onPreview, onImport, onRemove, getCloud = () => ({ enabled: false, state: 'off', lib: null }), onOpen = () => {}, onClose = () => {}, canOpen = () => true }) {
    Object.assign(this, { root, getLibrary, onPreview, onImport, onRemove, getCloud, onOpen, onClose, canOpen });
    this.isOpen = false;
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });          // 外側（暗いところ）をクリックしても、閉じる
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) { this.close(); e.preventDefault(); } });
  }

  // text: 最初から入れておく内容（リンクを開いて来たとき）
  open({ text = '' } = {}) {
    if (this.isOpen) { if (text) { this.ta.value = text; this.preview(); } return; }
    if (!this.canOpen()) return;                              // ほかの画面（メニュー・編集画面・結果など）が開いているときは、開かない
    this.isOpen = true;
    this.build(text);
    this.root.classList.remove('hidden');
    this.onOpen();
    this.preview();
    if (text && this.applyBtn) this.applyBtn.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    clear(this.root);
    this.onClose();
  }

  build(text) {
    this.ta = h('textarea', { class: 'li-text', id: 'li-text', rows: '4', spellcheck: 'false', placeholder: 'ここに、リンクかコードを貼り付けます（j1. で始まる文字、または JSON）', 'aria-label': 'リンクかコード' });
    this.ta.value = text;
    this.ta.addEventListener('input', () => this.preview());
    this.msg = h('div', { class: 'li-msg', id: 'li-msg', role: 'status' });
    this.file = h('input', { type: 'file', accept: '.json,application/json,text/plain', id: 'li-file', class: 'li-file' });
    this.file.addEventListener('change', () => { const f = this.file.files && this.file.files[0]; if (f) this.readFile(f); this.file.value = ''; });
    this.applyBtn = h('button', { class: 'chip primary', id: 'li-apply', onclick: () => this.apply() }, '取り込む');
    this.listBox = h('div', { class: 'li-list', id: 'li-list' });
    this.cloudBox = h('div', { class: 'li-list li-cloud', id: 'li-cloud' });
    clear(this.root).append(h('div', { class: 'card li-card', role: 'dialog', 'aria-label': 'リズムの取り込み' },
      h('div', { class: 'pm-head' }, h('b', {}, 'リズム・コード編集の内容を取り込む'), h('button', { class: 'chip', id: 'li-close', onclick: () => this.close() }, '閉じる')),
      h('p', { class: 'li-note' }, 'パソコンの「リズム・コード編集」の画面で作ったドラム・バッキング・進行を、このゲームに入れます。編集の画面の「公開ページのゲームにも送る」で、リンクかファイルを作って、ここに貼り付けるか、リンクを開いてください。取り込んだものは、このブラウザに保存されます。'),
      this.ta,
      h('div', { class: 'li-row' }, h('label', { class: 'chip li-file-label' }, 'ファイルを選ぶ', this.file), this.applyBtn),
      this.msg,
      h('h4', { class: 'li-h' }, '取り込んだもの'),
      this.listBox,
      h('h4', { class: 'li-h' }, '公開ライブラリ（全部の端末に、自動で届くもの）'),
      this.cloudBox));
    this.renderList();
  }

  say(text, cls = '') { if (this.msg) { this.msg.textContent = text; this.msg.className = `li-msg ${cls}`; } }

  // 貼り付けた内容の、取り込む前の確認（読めるか・いくつあるか）
  preview() {
    if (!this.isOpen) return;
    const t = this.ta.value.trim();
    if (!t) { this.say(''); this.applyBtn.disabled = true; return; }
    const r = this.onPreview(t);
    if (!r.ok) { this.say(r.error, 'err'); this.applyBtn.disabled = true; return; }
    this.say(`この内容を取り込みます: ${SUMMARY(r.counts)}`, 'ok');
    this.applyBtn.disabled = r.counts.drums + r.counts.backings + r.counts.progressions === 0;
  }

  apply() {
    const r = this.onImport(this.ta.value);
    if (!r.ok) { this.say(r.error, 'err'); return; }
    const parts = [];
    if (r.added.length) parts.push(`${r.added.length}つ ふやしました`);
    if (r.updated.length) parts.push(`${r.updated.length}つ 上書きしました`);
    if (r.full.length) parts.push(`${r.full.length}つ は、入りきらないので、とばしました（いらないものを削除してください）`);
    if (r.skipped) parts.push(`読み込めないもの ${r.skipped}つ`);
    this.say(`取り込みました: ${parts.join('・') || '変わりありません'}。ゲームの「♪」のメニューや、図鑑に、増えています。`, 'ok');
    this.ta.value = '';
    this.applyBtn.disabled = true;
    this.renderList();
  }

  readFile(file) {
    if (file.size > 400000) { this.say('ファイルが大きすぎます', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => { this.ta.value = String(rd.result || ''); this.preview(); };
    rd.onerror = () => this.say('ファイルを読めませんでした', 'err');
    rd.readAsText(file);
  }

  renderList() {
    if (!this.listBox) return;
    const lib = this.getLibrary();
    clear(this.listBox);
    const groups = [['drum', lib.drums], ['backing', lib.backings], ['progression', lib.progressions]];
    let total = 0;
    for (const [kind, items] of groups) {
      for (const it of items || []) {
        total++;
        this.listBox.append(h('div', { class: 'li-item', dataset: { kind, id: it.id } },
          h('span', { class: 'li-kind' }, KIND_LABEL[kind]), h('span', { class: 'li-name' }, it.name),
          h('button', { class: 'chip li-del', onclick: () => { this.onRemove(kind, it.id); this.renderList(); } }, '削除')));
      }
    }
    if (!total) this.listBox.append(h('p', { class: 'li-empty' }, 'まだ、ありません。'));
    this.renderCloud();
  }

  // 公開ライブラリ: 状態と、届いているもの（読むだけ。削除はできない。作った人が、編集の画面で、消す）
  renderCloud() {
    if (!this.cloudBox) return;
    const c = this.getCloud();
    clear(this.cloudBox);
    if (!c.enabled && !(c.lib && (c.lib.drums.length + c.lib.backings.length + c.lib.progressions.length))) {
      this.cloudBox.append(h('p', { class: 'li-empty', id: 'li-cloud-state' }, 'このゲームには、設定されていません。'));
      return;
    }
    const STATE = { live: 'つながっています。編集の画面で変えると、すぐ届きます。', polling: '数秒ごとに、確かめています。', connecting: 'つなげています…', offline: 'つながっていません。前に届いたものを、使っています。', off: '' };
    this.cloudBox.append(h('p', { class: `li-cloudstate ${c.state}`, id: 'li-cloud-state' }, STATE[c.state] || ''));
    const lib = c.lib || { drums: [], backings: [], progressions: [] };
    let total = 0;
    for (const [kind, items] of [['drum', lib.drums], ['backing', lib.backings], ['progression', lib.progressions]]) {
      for (const it of items || []) {
        total++;
        this.cloudBox.append(h('div', { class: 'li-item cloud', dataset: { kind, id: it.id } }, h('span', { class: 'li-kind' }, KIND_LABEL[kind]), h('span', { class: 'li-name' }, it.name)));
      }
    }
    if (!total) this.cloudBox.append(h('p', { class: 'li-empty' }, 'まだ、届いていません。'));
  }
}
