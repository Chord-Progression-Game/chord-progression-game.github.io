// ゲームの音（ブラウザの Web Audio）。実機の演奏（ファームの groove.cpp）と、同じ規則で鳴らす:
//   ・1ステップ = 2拍 = 16分音符 8マス。8ステップで1周（位置1→8）。BPM 120 なら 1ステップ 1秒
//   ・ステップの始まりに、その位置の駒（「→」・空きの解決を含む）から、和音を決める。駒の入れ替えは、次のステップから効く
//   ・和音の高さは、ループ全体を見て決める（ボイスリーディング。core/voicing.js の planVoicing。強進行は 4度上か 5度下・終止は 5度下を優先。最初のコードは本来の高さ）
//   ・バッキング（和音の鳴らし方）とドラムは、プリセット（game/data/presets.json = ファームと同じ）のマスの文字で決まる
// 時計は、画面ではなく、音の時計（AudioContext の currentTime）。少し先まで予約して鳴らすので、ずれない。
// 本物の AudioContext でも、OfflineAudioContext（テスト用に、音を出さずに書き出す）でも、同じコードで動く。

import { voiceChord, voiceChordAt, planVoicing, planSmoothVoicing, liftFor, resolveChordAtStep, SMOOTH_MODES, BASE_C_DEFAULT, OCTAVE_DEFAULT } from '../core/voicing.js';
import { playSynth, INSTRUMENT_IDS } from './instruments.js';

export const SLOTS_PER_STEP = 8;       // 1ステップ = 16分音符 8つ
export const NUM_STEPS = 8;
export const LOOP_SLOTS = SLOTS_PER_STEP * NUM_STEPS;
const GATE = 0.95;                     // 音の長さのうち、何%で止めるか（ファームと同じ）
const LOOKAHEAD = 0.14;                // 何秒先まで予約するか
// 画面の「音量」（0〜100%）と、ミュートから、全体の大きさ（マスターのゲイン）を決める。
// 2026-11-24 から、バーの目盛りを、2倍の見かたにした（ご指定: はじめの値を 50% にして、そのかわり、全部の音量を半分に = 出音は、変えない）。
//   バーの 100% = これまでの 50% の大きさ（VOLUME_TOP = 0.5）。はじめの値 50% = これまでの 25% と、同じ出音
// バーは、耳に自然なように、2乗の曲線（バーの 50% で、100% の、およそ −12dB）。ミュートは 0
export function masterGainFor(percent, muted = false) {
  const p = (Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 100)) / 100) * VOLUME_TOP;
  return muted ? 0 : MASTER_GAIN * p * p;
}
export const MASTER_GAIN = 1.35;       // 全体の大きさ（ノートパソコンのスピーカーでも、聞こえるように。割れないよう、最後にリミッターが入っている）。音量のバー（masterGainFor）の「これまでの 100%」の大きさ
export const VOLUME_TOP = 0.5;         // バーの 100% が、これまでの何% の大きさか（2026-11-24）
const TIMER_MS = 25;
export const DRUM_BUS_GAIN = 0.57;    // ドラムの音の通り道の大きさ（ピアノ 0.9・メロディ 0.9 に対して）
const MELODY_GATE = 0.97;              // メロディの音の長さのうち、何%で止めるか（なめらかにつなぐ）
const MELODY_VELOCITY = 86;
const AUDITION_DUCK = 0.34;            // 演奏中（ほかのコードが鳴っている間）の試聴は、音の強さをこの倍に下げる（およそ -12dB）。ぶつかって不協和になるのを防ぐ

// ピアノの音源（Salamander Grand Piano）。ファイル名 → MIDI ノート番号
const PIANO_FILES = { C2: 36, Ds2: 39, Fs2: 42, A2: 45, C3: 48, Ds3: 51, Fs3: 54, A3: 57, C4: 60, Ds4: 63, Fs4: 66, A4: 69,
  C5: 72, Ds5: 75, Fs5: 78, A5: 81, C6: 84, Ds6: 87, Fs6: 90, A6: 93, C7: 96 };
