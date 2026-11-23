// 音色（楽器）。ピアノは、録音（サンプル。engine.js の playPianoNote）。それ以外は、Web Audio の部品だけで合成する（音源のファイルは増やさない）。
//   ステージやミッションが、曲の雰囲気（ビートやメロディー）に合う音色を選べるように、音色は「名前（id）」で呼ぶ。
//   engine.playNote(note, when, dur, vel, dest, { idx, chord }) が、いまの音色で鳴らす。idx = 和音の何番目の音か、chord = 和音の一部か。
//   時刻（when）はすべて、音の時計（AudioContext の currentTime）。

export const INSTRUMENTS = [
  { id: 'piano', name: 'ピアノ', desc: '録音のグランドピアノ' },
  { id: 'epiano', name: 'エレピ', desc: 'やわらかい電気ピアノ（FM 合成）' },
  { id: 'guitar', name: 'ギター', desc: 'ナイロン弦を上から下へかき鳴らす' },
  { id: 'organ', name: 'オルガン', desc: 'ゆれる、のびやかな響き' },
  { id: 'strings', name: 'ストリングス', desc: 'ゆっくり立ち上がる、弦の重なり' },
  { id: 'drive', name: 'ドライブシンセ', desc: '歪ませたシンセ。拍の頭で一瞬だけ引っ込み、すぐ戻る（サイドチェイン）。拍の頭はツンと明るい' },
  { id: 'bell', name: 'ベル', desc: '金属的できらきらした響き' },
];
export const INSTRUMENT_IDS = INSTRUMENTS.map((i) => i.id);
export const instrumentName = (id) => (INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0]).name;

const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);
const level = (vel) => Math.pow(Math.max(1, vel) / 100, 1.35);      // 音の強さ（ピアノと同じ曲線）

// ------------------------------------------------------------
// 道具
// ------------------------------------------------------------
function osc(ctx, type, freq, when, end, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, when);
  if (detune) o.detune.setValueAtTime(detune, when);
  o.start(when); o.stop(end);
  return o;
}
// 音の大きさの包み（立ち上がり attack・保つ・手を離したあとの消え方 release）。戻り値: GainNode
function envelope(ctx, when, dur, { peak, attack = 0.004, decayTo = 1, decay = 0.0, release = 0.12 }) {
  const g = ctx.createGain();
  const end = when + Math.max(0.05, dur);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  if (decay > 0 && decayTo < 1) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * decayTo), end);
  else g.gain.setValueAtTime(peak, end);
  g.gain.setTargetAtTime(0, end, release / 3);
  return { node: g, end: end + release * 1.6 };
}

// ------------------------------------------------------------
// ギター: Karplus-Strong（弦をはじいた音を、計算で作る）。音の高さごとに、1本ぶんの波形を作って、覚えておく
// ------------------------------------------------------------
function pluckBuffer(engine, note) {
  const cache = engine._pluckCache || (engine._pluckCache = new Map());
  if (cache.has(note)) return cache.get(note);
  const ctx = engine.ctx, sr = ctx.sampleRate;
  const f = hz(note), n = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * 2.0);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let seed = 7001 + note * 31;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  // はじいた瞬間の波形: ノイズを、ひとつ前の値となじませて（やわらかく）、弦をはじく位置（約 1/7）の櫛をかける
  const exc = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += (rnd() - lp) * 0.55; exc[i] = lp; }
  const pick = Math.max(1, Math.round(n / 7));
  for (let i = n - 1; i >= pick; i--) exc[i] -= exc[i - pick] * 0.8;
  const decay = 0.9965 - Math.min(0.0035, 0.00002 * Math.max(0, note - 55));       // 高い弦ほど、早く消える
  for (let i = 0; i < len; i++) {
    d[i] = i < n ? exc[i] : (d[i - n] + d[i - n + 1]) * 0.5 * decay;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
  cache.set(note, buf);
  return buf;
}

