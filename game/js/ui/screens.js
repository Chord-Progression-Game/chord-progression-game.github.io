// 画面の切り替え（起動・タイトル・ステージ選択・メニュー・結果）。
import { $, $$, h, clear } from './dom.js';
import { trickTitle, trickSub } from './hud.js';

const NAMES = ['splash', 'title', 'stages', 'hud', 'pause', 'presets', 'studio', 'chordlab', 'trickdetail', 'libimport', 'howto', 'result'];

export class Screens {
  constructor() {
    this.current = 'splash';                  // いちばん上に見えている画面（重ねた画面があれば、それ）
    this.base = 'splash';                     // 土台の画面（タイトル・ステージ選択・HUD など）
    this.overlay = null;                      // 重ねた画面（メニュー・結果・編集画面・取り込みなど）
    this.onOverlay = null;                    // 上に重ねる画面（メニュー・結果・編集画面など）が出るとき、呼ぶ（app.js が、スマホのシートを閉じるのに使う）
  }

  // name: 表示する主な画面。overlay: その上に重ねる画面（例: HUD の上に、メニューや結果）
  show(name, overlay = null) {
    for (const n of NAMES) $(`#${n}`).classList.add('hidden');
    $(`#${name}`).classList.remove('hidden');
    if (overlay) $(`#${overlay}`).classList.remove('hidden');
    this.base = name;
    this.overlay = overlay;
    this.current = overlay || name;
    this.sync();
    if (overlay && this.onOverlay) this.onOverlay(overlay);
  }

  // 重ねた画面を閉じる。土台の画面にもどる
  hide(name) {
    $(`#${name}`).classList.add('hidden');
    if (this.overlay === name) { this.overlay = null; this.current = this.base; this.sync(); }
  }

  // CSS が、いまの画面で、見せるもの・隠すものを決められるように、body に書く。
  //   data-screen = 土台の画面（重ねた画面を開いても閉じても、変わらない。例: タイトルの背景では、技のスタンプを出さない）
  //   data-overlay = 重ねた画面（なければ、空）
  sync() {
    document.body.dataset.screen = this.base;
    document.body.dataset.overlay = this.overlay || '';
  }

  // ステージ選択のカード
  buildStageGrid(stages, specials, game, onPick) {
    const grid = clear($('#stage-grid'));
    stages.forEach((s, i) => {
      const unlocked = game.isUnlocked(stages, i);
      const rec = game.save.cleared[s.id];
      const card = h('button', { class: `stage-card${unlocked ? '' : ' locked'}${rec ? ' cleared' : ''}`, style: { '--c': s.color || '#6c7a96' }, onclick: () => { if (unlocked) onPick(s, 'tutorial'); } },
        h('span', { class: 'no' }, `STAGE ${String(s.no).padStart(2, '0')}`),
        h('span', { class: 'ttl' }, s.title),
        h('span', { class: 'sub' }, s.sub),
        h('span', { class: 'st' }, !unlocked ? '🔒 ひとつ前をクリアで開く' : rec ? `✓ クリア ／ ベスト ${rec.best}` : 'NEW'));
      grid.append(card);
    });
    for (const sp of specials) {
      if (sp.mode === 'melody-menu') {                              // 「メロディにコードをつける」の、入り口（メロディを選ぶ画面へ）
        const done = Object.keys(game.save.melody || {}).length;
        grid.append(h('button', { class: 'stage-card special', dataset: { stage: 'melody-menu' }, style: { '--c': '#6fb7d9' }, onclick: () => onPick(null, 'melody-menu') },
          h('span', { class: 'no' }, 'MELODY'), h('span', { class: 'ttl' }, 'メロディーにコードをつける'), h('span', { class: 'sub' }, '流れるメロディーに和音を合わせる'),
          h('span', { class: 'st' }, done ? `${done}つ 挑戦ずみ` : 'メロディを選ぶ')));
        continue;
      }
      const bestKey = sp.mode === 'challenge' ? game.save.best.challenge : game.save.best.free;
      grid.append(h('button', { class: 'stage-card special', style: { '--c': sp.mode === 'challenge' ? '#e2573c' : '#86c79a' }, onclick: () => onPick(sp.stage, sp.mode) },
        h('span', { class: 'no' }, sp.mode === 'challenge' ? 'TIME ATTACK' : 'FREE PLAY'),
        h('span', { class: 'ttl' }, sp.stage.title),
        h('span', { class: 'sub' }, sp.stage.sub),
        h('span', { class: 'st' }, bestKey ? `ベスト ${bestKey}` : 'すぐに遊べる')));
    }
  }

