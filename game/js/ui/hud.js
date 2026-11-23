// ゲーム中の画面（HUD）: 駒のトレイ・得点・技の一覧・案内・スタンプ・タイマーなど。
//   ゲームの状態は持たない。呼ばれた内容を、画面に出すだけ。
import { $, h, clear } from './dom.js';
import { FN_NAMES } from '../render/scene.js';
import { TRICKS, instanceKey } from '../core/tricks.js';
import { VERDICT } from '../core/melody.js';
import { legendEl } from './melodyview.js';

// 技の表示名: 「王道進行」のように、よく知られた名前があれば、それを大きく。「？」（小節の頭の Ⅴ）は、「？ 小節頭のⅤ」
export function trickTitle(ins) { return ins.warn ? `？ ${ins.title}` : (ins.sub && !ins.variant ? ins.sub : ins.name); }
export function trickSub(ins) { return ins.warn ? '' : (ins.variant || (ins.sub ? ins.name : '')); }
const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

// メロディの、1つのステップの結果を、「理由」の欄（setWhy）に出せる形にする
function melodyStepWhy(st) {
  const v = VERDICT[st.verdict] || VERDICT.rest;
  const color = st.verdict === 'bad' ? '#e0674d' : st.verdict === 'mixed' ? '#d9b24c' : st.verdict === 'missing' || st.verdict === 'rest' ? '#aaa393' : '#86c79a';
  const head = st.chord ? `${st.step + 1}番の ${st.chord}: ${v.text}。` : '';
  return { id: `melody|step|${st.step}`, kind: 'melody', variant: null, sub: null, startPos: st.step, endPos: st.step, endFirst: st.step,
    name: `メロディ ${st.step + 1}番`, title: `メロディ ${st.step + 1}番`, color, reason: `${head}${st.text}` };
}

// 駒のカード1枚（トレイ・ドラッグ中の影・編集画面の見本）。自作コード・編集したコードは、選んだ色・形で出す
export function cardEl(c) {
  const len = [...c.name].length;
  const sym = c.isRepeat ? '前と同じ' : c.symbol;
  const style = c.color ? { '--c': c.color } : null;
  return h('div', { class: `pc${c.custom ? ' custom' : ''}${c.edited ? ' edited' : ''}`, dataset: c.shape ? { id: String(c.id), fn: c.fn, shape: c.shape } : { id: String(c.id), fn: c.fn }, style,
    title: `${c.symbol}（${FN_NAMES[c.fn] || ''}）${c.custom ? ' 自作' : c.edited ? ' 編集ずみ' : ''}` },
    h('div', { class: 'ic' }),
    h('div', { class: `nm${len >= 9 ? ' xxlong' : len >= 7 ? ' xlong' : len >= 4 ? ' long' : ''}` }, c.name),
    h('div', { class: `sy${[...sym].length >= 9 ? ' long' : ''}` }, sym),
    h('div', { class: 'lv' }, c.isRepeat ? [] : c.level === null || c.level === undefined ? h('em', {}, c.custom ? '自作' : '') : [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= c.level ? 'on' : '' }))),
    h('div', { class: 'tag' }, ''));
}

