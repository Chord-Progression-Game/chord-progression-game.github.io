// ゲーム用のライブラリ（リズム・コード編集の画面で、名前をつけて作った、ドラム・バッキング・固有進行）を、ブリッジから受け取る。
//   ・GET /api/library で、全部を読む。変わったら、ブリッジが SSE（/api/events）で `library` の知らせを流す → すぐ読み直す（リアルタイム）。
//   ・知らせが届かなくても、数秒ごとに読み直して、追いつく。ブリッジにつながっていなければ、何も起きない（標準の内容で遊べる）。
//   ・公開ページ（https）には、ブリッジがない。そこでは、リンク・ファイル・貼り付けで「取り込んだ」内容（ブラウザに保存。net/share.js）と、
//     全端末で共通の「公開ライブラリ」（リズム・コード編集の画面から、リアルタイムで届く。net/cloud.js）を、混ぜて、ライブラリとして使う（local + cloud）。
import { bridgeAvailable } from './device.js';

export class LibraryLink {
  constructor({ onChange, local = null, cloud = null }) {
    this.onChange = onChange;
    this.local = local;           // 公開ページ用: 取り込んだ内容 { drums, backings, progressions } を返す関数
    this.cloud = cloud;           // 公開ページ用: 公開ライブラリ（全端末で共通。リアルタイムで届く）の内容を返す関数
    this.forceLocal = false;      // true なら、ブリッジのある場所でも、local + cloud を使う（テスト・手元の確認用）
    this.localSeq = 0;
    this.seq = -1;
    this.lib = { seq: 0, drums: [], backings: [], progressions: [] };
    this.available = false;       // ブリッジのライブラリに、つながっているか
    this._busy = false;
  }

  start() {
    if (!bridgeAvailable() || this.forceLocal) { this.reloadLocal(); return; }          // 公開ページ（https）には、ブリッジがない: 取り込んだ内容・公開ライブラリを使う
    this.reload();
    if (!this._timer) this._timer = setInterval(() => this.reload(), 6000);
  }

  // 公開ページ: 取り込んだ内容（ブラウザに保存）を、ライブラリとして反映する。取り込み・削除のあとに、呼ぶ
  reloadLocal() {
    if ((bridgeAvailable() && !this.forceLocal) || (!this.local && !this.cloud)) return;
    const l = (this.local && this.local()) || {}, c = (this.cloud && this.cloud()) || {};
    const prev = this.lib;
    const both = (k) => [...(c[k] || []), ...(l[k] || [])];          // 公開ライブラリ（id は 5000 から）→ 取り込んだもの（id は 1 から）の順
    this.lib = { seq: ++this.localSeq, drums: both('drums'), backings: both('backings'), progressions: both('progressions') };
    this.seq = this.lib.seq;
    this.onChange(this.lib, prev);
  }

  // SSE の知らせ（{type:'library', seq}）が届いたとき
  notify(ev) { if (ev && ev.type === 'library' && ev.seq !== this.seq) this.reload(); }

  async reload() {
    if (this._busy) { this._again = true; return; }
    this._busy = true;
    try {
      const r = await fetch('/api/library', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      this.available = !!d.ok;
      if (d.ok) this.apply(d.library);
    } catch (e) { this.available = false; }
    this._busy = false;
    if (this._again) { this._again = false; this.reload(); }
  }

  apply(lib) {
    if (!lib || lib.seq === this.seq) return;
    const prev = this.lib;
    this.seq = lib.seq;
    this.lib = { seq: lib.seq, drums: lib.drums || [], backings: lib.backings || [], progressions: lib.progressions || [] };
    this.onChange(this.lib, prev);
  }
}

// ライブラリの id（'d3' など）→ ゲームの音のパターン番号（1000 + 3）。もとからある 1〜20 と、重ならない
export const userPatternId = (id) => 1000 + (parseInt(String(id).replace(/\D/g, ''), 10) || 0);
export const isUserPatternId = (n) => n >= 1000;

// ライブラリの内容を、音のパターンの一覧（presets.drums / presets.backings）に入れる。前回の、ユーザーのものは、入れ替える（同じ配列を、そのまま直す）
export function mergeUserPatterns(presets, lib) {
  const put = (list, items, make) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].user) list.splice(i, 1);
    for (const it of items) list.push(make(it));
  };
  put(presets.drums, lib.drums, (it) => ({ id: userPatternId(it.id), name: it.name, length: it.length, lanes: it.lanes, user: true, libId: it.id }));
  put(presets.backings, lib.backings, (it) => ({ id: userPatternId(it.id), name: it.name, length: it.length, cells: it.cells, user: true, libId: it.id }));
}

// 前回と、今回の違い（新しく届いた・内容が変わった）の名前。画面に「受け取りました」と出すのに使う
export function libraryChanges(prev, cur) {
  const out = [];
  const sig = (x) => JSON.stringify(x);
  for (const [kind, label] of [['drums', 'ドラム'], ['backings', 'バッキング'], ['progressions', '進行']]) {
    const before = new Map((prev[kind] || []).map((x) => [x.id, sig(x)]));
    for (const it of cur[kind] || []) {
      if (!before.has(it.id)) out.push({ label, name: it.name, isNew: true });
      else if (before.get(it.id) !== sig(it)) out.push({ label, name: it.name, isNew: false });
    }
  }
  return out;
}
