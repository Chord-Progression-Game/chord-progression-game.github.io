// 巻き戻し（スクラブ）の音。シークバーをつかんで動かしているあいだだけ鳴る、合成音（2026-11-25。同日、作りなおし）。
//   ねらい: DJ の「速戻し」のような、水っぽい質感の音（ご指定: ジッパーを閉じるような、擦れる音ではなく）。
//     ・水のような部分: 低めの帯域にしぼった、やわらかいノイズ。中心の高さが、ゆらゆら動くので、「ぽこぽこ・ちゃぷちゃぷ」とした、水の動きのように聞こえる（高い音のシャリシャリは、ない）
//     ・テープが回るような部分: やわらかい高さの音（サイン波）。動かす速さで、高さが、なめらかに動く（ゆるいビブラートつき）
//     ・うずまきのような部分: ごく短い遅れ（フランジャー）で、全体が、うねる。DJ の「ひゅるるる」という、巻き戻しの感じ
//   音の高さ・大きさは、動かす速さで決まる（通常の演奏の何倍の速さで動かしているか）。止めているあいだは、無音
//   動かす方向（左 = 巻き戻し・右 = 早送り）で、テープの音の高さを少し変える（巻き戻しは、やや低く）
//   画面にも、演奏の部品にも触らない。AudioContext と、つなぐ先のノードだけを使う（OfflineAudioContext でも動く = テストで、音を数値で調べられる）

export const SCRUB_MAX_SPEED = 30;      // 音が変わるのは、通常の演奏の、何倍の速さまで（それより速くても、同じ音）
export const SCRUB_SILENT_BELOW = 0.04; // これより遅い動きは、無音（指のふるえ・止めているときの、ごく小さな動きで、鳴らさない）
export const SNAP_SLOTS = 2;            // はなしたとき、ステップの頭に、これだけ（マス）近ければ、頭に吸いつく（1マス = 16分音符。2マス = 8分音符）
const AMP_MAX = 0.55;                   // 全体の大きさの上限（和音の試聴と、同じくらい。いちばん速く動かしても、和音より大きくならない。テストで確かめる）
const WATER_RATIO = 1.75;               // 水の音の、2つ目の帯域の中心 ÷ 1つ目の中心

// 速さ（通常の演奏の何倍か）と向き（-1 = 巻き戻し・+1 = 早送り）から、音の性質を決める。純粋な計算（テストで直接調べる）
export function scrubParams(speed, dir = -1) {
  const s = Math.max(0, Math.min(SCRUB_MAX_SPEED, Number.isFinite(speed) ? speed : 0));
  if (s < SCRUB_SILENT_BELOW) return { amp: 0, toneHz: 300, toneGain: 0, waterHz: 520, waterQ: 7, waterGain: 0, bubbleRate: 1, swirlHz: 0.5 };
  const g = s / (s + 4);                                              // 0 〜 1 に、なだらかに近づく（速いほど、高く・はやく）
  const dirK = dir > 0 ? 1.2 : dir < 0 ? 0.82 : 1;
  return {
    amp: AMP_MAX * (1 - Math.exp(-s / 1.2)),                          // 速いほど、大きい（ゆっくりでも、聞こえる）
    toneHz: (260 + 1100 * g) * dirK, toneGain: 0.08 + 0.04 * g,          // テープの回る音（サイン波）。260〜1360Hz
    waterHz: 520 + 1700 * g, waterQ: 7 + 5 * g, waterGain: 1,          // 水の音の、中心の高さ（520〜2200Hz）。帯域は、速いほど、せまい
    bubbleRate: 1 + 1.7 * g,                                           // 水のゆらぎの速さ（1 〜 2.7倍）
    swirlHz: 0.5 + 2.2 * g,                                            // うずまき（フランジャー）の速さ（0.5〜2.7Hz）
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

// やわらかいノイズ（低い方に寄ったもの = ピンクノイズに近い。高い音の、シャリシャリが少ない）。毎回同じ（テストが安定する）
function makeNoise(ctx, seconds = 2) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
  let seed = 987654321, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = seed / 4294967296 * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.0990460; b1 = 0.96300 * b1 + white * 0.2965164; b2 = 0.57000 * b2 + white * 1.0526913;    // ピンクノイズ（3つのフィルターの足し合わせ）
    d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
  }
  return buf;
}

export class ScrubSound {
  // levels: 部分ごとの大きさの倍率 { tone, water, swirl }（ふだんは 1。テスト・調整用に、0 で、その部分を消せる）
  constructor(ctx, dest, levels = {}) {
    this.ctx = ctx; this.dest = dest;
    this.levels = { tone: 1, water: 1, swirl: 1, ...levels };
    this.out = null; this.active = false;
  }