  // チャレンジステージのカード（「チャレンジステージ」の画面）。ステージ選択と同じ見た目。前のステージをクリア（提出）すると開く。星・ベストも出す
  buildTrialGrid(stages, game, onPick) {
    const grid = clear($('#stage-grid'));
    stages.forEach((s, i) => {
      const unlocked = game.isTrialUnlocked(stages, i);
      const rec = (game.save.trial || {})[s.id];
      const stars = rec ? '★'.repeat(rec.stars || 0) + '☆'.repeat(3 - (rec.stars || 0)) : '';
      grid.append(h('button', { class: `stage-card trial${unlocked ? '' : ' locked'}${rec ? ' cleared' : ''}`, dataset: { stage: s.id }, style: { '--c': s.color || '#6c7a96' }, onclick: () => { if (unlocked) onPick(s); } },
        h('span', { class: 'no' }, `CHALLENGE ${String(s.no).padStart(2, '0')}`),
        h('span', { class: 'ttl' }, s.title),
        h('span', { class: 'sub' }, s.sub),
        h('span', { class: 'st' }, !unlocked ? '🔒 ひとつ前をクリアで開く' : rec ? `${stars}  ベスト ${rec.best}（ノルマ ${s.norm}）` : `NEW ／ ノルマ ${s.norm}点`)));
    });
  }

  // メロディのステージのカード（「メロディーにコードをつける」の画面）。ステージ選択と同じ見た目。記録（最高得点・星）も出す
  buildMelodyGrid(melodies, game, onPick) {
    const grid = clear($('#stage-grid'));
    melodies.forEach((m) => {
      const rec = (game.save.melody || {})[m.id];
      const stars = rec ? '★'.repeat(rec.stars || 0) + '☆'.repeat(3 - (rec.stars || 0)) : '';
      grid.append(h('button', { class: `stage-card melody${rec ? ' cleared' : ''}`, dataset: { stage: m.id }, style: { '--c': m.color }, onclick: () => onPick(m) },
        h('span', { class: 'no' }, `MELODY ${String(m.no).padStart(2, '0')}`),
        h('span', { class: 'ttl' }, m.title),
        h('span', { class: 'sub' }, m.sub),
        h('span', { class: 'st' }, rec ? `${stars}  ベスト ${rec.best}（相性 ${Math.round((rec.match || 0) * 100)}%）` : 'NEW')));
    });
  }

  // 結果
  showResult({ kicker, title, stars = null, score = null, scoreNote = '', paragraphs = [], extras = [], tricks = [], buttons = [] }) {
    $('#result-kicker').textContent = kicker;
    $('#result-title').textContent = title;
    const st = $('#result-stars');
    if (stars === null) st.classList.add('hidden');
    else { st.classList.remove('hidden'); st.innerHTML = [0, 1, 2].map((i) => (i < stars ? '<b>★</b>' : '☆')).join(''); }
    const sc = $('#result-score');
    if (score === null) sc.classList.add('hidden'); else { sc.classList.remove('hidden'); sc.innerHTML = `${score}<small>${scoreNote}</small>`; }
    const body = clear($('#result-body'));
    for (const p of paragraphs) body.append(h('p', {}, p));
    for (const x of extras) body.append(x);                     // 追加の部品（メロディの、ステップごとの結果の表など）
    const box = clear($('#result-tricks'));
    for (const ins of tricks) {
      const sub = trickSub(ins);
      box.append(h('div', { class: 'rt', style: { '--c': ins.color } }, h('b', {}, `${trickTitle(ins)}`, sub ? h('small', {}, sub) : null, h('small', {}, `+${ins.total}`)), h('span', { style: { color: 'var(--dim)', fontWeight: '700' } }, ins.chords.join(' → ')), h('span', {}, ins.reason)));
    }
    const btns = clear($('#result-btns'));
    for (const b of buttons) btns.append(h('button', { class: b.primary ? 'primary' : '', onclick: () => { if (this.overlay === 'result') b.onClick(); } }, b.label));         // 結果の画面が見えているときだけ、効く（閉じたあとの、古いボタンで、状態がこわれないように）
    this.show('hud', 'result');
  }
}
