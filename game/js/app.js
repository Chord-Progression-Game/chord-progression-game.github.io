// ゲーム全体の組み立て。部品をつなぐだけで、ルールは game/game.js、判定は core/tricks.js にある。
//   流れ: 起動（クリックで音が使える）→ タイトル（背景で、デモが自動で進行を組み立てて鳴らす）
//         → チュートリアル / チュートリアルを選ぶ / メロディーにコードをつける / チャレンジステージ / フリープレイ / タイムアタック（内部の名前は 'challenge'）→ 結果
import { ChordTable } from './core/chords.js';
import { voiceChord, BASE_C_DEFAULT } from './core/voicing.js';
import { SceneManager } from './render/scene.js';
import { AudioEngine, masterGainFor } from './audio/engine.js';
import { Sfx } from './audio/sfx.js';
import { Game } from './game/game.js';
import { STAGES, FREE_STAGE, CHALLENGE_STAGE } from './game/stages.js';
import { TRIAL_STAGES, nextTrialAfter } from './game/trials.js';
import { loadSave, writeSave, resetSave, DEFAULT_MIX } from './game/save.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { Input } from './ui/input.js';
import { DeviceLink, bridgeAvailable } from './net/device.js';
import { CloudLibrary, loadCloudConfig } from './net/cloud.js';
import { LibraryLink, mergeUserPatterns, libraryChanges, isUserPatternId } from './net/library.js';
import { decodeShare, sanitizeShared, sanitizeLocal, mergeIntoLibrary, removeFromLibrary } from './net/share.js';
import { LibImport } from './ui/libimport.js';
import { SoundMenu } from './ui/soundmenu.js';
import { HowTo } from './ui/howto.js';
import { VolumeMenu } from './ui/volumemenu.js';
import { SeekBar } from './ui/seekbar.js';
import { MelodyView } from './ui/melodyview.js';
import { PresetMenu } from './ui/presetmenu.js';
import { PresetStore, placementPlan, applyMelodyPlan } from './game/presets.js';
import { MelodyDoc } from './game/usermelody.js';
import { MelodyStudio } from './ui/melodystudio.js';
import { TrickDetail } from './ui/trickdetail.js';
import { ChordStore } from './game/chordstore.js';
import { ChordLab } from './ui/chordlab.js';
import { ChordMenu } from './ui/chordmenu.js';
import { watchLayout, isPhone, isPortraitPhone } from './ui/layout.js';
import { MELODY_STAGES } from './game/melodies.js';
import { VERDICT } from './core/melody.js';
import { INSTRUMENTS, instrumentName } from './audio/instruments.js';
import { setCustomProgressions } from './core/tricks.js';
import { $, $$, h } from './ui/dom.js';

// 固有進行は 1番から始める。Ⅴ・Ⅲ7・Ⅰ7 などを 1番（冒頭）に置くと「？」になるので、デモでは避ける
const DEMO_SEQUENCES = [
  { chords: ['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'], instrument: 'piano' },                       // 王道進行
  { chords: ['Ⅵm', 'Ⅳ', 'Ⅴ', 'Ⅰ'], instrument: 'drive' },                              // 小室進行 + Ⅴ-Ⅰ終止 のコンボ
  { chords: ['Ⅱm7', 'Ⅴ7', 'ⅠM7', 'Ⅵm7'], instrument: 'epiano' },                        // ツーファイブワン
  { chords: ['ⅣM7', 'Ⅲ7', 'Ⅵm7', 'Ⅴm7', 'Ⅰ7'], instrument: 'strings' },                // 丸サ進行（完全な形）
  { chords: ['Ⅵm', 'Ⅴ', 'Ⅳ', 'Ⅲ7'], instrument: 'guitar' },                            // アンダルシア進行
];

