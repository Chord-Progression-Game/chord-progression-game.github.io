// 公開ページのゲームが、「全端末で共通のライブラリ」を、リアルタイムで受け取る（2026-11-24）。
//   リズム・コード編集の画面（自分の Mac）で、名前をつけて作った、ドラム・バッキング・進行が、ブリッジ（tools/cloud_sync.py）から Firebase Realtime Database に書きこまれる。
//   ここは、それを「読むだけ」（書きこむ道は、ない）。読み方:
//     ① EventSource でつなぎっぱなしにする → 変わった瞬間に、届く（Firebase の REST ストリーミング。event: put）
//     ② つなぎっぱなしが切れたとき・つながらないときは、数秒ごとに fetch で読み直す（ポーリング）
//   受け取った内容は、取り込み（リンク・ファイル）と同じ厳しさで、検査する（net/share.js の cleanDrum など）。コードのような、動くものは、受け取らない。
//   設定: game/cloud.json の { url, path }。url が空なら、何もしない（これまでどおり）。url は、公開されてよい（読む側の入り口）。書きこむための秘密のキーは、ここには、ない
import { SHARE_APP, SHARE_VERSION, LIMITS, PREFIX, cleanDrum, cleanBacking, cleanProgression } from './share.js';

export const CLOUD_HOST_OK = /^https:\/\/[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/;
export const CLOUD_PATH_OK = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,4}$/;
export const CLOUD_ID_BASE = 5000;                        // 公開ライブラリの id は、'd5003' のように、5000 から（取り込んだものの id と重ならない。パターン番号は 1000 + 数字）
export const DEFAULT_CLOUD_PATH = 'chordlines/library';

// game/cloud.json の中身（と、テスト用の上書き）→ { url, path } か null（使わない）
//   allowLocal: テストのときだけ、127.0.0.1 の http を許す
export function parseCloudConfig(obj, { allowLocal = false } = {}) {
  if (!obj || typeof obj !== 'object' || typeof obj.url !== 'string') return null;
  const url = obj.url.trim().replace(/\/+$/, '');
  if (!url) return null;
  const local = allowLocal && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
  if (!local && !CLOUD_HOST_OK.test(url)) return null;
  const path = (typeof obj.path === 'string' && obj.path.trim() ? obj.path.trim().replace(/^\/+|\/+$/g, '') : DEFAULT_CLOUD_PATH);
  if (!CLOUD_PATH_OK.test(path)) return null;
  return { url, path };
}

// 受け取った JSON → 検査ずみのライブラリ { seq, drums, backings, progressions, skipped } か null（形が違う）
//   id は、ブリッジの id（'d3'）から、'd5003' に付けなおす。パターン番号が、ずれないように（同じパターンは、いつも同じ番号）
export function remapCloudLibrary(data, chordNames) {
  if (!data || typeof data !== 'object' || data.app !== SHARE_APP || data.v !== SHARE_VERSION) return null;
  const out = { seq: Number.isFinite(data.seq) ? data.seq : 0, at: Number.isFinite(data.at) ? data.at : 0, drums: [], backings: [], progressions: [], skipped: 0 };
  const run = (key, kind, clean) => {
    const used = new Set(), names = new Set();
    (Array.isArray(data[key]) ? data[key] : []).forEach((it, i) => {
      if (out[key].length >= LIMITS[kind]) { out.skipped++; return; }
      const c = clean(it);
      const m = c && it && typeof it.id === 'string' ? new RegExp(`^${PREFIX[kind]}(\\d{1,6})$`).exec(it.id) : null;
      const no = CLOUD_ID_BASE + (m ? Number(m[1]) : 900 + i);
      const id = `${PREFIX[kind]}${no}`;
      if (!c || used.has(id) || names.has(c.name)) { out.skipped++; return; }
      used.add(id); names.add(c.name);
      out[key].push({ id, ...c });
    });
  };
  run('drums', 'drum', cleanDrum);
  run('backings', 'backing', cleanBacking);
  run('progressions', 'progression', (it) => cleanProgression(it, chordNames));
  return out;
}

export class CloudLibrary {
  constructor({ onChange = () => {}, chordNames = [], fetchFn = null, EventSourceImpl = undefined, pollMs = 12000, slowPollMs = 60000 } = {}) {
    this.onChange = onChange;
    this.chordNames = chordNames;
    this.fetchFn = fetchFn || ((...a) => fetch(...a));
    this.ES = EventSourceImpl === undefined ? (typeof EventSource !== 'undefined' ? EventSource : null) : EventSourceImpl;
    this.pollMs = pollMs; this.slowPollMs = slowPollMs;
    this.state = 'off';                 // off | connecting | live（つなぎっぱなしで、届く）| polling（数秒ごとに読む）| offline（つながらない）
    this.lib = { seq: 0, at: 0, drums: [], backings: [], progressions: [] };
    this.cfg = null;
    this.sig = '';
    this.raw = null;                    // 最後に受け取った、もとの内容（次に開いたとき、つながらなくても使えるように、保存しておく）
    this.received = 0;                  // 内容を受け取った回数（テスト・表示用）
    this._es = null; this._timer = null; this._busy = false; this._lastEvent = 0;
  }

