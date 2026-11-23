// 駒の操作（ドラッグ・クリック）。マウスでも、タッチでも、同じ動き。
//   ・トレイの駒を、盤にドラッグして置く / クリックで「選んで」から、盤をクリックして置く
//   ・盤の上の駒を、ドラッグして動かす（空きへ移動・駒と入れ替え・盤の外に出すとはずす）
//   ・盤の駒をダブルクリック / Delete で、はずす。Esc で取りやめ
//   ・トレイの駒を、ダブルクリック（ダブルタップ）すると、いま盤に置いてある駒の、次の場所に置く（2026-11-23）
//   ・駒を押した（クリック）と、その和音が鳴る（試聴）
import { $ } from './dom.js';

const DRAG_START_PX = 6;
const DOUBLE_MS = 380;           // トレイの駒を、2回続けて押したと見なす間隔（ミリ秒）

// ダブルクリックで置く場所: いま盤に置いてある、いちばん右の駒の、次の場所。盤が空なら 1番（0）。いちばん右（8番）まで埋まっているときは、最初の空き。どこも空いていなければ -1
export function nextFreeSlot(board) {
  let last = -1;
  board.forEach((x, i) => { if (x !== null && x !== undefined) last = i; });
  if (last + 1 < board.length) return last + 1;
  return board.findIndex((x) => x === null || x === undefined);
}

export class Input {
  // onLabel(ins): 技の枠（3D の、名前と点数の四角）を押したときに呼ぶ（詳しい説明を出す）。canInspect(): 実機の盤のときも、枠は押せる（駒を置く操作と、別に決める）
  // 自作コード用: onContext({ id, slot, x, y }) = 駒を右クリック（スマホでは、長押し）/ isEditPick() ・ onEditPick(id) ・ onEditPickCancel() = 「コードを編集」を押したあと、編集する駒を選ぶ / onEditDrop(id) = 駒を「コードを編集」のボタンに投げ入れた
  constructor({ scene, game, hud, table, canvas, audition, sfx, enabled = () => true, onLabel = null, canInspect = () => true, onContext = null, isEditPick = () => false, onEditPick = null, onEditPickCancel = null, onEditDrop = null }) {
    Object.assign(this, { scene, game, hud, table, canvas, audition, sfx, enabled, onLabel, canInspect, onContext, isEditPick, onEditPick, onEditPickCancel, onEditDrop });
    this.pending = null;        // ボタンを押したが、まだドラッグが始まっていない
    this.drag = null;           // ドラッグ中
    this.armed = null;          // クリックで選んだ駒（ID）
    this.hoverSlot = -1;
    this.ghost = $('#drag-ghost');
    this._move = (e) => this.onMove(e);
    this._up = (e) => (e.type === 'pointercancel' ? this.abort() : this.onUp(e));          // 指で、トレイをなぞって動かした（ブラウザが、スクロールとして取った）ときは、クリックにしない
  }