async function main() {
  const [chordsJson, presets] = await Promise.all([fetch('./data/chords.json').then((r) => r.json()), fetch('./data/presets.json').then((r) => r.json())]);
  const table = new ChordTable(chordsJson);
  const save = loadSave();
  const melodyDoc = new MelodyDoc((save.userMelody || {}).notes || []);                  // フリープレイの、自分でつくった（自動でつけた）メロディ
  const canvas = $('#gl');
  const scene = new SceneManager(canvas);
  watchLayout(({ phone, portrait, region, inset }) => { scene.setPhoneMode(phone, portrait); scene.setBoardRegion(region); scene.setTopInset(inset); });          // スマホ（縦持ち・横持ち）: 盤の位置・大きさを、見える場所（上のバー・得点・メロディの帯の下〜トレイの上）のまん中に
  const chordStore = new ChordStore(save, table);                                          // 自作コード・編集したコード（フリープレイだけで見える。table.setMode）
  const game = new Game({ table, presets, save });
  const hud = new HUD({ table, save });
  const screens = new Screens();
  const melodyView = new MelodyView({ root: $('#melody-roll'), table, onPick: (k) => { if (game.analysis && game.analysis.melody) hud.showMelodyStep(game.analysis.melody.steps[k]); }, onDone: () => finishMelody() });
  const app = { clearDelayOverride: null, table, presets, save, scene, game, hud, screens, engine: null, sfx: null, muted: false, hintsPref: false, state: 'splash', paused: false, playing: true, demoToken: 0, challengeDone: false, formedAt: new Map(), device: null, marks: { primary: [], advanced: [], guide: null }, melodyView, melodyDoc, chordStore, editPick: false };
  window.__app = app;

  const audioOn = () => !!app.engine && app.engine.ctx.state !== 'closed';

  // ============================================================ 音
  // 0.5秒の無音（8ビット・8000Hz）を、くり返す <audio>（iPhone の消音スイッチ対策。startAudio を見る）
  function silentLoop() {
    const n = 4000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) buf[o + i] = str.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
    buf.fill(128, 44);
    const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    a.loop = true; a.volume = 0.01; a.setAttribute('playsinline', '');
    return a;
  }
  async function startAudio() {
    // iPhone: 本体の「消音スイッチ」がオンでも、ゲームの音が鳴るように、音の使い方を「再生」にする（対応していない端末では、何もしない）。
    //   古い iOS 用に、iPhone・iPad だけ、ごく短い無音の <audio> を、くり返し再生する（Web Audio が、消音スイッチの影響を受けなくなると言われている。実機での確認は、まだ）。
    //   ※ 長さのない（データが空の）音を、くり返すと、ブラウザが固まるので、0.5秒ぶんの、ちゃんとした無音を作る
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 何もしない */ }
    if (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)) {
      try { app.keepAlive = silentLoop(); app.keepAlive.play().catch(() => {}); } catch (e) { /* 何もしない */ }
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    await ctx.resume();
    // ホーム画面にもどる・画面を消すなどで、止まった音を、もどってきたときに、再開する（iPhone は、止めてしまう）
    const wake = () => { if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume().catch(() => {}); if (app.keepAlive && app.keepAlive.paused) app.keepAlive.play().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    window.addEventListener('pointerdown', wake, { passive: true });
    const engine = new AudioEngine(ctx, table, presets);
    $('#loading').classList.remove('hidden');
    await engine.load('./audio/', (p) => { $('#loading-bar').style.width = `${Math.round(p * 100)}%`; });
    engine.getBoard = () => game.board;
    engine.getSplit = () => game.split;
    engine.wantLoopSteps = wantLoopSteps;
    engine.onStepScheduled = onStepScheduled;
    app.engine = engine; app.sfx = new Sfx(engine);
    applyVolume();                                    // 保存してあった音量を、すぐ反映する
    engine.setVoicing(effectiveVoicing());           // 保存してあった、和音のつなぎ方（ふつう・スムーズ）も
    engine.setBpm(game.stage ? game.stage.bpm : 120);
  }

  // ============================================================ 音色・ビート・バッキング（上のバーの「♪」）
  // 選べるもの = もとからある音色・ビート・バッキング + リズム・コード編集の画面から届いたユーザーのもの。ユーザーが選んだものが、ステージの標準より優先
  const stageDefaults = () => { const st = game.stage || {}; return { instrument: st.instrument || 'piano', drum: st.drumId ?? 2, backing: st.backingId ?? 1 }; };
  function effectiveSound() {
    const sp = save.sound || {}, d = stageDefaults();
    const ok = (list, id) => id === 0 || list.some((p) => p.id === id);
    return {
      instrument: INSTRUMENTS.some((i) => i.id === sp.instrument) ? sp.instrument : d.instrument,
      drum: sp.drum != null && ok(presets.drums, sp.drum) ? sp.drum : d.drum,           // 選んでいたユーザーのパターンが消されたら、標準に戻す
      backing: sp.backing != null && ok(presets.backings, sp.backing) ? sp.backing : d.backing,
    };
  }
  function applySound() {
    const s = effectiveSound();
    if (app.engine) { app.engine.setInstrument(s.instrument); app.engine.setPatterns({ drumId: s.drum, backingId: s.backing }); app.engine.setVoicing(effectiveVoicing()); }
    soundMenu.render();
  }
  // 和音のつなぎ方（ステージの標準はない。ユーザーが選んだものだけ。ふつう / スムーズ（中）/ スムーズ（大））
  const VOICINGS = [
    { id: 'off', name: 'ふつう', desc: 'ルートの高さを決めて、その上に和音を重ねる（いつもの音）' },
    { id: 'mid', name: 'スムーズ（中）', desc: 'ルートが4度・5度で動くとき、前の和音から、音の動きを少なくつなぐ（例: Dm7 → G7 → CM7 = DFAC → DFGB → CEGB。ルートの G は、別にベースに）' },
    { id: 'high', name: 'スムーズ（大）', desc: 'ぜんぶの和音のつなぎで、内声の動きが、いちばん少なくなるように、つなぐ（ルートは、別にベースに）' },
  ];
  const effectiveVoicing = () => { const v = (save.sound || {}).voicing; return VOICINGS.some((o) => o.id === v) ? v : 'off'; };
  const soundModel = () => {
    const sp = save.sound || {}, e = effectiveSound();
    const opts = (list) => [{ id: 0, name: 'なし' }, ...list.map((p) => ({ id: p.id, name: p.name, user: !!p.user }))];
    return {
      instrument: { value: e.instrument, isStageDefault: sp.instrument == null, options: INSTRUMENTS },
      drum: { value: e.drum, isStageDefault: sp.drum == null, options: opts(presets.drums) },
      backing: { value: e.backing, isStageDefault: sp.backing == null, options: opts(presets.backings) },
      voicing: { value: effectiveVoicing(), isStageDefault: false, options: VOICINGS },
    };
  };
  const soundMenu = new SoundMenu({
    root: $('#soundmenu'), button: $('#btn-soundmenu'), label: $('#sound-menu-label'), getModel: soundModel,
    onPick: (kind, id) => {
      save.sound = Object.assign({ instrument: null, drum: null, backing: null, voicing: 'off' }, save.sound, { [kind]: id }); writeSave(save);
      applySound();
      if (kind === 'instrument' && app.engine && !app.muted) app.engine.audition(table.byName('Ⅰ').id);        // 音色を変えたら、すぐ聴ける
    },
    onReset: () => { save.sound = { instrument: null, drum: null, backing: null, voicing: effectiveVoicing() }; writeSave(save); applySound(); hud.toast('音はステージの標準にもどしました（和音のつなぎ方は、そのまま）'); },
    onImport: () => libImport.open(),                       // 公開ページ: リズム・コード編集の内容の取り込み
  });
  app.soundMenu = soundMenu;

  // リズム・コード編集の画面で、名前をつけて「ゲームに送った」内容（ドラム・バッキング・固有進行）。変わるたびに、すぐ届く
  let libraryFirst = true;
  function applyLibrary(lib, prev) {
    mergeUserPatterns(presets, lib);
    setCustomProgressions(lib.progressions);
    game.refreshAnalysis();
    hud.setCollection(game.collection());
    if (typeof renderTitleCollection === 'function' && app.state === 'title') renderTitleCollection();
    applySound();
    if (libraryFirst) { libraryFirst = false; return; }
    for (const c of libraryChanges(prev, lib).slice(0, 3)) hud.toast(`${c.label}「${c.name}」を${c.isNew ? '受け取りました' : '更新しました'}`);
  }
  // 公開ページ（https）: ブリッジがないので、リズム・コード編集の内容は、リンク・ファイル・貼り付けで「取り込んで」、ブラウザに保存する（net/share.js・ui/libimport.js）
  const chordNames = table.baseList.filter((c) => !c.isRepeat).map((c) => c.name);
  save.library = sanitizeLocal(save.library, chordNames);
  // 公開ライブラリ: リズム・コード編集の画面（自分の Mac）から、全端末へ、リアルタイムで届く、ドラム・バッキング・進行（game/cloud.json に url があるときだけ。net/cloud.js）
  const cloud = new CloudLibrary({ chordNames, onChange: () => { save.cloudRaw = cloud.raw; writeSave(save); app.library.reloadLocal(); if (libImport.isOpen) libImport.renderList(); } });
  cloud.restore(save.cloudRaw);                                          // 前に届いたものを、先に使う（つながらない場所でも、使える）
  app.cloud = cloud;
  app.library = new LibraryLink({ onChange: applyLibrary, local: () => save.library, cloud: () => cloud.lib });
  async function startCloud() {
    const cfg = await loadCloudConfig();
    if (!cfg) { if (cloud.count()) app.library.reloadLocal(); return; }
    if (bridgeAvailable() && !/^http:/.test(cfg.url)) return;           // ブリッジのある、自分のパソコン: ブリッジのライブラリが本物。公開のものは、使わない（テストの上書きは、127.0.0.1 の http）
    if (bridgeAvailable()) app.library.forceLocal = true;
    cloud.start(cfg);
    app.library.reloadLocal();
  }

  // 演奏のループの長さ。チュートリアルで、お手本も、置いた駒も、4つの場所（1〜4番）におさまるあいだは、4ステップでループする（5〜8番の空きを待たない）。
  // 5番以降に駒を置くと、次の周回から、8ステップに戻る。フリープレイ・タイムアタック・チャレンジステージ・タイトルは、いつも8ステップ
  function wantLoopSteps() {
    if (game.mode !== 'tutorial' || !game.stage) return 8;
    const need = (game.stage.solution || []).reduce((m, [slot]) => Math.max(m, slot + 1), 0);
    let used = 0;
    game.board.forEach((x, i) => { if (x !== null) used = i + 1; });
    return Math.max(need, used) > 4 ? 8 : 4;
  }

  // ステージの途中で、技の最後のコードが鳴る瞬間に、ごく小さく「きらっ」（技が通った合図）
  function onStepScheduled(info) {
    if (!app.sfx || app.muted) return;
    for (const ins of game.analysis.instances) {
      if (ins.generic || ins.endFirst !== info.step) continue;
      const born = app.formedAt.get(`${ins.id}|${ins.startPos}|${ins.endPos}`) || 0;
      if (performance.now() - born < 2500) continue;
      const c = table.byName(ins.chords[ins.chords.length - 1]);
      if (c) app.sfx.trick(info.time, voiceChord(c, BASE_C_DEFAULT + 12 * app.engine.octave, -1, false).notes, 0.38, false);
    }
  }

  function handleAudioEvent(e) {
    if (e.type === 'step') {
      scene.setPlayhead(e.step);
      scene.glowPiece(e.step, 1);
      for (const ins of game.analysis.instances) if (!ins.generic && ins.endFirst === e.step) scene.highlightInstance(ins, 1);
    } else if (e.type === 'half') scene.glowPiece(e.step, 1, 1);                     // 分割したマスの、2拍目（後半の駒）
    else if (e.type === 'beat') scene.beatPulse(e.beat === 0 ? 1 : 0.55);
    else if (e.type === 'stop') scene.setPlayhead(-1);
  }

  // ============================================================ ゲームのイベント → 画面・音
  game.on('stage', ({ stage }) => {
    for (let i = 0; i < 8; i++) { scene.setPiece(i, null); scene.setPiece2(i, null); }
    scene.setGhosts(null, []); scene.setGuide(null);
    app.marks = { primary: [], advanced: [], guide: null };
    void stage;
  });
  // 盤の駒を、ゲームの状態（前半・後半）から、すべて描き直す。駒の見た目（名前・色・形）が変わったとき（自作コード・編集）に使う。
  //   分割したマスは、前半を半分の大きさにして、後半の駒も、出しなおす（前半だけ描き直すと、正方形にもどって、後半の駒に重なる）
  function redrawPieces() {
    for (let i = 0; i < 8; i++) {
      const id = game.board[i], id2 = game.split[i];
      const first = id !== null && id !== undefined && table.byId(id) ? table.byId(id) : null;
      const second = first && id2 !== null && id2 !== undefined && table.byId(id2) ? table.byId(id2) : null;
      scene.setPiece(i, first, { animate: false, half: !!second });
      scene.setPiece2(i, second, { animate: false });
    }
  }
  game.on('board', (e) => {
    scene.setPiece(e.slot, e.id !== null ? table.byId(e.id) : null, { animate: e.id !== null && e.source !== 'restore' && !e.slid, half: game.isSplit(e.slot) });
    if (app.sfx && !app.muted && e.source !== 'demo-silent' && e.source !== 'device-sync' && e.source !== 'preset' && e.source !== 'chordbook') { if (e.id !== null) app.sfx.place(); else app.sfx.remove(); }       // プリセットの呼び出しは、まとめて1回だけ鳴らす（applyPreset）
    if (presetMenu.isOpen) presetMenu.refresh();
    if (studio.isOpen) studio.refresh();
    if (e.source === 'device' && e.id !== null) previewPlaced(e.id);                // 実機の盤に駒を置いた: そのコードを、ちょっとだけ聴かせる（演奏中は、小さく）
    if (e.id !== null) { /* ヒントは、そのまま次の判定で更新される */ }
    // タイムアタック（内部の名前は challenge）: 最初の駒を置いたときに、タイマーが始まる（実機の盤に、もともと置いてあった駒の読み込みでは、始めない）
    if (game.mode === 'challenge' && !game.timerRunning && !app.challengeDone && e.id !== null && (e.source === 'player' || e.source === 'device')) { game.startTimer(); hud.toast('スタート！ 90秒'); }
    if (app.device && app.device.live && e.source !== 'device') { /* 実機の盤を見ているときは、画面での操作は無効（トレイも隠している） */ }
  });
  // 分割したマス（前半・後半）の、後半の駒が変わった。前半の駒の大きさ（半分）を、そろえて、後半の駒を出す・取りのぞく
  game.on('split', (e) => {
    const first = game.board[e.slot];
    if (!e.firstChanged && first !== null && first !== undefined) scene.setPiece(e.slot, table.byId(first), { animate: false, half: e.id !== null });
    scene.setPiece2(e.slot, e.id !== null ? table.byId(e.id) : null, { animate: e.id !== null && e.source !== 'restore' && !e.slid });
    if (app.sfx && !app.muted && e.source !== 'demo-silent' && e.source !== 'device-sync' && e.source !== 'preset' && e.source !== 'chordbook') { if (e.id !== null && !e.slid) app.sfx.place(); else if (e.id === null && e.prev !== null && !e.firstChanged) app.sfx.remove(); }
    if (presetMenu.isOpen) presetMenu.refresh();
    if (studio.isOpen) studio.refresh();
  });
  game.on('analysis', ({ result }) => {
    scene.setAnalysis([...result.instances, ...(result.oddities || [])]);         // 「？」（小節の頭の Ⅴ）も、駒を囲んで出す
    hud.setAnalysis(result);
    if (game.mode === 'melody' && result.melody) { melodyView.update(result.melody); melodyView.setDoneEnabled(game.board.some((x) => x !== null)); }
    if (game.mode === 'free' && app.state === 'play') { const prevBest = save.best.free || 0; if (result.score.total > prevBest) { save.best.free = result.score.total; writeSave(save); hud.el.best.textContent = `ベスト ${save.best.free}`; } }
    if (game.mode === 'tutorial') hud.setGoalDone(game.cleared || game.goalMet());
  });
  let lastTrickAt = 0;                                                              // 技が決まった時刻。同じ瞬間に出たジャッジの講評が、技の「理由」を押しのけないように
  game.on('trick', ({ instance, first }) => { lastTrickAt = performance.now(); celebrate(instance, first); });
  game.on('oddity', ({ oddity }) => {                                              // 小節の頭の Ⅴ: 技にならず、減点。地味に「？」と知らせる
    if (game.demoMode) return;
    scene.glowPiece(oddity.startPos, 0.7); scene.flashScreen('#9aa7c4', 0.12);
    hud.showOddity(oddity);
    if (app.sfx && !app.muted) app.sfx.huh();
  });
  game.on('critique', ({ critique }) => {                                           // ジャッジ（講評）: 新しく出た加点・減点・指摘。知らせて、理由を残す
    if (game.demoMode || app.state !== 'play' || critique.quiet) return;           // quiet: 役に立っていない駒など、通知しない講評（右の「技」の一覧には出る）
    const pts = critique.points === 0 ? '' : ` ${critique.points > 0 ? '+' : '−'}${Math.abs(critique.points)}`;
    hud.toast(`${critique.group === 'melody' ? 'メロディ' : 'ジャッジ'}: ${critique.name}${pts}`);
    if (performance.now() - lastTrickAt > 400) hud.setWhy(critique);               // 技（Ⅴ-Ⅰ終止など）が決まった瞬間は、技の理由を残す
    if (critique.kind === 'bad' && app.sfx && !app.muted) app.sfx.huh();
  });
  game.on('hints', (s) => {
    if (!s) { scene.setGhosts(null, []); app.marks.primary = []; app.marks.advanced = []; applyMarks(); return; }
    const items = [...s.primary, ...s.advanced];
    scene.setGhosts(s.cursor, items);
    app.marks.primary = s.primary.map((c) => c.id); app.marks.advanced = s.advanced.map((c) => c.id);
    app.marks.reasons = new Map(items.map((c) => [c.id, c.reason]));
    applyMarks();
    if (items.length && app.sfx && !app.muted && s.primary.length) { /* 無音のまま */ }
  });
  game.on('guide', (g) => {
    hud.setGuide(g);
    scene.setGuide(g.active && g.next ? g.next.slot : null);
    app.marks.guide = g.active && g.next ? g.next.id : null;
    applyMarks();
  });
  game.on('stageClear', ({ stage }) => {
    hud.setGoalDone(true);
    if (app.sfx && !app.muted) app.sfx.clear(app.engine.nextBeatTime(0.1));
    scene.kickBloom(1.4); scene.flashScreen('#66ffcc', 0.3);
    app.clearPending = stage;                    // 結果の画面は、盤面を見てもらってから出す（出す時刻 = clearDueAt）。そのあいだに、メニュー・技の詳細・編集画面などを開いても、閉じて遊ぶ画面にもどったときに、まだ出ていなければ出す（returnToPlay）
    app.clearDueAt = performance.now() + clearDelayMs();
    scheduleClearResult();
  });
  game.on('timer', ({ left }) => { hud.setTimer(left); if (left <= 10 && left > 0 && app.sfx && !app.muted) app.sfx.ui(); });
  game.on('challengeEnd', ({ score, stars, best }) => { app.challengeDone = true; showChallengeEnd(score, stars, best); });
  game.on('melodyEnd', (e) => showMelodyResult(e));
  game.on('trial', ({ state }) => hud.setTrial(state));
  game.on('trialEnd', (e) => showTrialResult(e));
  game.on('presetDone', ({ name }) => hud.toast(`プリセット「${name}」を置きました`));

  function applyMarks() { hud.markTray(app.marks); }

  // クリアしてから、結果の画面が出るまでの時間。決まった進行を、だいたい1周ぶん聴いて、盤面を眺められるぶん（5〜10秒。2026-11-23 に、7〜14秒から短くした）
  function clearDelayMs() {
    if (app.clearDelayOverride !== null) return app.clearDelayOverride;
    const sec = app.engine ? wantLoopSteps() * app.engine.stepSeconds() : 6;
    return Math.round(Math.max(5, Math.min(10, sec * 0.7 + 1.6)) * 1000);
  }
  app.clearDelayMs = clearDelayMs;

  // クリアの結果の画面: 出す時刻（clearDueAt）になったとき、遊ぶ画面（play）なら出す。メニュー・技の詳細・プリセット・編集画面などを開いている間は出さず、閉じて遊ぶ画面にもどったとき（returnToPlay）に出す
  //   （以前は、時刻が来たときに別の画面を開いていると、閉じても、結果が出なかった）
  function scheduleClearResult() {
    clearTimeout(app.clearTimer);
    if (!app.clearPending) return;
    app.clearTimer = setTimeout(tryShowClear, Math.max(0, app.clearDueAt - performance.now()));
  }
  function tryShowClear() {
    const stage = app.clearPending;
    if (!stage || game.stage !== stage || !game.cleared) return;
    if (app.state !== 'play') return;
    showStageClear();
  }
  function returnToPlay() {                                // 開いていた画面（メニュー・技の詳細・プリセット・メロディ・編集画面）から、遊ぶ画面にもどる
    app.state = 'play';
    if (app.clearPending && app.clearPending === game.stage) {
      clearTimeout(app.clearTimer);
      if (performance.now() >= app.clearDueAt) app.clearTimer = setTimeout(tryShowClear, 500);          // 出す時刻は、すぎている: すぐ（少しおいて）出す
      else scheduleClearResult();
    }
  }
  // 結果の画面を出す前に、ほかに開いているもの（メニュー・技の詳細・編集画面・音のメニュー・持ち上げた駒・スマホのシート）を、きちんと閉じる
  //   （以前は、結果の画面が、開いていた画面を隠すだけで、その画面は「開いたまま」と覚えられていて、あとで開けなくなった）
  function closeOverlays() {
    soundMenu.close(); volumeMenu.close(); chordMenu.close(); setEditPick(false);
    if (app.input) app.input.cancel();
    if (presetMenu.isOpen) presetMenu.close();
    if (studio.isOpen) studio.close();
    if (chordLab.isOpen) chordLab.close(true);
    if (trickDetail.isOpen) trickDetail.close();
    if (libImport.isOpen) libImport.close();
    if (howto.isOpen) howto.close();
    if (app.seekbar) app.seekbar.cancel();                      // シークバーをつかんでいたら、そこではなす（演奏が、止まったままにならないように）
    closeSheets();
  }
  function closeSheets() { document.body.classList.remove('side-open', 'guide-open'); syncSheetButtons(); }
  screens.onOverlay = closeSheets;                          // メニュー・結果・編集画面などが出るときは、スマホのシート（技の一覧・ガイド）を閉じる

  // 実機の盤に駒が置かれたときの試聴。ESP32 のブザー（アルペジオ）はやめたので、こちらで、そのコードを鳴らす。
  // 演奏中は、ほかのコードとぶつからないよう、engine.audition が小さく・短くする。続けて置かれたときは、うるさくならないよう間引く
  let lastPreview = 0;
  function previewPlaced(id) {
    if (!app.engine || app.muted) return;
    const now = performance.now();
    if (now - lastPreview < 300) return;
    lastPreview = now;
    app.engine.audition(id);
  }

  // ============================================================ 技が決まった演出
  function celebrate(ins, first) {
    const slot = ins.endFirst;
    const big = ins.points >= 400;
    scene.burstAtSlot(slot, ins.color, big ? 130 : 75, big ? 1.4 : 1);
    scene.shockwave(slot, ins.color, big ? 4.4 : 3.2);
    scene.kickBloom(big ? 1.4 : 0.95); scene.punchCamera(big ? 1 : 0.6);
    scene.timeScale = 0.4;
    scene.flashScreen(ins.color, big ? 0.34 : 0.2);
    ins.positions.forEach((p, i) => setTimeout(() => scene.glowPiece(p, 1), i * 80));
    hud.showStamp(ins, first);
    app.formedAt.set(`${ins.id}|${ins.startPos}|${ins.endPos}`, performance.now());
    if (first) hud.setCollection(game.collection());
    if (app.sfx && !app.muted) {
      const when = app.engine.nextBeatTime();
      const c = table.byName(ins.chords[ins.chords.length - 1]);
      app.sfx.trick(when, voiceChord(c, BASE_C_DEFAULT + 12 * app.engine.octave, -1, false).notes, 1, big);
      if (ins.comboMult > 1) app.sfx.combo(when + 0.12, Math.round(ins.comboMult * 2));
    }
  }

  // ============================================================ 画面の流れ
  function startStage(stage, mode) {
    closeOverlays();
    stopDemo();
    app.clearPending = null; hideClearBar();
    app.state = 'play'; app.paused = false; app.challengeDone = false; app.demoToken++;
    scene.setShift(0);
    game.demoMode = false;
    hud.clearStamps();
    document.body.classList.remove('side-open'); document.body.classList.toggle('guide-open', isPhone() && (mode === 'tutorial' || mode === 'trial')); syncSheetButtons();       // スマホ: 技の一覧・ガイドは、しまう（チュートリアルの始まりだけ、ガイドを開く）
    table.setMode(mode === 'free' ? 'user' : 'base');                // 自作コード・編集したコードは、フリープレイだけ（ほかのステージは、もとの駒だけ）
    setEditPick(false); chordMenu.close();
    enterMode(stage, mode);                       // メロディの帯・盤の見え方・メロディの音（メロディのステージだけ）
    hud.setStage(stage, mode);                    // 先に見出しを出す（loadStage が出すイベントを、画面が受けられるように）
    game.loadStage(stage, mode);
    game.setHints(mode === 'tutorial' ? false : app.hintsPref);
    hud.buildTray(game.trayIds({ grouped: mode !== 'tutorial' }), { grouped: mode !== 'tutorial', addButton: mode === 'free' });
    $('#btn-chord-edit').classList.toggle('hidden', mode !== 'free'); $('#btn-chord-new').classList.toggle('hidden', mode !== 'free');
    applyMarks();                                  // 案内・ヒントの印は、トレイを作ったあとに付ける
    hud.setCollection(game.collection());
    hud.setBpm(stage.bpm);
    hud.setToggle('#btn-hint', game.hintsOn, '#hint-state');
    if (mode === 'free' && chordStore.levelsMoved) { hud.toast(`自作コード ${chordStore.levelsMoved}つを、「自作」の段に移しました（レベルを使いたいコードは、編集画面で選びなおせます）`); chordStore.levelsMoved = 0; }
    if (mode === 'free' && chordStore.migrated) { hud.toast(`以前に編集したコード ${chordStore.migrated}つは、新しい自作コードに引っ越しました（もとのコードは、もとの姿にもどっています）`); chordStore.migrated = 0; }
    if (mode === 'challenge') hud.setTimer(stage.seconds);
    $('#btn-presets').classList.toggle('hidden', mode === 'tutorial' || mode === 'challenge' || mode === 'trial');       // プリセットは、自由に組み立てるとき（フリープレイ・メロディ）だけ
    $('#btn-studio').classList.toggle('hidden', mode !== 'free');                                    // メロディの画面は、フリープレイだけ
    $('#tray-tools .legend').classList.toggle('hidden', mode === 'tutorial');
    $('#guide').classList.toggle('collapsed', false);
    screens.show('hud');
    if (app.engine) {
      app.engine.setBpm(stage.bpm); applySound();
      if (!app.engine.playing && app.playing) app.engine.start();
    }
    if (mode === 'challenge') hud.toast('最初の駒を置くとスタート！');
    if (mode === 'melody') hud.toast('メロディが流れます。合う和音を置いてみよう');
    if (mode === 'trial') hud.toast('条件を守って、ノルマの得点をめざそう');
  }

  // メロディのステージに入る / 出る。帯の表示・盤の見え方（帯のぶん、盤を小さく・下へ）・メロディの音
  function enterMode(stage, mode) {
    const melody = mode === 'melody' && stage.melody;
    document.body.classList.toggle('melody-mode', !!melody);
    if (melody) { melodyView.show(stage); scene.setView(isPortraitPhone() ? {} : { zoom: 1.14, down: 0.075 }); }
    else { melodyView.hide(); scene.setView({}); }
    if (app.engine) app.engine.setMelody(melody ? stage.melody : (mode === 'free' && stage && save.userMelodyOn !== false && melodyDoc.count ? { notes: melodyDoc.notes() } : null));
  }

  function firstOpenTutorial() {
    const i = STAGES.findIndex((s, k) => game.isUnlocked(STAGES, k) && !save.cleared[s.id]);
    return STAGES[i >= 0 ? i : 0];
  }
  function nextStageAfter(stage) {
    const i = STAGES.indexOf(stage);
    return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1] : null;
  }

  // タイトルの図鑑（技の一覧。見つけた技は、色がつく）
  function renderTitleCollection() {
    const col = $('#collection-title'); col.replaceChildren();
    const items = game.collection();
    for (const it of items) col.append(h('div', { class: `col-dot${it.found ? ' found' : ''}`, style: { '--c': it.color }, title: it.name }, String(it.no)));
    $('#coll-title-count').textContent = `${items.filter((i) => i.found).length} / ${items.length}`;
  }

  function showTitle() {
    closeOverlays();
    app.clearPending = null; hideClearBar();
    app.state = 'title'; app.paused = false; app.demoToken++;
    table.setMode('base'); setEditPick(false); chordMenu.close();
    enterMode(null, 'free');
    hud.clearStamps();
    game.loadStage(FREE_STAGE, 'free'); game.demoMode = true;
    game.setHints(false);
    if (app.engine) { app.engine.setBpm(112); app.engine.setInstrument('piano'); app.engine.setPatterns({ drumId: 2, backingId: 1 }); soundMenu.refreshLabel(); if (!app.engine.playing) app.engine.start(); }
    screens.show('title');
    scene.setShift(isPortraitPhone() ? 0 : -1.9);
    renderTitleCollection();
    startDemo();
  }

  function showStages() {
    closeOverlays();
    stopDemo();
    table.setMode('base');
    enterMode(null, 'free');
    app.clearPending = null; hideClearBar();
    hud.clearStamps();
    game.loadStage(FREE_STAGE, 'free'); game.demoMode = true;        // 盤を空にして、ドラムだけ流しておく
    game.setHints(false);                                           // ヒントの候補が、背景に残らないように（遊ぶときは、startStage が好みどおりに戻す）
    scene.setShift(0);
    $('#stages-title').textContent = 'TUTORIAL'; $('#stages-sub').textContent = 'チュートリアルを選ぶ';
    screens.buildStageGrid(STAGES, [], game, (s, m) => startStage(s, m));                  // フリープレイ・メロディー・チャレンジステージ・タイムアタックは、タイトルのメニューから
    screens.show('stages');
    app.state = 'stages';
  }

  // 「メロディーにコードをつける」: メロディのステージを選ぶ画面（ステージ選択と、同じ画面の部品を使う）
  function showMelodies() {
    closeOverlays();
    stopDemo();
    table.setMode('base');
    enterMode(null, 'free');
    app.clearPending = null; hideClearBar();
    hud.clearStamps();
    game.loadStage(FREE_STAGE, 'free'); game.demoMode = true;
    game.setHints(false);
    scene.setShift(0);
    $('#stages-title').textContent = 'MELODY'; $('#stages-sub').textContent = 'メロディーにコードをつける';
    screens.buildMelodyGrid(MELODY_STAGES, game, (m) => startStage(m, 'melody'));
    screens.show('stages');
    app.state = 'stages';
  }

  // 「チャレンジステージ」: ステージを選ぶ画面（ステージ選択と、同じ画面の部品を使う）
  function showTrials() {
    closeOverlays();
    stopDemo();
    table.setMode('base');
    enterMode(null, 'free');
    app.clearPending = null; hideClearBar();
    hud.clearStamps();
    game.loadStage(FREE_STAGE, 'free'); game.demoMode = true;
    game.setHints(false);
    scene.setShift(0);
    $('#stages-title').textContent = 'CHALLENGE STAGE'; $('#stages-sub').textContent = 'チャレンジステージを選ぶ';
    screens.buildTrialGrid(TRIAL_STAGES, game, (t) => startStage(t, 'trial'));
    screens.show('stages');
    app.state = 'stages';
  }

  function showStageClear() {
    hud.clearStamps();
    app.clearPending = null; clearTimeout(app.clearTimer);
    closeOverlays(); app.state = 'result';
    const stage = game.stage;
    const next = nextStageAfter(stage);
    screens.showResult({
      kicker: 'STAGE CLEAR', title: `${stage.title}`, score: game.analysis.score.total, scoreNote: '盤の得点',
      paragraphs: stage.outro, tricks: game.analysis.instances,
      buttons: [
        { label: next ? `次へ ▶ ${next.title}` : 'フリープレイへ ▶', primary: true, onClick: () => (next ? startStage(next, 'tutorial') : startStage(FREE_STAGE, 'free')) },
        { label: '盤面を見る・編集する', onClick: () => { screens.hide('result'); app.state = 'play'; showClearBar(stage, next); } },     // 結果を閉じて、盤面を見たり、いじったりする
        { label: 'もう一度', onClick: () => startStage(stage, 'tutorial') },
        { label: 'チュートリアルを選ぶ', onClick: showStages },
      ],
    });
  }

  // クリア（タイムアタックの終了）のあと、結果を閉じて、盤面を見る・さわっているあいだの、小さな操作の欄（結果をもう一度見る / つぎへ・もう一度）
  //   タイムアタックのときは、記録（得点・ベスト）は、終わった時点のまま、もう変わらない。盤面は、自由にさわれる
  function showClearBar(stage, next, opts = {}) {
    $('#clear-bar-title').textContent = opts.title || '✓ ステージクリア';
    $('#clear-bar-note').textContent = opts.note || '盤面は自由にさわれます';
    $('#btn-clear-next').textContent = opts.nextLabel || (next ? `つぎへ ▶ ${next.title}` : 'フリープレイへ ▶');
    $('#clear-bar').classList.remove('hidden');
    app.clearBarStage = stage;
    app.clearBarKind = opts.kind || 'stage';
  }
  function hideClearBar() { $('#clear-bar').classList.add('hidden'); app.clearBarStage = null; app.clearBarKind = null; }

  // メロディのステージ: 「採点する」を押したあと。コード進行の点 + メロディとの相性の点 + ステップごとの結果
  function finishMelody() {
    if (game.mode !== 'melody' || !game.board.some((x) => x !== null)) return;
    hud.clearStamps();
    game.finishMelody();
  }
  function showMelodyResult(e) {
    closeOverlays(); app.state = 'result';
    const m = e.result.melody, sc = e.result.score;
    const idx = MELODY_STAGES.indexOf(e.stage), next = idx >= 0 ? MELODY_STAGES[idx + 1] || null : null;
    const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);
    const rows = m.steps.map((st) => h('div', { class: `mrr v-${st.verdict}` },
      h('span', { class: 'n' }, `${st.step + 1}番`), h('b', {}, st.chord || '—'), h('span', { class: 'mk' }, (VERDICT[st.verdict] || VERDICT.rest).mark),
      h('span', { class: 'pt' }, st.hasNotes && st.chord ? `${signed(st.points)}${st.bonus ? ` ＋${st.bonus}` : ''}` : ''),
      h('span', { class: 't', title: st.text }, st.brief || st.text)));
    screens.showResult({
      kicker: 'MELODY', title: e.stage.title, stars: e.stars, score: e.score, scoreNote: e.isBest ? 'NEW BEST!' : `ベスト ${e.best}`,
      paragraphs: [`コード進行の点 ${sc.raw}（技・ジャッジ）+ メロディとの相性の点 ${signed(m.total)}（相性 ${Math.round(m.match * 100)}%）= ${e.score}点。`,
        `お手本の一例の得点は ${e.par.total}点。`, ...e.stage.outro],
      extras: [h('div', { class: 'mr-conds' }, e.conds.map((c) => h('div', { class: c.ok ? 'ok' : '' }, `${c.ok ? '✓' : '・'} ${c.text}`))), h('div', { class: 'mr-result' }, rows), h('div', { class: 'mr-result-note' }, `お手本の一例: ${e.stage.answer.join(' → ')}（これが正解というわけではありません）`)],
      tricks: e.result.instances,
      buttons: [
        { label: next ? '次のメロディーへ ▶' : 'メロディーを選ぶ ▶', primary: true, onClick: () => (next ? startStage(next, 'melody') : showMelodies()) },
        { label: '盤面にもどる', onClick: () => { screens.hide('result'); app.state = 'play'; } },
        { label: 'もう一度', onClick: () => startStage(e.stage, 'melody') },
        { label: 'メロディーを選ぶ', onClick: showMelodies },
      ],
    });
  }

  function showChallengeEnd(score, stars, best) {
    hud.clearStamps(); closeOverlays(); app.state = 'result';
    app.lastChallenge = { score, stars, best };
    screens.showResult({
      kicker: 'TIME UP', title: 'タイムアタック', stars, score, scoreNote: score >= best ? 'NEW BEST!' : `ベスト ${best}`,
      paragraphs: [stars === 3 ? 'すばらしい！ 技がしっかり連鎖しています。' : stars >= 1 ? 'いい調子です。技を連鎖させると、コンボで得点がのびます。' : '技を決めるほど、得点がのびます。「ヒント」も使ってみよう。', '得点は90秒のあいだでいちばん高かったときの盤の得点です。'],
      tricks: game.analysis.instances,
      buttons: [
        { label: 'もう一度', primary: true, onClick: () => startStage(CHALLENGE_STAGE, 'challenge') },
        { label: '盤面を見る・編集する', onClick: () => { screens.hide('result'); app.state = 'play'; showClearBar(CHALLENGE_STAGE, null, { kind: 'challenge', title: '⏱ タイムアタック終了', note: '盤面は自由にさわれます（記録は、終わったときのまま）', nextLabel: 'もう一度 ▶' }); } },     // 結果を閉じて、盤面を見たり、いじったりする（チュートリアルと同じ）
        { label: 'タイトルへ', onClick: showTitle },
      ],
    });
  }

  // チャレンジステージ: 「提出する」を押した。条件がそろっていて、ノルマ以上ならクリア（結果の画面）。そろっていなければ、何が足りないかを、知らせる
  function finishTrial() {
    if (game.mode !== 'trial' || app.state !== 'play') return;
    const r = game.finishTrial();
    if (r && !r.ok) hud.toast(r.state.allOk ? `ノルマ ${r.state.norm}点まで、あと ${r.state.norm - r.state.score}点です` : '条件が、まだ そろっていません');
  }
  function showTrialResult(e) {
    closeOverlays(); app.state = 'result'; hud.clearStamps();
    app.lastTrial = e;
    const next = nextTrialAfter(e.stage);
    screens.showResult({
      kicker: 'CHALLENGE CLEAR', title: e.stage.title, stars: e.stars, score: e.score, scoreNote: `ノルマ ${e.stage.norm}点 ／ ${e.isBest ? 'NEW BEST!' : `ベスト ${e.best}`}`,
      paragraphs: [`条件を全部守って、ノルマ ${e.stage.norm}点に届きました。`, e.stars < 3 ? `つぎの星は ${e.stage.stars[e.stars]}点です。` : '星3つです。すばらしい！', ...e.stage.outro],
      extras: [h('div', { class: 'mr-conds' }, e.state.rules.map((r) => h('div', { class: 'ok' }, `✓ ${r.text}`)))],
      tricks: e.result.instances,
      buttons: [
        { label: next ? `次へ ▶ ${next.title}` : 'チャレンジステージを選ぶ ▶', primary: true, onClick: () => (next ? startStage(next, 'trial') : showTrials()) },
        { label: '盤面を見る・編集する', onClick: () => { screens.hide('result'); app.state = 'play'; showClearBar(e.stage, next, { kind: 'trial', title: '✓ チャレンジクリア', note: '盤面は自由にさわれます（記録は、提出したときのまま）', nextLabel: next ? `つぎへ ▶ ${next.title}` : 'チャレンジステージを選ぶ ▶' }); } },
        { label: 'もう一度', onClick: () => startStage(e.stage, 'trial') },
        { label: 'チャレンジステージを選ぶ', onClick: showTrials },
      ],
    });
  }

  // ============================================================ タイトルの、自動デモ
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function demoLoop(token) {
    let i = 0;
    while (token === app.demoToken && app.state === 'title') {
      if (app.device && app.device.live) { await sleep(500); continue; }            // 実機の盤を見ているあいだは、デモは動かさない
      const demo = DEMO_SEQUENCES[i % DEMO_SEQUENCES.length];
      const seq = demo.chords;
      game.clear({ source: 'demo' });
      if (app.engine) { app.engine.setInstrument(demo.instrument); soundMenu.refreshLabel(); }          // タイトルの背景では、進行ごとに、ちがう音色を鳴らす
      await sleep(900);
      for (let k = 0; k < seq.length; k++) {
        if (token !== app.demoToken || app.state !== 'title') return;
        if (app.device && app.device.live) break;
        game.place(k, table.byName(seq[k]).id, { force: true, source: 'demo' });
        await sleep(1350);
      }
      await sleep(6500);
      i++;
    }
  }
  function startDemo() { app.demoToken++; demoLoop(app.demoToken); }
  function stopDemo() { app.demoToken++; }

  // ============================================================ ボタン
  function bindButtons() {
    $('#btn-start').addEventListener('click', () => begin(true));
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;               // 名前を入力しているときは、ショートカット（スペース・H・M）を、効かせない
      if (e.key === 'Enter' && app.state === 'splash') begin(true);
      if (e.key === ' ' && app.state === 'play' && !e.repeat) { e.preventDefault(); togglePlay(); }
      if ((e.key === 'h' || e.key === 'H') && app.state === 'play') toggleHints();
      if ((e.key === 'm' || e.key === 'M') && app.state !== 'splash') toggleSound();
      if (e.key === '?' && !e.repeat && !howto.isOpen) howto.open();                           // 使い方（開けるのは、遊ぶ画面・タイトル・ステージ選択のとき）
      if (e.key === 'Escape' && !e.defaultPrevented) { if (app.state === 'play') openPause(); else if (app.state === 'pause') resumeFromPause(); }
      if ((e.key === 'p' || e.key === 'P') && app.state === 'play' && !$('#btn-presets').classList.contains('hidden')) presetMenu.open();
    });
    $$('#title .menu button').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'tutorial') startStage(firstOpenTutorial(), 'tutorial');
      else if (a === 'stages') showStages();
      else if (a === 'free') startStage(FREE_STAGE, 'free');
      else if (a === 'melody') showMelodies();
      else if (a === 'trial') showTrials();
      else if (a === 'challenge') startStage(CHALLENGE_STAGE, 'challenge');
    }));
    $('#stages .back').addEventListener('click', showTitle);
    $('#btn-import').addEventListener('click', () => libImport.open());
    $('#btn-howto-title').addEventListener('click', () => howto.open());
    $('#btn-howto').addEventListener('click', () => howto.open());
    $('#btn-unlock').addEventListener('click', () => { save.unlockAll = !save.unlockAll; writeSave(save); hud.toast(save.unlockAll ? '全ステージを開きました（デモ用）' : '元に戻しました'); });
    $('#btn-reset').addEventListener('click', () => { if (confirm('進み具合（クリア・図鑑・ベスト・メロディの記録）をすべてリセットしますか？\n（保存したプリセットと、つくったメロディ・自作コード・取り込んだリズムは残ります）')) { const keep = { presets: save.presets, library: save.library, chordbook: save.chordbook, userMelody: save.userMelody, userMelodyOn: save.userMelodyOn, volume: save.volume, volumeSet: save.volumeSet, mix: save.mix }; Object.assign(save, resetSave(), keep); writeSave(save); hud.toast('リセットしました（プリセット・メロディ・自作コード・取り込んだリズムは残してあります）'); showTitle(); } });
    $('#btn-menu').addEventListener('click', openPause);
    $$('#pause [data-act]').forEach((b) => b.addEventListener('click', () => {
      if (app.state !== 'pause') return;                         // メニューが開いているときだけ（見えていないボタンが、押されても、何も起きない）
      const a = b.dataset.act;
      if (a === 'resume') { resumeFromPause(); return; }
      if (a === 'howto') { resumeFromPause(); howto.open(); return; }                      // メニューから「使い方」: メニューを閉じて（遊ぶ画面にもどって）、使い方を開く（スマホは、上のバーの「？」が、画面の外にあるので、ここからも）
      screens.hide('pause'); app.paused = false;
      if (a === 'restart') startStage(game.stage, game.mode);
      else if (a === 'stages') (game.mode === 'trial' ? showTrials : game.mode === 'melody' ? showMelodies : showStages)();
      else if (a === 'title') showTitle();
    }));
    $('#btn-clear-result').addEventListener('click', () => {
      if (!app.clearBarStage) return;
      const kind = app.clearBarKind; hideClearBar();
      if (kind === 'challenge' && app.lastChallenge) showChallengeEnd(app.lastChallenge.score, app.lastChallenge.stars, app.lastChallenge.best);
      else if (kind === 'trial' && app.lastTrial) showTrialResult(app.lastTrial);
      else showStageClear();
    });
    $('#btn-clear-next').addEventListener('click', () => {
      const st = app.clearBarStage; if (!st) return;
      const kind = app.clearBarKind; hideClearBar();
      if (kind === 'challenge') { startStage(CHALLENGE_STAGE, 'challenge'); return; }
      if (kind === 'trial') { const nt = nextTrialAfter(st); if (nt) startStage(nt, 'trial'); else showTrials(); return; }
      const nx = nextStageAfter(st); if (nx) startStage(nx, 'tutorial'); else startStage(FREE_STAGE, 'free');
    });
    $('#bpm-down').addEventListener('click', () => changeBpm(-5));
    $('#bpm-up').addEventListener('click', () => changeBpm(+5));
    $('#btn-hint').addEventListener('click', toggleHints);
    $('#btn-play').addEventListener('click', togglePlay);
    $('#btn-clear').addEventListener('click', () => game.clear());
    $('#btn-chord-new').addEventListener('click', () => hud.onAddChord && hud.onAddChord());
    $('#btn-chord-edit').addEventListener('click', () => {
      if (app.state !== 'play' || game.mode !== 'free') return;
      if (app.input && app.input.armed !== null) { const id = app.input.armed; app.input.cancel(); startEdit(id); return; }          // 持ち上げている駒を、投げ入れた
      setEditPick(!app.editPick);
    });
    $('#btn-presets').addEventListener('click', () => { if (app.state === 'play') presetMenu.open(); });
    $('#btn-studio').addEventListener('click', () => { if (app.state === 'play') studio.open(); });
    $('#guide-toggle').addEventListener('click', () => {
      if (isPhone()) { document.body.classList.remove('guide-open'); syncSheetButtons(); return; }               // スマホ: 「−」は、シートをとじる
      const g = $('#guide'); g.classList.toggle('collapsed'); $('#guide-toggle').textContent = g.classList.contains('collapsed') ? '＋' : '−';
    });
    $('#btn-side-toggle').addEventListener('click', () => { document.body.classList.toggle('side-open'); syncSheetButtons(); });
    $('#btn-guide-toggle').addEventListener('click', () => { document.body.classList.toggle('guide-open'); syncSheetButtons(); });
    window.addEventListener('resize', () => scene.onResize());
  }

  // スマホ: 「技 ▾」「ガイド」ボタンの見た目を、シートの開き閉じにそろえる
  function syncSheetButtons() {
    const b = $('#btn-side-toggle'); if (b) b.textContent = document.body.classList.contains('side-open') ? '技 ▴' : '技 ▾';
    const g = $('#btn-guide-toggle'); if (g) g.classList.toggle('on', document.body.classList.contains('guide-open'));
  }

  // メニューから、ゲームにもどる。メニューを開いている間に、実機の盤の駒が変わっていたら、いまの盤にそろえる。クリアの結果が出そびれていたら、出す
  function resumeFromPause() {
    if (app.state !== 'pause') return;
    screens.hide('pause'); app.paused = false; app.state = 'play';
    if (app.device && app.device.live && app.device.latest) game.setBoard(app.device.latest, { source: 'device-sync' });
    returnToPlay();
  }
  function openPause() {
    if (app.state !== 'play') return;                         // ほかの画面（技の詳細・編集画面・結果など）が開いているときは、開かない
    hud.clearStamps(); app.paused = true;
    const label = { tutorial: 'チュートリアルを選ぶ', trial: 'チャレンジステージを選ぶ', melody: 'メロディーを選ぶ' }[game.mode];        // フリープレイ・タイムアタックには、選ぶ画面がない
    const b = $('#pause-stages'); b.classList.toggle('hidden', !label); if (label) b.textContent = label;
    screens.show('hud', 'pause'); app.state = 'pause';
  }
  function changeBpm(d) {
    const bpm = Math.max(50, Math.min(200, (app.engine ? app.engine.bpm : (game.stage ? game.stage.bpm : 120)) + d));
    if (app.engine) app.engine.setBpm(bpm);
    hud.setBpm(bpm);
  }
  function toggleHints() { app.hintsPref = !game.hintsOn; game.setHints(app.hintsPref); hud.setToggle('#btn-hint', game.hintsOn, '#hint-state'); hud.toast(game.hintsOn ? 'ヒント ON: 次に置く候補がうっすら出ます' : 'ヒント OFF'); if (app.sfx && !app.muted && game.hintsOn) app.sfx.hint(); }
  // 音量（全体）とミュート。上のバーの「音」のボタン → 音量のメニュー（バーとミュート）。M キーは、ミュートの ON/OFF
  function applyVolume() {
    if (app.engine) { app.engine.setVolumes({ master: masterGainFor(save.volume, app.muted) }); app.engine.setMix(save.mix); }
    const b = $('#btn-sound'); b.classList.toggle('on', !app.muted);
    $('#sound-state').textContent = app.muted ? 'ミュート' : `${save.volume}%`;
    volumeMenu.refresh();
  }
  function toggleSound() { app.muted = !app.muted; applyVolume(); }
  function setVolume(pct) {
    save.volume = Math.max(0, Math.min(100, Math.round(pct))); save.volumeSet = true;
    if (app.muted && save.volume > 0) app.muted = false;           // ミュート中に、バーを動かしたら、解除する
    applyVolume(); writeSave(save);
  }
  // ドラム・バッキングの音量（0〜100%。はじめは 50% = これまでと同じ大きさ）。ミュート・全体の音量とは別。保存される
  function setMix(kind, pct) {
    save.mix = { ...save.mix, [kind]: Math.max(0, Math.min(100, Math.round(pct))) };
    applyVolume(); writeSave(save);
  }
  function resetMix() { save.mix = { drums: DEFAULT_MIX, backing: DEFAULT_MIX }; applyVolume(); writeSave(save); }
  const volumeMenu = new VolumeMenu({
    root: $('#volmenu'), button: $('#btn-sound'), getModel: () => ({ percent: save.volume, muted: app.muted, mix: save.mix, mixDefault: DEFAULT_MIX }),
    onVolume: setVolume, onMute: toggleSound, onMix: setMix, onMixReset: resetMix,
    onRelease: (kind) => {                                                                                                // バーをはなしたら、聴いて大きさが分かるように、音を鳴らす
      if (!app.engine || app.muted || save.volume <= 0) return;
      if (kind === 'drums' || kind === 'backing') app.engine.previewMix(kind);                                               // 演奏中は、ほんとうの演奏で聴けるので、鳴らさない
      else app.engine.audition(table.byName('Ⅰ').id);
    },
  });
  app.volumeMenu = volumeMenu;
  applyVolume();                                                                  // 保存してあった音量を、ボタンの文字に出す
  // ============================================================ シークバー（演奏の位置。巻き戻し・早送り。2026-11-25）
  //   上のバーの下の真ん中。演奏に合わせて動く。つかんで動かすと、演奏が止まって、巻き戻しの音だけが鳴る（engine.scrubBegin / scrubTo）。はなすと、その位置から続く（scrubEnd）
  function seekInfo() {
    const en = app.engine;
    if (!en || en.ctx.state !== 'running' || !en.playing) return { enabled: false, pos: 0, len: wantLoopSteps() * 8 };
    const p = en.loopPosAt(en.ctx.currentTime - (en.ctx.outputLatency || 0));           // 耳に届いている位置（出力の遅れのぶん、少し前）
    const v = en.scrub ? en.scrub.v : 0;
    return { enabled: true, pos: p.pos, len: p.len, dir: Math.abs(v) >= 0.5 / en.slotSeconds() ? Math.sign(v) : 0 };      // dir: 通常の演奏の半分以上の速さで動かしているとき、◀◀ ▶▶ を出す
  }
  function followScrub(pos) {                                                         // つかんでいるあいだ、3D の盤の「いま」の印を、つかんでいるステップに（通りすぎた駒は、ひと光り）
    const step = Math.floor(pos / 8);
    if (step === app.scrubStep) return;
    app.scrubStep = step;
    scene.setPlayhead(step); scene.glowPiece(step, 0.7);
  }
  const seekbar = new SeekBar({
    root: $('#seekbar'),
    onBegin: (shown) => !!app.engine && app.state === 'play' && app.engine.scrubBegin(shown),
    onMove: (pos) => { if (app.engine) { app.engine.scrubTo(pos); followScrub(pos); } },
    onEnd: (pos) => { app.scrubStep = -1; if (app.engine) app.engine.scrubEnd(pos); },
    onKey: ({ delta, to }) => {                                                       // キーボード: ← → で 1ステップ・Home・End
      const en = app.engine;
      if (!en || !en.playing || app.state !== 'play') return;
      const p = en.loopPosAt(en.ctx.currentTime - (en.ctx.outputLatency || 0));
      const target = to !== undefined ? to : Math.round(p.pos / 8) * 8 + delta;
      en.seekTo(((target % p.len) + p.len) % p.len);
    },
  });
  app.seekbar = seekbar; app.scrubStep = -1;
  function togglePlay() {
    if (!app.engine) return;
    app.playing = !app.engine.playing;
    if (app.playing) app.engine.start(); else app.engine.stop();
    hud.setToggle('#btn-play', app.playing, '#play-state');
  }

  // ============================================================ プリセット（お気に入りの進行の保存・呼び出し）
  const presetStore = new PresetStore(save, table);
  const presetMenu = new PresetMenu({
    root: $('#presets'), table, store: presetStore, getBoard: () => game.board, getSplit: () => game.split, getMelody: () => (game.mode === 'free' ? melodyDoc.notes() : []), isLive: () => !!(app.device && app.device.live), onApply: applyPreset,
    onOpen: () => { if (app.input) app.input.cancel(); app.state = 'presets'; hud.clearStamps(); screens.show('hud', 'presets'); },       // 持ち上げていた駒（クリックで選んだ半透明の駒）は、もどす
    onClose: () => { screens.hide('presets'); returnToPlay(); },
  });
  app.presetMenu = presetMenu; app.presetStore = presetStore;
  hud.onPresetGuideCancel = () => { game.setPresetGuide(null); hud.toast('プリセットの案内をやめました'); };
  // プリセットを、盤に置く（画面の盤のとき）/ 置く駒と場所を案内する（実機の盤のとき）
  function applyPreset(preset, start) {
    const plan = placementPlan(preset, start, table);
    const withMelody = !!plan.melody && game.mode === 'free';                  // メロディつきのプリセットは、フリープレイで、その範囲のメロディも置きかえる
    if (withMelody) melodyDoc.replaceAll(applyMelodyPlan(melodyDoc.notes(), plan));
    if (presetMenu.isLive()) {                                                // 実機の盤を使っているとき: 画面では置けないので、案内する
      game.setPresetGuide(plan.entries, preset.name);
      $('#guide').classList.remove('collapsed'); $('#guide-toggle').textContent = '−';
      hud.toast(`「${preset.name}」を置く案内を出しました（${plan.start + 1}番〜${plan.end + 1}番）${withMelody ? 'メロディは入れました' : ''}`);
      return;
    }
    const r = game.placeMany(plan.entries, { source: 'preset' });
    if (r.changed && app.sfx && !app.muted) app.sfx.place();
    hud.toast(r.changed ? `「${preset.name}」を${plan.start + 1}番〜${plan.end + 1}番に置きました${withMelody ? '（メロディも入れました）' : ''}${r.blocked.length ? `（使えない駒が${r.blocked.length}つありました）` : ''}${plan.missing.length ? `（いまはない駒「${plan.missing.join('」「')}」は、空きにしました）` : ''}` : `「${preset.name}」はそのとおりに置いてあります${withMelody ? '（メロディは入れました）' : ''}`);
  }

  // ============================================================ メロディの画面（♪ メロディ。自動でつける・ピアノロールで書く・直す）
  function applyUserMelody() {                                                // フリープレイのとき、メロディの音を、演奏に反映する
    if (!app.engine || game.mode !== 'free' || game.demoMode) return;
    app.engine.setMelody(save.userMelodyOn !== false && melodyDoc.count ? { notes: melodyDoc.notes() } : null);
  }
  let melodySaveTimer = null;
  function flushMelodySave() { clearTimeout(melodySaveTimer); melodySaveTimer = null; save.userMelody = melodyDoc.count ? { notes: melodyDoc.notes(), at: Date.now() } : null; writeSave(save); }
  function refreshStudioChip() { const b = $('#btn-studio'); b.classList.toggle('has', melodyDoc.count > 0); b.title = melodyDoc.count ? `メロディがあります（${melodyDoc.count}音）。クリックで直す・書き足す` : 'メロディを自動でつける・書く・直す（フリープレイ）'; }
  melodyDoc.subscribe(() => {
    applyUserMelody(); refreshStudioChip();
    clearTimeout(melodySaveTimer); melodySaveTimer = setTimeout(flushMelodySave, 300);        // ドラッグの途中で、何度も保存しない
  });
  window.addEventListener('pagehide', () => { if (melodySaveTimer !== null) flushMelodySave(); });
  refreshStudioChip();
  function saveMelodyPreset(name) {                                           // 盤の和音（最初の駒〜最後の駒）と、そのメロディを、いっしょにプリセットへ
    const b = game.board, first = b.findIndex((x) => x !== null);
    if (first < 0) return { ok: false, reason: 'few' };
    let last = 7; while (last > first && b[last] === null) last--;
    return presetStore.add({ name, board: b, split: game.split, from: first, to: last, melody: melodyDoc.notes() });
  }
  const studio = new MelodyStudio({
    root: $('#studio'), table, doc: melodyDoc, getBoard: () => game.board, getSplit: () => game.split,
    audition: (midi, slots) => { const e = app.engine; if (e && !app.muted && e.ctx.state === 'running') e.playLead(midi, e.ctx.currentTime + 0.01, Math.max(0.12, Math.min(0.7, slots * e.slotSeconds() * 0.95))); },
    isPlaying: () => !!(app.engine && app.engine.playing), togglePlay,
    getEnabled: () => save.userMelodyOn !== false, setEnabled: (v) => { save.userMelodyOn = !!v; writeSave(save); applyUserMelody(); },
    onSavePreset: saveMelodyPreset,
    onOpen: () => { if (app.input) app.input.cancel(); app.state = 'studio'; hud.clearStamps(); screens.show('hud', 'studio'); },
    onClose: () => { screens.hide('studio'); returnToPlay(); if (melodySaveTimer !== null) flushMelodySave(); },
  });
  app.studio = studio;

  // ============================================================ 自作コード・編集したコード（フリープレイ）
  //   ・トレイの「＋」→ 新しいコード / 「コードを編集」ボタン・駒の右クリック（長押し）・持ち上げた駒をボタンに投げ入れる → 編集 / ダブルクリック → 盤の次の場所に置く（input.js）
  const chordMenu = new ChordMenu({ root: $('#chordmenu') });
  const chordLab = new ChordLab({
    root: $('#chordlab'), table, store: chordStore,
    audition: (notes, opts) => { if (app.engine && !app.muted) app.engine.auditionNotes(notes, opts); },
    onOpen: () => { if (app.input) app.input.cancel(); setEditPick(false); chordMenu.close(); app.state = 'chordlab'; hud.clearStamps(); screens.show('hud', 'chordlab'); },
    onClose: () => { screens.hide('chordlab'); returnToPlay(); },
    onSaved: (change) => {
      const c = table.byId(change.id);
      const label = c ? `「${c.name}（${c.symbol}）」` : '';
      hud.toast(change.type === 'add' ? `自作コード${label}を追加しました（下の${c && c.level !== null && c.level !== undefined ? `Lv.${c.level}` : '「自作」'}の段にあります）` : change.type === 'update' ? `${label}を保存しました` : '自作コードを削除しました');
    },
  });
  app.chordLab = chordLab; app.chordMenu = chordMenu;
  // 自作コード・編集したコードが変わったとき: 盤の駒・トレイ・判定・ヒントを、新しい内容にそろえる
  chordStore.on((change) => {
    if (game.mode !== 'free') return;
    game.refreshAllowed();
    redrawPieces();
    hud.buildTray(game.trayIds(), { grouped: true, addButton: true });
    applyMarks();
    if (change.type === 'add' && app.engine && !app.muted) app.engine.audition(change.id);
  });
  hud.onAddChord = () => { if (app.state === 'play' && game.mode === 'free') chordLab.openNew(); };
  function startEdit(id) { if (app.state !== 'play' || game.mode !== 'free') return; setEditPick(false); chordLab.openEdit(id); }
  // 「コードを編集」を押したあと: 編集する駒を、下の一覧か盤の上から選ぶ
  function setEditPick(on) {
    app.editPick = !!on;
    document.body.classList.toggle('edit-pick', app.editPick);
    $('#btn-chord-edit').classList.toggle('on', app.editPick);
    if (on) hud.toast('編集するコードを、下の一覧か盤の上から選んでください（もういちど押すか Esc でやめる）');
  }
  function openChordMenu({ id, x, y, touch = false }) {
    if (game.mode !== 'free' || app.state !== 'play') return;
    const c = table.byId(id);
    if (!c || c.isRepeat) return;
    const items = [{ label: c.custom ? 'コードを編集' : 'これをもとに自作コードをつくる', hint: c.custom ? '' : 'もとのコードは、そのままです', onClick: () => startEdit(id) }];
    if (c.custom) items.push({ label: 'このコードを削除', danger: true, hint: '盤の上にある同じ駒も、はずれます', onClick: () => { chordStore.removeCustom(id); hud.toast(`自作コード「${c.name}」を削除しました`); } });
    chordMenu.open({ x, y, title: `${c.name}（${c.symbol}）`, items, touch });
  }

  // ============================================================ リズム・コード編集の内容の取り込み（公開ページ。タイトルの「リズムを取り込む」・音のメニューのボタン・リンク（#lib=）から開く）
  const countOf = (r) => ({ drums: r.drums.length, backings: r.backings.length, progressions: r.progressions.length, skipped: r.skipped });
  const libImport = new LibImport({
    root: $('#libimport'), getLibrary: () => save.library, getCloud: () => ({ enabled: cloud.enabled, state: cloud.state, lib: cloud.lib }), canOpen: () => ['play', 'title', 'stages'].includes(app.state) && !howto.isOpen,
    onPreview: (text) => { const d = decodeShare(text); return d.ok ? { ok: true, counts: countOf(sanitizeShared(d.data, chordNames)) } : d; },
    onImport: (text) => {
      const d = decodeShare(text);
      if (!d.ok) return d;
      const inc = sanitizeShared(d.data, chordNames);
      if (!inc.drums.length && !inc.backings.length && !inc.progressions.length) return { ok: false, error: '取り込める内容が、ありませんでした' };
      const m = mergeIntoLibrary(save.library, inc);
      save.library = m.lib; writeSave(save); app.library.reloadLocal();
      return { ok: true, added: m.added, updated: m.updated, full: m.full, skipped: inc.skipped };
    },
    onRemove: (kind, id) => { save.library = removeFromLibrary(save.library, kind, id); writeSave(save); app.library.reloadLocal(); },
    onOpen: () => {
      app.libPrev = app.state;
      if (app.input) app.input.cancel();
      if (app.state === 'play') { app.state = 'libimport'; hud.clearStamps(); screens.show('hud', 'libimport'); }
      else screens.show(app.state === 'stages' ? 'stages' : 'title', 'libimport');          // タイトル・ステージ選択の上に重ねる（状態は、そのまま。タイトルのデモも止まらない）
    },
    onClose: () => { screens.hide('libimport'); if (app.libPrev === 'play') returnToPlay(); },
  });
  app.libImport = libImport;
  // リンク（…/#lib=コード）から開かれたとき: 取り込みの画面を、内容を入れて開く（公開ページだけ）
  function openSharedLink() {
    const hash = location.hash || '';
    if (!app.device.offline || !hash.includes('lib=')) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 何もしない */ }
    libImport.open({ text: hash });
  }

  // ============================================================ 使い方（動く図で、操作と機能を説明する。タイトルの「使い方」・上のバーの「？」・? キー）
  const howto = new HowTo({
    root: $('#howto'), canOpen: () => ['play', 'title', 'stages'].includes(app.state) && !libImport.isOpen,          // 取り込みの画面が開いているときは、開かない（タイトル・ステージ選択の上には、重ねる画面は1つだけ）
    onOpen: () => {
      app.howtoPrev = app.state;
      if (app.input) app.input.cancel();
      if (!save.howtoSeen) { save.howtoSeen = true; writeSave(save); refreshHowtoMark(); }
      if (app.state === 'play') { app.state = 'howto'; hud.clearStamps(); screens.show('hud', 'howto'); }
      else screens.show(app.state === 'stages' ? 'stages' : 'title', 'howto');          // タイトル・ステージ選択の上に重ねる（状態は、そのまま。タイトルのデモも止まらない）
    },
    onClose: () => { screens.hide('howto'); if (app.howtoPrev === 'play') returnToPlay(); },
  });
  app.howto = howto;
  const refreshHowtoMark = () => $('#btn-howto-title').classList.toggle('attn', !save.howtoSeen);          // はじめてのとき、タイトルの「使い方」に印をつける
  refreshHowtoMark();

  // ============================================================ 技の詳細（技の枠・「技」の一覧の行・「理由」の「くわしく」を押すと開く）
  const trickDetail = new TrickDetail({
    root: $('#trickdetail'),
    onOpen: () => { if (app.input) app.input.cancel(); app.state = 'trickdetail'; hud.clearStamps(); screens.show('hud', 'trickdetail'); },
    onClose: () => { screens.hide('trickdetail'); returnToPlay(); },
  });
  app.trickDetail = trickDetail;
  hud.onOpenDetail = (ins) => { if (app.state === 'play') trickDetail.show(ins); };

  // ============================================================ 入力・実機
  const input = new Input({ scene, game, hud, table, canvas, audition: (id) => { if (app.engine && !app.muted) app.engine.audition(id); }, sfx: () => (app.muted ? null : app.sfx), enabled: () => app.state === 'play' && !(app.device && app.device.live),
    onLabel: (ins) => hud.openDetail(ins), canInspect: () => app.state === 'play',
    onContext: openChordMenu, isEditPick: () => app.editPick && app.state === 'play', onEditPick: startEdit, onEditPickCancel: () => setEditPick(false), onEditDrop: (id) => { if (game.mode === 'free') startEdit(id); } });
  input.attach();
  app.input = input;
  game.syncSource = () => (app.device && app.device.live ? app.device.latest : null);      // 実機の盤を見ているときは、ステージが変わっても、置いてある駒を盤に出す
  app.device = new DeviceLink({
    table,
    onBoard: (ids, opts) => { if (['play', 'title', 'pause', 'presets', 'studio', 'trickdetail', 'chordlab', 'libimport', 'result'].includes(app.state)) game.setBoard(ids, { source: opts && opts.sync ? 'device-sync' : 'device' }); },   // sync = 最初に、盤の全体をそろえるとき（試聴は鳴らさない）
    onStatus: (st) => {
      $('#device-state').textContent = st.label; $('#btn-device').classList.toggle('on', st.live);
      document.body.classList.toggle('device-live', st.live);
      const b = $('#btn-device-hud'); b.classList.toggle('on', st.live);
      $('#device-hud-state').textContent = st.live ? '実機' : st.connected && st.esp ? '画面' : '画面';
      b.title = st.live ? '実機の盤の駒で遊んでいます（クリックで画面の盤に切り替え）' : st.connected && st.esp ? '実機の盤があります（クリックで実機の盤に切り替え）' : '実機の盤はつながっていません';
      if (st.live !== app.lastLive) { app.lastLive = st.live; if (st.live) { hud.toast('実機の盤につながりました'); app.input && app.input.cancel(); } }
    },
  });
  app.device.onLibrary = (ev) => app.library.notify(ev);
  if (app.device.offline) document.body.classList.add('web-only');          // 公開ページ（https）: 実機のボタンは隠す（画面の盤だけ）
  $('#btn-device').addEventListener('click', () => { if (app.device.needsBridge) { app.device.connectBridge(); hud.toast('ブリッジを ESP32 につないでいます…'); } else app.device.toggle(); });
  $('#btn-device-hud').addEventListener('click', () => { if (app.device.needsBridge) { app.device.connectBridge(); hud.toast('ブリッジを ESP32 につないでいます…'); } else app.device.toggle(); });

  // ============================================================ 起動
  async function begin(withAudio) {
    if (app.state !== 'splash') return;
    if (withAudio) {
      $('#btn-start').classList.add('hidden');
      try { await startAudio(); } catch (e) { console.error(e); hud.toast('音を読み込めませんでした。音なしで続けます'); }
    }
    app.device.start();
    app.library.start();
    startCloud();
    showTitle();
    openSharedLink();
  }
  app.begin = begin; app.startStage = startStage; app.showTitle = showTitle; app.showStages = showStages;
  window.__stages = STAGES; window.__free = () => FREE_STAGE; window.__challenge = () => CHALLENGE_STAGE; window.__melodies = MELODY_STAGES;
  app.showMelodies = showMelodies; app.showTrials = showTrials; window.__trials = TRIAL_STAGES;
  hud.onTrialDone = finishTrial;

  bindButtons();
  hud.setCollection(game.collection());
  screens.show('splash');
  // 背景に、ゆっくり進む盤を置いておく（起動の画面）
  ['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'].forEach((n, i) => scene.setPiece(i, table.byName(n), { animate: false }));

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (app.engine && app.engine.ctx.state === 'running') for (const e of app.engine.pollEvents()) handleAudioEvent(e);
    if (app.engine && app.engine.scrub) app.engine.scrubTick(now);                       // シークバーを動かしていない間は、巻き戻しの音を、消していく
    seekbar.update(seekInfo());
    if (!app.paused) game.tick(dt);
    if (melodyView.visible) {                                                          // メロディの帯の、再生位置の線
      const en = app.engine;
      if (en && en.playing && en.ctx.state === 'running' && game.mode === 'melody') melodyView.setPlayhead(en.loopSlotAt(en.ctx.currentTime - (en.ctx.outputLatency || 0)) / 64);
      else melodyView.setPlayhead(null);
    }
    if (studio.isOpen) {                                                               // メロディの画面の、再生位置の線
      const en = app.engine;
      studio.setPlayhead(en && en.playing && en.ctx.state === 'running' ? en.loopSlotAt(en.ctx.currentTime - (en.ctx.outputLatency || 0)) / 64 : null);
    }
    scene.render(dt);
    window.__frames = (window.__frames || 0) + 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__ready = true;
}

main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:10px;top:10px;color:#f88;z-index:99;white-space:pre-wrap">${String(e.stack || e)}</pre>`); window.__error = String(e.stack || e); });