  get enabled() { return !!this.cfg; }
  get url() { return this.cfg ? `${this.cfg.url}/${this.cfg.path}.json` : ''; }
  count() { return this.lib.drums.length + this.lib.backings.length + this.lib.progressions.length; }

  // 前回までに受け取った内容（localStorage に覚えておいたもの）を、先に反映する。つながらない場所でも、前に届いたものは、使える
  restore(saved) {
    const lib = remapCloudLibrary(saved, this.chordNames);
    if (!lib || this.sig) return false;
    this.sig = JSON.stringify(lib);
    this.lib = lib;
    this.raw = saved;
    return true;
  }

  start(cfg) {
    if (this.cfg) return;
    if (!cfg) { this.state = 'off'; return; }
    this.cfg = cfg;
    this.state = 'connecting';
    this.poll();
    this.open();
    this._timer = setInterval(() => { if (this.state !== 'live' || Date.now() - this._lastEvent > this.slowPollMs) this.poll(); }, this.pollMs);
  }

  stop() {
    if (this._es) { try { this._es.close(); } catch (e) { /* 閉じられなくても、よい */ } this._es = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.cfg = null; this.state = 'off';
  }

  // つなぎっぱなし（Firebase のストリーミング）
  open() {
    if (!this.ES || !this.cfg || this._es) return;
    let es;
    try { es = new this.ES(this.url); } catch (e) { return; }
    this._es = es;
    es.onopen = () => { this.state = 'live'; this._lastEvent = Date.now(); };
    es.addEventListener('put', (ev) => {
      this.state = 'live'; this._lastEvent = Date.now();
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.path === '/') this.receive(m.data);
      else this.poll();                                 // 一部だけの変更は、全体を読み直す（ライブラリは、まるごと書きかえるので、ふつうは起きない）
    });
    es.addEventListener('patch', () => { this._lastEvent = Date.now(); this.poll(); });
    es.addEventListener('keep-alive', () => { this._lastEvent = Date.now(); });
    es.addEventListener('cancel', () => { this.state = 'polling'; });
    es.addEventListener('auth_revoked', () => { this.state = 'polling'; });
    es.onerror = () => { if (this.state === 'live' || this.state === 'connecting') this.state = 'polling'; };     // EventSource は、自分でつなぎなおす。その間は、ポーリングが追いつく
  }

  // 数秒ごとの読み直し
  async poll() {
    if (!this.cfg || this._busy) return;
    this._busy = true;
    try {
      const r = await this.fetchFn(this.url, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      this.receive(await r.json());
      if (this.state === 'connecting' || this.state === 'offline') this.state = this._es ? 'polling' : 'polling';
    } catch (e) {
      if (this.state !== 'live') this.state = 'offline';
    }
    this._busy = false;
  }

  // 受け取った内容（null = まだ何もない）を、検査して、変わっていれば、知らせる
  receive(data) {
    const lib = data === null || data === undefined ? { seq: 0, at: 0, drums: [], backings: [], progressions: [], skipped: 0 } : remapCloudLibrary(data, this.chordNames);
    if (!lib) return false;                              // 形が違う内容は、使わない（いまの内容を、そのまま）
    const sig = JSON.stringify(lib);
    if (sig === this.sig) return false;
    const prev = this.lib;
    this.sig = sig; this.lib = lib; this.raw = data === undefined ? null : data; this.received++;
    this.onChange(lib, prev);
    return true;
  }
}

// game/cloud.json を読む（なければ null）。テスト・手元の確認のために、URL の ?cloud=… で、127.0.0.1 の http だけ上書きできる（外のサイトへは、向けられない）
export async function loadCloudConfig(fetchFn = (...a) => fetch(...a), search = (typeof location !== 'undefined' ? location.search : '')) {
  try {
    const q = new URLSearchParams(search);
    const over = q.get('cloud');
    if (over) { const c = parseCloudConfig({ url: over, path: q.get('cloudpath') || undefined }, { allowLocal: true }); if (c && /^http:/.test(c.url)) return c; }
  } catch (e) { /* 無視 */ }
  try {
    const r = await fetchFn('cloud.json', { cache: 'no-store' });
    if (!r.ok) return null;
    return parseCloudConfig(await r.json());
  } catch (e) { return null; }
}
