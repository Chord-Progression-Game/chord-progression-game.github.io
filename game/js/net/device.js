// 実機（駒を読み取る盤。ESP32）とのつなぎ。
//   ブリッジ（tools/midi_bridge.py）が配る /api/events（つなぎっぱなしで届く通知）の `state` を受けて、盤の駒を、ゲームに渡す。
//   ゲームのページを tools/game_server.py で開くと、/api/ がブリッジにつながる。そうでなければ、「未接続」のまま（画面の仮の盤で遊べる）。
//   ※ 実機の盤を使うときは、実機側の演奏（自動再生）は止め、音はゲーム側で鳴らす（二重に鳴らさないため）。
export class DeviceLink {
  constructor({ table, onBoard, onStatus }) {
    this.table = table;
    this.onBoard = onBoard;
    this.onStatus = onStatus;
    this.enabled = true;       // 実機の盤を使うか（オフなら、つながっていても、画面の仮の盤）
    this.connected = false;     // ブリッジ（ページの配り役）につながっているか
    this.esp = false;           // ESP32（盤）がブリッジにつながっているか
    this.live = false;          // いま、実機の盤の駒を、ゲームに反映しているか
    this.es = null;
    this.lastKey = '';
    this.lastSeq = -1;         // 最後に使った「盤の状態」の順番号（ブリッジの seq）。これより古い状態は、使わない（追い越された返事で、盤を前の状態に戻さない）
    this.sid = undefined;      // ブリッジを始めた時刻。変わったら、順番号を数え直す
    this.emptyHoldMs = 6000;   // 駒が2つ以上あった盤が、一度に、すべて空になったとき、そのまま空にするまで待つ時間（ESP32 の再起動・読み直しのあいだは、いまの盤を保つ）
    this._hold = null;
    this._status();
  }

  start() {
    if (this._started || typeof EventSource === 'undefined') return;
    this._started = true;
    this._open();
    this._timer = setInterval(() => this._pollState(), 1500);
  }

  _open() {
    try {
      this.es = new EventSource('/api/events?client=game');     // client=game: つながっている間、ブリッジは MIDI の出力を止める（GarageBand などと二重に鳴らない）
      this.es.onopen = () => { this.connected = true; this._status(); this._pollState(); };
      this.es.onmessage = (m) => this._message(m.data);
      this.es.onerror = () => {
        this.connected = false; this.esp = false; this.live = false; this._status();
        try { this.es.close(); } catch (e) { /* 何もしない */ }
        clearTimeout(this._retry);
        this._retry = setTimeout(() => this._open(), 2000);
      };
    } catch (e) { this.connected = false; this._status(); }
  }

  toggle() { this.enabled = !this.enabled; this._apply(); this._status(); }