export class HUD {
  constructor({ table, save }) {
    this.table = table;
    this.save = save;
    this.el = {
      tray: $('#tray'), trickList: $('#trick-list'), scoreNum: $('#score-num'), combo: $('#combo-chip'), variety: $('#variety-chip'), best: $('#score-best'),
      guideBody: $('#guide-body'), guideTitle: $('#guide-title'), guide: $('#guide'), stamp: $('#stamp-layer'), toasts: $('#toasts'),
      stageNo: $('#stage-no'), stageTitle: $('#stage-title'), goalChip: $('#goal-chip'), goalText: $('#goal-text'),
      bpm: $('#bpm-num'), timer: $('#timer'), timerNum: $('#timer-num'), collection: $('#collection'), collectionCount: $('#collection-count'),
      orig: $('#orig'), why: $('#why'), whyName: $('#why-name'), whyText: $('#why-text'), whyMore: $('#why-more'), stepBar: $('#step-bar'),
    };
    this.onAddChord = null;                                   // 「＋」（トレイの、新しいコードをつくる）を押したとき（app.js が決める）
    this.onOpenDetail = null;                                // 技の詳細を開く（app.js が決める）。引数: 技（instance）か「？」
    this._whyIns = null;
    this.el.whyMore.addEventListener('click', () => { if (this._whyIns && this.onOpenDetail) this.onOpenDetail(this._whyIns); });
    this.shownScore = 0; this.targetScore = 0; this._scoreAnim = 0;
    this.stage = null; this.mode = 'free';
    this.cards = new Map();
  }

  // ---------- ステージの見出し・目標 ----------
  setStage(stage, mode) {
    this.stage = stage; this.mode = mode;
    const e = this.el;
    e.stageNo.textContent = mode === 'tutorial' ? `STAGE ${String(stage.no).padStart(2, '0')}` : mode === 'challenge' ? 'CHALLENGE' : mode === 'melody' ? `MELODY ${String(stage.no).padStart(2, '0')}` : 'FREE PLAY';
    e.stageTitle.textContent = stage.title;
    e.goalChip.style.setProperty('--c', stage.color || '#66ffcc');
    e.goalChip.classList.remove('done');
    e.goalText.textContent = stage.goalText || '';
    e.goalChip.classList.toggle('hidden', !stage.goalText);
    e.guideTitle.textContent = stage.title;
    this.setTimerVisible(mode === 'challenge');
    this._buildGuideBody();
    this.setWhy(null);
    this.setScore(0, true);
    this.el.best.textContent = mode === 'free' ? `ベスト ${this.save.best.free || 0}` : mode === 'challenge' ? `ベスト ${this.save.best.challenge || 0}` : mode === 'melody' ? `ベスト ${((this.save.melody || {})[stage.id] || {}).best || 0}` : '';
  }

  setGoalDone(done) { if (!this.stage || !this.stage.goalText) return; this.el.goalChip.classList.toggle('done', !!done); this.el.goalText.textContent = done ? `✓ ${this.stage.doneText || this.stage.goalText.replace('を決めよう', 'が決まった！').replace('を置いてみよう', '')}` : this.stage.goalText; }

  _buildGuideBody() {
    const s = this.stage, body = clear(this.el.guideBody);
    if (this.mode === 'tutorial') {
      for (const p of s.intro) body.append(h('p', {}, p));
      this.stepBox = h('div', { class: 'steps' });
      body.append(this.stepBox);
      body.append(h('div', { class: 'note' }, 'わからなくなったら右上の「ヒント」を押すと、次の候補がうっすら出ます。'));
    } else if (this.mode === 'challenge') {
      body.append(h('p', {}, '制限時間のあいだに技を決めて、得点をのばそう。'), h('p', {}, '得点は「いま盤の上で決まっている技」の合計です。駒をはずしても点がなくなるだけ。何度でも組み替えられます。'),
        h('p', {}, 'ドラッグした駒を盤の外に出すと、取りやめになります。'));
      this.stepBox = h('div', { class: 'steps' }); body.append(this.stepBox);
    } else if (this.mode === 'melody') {
      for (const p of s.intro) body.append(h('p', {}, p));
      body.append(legendEl(h));
      for (const t of s.tips || []) body.append(h('div', { class: 'note tip' }, `ポイント: ${t}`));
      body.append(h('div', { class: 'note' }, '得点 = コード進行の点（技・ジャッジ）+ メロディとの相性の点。和音を置くたびに帯の音の色と点が変わります。置き終わったら、帯の「できた！ 採点する」を押そう。'));
      this.stepBox = h('div', { class: 'steps' }); body.append(this.stepBox);
    } else {
      body.append(h('p', {}, '駒をドラッグして盤に置こう。1〜8の順番にループして演奏されます。'), h('p', {}, `技が決まると、その部分が光って名前が出ます。${Object.keys(TRICKS).length}種類の技を全部見つけてみよう。`),
        h('p', {}, '置いた駒はドラッグで動かせます。ダブルクリックではずせます。'), h('p', {}, '気に入った進行は上の「☆ プリセット」で保存できます。'), h('p', {}, 'できた進行には上の「♪ メロディ」でメロディをつけられます。自動でつけることも自分で書くこともできます。プリセットにはメロディもいっしょに保存できます。'));
      this.stepBox = h('div', { class: 'steps' }); body.append(this.stepBox);
    }
  }

