// ゲームの進行（盤・判定・ステージ・チュートリアルの案内・ヒント・タイムアタック（内部の名前は challenge）・チャレンジステージ（trial））。
//   画面（DOM・3D）には、いっさい触れない。起きたことを「イベント」で知らせるだけ。画面は、そのイベントを受けて、描く・鳴らす。
//   だから、ブラウザの外（テスト）でも動かせて、実機の盤（駒の読み取り）でも、画面の仮の盤でも、同じ進行で遊べる。
//
//   イベント:
//     stage    {stage, mode}                 ステージが始まった
//     board    {slot, id, prev, source}      盤の1か所が変わった
//     analysis {result, newInstances, removed, newOddities}   判定が変わった（result.oddities = 小節の頭の Ⅴ（？）の一覧）
//     trick    {instance, first}             新しく技が決まった（first = この技の種類が、初めて）
//     oddity   {oddity}                      新しく「？」（小節の頭の Ⅴ。技にならず、100点の減点）が出た
//     hints    {cursor, context, primary, advanced} | null
//     guide    {active, steps, next, cleared, label?}   チュートリアルの案内（プリセットの案内のときは、label に「プリセット「…」」）
//     presetDone {name}                      プリセットの案内どおりに、駒が置かれた
//     stageClear {stage, instances, score}   チュートリアルをクリアした
//     timer    {left}                        タイムアタックの残り秒（1秒ごと）
//     challengeEnd {score, stars, best}      タイムアタックが終わった
//     melodyEnd {stage, score, stars, conds, par, best, isBest, result}   メロディのステージで、「採点する」を押した（conds = 星の条件の一覧）
//     split    {slot, id, prev, source, firstChanged, slid}   分割したマスの、後半のコードが変わった（id = 後半のコードの ID。null = 分割をやめた）。前半（または、分けないマスの駒）は、'board'
//     trial    {state}                       チャレンジステージ: 条件・ノルマの、いまの様子が変わった（state = evaluateTrial の結果）
//     trialEnd {stage, score, stars, best, isBest, state, result}   チャレンジステージで、「提出する」を押して、クリアした
import { analyze, instanceKey, TRICKS } from '../core/tricks.js';
import { suggest } from '../core/hints.js';
import { writeSave } from './save.js';
import { guideText } from './stages.js';
import { applyMelody, melodyPar, melodyStars, meloNotes } from './melodies.js';
import { evaluateTrial, trialStars } from './trials.js';

export const NUM_SLOTS = 8;

// 技の判定を、おやすみにした結果（盤の並びだけを残す）。ステージの noTricks（最初のステージ）が使う
const withoutTricks = (res) => ({ ...res, instances: [], oddities: [], levelPieces: [], critiques: [], chains: [], unclaimed: [], score: { base: 0, variety: 1, penalty: 0, levelBonus: 0, senseGood: 0, senseBad: 0, total: 0, kinds: 0, combo: 0 } });

export class Game {
  constructor({ table, presets, save, slotsPerBar = 2 }) {
    this.table = table;
    this.presets = presets;
    this.save = save;
    this.slotsPerBar = slotsPerBar;
    this.listeners = {};
    this.board = Array(NUM_SLOTS).fill(null);
    this.split = Array(NUM_SLOTS).fill(null);      // 分割したマス（1つのマスに、前半・後半の2つのコード）の、後半のコードの ID。分割していなければ null。前半は、board の駒
    this.stage = null;
    this.mode = 'none';
    this.allowed = [];
    this.hintsOn = false;
    this.guideOn = false;
    this.cleared = false;
    this.analysis = analyze(this.board, table, { slotsPerBar, split: this.split });
    this.sessionTricks = new Map();       // 種類 → このステージで決まった回数
    this.timeLeft = 0; this.timerRunning = false; this._lastWhole = -1;
    this.peak = 0;                        // このステージでの、いちばん高い得点
    this.placedTotal = 0;
    this.demoMode = false;                // タイトルの自動デモ中は、図鑑に数えない
    this.touched = false;                 // このステージが始まってから、駒が動かされたか（実機の盤の最初の読み込みは、数えない）。クリア判定は、動かされたあとだけ
    this.presetGuide = null;              // プリセットの案内（実機の盤のとき、置く駒と場所を案内する）。{ name, entries: [{ slot, id, name }] }
    this.melody = null;                   // メロディのステージのとき、流れているメロディ（{ notes }）。それ以外は null
    this.syncSource = null;               // 実機の盤を見ているとき、いまの盤の駒の ID の並びを返す関数（ステージが変わっても、置いてある駒を、すぐ盤に出すため）
    this.trialState = null;               // チャレンジステージのとき、条件・ノルマの、いまの様子（evaluateTrial の結果）
    this._trialKey = '';
  }