// ------------------------------------------------------------
// ドライブシンセ: 3本ののこぎり波 → 歪み → 音をまるめる → 「サイドチェイン」（拍の頭で一瞬だけ引っ込んで、すぐ戻る）
// ------------------------------------------------------------
// 歪みの形（2026-11-17 に強めた。それまでは tanh(3.4·x) のなめらかな丸め）:
//   DRIVE_K: 歪みの強さ。大きいほど、波の頭が、平らにつぶれる（倍音が増えて、ざらつく）
//   DRIVE_BIAS: 波の上と下を、少し非対称につぶす（偶数次の倍音が出て、ざらつきが、かたくなりすぎない）
export const DRIVE_K = 4.8;
export const DRIVE_BIAS = 0.2;
export function driveCurve() {
  const n = 1024, c = new Float32Array(n);
  const raw = (x) => Math.tanh(DRIVE_K * x + DRIVE_BIAS) - Math.tanh(DRIVE_BIAS);          // x = 0 のとき 0（直流を作らない）
  const norm = Math.max(Math.abs(raw(1)), Math.abs(raw(-1)));
  for (let i = 0; i < n; i++) c[i] = raw((i / (n - 1)) * 2 - 1) / norm;
  return c;
}
// 「サイドチェイン」の形（2026-11-18 に作り直し）:
//   以前（2026-11-16〜17）は、拍の頭から半拍近く引っ込んだままで、裏拍に入ってからゆっくり立ち上がっていた。いちばん大きくなるのは次の拍の頭の直前。
//   → 和音の入りも立ち上がりも、拍よりずっとあとに聞こえた（BPM120 で、半分の大きさになるまで、約 0.4 秒おくれ）。「全体的に音と立ち上がりが遅れている」というご指摘のとおり。
//   いまは、キックに押さえられるのは、ほんの一瞬（拍の頭の 2%）。すぐに戻りはじめて、はじめは速く、終わりはゆるやかに、元の大きさへ戻る（イーズアウト）。
//   和音の入りは、拍の頭のすぐあと（BPM120 で約 0.05 秒）に聞こえる。それでも、拍ごとに「ぐっと引っ込んで、ぶわっと戻る」ポンピングは、残る。
//   音の明るさ（ローパスの周波数）は、拍の頭で、いちばん明るく（「ツン」としたアタック。フィルターのエンベロープ）、そのあと、まるくなっていく。
//   ※ 参考: サカナクションのシンセ（キックに合わせて引っ込んで、すぐ戻る、ダンス寄りの音）。ただし、あの音の作り方の資料は見つからなかったので、
//      「拍の頭ですぐ聞こえる」「フィルターのエンベロープで、ツンとしたアタック」という、一般的な作り方で近づけた（耳での確認は、まだ）
export const PUMP = {
  depth: 0.9,          // 拍の頭で、どれだけ引っ込むか（0.9 = 元の 1割の大きさまで）
  hold: 0.02,          // 引っ込んだままの長さ（拍の何割か）
  rise: 0.38,          // 引っ込んだところから、元の大きさに戻るまで（拍の何割か）
  curve: 2.4,          // 戻り方。大きいほど、はじめが速く、終わりがゆるやか
  filterHigh: 6400,    // 拍の頭の、フィルターの周波数（ツンとしたアタック）
  filterLow: 2700,     // 拍のおわりに近づくときの、フィルターの周波数（まるい音）
  filterDecay: 0.24,   // 明るさが、まるくなっていく速さ（拍の何割で、約 6割まるくなるか）
};
function swell(phi, low, high) {
  if (phi < PUMP.hold) return low;
  const u = Math.min(1, (phi - PUMP.hold) / PUMP.rise);
  return low + (high - low) * (1 - Math.pow(1 - u, PUMP.curve));
}
const brightness = (phi) => PUMP.filterLow + (PUMP.filterHigh - PUMP.filterLow) * Math.exp(-phi / PUMP.filterDecay);
// param（音の大きさ・フィルターの周波数）に、when〜end のあいだの、拍ごとの形 shape(拍の中の位置 0〜1) を予約する。拍の頭で、いったん、頭の値へ戻す
function shapeBeats(engine, param, when, end, shape) {
  const beat = 60 / engine.bpm;
  const pos = engine.beatPosition(when);                          // when は、拍の何個ぶん進んだところか（整数 = 拍の頭）
  let tb = when - (pos - Math.floor(pos + 1e-9)) * beat;          // いまの拍の頭の時刻
  for (; tb < end; tb += beat) {
    const t0 = Math.max(tb, when), t1 = Math.min(tb + beat * 0.99, end);
    if (tb >= when - 1e-6) param.setValueAtTime(shape(0), tb);     // 拍の頭で、頭の値へ（音は、ぐっと下がる）
    if (t1 - t0 < 0.01) continue;
    const p0 = (t0 - tb) / beat, p1 = (t1 - tb) / beat, n = 48;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = shape(p0 + (p1 - p0) * (i / (n - 1)));
    param.setValueCurveAtTime(curve, t0, t1 - t0);
  }
}
function pump(engine, gain, when, end, { depth = PUMP.depth, peak = 1.0 } = {}) { const low = 1 - depth; shapeBeats(engine, gain.gain, when, end, (phi) => swell(phi, low, peak)); }