  // つかんだ。音の部品を作る（動かすまでは、無音）
  begin(when = this.ctx.currentTime) {
    if (this.active) return;
    const ctx = this.ctx, lv = this.levels;
    const mk = {
      gain: (v) => { const g = ctx.createGain(); g.gain.value = v; return g; },
      filter: (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; },
      osc: (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; },
    };
    const sources = [];
    const src = (o) => { sources.push(o); return o; };
    // ---- 仕上げ: 低い音のこもり・高い音のシャリシャリを、落とす ----
    const out = mk.gain(0); out.connect(this.dest);
    const lp = mk.filter('lowpass', 5200, 0.6), hp = mk.filter('highpass', 90, 0.7);
    hp.connect(lp); lp.connect(out);
    // ---- うずまき（フランジャー）: ごく短い遅れを、ゆっくり動かして、全体を、うねらせる ----
    const mix = mk.gain(1);
    const dry = mk.gain(1 - 0.25 * lv.swirl), wet = mk.gain(0.6 * lv.swirl);
    const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.004;
    const fb = mk.gain(0.42), fbLp = mk.filter('lowpass', 2800, 0.5);
    const swirl = src(mk.osc('sine', 0.5)), swirlDepth = mk.gain(0.0028);
    swirl.connect(swirlDepth); swirlDepth.connect(delay.delayTime);
    mix.connect(dry); dry.connect(hp);
    mix.connect(delay); delay.connect(wet); wet.connect(hp);
    delay.connect(fbLp); fbLp.connect(fb); fb.connect(delay);
    // ---- テープの回る音: やわらかいサイン波 + ほんの少しずれた三角波（うなり）。ゆるいビブラート ----
    const toneGain = mk.gain(0);
    const t1 = src(mk.osc('sine', 300)), t2 = src(mk.osc('triangle', 300)); t2.detune.value = 7;
    const t2g = mk.gain(0.3), tlp = mk.filter('lowpass', 2600, 0.5);
    t1.connect(toneGain); t2.connect(t2g); t2g.connect(toneGain); toneGain.connect(tlp); tlp.connect(mix);
    const vib = src(mk.osc('sine', 5.2)), vibDepth = mk.gain(22);
    vib.connect(vibDepth); vibDepth.connect(t1.detune); vibDepth.connect(t2.detune);
    // ---- 水の音: やわらかいノイズを、中心が動く、2つの帯域にとおす。中心のゆらぎ・音量のゆらぎが、水の動き（ぽこぽこ）に聞こえる ----
    const noise = src(ctx.createBufferSource()); noise.buffer = makeNoise(ctx); noise.loop = true;
    const pre = mk.filter('lowpass', 4200, 0.5);
    const bpA = mk.filter('bandpass', 520, 7), bpB = mk.filter('bandpass', 520 * WATER_RATIO, 7);
    const gA = mk.gain(2.2 * lv.water), gB = mk.gain(1.3 * lv.water);
    const water = mk.gain(0), bubble = mk.gain(0.74);
    noise.connect(pre); pre.connect(bpA); pre.connect(bpB); bpA.connect(gA); bpB.connect(gB); gA.connect(water); gB.connect(water);
    water.connect(bubble); bubble.connect(mix);
    const wob = [[6.3, 520, bpA], [9.1, 380, bpA], [7.7, 480, bpB], [12.9, 340, bpB]].map(([rate, cents, bp]) => {       // 帯域の中心を、ふらふら動かす（cents: ゆれの幅）
      const l = src(mk.osc('sine', rate)), d = mk.gain(cents); l.connect(d); d.connect(bp.detune); return { l, rate };
    });
    const bub = src(mk.osc('sine', 11)), bubDepth = mk.gain(0.26);                                                     // 音量の、ぽこぽこしたゆらぎ
    bub.connect(bubDepth); bubDepth.connect(bubble.gain);
    for (const o of sources) o.start(when);
    this.nodes = { out, sources, t1, t2, toneGain, bpA, bpB, water, wob, bub, swirl, delay };
    this.out = out; this.active = true;
    this.bubbleBase = 11;
  }

  // 速さ（通常の演奏の何倍）と向きを、when の時刻から、なめらかに反映する
  update(speed, dir = -1, when = this.ctx.currentTime) {
    if (!this.active) return null;
    const p = scrubParams(speed, dir), n = this.nodes, tc = 0.04, lv = this.levels;
    n.out.gain.setTargetAtTime(p.amp, when, 0.03);
    n.t1.frequency.setTargetAtTime(p.toneHz, when, 0.06); n.t2.frequency.setTargetAtTime(p.toneHz, when, 0.06);        // 高さは、ゆっくり追いかける（なめらかに、すべる）
    n.toneGain.gain.setTargetAtTime(p.toneGain * lv.tone, when, tc);
    n.bpA.frequency.setTargetAtTime(p.waterHz, when, tc); n.bpB.frequency.setTargetAtTime(p.waterHz * WATER_RATIO, when, tc);
    n.bpA.Q.setTargetAtTime(p.waterQ, when, tc); n.bpB.Q.setTargetAtTime(p.waterQ, when, tc);
    n.water.gain.setTargetAtTime(p.waterGain, when, tc);
    for (const w of n.wob) w.l.frequency.setTargetAtTime(w.rate * p.bubbleRate, when, 0.12);
    n.bub.frequency.setTargetAtTime(this.bubbleBase * p.bubbleRate, when, 0.12);
    n.swirl.frequency.setTargetAtTime(p.swirlHz, when, 0.12);
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
      const stopAt = when + 0.3;
      for (const o of n.sources) o.stop(stopAt);
      n.sources[0].onended = () => { try { n.out.disconnect(); } catch (e) { /* 何もしない */ } };
    } catch (e) { /* 何もしない */ }
    this.nodes = null;
    this.out = null;
  }
}