  // ブリッジが ESP32 につながっていない（Serial Monitor が使っている、USB が抜けている など）。ボタン1つで、つなぎ直す
  get needsBridge() { return this.connected && !this.esp && !!this.serial && this.serial.daemon && !this.serial.open; }
  async connectBridge() {
    try { await fetch('/api/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect' }) }); } catch (e) { /* 届かなかった */ }
    setTimeout(() => this._pollState(), 800); setTimeout(() => this._pollState(), 3000);
  }

  async _pollState() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      // 問い合わせを出してから返事が届くまでのあいだに、つなぎっぱなしの通知（SSE）で、もっと新しい状態が届くことがある（最初の駒が置かれた瞬間など）。
      // そのときの返事は古い（「ESP32 なし」・順番号が前）ので、使わない。新しい「盤あり」を、打ち消さない（ブリッジが作り直されたなら sid が違うので、使う）
      if (Number.isFinite(d.s_seq) && d.sid !== undefined && d.sid === this.sid && d.s_seq < this.lastSeq) return;
      this.connected = true;
      this.esp = !!d.connected;
      this.serial = d.serial || null;       // ブリッジの、ESP32 へのつなぎ（open / busy …）
      if (d.s) this._board(d.s, { seq: d.s_seq, sid: d.sid });
      this._status();
    } catch (e) {
      if (this.es && this.es.readyState === 1) return;          // 通知（SSE）がつながっているなら、問い合わせが1回失敗しただけでは、切れたことにしない（本当に切れたら、es.onerror が知らせる）
      this.connected = false; this.esp = false; this.live = false; this._status();
    }
  }

  _message(text) {
    let ev; try { ev = JSON.parse(text); } catch (e) { return; }
    if (ev.type === 'state' && ev.s) { this.esp = true; this._board(ev.s, { seq: ev.seq, sid: ev.sid }); this._status(); }
    else if (ev.type === 'library' && this.onLibrary) this.onLibrary(ev);          // リズム・コード編集の画面から、名前つきの内容が届いた
  }

  // ブリッジの state の chords（位置ごとの {name, symbol}）→ 駒の ID の並び
  _board(state, meta = null) {
    // 順番号: 古い状態（問い合わせの返事が、あとから届いた など）は、使わない
    if (meta && Number.isFinite(meta.seq)) {
      if (meta.sid !== undefined && meta.sid !== this.sid) { this.sid = meta.sid; this.lastSeq = -1; }
      if (meta.seq < this.lastSeq) return;
      this.lastSeq = meta.seq;
    }
    const chords = state.chords || [];
    if (!Array.isArray(chords) || chords.length < 8) return;          // 壊れた状態（途中で切れた行）: 使わない。盤を空にしない
    const ids = [];
    for (let i = 0; i < 8; i++) {
      const c = chords[i];
      let id = null;
      if (c && c.name && c.name !== '-' && c.name !== '?') { const ch = this.table.byName(c.name); id = ch ? ch.id : null; }
      ids.push(id);
    }
    const key = ids.join(',');
    const count = (xs) => (xs || []).filter((x) => x !== null).length;
    // 駒が2つ以上あった盤が、一度に、すべて空になった: 人の手では、ほぼ起きない。ESP32 の再起動や、読み直しの途中のことが多い。
    // そのあいだ、いまの盤を保つ（読み直しが終われば、駒が戻ってくる）。もとの数に戻るか、時間（emptyHoldMs）が来たら、そのときの状態にする。
    // 時間が来ても空のままなら、本当に、片づけたことになる
    if (this._hold) {
      this._hold.pending = { ids, key };
      if (count(ids) >= this._hold.had) this._releaseHold();
      return;
    }
    if (key === this.lastKey) return;
    if (count(this.latest) >= 2 && count(ids) === 0 && this.emptyHoldMs > 0) {
      this._hold = { had: count(this.latest), pending: { ids, key }, timer: setTimeout(() => this._releaseHold(), this.emptyHoldMs) };
      return;
    }
    this._apply2(ids, key);
  }

  _releaseHold() {
    const h = this._hold;
    if (!h) return;
    clearTimeout(h.timer);
    this._hold = null;
    if (h.pending.key !== this.lastKey) this._apply2(h.pending.ids, h.pending.key);
  }

  _apply2(ids, key) {
    this.lastKey = key;
    const first = this.latest === undefined;          // 最初の1回は、盤の全体をそろえるだけ（駒を置いたのではない）
    this.latest = ids;
    if (this.enabled) this.onBoard(ids, { sync: first });
    this.live = this.enabled && this.esp;
  }

  _apply() { if (this.enabled && this.latest) this.onBoard(this.latest, { sync: true }); this.live = this.enabled && this.esp && this.connected; }

  _status() {
    this.live = this.enabled && this.esp && this.connected;
    let label;
    if (!this.connected) label = '未接続（画面の盤で遊ぶ）';
    else if (this.needsBridge) label = this.serial.released ? 'ブリッジ解除中（Serial Monitor 用。ここをクリックでブリッジを接続）' : 'ESP32 未接続（ここをクリックでブリッジを接続）';
    else if (!this.esp) label = 'ブリッジ接続・盤を待っています';
    else label = this.enabled ? '盤につながっています（実機の駒で遊ぶ）' : '盤あり・画面の盤で遊ぶ';
    this.onStatus({ label, live: this.live, connected: this.connected, esp: this.esp });
  }
}