// ------------------------------------------------------------
// 1つの音を鳴らす
// ------------------------------------------------------------
// 音色ごとの大きさ。ピアノ（録音）と、だいたい同じ大きさに聞こえるように、そろえてある（テストで確かめる）
const GAINS = { epiano: 0.14, guitar: 0.46, organ: 0.2, strings: 0.14, drive: 0.15, bell: 0.17, lead: 0.2 };       // lead（メロディ）は、和音のピアノより、少し大きいくらい（目立つが、和音をつぶさない）

export function playSynth(engine, id, { note, when, dur, vel, dest, idx = 0, chord = false }) {
  const ctx = engine.ctx;
  when = Math.max(0, when);
  const f = hz(note);
  const peak = 0.62 * level(vel) * (GAINS[id] || 0.6);
  switch (id) {
    case 'epiano': {                                              // FM: 搬送波（f）を、1倍の波でゆらす。叩いた瞬間だけ、ゆらしを深く（「ポロン」というアタック）
      const env = envelope(ctx, when, dur, { peak, attack: 0.003, decay: 1, decayTo: 0.28, release: 0.3 });
      const car = osc(ctx, 'sine', f, when, env.end);
      const mod = osc(ctx, 'sine', f, when, env.end);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 2.4, when); mg.gain.exponentialRampToValueAtTime(f * 0.3, when + 0.35);
      mod.connect(mg); mg.connect(car.frequency);
      const tine = osc(ctx, 'sine', f * 5.99, when, when + 0.35);       // 金属の棒の、かすかな高い響き
      const tg = ctx.createGain(); tg.gain.setValueAtTime(peak * 0.28, when); tg.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
      tine.connect(tg); tg.connect(env.node);
      car.connect(env.node); env.node.connect(dest);
      return;
    }
    case 'guitar': {                                              // かき鳴らし: 和音の音を、低い音から順に、少しずつずらす
      const delay = chord ? idx * 0.018 : 0;
      const src = ctx.createBufferSource(); src.buffer = pluckBuffer(engine, note);
      const g = ctx.createGain(); const t0 = when + delay, end = when + Math.max(0.12, dur);
      g.gain.setValueAtTime(peak * (1 - Math.min(0.3, idx * 0.05)), t0);
      g.gain.setValueAtTime(peak * (1 - Math.min(0.3, idx * 0.05)), Math.max(t0, end - 0.02));
      g.gain.setTargetAtTime(0, Math.max(t0, end - 0.02), 0.07);
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 190; body.gain.value = 5; body.Q.value = 1.1;     // 胴の鳴り
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3800; tone.Q.value = 0.5;
      src.connect(g); g.connect(body); body.connect(tone); tone.connect(dest);
      src.start(t0); src.stop(end + 0.5);
      return;
    }
    case 'organ': {                                               // 倍音を足し合わせる。ゆっくりした、ゆれ（回転スピーカー）つき
      const env = envelope(ctx, when, dur, { peak: peak * 0.7, attack: 0.012, release: 0.08 });
      const partials = [[1, 0.5], [2, 0.42], [3, 0.2], [4, 0.17], [6, 0.1], [8, 0.07]];
      const sum = ctx.createGain();
      for (const [m, a] of partials) { const o = osc(ctx, 'sine', f * m, when, env.end); const pg = ctx.createGain(); pg.gain.value = a; o.connect(pg); pg.connect(sum); }
      const trem = ctx.createGain(); trem.gain.value = 0.9;
      const lfo = osc(ctx, 'sine', 5.2, when, env.end); const lg = ctx.createGain(); lg.gain.value = 0.09; lfo.connect(lg); lg.connect(trem.gain);
      sum.connect(trem); trem.connect(env.node); env.node.connect(dest);
      return;
    }
    case 'strings': {                                             // のこぎり波を、2本ずらして重ねて、角をとる。ゆっくり立ち上がる
      const env = envelope(ctx, when, dur, { peak: peak * 0.8, attack: 0.28, release: 0.5 });
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, when); lp.frequency.linearRampToValueAtTime(2600, when + 0.45); lp.Q.value = 0.6;
      const vib = osc(ctx, 'sine', 5.3, when + 0.3, env.end); const vg = ctx.createGain(); vg.gain.value = 5; vib.connect(vg);          // 弦の、ゆるいビブラート
      for (const cents of [-8, 8]) { const o = osc(ctx, 'sawtooth', f, when, env.end, cents); o.connect(lp); vg.connect(o.detune); }
      lp.connect(env.node); env.node.connect(dest);
      return;
    }
    case 'drive': {                                               // 歪んだシンセ。サイドチェイン（拍の頭で一瞬だけ下がり、すぐ戻る。拍の頭は、ツンと明るい）
      const env = envelope(ctx, when, dur, { peak: peak, attack: 0.006, release: 0.06 });
      const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 5600;
      const shaper = ctx.createWaveShaper(); shaper.curve = engine._driveCurve || (engine._driveCurve = driveCurve()); shaper.oversample = '2x';
      const post = ctx.createBiquadFilter(); post.type = 'lowpass'; post.frequency.value = 3300; post.Q.value = 0.95;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
      const pumpGain = ctx.createGain();
      for (const cents of [-15, 0, 15]) { const o = osc(ctx, 'sawtooth', f, when, env.end, cents); const og = ctx.createGain(); og.gain.value = 0.37; o.connect(og); og.connect(pre); }     // 3本のずれ（うなり）も、少し広げて、ざらつきを足す
      pre.connect(shaper); shaper.connect(post); post.connect(hp); hp.connect(pumpGain); pumpGain.connect(env.node); env.node.connect(dest);
      pump(engine, pumpGain, when, env.end);
      shapeBeats(engine, post.frequency, when, env.end, brightness);      // 拍の頭で、いちばん明るく（ツン）。そのあと、まるくなっていく
      return;
    }
    case 'lead': {                                                // メロディ用: やわらかい、笛のようなシンセ。三角波 + 1オクターブ上の正弦波。鳴り始めて少しすると、ゆるく、ゆれる（ビブラート）
      const env = envelope(ctx, when, dur, { peak, attack: 0.022, release: 0.16 });
      const o1 = osc(ctx, 'triangle', f, when, env.end);
      const o2 = osc(ctx, 'sine', f * 2, when, env.end);
      const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.5;
      const vib = osc(ctx, 'sine', 5.6, when, env.end); const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, when); vg.gain.setValueAtTime(0, when + 0.14); vg.gain.linearRampToValueAtTime(8, when + 0.5);     // 立ち上がりは、まっすぐ。そのあと、ゆれが、だんだん深くなる
      vib.connect(vg); vg.connect(o1.detune); vg.connect(o2.detune);
      o1.connect(lp); g2.connect(lp); lp.connect(env.node); env.node.connect(dest);
      return;
    }
    case 'bell': {                                                // FM（非整数倍）: 鐘の音。長くは伸ばさない
      const ring = Math.min(1.6, Math.max(0.5, dur));
      const env = envelope(ctx, when, ring, { peak, attack: 0.002, decay: 1, decayTo: 0.05, release: 0.4 });
      const car = osc(ctx, 'sine', f, when, env.end);
      const mod = osc(ctx, 'sine', f * 3.5, when, env.end);
      const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 1.8, when); mg.gain.exponentialRampToValueAtTime(f * 0.05, when + 1.0);
      mod.connect(mg); mg.connect(car.frequency);
      car.connect(env.node); env.node.connect(dest);
      return;
    }
    default: return;
  }
}
