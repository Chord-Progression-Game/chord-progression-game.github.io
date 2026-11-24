// 巻き戻し（スクラブ）の音。シークバーをつかんで動かしているあいだだけ鳴る、合成音（2026-11-25）。
//   DJ の巻き戻し・テープの早送りのような、「キュルルル」という音: 帯域をしぼったノイズ（シャーという風切り音）+ のこぎり波（テープの回る音）
//   音の高さ・大きさは、動かす速さで決まる（通常の演奏の何倍の速さで動かしているか）。止めているあいだは、無音
//   動かす方向（左 = 巻き戻し・右 = 早送り）で、のこぎり波の高さを少し変える（巻き戻しは、やや低く）
//   画面にも、演奏の部品にも触らない。AudioContext と、つなぐ先のノードだけを使う（OfflineAudioContext でも動く = テストで、音を数値で調べられる）

export const SCRUB_MAX_SPEED = 30;      // 音が変わるのは、通常の演奏の、何倍の速さまで（それより速くても、同じ音）
export const SCRUB_SILENT_BELOW = 0.04; // これより遅い動きは、無音（指のふるえ・止めているときの、ごく小さな動きで、鳴らさない）
export const SNAP_SLOTS = 2;            // はなしたとき、ステップの頭に、これだけ（マス）近ければ、頭に吸いつく（1マス = 16分音符。2マス = 8分音符）
const AMP_MAX = 0.34;                   // 全体の大きさの上限（和音の試聴と、同じくらい。いちばん速く動かしても、和音より大きくならない）

// 速さ（通常の演奏の何倍か）と向き（-1 = 巻き戻し・+1 = 早送り）から、音の性質を決める。純粋な計算（テストで直接調べる）
export function scrubParams(speed, dir = -1) {
  const s = Math.max(0, Math.min(SCRUB_MAX_SPEED, Number.isFinite(speed) ? speed : 0));
  if (s < SCRUB_SILENT_BELOW) return { amp: 0, noiseHz: 500, noiseQ: 1, noiseGain: 0, whineHz: 160, whineGain: 0 };
  const g = s / (s + 4);                                              // 0 〜 1 に、なだらかに近づく（速いほど、高く・するどく）
  const dirK = dir > 0 ? 1.25 : dir < 0 ? 0.85 : 1;
  return {
    amp: AMP_MAX * (1 - Math.exp(-s / 1.2)),                          // 速いほど、大きい（ゆっくりでも、聞こえる）
    noiseHz: 450 + 4200 * g, noiseQ: 0.9 + 1.6 * g, noiseGain: 0.9,    // 風切り音（帯域をしぼったノイズ）
    whineHz: 180 * (1 + 8 * g) * dirK, whineGain: 0.26 + 0.22 * g,     // テープの回る音（のこぎり波）
  };
}

// はなした位置（マス。小数）を、再開する位置（整数のマス）にする: ステップの頭に近ければ頭へ（磁石）・そうでなければ、いちばん近いマス。周回の終わりをこえたら、頭（0）へ
export function snapSlot(pos, len, tol = SNAP_SLOTS) {
  const p = Math.max(0, Number.isFinite(pos) ? pos : 0);
  const head = Math.round(p / 8) * 8;
  let s = Math.abs(p - head) <= tol ? head : Math.round(p);
  if (s >= len) s = 0;
  return Math.max(0, s);
}

// ほのかに高い方へ寄った、ノイズ（テープの擦れる音に近い）。毎回同じ（テストが安定する）
function makeNoise(ctx, seconds = 1.5) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
  let seed = 987654321, lp = 0;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = seed / 4294967296 * 2 - 1;
    lp += (white - lp) * 0.7;
    d[i] = white - lp * 0.35;
  }
  return buf;
}

export class ScrubSound {
  constructor(ctx, dest) {
    this.ctx = ctx; this.dest = dest;
    this.out = null; this.active = false;
  }

  // つかんだ。音の部品を作る（動かすまでは、無音）
  begin(when = this.ctx.currentTime) {
    if (this.active) return;
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(this.dest);
    const noise = ctx.createBufferSource(); noise.buffer = makeNoise(ctx); noise.loop = true;
    const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 500; nbp.Q.value = 1;
    const ng = ctx.createGain(); ng.gain.value = 0;
    noise.connect(nbp); nbp.connect(ng); ng.connect(out);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 160;
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 3200; olp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0;
    osc.connect(olp); olp.connect(wg); wg.connect(out);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6.5;            // テープのゆれ（ワウ）: 高さが、ほんの少し、ゆれる
    const lg = ctx.createGain(); lg.gain.value = 28;                                              // ±28 セント
    lfo.connect(lg); lg.connect(osc.detune);
    noise.start(when); osc.start(when); lfo.start(when);
    this.nodes = { out, noise, nbp, ng, osc, olp, wg, lfo, lg };
    this.out = out; this.active = true;
  }

  // 速さ（通常の演奏の何倍）と向きを、when の時刻から、なめらかに反映する
  update(speed, dir = -1, when = this.ctx.currentTime) {
    if (!this.active) return null;
    const p = scrubParams(speed, dir), n = this.nodes, tc = 0.03;
    n.out.gain.setTargetAtTime(p.amp, when, 0.03);
    n.nbp.frequency.setTargetAtTime(p.noiseHz, when, tc); n.nbp.Q.setTargetAtTime(p.noiseQ, when, tc);
    n.ng.gain.setTargetAtTime(p.noiseGain, when, tc);
    n.osc.frequency.setTargetAtTime(p.whineHz, when, tc); n.wg.gain.setTargetAtTime(p.whineGain, when, tc);
    return p;
  }

  // はなした。when の時刻に、すっと消して、部品を片づける
  end(when = this.ctx.currentTime) {
    if (!this.active) return;
    const n = this.nodes;
    this.active = false;
    try {
      n.out.gain.cancelScheduledValues(when);
      n.out.gain.setTargetAtTime(0, when, 0.02);
      const stopAt = when + 0.25;
      n.noise.stop(stopAt); n.osc.stop(stopAt); n.lfo.stop(stopAt);
      n.osc.onended = () => { try { n.out.disconnect(); } catch (e) { /* 何もしない */ } };
    } catch (e) { /* 何もしない */ }
    this.nodes = null;
    this.out = null;
  }
}