// ドラムの音源（GM のドラムキット。GeneralUser GS）。レーンの文字 → ファイル名
const DRUM_FILES = { K: 'kick', S: 'snare', P: 'sidestick', H: 'hat_closed', O: 'hat_open', C: 'clap', R: 'ride', X: 'crash' };
const DRUM_VELOCITY = { o: 45, x: 85, X: 112 };                // ファームと同じ（弱く・ふつう・強く）
const BACKING_VELOCITY = { hard: 80, soft: 55 };

export class AudioEngine {
  constructor(ctx, table, presets) {
    this.ctx = ctx;
    this.table = table;
    this.presets = presets;
    this.bpm = 120;
    this.octave = OCTAVE_DEFAULT;
    this.voiceLeading = true;
    this.voicingMode = 'off';                                         // 和音のつなぎ方: 'off'（ふつう）/ 'mid'（スムーズ・中）/ 'high'（スムーズ・大）。core/voicing.js の planSmoothVoicing
    this.backingId = 1;                // ロング
    this.drumId = 2;                   // 8ビート
    this.getBoard = () => Array(NUM_STEPS).fill(null);
    this.getSplit = () => Array(NUM_STEPS).fill(null);                // 分割したマスの、後半のコードの ID（なければ null）
    this.instrumentId = 'piano';              // コードを鳴らす音色（instruments.js）。ステージ・画面から変える
    this.refTime = 0; this.refSlot = 0;       // 拍の位置を求める基準（その時刻に、そのマスが鳴る）。BPM が変わったら、取り直す
    this.wantLoopSteps = () => NUM_STEPS;     // 次の周回を、何ステップ（4 か 8）にするか。呼ぶ側（app）が、ステージの種類と盤の駒から決める
    this.loopSteps = NUM_STEPS;               // いまの周回のステップ数
    this.loopStart = 0;                       // いまの周回が始まったマスの通し番号
    this.playing = false;
    this.slotIndex = 0;
    this.nextTime = 0;
    this.cur = null;                   // いま鳴っているステップの { step, chordId, chord, voice }
    this.lastRoot = -1;
    this.events = [];                  // 画面に知らせる出来事（時刻つき）。pollEvents() で受け取る
    this.pianoBuffers = [];            // [{ note, buffer }]（低い順）
    this.drumBuffers = {};
    this._timer = null;
    this._openHat = null;
    this.lastBeatTime = undefined;
    this.onStepScheduled = null;       // ステップの始まりを予約したとき（音の時刻つき）に呼ばれる。効果音を、その時刻に合わせるのに使う
    this.melody = null;                // 流れているメロディ（「メロディにコードをつける」ステージ）。{ notes: [[開始のマス, 長さ, MIDI], ...] }。8ステップの周回のときだけ鳴る
    this._melodyByStart = new Map();   // 開始のマス → そのマスで始まる音
    this._buildGraph();
  }