  // スマホ: チュートリアル（・プリセットの案内）の、いま置くところを、上の細い帯に出す
  _renderStepBar(guide) {
    const bar = this.el.stepBar;
    if (!bar) return;
    const on = !!(guide && guide.active && guide.steps && guide.steps.length);
    bar.classList.toggle('show', on);
    document.body.classList.toggle('step-bar-on', on);
    if (!on) return;
    const next = guide.next;
    bar.classList.toggle('done', !next);
    clear(bar).append(h('span', { class: 'n' }, next ? String(guide.steps.indexOf(next) + 1) : '✓'), h('span', {}, next ? next.text : 'ぜんぶ置けました！'));
  }

  setGuide(guide) {
    this._renderStepBar(guide);
    if (!this.stepBox) return;
    clear(this.stepBox);
    if (!guide.active) return;
    if (guide.label) {                                   // プリセットの案内（実機の盤のとき）
      this.stepBox.append(h('div', { class: 'note' }, `${guide.label}を実機の盤に置こう。`),
        h('button', { class: 'chip', id: 'btn-preset-guide-cancel', onclick: () => this.onPresetGuideCancel && this.onPresetGuideCancel() }, '案内をやめる'));
    }
    guide.steps.forEach((st, i) => {
      const cls = st.done ? 'step done' : (guide.next === st ? 'step now' : 'step');
      this.stepBox.append(h('div', { class: cls }, h('span', { class: 'n' }, st.done ? '✓' : String(i + 1)), h('span', {}, st.text)));
    });
  }

  // ---------- 駒のトレイ ----------
  //   grouped: Lv. の段ごとに、見出しを出す（自作コード（Lv. 未設定）は、「自作」の段）。addButton: 自作の段のおわりに、「＋」（新しいコードをつくる）を出す（フリープレイだけ）
  buildTray(ids, { grouped = false, addButton = false } = {}) {
    const tray = clear(this.el.tray);
    this.cards.clear();
    let lastGroup = null, added = false;
    const groupOf = (c) => (c.isRepeat ? 'rep' : c.level === null || c.level === undefined ? 'my' : c.level);
    const sep = (label) => tray.append(h('div', { class: 'sep' }, label));
    const addCard = () => {
      if (added) return;
      added = true;
      if (grouped && lastGroup !== 'my') { sep('自作'); lastGroup = 'my'; }
      tray.append(h('button', { class: 'pcadd', id: 'btn-chord-add', title: '新しいコードをつくる（ピアノロールのような画面で、音を置いて作ります）', onclick: () => { if (this.onAddChord) this.onAddChord(); } },
        h('div', { class: 'plus' }, '＋'), h('div', { class: 'nm' }, 'つくる'), h('div', { class: 'sy' }, 'コードを追加')));
    };
    for (const id of ids) {
      const c = this.table.byId(id);
      if (!c) continue;
      if (addButton && c.isRepeat) addCard();                                           // 「→」（つなぎ）の前に、「＋」
      const g = groupOf(c);
      if (grouped && g !== lastGroup) {
        sep(c.isRepeat ? 'つなぎ' : g === 'my' ? '自作' : `Lv.${c.level}`);
        lastGroup = g;
      }
      const card = this.makeCard(id);
      tray.append(card);
      this.cards.set(id, card);
    }
    if (addButton) addCard();
  }