  attach() {
    $('#tray').addEventListener('pointerdown', (e) => this.onTrayDown(e));
    this.canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onCanvasHover(e));
    this.canvas.addEventListener('pointerleave', () => { if (!this.drag) this.scene.setHover(-1); });
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    $('#tray').addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isEditPick() && this.onEditPickCancel) { this.onEditPickCancel(); e.preventDefault(); return; }       // 「コードを編集」の選びをやめる
      if (e.key === 'Escape' && (this.drag || this.pending || this.armed !== null)) { this.cancel(); e.preventDefault(); }       // 取りやめだけ（メニューは開かない）
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.hoverSlot >= 0 && this.enabled()) { e.preventDefault(); this.removeAt(this.hoverSlot); }
    });
  }

  // ---------- 押した ----------
  onTrayDown(e) {
    if (!this.enabled() || (e.button !== undefined && e.button > 0)) return;
    const card = e.target.closest('.pc');
    if (!card) return;
    e.preventDefault();
    this.pending = { id: Number(card.dataset.id), from: 'tray', x0: e.clientX, y0: e.clientY, t0: performance.now() };
    this.listen();
    this.armLongPress(e);
  }

  // スマホ: 駒を長押し（動かさずに、0.5秒）すると、右クリックと同じメニューが出る
  armLongPress(e) {
    clearTimeout(this._lp);
    if (!this.onContext || e.pointerType !== 'touch') return;
    const p = this.pending;
    this._lp = setTimeout(() => {
      if (!this.pending || this.pending !== p || this.drag) return;
      this.pending = null; this.unlisten();
      this.onContext({ id: p.id, slot: p.slot === undefined ? -1 : p.slot, x: p.x0, y: p.y0 });
    }, 520);
  }

  // 右クリック: 駒（トレイの駒・盤の駒）のメニュー
  onContextMenu(e) {
    const card = e.target.closest && e.target.closest('#tray .pc');
    if (!this.onContext) return;
    e.preventDefault();
    clearTimeout(this._lp);
    if (card) { this.pending = null; this.unlisten(); this.onContext({ id: Number(card.dataset.id), slot: -1, x: e.clientX, y: e.clientY }); return; }
    if (e.target === this.canvas) {
      const slot = this.scene.pickSlot(e.clientX, e.clientY);
      if (slot >= 0 && this.game.board[slot] !== null) { this.pending = null; this.unlisten(); this.onContext({ id: this.game.board[slot], slot, x: e.clientX, y: e.clientY }); }
    }
  }

  onCanvasDown(e) {
    if (e.button !== undefined && e.button > 0) return;
    if (this.armed === null && this.onLabel && this.canInspect()) {          // 技の枠（名前と点数の四角）を押した: 詳しい説明を出す
      const ins = this.scene.pickLabel(e.clientX, e.clientY);
      if (ins) { this.onLabel(ins); return; }
    }
    if (!this.enabled()) return;
    if (this.armed === null) {                                      // ヒントの候補（透けた札）をクリック: その駒を、そこに置く
      const gh = this.scene.pickGhost(e.clientX, e.clientY);
      if (gh) { this.scene.setGhostHover(-1); this.audition(gh.id); this.game.place(gh.slot, gh.id); return; }
    }
    const slot = this.scene.pickSlot(e.clientX, e.clientY);
    if (this.armed !== null) {                                     // 選んである駒を、ここに置く
      if (slot >= 0) { const id = this.armed; this.setArmed(null); this.game.place(slot, id); }
      else this.setArmed(null);
      return;
    }
    if (slot >= 0 && this.game.board[slot] !== null) {
      this.pending = { id: this.game.board[slot], from: 'board', slot, x0: e.clientX, y0: e.clientY, t0: performance.now() };
      this.listen();
      this.armLongPress(e);
    }
  }

  listen() {
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
  }
  unlisten() {
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
  }

  // ---------- 動かした ----------
  onMove(e) {
    if (this.pending && !this.drag) {
      if (Math.hypot(e.clientX - this.pending.x0, e.clientY - this.pending.y0) < DRAG_START_PX) return;
      this.beginDrag(e);
    }
    if (!this.drag) return;
    this.ghost.style.left = `${e.clientX}px`; this.ghost.style.top = `${e.clientY}px`;
    const slot = this.slotUnder(e);
    this.setHoverSlot(slot);
    this.ghost.style.opacity = slot >= 0 ? '0' : '0.92';       // 盤の上では、3D の透けた駒を見せる
    this.markEditDrop(this.onEditDrop ? this.overEditButton(e) : false);
  }

  // 「コードを編集」のボタンの上か（駒を投げ入れて、編集する）
  overEditButton(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!(el && el.closest && el.closest('#btn-chord-edit'));
  }
  markEditDrop(on) { const b = $('#btn-chord-edit'); if (b) b.classList.toggle('drop-target', !!on); }

  beginDrag(e) {
    this._lastTap = null;
    clearTimeout(this._lp);
    const p = this.pending;
    this.drag = { id: p.id, from: p.from, slot: p.slot };
    this.pending = null;
    if (this.armed !== null) this.setArmed(null);
    this.ghost.replaceChildren(this.hud.makeCard(p.id));
    this.ghost.classList.remove('hidden');
    this.ghost.style.left = `${e.clientX}px`; this.ghost.style.top = `${e.clientY}px`;
    if (p.from === 'board') this.scene.setPieceVisible(p.slot, false);
    if (this.sfx()) this.sfx().pickup();
    this.audition(p.id);
  }

  // 盤の上にいるときだけ、スロット番号。トレイなど、ほかの部品の上は -1
  slotUnder(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.id !== 'gl') return -1;
    return this.scene.pickSlot(e.clientX, e.clientY);
  }

  setHoverSlot(slot) {
    this.hoverSlot = slot;
    this.scene.setHover(slot, true);
    const chord = this.drag ? this.table.byId(this.drag.id) : (this.armed !== null ? this.table.byId(this.armed) : null);
    this.scene.setPreview(slot, slot >= 0 ? chord : null);
  }

  onCanvasHover(e) {
    if (this.drag || this.pending) return;
    if (this.armed === null && this.onLabel && this.canInspect() && this.scene.pickLabel(e.clientX, e.clientY)) { this.scene.setHover(-1, false); this.canvas.style.cursor = 'pointer'; return; }       // 技の枠の上: 押すと詳しい説明
    const slot = this.scene.pickSlot(e.clientX, e.clientY);
    this.hoverSlot = slot;
    if (this.armed !== null) { this.setHoverSlot(slot); this.canvas.style.cursor = slot >= 0 ? 'copy' : 'default'; return; }
    const gh = this.enabled() ? this.scene.pickGhost(e.clientX, e.clientY) : null;       // ヒントの候補の上: クリックで置ける
    this.scene.setGhostHover(gh ? gh.index : -1);
    this.scene.setHover(slot >= 0 && this.game.board[slot] !== null ? slot : -1, false);
    this.canvas.style.cursor = gh ? 'pointer' : (slot >= 0 && this.game.board[slot] !== null ? 'grab' : 'default');
    const r = this.canvas.getBoundingClientRect();
    this.scene.parallax.set(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
  }

  // ---------- 離した ----------
  onUp(e) {
    this.unlisten();
    if (this.drag) { this.drop(e); return; }
    clearTimeout(this._lp);
    const p = this.pending; this.pending = null;
    if (!p) return;
    if (this.isEditPick() && this.onEditPick) { this.onEditPick(p.id); return; }          // 「コードを編集」のあと: 押した駒を、編集する
    if (p.from === 'tray') {                                       // クリック: 選ぶ（半透明の駒を持ち上げる）/ もういちど押すと、もどす。和音も鳴る
      const now = performance.now();
      if (this._lastTap && this._lastTap.id === p.id && now - this._lastTap.t < DOUBLE_MS) {         // ダブルクリック（ダブルタップ）: 盤の、いまの駒の次に置く
        this._lastTap = null;
        this.setArmed(null);
        this.placeNext(p.id);
        return;
      }
      this._lastTap = { id: p.id, t: now };
      this.audition(p.id);
      this.setArmed(this.armed === p.id ? null : p.id, e);
      if (this.armed !== null && !this._armHinted) { this._armHinted = true; this.hud.toast(e && e.pointerType === 'touch' ? '盤の場所をタップすると置けます（もういちどタップでもどす）' : '盤の場所をクリックすると置けます（Esc でもどす）'); }
    } else {
      this.audition(p.id);                                         // 盤の駒をクリック: その和音を聴く
    }
  }

  drop(e) {
    const d = this.drag;
    const slot = this.slotUnder(e);
    const toEdit = !!this.onEditDrop && this.overEditButton(e);
    this.drag = null;
    this.markEditDrop(false);
    this.ghost.classList.add('hidden'); this.ghost.style.opacity = '0.92';
    this.scene.setPreview(-1, null); this.scene.setHover(-1, false);
    if (toEdit) {                                                  // 「コードを編集」のボタンに投げ入れた: その駒を、編集する（盤の駒は、そのまま）
      if (d.from === 'board') this.scene.setPieceVisible(d.slot, true);
      this.onEditDrop(d.id);
      return;
    }
    if (d.from === 'tray') {
      if (slot >= 0) this.game.place(slot, d.id);
    } else {
      this.scene.setPieceVisible(d.slot, true);
      if (slot === d.slot) { /* もとの場所: 何もしない */ }
      else if (slot >= 0) { if (this.game.board[slot] === null) this.game.move(d.slot, slot); else this.game.swap(d.slot, slot); }
      else this.game.remove(d.slot);                              // 盤の外に出したら、はずす
    }
  }

  // 指の操作が、取りやめになった（トレイのスクロール・電話の着信など）: 押しかけの駒・ドラッグを、なかったことにする
  abort() {
    clearTimeout(this._lp);
    this.unlisten();
    this.pending = null;
    if (this.drag) { if (this.drag.from === 'board') this.scene.setPieceVisible(this.drag.slot, true); this.drag = null; this.ghost.classList.add('hidden'); this.scene.setPreview(-1, null); this.scene.setHover(-1, false); }
    this.markEditDrop(false);
  }

  cancel() {
    clearTimeout(this._lp);
    this.markEditDrop(false);
    if (this.drag) {
      if (this.drag.from === 'board') this.scene.setPieceVisible(this.drag.slot, true);
      this.drag = null; this.ghost.classList.add('hidden');
      this.scene.setPreview(-1, null); this.scene.setHover(-1, false);
      this.unlisten();
    }
    this.pending = null;
    this.setArmed(null);
  }

  setArmed(id, e = null) {
    this.armed = id;
    this.hud.setArmed(id);
    if (id === null) { this.scene.setPreview(-1, null); this.scene.setHover(-1, false); this.canvas.style.cursor = 'default'; this._armedGhost(false); return; }
    if (e && e.pointerType === 'touch') { this._armedGhost(false); return; }               // 指のときは、駒を指について来させない（指の下に隠れるので）。トレイの駒の印で示す
    this._armedGhost(true, e);
  }

  // 選んだ駒を、半透明で持ち上げて、マウスについてこさせる（盤の上では、3D の透けた駒に替わる）
  _armedGhost(on, e = null) {
    if (!on) {
      if (this._armMove) { window.removeEventListener('pointermove', this._armMove); this._armMove = null; }
      if (!this.drag) { this.ghost.classList.add('hidden'); this.ghost.style.opacity = '0.92'; }
      return;
    }
    this.ghost.replaceChildren(this.hud.makeCard(this.armed));
    this.ghost.classList.remove('hidden');
    this.ghost.style.opacity = '0.7';
    if (e) { this.ghost.style.left = `${e.clientX}px`; this.ghost.style.top = `${e.clientY}px`; }
    if (!this._armMove) {
      this._armMove = (ev) => {
        this.ghost.style.left = `${ev.clientX}px`; this.ghost.style.top = `${ev.clientY}px`;
        this.ghost.style.opacity = this.slotUnder(ev) >= 0 ? '0' : '0.7';
      };
      window.addEventListener('pointermove', this._armMove);
    }
  }

  onDouble(e) {
    if (!this.enabled()) return;
    const slot = this.scene.pickSlot(e.clientX, e.clientY);
    if (slot >= 0) this.removeAt(slot);
  }

  removeAt(slot) {
    if (this.game.board[slot] !== null) this.game.remove(slot);
  }

  // いま盤に置いてある駒の、次の場所に、駒を置く（トレイのダブルクリック）。置けたら true
  placeNext(id) {
    const slot = nextFreeSlot(this.game.board);
    if (slot < 0) { this.hud.toast('盤がいっぱいです。置きかえるときは、駒をドラッグしてください'); return false; }
    return this.game.place(slot, id);
  }
}