  // ---------- 音の通り道 ----------
  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = MASTER_GAIN;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.knee.value = 14; this.comp.ratio.value = 3.4; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    // 最後に、音が割れないための、ごく速い歯止め（リミッター）
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.09;
    this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; this.limiter.connect(this.analyser);
    this.pianoBus = ctx.createGain(); this.pianoBus.gain.value = 0.9;
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = DRUM_BUS_GAIN;            // ドラムは、伴奏・メロディより少し小さく（2026-11-24 に、0.8 → 0.57 = 約 −3dB。ご指摘: ドラムが大きい）
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.7;
    this.melodyBus = ctx.createGain(); this.melodyBus.gain.value = 0.9;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.2);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 1.0;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.pianoSend = ctx.createGain(); this.pianoSend.gain.value = 0.22;
    this.drumSend = ctx.createGain(); this.drumSend.gain.value = 0.07;
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.35;
    this.melodySend = ctx.createGain(); this.melodySend.gain.value = 0.2;
    this.pianoBus.connect(this.master); this.pianoBus.connect(this.pianoSend); this.pianoSend.connect(this.reverb);
    this.drumBus.connect(this.master); this.drumBus.connect(this.drumSend); this.drumSend.connect(this.reverb);
    this.sfxBus.connect(this.master); this.sfxBus.connect(this.sfxSend); this.sfxSend.connect(this.reverb);
    this.melodyBus.connect(this.master); this.melodyBus.connect(this.melodySend); this.melodySend.connect(this.reverb);
    // 演奏中の試聴: 高い音をやわらかく削って、ほかのコードの後ろに、そっと置く
    this.duckFilter = ctx.createBiquadFilter(); this.duckFilter.type = 'lowpass'; this.duckFilter.frequency.value = 2200; this.duckFilter.Q.value = 0.5;
    this.duckFilter.connect(this.pianoBus);
    this.session = null;
  }

  setVolumes({ master, piano, drums, sfx, melody } = {}) {
    const t = this.ctx.currentTime;
    if (master !== undefined) this.master.gain.setTargetAtTime(master, t, 0.02);
    if (piano !== undefined) this.pianoBus.gain.setTargetAtTime(piano, t, 0.02);
    if (drums !== undefined) this.drumBus.gain.setTargetAtTime(drums, t, 0.02);
    if (sfx !== undefined) this.sfxBus.gain.setTargetAtTime(sfx, t, 0.02);
    if (melody !== undefined) this.melodyBus.gain.setTargetAtTime(melody, t, 0.02);
  }

  // ---------- 音源の読み込み ----------
  async load(baseUrl = './audio/', onProgress = null) {
    const total = Object.keys(PIANO_FILES).length + Object.keys(DRUM_FILES).length;
    let done = 0;
    const get = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`音源を読み込めません: ${url} (${res.status})`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      done++; if (onProgress) onProgress(done / total);
      return buf;
    };
    const piano = Object.entries(PIANO_FILES).map(async ([name, note]) => ({ note, buffer: await get(`${baseUrl}piano/${name}.mp3`) }));
    const drums = Object.entries(DRUM_FILES).map(async ([lane, file]) => [lane, await get(`${baseUrl}drums/${file}.wav`)]);
    this.pianoBuffers = (await Promise.all(piano)).sort((a, b) => a.note - b.note);
    this.drumBuffers = Object.fromEntries(await Promise.all(drums));
    return this;
  }

  // ---------- 1つの音 ----------
  // dest を省くと、ピアノのバス。duration は、鳴らし続ける秒数（そのあと、少しずつ消える）
  playPianoNote(note, when, duration, velocity, dest = this.pianoBus) {
    if (!this.pianoBuffers.length) return;
    let best = this.pianoBuffers[0];
    for (const p of this.pianoBuffers) if (Math.abs(p.note - note) < Math.abs(best.note - note)) best = p;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = best.buffer;
    src.playbackRate.value = Math.pow(2, (note - best.note) / 12);
    const g = ctx.createGain();
    const peak = 0.62 * Math.pow(Math.max(1, velocity) / 100, 1.35);
    const end = when + Math.max(0.06, duration);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.004);
    g.gain.setValueAtTime(peak, end);
    g.gain.setTargetAtTime(0, end, 0.085);                          // 手を離したときの、消え方
    src.connect(g); g.connect(this._sessionNode(dest));
    src.start(when); src.stop(end + 0.7);
  }

  playDrum(lane, when, level = 'x', dest = this.drumBus) {
    const buf = this.drumBuffers[lane];
    if (!buf) return;
    const ctx = this.ctx;
    if (lane === 'H' && this._openHat) {                            // 閉じたハイハットは、開いたハイハットを止める
      try { this._openHat.gain.cancelScheduledValues(when); this._openHat.gain.setTargetAtTime(0, when, 0.012); } catch (e) { /* 何もしない */ }
      this._openHat = null;
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    const vel = DRUM_VELOCITY[level] || 85;
    g.gain.value = Math.min(1.25, Math.pow(vel / 100, 1.2));
    src.connect(g); g.connect(this._sessionNode(dest));
    src.start(when);
    if (lane === 'O') this._openHat = g;
  }

  // 止めたとき、鳴っている音をまとめて消せるように、「演奏ごとの出口」を挟む
  _sessionNode(dest) {
    if (dest !== this.pianoBus && dest !== this.drumBus && dest !== this.melodyBus) return dest;
    if (!this.session) this.session = this._newSession();
    return dest === this.pianoBus ? this.session.piano : dest === this.drumBus ? this.session.drums : this.session.melody;
  }
  _newSession() {
    const piano = this.ctx.createGain(), drums = this.ctx.createGain(), melody = this.ctx.createGain();
    piano.connect(this.pianoBus); drums.connect(this.drumBus); melody.connect(this.melodyBus);
    return { piano, drums, melody };
  }

  // 試聴の音の強さの倍率。演奏が進んでいて、いまコードが鳴っている間は、小さく（ほかのコードと、ぶつからないように）。それ以外は 1
  auditionLevel() { return this.playing && this.cur ? AUDITION_DUCK : 1; }

  // 1つの和音を、すぐ鳴らす（試聴用）。駒を選んだときなど。
  //   演奏中は、音を小さく・短く・やわらかくする（ほかのコードが鳴っているところへ、駒のコードが重なると、不協和音になりやすいため）
  audition(chordId, when = this.ctx.currentTime + 0.02, duration = 1.1) {
    const chord = this.table.byId(chordId);
    if (!chord || chord.isRepeat) return;
    const level = this.auditionLevel();
    const ducked = level < 1;
    const v = voiceChord(chord, BASE_C_DEFAULT + 12 * this.octave, -1, false);
    v.notes.forEach((n, i) => this.playNote(n, when + i * 0.012, ducked ? duration * 0.55 : duration, (78 - i * 3) * level, ducked ? this.duckFilter : this.pianoBus, { idx: i, chord: true }));
  }

  // 好きな音の組（MIDI ノート）を、すぐ鳴らす（コードの編集画面の試聴）。arpeggio: 低い音から、ばらして鳴らす。単音のときは、1つだけ
  auditionNotes(notes, { when = this.ctx.currentTime + 0.02, duration = 1.1, arpeggio = false } = {}) {
    const list = [...notes].sort((a, b) => a - b);
    const level = this.auditionLevel();
    const ducked = level < 1;
    list.forEach((n, i) => this.playNote(n, when + i * (arpeggio ? 0.16 : 0.012), ducked ? duration * 0.55 : duration, (78 - Math.min(i, 8) * 3) * level, ducked ? this.duckFilter : this.pianoBus, { idx: i, chord: list.length > 1 }));
  }

  // ---------- メロディ ----------
  // 流れるメロディを、決める（null でなくす）。8ステップの周回のときだけ、鳴る。いま鳴っている音は、そのまま
  setMelody(melody) {
    this.melody = melody || null;
    this._melodyByStart = new Map();
    if (!melody) return;
    for (const n of melody.notes) { const list = this._melodyByStart.get(n[0]); if (list) list.push(n); else this._melodyByStart.set(n[0], [n]); }
  }
  // メロディの1つの音（MIDI ノート番号 note）を、時刻 when から、duration 秒、鳴らす
  playLead(note, when, duration, velocity = MELODY_VELOCITY) {
    playSynth(this, 'lead', { note, when, dur: duration, vel: velocity, dest: this._sessionNode(this.melodyBus), idx: 0, chord: false });
  }
  // 時刻 t は、8ステップの周回の、何マス目か（小数。0〜64）。メロディの帯の、再生位置の表示に使う
  loopSlotAt(t) {
    const slots = this.refSlot + (t - this.refTime) / this.slotSeconds();
    return ((slots % LOOP_SLOTS) + LOOP_SLOTS) % LOOP_SLOTS;
  }

  // ---------- 時計 ----------
  slotSeconds() { return 60 / this.bpm / 4; }
  stepSeconds() { return this.slotSeconds() * SLOTS_PER_STEP; }

  setBpm(bpm) {
    if (this.playing) { this.refTime = this.nextTime; this.refSlot = this.slotIndex; }    // いま予約したところを基準にして、拍の位置が、ずれないようにする
    this.bpm = Math.max(30, Math.min(240, Math.round(bpm)));
  }

  // 音色を変える（鳴っている音は、そのまま。次の音から変わる）。知らない名前なら、何もしない
  setInstrument(id) { if (!INSTRUMENT_IDS.includes(id) || id === this.instrumentId) return false; this.instrumentId = id; return true; }

  // 時刻 t は、拍の何個ぶん進んだところか（整数 = 拍の頭。1拍 = 4マス）。ドライブシンセの「サイドチェイン」が使う
  beatPosition(t) { return (this.refSlot + (t - this.refTime) / this.slotSeconds()) / 4; }

  // いまの音色で、1つの音を鳴らす（ピアノは録音、ほかは合成）。dest を省くと、ピアノのバス
  playNote(note, when, duration, velocity, dest = this.pianoBus, opts = {}) {
    if (this.instrumentId === 'piano') return this.playPianoNote(note, when, duration, velocity, dest);
    return playSynth(this, this.instrumentId, { note, when, dur: duration, vel: velocity, dest: this._sessionNode(dest), idx: opts.idx || 0, chord: !!opts.chord });
  }
  setPatterns({ drumId, backingId } = {}) {
    if (drumId !== undefined) this.drumId = drumId;
    if (backingId !== undefined) this.backingId = backingId;
  }
  _drum() { return this.drumId ? this.presets.drums.find((d) => d.id === this.drumId) : null; }
  _backing() { return this.backingId ? this.presets.backings.find((b) => b.id === this.backingId) : null; }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.slotIndex = 0; this.lastRoot = -1; this.cur = null;
    this.loopStart = 0; this.loopSteps = this._wantedSteps();
    this.session = this._newSession();
    this.nextTime = this.ctx.currentTime + 0.12;
    this.refTime = this.nextTime; this.refSlot = 0;
    this.events.length = 0;
    this._tick();
    this._timer = setInterval(() => this._tick(), TIMER_MS);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this._timer); this._timer = null;
    const t = this.ctx.currentTime;
    if (this.session) {                                             // 鳴っている音を、すっと消す
      const old = this.session;
      old.piano.gain.setTargetAtTime(0, t, 0.04); old.drums.gain.setTargetAtTime(0, t, 0.04); old.melody.gain.setTargetAtTime(0, t, 0.04);
      setTimeout(() => { try { old.piano.disconnect(); old.drums.disconnect(); old.melody.disconnect(); } catch (e) { /* 何もしない */ } }, 700);
      this.session = null;
    }
    this.cur = null;
    this.events.push({ type: 'stop', time: t });
  }

  _tick() {
    const now = this.ctx.currentTime;
    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleSlot(this.slotIndex, this.nextTime);
      this.nextTime += this.slotSeconds();
      this.slotIndex++;
    }
  }

  // 16分音符の1マスを、時刻 when に予約する（テストでは、これを直接くり返し呼んで、書き出す）
  scheduleSlot(slotIndex, when) {
    // 周回の境目で、次の周回の長さを決める（駒が4つ以内なら、4ステップでループ。待ち時間をなくす）
    if (slotIndex === 0) { this.loopStart = 0; this.loopSteps = this._wantedSteps(); }
    else if (slotIndex - this.loopStart >= this.loopSteps * SLOTS_PER_STEP) { this.loopStart = slotIndex; this.loopSteps = this._wantedSteps(); }
    const slotInLoop = slotIndex - this.loopStart;
    const step = Math.floor(slotInLoop / SLOTS_PER_STEP);
    const slotInStep = slotInLoop % SLOTS_PER_STEP;
    if (slotInStep === 0) this._beginStep(step, when);
    else if (slotInStep === SLOTS_PER_STEP / 2 && this._secondHalf(step) !== null) this._beginHalf(step, when);          // 分割したマス: 2拍目の頭で、後半のコードに切りかえる
    if (slotInStep % 4 === 0) { this.events.push({ type: 'beat', time: when, step, beat: slotInStep / 4 }); this.lastBeatTime = when; }

    const backing = this._backing();
    if (backing && this.cur) {
      const idx = slotInLoop % backing.length;
      let cell = parseCell(backing.cells[idx]);
      const split = this._secondHalf(step) !== null;                                     // このマスは、分割している（前半・後半）
      const halfStart = split && slotInStep === SLOTS_PER_STEP / 2;
      let carried = false;
      if (halfStart && !cell.hit) {                                                     // 2拍目の頭に、パターンの音がないとき: 1拍目に鳴らした音（和音・ベース・…）を、後半のコードで鳴らし直す（そうしないと、後半が無音になる）
        for (let k = 1; k <= SLOTS_PER_STEP / 2; k++) { const c = parseCell(backing.cells[(((idx - k) % backing.length) + backing.length) % backing.length]); if (c.hit) { cell = c; carried = true; break; } }
      }
      if (cell.hit) {
        const stepEnd = split && slotInStep < SLOTS_PER_STEP / 2 ? SLOTS_PER_STEP / 2 : SLOTS_PER_STEP;       // 分割したマスの前半: 音は、2拍目の頭までで切る（後半のコードに、かぶらないように）
        const hold = carried ? stepEnd - slotInStep : holdSlots(backing.cells, idx, stepEnd - slotInStep);
        const dur = hold * this.slotSeconds() * GATE;
        const vel = cell.soft ? BACKING_VELOCITY.soft : BACKING_VELOCITY.hard;
        const notes = this._notesFor(cell.shape);
        notes.forEach((note, i) => this.playNote(note, when, dur, vel, this.pianoBus, { idx: i, chord: notes.length > 1 }));
      }
    }
    const drum = this._drum();
    if (drum) {
      const idx = slotInLoop % drum.length;
      for (const [lane, text] of Object.entries(drum.lanes)) {
        const c = text[idx];
        if (c !== '.' && c !== undefined) this.playDrum(lane, when, c);
      }
    }
    // メロディ（8ステップの周回のときだけ。4ステップでループするチュートリアルでは、鳴らさない）
    if (this.melody && this.loopSteps === NUM_STEPS) {
      const list = this._melodyByStart.get(slotInLoop);
      if (list) for (const [, len, midi] of list) this.playLead(midi, when, Math.min(len, LOOP_SLOTS - slotInLoop) * this.slotSeconds() * MELODY_GATE);
    }
  }

  _wantedSteps() { const n = this.wantLoopSteps(); return n === 4 ? 4 : NUM_STEPS; }

  // 分割したマスの、後半のコードの ID。分割していなければ null
  _secondHalf(step) {
    const sp = this.getSplit();
    const id = sp ? sp[step] : null;
    return id === null || id === undefined || !this.table.byId(id) || this.table.byId(id).isRepeat ? null : id;
  }

  // ループ全体の、ルートの高さの計画（2026-11-24）。盤・分割・高さ・ボイスリーディング・周回のステップ数が変わらないあいだは、使いまわす
  _voicePlan() {
    const board = this.getBoard(), split = this.getSplit();
    const baseC = BASE_C_DEFAULT + 12 * this.octave, steps = Math.min(this.loopSteps || board.length, board.length);
    const key = `${board.join(',')}|${split ? split.join(',') : ''}|${baseC}|${steps}|${this.voiceLeading ? 1 : 0}|${this.voicingMode}`;
    if (this._planKey !== key) {
      this._planKey = key;
      const roots = planVoicing(board, this.table, { baseC, split, steps, enabled: this.voiceLeading });
      // スムーズボイスリーディング（中・大）: 前の和音の音から、動きが少なくなるように、つなぐ（決めなかった和音は、ふつうの高さ）
      const smooth = this.voicingMode !== 'off' ? planSmoothVoicing(board, this.table, { baseC, split, steps, mode: this.voicingMode, roots }) : null;
      const plan = Object.assign({}, roots, { smooth, lift: 0 });
      // 低すぎる進行（和音の音に、C1 = MIDI 36 以下がある）は、進行ぜんぶを1オクターブ上げる（voicing.js の LOW_LIMIT）
      const voices = [];
      for (let k = 0; k < steps; k++) {
        const id = resolveChordAtStep(board, k, this.table, split);
        if (id !== null) { const c = this.table.byId(id); voices.push(this._rawVoice(c, roots.first[k], (smooth ? smooth.first[k] : null), baseC)); }
        const sid = split ? split[k] : null;
        if (sid !== null && sid !== undefined && this.table.byId(sid) && !this.table.byId(sid).isRepeat) voices.push(this._rawVoice(this.table.byId(sid), roots.second[k], (smooth ? smooth.second[k] : null), baseC));
      }
      plan.lift = liftFor(voices);
      this._plan = plan;
    }
    return this._plan;
  }

  // 和音の音（高さを上げる前）。スムーズボイスリーディングで決めたものがあれば、それ。なければ、計画のルートの、ふつうの高さ
  _rawVoice(chord, root, smoothVoice, baseC) {
    return smoothVoice || voiceChordAt(chord, root === null || root === undefined ? baseC + chord.rootPc : root, baseC);
  }

  // 実際に鳴らす和音（高さを上げる前の音 + 進行全体の「1オクターブ上げる」）
  _voiceFor(chord, root, smoothVoice, baseC) {
    const v = this._rawVoice(chord, root, smoothVoice, baseC), lift = this._voicePlan().lift || 0;
    return lift ? { root: v.root + lift, notes: v.notes.map((m) => m + lift), shift: v.shift + lift } : v;
  }

  // 和音のつなぎ方（'off' / 'mid' / 'high'）
  setVoicing(mode) { this.voicingMode = SMOOTH_MODES.includes(mode) ? mode : 'off'; }

  // 分割したマスの、2拍目の頭: 後半のコードに切りかえる（高さは、ループ全体の計画で決まっている）
  _beginHalf(step, when) {
    const id = this._secondHalf(step);
    const chord = this.table.byId(id);
    const baseC = BASE_C_DEFAULT + 12 * this.octave;
    const plan = this._voicePlan();
    const voice = this._voiceFor(chord, plan.second[step], plan.smooth ? plan.smooth.second[step] : null, baseC);
    this.lastRoot = voice.root;
    this.cur = { step, chordId: id, chord, voice, half: 1 };
    this.events.push({ type: 'half', time: when, step, chordId: id, notes: voice.notes });          // 技の「きらっ」（onStepScheduled）は、ステップの頭だけ（2回鳴らさない）
  }

  _beginStep(step, when) {
    const board = this.getBoard();
    const id = resolveChordAtStep(board, step, this.table, this.getSplit());
    if (step === 0) this.lastRoot = -1;                              // 位置1に戻ったら、前のコードの高さは忘れる（最初のコードは、いつも本来の高さ。計画も、そこから始まる）
    if (id !== null) {
      const chord = this.table.byId(id);
      const baseC = BASE_C_DEFAULT + 12 * this.octave;
      const plan = this._voicePlan();                              // ループ全体を見て決めた高さ（強進行は、4度上か 5度下。終止は、5度下を優先）
      const voice = this._voiceFor(chord, plan.first[step], plan.smooth ? plan.smooth.first[step] : null, baseC);
      this.lastRoot = voice.root;
      this.cur = { step, chordId: id, chord, voice };
    } else {
      this.cur = null;                                               // 休み（ドラムは、そのまま鳴る）
    }
    const info = { type: 'step', time: when, step, chordId: id, rawId: board[step], notes: this.cur ? this.cur.voice.notes : [] };
    this.events.push(info);
    if (this.onStepScheduled) this.onStepScheduled(info);
  }

  _notesFor(shape) {
    const c = this.cur;
    const notes = c.voice.notes;
    let bass = c.voice.root - 12;                                    // ベースは、ルートの1オクターブ下（C2 = 36 より下は、1オクターブ上げる）
    if (bass >= 0 && bass < 36) bass += 12;
    switch (shape) {
      case 'chord': return notes;
      case 'bass': return bass >= 0 ? [bass] : [];
      case 'bassChord': return (bass >= 0 ? [bass] : []).concat(notes);
      default: {                                                     // tone1〜tone4: 和音の n 番目の音を1つ
        const index = Number(shape.slice(4)) - 1;
        return [index < notes.length ? notes[index] : c.voice.root + 12];
      }
    }
  }

  // 次の拍の時刻（技の効果音を、拍に合わせるのに使う）。止まっているときは、すぐ
  nextBeatTime(minAhead = 0.05) {
    const now = this.ctx.currentTime;
    if (!this.playing || this.lastBeatTime === undefined) return now + 0.03;
    const bs = this.slotSeconds() * 4;
    let t = this.lastBeatTime;
    while (t < now + minAhead) t += bs;
    return t;
  }

  // 画面が、「音の時計で、もう過ぎた出来事」を受け取る（毎フレーム呼ぶ）
  pollEvents() {
    const now = this.ctx.currentTime;
    const due = [];
    const rest = [];
    for (const e of this.events) (e.time <= now + 0.005 ? due : rest).push(e);
    this.events = rest;
    return due;
  }

  // 音の大きさ（0〜1）。画面の光り方に使う
  getLevel() {
    if (!this._lv) this._lv = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(this._lv);
    let sum = 0;
    for (let i = 0; i < this._lv.length; i++) { const v = (this._lv[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / this._lv.length) * 3.2);
  }

  // ---------- テスト用: 音を出さずに、秒数ぶんを書き出す ----------
  // 戻り値: AudioBuffer。OfflineAudioContext を使うので、ctx はテスト側で作って、このクラスに渡しておくこと
  async renderOffline(seconds) {
    this.playing = true; this.slotIndex = 0; this.lastRoot = -1; this.cur = null; this.events.length = 0;
    this.loopStart = 0; this.loopSteps = this._wantedSteps();
    this.refTime = 0.02; this.refSlot = 0;
    const slots = Math.ceil(seconds / this.slotSeconds());
    for (let i = 0; i < slots; i++) this.scheduleSlot(i, 0.02 + i * this.slotSeconds());
    return this.ctx.startRendering();
  }
}