  // 駒のカード1枚（トレイにも、ドラッグ中の影にも使う）
  makeCard(id) { return cardEl(this.table.byId(id)); }

  // ヒント・案内の印を、カードに付ける
  markTray({ primary = [], advanced = [], guide = null, reasons = new Map() } = {}) {
    for (const [id, card] of this.cards) {
      const c = this.table.byId(id);
      if (!c) continue;                                     // 削除した自作コードの駒（トレイを作りなおす前）は、さわらない
      card.classList.remove('hint1', 'hint2', 'guide');
      card.removeAttribute('data-why');
      const tag = card.querySelector('.tag');
      card.title = `${c.symbol}（${FN_NAMES[c.fn] || ''}）`;
      if (guide === id) { card.classList.add('guide'); tag.textContent = 'これを置こう'; }
      else if (primary.includes(id)) { card.classList.add('hint1'); tag.textContent = 'おすすめ'; }
      else if (advanced.includes(id)) { card.classList.add('hint2'); tag.textContent = '発展'; }
      if (reasons.has(id)) card.title = `${c.symbol}\n${reasons.get(id)}`;
    }
    const key = `${guide}|${primary.join(',')}`;
    if (key !== this._markKey) { this._markKey = key; this._scrollToMarked(); }
  }

  _scrollToMarked() {
    const first = this.el.tray.querySelector('.pc.guide') || this.el.tray.querySelector('.pc.hint1');
    if (!first) return;
    const t = this.el.tray.getBoundingClientRect(), c = first.getBoundingClientRect();
    if (c.left < t.left + 8 || c.right > t.right - 8) first.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  setArmed(id) { for (const [cid, card] of this.cards) card.classList.toggle('armed', cid === id); }

  // ---------- 得点・技の一覧 ----------
  setScore(total, instant = false) {
    this.targetScore = total;
    if (instant) { this.shownScore = total; this.el.scoreNum.textContent = String(total); return; }
    if (this._scoreAnim) return;
    const step = () => {
      const diff = this.targetScore - this.shownScore;
      if (Math.abs(diff) < 2) { this.shownScore = this.targetScore; this.el.scoreNum.textContent = String(this.shownScore); this._scoreAnim = 0; return; }
      this.shownScore += diff * 0.22;
      this.el.scoreNum.textContent = String(Math.round(this.shownScore));
      this._scoreAnim = requestAnimationFrame(step);
    };
    this._scoreAnim = requestAnimationFrame(step);
    this.el.scoreNum.classList.add('bump');
    setTimeout(() => this.el.scoreNum.classList.remove('bump'), 160);
  }

  setAnalysis(result) {
    const e = this.el;
    this.setScore(result.score.total);
    const maxMult = Math.max(1, ...result.instances.map((i) => i.comboMult || 1));
    e.combo.textContent = `COMBO ×${maxMult}`;
    e.variety.textContent = `種類 ${result.score.kinds}`;
    const oddities = result.oddities || [];
    const critiques = result.critiques || [];
    const melodyWhys = result.melody ? result.melody.steps.map(melodyStepWhy) : [];
    if (this._whyKey && ![...result.instances, ...oddities, ...critiques, ...melodyWhys].some((i) => instanceKey(i) === this._whyKey)) this.setWhy(null);     // 説明していた技が、盤からなくなった
    const list = clear(e.trickList);
    // ジャッジ（講評）の加点・減点
    const sg = result.score.senseGood || 0, sb = result.score.senseBad || 0;
    const chip = $('#sense-chip');
    if (chip) { chip.classList.toggle('hidden', !sg && !sb); chip.textContent = `ジャッジ ${sg ? `+${sg}` : ''}${sg && sb ? ' ' : ''}${sb ? `−${sb}` : ''}`; }
    const mc = $('#melody-chip');                                                  // メロディのステージ: メロディとの相性の点
    if (mc) {
      const m = result.melody;
      mc.classList.toggle('hidden', !m);
      if (m) { mc.textContent = `メロディ ${signed(m.total)}`; mc.classList.toggle('good', m.match >= 0.8); mc.classList.toggle('bad', m.scored > 0 && m.sumPoints < 0); }
    }
    if (!result.instances.length && !oddities.length && !critiques.length) {
      list.append(h('li', { class: 'empty' }, 'まだ技は決まっていません。駒を並べてつなげてみよう。'));
    }
    for (const ins of result.instances) {
      const sub = trickSub(ins);
      list.append(h('li', { class: 'clickable', style: { '--c': ins.color }, title: 'クリックで、この技の詳しい説明（使われている曲など）', onclick: () => this.openDetail(ins) },
        h('div', { class: 'nm' }, trickTitle(ins), sub ? h('small', {}, sub) : null, h('small', { style: { color: 'var(--faint)' } }, `${ins.seam ? 'ループ ' : ''}${ins.chords.join(' → ')}`)),
        h('div', { class: 'pt' }, `+${ins.total}`)));
    }
    // 「？」: 冒頭（1番）のドミナント系の駒（Ⅴ・Ⅲ7・Ⅰ7 など）。技にならず、100点の減点
    for (const o of oddities) {
      list.append(h('li', { class: 'warn clickable', style: { '--c': o.color }, title: 'クリックで、「？」の説明', onclick: () => this.openDetail(o) },
        h('div', { class: 'nm' }, trickTitle(o), h('small', { style: { color: 'var(--faint)' } }, `${o.chords[0]}（${o.startPos + 1}番）`)),
        h('div', { class: 'pt' }, signed(o.total))));
    }
    // ジャッジの講評: 名前のついた技にならなくても、耳に馴染む並びは加点・進行感のない並びは減点（理由は、行にマウスを置くか、「理由」の欄に出る）
    for (const c of critiques) {
      list.append(h('li', { class: `sense ${c.kind}${c.group ? ` ${c.group}` : ''}`, style: { '--c': c.color }, title: c.reason, onclick: () => { this.setWhy(c); this.revealWhy(); } },
        h('div', { class: 'nm' }, c.name, h('small', { style: { color: 'var(--faint)' } }, c.chords.join(' → '))),
        h('div', { class: 'pt' }, c.points === 0 ? '—' : signed(c.points))));
    }
    // 技にならなかったつながり（オリジナルの動き）
    const un = result.unclaimed.slice(0, 3);
    if (un.length) {
      clear(e.orig).append(h('b', {}, 'オリジナル'), ' 技にならなかったつながり（描写だけ。加点・減点は上の「ジャッジ」の行）', h('br'),
        ...un.flatMap((u) => [`${u.from} → ${u.to}`, h('span', { style: { color: 'var(--faint)' } }, `（${u.tags.join('・')}）`), h('br')]));
      e.orig.classList.remove('hidden');
    } else e.orig.classList.add('hidden');
  }

  setCollection(items) {
    const box = clear(this.el.collection);
    for (const it of items) box.append(h('div', { class: `col-dot${it.found ? ' found' : ''}`, style: { '--c': it.color }, title: `${it.sub && it.kind !== 'oudou' ? it.sub : it.name}${it.found ? '' : '（まだ）'}` }, String(it.no)));
    this.el.collectionCount.textContent = `${items.filter((i) => i.found).length} / ${items.length}`;
  }

  // ---------- スタンプ・通知 ----------
  showStamp(ins, first) {
    const layer = this.el.stamp;
    while (layer.children.length >= 1) layer.removeChild(layer.firstChild);       // 新しい技のスタンプが、前のを置き換える
    const sub = trickSub(ins), title = trickTitle(ins);
    const el = h('div', { class: 'stamp', style: { '--c': ins.color }, title: 'クリックで、この技の詳しい説明', onclick: () => this.openDetail(ins) },
      h('div', { class: 'kicker' }, 'トリック', first ? h('em', {}, '初めて') : null),
      h('div', { class: `name${[...title].length >= 9 ? ' long' : ''}` }, title),
      h('div', { class: 'meta' }, sub ? h('span', { class: 'sub' }, sub) : null,
        h('span', { class: 'pts' }, `+${ins.total}${ins.comboMult > 1 ? `  ×${ins.comboMult} COMBO` : ''}`)));
    layer.append(el);
    setTimeout(() => el.remove(), 3000);
    this.setWhy(ins);
  }

  // 「？」のスタンプ（小節の頭の Ⅴ）。技のスタンプより、地味に・小さく出す
  showOddity(o) {
    const layer = this.el.stamp;
    while (layer.children.length >= 1) layer.removeChild(layer.firstChild);
    const el = h('div', { class: 'stamp warn', style: { '--c': o.color }, title: 'クリックで、「？」の説明', onclick: () => this.openDetail(o) },
      h('div', { class: 'kicker' }, 'うーん…'),
      h('div', { class: 'name' }, '？'),
      h('div', { class: 'meta' }, h('span', { class: 'sub' }, `${o.startPos + 1}番の ${o.chords[0]}（冒頭のドミナント）`), h('span', { class: 'pts neg' }, signed(o.total))));
    layer.append(el);
    setTimeout(() => el.remove(), 3000);
    this.setWhy(o);
  }

  clearStamps() { this.el.stamp.replaceChildren(); }

  // 最後に決まった技の「なぜ」を、右の列に残す（盤からその技がなくなったら、消す）
  openDetail(ins) { if (this.onOpenDetail) this.onOpenDetail(ins); }

  setWhy(ins) {
    const e = this.el;
    this._whyKey = ins ? instanceKey(ins) : null;
    this._whyIns = ins || null;
    e.why.classList.toggle('hidden', !ins);
    if (!ins) return;
    e.whyMore.classList.toggle('hidden', !(ins.warn || TRICKS[ins.kind]));             // 技（と「？」）だけ、詳しい説明がある（ジャッジの講評・メロディには、ない）
    const sub = trickSub(ins);
    e.why.style.setProperty('--c', ins.color);
    e.whyName.textContent = `${trickTitle(ins)}${sub ? `（${sub}）` : ''}`;
    e.whyText.textContent = ins.reason;
    e.why.style.animation = 'none'; void e.why.offsetWidth; e.why.style.animation = '';     // 新しい技のたびに、すべり込ませる
  }

  // メロディの帯の、1つのステップ（列）をクリックしたとき: そのステップの、聞こえ方の理由を、「理由」の欄に出す
  showMelodyStep(stepResult) { if (stepResult) { this.setWhy(melodyStepWhy(stepResult)); this.revealWhy(); } }

  // 「理由」の欄が、右の列の、見えていないところにあるとき（技の一覧が長いとき）は、見えるところまで、スクロールする
  revealWhy() { requestAnimationFrame(() => { try { this.el.why.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 何もしない */ } }); }

  toast(text) {
    const el = h('div', { class: 'toast' }, text);
    this.el.toasts.append(el);
    setTimeout(() => el.remove(), 3100);
  }

  setBpm(bpm) { this.el.bpm.textContent = String(bpm); }
  setTimerVisible(on) { this.el.timer.classList.toggle('hidden', !on); }
  setTimer(left) { this.el.timerNum.textContent = String(left); this.el.timer.classList.toggle('low', left <= 10); }
  setToggle(btnId, on, labelId) { const b = $(btnId); b.classList.toggle('on', !!on); if (labelId) $(labelId).textContent = on ? 'ON' : 'OFF'; }
}

export { TRICKS };
