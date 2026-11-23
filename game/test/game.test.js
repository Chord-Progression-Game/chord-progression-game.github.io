// ゲームの進行（ステージ・案内・ヒント・チャレンジ）のテスト。画面なしで、イベントを受けて確かめる。
import { ChordTable } from '../js/core/chords.js';
import { Game } from '../js/game/game.js';
import { STAGES, FREE_STAGE, CHALLENGE_STAGE } from '../js/game/stages.js';
import { analyze, TRICKS } from '../js/core/tricks.js';
import { suggest } from '../js/core/hints.js';
import { MELODY_STAGES, melodyPar, melodyStars } from '../js/game/melodies.js';
import { TRIAL_STAGES, evaluateTrial, trialStars, nextTrialAfter } from '../js/game/trials.js';

export async function run(t) {
  const table = new ChordTable(await (await fetch('../data/chords.json')).json());
  const presets = await (await fetch('../data/presets.json')).json();
  const blank = () => ({ cleared: {}, discovered: [], best: { free: 0, challenge: 0 }, unlockAll: false });
  const mk = () => new Game({ table, presets, save: blank() });
  const id = (n) => table.byName(n).id;

  // ============ ステージの定義 ============
  t.eq('チュートリアルは、はじめに + 技の13ステージ = 14ステージ', STAGES.length, 14);
  t.eq('ステージ番号は 0〜13', STAGES.map((s) => s.no), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  t.eq('ステージの id は重複しない', new Set(STAGES.map((s) => s.id)).size, STAGES.length);
  const goalKinds = new Set(STAGES.flatMap((s) => (s.goal && s.goal.kinds) || (s.goal && s.goal.kind ? [s.goal.kind] : [])));
  t.ok('チュートリアルが扱う技は、すべて、技の一覧にある', [...goalKinds].every((k) => TRICKS[k]));
  t.ok('最初の10個の技と、偽終止・丸サ進行が、チュートリアルにそろっている',
    ['dominant_motion', 'weak_motion', 'half_step_down', 'authentic_cadence', 'dominant_ending', 'picardy', 'iv_iii_vi', 'iv_v_vi', 'oudou', 'komuro', 'deceptive_cadence', 'maru_sa', 'confirmation'].every((k) => goalKinds.has(k)));
  t.ok('名前を「前半」「途中まで」とした、ステージ・文章がない', STAGES.every((s) => ![s.title, s.sub, s.goalText, ...s.intro, ...s.outro].some((x) => /前半|途中まで/.test(x || ''))));
  for (const s of STAGES) {
    t.ok(`${s.id}: 使う駒が、すべて表にある`, s.pieces.every((n) => !!table.byName(n)));
    t.ok(`${s.id}: お手本の駒が、使える駒の中にある`, s.solution.every(([, n]) => s.pieces.includes(n)));
    // お手本どおりに置くと、クリアになる
    const g = mk(); g.loadStage(s, 'tutorial');
    let cleared = false; g.on('stageClear', () => { cleared = true; });
    for (const [slot, name] of s.solution) g.place(slot, id(name));
    t.ok(`${s.id}「${s.title}」: お手本どおりに置くと、クリア`, cleared && g.cleared);
    t.ok(`${s.id}: 置く前は、クリアになっていない`, (() => { const h = mk(); h.loadStage(s, 'tutorial'); return !h.goalMet(); })());
  }

  // ============ 案内（チュートリアル）============
  {
    const g = mk(); const st = STAGES[1];                       // Ⅴ-Ⅰ終止（終止は、フレーズの終わり。Ⅴ は小節の頭（1番・5番）に置かない）
    let guide = null; g.on('guide', (x) => { guide = x; });
    g.loadStage(st, 'tutorial');
    t.eq('案内: 最初は、2番に ⅣM7（ⅣM7 → Ⅴ7 → Ⅰ の進行の一部として、終止を覚える）', [guide.active, guide.next.slot, guide.next.name, guide.next.text], [true, 1, 'ⅣM7', '2番に「ⅣM7」を置こう']);
    g.place(1, id('ⅣM7'));
    t.eq('案内: 次は、3番に Ⅴ7', [guide.next.slot, guide.next.name], [2, 'Ⅴ7']);
    g.place(2, id('Ⅴ7'));
    t.eq('案内: その次は、4番に Ⅰ', [guide.next.slot, guide.next.name], [3, 'Ⅰ']);
    g.place(3, id('Ⅳ'));
    t.eq('案内: 違う駒を置いたら、「替えよう」', guide.next.text, '4番を「Ⅰ」に替えよう');
    t.eq('Ⅴ7 → Ⅳ では、まだクリアではない', g.cleared, false);
    g.place(3, id('Ⅰ'));
    t.eq('案内: クリア後は、次の手順なし', [guide.next, guide.cleared], [null, true]);
    t.eq('使えない駒は、置けない', g.place(5, id('Ⅱ♭7')), false);
    t.eq('使えない駒を、強制で置く（実機の盤）', g.place(5, id('Ⅱ♭7'), { force: true }), true);
  }
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    let guide = null; g.on('guide', (x) => { guide = x; });
    g.setGuide(true);
    t.eq('フリープレイでは、案内は出ない', guide.active, false);
    t.eq('フリープレイは、全部の駒が使える（31種 + →）', g.allowed.length, 32);
  }

  // ============ 技のイベント・図鑑 ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const tricks = []; g.on('trick', (e) => tricks.push([e.instance.kind, e.first]));
    let lastAnalysis = null; g.on('analysis', (e) => { lastAnalysis = e; });
    g.place(0, id('Ⅵm')); g.place(1, id('Ⅳ'));
    t.eq('2つ置いただけでは、まだ技なし（Ⅵm→Ⅳ は、どの技でもない）', tricks, []);
    g.place(2, id('Ⅴ'));
    t.eq('3つめで「小室進行」が決まる（初めて）', tricks, [['komuro', true]]);
    t.eq('判定のイベントに、新しい技が入っている', lastAnalysis.newInstances.map((i) => i.kind), ['komuro']);
    g.place(3, id('Ⅰ'));
    t.eq('Ⅰ を足すと、Ⅴ-Ⅰ終止が決まる（小室進行は、そのまま）', tricks.map((x) => x[0]), ['komuro', 'authentic_cadence']);
    t.eq('コンボ（2つがつながる）', g.analysis.chains.map((c) => c.length), [2]);
    g.remove(3);
    t.eq('Ⅰ をはずすと、Ⅴ-Ⅰ終止が消える', lastAnalysis.removed.map((i) => i.kind), ['authentic_cadence']);
    g.place(3, id('Ⅰ'));
    t.eq('もう一度置くと、また決まる（初めてではない）', tricks[tricks.length - 1], ['authentic_cadence', false]);
    t.eq('図鑑: 見つけた技', g.save.discovered.sort(), ['authentic_cadence', 'komuro']);
    t.eq('図鑑の一覧は26個。見つけたのは2つ', [g.collection().length, g.collection().filter((c) => c.found).length], [26, 2]);
    g.clear();
    t.eq('全部消すと、盤は空・技なし', [g.board.every((x) => x === null), g.analysis.instances.length], [true, 0]);
    g.place(0, id('Ⅰ')); t.eq('空きへ動かす', [g.move(0, 3), g.board[0], g.board[3] === id('Ⅰ')], [true, null, true]); t.eq('埋まっているところへは動かせない（入れ替えを使う）', [g.place(5, id('Ⅴ')), g.move(3, 5)], [true, false]); g.clear();
    g.place(2, id('Ⅰ')); g.place(3, id('Ⅴ')); g.swap(2, 3);
    t.eq('入れ替え', [g.board[2], g.board[3]], [id('Ⅴ'), id('Ⅰ')]);
    t.eq('入れ替えたあとは、Ⅴ→Ⅰ（3→4番 = Ⅴ-Ⅰ終止）', g.analysis.instances.map((i) => i.kind), ['authentic_cadence']);
  }

  // ============ 「？」（小節の頭の Ⅴ）============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const odd = []; g.on('oddity', (e) => odd.push([e.oddity.startPos, e.oddity.total]));
    const tricks = []; g.on('trick', (e) => tricks.push(e.instance.kind));
    g.place(1, id('Ⅰ')); g.place(0, id('Ⅴ7'));
    t.eq('1番に Ⅴ7 を置くと、「？」のイベント（1回）。Ⅴ7→Ⅰ は、技にならない', [odd, tricks, g.analysis.score.total], [[[0, -100]], [], 0]);
    g.place(2, id('Ⅳ'));
    t.eq('そのあと、ほかの駒を置いても、「？」は増えない（同じ「？」を、くり返し知らせない）', odd.length, 1);
    t.eq('技の点から、100点引く（Ⅰ→Ⅳ 強進行 100 - 100 = 0）', [g.analysis.score.base, g.analysis.score.penalty, g.analysis.score.total], [100, 100, 0]);
    g.remove(0);
    t.eq('Ⅴ7 をはずすと、「？」が消える', [g.analysis.oddities.length, g.analysis.score.penalty], [0, 0]);
    g.place(0, id('Ⅴ7'));
    t.eq('もう一度置くと、また「？」', odd.length, 2);
    g.setBoard([id('ⅣM7'), id('Ⅴ7'), id('Ⅲm7'), id('Ⅵm7'), id('Ⅴ'), null, null, null]);
    t.eq('実機の盤から、5番に Ⅴ が来ても「？」にならない（2026-11-18 から、冒頭の1番だけ）', g.analysis.oddities.map((o) => o.startPos), []);
    g.setBoard([id('Ⅲ7'), id('Ⅵm7'), null, null, null, null, null, null]);
    t.eq('実機の盤から、1番に Ⅲ7 が来たら「？」（セカンダリードミナントも、冒頭は −100）', g.analysis.oddities.map((o) => [o.startPos, o.chords[0]]), [[0, 'Ⅲ7']]);
    g.save.discovered.length = 0;
  }

  // ============ ジャッジ（講評）のイベント ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const crit = []; g.on('critique', (e) => crit.push([e.critique.id.split('|')[0], e.critique.points]));
    g.place(0, id('Ⅰ')); g.place(1, id('Ⅱm'));
    t.eq('講評: 2つでは、出ない', crit, []);
    g.place(2, id('Ⅲm'));
    t.eq('講評: 3つめで、階段（+60）のイベント', crit, [['stairs', 60]]);
    g.place(3, id('Ⅳ'));
    t.eq('講評: 4つに伸びたら、同じ階段でも、強くなった点（+60 → +90）で知らせ直す', [crit, g.analysis.critiques[0].points, g.analysis.score.senseGood], [[['stairs', 60], ['stairs', 90]], 90, 90]);
    g.remove(3);
    t.eq('講評: 4番を外すと、階段は3つ（+60）に戻る。弱くなったときは、知らせない', [crit.length, g.analysis.critiques[0].points], [2, 60]);
    g.remove(2); g.place(2, id('Ⅲm'));
    t.eq('講評: 階段の真ん中を外して（講評が消えて）、置き直すと、もう一度知らせる（3つ分の +60）', [crit.length, crit[crit.length - 1]], [3, ['stairs', 60]]);
    g.clear(); crit.length = 0;
    g.place(0, id('Ⅰ')); g.place(1, id('Ⅲ7')); g.place(2, id('Ⅵ♭M7'));
    t.eq('講評: 進行感なし（−40）と、役に立っていない駒（3つ × −15）のイベント。減点は、合計に入る（0 より下にはならない）', [crit, g.analysis.score.senseBad, g.analysis.score.total], [[['incoherent', -40], ['idle', -45]], 85, 0]);
  }
  {
    const g = mk(); const st = STAGES[0];                          // はじめに: 技の判定はおやすみ。講評も、出さない
    g.loadStage(st, 'tutorial');
    const crit = []; g.on('critique', (e) => crit.push(e.critique.id));
    g.place(0, id('Ⅰ')); g.place(1, id('Ⅱm')); g.place(2, id('Ⅲm'));
    t.eq('講評: 最初のステージでは、出さない（置いて聴くだけ）', [crit, g.analysis.critiques, g.analysis.score.total], [[], [], 0]);
  }

  // ============ タイトルのデモは、図鑑に数えない ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free'); g.demoMode = true;
    const firsts = []; g.on('trick', (e) => firsts.push(e.first));
    g.place(2, id('Ⅴ7')); g.place(3, id('Ⅰ'));
    t.eq('デモ中に技が決まっても、「初めて」にならない・図鑑に入らない', [firsts, g.save.discovered], [[false], []]);
    g.demoMode = false; g.clear(); g.place(2, id('Ⅴ7')); g.place(3, id('Ⅰ'));
    t.eq('デモが終われば、数える', [firsts[firsts.length - 1], g.save.discovered], [true, ['authentic_cadence']]);
  }

  // ============ 実機の盤（まとめて入れる）============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const slots = []; g.on('board', (e) => slots.push([e.slot, e.source]));
    g.setBoard([id('ⅣM7'), id('Ⅴ7'), id('Ⅲm7'), id('Ⅵm7'), null, null, null, null]);
    t.eq('実機から4つ入れる', slots, [[0, 'device'], [1, 'device'], [2, 'device'], [3, 'device']]);
    t.eq('王道進行が決まる', g.analysis.instances.map((i) => i.kind), ['oudou']);
    slots.length = 0; g.setBoard([id('ⅣM7'), id('Ⅴ7'), id('Ⅲm7'), id('Ⅵm7'), null, null, null, null]);
    t.eq('同じ盤なら、何も起きない', slots, []);
  }

  // ============ ヒント ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    let hints = 'none'; g.on('hints', (h) => { hints = h; });
    g.place(0, id('ⅣM7'));
    t.eq('ヒントOFF: 何も出ない', hints, null);
    g.setHints(true);
    t.ok('ヒントON: Ⅴ7 と Ⅲ7 がおすすめ', hints.primary.some((c) => c.name === 'Ⅴ7') && hints.primary.some((c) => c.name === 'Ⅲ7'));
    t.eq('ヒントの位置は、次の空き（2番）', hints.cursor, 1);
    g.setHints(false);
    t.eq('ヒントOFFに戻すと、消える', hints, null);
  }
  {
    const g = mk(); g.loadStage(STAGES[1], 'tutorial'); g.setHints(true);
    let hints = null; g.on('hints', (h) => { hints = h; });
    g.place(0, id('Ⅳ')); g.place(1, id('Ⅴ7'));
    t.ok('チュートリアルのヒントは、そのステージの駒だけ（出ているヒントがある）', hints.primary.length + hints.advanced.length > 0 && [...hints.primary, ...hints.advanced].every((c) => STAGES[1].pieces.includes(c.name)));
  }

  // ============ 「はじめに」は、指定の駒を、指定の場所に置いたときだけクリア（任意の3つでは、クリアにならない）============
  {
    const g = mk(); g.loadStage(STAGES[0], 'tutorial');
    g.place(0, id('Ⅴ')); g.place(1, id('Ⅳ')); g.place(2, id('Ⅰ'));
    t.eq('指定と違う3つ（Ⅴ・Ⅳ・Ⅰ）を置いても、クリアにならない', [g.cleared, g.goalMet()], [false, false]);
    g.place(0, id('Ⅰ')); g.place(1, id('Ⅵm'));
    t.eq('2つだけ直しても、クリアにならない（3番が Ⅰ のまま）', g.cleared, false);
    g.place(2, id('Ⅳ'));
    t.eq('Ⅰ・Ⅵm・Ⅳ を、1・2・3番に置くと、クリア', g.cleared, true);
    const h = mk(); h.loadStage(STAGES[0], 'tutorial');
    h.place(3, id('Ⅰ')); h.place(4, id('Ⅵm')); h.place(5, id('Ⅳ'));
    t.eq('場所が違う（4・5・6番）と、クリアにならない', h.cleared, false);
  }

  // ============ 実機の盤: 最初の読み込みで、クリアにしない / ステージが変わっても、置いてある駒を盤に出す ============
  {
    const g = mk();
    const solution = [id('Ⅰ'), id('Ⅵm'), id('Ⅳ'), null, null, null, null, null];
    g.syncSource = () => solution;
    g.loadStage(STAGES[0], 'tutorial');
    t.eq('実機の盤に、お手本どおりの駒が置いてあるステージを始めても、すぐには、クリアにならない', [g.board.slice(0, 3), g.cleared, g.touched], [solution.slice(0, 3), false, false]);
    g.place(5, id('Ⅴ'));
    t.eq('駒を1つ動かしたら、そのとき、クリアになる（お手本が、そろっているので）', g.cleared, true);
  }
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const live = [id('ⅣM7'), id('Ⅴ7'), id('Ⅲm7'), id('Ⅵm7'), null, null, null, null];
    g.syncSource = () => live;
    g.setBoard(live, { source: 'device' });
    t.eq('実機の盤: 駒が置いてある', g.board.filter((x) => x !== null).length, 4);
    const events = []; g.on('board', (e) => events.push([e.slot, e.source]));
    g.loadStage(FREE_STAGE, 'free');                                 // ステージが変わる（盤が、いったんリセットされる）
    t.eq('ステージが変わっても、実機の盤の駒が、すぐ盤に出る（空のままにならない）', [g.board.filter((x) => x !== null).length, g.analysis.instances.map((i) => i.kind)], [4, ['oudou']]);
    t.eq('その読み込みは「実機の最初の読み込み」として扱う（効果音・試聴を鳴らさない）', events.every(([, src]) => src === 'device-sync') && events.length === 4, true);
    g.syncSource = () => null;                                       // 実機の盤を見ていないとき
    g.loadStage(FREE_STAGE, 'free');
    t.eq('実機の盤を見ていないときは、盤は空から始まる', g.board.every((x) => x === null), true);
  }

  // ============ 丸サ進行のステージは、Ⅳ-Ⅲ-Ⅵ進行（ほかの形）でもクリアできる ============
  {
    const g = mk(); g.loadStage(STAGES[9], 'tutorial');
    g.place(0, id('ⅣM7')); g.place(1, id('Ⅲm7')); g.place(2, id('Ⅵm7'));
    t.eq('丸サ進行のステージ: 技が決まっただけでは、クリアにならない（最後の Ⅰ7 まで置く）', [g.analysis.instances.map((i) => i.kind), g.cleared], [['iv_iii_vi'], false]);
    g.place(3, id('Ⅰ7'));
    t.eq('Ⅳ-Ⅲ-Ⅵ進行（Ⅲm7。丸サ進行ではない形）+ Ⅰ7 でも、クリア', [g.analysis.instances.map((i) => i.kind).includes('iv_iii_vi'), g.cleared], [true, true]);
  }

  // ============ 最後まで置かせるステージ（finish）と、ステージの順番 ============
  {
    t.eq('ステージの順番: ドミナント終止は、Ⅳ-Ⅴ-Ⅵ進行のあと（id は変えない）', STAGES.map((s) => s.id).slice(3, 8), ['t04', 't05', 't06', 't03', 't07']);
    t.eq('ステージの番号（no）は、並び順どおり 0〜13', STAGES.map((s) => s.no), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const byId = (sid) => STAGES.find((s) => s.id === sid);
    // 小室進行: Ⅵm・Ⅳ・Ⅴ だけでは、まだ。Ⅰ に着地してクリア
    { const g = mk(); g.loadStage(byId('t05'), 'tutorial');
      g.place(0, id('Ⅵm')); g.place(1, id('Ⅳ')); g.place(2, id('Ⅴ'));
      t.eq('小室進行: 技（Ⅵm→Ⅳ→Ⅴ）が決まっただけでは、クリアにならない', [g.analysis.instances.map((i) => i.kind).includes('komuro'), g.cleared], [true, false]);
      g.place(3, id('Ⅰ'));
      t.eq('小室進行: Ⅰ に着地してクリア（Ⅴ-Ⅰ終止もつながる）', [g.cleared, g.analysis.instances.map((i) => i.kind)], [true, ['komuro', 'authentic_cadence']]); }
    // Ⅳ-Ⅴ-Ⅵ進行: 最後は Ⅰ
    { const g = mk(); g.loadStage(byId('t06'), 'tutorial');
      g.place(0, id('Ⅳ')); g.place(1, id('Ⅴ')); g.place(2, id('Ⅵm'));
      const before = g.cleared; g.place(3, id('Ⅰ'));
      t.eq('Ⅳ-Ⅴ-Ⅵ進行: 最後の Ⅰ を置いてクリア', [before, g.cleared], [false, true]); }
    // ドミナント終止: Ⅳ・Ⅴ・Ⅵm・Ⅴ と、進行を作る。Ⅰ→Ⅴ だけでは、クリアにならない
    { const g = mk(); g.loadStage(byId('t03'), 'tutorial');
      g.place(0, id('Ⅰ')); g.place(1, id('Ⅴ'));
      t.eq('ドミナント終止: Ⅰ → Ⅴ だけでは、クリアにならない（進行を作らせる）', [g.analysis.instances.map((i) => i.kind).includes('dominant_ending'), g.cleared], [true, false]);
      g.clear(); g.place(0, id('Ⅳ')); g.place(1, id('Ⅴ')); g.place(2, id('Ⅵm'));
      const before = g.cleared; g.place(3, id('Ⅴ'));
      t.eq('ドミナント終止: Ⅳ・Ⅴ・Ⅵm・Ⅴ でクリア（Ⅳ-Ⅴ-Ⅵ進行 + ドミナント終止のコンボ）', [before, g.cleared, g.analysis.instances.map((i) => i.kind)], [false, true, ['iv_v_vi', 'dominant_ending']]); }
    // 丸サ進行: ⅣM7・Ⅲ7・Ⅵm7・Ⅰ7
    { const g = mk(); g.loadStage(byId('t09'), 'tutorial');
      for (const [slot, name] of [[0, 'ⅣM7'], [1, 'Ⅲ7'], [2, 'Ⅵm7']]) g.place(slot, id(name));
      const before = g.cleared; g.place(3, id('Ⅰ7'));
      t.eq('丸サ進行: ⅣM7・Ⅲ7・Ⅵm7 のあと、Ⅰ7 でクリア（Ⅰ7まで = 700点）', [before, g.cleared, g.analysis.instances.map((i) => [i.kind, i.variant])], [false, true, [['maru_sa', 'Ⅰ7まで']]]); }
    // 裏コード: Ⅱm7 → Ⅱ♭7 → ⅠM7
    { const g = mk(); g.loadStage(byId('t10'), 'tutorial');
      g.place(1, id('Ⅱ♭7')); g.place(2, id('ⅠM7'));
      const before = g.cleared; g.place(0, id('Ⅱm7'));
      t.eq('裏コード: Ⅱm7 → Ⅱ♭7 → ⅠM7 でクリア（Ⅱm7 まで置く）', [before, g.cleared], [false, true]); }
    // 半音下: ⅣM7 → Ⅲm7 → Ⅱm7 → ⅠM7
    { const g = mk(); g.loadStage(byId('t08'), 'tutorial');
      g.place(0, id('ⅣM7')); g.place(1, id('Ⅲm7'));
      const before = g.cleared; g.place(2, id('Ⅱm7')); g.place(3, id('ⅠM7'));
      t.eq('半音下への進行: ⅣM7 → Ⅲm7 → Ⅱm7 → ⅠM7（ファ・ミ・レ・ド）でクリア', [before, g.cleared], [false, true]); }
    // 王道進行: ⅣM7・Ⅴ7・Ⅲm7・Ⅵm7 の4つでクリア（Ⅵm7 で終わる形。5番に Ⅰ を足させない）
    { const g = mk(); g.loadStage(byId('t07'), 'tutorial');
      for (const [slot, name] of [[0, 'ⅣM7'], [1, 'Ⅴ7'], [2, 'Ⅲm7']]) g.place(slot, id(name));
      const before = g.cleared; g.place(3, id('Ⅵm7'));
      t.eq('王道進行: ⅣM7・Ⅴ7・Ⅲm7・Ⅵm7 の4つでクリア（Ⅵm7 で終わる）', [before, g.cleared, g.analysis.instances.map((i) => i.kind)], [false, true, ['oudou']]);
      t.eq('王道進行: お手本は4つ・クリアに ⅠM7 は要らない（finish なし）', [byId('t07').solution.length, byId('t07').goal.finish === undefined, byId('t07').solution.some(([, n]) => n === 'ⅠM7')], [4, true, false]); }
    // 終止のチュートリアルは、2つのコードだけでなく、3種類以上のコードの進行の一部として覚える
    for (const sid of ['t01', 't03', 't11', 't12']) {
      const st = byId(sid); const kinds3 = new Set(st.solution.map(([, n]) => n));
      t.ok(`${sid}（${st.title}）: お手本は、3種類以上のコードの進行（${[...kinds3].join('・')}）で、最後まで置いてクリア（finish）`, kinds3.size >= 3 && Array.isArray(st.goal.finish) && st.goal.finish.length === st.solution.length);
    }
    // Ⅴ-Ⅰ終止: ⅣM7 → Ⅴ7 → Ⅰ のうち、Ⅴ7 → Ⅰ の部分だけが終止（2〜4番）。Ⅴ7 → Ⅰ だけでは、クリアにならない
    { const g = mk(); g.loadStage(byId('t01'), 'tutorial');
      g.place(2, id('Ⅴ7')); g.place(3, id('Ⅰ'));
      t.eq('Ⅴ-Ⅰ終止: Ⅴ7 → Ⅰ の2つだけでは、技は決まるが、クリアにならない（ⅣM7 から並べる）', [g.analysis.instances.map((i) => i.kind), g.cleared], [['authentic_cadence'], false]);
      g.place(1, id('ⅣM7'));
      const cad = g.analysis.instances.find((i) => i.kind === 'authentic_cadence');
      t.eq('Ⅴ-Ⅰ終止: ⅣM7 を足すとクリア。終止の囲みは Ⅴ7 → Ⅰ（3〜4番）の部分だけ', [g.cleared, cad.startPos, cad.endPos, cad.chords], [true, 2, 3, ['Ⅴ7', 'Ⅰ']]); }
    // ピカルディ終止: ⅣM7 → Ⅴ7 → Ⅵsus4 → Ⅵ（Ⅵsus4 → Ⅵ の部分が終止。サスつき）
    { const g = mk(); g.loadStage(byId('t11'), 'tutorial');
      for (const [slot, name] of [[0, 'ⅣM7'], [1, 'Ⅴ7'], [2, 'Ⅵsus4']]) g.place(slot, id(name));
      const before = g.cleared; g.place(3, id('Ⅵ'));
      const pic = g.analysis.instances.find((i) => i.kind === 'picardy');
      t.eq('ピカルディ終止: ⅣM7 → Ⅴ7 → Ⅵsus4 → Ⅵ でクリア。終止の囲みは Ⅵsus4 → Ⅵ（3〜4番）。サスつき', [before, g.cleared, pic.startPos, pic.endPos, pic.chords, pic.variant], [false, true, 2, 3, ['Ⅵsus4', 'Ⅵ'], 'サスつき']);
      const h = mk(); h.loadStage(byId('t11'), 'tutorial');
      for (const [slot, name] of [[0, 'ⅣM7'], [1, 'Ⅴ7'], [2, 'Ⅵm7'], [3, 'Ⅰ']]) h.place(slot, id(name));
      t.eq('ピカルディ終止: Ⅵm7 → Ⅰ（長調の主和音）では、決まらない', [h.analysis.instances.some((i) => i.kind === 'picardy'), h.cleared], [false, false]); }
    // 偽終止: Ⅰ → Ⅱm7 → Ⅴ7 → Ⅵm7（Ⅴ7 → Ⅵm7 の部分が終止）
    { const g = mk(); g.loadStage(byId('t12'), 'tutorial');
      for (const [slot, name] of [[0, 'Ⅰ'], [1, 'Ⅱm7'], [2, 'Ⅴ7']]) g.place(slot, id(name));
      const before = g.cleared; g.place(3, id('Ⅵm7'));
      const dc = g.analysis.instances.find((i) => i.kind === 'deceptive_cadence');
      t.eq('偽終止: Ⅰ → Ⅱm7 → Ⅴ7 → Ⅵm7 でクリア。終止の囲みは Ⅴ7 → Ⅵm7（3〜4番）', [before, g.cleared, dc.startPos, dc.endPos, dc.chords], [false, true, 2, 3, ['Ⅴ7', 'Ⅵm7']]); }
    // 全ステージ: 「お手本どおり」で、必ず最後まで（goal.finish / solution）クリアできる。お手本の1つ手前では、クリアしない
    for (const st of STAGES) {
      const g = mk(); g.loadStage(st, 'tutorial');
      const sol = st.solution; let early = false;
      sol.forEach(([slot, name], i) => { g.place(slot, id(name)); if (i < sol.length - 1 && g.cleared && st.goal.finish) early = true; });
      t.ok(`${st.id}（${st.title}）: お手本どおりでクリア。finish があるステージは、最後の駒を置くまで、クリアにならない`, g.cleared && !early);
    }
  }

  // ============ チャレンジ ============
  {
    const g = mk(); g.loadStage(CHALLENGE_STAGE, 'challenge');
    const ev = []; g.on('timer', (e) => ev.push(e.left)); let end = null; g.on('challengeEnd', (e) => { end = e; });
    g.startTimer();
    g.place(0, id('Ⅵm')); g.place(1, id('Ⅳ')); g.place(2, id('Ⅴ'));       // 240点
    t.eq('チャレンジ: 最初の残り', g.timeLeft, 90);
    for (let i = 0; i < 905; i++) g.tick(0.1);
    t.eq('チャレンジ: 90秒で終わる', [end !== null, g.timerRunning], [true, false]);
    t.eq('チャレンジ: 得点は、いちばん高かった盤（小室進行 = 240）', end.score, 240);
    t.eq('チャレンジ: 星（300・600・1100 に届いていない → 0）', end.stars, 0);
    t.eq('チャレンジ: タイマーの通知は、1秒ごと', [ev[0], ev[ev.length - 1], ev.length], [89, 0, 90]);
    t.eq('ベストが保存される', g.save.best.challenge, 240);
  }

  // ============ メロディのステージ（コード進行の点 + メロディとの相性の点）============
  {
    const st = MELODY_STAGES[0];
    const g = mk(); g.loadStage(st, 'melody');
    t.eq('メロディのステージ: g.melody が入る・使える駒は、ステージの駒だけ・盤は空', [!!g.melody, g.allowed.length, g.board.every((x) => x === null)], [true, 8, true]);
    t.eq('メロディのステージ: 空の盤は、点 0・相性 0%・メロディの点 0', [g.analysis.score.total, g.analysis.score.melodyMatch, g.analysis.score.melody, g.analysis.melody.steps.every((x) => x.verdict === 'missing')], [0, 0, 0, true]);
    t.eq('メロディのステージ: メロディ以外の駒（Ⅱ♭7）は、置けない', g.place(0, id('Ⅱ♭7')), false);
    const crit = []; g.on('critique', (e) => crit.push([e.critique.group, e.critique.id.split('|')[0] + '|' + e.critique.id.split('|')[1], e.critique.points]));
    for (const [i, n] of ['Ⅰ', 'Ⅵm', 'Ⅰ'].entries()) g.place(i, id(n));
    t.eq('メロディのステージ: 3番に Ⅰ（ファが強い拍）→ 「メロディとぶつかる」の講評（group = melody）が、1回だけ出る', crit.filter((c) => c[0] === 'melody'), [['melody', 'melody|bad', 0]]);
    t.eq('メロディのステージ: 講評は、ジャッジの講評と一緒に、critiques に入る。点は、メロディの合計の中（講評の点は 0）', [g.analysis.critiques.some((c) => c.group === 'melody'), g.analysis.critiques.filter((c) => c.group === 'melody').every((c) => c.points === 0)], [true, true]);
    t.eq('メロディのステージ: 合計 = コード進行の点（raw）+ メロディの点（0 で切る）', g.analysis.score.total, Math.max(0, g.analysis.score.raw + g.analysis.score.melody));
    g.place(2, id('Ⅳ'));
    t.eq('メロディのステージ: 3番を Ⅳ に替えると、講評が消える', g.analysis.critiques.some((c) => c.group === 'melody'), false);
    // お手本どおり → 星3・記録
    let end = null; g.on('melodyEnd', (e) => { end = e; });
    st.answer.forEach((n, i) => g.place(i, id(n)));
    const par = melodyPar(st, table);
    t.eq('お手本どおり: 得点 = お手本の得点（par）・相性 100%', [g.analysis.score.total, g.analysis.score.melodyMatch], [par.total, 1]);
    const r = g.finishMelody();
    t.eq('採点する: melodyEnd のイベント（得点・星3・ベスト更新）と、記録の保存', [end !== null, r.score, r.stars, r.isBest, g.save.melody.m01.stars, g.save.melody.m01.best, Math.round(g.save.melody.m01.match * 100)], [true, par.total, 3, true, 3, par.total, 100]);
    t.eq('星の条件の一覧（3つ。ぜんぶ ✓）', [r.conds.length, r.conds.every((c) => c.ok)], [3, true]);
    // 悪い盤に替えて採点しなおしても、ベストは下がらない・星は上書きで下がらない
    g.clear(); for (let i = 0; i < 8; i++) g.place(i, id('Ⅲm'));
    const r2 = g.finishMelody();
    t.eq('採点しなおし（ぜんぶ Ⅲm。相性 27%）: ベストは下がらない・今回の星は 0', [g.save.melody.m01.best, g.save.melody.m01.stars, r2.stars, r2.isBest], [par.total, 3, 0, false]);
    // 星の条件
    const mk8 = (names) => { const x = mk(); x.loadStage(st, 'melody'); names.forEach((n, i) => x.place(i, id(n))); return x; };
    const starsOf = (names) => melodyStars(mk8(names).analysis, par).stars;
    t.eq('星: ぜんぶ Ⅰ（相性 63%）= 1 / お手本 = 3 / ぜんぶ Ⅲm（相性 27%）= 0', [starsOf(Array(8).fill('Ⅰ')), starsOf(st.answer), starsOf(Array(8).fill('Ⅲm'))], [1, 3, 0]);
    { const x = mk8(['Ⅰ', 'Ⅱm', 'Ⅳ', 'Ⅴ', 'Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅰ']); const rs = melodyStars(x.analysis, par);
      const half = Math.round(par.progression * 0.5);
      t.eq(`星の条件: 相性が 90% 以上で、コード進行の点が、お手本の 5割（${half}）以上 → 星3。5割に届かないと、星2（2番を Ⅱm にした例）`, [x.analysis.score.melodyMatch >= 0.9, x.analysis.score.raw >= half, rs.stars, rs.conds.map((c) => c.ok)], [true, x.analysis.score.raw >= half, x.analysis.score.raw >= half ? 3 : 2, [true, true, x.analysis.score.raw >= half]]); }
    t.eq('メロディのステージでなければ、採点する（finishMelody）は、何もしない', (() => { const x = mk(); x.loadStage(FREE_STAGE, 'free'); return [x.finishMelody(), x.melody, x.analysis.melody === undefined]; })(), [null, null, true]);
    t.eq('フリープレイには、メロディの点が混ざらない（同じ盤で、点は、これまでどおり）', (() => { const x = mk(); x.loadStage(FREE_STAGE, 'free'); st.answer.forEach((n, i) => x.place(i, id(n))); return x.analysis.score.total === x.analysis.score.raw && x.analysis.score.melody === undefined; })(), true);
    // 全5つ: お手本どおり → 星3
    for (const m of MELODY_STAGES) { const x = mk(); x.loadStage(m, 'melody'); m.answer.forEach((n, i) => x.place(i, id(n))); const rr = x.finishMelody(); t.ok(`${m.id}: お手本どおり → 星3・相性 100%`, rr.stars === 3 && x.analysis.score.melodyMatch >= 0.95); }
  }

  // ============ プリセット: まとめて置く・実機の盤の案内 ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const events = []; g.on('board', (e) => events.push([e.slot, e.id === null ? null : e.id, e.source]));
    let analyses = 0; g.on('analysis', () => { analyses++; });
    const tricks = []; g.on('trick', (e) => tricks.push(e.instance.kind));
    const r = g.placeMany([{ slot: 1, id: id('Ⅱm7') }, { slot: 2, id: id('Ⅴ7') }, { slot: 3, id: id('ⅠM7') }]);
    t.eq('まとめて置く: 3つ。判定は、まとめて1回（技の演出は、最後の盤の分だけ）', [r.changed, r.blocked, analyses, tricks], [3, [], 1, ['dominant_motion']]);        // ツーファイブワン（Ⅱm7→Ⅴ7→ⅠM7）が、1つの技として決まる
    t.eq('まとめて置く: 盤の変化の通知は、駒ごとに（出どころは preset）', events, [[1, id('Ⅱm7'), 'preset'], [2, id('Ⅴ7'), 'preset'], [3, id('ⅠM7'), 'preset']]);
    t.eq('まとめて置く: 空き（null）を指定すると、その場所が空になる', (() => { const x = g.placeMany([{ slot: 2, id: null }]); return [x.changed, g.board[2]]; })(), [1, null]);
    t.eq('まとめて置く: 同じ内容なら、何も起きない（変化 0）', g.placeMany([{ slot: 1, id: id('Ⅱm7') }]).changed, 0);
    const tut = mk(); tut.loadStage(STAGES[1], 'tutorial');                                   // Ⅴ-Ⅰ終止: 使える駒が限られる
    const rt = tut.placeMany([{ slot: 0, id: id('Ⅰ') }, { slot: 1, id: id('Ⅱ♭7') }]);
    t.eq('まとめて置く: 使えない駒（Ⅱ♭7）は、置かない（blocked に、その場所）', [rt.changed, rt.blocked, tut.board[1]], [1, [1], null]);
    t.eq('まとめて置く: force なら、使えない駒も置ける（実機の盤など）', tut.placeMany([{ slot: 1, id: id('Ⅱ♭7') }], { force: true }).changed, 1);
  }
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const guides = []; g.on('guide', (x) => guides.push(x)); const done = []; g.on('presetDone', (x) => done.push(x.name));
    g.setPresetGuide([{ slot: 1, id: id('Ⅱm7'), name: 'Ⅱm7' }, { slot: 2, id: id('Ⅴ7'), name: 'Ⅴ7' }, { slot: 3, id: null, name: null }], '二五');
    const first = guides[guides.length - 1];
    t.eq('プリセットの案内: 最初は、2番に Ⅱm7（空きの指定は、案内に出さない）・ラベル', [first.active, first.steps.map((x) => x.text), first.next.slot, first.label], [true, ['2番に「Ⅱm7」を置こう', '3番に「Ⅴ7」を置こう'], 1, 'プリセット「二五」']);
    g.setBoard([null, id('Ⅱm7'), null, null, null, null, null, null], { source: 'device' });
    t.eq('プリセットの案内: 1つ置かれたら、次は 3番の Ⅴ7', [guides[guides.length - 1].next.slot, guides[guides.length - 1].steps[0].done], [2, true]);
    g.setBoard([null, id('Ⅱm7'), id('Ⅳ'), null, null, null, null, null], { source: 'device' });
    t.eq('プリセットの案内: 違う駒（Ⅳ）が置かれたら、「替えよう」', guides[guides.length - 1].next.text, '3番を「Ⅴ7」に替えよう');
    g.setBoard([null, id('Ⅱm7'), id('Ⅴ7'), null, null, null, null, null], { source: 'device' });
    t.eq('プリセットの案内: ぜんぶ置かれたら、案内は終わる（presetDone）', [done, g.presetGuide, guides[guides.length - 1].active], [['二五'], null, false]);
    g.setPresetGuide([{ slot: 5, id: id('Ⅰ'), name: 'Ⅰ' }], 'もう一つ'); g.setPresetGuide(null);
    t.eq('プリセットの案内: null で、やめられる', [g.presetGuide, guides[guides.length - 1].active], [null, false]);
    g.setPresetGuide([{ slot: 5, id: id('Ⅰ'), name: 'Ⅰ' }], 'もう一つ'); g.loadStage(FREE_STAGE, 'free');
    t.eq('ステージが変わると、案内は、なくなる', g.presetGuide, null);
    t.eq('空きだけの案内は、始まらない', (() => { g.setPresetGuide([{ slot: 0, id: null, name: null }], 'x'); return g.presetGuide; })(), null);
  }

  // ============ 解放 ============
  {
    const g = mk(); g.loadStage(STAGES[0], 'tutorial');
    t.eq('最初のステージは、はじめから使える', g.isUnlocked(STAGES, 0), true);
    t.eq('2つめは、鍵がかかっている', g.isUnlocked(STAGES, 1), false);
    for (const [slot, name] of STAGES[0].solution) g.place(slot, id(name));
    t.eq('クリアすると、次が開く', g.isUnlocked(STAGES, 1), true);
    g.save.unlockAll = true;
    t.eq('「ぜんぶ開く」', g.isUnlocked(STAGES, 7), true);
  }
  // ============ チャレンジステージ（2026-11-23。内部の名前は 'trial'）============
  {
    t.eq('チャレンジステージ: 9ステージ・id は重複しない・番号は 1〜9', [TRIAL_STAGES.length, new Set(TRIAL_STAGES.map((s) => s.id)).size, TRIAL_STAGES.map((s) => s.no)], [9, 9, [1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    const RULE_TYPES = ['kind', 'group', 'kinds', 'combo', 'sense', 'only', 'use', 'level', 'max', 'min', 'fill', 'noDup', 'maxSame', 'ban', 'at', 'noOddity'];
    t.ok('チャレンジステージ: 条件の種類は、すべて、知っているもの・技の名前・使う駒は、表にある', TRIAL_STAGES.every((s) => s.rules.length > 0 && s.rules.every((r) => RULE_TYPES.includes(r.type) && (!r.kind || TRICKS[r.kind]) && (!r.names || r.names.every((n) => !!table.byName(n)))) && (!s.pieces || s.pieces.every((n) => !!table.byName(n)))));
    t.ok('チャレンジステージ: ノルマは、だんだん高くなる（1つ前の半分より上）・星のしきい値は、ノルマ ≦ 星2 ≦ 星3', TRIAL_STAGES.every((s, i) => s.stars[0] === s.norm && s.stars[1] > s.norm && s.stars[2] > s.stars[1] && (i === 0 || s.norm > TRIAL_STAGES[i - 1].norm / 2)));
    // 各ステージに、条件を全部守って、ノルマに届く盤がある（お手本）。星も付く
    const SOL = {
      c01: 'Ⅲm Ⅵm Ⅱm Ⅴ7 ⅠM7 - - -', c02: 'Ⅵm Ⅳ Ⅴ Ⅰ - - - -', c03: 'ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 Ⅱm7 Ⅰ7 - -', c04: 'Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7 -', c05: 'Ⅵm Ⅳ Ⅴ Ⅵm Ⅳ Ⅰ - -',
      c06: 'ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 ⅣM7 Ⅴ7 Ⅰ Ⅵm7', c07: 'Ⅱm7 Ⅱ♭7 ⅠM7 Ⅵm7 Ⅱm7 Ⅲ7 Ⅵm7 Ⅰ', c08: 'ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 ⅣM7 Ⅴ7 Ⅰ Ⅵm7', c09: 'Ⅵm7 ⅣM7 Ⅴ7 Ⅵ♭M7 Ⅰ7 Ⅳm6 Ⅴsus47 Ⅵ',
    };
    const bd = (spec) => spec.split(' ').map((n) => (n === '-' ? null : id(n)));
    for (const st of TRIAL_STAGES) {
      const b = bd(SOL[st.id]), an = analyze(b, table, { slotsPerBar: 2 }), ev = evaluateTrial(st, b, an, table);
      t.ok(`${st.id}（${st.title}）: お手本の盤は、条件が全部そろい、ノルマ ${st.norm} 点に届く（${an.score.total} 点・条件 ${ev.okCount}/${ev.rules.length}）`, ev.ready && ev.allOk && an.score.total >= st.norm);
      t.ok(`${st.id}: 空の盤は、「提出」できない（条件が足りない・ノルマ未達成）`, !evaluateTrial(st, Array(8).fill(null), analyze(Array(8).fill(null), table), table).ready);
      t.ok(`${st.id}: 使える駒だけを使う（トレイを制限しているステージ）。使えない駒を置くと、条件を満たせない`, !st.pieces || (() => { const bad = bd(SOL[st.id]).map((x) => x); const outside = table.pieces().find((c) => !st.pieces.includes(c.name)); const b2 = b.slice(); b2[7] = outside.id; return evaluateTrial(st, b2, analyze(b2, table), table).rules.some((r) => !r.ok && /使える駒/.test(r.text)); })());
    }
    t.eq('星: ノルマ以上 = 1・1.4倍 = 2・1.8倍 = 3（c01: 350・490・630）', [trialStars(TRIAL_STAGES[0], 349), trialStars(TRIAL_STAGES[0], 350), trialStars(TRIAL_STAGES[0], 490), trialStars(TRIAL_STAGES[0], 630)], [0, 1, 2, 3]);
    t.eq('nextTrialAfter: c01 の次は c02・最後の次はなし', [nextTrialAfter(TRIAL_STAGES[0]).id, nextTrialAfter(TRIAL_STAGES[8])], ['c02', null]);

    // ゲームの流れ: 読み込む → 置く → 条件の知らせ → 提出 → 記録
    const g = mk(); const events = []; g.on('trial', (e) => events.push(e.state)); let ended = null; g.on('trialEnd', (e) => { ended = e; });
    g.loadStage(TRIAL_STAGES[0], 'trial');
    t.eq('チャレンジステージ: 読み込むと、条件の様子が届く（条件 1/2・ノルマ 350・提出できない）', [events.length, events[0].okCount, events[0].rules.length, events[0].norm, events[0].ready], [1, 1, 2, 350, false]);
    t.eq('チャレンジステージ: 使える駒は、このステージの駒だけ（10個）', [g.allowed.length, g.canPlace(id('Ⅲ7')), g.canPlace(id('Ⅰ'))], [10, false, true]);
    t.eq('チャレンジステージ: 提出しようとしても、条件がそろっていない間は、ことわる', (() => { const r = g.finishTrial(); return [r.ok, ended]; })(), [false, null]);
    for (const [i, n] of ['Ⅲm', 'Ⅵm', 'Ⅱm', 'Ⅴ7', 'ⅠM7'].entries()) g.place(i, id(n));
    t.eq('チャレンジステージ: 置くと、条件・得点が変わる（提出できる）', [events[events.length - 1].ready, events[events.length - 1].score >= 350], [true, true]);
    const r = g.finishTrial();
    t.eq('チャレンジステージ: 提出 → クリア（星・得点・記録）', [r.ok, ended.stage.id, ended.stars, ended.score >= 350, g.save.trial.c01.stars, g.save.trial.c01.best === ended.score, g.cleared], [true, 'c01', 1, true, 1, true, true]);
    t.eq('チャレンジステージ: クリアすると、次が開く（c02）・ほかは鍵のまま', [g.isTrialUnlocked(TRIAL_STAGES, 0), g.isTrialUnlocked(TRIAL_STAGES, 1), g.isTrialUnlocked(TRIAL_STAGES, 2)], [true, true, false]);
    const n = events.length; g.place(7, id('Ⅳ'));
    t.ok('チャレンジステージ: 盤が変わると、条件の様子が、また届く（変わらないときは、届かない）', events.length > n && (() => { const m = events.length; g.place(7, id('Ⅳ')); return events.length === m; })());
    g.loadStage(FREE_STAGE, 'free');
    t.eq('チャレンジステージ以外では、条件の知らせは、出ない', (() => { const m = events.length; g.place(0, id('Ⅰ')); return events.length === m; })(), true);
  }

  // ============ 分割したマス（2026-11-23）: 1つのマスに、前半・後半の2つのコード ============
  {
    const g = mk(); g.loadStage(FREE_STAGE, 'free');
    const names = () => [g.board.map((x) => (x === null ? '-' : table.byId(x).name)).join(' '), g.split.map((x) => (x === null ? '-' : table.byId(x).name)).join(' ')];
    const evs = []; g.on('board', (e) => evs.push(['board', e.slot, e.id, !!e.slid])); g.on('split', (e) => evs.push(['split', e.slot, e.id, !!e.slid, e.firstChanged]));
    g.place(0, id('Ⅱm7')); g.place(1, id('Ⅴ7'));
    t.eq('分割: フリープレイ・タイムアタック・チャレンジステージだけ。チュートリアル・メロディー・タイトルのデモは、分けない', ['free', 'challenge', 'trial', 'tutorial', 'melody'].map((m) => { const x = mk(); x.loadStage(m === 'challenge' ? CHALLENGE_STAGE : m === 'trial' ? TRIAL_STAGES[0] : m === 'tutorial' ? STAGES[1] : m === 'melody' ? MELODY_STAGES[0] : FREE_STAGE, m); return x.splitAllowed(); }), [true, true, true, false, false]);
    t.eq('分割: 駒のあるマスの右に重ねる → [旧 | 新]（前半は、もとの駒）', (() => { g.placeAt(1, 'R', id('Ⅲm7')); return names(); })(), ['Ⅱm7 Ⅴ7 - - - - - -', '- Ⅲm7 - - - - - -']);
    t.eq('分割: 左に重ねる → [新 | 旧]（もとの駒は、後半へ。落ちる動きを付けない印 slid）', (() => { evs.length = 0; g.placeAt(0, 'L', id('Ⅰ')); return [names(), evs.map((e) => e.join(':'))]; })(), [['Ⅰ Ⅴ7 - - - - - -', 'Ⅱm7 Ⅲm7 - - - - - -'], [`board:0:${id('Ⅰ')}:false`, `split:0:${id('Ⅱm7')}:true:true`]]);
    t.eq('分割: 分けたマスの、左・右に重ねると、その半分だけが置きかわる', (() => { g.placeAt(0, 'R', id('Ⅳ')); g.placeAt(1, 'L', id('Ⅵm7')); return names(); })(), ['Ⅰ Ⅵm7 - - - - - -', 'Ⅳ Ⅲm7 - - - - - -']);
    t.eq('分割: 同じ駒が前半・後半になるなら、分けない（1つに戻る）', (() => { g.placeAt(0, 'R', id('Ⅰ')); return names()[1].split(' ')[0]; })(), '-');
    t.eq('分割: まん中（C）に置くと、これまでどおり置きかえ（分割は、なくなる）', (() => { g.placeAt(1, 'R', id('Ⅴ7')); g.placeAt(1, 'C', id('ⅠM7')); return names(); })(), ['Ⅰ ⅠM7 - - - - - -', '- - - - - - - -']);
    t.eq('分割: 空きのマスは、左・右に置いても、分けない（そのマスに置く）', (() => { g.placeAt(4, 'R', id('Ⅱm')); return names(); })(), ['Ⅰ ⅠM7 - - Ⅱm - - -', '- - - - - - - -']);
    t.eq('分割: 「→」のマスの上には、重ねられない（置きかえになる）・「→」を、駒のあるマスの左右に置いても、分けられない（置きかえになる）', (() => { const x = mk(); x.loadStage(FREE_STAGE, 'free'); x.place(5, table.repeatId); x.placeAt(5, 'R', id('Ⅴ7')); x.place(2, id('Ⅰ')); x.placeAt(2, 'R', table.repeatId); return [x.board[5], x.split[5], x.board[2], x.split[2]]; })(), [id('Ⅴ7'), null, table.repeatId, null]);
    t.eq('分割: 半分だけ外す（前半を外すと、後半が広がる）・後半を外すと、前半が残る', (() => { g.placeAt(1, 'R', id('Ⅲm7')); const a = g.remove(1, { half: 0 }); const o1 = names(); g.placeAt(1, 'R', id('Ⅵm7')); const b = g.remove(1, { half: 1 }); return [a, o1, b, names()]; })(), [id('ⅠM7'), ['Ⅰ Ⅲm7 - - Ⅱm - - -', '- - - - - - - -'], id('Ⅵm7'), ['Ⅰ Ⅲm7 - - Ⅱm - - -', '- - - - - - - -']]);
    t.eq('分割: half を指定しないで外すと、マスぜんたい（前半・後半とも）が空きになる', (() => { g.placeAt(1, 'R', id('Ⅳ')); g.remove(1); return [g.board[1], g.split[1]]; })(), [null, null]);
    // 盤の上の駒を、動かす
    g.clear(); g.place(0, id('Ⅰ')); g.place(1, id('Ⅳ')); g.placeAt(1, 'R', id('Ⅴ7'));
    t.eq('移動: 分けたマスの、後半を、空きに動かす（1つの駒として置く・もとのマスは、前半が広がる）', (() => { g.moveFromBoard(1, 1, 5, 'C'); return names(); })(), ['Ⅰ Ⅳ - - - Ⅴ7 - -', '- - - - - - - -']);
    t.eq('移動: 駒を、駒のあるマスの右に落とす → そのマスを分ける。もとのマスは、空き', (() => { g.moveFromBoard(5, null, 0, 'R'); return names(); })(), ['Ⅰ Ⅳ - - - - - -', 'Ⅴ7 - - - - - - -']);
    t.eq('移動: 分けていないマスどうしの、まん中への移動は、入れ替え（これまでどおり）', (() => { g.clear(); g.place(0, id('Ⅰ')); g.place(1, id('Ⅳ')); g.moveFromBoard(0, null, 1, 'C'); return names()[0]; })(), 'Ⅳ Ⅰ - - - - - -');
    t.eq('移動: 同じマスの、反対側に落とすと、前半・後半が入れかわる', (() => { g.clear(); g.place(0, id('Ⅰ')); g.placeAt(0, 'R', id('Ⅴ7')); g.moveFromBoard(0, 0, 0, 'R'); return names(); })(), ['Ⅴ7 - - - - - - -', 'Ⅰ - - - - - - -']);
    t.eq('移動: 同じマスのまん中に落とす・分けられないとき（チュートリアル）は、そのまま置きかえ', (() => { const x = mk(); x.loadStage(STAGES[1], 'tutorial'); x.place(1, id('ⅣM7')); x.place(2, id('Ⅴ7')); x.moveFromBoard(1, null, 2, 'R'); return [x.board[1], x.board[2], x.split[2]]; })(), [id('Ⅴ7'), id('ⅣM7'), null]);
    t.eq('一括: プリセットなど（placeMany）は、後半の駒（second）も置く。分けられないモードでは、前半だけ', (() => { g.clear(); g.placeMany([{ slot: 0, id: id('Ⅱm7'), second: id('Ⅴ7') }, { slot: 1, id: id('ⅠM7') }]); const a = names(); const x = mk(); x.loadStage(STAGES[1], 'tutorial'); x.placeMany([{ slot: 0, id: id('Ⅱm7'), second: id('Ⅴ7') }], { force: true }); return [a, x.split[0]]; })(), [['Ⅱm7 ⅠM7 - - - - - -', 'Ⅴ7 - - - - - - -'], null]);
    t.eq('ステージを読み込むと、分割は、なくなる・全部消す でも', (() => { g.placeAt(0, 'R', id('Ⅲm7')); g.clear(); const a = g.split.every((x) => x === null); g.place(0, id('Ⅰ')); g.placeAt(0, 'R', id('Ⅳ')); g.loadStage(FREE_STAGE, 'free'); return [a, g.split.every((x) => x === null)]; })(), [true, true]);
    t.eq('実機の盤（setBoard）が来ると、変わったマスの分割は、なくなる・変わらないマスは、そのまま', (() => { g.loadStage(FREE_STAGE, 'free'); g.place(0, id('Ⅰ')); g.placeAt(0, 'R', id('Ⅳ')); g.place(1, id('Ⅴ')); g.placeAt(1, 'R', id('Ⅵm')); g.setBoard([id('Ⅰ'), id('Ⅱm'), null, null, null, null, null, null], { source: 'device' }); return names(); })(), ['Ⅰ Ⅱm - - - - - -', 'Ⅳ - - - - - - -']);

    // ---- 判定（技・ジャッジ・ヒント）----
    const A = (spec, split) => analyze(spec.split(' ').map((n) => (n === '-' ? null : id(n))), table, { split: split ? split.split(' ').map((n) => (n === '-' ? null : id(n))) : null });
    const K = (r) => r.instances.map((i) => i.kind + '@' + i.positions.join(','));
    t.eq('判定: 1つのマスの中の、前半 → 後半 も、つながり（Ⅱm7 | Ⅴ7 → ドミナントモーション）', K(A('Ⅱm7 - - - - - - -', 'Ⅴ7 - - - - - - -')), ['dominant_motion@0,0']);
    t.eq('判定: 分けたマスの、後半 → 次のマス（Ⅱm7 | Ⅴ7 → ⅠM7 = ツーファイブワン）', A('Ⅱm7 ⅠM7 - - - - - -', 'Ⅴ7 - - - - - - -').instances.map((i) => i.variant), ['ツーファイブワン']);
    t.eq('判定: 名前のついた進行は、マスの頭（前半）から。後半からは、始まらない（王道: ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 を 1番から）', [A('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 - - - -').instances.some((i) => i.kind === 'oudou'), A('Ⅰ ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 - - -').instances.some((i) => i.kind === 'oudou'), A('Ⅰ Ⅴ7 Ⅲm7 Ⅵm7 - - - -', 'ⅣM7 - - - - - - -').instances.some((i) => i.kind === 'oudou')], [true, false, false]);
    t.eq('判定: 終止は、マスの終わり（後半）で決まる。4番が分割していて、前半 Ⅴ7・後半 Ⅰ なら、Ⅴ-Ⅰ終止（フレーズの終わり）', K(A('Ⅳ Ⅱm Ⅳ Ⅴ7 - - - -', '- - - Ⅰ - - - -')).filter((k) => k.startsWith('authentic')), ['authentic_cadence@3,3']);
    t.eq('判定: 4番の前半 Ⅴ7 → 後半 Ⅵm7 は、前半がマスの終わりではないので、終止として数えない（後半の Ⅵm7 が、4番の終わり。Ⅴ7 → Ⅵm7 = 偽終止）', K(A('Ⅳ Ⅱm Ⅳ Ⅴ7 - - - -', '- - - Ⅵm7 - - - -')).filter((k) => k.startsWith('deceptive')), ['deceptive_cadence@3,3']);
    t.eq('判定: 4番の前半が、終止の最後（Ⅴ7 → Ⅰ の Ⅰ）で、後半が続くとき、前半では、終止にならない', K(A('Ⅳ Ⅱm Ⅴ7 Ⅰ - - - -', '- - - Ⅳ - - - -')).filter((k) => k.startsWith('authentic')), []);
    t.eq('判定: 冒頭（1番）の後半は、冒頭ではない（1番 Ⅱm7 | Ⅴ7 は、「？」にならない）', A('Ⅱm7 - - - - - - -', 'Ⅴ7 - - - - - - -').oddities.length, 0);
    t.eq('判定: 分割がない盤は、これまでどおり（split を渡さなくても、渡しても、同じ）', JSON.stringify(A('Ⅱm7 Ⅴ7 ⅠM7 - - - - -').score) === JSON.stringify(A('Ⅱm7 Ⅴ7 ⅠM7 - - - - -', '- - - - - - - -').score), true);
    t.eq('「→」は、分割したマスの、後半のコードをのばす（Ⅱm7 | Ⅴ7 → のばす: 後半の Ⅴ7 が続く）', (() => { const r = A('Ⅱm7 → ⅠM7 - - - - -', 'Ⅴ7 - - - - - - -'); return r.segments[0].map((e) => `${e.chord.name}:${e.first}-${e.last}:${e.half}`); })(), ['Ⅱm7:0-0:0', 'Ⅴ7:0-1:1', 'ⅠM7:2-2:null']);
    // ヒント: 分割したマスの、後半を、「前の駒」として使う
    t.eq('ヒント: 分けたマスの後半（Ⅴ7）のあとには、Ⅰ 系が、「Ⅴ7 → Ⅰ」としておすすめになる（前半の Ⅱm7 ではなく）。文脈は Ⅱm7 > Ⅴ7', (() => { const sg = suggest([id('Ⅱm7'), null, null, null, null, null, null, null], table, table.pieces().map((c) => c.id), { split: [id('Ⅴ7'), null, null, null, null, null, null, null] }); return [sg.cursor, sg.context.join('>'), [...sg.primary, ...sg.advanced].some((c) => /^Ⅰ/.test(c.name) && /^Ⅴ7 → Ⅰ/.test(c.reason))]; })(), [1, 'Ⅱm7>Ⅴ7', true]);
  }

}