// ---------- パターンの文字（ファームの rhythm.cpp の backingParseCell / backingHoldSlots と同じ）----------
export function parseCell(ch) {
  switch (ch) {
    case 'C': return { hit: true, shape: 'chord', soft: false };
    case 'c': return { hit: true, shape: 'chord', soft: true };
    case 'B': return { hit: true, shape: 'bass', soft: false };
    case 'b': return { hit: true, shape: 'bass', soft: true };
    case 'D': return { hit: true, shape: 'bassChord', soft: false };
    case 'd': return { hit: true, shape: 'bassChord', soft: true };
    case '1': case '2': case '3': case '4': return { hit: true, shape: `tone${ch}`, soft: false };
    default: return { hit: false };
  }
}
export function holdSlots(cells, index, maxSlots) {
  let hold = 1;
  for (let i = index + 1; i < cells.length && cells[i] === '-'; i++) hold++;
  return Math.max(1, Math.min(hold, maxSlots));
}

// 響き（リバーブ）の元になる、ほのかに暗い、消えていく音
function makeImpulse(ctx, seconds) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  let seed = 12345;                                                  // 毎回同じ響きにする（テストが安定する）
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (rnd() - lp) * (0.55 - 0.45 * t);                        // だんだん、高い音から消える
      d[i] = lp * Math.pow(1 - t, 2.6) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
    }
  }
  return buf;
}
