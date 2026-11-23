// 効果音。ゲームの音楽（コード）にぶつからないように、
//   ・技が決まったときの音は、そのコードの構成音を、高い音域で「きらっ」と鳴らす（ピアノの高い音源）。だから、いつも調和する
//   ・ほかの音（置く・持ち上げる・ボタン）は、短く、小さく
// すべて、音の時計（when）で予約する。技の音は、拍に合わせて鳴らす（呼ぶ側が、次の拍の時刻を渡す）。

export class Sfx {
  constructor(engine) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.bus = engine.sfxBus;
    this._noiseBuf = null;
  }

  _noise() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 777;
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 4294967296 * 2 - 1; }
    return (this._noiseBuf = buf);
  }

  _osc(type, f0, f1, when, dur, gain) {
    const ctx = this.ctx;
    when = Math.max(0, when);                                 // 過去・負の時刻は、すぐ鳴らす（0 以上にそろえる）
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.bus);
    o.start(when); o.stop(when + dur + 0.05);
  }

  _noiseBurst(when, dur, gain, type = 'lowpass', freq = 1200, freq2 = null) {
    const ctx = this.ctx;
    when = Math.max(0, when);
    const s = ctx.createBufferSource(); s.buffer = this._noise();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, when);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, when + dur);
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(f); f.connect(g); g.connect(this.bus);
    s.start(when); s.stop(when + dur + 0.05);
  }

  // 駒を置く: 木のコツッという音
  place(when = this.ctx.currentTime) {
    this._osc('sine', 190, 62, when, 0.11, 0.5);
    this._noiseBurst(when, 0.05, 0.28, 'lowpass', 1600, 500);
  }
  // 駒を持ち上げる
  pickup(when = this.ctx.currentTime) {
    this._osc('sine', 420, 640, when, 0.07, 0.12);
    this._noiseBurst(when, 0.04, 0.06, 'highpass', 2500);
  }
  // ボタン・選択
  ui(when = this.ctx.currentTime) { this._osc('triangle', 1320, 1320, when, 0.05, 0.07); }
  // 駒をはずす / 取りやめ
  remove(when = this.ctx.currentTime) { this._osc('sine', 300, 150, when, 0.09, 0.14); }

  // 技が決まった: そのコードの音を、高い音域で、きらっと鳴らす。power 1 = 初めて決まった（大きく）/ 0.4 = くり返し（小さく）
  trick(when, notes, power = 1, big = false) {
    const e = this.e;
    const picked = [];
    for (const n of notes) {
      let m = n; while (m < 76) m += 12; while (m > 96) m -= 12;
      if (!picked.includes(m)) picked.push(m);
    }
    picked.sort((a, b) => a - b);
    picked.slice(0, 4).forEach((m, i) => e.playPianoNote(m, when + i * 0.042, 0.55, 74 * power - i * 4, this.bus));
    this._noiseBurst(when - 0.12, 0.2, 0.12 * power, 'bandpass', 700, 5200);                // しゅっと駆け上がる
    if (power >= 0.9) e.playDrum(big ? 'X' : 'R', when, 'x', this.bus);
  }

  // コンボ: n 個つながるごとに、少し高く
  combo(when, n) {
    const f = 660 * Math.pow(2, Math.min(n, 6) / 6);
    this._osc('triangle', f, f * 1.5, when, 0.18, 0.1);
    this._osc('sine', f * 2, f * 3, when + 0.04, 0.22, 0.06);
  }

  // ステージクリア: 明るいアルペジオ
  clear(when = this.ctx.currentTime) {
    const e = this.e;
    [72, 76, 79, 84, 88].forEach((m, i) => e.playPianoNote(m, when + i * 0.09, 0.9, 82 - i * 2, this.bus));
    e.playDrum('X', when + 0.36, 'x', this.bus);
  }
  // 「？」（小節の頭の Ⅴ）: 「うーん？」と、首をかしげるような、小さな音（音階を下がる2つ）
  huh(when = this.ctx.currentTime) {
    this._osc('triangle', 392, 330, when, 0.16, 0.085);
    this._osc('triangle', 311, 247, when + 0.18, 0.24, 0.085);
  }
  // ヒントを出した
  hint(when = this.ctx.currentTime) { this._osc('sine', 880, 1175, when, 0.12, 0.05); }
}
