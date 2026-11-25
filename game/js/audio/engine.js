// ゲームの音（ブラウザの Web Audio）。実機の演奏（ファームの groove.cpp）と、同じ規則で鳴らす:
//   ・1ステップ = 2拍 = 16分音符 8マス。8ステップで1周（位置1→8）。BPM 120 なら 1ステップ 1秒
//   ・ステップの始まりに、その位置の駒（「→」・空きの解決を含む）から、和音を決める。駒の入れ替えは、次のステップから効く
//   ・和音の高さは、ループ全体を見て決める（ボイスリーディング。core/voicing.js の planVoicing。強進行は 4度上か 5度下・終止は 5度下を優先。最初のコードは本来の高さ）
//   ・バッキング（和音の鳴らし方）とドラムは、プリセット（game/data/presets.json = ファームと同じ）のマスの文字で決まる
// 時計は、画面ではなく、音の時計（AudioContext の currentTime）。少し先まで予約して鳴らすので、ずれない。
// 本物の AudioContext でも、OfflineAudioContext（テスト用に、音を出さずに書き出す）でも、同じコードで動く。

import { voiceChord, voiceChordAt, planVoicing, planSmoothVoicing, liftFor, resolveChordAtStep, SMOOTH_MODES, BASE_C_DEFAULT, OCTAVE_DEFAULT } from '../core/voicing.js';
import { playSynth, INSTRUMENT_IDS } from './instruments.js';
import { ScrubSound, snapSlot, SCRUB_MAX_SPEED } from './scrub.js';

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
const RESUME_DELAY = 0.05;             // シークバーをはなしてから、続きの演奏が始まるまで（秒）
export const DRUM_BUS_GAIN = 0.57;    // ドラムの音の通り道の大きさ（ピアノ 0.9・メロディ 0.9 に対して）
export const PIANO_BUS_GAIN = 0.9;     // バッキング（和音）の音の通り道の大きさ
// ドラム・バッキングの音量のバー（0〜100%）。はじめの値 50% = 上の標準の大きさ（これまでと同じ出音）。100% = その 2倍（+6dB）・0% = 無音
// （全体のバーと同じく、はじめの値の上にも、余裕を残した）
export const MIX_DEFAULT = 50;
export function mixGainFor(percent) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : MIX_DEFAULT));
  return p / MIX_DEFAULT;
}
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
    this.scrub = null;                 // シークバーをつかんで動かしている間: { pos（周回の何マス目か。小数）, len（周回のマス数）, v（動く速さ。マス/秒）, … }。そのあいだ、演奏は止まる
    this.scrubSound = null;            // 巻き戻しの音（audio/scrub.js）
    this._loops = [];                  // 周回の始まりの記録 [{ start（マスの通し番号）, steps }]。いまの位置が、周回の何マス目かを知るのに使う
    this._resumeSlot = null;           // シークのあと、最初に鳴らすマス（そこで、鳴っているはずの音を、つづきから鳴らす）
    this._seekHold = null;             // シークのあと、続きの演奏が始まる（when）まで、位置を、この位置に止めておく { slot, len, until }（印が、一瞬、後ろにもどらないように）
    this.cueSlot = 0;                  // 演奏を止めているあいだの位置（周回の何マス目か）。シークバーで動かせる。つぎに演奏を始めるとき、ここから始まる（止めると、0 にもどる）
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
    this.pianoBus = ctx.createGain(); this.pianoBus.gain.value = PIANO_BUS_GAIN;       // バッキング（演奏中の和音）。音量のメニューの「バッキング」
    this.auditionBus = ctx.createGain(); this.auditionBus.gain.value = PIANO_BUS_GAIN; // 試聴（駒を置いたとき・編集画面）。バッキングの音量とは別（バーを 0 にしても、駒の音は聞こえる）
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = DRUM_BUS_GAIN;            // ドラムは、伴奏・メロディより少し小さく（2026-11-24 に、0.8 → 0.57 = 約 −3dB。ご指摘: ドラムが大きい）
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.7;
    this.melodyBus = ctx.createGain(); this.melodyBus.gain.value = 0.9;
    this.scrubBus = ctx.createGain(); this.scrubBus.gain.value = 0.7;                  // シークバーの巻き戻しの音（リバーブなし。全体の音量・ミュートは効く）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.2);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 1.0;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.pianoSend = ctx.createGain(); this.pianoSend.gain.value = 0.22;
    this.drumSend = ctx.createGain(); this.drumSend.gain.value = 0.07;
    this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.35;
    this.melodySend = ctx.createGain(); this.melodySend.gain.value = 0.2;
    this.pianoBus.connect(this.master); this.pianoBus.connect(this.pianoSend); this.pianoSend.connect(this.reverb);
    this.auditionBus.connect(this.master); this.auditionBus.connect(this.pianoSend);
    this.drumBus.connect(this.master); this.drumBus.connect(this.drumSend); this.drumSend.connect(this.reverb);
    this.sfxBus.connect(this.master); this.sfxBus.connect(this.sfxSend); this.sfxSend.connect(this.reverb);
    this.melodyBus.connect(this.master); this.melodyBus.connect(this.melodySend); this.melodySend.connect(this.reverb);
    this.scrubBus.connect(this.master);
    // 演奏中の試聴: 高い音をやわらかく削って、ほかのコードの後ろに、そっと置く
    this.duckFilter = ctx.createBiquadFilter(); this.duckFilter.type = 'lowpass'; this.duckFilter.frequency.value = 2200; this.duckFilter.Q.value = 0.5;
    this.duckFilter.connect(this.auditionBus);
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
  // ドラム・バッキングの音量（0〜100%。mixGainFor）。メロディ・試聴・技の効果音は、変えない
  setMix({ drums, backing } = {}) {
    const v = {};
    if (drums !== undefined) v.drums = DRUM_BUS_GAIN * mixGainFor(drums);
    if (backing !== undefined) v.piano = PIANO_BUS_GAIN * mixGainFor(backing);
    this.setVolumes(v);
  }
  // バーをはなしたときの、聴き比べ用の音。演奏中は、ほんとうの演奏が鳴っているので、何もしない
  previewMix(kind) {
    if (this.playing) return false;
    const t = this.ctx.currentTime + 0.03;
    if (kind === 'drums') { [['K', 0, 'x'], ['H', 0.18, 'o'], ['S', 0.36, 'x'], ['H', 0.54, 'o'], ['K', 0.72, 'x'], ['S', 0.9, 'x']].forEach(([lane, dt, lv]) => this.playDrum(lane, t + dt, lv)); return true; }
    if (kind === 'backing') { const c = this.table.byName('Ⅰ'); if (c) this.audition(c.id, t, 1.2, this.pianoBus); return true; }
    return false;
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
    if (dest !== this.pianoBus && dest !== this.drumBus && dest !== this.melodyBus && dest !== this.auditionBus) return dest;
    if (!this.session) this.session = this._newSession();
    return dest === this.pianoBus ? this.session.piano : dest === this.drumBus ? this.session.drums : dest === this.auditionBus ? this.session.audition : this.session.melody;
  }
  _newSession() {
    const piano = this.ctx.createGain(), drums = this.ctx.createGain(), melody = this.ctx.createGain(), audition = this.ctx.createGain();
    piano.connect(this.pianoBus); drums.connect(this.drumBus); melody.connect(this.melodyBus); audition.connect(this.auditionBus);
    return { piano, drums, melody, audition };
  }

  // 試聴の音の強さの倍率。演奏が進んでいて、いまコードが鳴っている間は、小さく（ほかのコードと、ぶつからないように）。それ以外は 1
  auditionLevel() { return this.playing && this.cur ? AUDITION_DUCK : 1; }

  // 1つの和音を、すぐ鳴らす（試聴用）。駒を選んだときなど。
  //   演奏中は、音を小さく・短く・やわらかくする（ほかのコードが鳴っているところへ、駒のコードが重なると、不協和音になりやすいため）
  audition(chordId, when = this.ctx.currentTime + 0.02, duration = 1.1, bus = this.auditionBus) {
    const chord = this.table.byId(chordId);
    if (!chord || chord.isRepeat) return;
    const level = this.auditionLevel();
    const ducked = level < 1;
    const v = voiceChord(chord, BASE_C_DEFAULT + 12 * this.octave, -1, false);
    v.notes.forEach((n, i) => this.playNote(n, when + i * 0.012, ducked ? duration * 0.55 : duration, (78 - i * 3) * level, ducked ? this.duckFilter : bus, { idx: i, chord: true }));
  }

  // 好きな音の組（MIDI ノート）を、すぐ鳴らす（コードの編集画面の試聴）。arpeggio: 低い音から、ばらして鳴らす。単音のときは、1つだけ
  auditionNotes(notes, { when = this.ctx.currentTime + 0.02, duration = 1.1, arpeggio = false } = {}) {
    const list = [...notes].sort((a, b) => a - b);
    const level = this.auditionLevel();
    const ducked = level < 1;
    list.forEach((n, i) => this.playNote(n, when + i * (arpeggio ? 0.16 : 0.012), ducked ? duration * 0.55 : duration, (78 - Math.min(i, 8) * 3) * level, ducked ? this.duckFilter : this.auditionBus, { idx: i, chord: list.length > 1 }));
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

  // 演奏を始める。fromSlot: 周回の何マス目から始めるか（省くと、止まっているあいだに、シークバーで決めた位置 = cueSlot。ふつうは 0）
  start(fromSlot = null) {
    if (this.playing) return;
    this.playing = true;
    const steps = this._wantedSteps(), len = steps * SLOTS_PER_STEP;
    let slot = fromSlot === null || fromSlot === undefined ? (this.scrub ? this.scrub.pos : this.cueSlot) : fromSlot;     // 止まっているあいだに、シークバーをつかんだまま始めたときは、つかんだ位置から
    if (this.scrub) { const snd = this.scrubSound; this.scrub = null; if (snd) snd.end(this.ctx.currentTime); }
    slot = Number.isFinite(slot) ? Math.max(0, Math.min(len - 1, Math.round(slot))) : 0;
    this.cueSlot = 0;
    this.lastRoot = -1; this.cur = null;
    this._loops = []; this._resumeSlot = null; this._seekHold = null;
    this.session = this._newSession();
    this.events.length = 0;
    this._applySeek(slot, steps, this.ctx.currentTime + 0.12, { tick: false });
    this._tick();
    this._timer = setInterval(() => this._tick(), TIMER_MS);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this._timer); this._timer = null;
    const t = this.ctx.currentTime;
    if (this.scrub) { this.scrub = null; if (this.scrubSound) this.scrubSound.end(t); }          // シークバーをつかんでいる途中で止めたら、巻き戻しの音も止める
    this._cutSession(0.04);                                         // 鳴っている音を、すっと消す
    this.cur = null;
    this.cueSlot = 0;                                               // 止めると、位置は、はじめ（0）にもどる（シークバーで動かすと、そこから始められる）
    this.events.push({ type: 'stop', time: t });
  }

  // 鳴っている音（これから鳴る予約ずみの音も）を、すっと消して、あたらしい「演奏ごとの出口」にする（止めたとき・シークバーをつかんだとき）
  _cutSession(tc = 0.04) {
    if (!this.session) return;
    const t = this.ctx.currentTime, old = this.session;
    for (const g of [old.piano, old.drums, old.melody, old.audition]) g.gain.setTargetAtTime(0, t, tc);
    setTimeout(() => { try { for (const g of [old.piano, old.drums, old.melody, old.audition]) g.disconnect(); } catch (e) { /* 何もしない */ } }, 700);
    this.session = null;
  }

  _tick() {
    if (this.scrub) return;                                         // シークバーをつかんでいる間は、演奏を進めない
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
    if (slotIndex === 0) { this.loopStart = 0; this.loopSteps = this._wantedSteps(); this._noteLoop(0, this.loopSteps); }
    else if (slotIndex - this.loopStart >= this.loopSteps * SLOTS_PER_STEP) { this.loopStart = slotIndex; this.loopSteps = this._wantedSteps(); this._noteLoop(slotIndex, this.loopSteps); }
    const slotInLoop = slotIndex - this.loopStart;
    const step = Math.floor(slotInLoop / SLOTS_PER_STEP);
    const slotInStep = slotInLoop % SLOTS_PER_STEP;
    const resumeMid = this._resumeSlot === slotIndex && slotInStep > 0;                 // シークのあとの、最初のマス（ステップの途中）: 鳴っているはずの音を、つづきから鳴らす
    this._carryMelody = this._resumeSlot === slotIndex && slotInLoop > 0;
    if (this._resumeSlot === slotIndex) this._resumeSlot = null;
    if (slotInStep === 0) this._beginStep(step, when);
    else if (slotInStep === SLOTS_PER_STEP / 2 && this._secondHalf(step) !== null) this._beginHalf(step, when);          // 分割したマス: 2拍目の頭で、後半のコードに切りかえる
    if (slotInStep % 4 === 0) { this.events.push({ type: 'beat', time: when, step, beat: slotInStep / 4 }); this.lastBeatTime = when; }

    const backing = this._backing();
    if (backing && this.cur) {
      const idx = slotInLoop % backing.length;
      let cell = parseCell(backing.cells[idx]);
      const split = this._secondHalf(step) !== null;                                     // このマスは、分割している（前半・後半）
      const halfStart = split && slotInStep === SLOTS_PER_STEP / 2;
      let carried = false, carryHold = 0;
      if (halfStart && !cell.hit) {                                                     // 2拍目の頭に、パターンの音がないとき: 1拍目に鳴らした音（和音・ベース・…）を、後半のコードで鳴らし直す（そうしないと、後半が無音になる）
        for (let k = 1; k <= SLOTS_PER_STEP / 2; k++) { const c = parseCell(backing.cells[(((idx - k) % backing.length) + backing.length) % backing.length]); if (c.hit) { cell = c; carried = true; break; } }
      } else if (resumeMid && !cell.hit) {                                              // シークで、ステップの途中から始めたとき: ふつうに演奏していれば、いま鳴っているはずの音（のびている音）を、つづきから
        const cr = this._carryAt(backing, idx, slotInStep, split);
        if (cr) { cell = cr.cell; carried = true; carryHold = cr.remaining; }
      }
      if (cell.hit) {
        const stepEnd = split && slotInStep < SLOTS_PER_STEP / 2 ? SLOTS_PER_STEP / 2 : SLOTS_PER_STEP;       // 分割したマスの前半: 音は、2拍目の頭までで切る（後半のコードに、かぶらないように）
        const hold = carried ? (carryHold || stepEnd - slotInStep) : holdSlots(backing.cells, idx, stepEnd - slotInStep);
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
      if (this._carryMelody) for (const [st, len, midi] of this.melody.notes) if (st < slotInLoop && st + len > slotInLoop) this.playLead(midi, when, (st + len - slotInLoop) * this.slotSeconds() * MELODY_GATE);      // シークのあと: のびている音を、つづきから
    }
  }

  _wantedSteps() { const n = this.wantLoopSteps(); return n === 4 ? 4 : NUM_STEPS; }

  // シークで、ステップの slotInStep マス目から始めたとき、ふつうに演奏していれば、いま鳴っているはずの音: { cell, remaining（残りのマス数）}。なければ null
  //   直前に始まった音が、パターンの「-」でのびていて、まだ終わっていなければ、その音（スタッカートの音は、もう終わっているので、鳴らさない）
  //   分割したマスの後半では、後半の頭に、パターンの音がなければ、前半の音を、後半のコードで鳴らし直す（_beginHalf のあとの scheduleSlot と同じ）ので、それも
  _carryAt(backing, idx, slotInStep, split) {
    const len = backing.length, at = (i) => ((i % len) + len) % len;
    const endOf = (start) => (split && start < SLOTS_PER_STEP / 2 ? SLOTS_PER_STEP / 2 : SLOTS_PER_STEP);
    for (let k = 1; k <= slotInStep; k++) {
      const c = parseCell(backing.cells[at(idx - k)]);
      if (!c.hit) continue;
      const start = slotInStep - k, hold = holdSlots(backing.cells, at(idx - k), endOf(start) - start);
      if (hold > k) return { cell: c, remaining: hold - k };
      break;                                                                          // いちばん近い音が終わっていれば、それより前の音も、終わっている
    }
    if (split && slotInStep > SLOTS_PER_STEP / 2) {
      const half = idx - (slotInStep - SLOTS_PER_STEP / 2);                          // 後半の頭（2拍目）のマス
      if (!parseCell(backing.cells[at(half)]).hit) {
        for (let k = 1; k <= SLOTS_PER_STEP / 2; k++) { const c = parseCell(backing.cells[at(half - k)]); if (c.hit) return { cell: c, remaining: SLOTS_PER_STEP - slotInStep }; }
      }
    }
    return null;
  }

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

  _beginStep(step, when, opts = {}) {
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
    if (opts.seek) info.seek = true;                                 // シークで、ステップの途中から始めた（画面の光だけ。技の「きらっ」は鳴らさない）
    this.events.push(info);
    if (this.onStepScheduled && !opts.seek) this.onStepScheduled(info);
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
  // seeks: [{ at（秒）, slot（周回の何マス目か）}]。その時刻に、演奏の位置を動かす（シークバーをはなした場合と同じ）
  async renderOffline(seconds, { seeks = [] } = {}) {
    this.playing = true; this.slotIndex = 0; this.lastRoot = -1; this.cur = null; this.events.length = 0;
    this.scrub = null; this._loops = []; this._resumeSlot = null; this._seekHold = null; this.cueSlot = 0;
    this.loopStart = 0; this.loopSteps = this._wantedSteps();
    this.refTime = 0.02; this.refSlot = 0;
    const sec = this.slotSeconds(), total = Math.ceil(seconds / sec);
    const pending = seeks.slice().sort((a, b) => a.at - b.at);
    let when = 0.02;
    for (let i = 0; i < total; i++, when += sec) {
      while (pending.length && pending[0].at <= when + 1e-9) { const sk = pending.shift(); this._cutSession(0.015); this._applySeek(sk.slot, this.loopSteps, when, { tick: false }); }
      this.scheduleSlot(this.slotIndex, when);
      this.slotIndex++;
    }
    return this.ctx.startRendering();
  }

  // ---------- シーク（巻き戻し・早送り。2026-11-25）----------
  // 演奏の位置（8ステップの周回の、何マス目か）を、動かす。シークバーをつかんで動かしているあいだ（scrubBegin 〜 scrubEnd）は、演奏を止めて、巻き戻しの音（scrub.js）だけが鳴る。
  // はなす（scrubEnd）と、その位置から、続きを演奏する。1マス = 16分音符。1ステップ = 8マス。周回 = 8ステップ（チュートリアルは、4ステップのことがある）

  // 周回の始まりを覚える（古いものは捨てる）。同じマスで始まる記録は、置きかえる
  _noteLoop(start, steps) {
    const last = this._loops[this._loops.length - 1];
    if (last && last.start === start) last.steps = steps; else this._loops.push({ start, steps });
    if (this._loops.length > 8) this._loops.shift();
  }

  // 時刻 t の、演奏の位置: { pos: 周回の何マス目か（小数）, len: 周回のマス数 }。シークバーをつかんでいるあいだは、つかんでいる位置。演奏を止めているあいだは、演奏を始める位置（cueSlot）
  loopPosAt(t = this.ctx.currentTime) {
    if (this.scrub) return { pos: this.scrub.pos, len: this.scrub.len };
    if (!this.playing) return { pos: this.cueSlot, len: this._wantedSteps() * SLOTS_PER_STEP };               // 止まっているあいだ: 演奏を始める位置
    if (this._seekHold && t < this._seekHold.until) return { pos: this._seekHold.slot, len: this._seekHold.len };      // はなした直後: 続きが始まるまでは、はなした位置のまま
    const slots = Math.round((this.refSlot + (t - this.refTime) / this.slotSeconds()) * 1e6) / 1e6;       // 時刻 → マスの計算の、ごく小さな誤差で、周回の境目が、ずれないように
    let e = this._loops.length ? this._loops[0] : { start: 0, steps: this.loopSteps };
    for (const l of this._loops) if (l.start <= slots) e = l;
    const len = e.steps * SLOTS_PER_STEP;
    let pos = slots - e.start;
    if (pos < 0) pos = 0; else if (pos >= len) pos %= len;
    return { pos, len };
  }

  // 時刻 t は、周回の、何マス目か（小数。0〜64。4ステップのときは 0〜32）。メロディの帯・シークバーの、再生位置の表示に使う
  loopSlotAt(t = this.ctx.currentTime) { return this.loopPosAt(t).pos; }

  // シークバーをつかんだ。fromPos: いま見えている位置（省くと、いまの演奏の位置）。演奏中は、演奏を止めて、鳴っている音を消す。演奏を止めているときも、つかめる（動かした位置が、演奏を始める位置になる）。すでにつかんでいれば false
  scrubBegin(fromPos = null) {
    if (this.scrub) return false;
    const cur = this.loopPosAt(this.ctx.currentTime);
    const len = cur.len;
    const pos = fromPos === null || fromPos === undefined ? cur.pos : Math.max(0, Math.min(len - 1e-6, fromPos));
    this.scrub = { pos, len, v: 0, lastT: null, tickT: null, burst: null };
    const now = this.ctx.currentTime;
    if (this.playing) {
      this._cutSession(0.015);
      this.events = this.events.filter((e) => e.time <= now + 0.005);        // これから来るはずだった、ステップ・拍の知らせは、捨てる（その音は、消えた）
    }
    if (!this.scrubSound) this.scrubSound = new ScrubSound(this.ctx, this.scrubBus);
    this.scrubSound.begin(now);
    return true;
  }

  // つかんだまま、位置を動かした（pos: 周回の何マス目か。小数）。動かした速さで、巻き戻しの音が変わる。nowMs: 時刻（ミリ秒。テストでは、決めた値を渡す）
  scrubTo(pos, nowMs = performance.now()) {
    const s = this.scrub;
    if (!s) return false;
    const p = Math.max(0, Math.min(s.len - 1e-6, Number.isFinite(pos) ? pos : s.pos));
    const d = p - s.pos, natural = 1 / this.slotSeconds();                       // natural: 通常の演奏の速さ（マス / 秒）
    if (s.lastT !== null && Math.abs(d) > 1e-9) {
      const dt = Math.max(0.008, (nowMs - s.lastT) / 1000);
      s.v = s.v * 0.45 + (d / dt) * 0.55;                                         // 動かしている速さ（マス / 秒。左 = マイナス）。少しなめらかに
    }
    // ふいに遠くへ動いた（バーの途中を押した・キーで1ステップ動かした）: 動いた距離ぶんの長さの、「ひゅっ」という音を鳴らす
    if (s.lastT === null ? Math.abs(d) >= 2 : (Math.abs(d) >= 6 && nowMs - s.lastT < 60)) {
      s.burst = { v: Math.sign(d) * natural * 12, until: nowMs + Math.min(450, 90 + Math.abs(d) * 5) };
    }
    s.pos = p; s.lastT = nowMs;
    this._feedScrubSound(nowMs);
    return true;
  }

  // 毎フレーム呼ぶ。動かしていない間は、速さを 0 に近づける（止めているあいだは、無音）
  scrubTick(nowMs = performance.now()) {
    const s = this.scrub;
    if (!s) return;
    const prev = s.tickT === null ? nowMs : s.tickT;
    s.tickT = nowMs;
    if (s.lastT !== null && nowMs - s.lastT > 45) s.v *= Math.exp(-Math.max(0, nowMs - prev) / 1000 / 0.06);
    this._feedScrubSound(nowMs);
  }

  _feedScrubSound(nowMs) {
    const s = this.scrub, snd = this.scrubSound;
    if (!s || !snd) return;
    const natural = 1 / this.slotSeconds();
    let v = s.v;
    if (s.burst) { if (nowMs < s.burst.until) { if (Math.abs(s.burst.v) > Math.abs(v)) v = s.burst.v; } else s.burst = null; }
    snd.update(Math.min(SCRUB_MAX_SPEED, Math.abs(v) / natural), v < 0 ? -1 : 1, this.ctx.currentTime);
  }

  // シークバーをはなした。その位置（pos を省くと、つかんでいた位置）から、続きを演奏する（止まっているときは、演奏を始める位置を決めるだけ）。snap: ステップの頭に近ければ、頭に合わせる。戻り値: 再開した（決めた）マス（なければ null）
  scrubEnd(pos = null, { snap = true, nowMs = performance.now() } = {}) {
    const s = this.scrub;
    if (!s) return null;
    const p = pos === null || pos === undefined ? s.pos : Math.max(0, Math.min(s.len - 1e-6, pos));
    const slot = snap ? snapSlot(p, s.len) : Math.min(s.len - 1, Math.round(p));
    const tail = s.burst && nowMs < s.burst.until ? (s.burst.until - nowMs) / 1000 : 0;          // 「ひゅっ」は、最後まで鳴らす
    this.scrub = null;
    if (this.scrubSound) this.scrubSound.end(this.ctx.currentTime + tail);
    if (this.playing) this._applySeek(slot, s.len / SLOTS_PER_STEP, this.ctx.currentTime + RESUME_DELAY);
    else this.cueSlot = slot;                                                     // 止まっているとき: 演奏は始めない。つぎに演奏を始める位置だけ、決める
    return slot;
  }

  // つかまずに、位置を動かす（キーボード・テスト用）。巻き戻しの音は、動いた距離ぶん、短く鳴る
  seekTo(slot, { snap = false } = {}) {
    if (!this.scrubBegin()) return null;
    this.scrubTo(slot);
    return this.scrubEnd(slot, { snap });
  }

  // 演奏の位置を、slot（周回の何マス目か。整数）に決めて、時刻 when から、そこの続きを予約する
  _applySeek(slot, steps, when, { tick = true } = {}) {
    const step = Math.floor(slot / SLOTS_PER_STEP), slotInStep = slot % SLOTS_PER_STEP;
    this.slotIndex = slot; this.loopStart = 0; this.loopSteps = steps;
    this._loops = [{ start: 0, steps }];
    this.nextTime = when; this.refTime = when; this.refSlot = slot;
    this.lastBeatTime = when - (slot % 4) * this.slotSeconds();                      // 拍の位置も、ここに合わせる（技の効果音を、拍に合わせるため）
    this._resumeSlot = slot;
    this._seekHold = { slot, len: steps * SLOTS_PER_STEP, until: when };
    this.cur = null;
    if (slotInStep !== 0) {                                                          // ステップの途中から: そのステップのコードを、先に決めておく（分割したマスの後半なら、後半のコード）
      this._beginStep(step, when, { seek: true });
      if (this._secondHalf(step) !== null && slotInStep > SLOTS_PER_STEP / 2) this._beginHalf(step, when);
    }
    if (tick && this.playing) this._tick();
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