  // ---------- イベント ----------
  on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return () => { this.listeners[type] = this.listeners[type].filter((f) => f !== fn); }; }
  emit(type, payload) { for (const fn of this.listeners[type] || []) fn(payload); }

  // ---------- ステージ ----------
  // トレイに並べる駒の ID。grouped（段（Lv.）で分ける）= コード表の並び順（段 → ルート音 C→B → 構成）/ 分けないとき（チュートリアル）= ルート音の順だけ
  trayIds({ grouped = true } = {}) {
    if (!grouped) return this.table.sortByRoot(this.allowed);
    const order = new Map(this.table.list.map((c, i) => [c.id, i]));
    return this.allowed.filter((id) => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
  }

  loadStage(stage, mode) {
    this.stage = stage; this.mode = mode; this.cleared = false;
    this.melody = mode === 'melody' && stage.melody ? stage.melody : null;
    this.presetGuide = null;
    this.board.fill(null); this.split.fill(null);
    this.allowed = stage.pieces ? stage.pieces.map((n) => { const c = this.table.byName(n); if (!c) throw new Error(`知らない駒: ${n}`); return c.id; })
      : this.table.list.map((c) => c.id);
    this.guideOn = mode === 'tutorial';
    this.timeLeft = stage.seconds || 0; this.timerRunning = false; this._lastWhole = -1;
    this.sessionTricks.clear(); this.peak = 0; this.placedTotal = 0;
    this.touched = false;
    this.trialState = null; this._trialKey = '';
    this.analysis = this._analyzeBoard();
    this.emit('stage', { stage, mode });
    this.emit('analysis', { result: this.analysis, newInstances: [], removed: [], newOddities: [] });
    this._updateGuide(); this._updateHints(); this._updateTrial();
    // 実機の盤に駒が置いてあるときは、ステージが変わっても、盤を空のままにしない（以前は、次に駒を動かすまで、空のままだった）
    const live = this.syncSource ? this.syncSource() : null;
    if (live) this.setBoard(live, { source: 'device-sync' });
  }

  // 自作コード・編集したコードが変わったとき（フリープレイ）: 使える駒の一覧をコード表から取りなおす。盤に、なくなった駒（削除した自作コード）があれば、はずす。判定は取りなおす
  refreshAllowed() {
    const st = this.stage;
    this.allowed = st && st.pieces ? st.pieces.map((n) => { const c = this.table.byName(n); return c ? c.id : null; }).filter((x) => x !== null) : this.table.list.map((c) => c.id);
    for (let i = 0; i < NUM_SLOTS; i++) {
      const id = this.board[i];
      if (id !== null && id !== undefined && id !== this.table.repeatId && !this.table.byId(id)) { this._setSlot(i, null, null, 'chordbook'); continue; }
      const sid = this.split[i];
      if (sid !== null && sid !== undefined && !this.table.byId(sid)) this._setSlot(i, this.board[i], null, 'chordbook');         // 削除した自作コードが、分割したマスの後半にあったら、分割をやめる
    }
    this._recompute();
  }

  // ---------- 盤の操作 ----------
  canPlace(id) { return this.allowed.includes(id); }

  // 分割したマス（1つのマスを、前半・後半の2つのコードに分ける）。フリープレイ・タイムアタック・チャレンジステージだけ（チュートリアル・メロディーのステージ・タイトルのデモでは、分けない）
  splitAllowed() { return (this.mode === 'free' || this.mode === 'challenge' || this.mode === 'trial') && !this.demoMode; }
  isSplit(slot) { return this.split[slot] !== null && this.split[slot] !== undefined; }
  // マスの駒の ID。half: 0 = 前半（分けないマスは、その駒）/ 1 = 後半
  pieceAt(slot, half = 0) { return half === 1 ? (this.isSplit(slot) ? this.split[slot] : null) : this.board[slot]; }

  // 1つのマスの中身を、まとめて決める（first = 前半・分けないマスは、その駒 / second = 後半。なければ null）。変わったら true。判定は、呼ぶ側が _recompute() する
  //   空き・「→」のマスは、分けられない。同じ駒が2つなら、分けない（1つに戻る）
  _setSlot(slot, first, second, source) {
    if (first === null || first === undefined || first === this.table.repeatId) second = null;
    if (second === undefined || second === this.table.repeatId || (second !== null && !this.table.byId(second))) second = null;
    if (second !== null && second === first) second = null;
    const f = first === undefined ? null : first;
    const prev = this.board[slot], prevSecond = this.split[slot] ?? null;
    if (prev === f && prevSecond === second) return false;
    this.board[slot] = f; this.split[slot] = second;
    // slid: 画面が、落ちてくる動きを、つけないための印。前半の駒が、もとの後半の駒だった（残った半分が、マスぜんたいに広がった）/ 後半の駒が、もとの前半の駒だった（前半が、横へずれた）
    if (prev !== f) this.emit('board', { slot, id: f, prev, source, slid: f !== null && f === prevSecond });
    if (prevSecond !== second) this.emit('split', { slot, id: second, prev: prevSecond, source, firstChanged: prev !== f, slid: second !== null && second === prev });
    return true;
  }

  // 駒を置く。すでに駒があれば、置き換える（分割したマスも、1つの駒になる）
  place(slot, id, { source = 'player', force = false } = {}) {
    if (slot < 0 || slot >= NUM_SLOTS) return false;
    if (!force && !this.canPlace(id)) return false;
    if (this.board[slot] === id && !this.isSplit(slot)) return false;
    this._setSlot(slot, id, null, source);
    this.touched = true;
    this.placedTotal++;
    this._recompute();
    return true;
  }

  // 駒を置く（分割に対応）。zone: 'C' = そのマスに置く（置きかえ）/ 'L'・'R' = 駒のあるマスの、左・右に重ねる = マスを、前半・後半の2つに分ける。分けられないとき・空きのマスは、そのマスに置く
  placeAt(slot, zone, id, opts = {}) {
    const { source = 'player', force = false } = opts;
    if (slot < 0 || slot >= NUM_SLOTS) return false;
    if (!force && !this.canPlace(id)) return false;
    const cur = this.board[slot];
    if (zone === 'C' || !this.splitAllowed() || cur === null || cur === undefined || cur === this.table.repeatId || id === this.table.repeatId) return this.place(slot, id, opts);
    const w = this._work();
    if (!this._placeHalf(w, slot, zone === 'L' ? 0 : 1, id)) return false;
    return this._commit(w, source, true);
  }

  // 作業用の盤のコピー（判定の前の、ためし置き）
  _work() { return { board: this.board.slice(), split: this.split.slice() }; }
  // ためし置きの盤 w の slot に、駒 id を、half（0 = 前半 / 1 = 後半）として重ねる。前半と後半が、入れかわる形（[旧, 新] か [新, 旧]）。変わったら true
  _placeHalf(w, slot, half, id) {
    const first = w.board[slot], second = w.split[slot] ?? null;
    if (first === null || first === undefined || first === this.table.repeatId) return false;
    if (second === null) { if (first === id) return false; if (half === 0) { w.board[slot] = id; w.split[slot] = first; } else w.split[slot] = id; }
    else if (half === 0) { if (first === id) return false; w.board[slot] = id; }
    else { if (second === id) return false; w.split[slot] = id; }
    return true;
  }
  // ためし置き w を、本物の盤に反映する（変わったマスだけ。イベントを出して、判定は、まとめて1回）。戻り値: 変わったか
  _commit(w, source, placed = false) {
    let changed = false;
    for (let i = 0; i < NUM_SLOTS; i++) if (this._setSlot(i, w.board[i], w.split[i] ?? null, source)) changed = true;
    if (changed) { this.touched = true; if (placed) this.placedTotal++; this._recompute(); }
    return changed;
  }

  // 駒を、まとめて置く（プリセットの呼び出し）。entries: [{ slot, id, second? }]（id が null なら、その場所を空きにする。second = 分割したマスの、後半の駒）。判定は、まとめて1回だけ（途中の状態で、技の演出が出ない）
  // 使えない駒（ステージの制限）は、置かない。戻り値: { changed: 変えた数, blocked: 置けなかった場所の一覧 }
  placeMany(entries, { source = 'preset', force = false } = {}) {
    let changed = 0;
    const blocked = [];
    for (const { slot, id, second = null } of entries) {
      if (slot < 0 || slot >= NUM_SLOTS) continue;
      if (id !== null && !force && !this.canPlace(id)) { blocked.push(slot); continue; }
      const sec = second !== null && second !== undefined && this.splitAllowed() && (force || this.canPlace(second)) ? second : null;
      if (this._setSlot(slot, id, id === null ? null : sec, source)) { changed++; if (id !== null) this.placedTotal++; }
    }
    if (changed) { this.touched = true; this._recompute(); }
    return { changed, blocked };
  }

  // 駒を外す。分割したマスは、half（0 = 前半 / 1 = 後半）を指定すると、その半分だけ外れて、残った半分が、マスぜんたいに広がる。指定しないと、マスぜんたい（前半・後半とも）が空きになる
  remove(slot, { source = 'player', half = null } = {}) {
    const prev = this.board[slot];
    if (prev === null || prev === undefined) return null;
    this.touched = true;
    const second = this.isSplit(slot) ? this.split[slot] : null;
    if (second !== null && half !== null) {
      this._setSlot(slot, half === 0 ? second : prev, null, source);
      this._recompute();
      return half === 0 ? prev : second;
    }
    this._setSlot(slot, null, null, source);
    this._recompute();
    return prev;
  }

  // マスぜんたい（前半・後半とも）を、入れ替える
  swap(a, b, { source = 'player' } = {}) {
    if (a === b) return;
    const fa = this.board[a], sa = this.split[a] ?? null, fb = this.board[b], sb = this.split[b] ?? null;
    this.touched = true;
    this._setSlot(a, fb, sb, source); this._setSlot(b, fa, sa, source);
    this._recompute();
  }

  // 駒（分割したマスなら、前半・後半とも）を、別の空きへ動かす（判定は、動かしたあとの1回だけ。途中の状態では、技の演出が出ない）
  move(from, to, { source = 'player' } = {}) {
    if (from === to || this.board[from] === null || this.board[to] !== null) return false;
    this.touched = true;
    this._setSlot(to, this.board[from], this.split[from] ?? null, source); this._setSlot(from, null, null, source);
    this._recompute();
    return true;
  }

  // 盤の上の駒を、ドラッグして、別の場所に落としたとき（分割に対応）。fromHalf: 分割したマスの、どちらの半分を持ち上げたか（0 = 前半 / 1 = 後半。分割していないマスは null）。toSlot・zone: 落とした場所（zone: 'C' / 'L' / 'R'）
  //   ・分割していないマスどうしの、空きへの移動・まん中での入れ替えは、これまでどおり
  //   ・分割したマスから持ち上げた半分は、抜けて、残った半分が広がる。落とした先が、駒のあるマスの左・右なら、そこを2つに分ける / まん中なら、そのマスの駒と置きかえる
  //   ・同じマスの、反対側（左・右）に落とすと、前半・後半が、入れかわる
  moveFromBoard(fromSlot, fromHalf, toSlot, zone, { source = 'player' } = {}) {
    const id = this.pieceAt(fromSlot, fromHalf === 1 ? 1 : 0);
    if (id === null || id === undefined) return false;
    const fromSplit = this.isSplit(fromSlot), toSplit = this.isSplit(toSlot);
    const toEmpty = this.board[toSlot] === null || this.board[toSlot] === undefined;
    if (fromSlot === toSlot && zone === 'C') return false;
    if (!fromSplit && !toSplit && fromSlot !== toSlot && (zone === 'C' || toEmpty || !this.splitAllowed())) {      // ふつうの、移動・入れ替え
      if (toEmpty) return this.move(fromSlot, toSlot, { source });
      this.swap(fromSlot, toSlot, { source }); return true;
    }
    const w = this._work();
    // 持ち上げた半分を、もとのマスから抜く
    if (fromSplit) { const other = fromHalf === 1 ? w.board[fromSlot] : w.split[fromSlot]; w.board[fromSlot] = other; w.split[fromSlot] = null; }
    else { w.board[fromSlot] = null; w.split[fromSlot] = null; }
    // 落とした先に置く
    const targetFirst = w.board[toSlot];
    if (targetFirst === null || targetFirst === undefined || zone === 'C' || !this.splitAllowed() || targetFirst === this.table.repeatId) { w.board[toSlot] = id; w.split[toSlot] = null; }
    else this._placeHalf(w, toSlot, zone === 'L' ? 0 : 1, id);
    return this._commit(w, source);
  }

  clear({ source = 'player' } = {}) {
    let changed = false;
    for (let i = 0; i < NUM_SLOTS; i++) if (this._setSlot(i, null, null, source)) changed = true;
    if (changed) { if (source !== 'demo') this.touched = true; this._recompute(); }
  }

  // 実機の盤（駒の読み取り）から、まとめて入れる。ids: 長さ8の配列（null か ID）。使える駒の制限は、かけない。実機の駒が変わったマスは、分割をやめる（実機の盤には、分割がない）
  setBoard(ids, { source = 'device' } = {}) {
    let changed = false;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const id = ids[i] === undefined ? null : ids[i];
      if (this.board[i] !== id) { if (this._setSlot(i, id, null, source)) changed = true; }
    }
    if (changed) { if (source !== 'device-sync' && source !== 'restore') this.touched = true; this._recompute(); }
  }

  // ---------- 判定 ----------
  // 技の定義が変わったとき（ユーザーの進行が届いた）に、盤はそのままで、判定だけ、取り直す
  refreshAnalysis() { this._recompute(); }

  // 盤の判定。メロディのステージでは、コード進行としての採点（ふだんと同じ）に、メロディとの相性の採点を足す
  _analyzeBoard() {
    const res = analyze(this.board, this.table, { slotsPerBar: this.slotsPerBar, split: this.split });
    if (this.melody) { applyMelody(res, this.board, this.melody, this.table); res.critiques = res.critiques.concat(meloNotes(res.melody)); }
    return res;
  }

  _recompute() {
    const prev = this.analysis;
    const prevKeys = new Set(prev.instances.map(instanceKey));
    let res = this._analyzeBoard();
    if (this.stage && this.stage.noTricks) res = withoutTricks(res);        // 最初のステージ: 技の判定は、おやすみ（置いて聴くだけ）
    this.analysis = res;
    const curKeys = new Set(res.instances.map(instanceKey));
    const newInstances = res.instances.filter((i) => !prevKeys.has(instanceKey(i)));
    const removed = prev.instances.filter((i) => !curKeys.has(instanceKey(i)));
    const prevOdd = new Set((prev.oddities || []).map(instanceKey));
    const newOddities = (res.oddities || []).filter((o) => !prevOdd.has(instanceKey(o)));
    const prevCrit = new Map((prev.critiques || []).map((c) => [c.id, c.points]));
    // ジャッジ（講評）: 新しく出たもの。同じ講評が、強くなったとき（階段が3つ → 4つに伸びて、+60 → +90）も、知らせ直す（通知の点を、いまの点にそろえる）
    const newCritiques = (res.critiques || []).filter((c) => !prevCrit.has(c.id) || Math.abs(c.points) > Math.abs(prevCrit.get(c.id)));
    this.peak = Math.max(this.peak, res.score.total);
    this.emit('analysis', { result: res, newInstances, removed, newOddities });
    for (const ins of newInstances) {
      this.sessionTricks.set(ins.kind, (this.sessionTricks.get(ins.kind) || 0) + 1);
      const first = !this.demoMode && !this.save.discovered.includes(ins.kind);
      if (first) { this.save.discovered.push(ins.kind); writeSave(this.save); }
      this.emit('trick', { instance: ins, first });
    }
    for (const o of newOddities) this.emit('oddity', { oddity: o });
    for (const c of newCritiques) this.emit('critique', { critique: c });
    this._updateGuide();
    this._updateHints();
    this._checkGoal();
    this._updateTrial();
  }

  // ---------- チュートリアルの案内 ----------
  _guideSteps() {
    if (!this.stage || !this.stage.solution || !this.stage.solution.length) return [];
    return this.stage.solution.map(([slot, name]) => {
      const id = this.table.byName(name).id;
      const cur = this.board[slot];
      const done = cur === id;
      const text = done ? `${slot + 1}番は「${name}」` : (cur !== null ? `${slot + 1}番を「${name}」に替えよう` : guideText(slot, name));
      return { slot, name, id, done, text };
    });
  }

  setGuide(on) { this.guideOn = !!on; this._updateGuide(); }

  // プリセットの案内（実機の盤のとき。画面では駒を置けないので、置く駒と場所を、案内する）。entries を null にすると、やめる
  setPresetGuide(entries, name = '') {
    this.presetGuide = entries && entries.some((e) => e.id !== null) ? { name, entries: entries.filter((e) => e.id !== null).map(({ slot, id, name: nm }) => ({ slot, id, name: nm })) } : null;
    this._updateGuide();
  }

  _updateGuide() {
    if (this.presetGuide) {
      const pg = this.presetGuide;
      const steps = pg.entries.map(({ slot, id, name }) => {
        const cur = this.board[slot], done = cur === id;
        return { slot, name, id, done, text: done ? `${slot + 1}番は「${name}」` : (cur !== null ? `${slot + 1}番を「${name}」に替えよう` : guideText(slot, name)) };
      });
      const next = steps.find((st) => !st.done) || null;
      if (next) { this.emit('guide', { active: true, steps, next, cleared: false, label: `プリセット「${pg.name}」` }); return; }
      this.presetGuide = null;                                                    // ぜんぶ置かれた: 案内は、おしまい
      this.emit('presetDone', { name: pg.name });
    }
    if (!this.guideOn || this.mode !== 'tutorial') { this.emit('guide', { active: false, steps: [], next: null, cleared: this.cleared }); return; }
    const steps = this._guideSteps();
    const next = steps.find((s) => !s.done) || null;
    this.emit('guide', { active: true, steps, next, cleared: this.cleared });
  }

  // ---------- ヒント ----------
  setHints(on) { this.hintsOn = !!on; this._updateHints(); }

  _updateHints() {
    if (!this.hintsOn || (this.stage && this.stage.noTricks)) { this.suggestions = null; this.emit('hints', null); return; }
    this.suggestions = suggest(this.board, this.table, this.allowed, { slotsPerBar: this.slotsPerBar, melody: this.melody, split: this.split });
    this.emit('hints', this.suggestions);
  }

  // ---------- クリアの判定 ----------
  goalMet() {
    const g = this.stage && this.stage.goal;
    if (!g) return false;
    if (g.slots) return g.slots.every(([slot, name]) => this.board[slot] === this.table.byName(name).id);       // 指定の駒を、指定の場所に置く
    if (g.count) return this.board.filter((x) => x !== null).length >= g.count;
    const okKind = (k) => (g.kinds ? g.kinds.includes(k) : k === g.kind);          // kinds: [...] = このどれかの技が決まればよい
    // finish: 技が決まっているだけでなく、最後まで（着地の駒まで）置かれていること
    if (g.finish && !g.finish.every(([slot, name]) => this.board[slot] === this.table.byName(name).id)) return false;
    return this.analysis.instances.some((i) => okKind(i.kind) && (!g.variant || i.variant === g.variant));
  }

  _checkGoal() {
    if (this.cleared || this.mode !== 'tutorial' || !this.touched || !this.goalMet()) return;   // 駒が動かされる前（実機の盤に、もともと置いてあった駒だけ）では、クリアにしない
    this.cleared = true;
    const rec = this.save.cleared[this.stage.id] || {};
    this.save.cleared[this.stage.id] = { at: rec.at || Date.now(), best: Math.max(rec.best || 0, this.analysis.score.total) };
    writeSave(this.save);
    this.emit('stageClear', { stage: this.stage, instances: this.analysis.instances, score: this.analysis.score.total });
    this._updateGuide();
  }

  isUnlocked(stages, index) {
    if (this.save.unlockAll || index === 0) return true;
    return !!this.save.cleared[stages[index - 1].id];
  }

  // ---------- チャレンジステージ: 条件・ノルマ ----------
  // 盤が変わるたびに、条件・ノルマを調べて、様子が変わったときだけ 'trial' を知らせる
  _updateTrial() {
    if (this.mode !== 'trial' || !this.stage || !this.stage.rules) return;
    const st = evaluateTrial(this.stage, this.board, this.analysis, this.table, this.split);
    const key = JSON.stringify([st.rules.map((r) => [r.ok, r.now]), st.score, st.ready]);
    if (key === this._trialKey) return;
    this._trialKey = key;
    this.trialState = st;
    this.emit('trial', { state: st });
  }

  // 「提出する」: 条件が全部そろっていて、得点がノルマ以上なら、クリア（星と記録を残す）。そろっていなければ { ok: false, state }
  finishTrial() {
    if (this.mode !== 'trial' || !this.stage || !this.stage.rules) return null;
    const st = evaluateTrial(this.stage, this.board, this.analysis, this.table, this.split);
    if (!st.ready) return { ok: false, state: st };
    const stars = trialStars(this.stage, st.score);
    const rec = (this.save.trial = this.save.trial || {})[this.stage.id] || {};
    const isBest = st.score > (rec.best || 0);
    const best = Math.max(rec.best || 0, st.score);
    this.save.trial[this.stage.id] = { best, stars: Math.max(rec.stars || 0, stars), at: Date.now() };
    writeSave(this.save);
    this.cleared = true;
    const out = { ok: true, stage: this.stage, score: st.score, stars, best, isBest, state: st, result: this.analysis };
    this.emit('trialEnd', out);
    return out;
  }

  isTrialUnlocked(stages, index) {
    if (this.save.unlockAll || index === 0) return true;
    return !!(this.save.trial || {})[stages[index - 1].id];
  }

  // ---------- メロディのステージ: 「採点する」 ----------
  // いまの盤を、採点して、記録（最高得点・星）を残す。戻り値: { score, stars, par, best, isBest, result }。メロディのステージでなければ null
  finishMelody() {
    if (this.mode !== 'melody' || !this.melody || !this.stage) return null;
    const res = this.analysis;
    const score = res.score.total;
    const par = melodyPar(this.stage, this.table);
    const st = melodyStars(res, par);
    const stars = st.stars;
    const rec = (this.save.melody = this.save.melody || {})[this.stage.id] || {};
    const isBest = score > (rec.best || 0);
    const best = Math.max(rec.best || 0, score);
    this.save.melody[this.stage.id] = { best, stars: Math.max(rec.stars || 0, stars), match: Math.max(rec.match || 0, res.score.melodyMatch || 0), at: Date.now() };
    writeSave(this.save);
    const out = { stage: this.stage, score, stars, conds: st.conds, par, best, isBest, result: res };
    this.emit('melodyEnd', out);
    return out;
  }

  // ---------- タイムアタック（内部の名前は challenge） ----------
  startTimer() { this.timerRunning = true; this.timeLeft = this.stage.seconds || 90; this._lastWhole = Math.ceil(this.timeLeft); this.peak = this.analysis.score.total; }

  tick(dt) {
    if (!this.timerRunning) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const whole = Math.ceil(this.timeLeft);
    if (whole !== this._lastWhole) { this._lastWhole = whole; this.emit('timer', { left: whole }); }
    if (this.timeLeft <= 0) {
      this.timerRunning = false;
      const score = this.peak;
      const stars = (this.stage.stars || []).filter((s) => score >= s).length;
      if (score > this.save.best.challenge) { this.save.best.challenge = score; writeSave(this.save); }
      this.emit('challengeEnd', { score, stars, best: this.save.best.challenge });
    }
  }

  // 図鑑（技の種類のうち、見つけたもの）
  collection() {
    return Object.entries(TRICKS).map(([kind, t]) => ({ kind, no: t.no, group: t.group, name: t.name, sub: t.sub || null, color: t.color, found: this.save.discovered.includes(kind) }))
      .sort((a, b) => a.no - b.no);
  }
}
