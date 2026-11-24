// ゲームの音（時計・ピアノ・ドラム）のテスト。音を出さずに（OfflineAudioContext）書き出して、中身を調べる。
import { ChordTable } from '../js/core/chords.js';
import { AudioEngine, parseCell, holdSlots, SLOTS_PER_STEP, masterGainFor, MASTER_GAIN, VOLUME_TOP, DRUM_BUS_GAIN, PIANO_BUS_GAIN, MIX_DEFAULT, mixGainFor } from '../js/audio/engine.js';
import { DEFAULT_VOLUME, DEFAULT_MIX } from '../js/game/save.js';
import { Sfx } from '../js/audio/sfx.js';
import { ScrubSound, scrubParams, snapSlot, SCRUB_MAX_SPEED, SCRUB_SILENT_BELOW } from '../js/audio/scrub.js';
import { INSTRUMENTS, INSTRUMENT_IDS, driveCurve } from '../js/audio/instruments.js';
import { BASE_C_DEFAULT, OCTAVE_DEFAULT } from '../js/core/voicing.js';
import { MELODY_STAGES } from '../js/game/melodies.js';

const SR = 44100;

// ある周波数の強さ（ゴーツェル法）。区間 [a, b) 秒
function power(buf, ch, a, b, hz) {
  const d = buf.getChannelData(ch);
  const i0 = Math.floor(a * SR), i1 = Math.min(d.length, Math.floor(b * SR));
  const w = (2 * Math.PI * hz) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = i0; i < i1; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - i0)) / (i1 - i0));        // 窓（端をなめらかに）
    const s0 = d[i] * win + c * s1 - s2; s2 = s1; s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / ((i1 - i0) * (i1 - i0));
}
function rms(buf, a, b) {
  const d = buf.getChannelData(0), i0 = Math.floor(a * SR), i1 = Math.min(d.length, Math.floor(b * SR));
  let s = 0; for (let i = i0; i < i1; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
function peakOf(buf, a, b) {
  const d = buf.getChannelData(0), i0 = Math.floor(a * SR), i1 = Math.min(d.length, Math.floor(b * SR));
  let p = 0; for (let i = i0; i < i1; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
}
// 歪みの曲線に、正弦波（振幅 amp）を通したときの、倍音の割合（THD）。2〜20倍音
function thdOf(curve, amp) {
  const N = 4096, cycles = 16, y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = amp * Math.sin((2 * Math.PI * cycles * i) / N);
    const pos = ((x + 1) / 2) * (curve.length - 1), j = Math.min(curve.length - 2, Math.max(0, Math.floor(pos))), f = pos - j;
    y[i] = curve[j] * (1 - f) + curve[j + 1] * f;
  }
  const amplitude = (h) => { let re = 0, im = 0; for (let i = 0; i < N; i++) { const ph = (2 * Math.PI * cycles * h * i) / N; re += y[i] * Math.cos(ph); im += y[i] * Math.sin(ph); } return (Math.hypot(re, im) / N) * 2; };
  const a1 = amplitude(1); let rest = 0; for (let h = 2; h <= 20; h++) rest += amplitude(h) ** 2;
  return Math.sqrt(rest) / a1;
}

export async function run(t) {
  const table = new ChordTable(await (await fetch('../data/chords.json')).json());
  const presets = await (await fetch('../data/presets.json')).json();
  const board = (spec) => {
    const out = spec.trim().split(/\s+/).filter(Boolean).map((tok) => (tok === '-' ? null : tok === '→' ? table.repeatId : table.byName(tok).id));
    while (out.length < 8) out.push(null);
    return out;
  };
  const make = async (spec, { seconds = 6, drumId = 2, backingId = 1, bpm = 120, voicing = 'off', octave = null, mix = null, master = null, seeks = [], split = null, melody = null } = {}) => {
    const ctx = new OfflineAudioContext(2, SR * seconds, SR);
    const e = new AudioEngine(ctx, table, presets);
    await e.load('../audio/');
    e.getBoard = () => board(spec);
    if (split) e.getSplit = () => board(split);
    if (melody) e.setMelody(melody);
    e.setPatterns({ drumId, backingId }); e.setBpm(bpm);
    e.setVoicing(voicing);                                                    // 和音のつなぎ方（'off' / 'mid' / 'high'）
    if (octave !== null) e.octave = octave;
    if (mix) e.setMix(mix);                                                   // ドラム・バッキングの音量（0〜100%）
    if (master !== null) e.master.gain.value = master;                        // 全体の音量（アプリのはじめの値。最後の圧縮が、ほとんど働かない大きさ）
    // 鳴らす指示を記録する（音は、そのまま鳴らす）
    e.rec = { piano: [], drum: [], lead: [] };
    const pp = e.playPianoNote.bind(e), pd = e.playDrum.bind(e), pl = e.playLead.bind(e);
    e.playPianoNote = (n, w, d, v, dest) => { e.rec.piano.push({ note: n, when: w, dur: d, vel: v }); return pp(n, w, d, v, dest); };
    e.playDrum = (l, w, lv, dest) => { e.rec.drum.push({ lane: l, when: w, level: lv }); return pd(l, w, lv, dest); };
    e.playLead = (n, w, d, v) => { e.rec.lead.push({ note: n, when: w, dur: d }); return pl(n, w, d, v); };
    const buf = await e.renderOffline(seconds, { seeks });
    return { e, buf };
  };

  // ============ 音の高さの計画（2026-11-24）: エンジンが、ループ全体の計画どおりの高さで鳴らす ============
  {
    // ご指定の例（コンファーメーション）: ⅠM7 → Ⅶm7♭5 Ⅲ7（完全4度上）Ⅵm7（完全4度上）→ Ⅴm7 Ⅰ7（完全5度下。ループ後の ⅠM7 と同じ高さ）
    const { e } = await make('ⅠM7 → Ⅶm7-5 Ⅲ7 Ⅵm7 → Ⅴm7 Ⅰ7', { seconds: 8.4, drumId: 0, bpm: 240 });
    const st = e.events.filter((x) => x.type === 'step').map((x) => x.notes.length ? x.notes[0] : null);
    t.eq('コンファーメーション（ご指定の例）: 1周目のルートは C3 C3 B2 E3 A3 A3 G3 C3', st.slice(0, 8), [48, 48, 47, 52, 57, 57, 55, 48]);
    t.eq('2周目も、同じ高さ（最後の Ⅰ7 は、ループ後の ⅠM7 と同じ C3）', st.slice(8, 16), [48, 48, 47, 52, 57, 57, 55, 48]);
    const a = (await make('Ⅰ Ⅰ Ⅳ Ⅴ', { seconds: 2.2, drumId: 0, bpm: 240 })).e.events.filter((x) => x.type === 'step').slice(0, 4).map((x) => x.notes.join(','));
    const b = (await make('Ⅰ → Ⅳ Ⅴ', { seconds: 2.2, drumId: 0, bpm: 240 })).e.events.filter((x) => x.type === 'step').slice(0, 4).map((x) => x.notes.join(','));
    t.eq('同じ和音の連続（Ⅰ Ⅰ Ⅳ Ⅴ）と「→」（Ⅰ → Ⅳ Ⅴ）は、同じ音で鳴る', a, b);
  }

  // ============ スムーズボイスリーディング（中・大）と、低すぎる進行の引き上げ（2026-11-24）: エンジンが、その音で鳴らす ============
  {
    const stepsOf = async (spec, opts = {}) => (await make(spec, { seconds: 4.4, drumId: 0, bpm: 240, ...opts })).e.events.filter((x) => x.type === 'step').slice(0, spec.trim().split(/\s+/).length).map((x) => x.notes);
    t.eq('スムーズ（中）: Dm7 → G7 → CM7 を、DFAC / G（ルート）+ DFGB / CEGB で鳴らす', await stepsOf('Ⅱm7 Ⅴ7 ⅠM7', { voicing: 'mid' }), [[50, 53, 57, 60], [43, 50, 53, 55, 59], [48, 52, 55, 59]]);
    t.eq('スムーズ（大）: ご指定の例（Am7 Dm7 G7 C7 FM7）は、中と同じつなぎ（どれも、4度上）。ただし、ループのつなぎ目（FM7 → Am7）も、動きが少なくなるように選ぶので、最後の和音が、すこしちがう',
      (await stepsOf('Ⅵm7 Ⅱm7 Ⅴ7 Ⅰ7 ⅣM7', { voicing: 'high' })).slice(0, 3), [[57, 60, 64, 67], [50, 57, 60, 62, 65], [55, 59, 62, 65]]);
    t.eq('ふつう（off）: 変わらない（Dm7 → G7 → CM7 = D3 F3 A3 C4 / G3 B3 D4 F4 / C3 E3 G3 B3）', await stepsOf('Ⅱm7 Ⅴ7 ⅠM7'), [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59]]);
    // 音が、実際に鳴る（ルートの G2 = 43 は、別のベースとして鳴る）
    {
      const { e } = await make('Ⅱm7 Ⅴ7 ⅠM7', { seconds: 4.4, drumId: 0, bpm: 240, voicing: 'mid' });
      t.ok('スムーズ（中）: 別のベース（G2 = MIDI 43）が、実際に鳴る・ふつう（off）では、鳴らない', e.rec.piano.some((x) => x.note === 43) && !(await make('Ⅱm7 Ⅴ7 ⅠM7', { seconds: 4.4, drumId: 0, bpm: 240 })).e.rec.piano.some((x) => x.note === 43));
    }
    t.eq('分割したマス: 前半 Dm7・後半 G7 でも、スムーズにつなぐ（後半に、別のベースの G2）', await (async () => {
      const ctx = new OfflineAudioContext(2, SR * 3, SR);
      const e = new AudioEngine(ctx, table, presets);
      await e.load('../audio/');
      e.getBoard = () => board('Ⅱm7 ⅠM7'); e.getSplit = () => board('Ⅴ7 -'); e.setPatterns({ drumId: 0, backingId: 1 }); e.setBpm(240); e.setVoicing('mid');
      await e.renderOffline(3);
      return e.events.filter((x) => x.type === 'step' || x.type === 'half').slice(0, 3).map((x) => x.notes);
    })(), [[50, 53, 57, 60], [43, 50, 53, 55, 59], [48, 52, 55, 59]]);
    // 低すぎる進行（和音の音に C1 = MIDI 36 以下がある）は、進行ぜんぶを 1オクターブ上げる
    t.eq('低すぎる進行: 高さ -1（ルートが C2 〜）の Ⅰ Ⅳ は、C1（MIDI 36）を含むので、1オクターブ上がる（C3 E3 G3 C4 / F3 …）', (await stepsOf('Ⅰ Ⅳ', { octave: -1 })).map((n) => n[0]), [48, 53]);
    t.eq('低すぎる進行: C1 を含まない進行（Ⅳ Ⅴ。いちばん低い音は F2）は、そのまま', (await stepsOf('Ⅳ Ⅴ', { octave: -1 })).map((n) => n[0]), [41, 43]);
    t.eq('低すぎる進行: ふつうの高さ（C3 〜）の進行は、上がらない', (await stepsOf('Ⅰ Ⅳ')).map((n) => n[0]), [48, 53]);
  }

  // ============ パターンの文字 ============
  t.eq('マスの文字: C = 和音', parseCell('C'), { hit: true, shape: 'chord', soft: false });
  t.eq('マスの文字: d = ベース＋和音（弱く）', parseCell('d'), { hit: true, shape: 'bassChord', soft: true });
  t.eq('マスの文字: 3 = 3番目の音', parseCell('3').shape, 'tone3');
  t.eq('マスの文字: - は音ではない', parseCell('-').hit, false);
  t.eq('のばす長さ（C------- = 8マス）', holdSlots('C-------C-------', 0, 8), 8);
  t.eq('のばす長さは、ステップの終わりを超えない', holdSlots('C-------C-------', 0, 3), 3);

  // ============ 時計と和音 ============
  {
    const { e, buf } = await make('Ⅰ Ⅴ', { seconds: 4, drumId: 0 });          // ドラムなし（スネアの響きが、200Hz 前後の音の測定に混ざらないように）
    const steps = e.events.filter((x) => x.type === 'step');
    t.eq('ステップの合図は、1秒ごと（BPM120・1ステップ=2拍）', steps.slice(0, 4).map((s) => Math.round(s.time * 1000) / 1000), [0.02, 1.02, 2.02, 3.02]);
    t.eq('ステップ1・2のコード', steps.slice(0, 3).map((s) => s.chordId), [table.byName('Ⅰ').id, table.byName('Ⅴ').id, null]);
    t.eq('標準の高さは、ルートが C3〜B3（以前より 1オクターブ下）', [BASE_C_DEFAULT + 12 * OCTAVE_DEFAULT, OCTAVE_DEFAULT], [48, 0]);
    t.eq('Ⅰ の音（C3 E3 G3 C4）', steps[0].notes, [48, 52, 55, 60]);
    t.eq('Ⅴ は、ループのつなぎ目（Ⅴ → Ⅰ）が完全5度下の終止になる高さ（G3 B3 D4 G4）', steps[1].notes, [55, 59, 62, 67]);
    const beats = e.events.filter((x) => x.type === 'beat');
    t.eq('拍の合図（0.5秒ごと）', beats.slice(0, 4).map((b) => Math.round(b.time * 1000) / 1000), [0.02, 0.52, 1.02, 1.52]);
    t.ok('音が出ている（無音ではない）', rms(buf, 0, 2) > 0.01);
    // 周波数: Ⅰ（0.12〜0.95秒）に C3 E3 G3 が強く、半音ずれた音は弱い
    const strong = [48, 52, 55].map((m) => power(buf, 0, 0.12, 0.95, hz(m)));
    const weak = [49, 51, 54].map((m) => power(buf, 0, 0.12, 0.95, hz(m)));
    t.ok(`Ⅰ の構成音（C3 E3 G3）が、半音ずれた音より強い（強 ${strong.map((x) => x.toExponential(1))} / 弱 ${weak.map((x) => x.toExponential(1))}）`, Math.min(...strong) > 3 * Math.max(...weak));
    // Ⅴ（1.12〜1.95秒）に G3 B3 D4 が強い
    const strong2 = [55, 59, 62].map((m) => power(buf, 0, 1.12, 1.95, hz(m)));
    const weak2 = [56, 58, 63].map((m) => power(buf, 0, 1.12, 1.95, hz(m)));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    t.ok(`Ⅴ の構成音（G3 B3 D4）が強い（強 ${strong2.map((x) => x.toExponential(1))} / 弱 ${weak2.map((x) => x.toExponential(1))}）`, sum(strong2) > 8 * sum(weak2) && Math.min(...strong2) > 1.5 * Math.max(...weak2));
    t.ok('ステップの境目（1秒）で、新しい和音が立ち上がる', rms(buf, 1.02, 1.07) > 1.3 * rms(buf, 0.96, 1.01));
  }

  // ============ バッキングのパターン ============
  {
    const { e } = await make('Ⅰ', { seconds: 3, drumId: 0, backingId: 1 });
    const at0 = e.rec.piano.filter((p) => Math.abs(p.when - 0.02) < 1e-6).map((p) => p.note).sort((a, b) => a - b);
    t.eq('ロング: 先頭の1マスに、和音の4音が同時に', at0, [48, 52, 55, 60]);
    t.ok('ロング: 長さは 8マス × 0.95', Math.abs(e.rec.piano[0].dur - 0.95) < 1e-6);
    t.eq('ロング: 1周（8ステップ）の間に、先頭の和音は、ステップごと', e.rec.piano.filter((p) => p.note === 48).map((p) => Math.round(p.when * 1000) / 1000), [0.02]);
  }
  {
    const { e } = await make('Ⅰ', { seconds: 2, drumId: 0, backingId: 6 });          // アルペジオ(8分) 1-2-3-4-1-2-3-4-
    t.eq('アルペジオ: 1マス目から2マスおきに、和音の1〜4番目の音', e.rec.piano.slice(0, 4).map((p) => [Math.round((p.when - 0.02) * 1000) / 1000, p.note]), [[0, 48], [0.25, 52], [0.5, 55], [0.75, 60]]);
  }
  {
    const { e } = await make('Ⅰ', { seconds: 2, drumId: 0, backingId: 8 });          // ベース+コード
    // ベース+コード = B...C...B...C...（マス0 がベースだけ、マス4 が和音）
    const at = (slot) => e.rec.piano.filter((p) => Math.abs(p.when - (0.02 + slot * 0.125)) < 1e-6).map((p) => p.note).sort((a, b) => a - b);
    t.eq('ベース+コード: マス0 は、ベース（ルートの1オクターブ下 = 36。C2 より下には、ならない）だけ', at(0), [36]);
    t.eq('ベース+コード: マス4 は、和音', at(4), [48, 52, 55, 60]);
  }

  // ============ ドラム ============
  {
    const { e } = await make('', { seconds: 3, drumId: 2, backingId: 1 });          // 盤が空でも、ドラムは鳴る
    const k = e.rec.drum.filter((d) => d.lane === 'K').map((d) => Math.round((d.when - 0.02) * 1000) / 1000);
    t.eq('8ビートのキック（マス 0, 8, 10 = 0, 1.0, 1.25 秒）', k.slice(0, 3), [0, 1, 1.25]);
    t.eq('盤が空 → ピアノは鳴らない', e.rec.piano.length, 0);
    const s = e.rec.drum.filter((d) => d.lane === 'S').map((d) => Math.round((d.when - 0.02) * 1000) / 1000);
    t.eq('8ビートのスネア（マス 4, 12 = 0.5, 1.5 秒）', s.slice(0, 2), [0.5, 1.5]);
  }
  {
    const { buf } = await make('', { seconds: 3, drumId: 2, backingId: 1 });
    t.ok('ドラムだけでも、音が出ている', rms(buf, 0, 1) > 0.01);
  }

  // ============ 休みと「→」 ============
  {
    const { e, buf } = await make('Ⅰ - → Ⅴ', { seconds: 6, drumId: 0, backingId: 1 });
    const steps = e.events.filter((x) => x.type === 'step').slice(0, 4);
    t.eq('Ⅰ・空き・→（前が空きなので休み）・Ⅴ', steps.map((s) => s.chordId), [table.byName('Ⅰ').id, null, null, table.byName('Ⅴ').id]);
    t.ok('休みのステップ（1〜2.5秒あたり）は静か', rms(buf, 2.3, 2.9) < 0.25 * rms(buf, 0.1, 0.6));
  }
  {
    const { e } = await make('Ⅴ7 → Ⅰ', { seconds: 4, drumId: 0 });
    const ids = e.events.filter((x) => x.type === 'step').slice(0, 3).map((s) => s.chordId);
    t.eq('「→」は前のコードをのばす（Ⅴ7 → Ⅰ）', ids, [table.byName('Ⅴ7').id, table.byName('Ⅴ7').id, table.byName('Ⅰ').id]);
  }

  // ============ ボイスリーディング: 位置1に戻ったら、忘れる ============
  {
    const { e } = await make('Ⅰ Ⅳ Ⅴ Ⅵm Ⅰ Ⅳ Ⅴ Ⅵm', { seconds: 17, drumId: 0 });
    const steps = e.events.filter((x) => x.type === 'step');
    t.eq('2周目の先頭も、本来の高さ（1周目と同じ）', steps[8].notes, steps[0].notes);
    t.eq('1周目と2周目は、同じ並び', steps.slice(8, 16).map((s) => s.notes), steps.slice(0, 8).map((s) => s.notes));
  }

  // ============ ループの長さ: 4つの場所におさまるときは、4ステップでループ ============
  {
    const { e } = await make('Ⅰ Ⅳ Ⅴ Ⅵm', { seconds: 9.5, drumId: 0 });   // 既定は 8ステップ
    const first = e.events.filter((x) => x.type === 'step').map((s) => s.step);
    t.eq('既定は 8ステップでループ（1〜8番を通る）', first.slice(0, 10), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    const ctx = new OfflineAudioContext(2, SR * 9.5, SR);
    const e4 = new AudioEngine(ctx, table, presets);
    await e4.load('../audio/');
    e4.getBoard = () => board('Ⅰ Ⅳ Ⅴ Ⅵm'); e4.setPatterns({ drumId: 0, backingId: 1 }); e4.setBpm(120);
    e4.wantLoopSteps = () => 4;
    await e4.renderOffline(9.5);
    const steps = e4.events.filter((x) => x.type === 'step').map((s) => s.step);
    t.eq('4ステップでループ: 0 1 2 3 0 1 2 3 …（5〜8番の空きを待たない）', steps.slice(0, 10), [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    const times = e4.events.filter((x) => x.type === 'step').map((s) => s.time);
    t.eq('4ステップでループ: 1周は 4秒（BPM120）', Math.round((times[4] - times[0]) * 100) / 100, 4);
    // 途中で長さが変わる（周回の境目で、8ステップへ）
    const ctx2 = new OfflineAudioContext(2, SR * 14, SR);
    const e5 = new AudioEngine(ctx2, table, presets);
    await e5.load('../audio/');
    e5.getBoard = () => board('Ⅰ Ⅳ Ⅴ Ⅵm'); e5.setPatterns({ drumId: 0, backingId: 1 }); e5.setBpm(120);
    let want = 4; e5.wantLoopSteps = () => want;
    for (let i = 0; i < 32; i++) { e5.scheduleSlot(i, 0.1 + i * e5.slotSeconds()); }     // 4ステップを 1周ぶん（32マス）
    want = 8;                                                                            // 5番以降に駒が置かれた
    for (let i = 32; i < 32 + 96; i++) { e5.scheduleSlot(i, 0.1 + i * e5.slotSeconds()); }
    const seq = e5.events.filter((x) => x.type === 'step').map((s) => s.step);
    t.eq('周回の境目で、4 → 8ステップに切り替わる', seq.slice(0, 13), [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7, 0]);
  }

  // ============ 分割したマス（2026-11-23）: 1つのマスの、前半（1拍）・後半（1拍）を、別のコードで鳴らす ============
  {
    const mk = async (spec, splitSpec, backingId = 1) => {
      const ctx = new OfflineAudioContext(2, SR * 6, SR);
      const e = new AudioEngine(ctx, table, presets);
      await e.load('../audio/');
      e.getBoard = () => board(spec);
      e.getSplit = () => { const o = (splitSpec || '').trim().split(/\s+/).filter(Boolean).map((tok) => (tok === '-' ? null : table.byName(tok).id)); while (o.length < 8) o.push(null); return o; };
      e.setPatterns({ drumId: 0, backingId }); e.setBpm(120);
      e.rec = [];
      e.playNote = (note, when, dur, vel) => { e.rec.push({ note, when, dur, vel }); };       // 鳴らす指示だけを記録する
      for (let i = 0; i < 8 * 4; i++) e.scheduleSlot(i, 0.1 + i * e.slotSeconds());           // 4ステップぶん
      return e;
    };
    const e = await mk('Ⅰ Ⅴ7 Ⅵm -', '- Ⅲm7');
    const ss = e.slotSeconds();
    const halves = e.events.filter((x) => x.type === 'half');
    t.eq('分割したマス: 2拍目の頭（4マス後）に、後半のコードへ切りかわる（step 1・Ⅲm7）', [halves.length, halves[0].step, halves[0].chordId, Math.round((halves[0].time - (0.1 + 8 * ss)) / ss)], [1, 1, table.byName('Ⅲm7').id, 4]);
    const noteTimes = (step) => e.rec.filter((r) => r.when >= 0.1 + step * 8 * ss - 1e-6 && r.when < 0.1 + (step + 1) * 8 * ss - 1e-6);
    const s1 = noteTimes(1);
    const firstHalf = s1.filter((r) => r.when < 0.1 + 8 * ss + 4 * ss - 1e-6), secondHalf = s1.filter((r) => r.when >= 0.1 + 8 * ss + 4 * ss - 1e-6);
    const pcs = (list) => [...new Set(list.map((r) => r.note % 12))].sort((a, b) => a - b);
    t.eq('分割したマス: 前半の音は Ⅴ7（ソ・シ・レ・ファ）・後半の音は Ⅲm7（ミ・ソ・シ・レ）。同じ盤の、分割しないマスは、1つのコードだけ', [pcs(firstHalf), pcs(secondHalf), pcs(noteTimes(0)).length], [[2, 5, 7, 11], [2, 4, 7, 11], 3]);
    const whole = noteTimes(0)[0], cut = firstHalf[0];
    t.eq('分割したマス: 前半の音は、2拍目の頭で切る（分割しないマスの、ちょうど半分の長さ）', Math.round((cut.dur / whole.dur) * 100) / 100, 0.5);
    t.eq('分割したマス: ロングのパターン（音は、ステップの頭だけ）でも、後半は、無音にならず、前半の音を、後半のコードで鳴らし直す（長さは、2拍目の残り）', [secondHalf.length > 0, Math.round((secondHalf[0].dur / whole.dur) * 100) / 100], [true, 0.5]);
    t.eq('分割したマス: ほかのマス（0・2番）は、これまでどおり（half の知らせがない）', e.events.filter((x) => x.type === 'half' && x.step !== 1).length, 0);
    // 「→」は、前のマスの、最後のコード（分割したマスは、後半）を、くり返す
    const e2 = await mk('Ⅰ Ⅴ7 → -', '- Ⅲm7');
    const st2 = e2.events.filter((x) => x.type === 'step');
    t.eq('分割したマスのあとの「→」: 後半のコード（Ⅲm7）を、のばす', st2[2].chordId, table.byName('Ⅲm7').id);
    // 8ビートなど、2拍目にも音があるパターンは、鳴らし直さず、そのパターンの音を、後半のコードで鳴らす
    const arpeggio = presets.backings.find((b) => /アルペ|8分|8ビート/.test(b.name) && /[B1-4Cc]/.test(b.cells.slice(4, 8)));
    if (arpeggio) { const e3 = await mk('Ⅰ Ⅴ7 Ⅵm -', '- Ⅲm7', arpeggio.id); const sec = e3.rec.filter((r) => r.when >= 0.1 + 12 * ss - 1e-6 && r.when < 0.1 + 16 * ss - 1e-6); t.ok(`分割したマス: 2拍目にも音があるパターン（${arpeggio.name}）は、後半のコード（Ⅲm7）の音で鳴る`, sec.length > 0 && sec.every((r) => [2, 4, 7, 11].includes(r.note % 12) || r.note % 12 === 4)); }
    // 分割していない盤は、これまでと、まったく同じ
    const e4 = await mk('Ⅰ Ⅴ7 Ⅵm -', '');
    t.eq('分割がない盤: half の知らせは出ない', e4.events.filter((x) => x.type === 'half').length, 0);
  }

  // ============ 音色: どの音色も鳴る・音色ごとに、音が違う・ドライブシンセは、拍の頭で音が引っ込む ============
  {
    t.eq('音色は7種類（ピアノ・エレピ・ギター・オルガン・ストリングス・ドライブシンセ・ベル）', INSTRUMENT_IDS, ['piano', 'epiano', 'guitar', 'organ', 'strings', 'drive', 'bell']);
    t.ok('どの音色にも、名前と説明がある', INSTRUMENTS.every((i) => i.name.length > 0 && i.desc.length > 4));
    const spectrum = (buf, a, b) => [110, 220, 440, 880, 1760, 3520].map((f) => power(buf, 0, a, b, f));
    const renderOne = async (id, { seconds = 2.2, note = 60, dur = 1.5, vel = 90, chordNotes = null } = {}) => {
      const ctx = new OfflineAudioContext(2, SR * seconds, SR);
      const e = new AudioEngine(ctx, table, presets);
      await e.load('../audio/');
      e.setInstrument(id);
      e.bpm = 120; e.refTime = 0.1; e.refSlot = 0;                          // 拍の頭 = 0.1秒、0.6秒、1.1秒 …
      const notes = chordNotes || [note];
      notes.forEach((n, i) => e.playNote(n, 0.1, dur, vel, e.pianoBus, { idx: i, chord: notes.length > 1 }));
      const buf = await ctx.startRendering();
      return { e, buf };
    };
    const sig = {};
    for (const id of INSTRUMENT_IDS) {
      const { buf } = await renderOne(id);
      const r = rms(buf, 0.1, 1.0);
      sig[id] = r;
      t.ok(`音色「${id}」: 音が鳴る（大きさ ${r.toFixed(4)}）`, r > 0.004);
      let peak = 0; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      t.ok(`音色「${id}」: 割れない・大きすぎない（ピーク ${peak.toFixed(2)}）`, peak < 0.98);
      t.ok(`音色「${id}」: 値が、おかしくならない（NaN なし）`, Number.isFinite(peak));
    }
    // 音色ごとに、音が違う: 音の成分（28個の高さ）と、立ち上がり・消え方の3つで、どの2つの音色も、はっきり違う
    const feat = {};
    for (const id of INSTRUMENT_IDS) {
      const { buf } = await renderOne(id, { note: 57 });
      const v = Array.from({ length: 28 }, (_, k) => Math.sqrt(power(buf, 0, 0.12, 0.8, 110 * Math.pow(2, k / 4))));
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) + 1e-12;
      feat[id] = { spec: v.map((x) => x / n), attack: rms(buf, 0.1, 0.13) / rms(buf, 0.4, 0.5), decay: rms(buf, 1.2, 1.4) / rms(buf, 0.3, 0.4), loud: rms(buf, 0.1, 1.0) };
    }
    let minDist = 99, minPair = '';
    for (let i = 0; i < INSTRUMENT_IDS.length; i++) for (let j = i + 1; j < INSTRUMENT_IDS.length; j++) {
      const a = feat[INSTRUMENT_IDS[i]], b = feat[INSTRUMENT_IDS[j]];
      const cos = a.spec.reduce((s, x, k) => s + x * b.spec[k], 0);
      const dist = (1 - cos) * 10 + Math.abs(a.attack - b.attack) + Math.abs(a.decay - b.decay);
      if (dist < minDist) { minDist = dist; minPair = `${INSTRUMENT_IDS[i]}・${INSTRUMENT_IDS[j]}`; }
    }
    t.ok(`どの2つの音色も、はっきり違う（いちばん近い組: ${minPair}、違いの大きさ ${minDist.toFixed(2)}）`, minDist > 0.3);
    const loudRatio = INSTRUMENT_IDS.filter((id) => id !== 'piano').map((id) => feat[id].loud / feat.piano.loud);
    t.ok(`どの音色も、ピアノと、だいたい同じ大きさ（ピアノの ${Math.min(...loudRatio).toFixed(2)}〜${Math.max(...loudRatio).toFixed(2)} 倍）`, Math.min(...loudRatio) > 0.6 && Math.max(...loudRatio) < 2.0);
    // 時間の形: ピアノ・ギター・ベルは、叩いたあと減っていく。ストリングスは、ゆっくり立ち上がる
    const st = await renderOne('strings'); const gt = await renderOne('guitar');
    t.ok('ストリングス: ゆっくり立ち上がる（最初の 0.05秒は、0.4秒ごろより、ずっと小さい）', rms(st.buf, 0.1, 0.15) < 0.35 * rms(st.buf, 0.5, 0.6));
    t.ok('ギター: はじいた瞬間が一番大きく、だんだん小さくなる', rms(gt.buf, 0.1, 0.2) > 1.6 * rms(gt.buf, 1.1, 1.3));
    // かき鳴らし（和音の音が、少しずつずれる）: 3音目は、1音目より、少しあとに始まる
    const chordG = await renderOne('guitar', { chordNotes: [48, 52, 55, 60], seconds: 1.0, dur: 0.7 });
    const dd = chordG.buf.getChannelData(0); let first = -1;
    for (let i = 0; i < dd.length; i++) { if (Math.abs(dd[i]) > 0.01) { first = i / SR; break; } }
    t.ok(`ギターの和音は、かき鳴らす（最初の音は 0.1 秒ごろ: ${first.toFixed(3)}）`, first > 0.095 && first < 0.13);
    // ドライブシンセ（2026-11-18 に作り直し）: 拍の頭で、一瞬だけ引っ込んで、すぐ戻る（サイドチェイン）。以前は、拍の頭から半拍近く引っ込んだままで、立ち上がりが遅かった
    //   拍の頭 = 0.1, 0.6, 1.1, 1.6 秒（BPM120）。マスターのコンプレッサーの遅れ（6ms）を見込んで、拍の頭から 0.012 秒あとから測る
    //   以前の記録（同じ測り方。以前の曲線から計算）: 拍の頭から半分の大きさに戻るまで 約 0.42 秒（拍の約8割）
    const dr = await renderOne('drive', { seconds: 2.4, dur: 2.0, chordNotes: [48, 55, 60] });
    const LAT = 0.012;
    const envAfter = (buf, head, n = 80) => Array.from({ length: n }, (_, k) => rms(buf, head + LAT + k * 0.005, head + LAT + k * 0.005 + 0.012));
    const timeTo = (env, frac) => { const mx = Math.max(...env); const i = env.findIndex((v) => v >= frac * mx); return i < 0 ? null : i * 0.005; };
    for (const head of [0.6, 1.1, 1.6]) {
      const env = envAfter(dr.buf, head);
      const dip = env.slice(0, 3).reduce((a, b2) => Math.min(a, b2), 9) / Math.max(...env.slice(8, 40));
      t.ok(`ドライブシンセ: 拍の頭（${head}秒）で、一瞬、引っ込む（拍の頭の大きさ / そのあとの大きさ = ${dip.toFixed(2)} < 0.35）`, dip < 0.35);
      t.ok(`ドライブシンセ: 拍の頭（${head}秒）から 0.1 秒以内に、半分の大きさまで戻る（${timeTo(env, 0.5)}秒）。以前は 約 0.4 秒`, timeTo(env, 0.5) !== null && timeTo(env, 0.5) <= 0.1);
      t.ok(`ドライブシンセ: 拍の頭（${head}秒）から 0.16 秒以内に、7割まで戻る（${timeTo(env, 0.75)}秒）`, timeTo(env, 0.75) !== null && timeTo(env, 0.75) <= 0.16);
    }
    const env1 = envAfter(dr.buf, 0.6);
    const centroid = env1.reduce((a, v, i) => a + v * v * (i * 0.005 + 0.006), 0) / env1.reduce((a, v) => a + v * v, 0) / 0.5;
    t.ok(`ドライブシンセ: 1拍のうち、音が鳴っているのは、ほとんど前半〜中ほど（エネルギーの重心が拍の ${(centroid * 100).toFixed(0)}% の位置。以前は 約 80%）`, centroid < 0.7);
    // 最初の拍（音が始まる 0.1 秒）も、すぐ聞こえる（立ち上がりが遅れない）
    const env0 = envAfter(dr.buf, 0.1);
    t.ok(`ドライブシンセ: 和音の入り（0.1 秒）も、0.1 秒以内に、半分の大きさになる（${timeTo(env0, 0.5)}秒）`, timeTo(env0, 0.5) !== null && timeTo(env0, 0.5) <= 0.1);
    // 拍の頭は、「ツン」と明るい（フィルターのエンベロープ）: 拍の頭のすぐあと（0.04〜0.12 秒）の高い成分の割合 > 拍の終わり近く（0.34〜0.46 秒）
    const hiShare = (a, c) => { let lo = 0, hi = 0; for (let f = 110; f < 9000; f *= 1.12) { const pw = power(dr.buf, 0, a, c, f); if (f < 2000) lo += pw; else hi += pw; } return hi / (lo + hi); };
    const brightEarly = hiShare(0.64, 0.72), brightLate = hiShare(0.94, 1.06);
    t.ok(`ドライブシンセ: 拍の頭は、あとより明るい（高い成分の割合 ${brightEarly.toFixed(3)} > ${brightLate.toFixed(3)} の 1.1 倍）`, brightEarly > 1.1 * brightLate);
    // 拍の長さに合わせて動く（BPM を変えても、拍の何割かで戻る）
    for (const bpm of [90, 150]) {
      const ctx2 = new OfflineAudioContext(2, SR * 3, SR);
      const e2 = new AudioEngine(ctx2, table, presets); await e2.load('../audio/');
      e2.setInstrument('drive'); e2.bpm = bpm; e2.refTime = 0.1; e2.refSlot = 0;
      [48, 55, 60].forEach((n, i) => e2.playNote(n, 0.1, 2.4, 90, e2.pianoBus, { idx: i, chord: true }));
      const bb = await ctx2.startRendering(); const beat = 60 / bpm;
      const ee = Array.from({ length: 80 }, (_, k) => rms(bb, 0.1 + beat + LAT + k * 0.005, 0.1 + beat + LAT + k * 0.005 + 0.012));
      t.ok(`ドライブシンセ: BPM${bpm}（1拍 ${beat.toFixed(3)} 秒）でも、拍の頭から、拍の 2割以内に、半分の大きさまで戻る（${timeTo(ee, 0.5)}秒）`, timeTo(ee, 0.5) !== null && timeTo(ee, 0.5) <= 0.2 * beat);
    }
    // 歪み（ざらつき）は、2026-11-17 に強めた。以前の記録（同じ測り方）と比べる
    //   波のとがり（クレストファクター。小さいほど、つぶれている）= 3.27（11-17 より前）、歪みの曲線の THD（振幅 0.6）= 0.177（11-17 より前）
    const crest = peakOf(dr.buf, 1.0, 1.1) / rms(dr.buf, 1.0, 1.1);
    t.ok(`ドライブシンセ: 歪みが、2026-11-17 より前より強い（波のとがり ${crest.toFixed(2)}。前は 3.27。つぶれるほど、小さくなる）`, crest < 3.1 && crest > 1.8);
    const curve = driveCurve();
    const thd06 = thdOf(curve, 0.6), thd10 = thdOf(curve, 1.0);
    t.ok(`ドライブシンセ: 歪みの曲線の倍音の割合（THD）が、以前（0.177）より、2〜6割ほど増えた（振幅 0.6 で ${thd06.toFixed(3)}）。強すぎもしない`, thd06 > 0.177 * 1.2 && thd06 < 0.177 * 1.8 && thd10 > 0.273 && thd10 < 0.45);
    t.ok('ドライブシンセ: 歪みの曲線は、0 を通り（直流を作らない）、-1〜1 におさまる', Math.abs(curve[Math.floor((curve.length - 1) / 2)]) < 0.03 && Math.max(...curve) <= 1.0001 && Math.min(...curve) >= -1.0001);
    // 通常のシンセ（ストリングス）は、拍で引っ込まない
    const sv = await renderOne('strings', { seconds: 2.4, dur: 2.0, chordNotes: [48, 55, 60] });
    t.ok('ストリングスは、拍の頭でも、引っ込まない', rms(sv.buf, 0.62, 0.66) > 0.7 * rms(sv.buf, 1.04, 1.08));
    // BPM が変わっても、拍の位置が、ずれない
    { const ctx = new OfflineAudioContext(1, SR, SR); const e = new AudioEngine(ctx, table, presets); e.refTime = 0.1; e.refSlot = 0; e.bpm = 120;
      t.eq('拍の位置: 0.1秒 = 0拍、0.6秒 = 1拍（BPM120）', [e.beatPosition(0.1), e.beatPosition(0.6)], [0, 1]); }
    t.eq('知らない音色は、受け付けない', (() => { const ctx = new OfflineAudioContext(1, SR, SR); const e = new AudioEngine(ctx, table, presets); return [e.setInstrument('xxx'), e.instrumentId, e.setInstrument('guitar'), e.instrumentId]; })(), [false, 'piano', true, 'guitar']);
    // 音色を変えても、ピアノの試聴・バッキングの流れは、これまでどおり
    const gtr = await make('Ⅰ Ⅴ', { seconds: 3, drumId: 0 });
    t.ok('ピアノ（標準）のバッキングは、これまでどおり鳴る', gtr.e.instrumentId === 'piano' && rms(gtr.buf, 0.1, 0.8) > 0.01);
  }

  // ============ メロディ（「メロディにコードをつける」ステージ）============
  {
    const stage = MELODY_STAGES[0];                          // はじめてのメロディ
    const mel = stage.melody;
    const makeMel = async (spec, { seconds = 9, melody = mel, loopSteps = 8 } = {}) => {
      const ctx = new OfflineAudioContext(2, SR * seconds, SR);
      const e = new AudioEngine(ctx, table, presets);
      await e.load('../audio/');
      e.getBoard = () => board(spec);
      e.setPatterns({ drumId: 0, backingId: 1 }); e.setBpm(120);
      e.wantLoopSteps = () => loopSteps;
      e.setMelody(melody);
      e.leads = [];
      const pl = e.playLead.bind(e);
      e.playLead = (n, w, d, v) => { e.leads.push({ note: n, when: w, dur: d, vel: v }); return pl(n, w, d, v); };
      const buf = await e.renderOffline(seconds);
      return { e, buf };
    };
    const { e, buf } = await makeMel('Ⅰ Ⅵm Ⅳ Ⅴ Ⅰ Ⅳ Ⅴ Ⅰ');
    const slotSec = 60 / 120 / 4;
    const first = e.leads.filter((l) => l.when < 0.02 + 8 * 8 * slotSec - 1e-6);          // 1周ぶん（64マス = 8秒）
    t.eq('メロディ: 1周に、メロディの音の数だけ鳴る', first.length, mel.notes.length);
    t.eq('メロディ: 音の高さ・始まり・長さが、データどおり（BPM120: 1マス = 0.125秒）',
      first.map((l) => [l.note, Math.round((l.when - 0.02) / slotSec), Math.round((l.dur / slotSec) * 100) / 100]),
      mel.notes.map(([st, len, midi]) => [midi, st, Math.round(len * 0.97 * 100) / 100]));
    t.ok('メロディ: 2周目も、同じ位置で鳴る（8秒あと）', e.leads.some((l) => Math.abs(l.when - (0.02 + 8)) < 1e-6 && l.note === mel.notes[0][2]));
    // 音の中身: 長い音 ミ（E5 = 659Hz。マス 32〜37 = 4.0〜4.75秒）が、聞こえる。和音（C3〜）と別の高さ
    const eHz = hz(76), near = [hz(75), hz(77)].map((f) => power(buf, 0, 4.1, 4.7, f));
    t.ok(`メロディ: 長いミ（E5）が、半音ずれた音（レ♯・ファ）より、はっきり強い（E5 ${power(buf, 0, 4.1, 4.7, eHz).toExponential(1)} / 隣 ${near.map((x) => x.toExponential(1))}）`, power(buf, 0, 4.1, 4.7, eHz) > 5 * Math.max(...near));
    // 止める: 休み（メロディなし）のときは、鳴らない
    const none = await makeMel('Ⅰ Ⅵm Ⅳ Ⅴ Ⅰ Ⅳ Ⅴ Ⅰ', { melody: null });
    t.eq('メロディなし（null）のときは、鳴らない', none.e.leads.length, 0);
    // 4ステップでループするとき（チュートリアル）は、鳴らさない（メロディは 8ステップの周回のため）
    const four = await makeMel('Ⅰ Ⅵm Ⅳ Ⅴ', { loopSteps: 4 });
    t.eq('4ステップのループでは、鳴らさない', four.e.leads.length, 0);
    // メロディ専用のバス（音量を、別に動かせる）。止めるとき、いっしょに消える
    t.ok('メロディ専用のバスがある（音量を別に変えられる）', !!e.melodyBus && typeof e.setVolumes === 'function');
    // 音の大きさ: 和音のピアノと、だいたい同じ（0.5〜2倍）
    const ctxL = new OfflineAudioContext(2, SR * 2, SR); const eL = new AudioEngine(ctxL, table, presets); await eL.load('../audio/');
    eL.setMelody({ notes: [[0, 8, 76]] }); eL.bpm = 120; eL.playLead(76, 0.1, 0.9);
    const bl = await ctxL.startRendering();
    const pn = await make('Ⅰ', { seconds: 2, drumId: 0 });
    const rl = rms(bl, 0.15, 0.9), rp = rms(pn.buf, 0.15, 0.9);
    t.ok(`メロディの音は、ピアノの和音より、少し大きいくらい（目立つが、つぶさない。メロディ ${rl.toFixed(3)} / ピアノ ${rp.toFixed(3)} = ${(rl / rp).toFixed(2)} 倍。0.8〜1.7 倍）`, rl > 0.8 * rp && rl < 1.7 * rp);
    // lead は、コードの音色の一覧には、出さない
    t.ok('メロディの音色（lead）は、コードの音色の一覧に出ない', !INSTRUMENT_IDS.includes('lead'));
    // loopSlotAt: 時刻 → 周回の何マス目か
    { const c3 = new OfflineAudioContext(1, SR, SR); const e3 = new AudioEngine(c3, table, presets); e3.bpm = 120; e3.refTime = 0.5; e3.refSlot = 0;
      t.eq('周回の位置: 0.5秒 = 0マス、1.5秒 = 8マス、8.5秒 = 0マス（1周 = 64マス = 8秒）', [e3.loopSlotAt(0.5), e3.loopSlotAt(1.5), e3.loopSlotAt(8.5)], [0, 8, 0]); }
  }

  // ============ BPM ============
  {
    const { e } = await make('Ⅰ Ⅴ', { seconds: 3, bpm: 60 });
    const steps = e.events.filter((x) => x.type === 'step');
    t.eq('BPM 60 → 1ステップ 2秒', [Math.round(steps[1].time * 1000) / 1000], [2.02]);
  }

  // ============ 試聴（駒を置いたときのコード）: 演奏中（ほかのコードが鳴っている間）は、小さく・短く・やわらかく ============
  {
    const trial = async (playing, cur) => {
      const ctx = new OfflineAudioContext(2, SR * 3, SR);
      const e = new AudioEngine(ctx, table, presets);
      await e.load('../audio/');
      e.playing = playing; e.cur = cur;
      const rec = [];
      const pp = e.playPianoNote.bind(e);
      e.playPianoNote = (n, w, d, v, dest) => { rec.push({ note: n, dur: d, vel: v, soft: dest === e.duckFilter }); return pp(n, w, d, v, dest); };
      const level = e.auditionLevel();
      e.audition(table.byName('Ⅰ').id, 0.1);
      const buf = await ctx.startRendering();
      return { level, rec, buf };
    };
    const idle = await trial(false, null);
    const busy = await trial(true, { step: 0 });
    const rest = await trial(true, null);
    t.eq('止まっているとき、試聴は、ふつうの大きさ（倍率 1）', idle.level, 1);
    t.eq('演奏中でも、いまが休み（コードが鳴っていない）なら、ふつうの大きさ', rest.level, 1);
    t.ok('演奏中（ほかのコードが鳴っている）は、試聴を小さくする（倍率 0.5 以下）', busy.level <= 0.5 && busy.level > 0);
    t.ok('演奏中の試聴は、音の強さ（ベロシティ）が、ふつうより小さい', busy.rec.every((x, i) => x.vel < idle.rec[i].vel * 0.6));
    t.ok('演奏中の試聴は、音が短い', busy.rec.every((x, i) => x.dur < idle.rec[i].dur * 0.7));
    t.ok('演奏中の試聴は、やわらかく削る（高い音を削る出口を通る）。ふつうは通らない', busy.rec.every((x) => x.soft) && idle.rec.every((x) => !x.soft));
    t.eq('同じ和音（Ⅰ）の音の数は変わらない', busy.rec.map((x) => x.note), idle.rec.map((x) => x.note));
    const rIdle = rms(idle.buf, 0.1, 0.9), rBusy = rms(busy.buf, 0.1, 0.9);
    t.ok(`演奏中の試聴は、ふつうの 4割以下の大きさ（実際の音: ${rBusy.toFixed(4)} / ${rIdle.toFixed(4)}）`, rIdle > 0.01 && rBusy < 0.4 * rIdle);
    t.ok('演奏中の試聴も、ちゃんと鳴る（消えてしまわない）', rBusy > 0.001);
  }

  // ============ 効果音（技の音）============
  {
    const ctx = new OfflineAudioContext(2, SR * 3, SR);
    const e = new AudioEngine(ctx, table, presets);
    await e.load('../audio/');
    const sfx = new Sfx(e);
    sfx.trick(0.1, [60, 64, 67, 72], 1, true); sfx.place(1.5); sfx.combo(2.0, 3); sfx.clear(2.3);
    const buf = await ctx.startRendering();
    t.ok('技の効果音が鳴る', rms(buf, 0.1, 0.5) > 0.004);
    t.ok('置く音が鳴る', rms(buf, 1.5, 1.6) > 0.004);
    {
      const c2 = new OfflineAudioContext(2, SR * 1, SR);
      const e2 = new AudioEngine(c2, table, presets); await e2.load('../audio/');
      new Sfx(e2).huh(0.1);
      const b2 = await c2.startRendering();
      t.ok('「？」の効果音が鳴る（小さな音）', rms(b2, 0.1, 0.5) > 0.002 && rms(b2, 0.1, 0.5) < 0.2);
    }
    // きらっと鳴る高い音は、コードの構成音（C・E・G）のまま
    const p = [72, 76, 79].map((m) => power(buf, 0, 0.1, 0.6, hz(m + 12)));        // 1オクターブ上（C6 E6 G6）
    const q = [73, 75, 78].map((m) => power(buf, 0, 0.1, 0.6, hz(m + 12)));
    t.ok(`技の音の高い響きは、コードの音（強 ${p.map((x) => x.toExponential(1))} / 弱 ${q.map((x) => x.toExponential(1))}）`, Math.max(...p) > 2 * Math.max(...q));
  }
  // ---- 全体の音量（上のバーの「音」。2026-11-18）----
  {
    t.eq('音量: 100% = これまでの 50% の大きさ（MASTER_GAIN × 0.25）。2026-11-24 に、目盛りを 2倍の見かたにした', masterGainFor(100, false), MASTER_GAIN * VOLUME_TOP * VOLUME_TOP);
    t.eq('音量: はじめの値 50% の出音は、これまでの 25% と、同じ（MASTER_GAIN × 0.0625）', [DEFAULT_VOLUME, Math.abs(masterGainFor(DEFAULT_VOLUME, false) - MASTER_GAIN * 0.25 * 0.25) < 1e-12], [50, true]);
    t.eq('音量: ミュートは 0（音量のバーの位置にかかわらず）', [masterGainFor(100, true), masterGainFor(40, true)], [0, 0]);
    t.eq('音量: 0% は 0', masterGainFor(0, false), 0);
    t.ok('音量: 50% は、100% の、およそ −12dB（2乗の曲線）', Math.abs(20 * Math.log10(masterGainFor(50, false) / masterGainFor(100, false)) + 12.04) < 0.05);
    t.ok('音量: バーを上げるほど、大きくなる（単調）', [0, 10, 25, 50, 75, 100].map((p) => masterGainFor(p, false)).every((g, i, a) => i === 0 || g > a[i - 1]));
    t.eq('音量: 範囲の外・変な値は、おさまる（-20 → 0・300 → 100%・NaN → 100%）', [masterGainFor(-20), masterGainFor(300), masterGainFor(NaN)], [0, masterGainFor(100, false), masterGainFor(100, false)]);
    t.ok('ドラムの音の通り道は、ピアノ・メロディ（0.9）より小さい（約 −3dB。ご指摘: ドラムが大きい）', DRUM_BUS_GAIN < 0.9 && DRUM_BUS_GAIN > 0.4);
    // 実際の音: マスターのゲインを変えると、書き出した音が、その比率で小さくなる
    const level = async (pct) => {
      const c = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(c, table, presets); await e.load('../audio/');
      e.master.gain.value = masterGainFor(pct, false);
      e.audition(table.byName('Ⅰ').id, 0.05, 0.8);
      return rms(await c.startRendering(), 0.05, 0.6);
    };
    const full = await level(100), half = await level(50), off = await level(0);
    t.ok(`音量: 50% は 100% の約 1/4 の大きさで鳴る（比 ${(half / full).toFixed(3)}）。0% は無音（${off.toExponential(1)}）`, full > 0.01 && Math.abs(half / full - 0.25) < 0.03 && off < 1e-6);
  }
  // ---- ドラム・バッキングの音量（2026-11-24 夜。ご依頼: 音量のポップアップで、ドラムとバッキングを、別々に）----
  {
    t.eq('ミックス: はじめの値 50% = 標準の大きさ（倍率 1）・100% = 2倍・0% = 無音', [mixGainFor(MIX_DEFAULT), mixGainFor(100), mixGainFor(0), mixGainFor(25)], [1, 2, 0, 0.5]);
    t.eq('ミックス: 範囲の外・変な値は、おさまる（-5 → 0・500 → 2倍・NaN → 標準）', [mixGainFor(-5), mixGainFor(500), mixGainFor(NaN)], [0, 2, 1]);
    t.eq('ミックス: 保存のはじめの値（DEFAULT_MIX）= 標準の大きさ。はじめの出音は、これまでと変わらない', [DEFAULT_MIX, MIX_DEFAULT, mixGainFor(DEFAULT_MIX)], [50, 50, 1]);
    t.ok('ミックス: ドラム・バッキングの通り道は、別々のバス。試聴・メロディのバスとも別', new Set([DRUM_BUS_GAIN, PIANO_BUS_GAIN]).size === 2 && (() => { const c = new OfflineAudioContext(2, 100, SR); const e = new AudioEngine(c, table, presets); return e.pianoBus !== e.drumBus && e.pianoBus !== e.auditionBus && e.pianoBus !== e.melodyBus && typeof e.setMix === 'function'; })());
    const rmsOf = async (opts) => rms((await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 4, bpm: 120, master: masterGainFor(DEFAULT_VOLUME), ...opts })).buf, 0.2, 3.6);
    // ドラムだけを鳴らして、ドラムのバーを動かす
    const d0 = await rmsOf({ backingId: 0, mix: { drums: 0 } }), d25 = await rmsOf({ backingId: 0, mix: { drums: 25 } }), d50 = await rmsOf({ backingId: 0, mix: { drums: 50 } }), d100 = await rmsOf({ backingId: 0, mix: { drums: 100 } });
    t.ok(`ミックス: ドラム 0% は、ほぼ無音（${d0.toExponential(1)}。変える瞬間の、ごく短い名残だけ）・25% < 50% < 100%（${d25.toFixed(4)} / ${d50.toFixed(4)} / ${d100.toFixed(4)}）`, d0 < d50 * 0.01 && d25 < d50 && d50 < d100 && d50 > 0.001);
    t.ok(`ミックス: ドラム 100% は 50% の約 2倍（比 ${(d100 / d50).toFixed(2)}。アプリのはじめの全体の音量で）`, d100 / d50 > 1.6 && d100 / d50 < 2.1);
    // バッキングだけを鳴らして、バッキングのバーを動かす
    const b0 = await rmsOf({ drumId: 0, mix: { backing: 0 } }), b25 = await rmsOf({ drumId: 0, mix: { backing: 25 } }), b50 = await rmsOf({ drumId: 0, mix: { backing: 50 } }), b100 = await rmsOf({ drumId: 0, mix: { backing: 100 } });
    t.ok(`ミックス: バッキング 0% は、ほぼ無音（${b0.toExponential(1)}）・25% < 50% < 100%（${b25.toFixed(4)} / ${b50.toFixed(4)} / ${b100.toFixed(4)}）`, b0 < b50 * 0.01 && b25 < b50 && b50 < b100 && b50 > 0.001);
    t.ok(`ミックス: バッキング 100% は 50% の約 2倍（比 ${(b100 / b50).toFixed(2)}）`, b100 / b50 > 1.6 && b100 / b50 < 2.1);
    // 別々: ドラムのバーは、バッキングだけの演奏に効かない。バッキングのバーは、ドラムだけの演奏に効かない
    const bx = await rmsOf({ drumId: 0, mix: { drums: 0 } }), by = await rmsOf({ drumId: 0, mix: { drums: 100 } });
    const dx = await rmsOf({ backingId: 0, mix: { backing: 0 } }), dy = await rmsOf({ backingId: 0, mix: { backing: 100 } });
    t.ok(`ミックス: ドラムのバーは、バッキングに効かない・バッキングのバーは、ドラムに効かない（${bx.toFixed(5)} = ${by.toFixed(5)} / ${dx.toFixed(5)} = ${dy.toFixed(5)}）`, Math.abs(bx - by) < bx * 1e-4 && Math.abs(dx - dy) < dx * 1e-4);
    // 標準（50%・50%）で、バーを動かさない演奏と、同じ音
    const base = await rmsOf({}), mixed = await rmsOf({ mix: { drums: 50, backing: 50 } });
    t.ok(`ミックス: 50%・50% は、バーを動かさないときと、同じ音（${base.toFixed(5)} = ${mixed.toFixed(5)}）`, Math.abs(base - mixed) < base * 1e-4);
    // 試聴（駒を置いたときの音）は、バッキングのバーを 0 にしても、聞こえる
    const auditionLevel = async (mix) => {
      const c = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(c, table, presets); await e.load('../audio/');
      e.setMix(mix);
      e.audition(table.byName('Ⅰ').id, 0.25, 0.8);
      return rms(await c.startRendering(), 0.3, 0.8);
    };
    const a0 = await auditionLevel({ backing: 0, drums: 0 }), a100 = await auditionLevel({ backing: 100, drums: 100 });
    t.ok(`ミックス: 試聴は、ドラム・バッキングのバーに左右されない（バッキング 0% でも ${a0.toFixed(4)} = 100% の ${a100.toFixed(4)}）`, a0 > 0.01 && Math.abs(a0 - a100) < 1e-9);
    // バーをはなしたときの、聴き比べの音
    const preview = async (kind, playing = false) => {
      const c = new OfflineAudioContext(2, SR * 2, SR);
      const e = new AudioEngine(c, table, presets); await e.load('../audio/');
      e.playing = playing;
      const r = e.previewMix(kind);
      return { r, level: rms(await c.startRendering(), 0.05, 1.4) };
    };
    const pd = await preview('drums'), pb = await preview('backing'), pp = await preview('backing', true), pn = await preview('???');
    t.ok(`ミックス: ドラムのバーをはなすと、ドラムが鳴る（${pd.level.toFixed(4)}）・バッキングのバーをはなすと、和音が鳴る（${pb.level.toFixed(4)}）`, pd.r === true && pd.level > 0.003 && pb.r === true && pb.level > 0.01);
    t.ok('ミックス: 演奏中は、聴き比べの音を、鳴らさない（ほんとうの演奏で聴ける）・知らない種類も鳴らさない', pp.r === false && pp.level < 1e-6 && pn.r === false && pn.level < 1e-6);
  }

  // ============ シークバー（巻き戻し・早送り。2026-11-25）============
  {
    // ---- 巻き戻しの音の性質（純粋な計算）----
    t.eq('巻き戻しの音: ほとんど動かさなければ無音（しきい値より遅い・0・NaN）', [scrubParams(0).amp, scrubParams(SCRUB_SILENT_BELOW * 0.5).amp, scrubParams(NaN).amp], [0, 0, 0]);
    const speeds = [0.1, 0.5, 1, 2, 5, 10, 30];
    const ps = speeds.map((v) => scrubParams(v, -1));
    t.ok('巻き戻しの音: 速く動かすほど、大きく・高く（風切り音の帯域も、のこぎり波も）なる（単調）', ps.every((p, i) => i === 0 || (p.amp > ps[i - 1].amp && p.noiseHz > ps[i - 1].noiseHz && p.whineHz > ps[i - 1].whineHz)));
    t.ok('巻き戻しの音: ゆっくり動かしても聞こえる（0.5倍速で、最大の 25% 以上）・上限をこえない', scrubParams(0.5).amp > 0.25 * scrubParams(SCRUB_MAX_SPEED).amp && scrubParams(1e6).amp === scrubParams(SCRUB_MAX_SPEED).amp);
    t.ok('巻き戻しの音: 向きで、のこぎり波の高さが変わる（早送りは、巻き戻しより高い）。大きさは同じ', scrubParams(4, 1).whineHz > scrubParams(4, -1).whineHz && scrubParams(4, 1).amp === scrubParams(4, -1).amp);
    // ---- つかんだ位置の、まるめ方（はなしたとき）----
    t.eq('はなした位置: ステップの頭に 2マス以内なら、頭に吸いつく（0.9 → 0・7 → 8・17 → 16・18 → 16・19 → 19（3マス離れている））', [snapSlot(0.9, 64), snapSlot(7, 64), snapSlot(17, 64), snapSlot(18, 64), snapSlot(19, 64)], [0, 8, 16, 16, 19]);
    t.eq('はなした位置: 頭から遠ければ、いちばん近いマス（5 → 5・12.4 → 12・13.6 → 14）', [snapSlot(5, 64), snapSlot(12.4, 64), snapSlot(13.6, 64)], [5, 12, 14]);
    t.eq('はなした位置: 周回の終わりをこえたら、頭（0）へ（62.5 → 0・63.9 → 0・4ステップ（32マス）で 31 → 0）', [snapSlot(62.5, 64), snapSlot(63.9, 64), snapSlot(31, 32)], [0, 0, 0]);
    t.eq('はなした位置: 変な値は 0（NaN・マイナス）', [snapSlot(NaN, 64), snapSlot(-5, 64)], [0, 0]);

    // ---- 演奏の位置（周回の何マス目か）----
    {
      const { e } = await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 3, drumId: 0 });
      t.eq('演奏の位置: 0.02秒 = 0マス・1.02秒 = 8マス（1ステップ = 1秒）・8.02秒で、頭にもどる（8ステップ = 64マス）', [e.loopPosAt(0.02).pos, e.loopPosAt(1.02).pos, e.loopPosAt(8.02).pos, e.loopPosAt(1.02).len], [0, 8, 0, 64]);
      t.ok('演奏の位置: 途中は小数（0.52秒 = 4マス・0.645秒 = 5マス）', Math.abs(e.loopPosAt(0.52).pos - 4) < 1e-9 && Math.abs(e.loopPosAt(0.645).pos - 5) < 1e-9);
      t.eq('演奏の位置: 始まる前（時刻が基準より前）は 0（最後にまわりこまない）', e.loopPosAt(-1).pos, 0);
      t.eq('loopSlotAt は、同じ値（メロディの帯・シークバーの、表示用）', [e.loopSlotAt(1.02), e.loopSlotAt(8.52)], [8, 4]);
    }
    {
      const ctx = new OfflineAudioContext(2, SR * 6, SR);
      const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
      e.getBoard = () => board('Ⅰ Ⅴ'); e.setPatterns({ drumId: 0, backingId: 1 }); e.wantLoopSteps = () => 4;
      await e.renderOffline(5);
      t.eq('演奏の位置: 4ステップでループするとき、周回は 32マス（4秒）。4.02秒で頭にもどる・5.02秒 = 8マス', [e.loopPosAt(1.02).len, e.loopPosAt(3.52).pos, e.loopPosAt(4.02).pos, e.loopPosAt(5.02).pos], [32, 28, 0, 8]);
    }

    // ---- ステップの途中から続きを演奏する（シーク）----
    const hitsAt = (rec, when) => rec.filter((x) => Math.abs(x.when - when) < 1e-6);
    const CHORD_I = [48, 52, 55, 60], CHORD_V = [55, 59, 62, 67];
    {
      // Ⅰ Ⅴ ⅣM7 Ⅰ。2.02秒（= 3ステップ目の頭）に、2ステップ目の 3マス目（slot 11）へ動かす。バッキング「ロング」（ステップの頭に和音を1回。8マスのばす）・ドラムなし
      const { e } = await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 4, drumId: 0, seeks: [{ at: 2.02, slot: 11 }] });
      const atSeek = hitsAt(e.rec.piano, 2.02).map((x) => x.note).sort((a, b) => a - b);
      t.eq('シーク（ステップの途中へ）: 動かした時刻から、そのステップのコード（Ⅴ）が、つづきから鳴る', atSeek, [...CHORD_V].sort((a, b) => a - b));
      const carried = hitsAt(e.rec.piano, 2.02)[0];
      t.ok(`シーク: つづきの音の長さは、ステップの終わりまで（残り 5マス = ${(5 * 0.125 * 0.95).toFixed(3)}秒）`, Math.abs(carried.dur - 5 * 0.125 * 0.95) < 1e-6);
      const nextStep = e.rec.piano.filter((x) => x.when > 2.02 + 1e-6).map((x) => x.when);
      t.ok('シーク: 次のステップは、残り 5マスぶん（0.625秒）あとに始まる', nextStep.length > 0 && Math.abs(Math.min(...nextStep) - (2.02 + 5 * 0.125)) < 1e-6);
      const stepEv = e.events.filter((x) => x.type === 'step');
      t.eq('シーク: 画面への知らせ。動かした時刻に、2ステップ目（step 1）が、シークとして届く（技の「きらっ」は鳴らさない）。そのあとは、ふつうの知らせ', [stepEv.map((x) => x.step).slice(0, 4), stepEv.map((x) => !!x.seek).slice(0, 4)], [[0, 1, 1, 2], [false, false, true, false]]);
      t.eq('シーク: 動かしたあとの位置は、基準が取りなおされる（動かした時刻 = 11マス目）', [e.loopPosAt(2.02).pos, Math.abs(e.loopPosAt(2.02 + 0.625).pos - 16) < 1e-9], [11, true]);
    }
    {
      // ステップの頭（slot 0 と 16）へ: ふつうに、そのステップが始まる（和音が、頭から鳴る）
      const { e } = await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 4, drumId: 0, seeks: [{ at: 2.02, slot: 0 }, { at: 3.02, slot: 16 }] });
      t.eq('シーク（頭へ）: 1番へ巻きもどすと、Ⅰ が頭から鳴る', hitsAt(e.rec.piano, 2.02).map((x) => x.note).sort((a, b) => a - b), CHORD_I);
      const c3 = hitsAt(e.rec.piano, 3.02);
      t.ok('シーク（頭へ）: 3番（slot 16）へ進めると、ⅣM7 の頭から。長さは、まる 1ステップぶん', c3.length >= 4 && Math.abs(c3[0].dur - 8 * 0.125 * 0.95) < 1e-6);
      t.eq('シーク（頭へ）: 画面への知らせは、「シーク」ではなく、ふつうのステップ', e.events.filter((x) => x.type === 'step' && x.time >= 2.02 - 1e-6).map((x) => !!x.seek).slice(0, 2), [false, false]);
    }
    {
      // ドラムは、動かした位置の続きから（パターンの位置が、ずれない）。8ビート: K = 'x.......x.x.....' S = '....x.......x...'（16マス）
      const { e } = await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 4, drumId: 2, backingId: 0, seeks: [{ at: 2.02, slot: 12 }] });
      const kit = presets.drums.find((d) => d.id === 2);
      const want = Object.entries(kit.lanes).filter(([, tx]) => tx[12 % kit.length] !== '.').map(([lane]) => lane).sort();
      t.eq(`シーク: ドラムは、動かした位置（slot 12）のパターンから始まる（${want.join('・')}）`, e.rec.drum.filter((x) => Math.abs(x.when - 2.02) < 1e-6).map((x) => x.lane).sort(), want);
    }
    {
      // 4分チョップ（C...C...C...C... = 短い和音）: 和音が終わっている位置（slot 3）へ動かすと、ふつうの演奏と同じで、次の和音（slot 4）まで無音。その和音は、ちょうど 1マス後
      const { e } = await make('Ⅰ Ⅴ', { seconds: 3, drumId: 0, backingId: 2, seeks: [{ at: 1.02, slot: 3 }] });
      t.eq('シーク（短い和音のパターン）: 和音が終わっている位置では、鳴らさない（ふつうの演奏と同じ）', hitsAt(e.rec.piano, 1.02).length, 0);
      t.eq('シーク（短い和音のパターン）: 次の和音は、1マスあと（slot 4）に、ステップのコード（Ⅰ）で鳴る', hitsAt(e.rec.piano, 1.02 + 0.125).map((x) => x.note).sort((a, b) => a - b), CHORD_I);
    }
    {
      // 4分チョップ（C...C...C...C...）の、ちょうど和音の位置（slot 12 = 2ステップ目の 5マス目）へ動かす: その和音が、すぐ鳴る
      const { e } = await make('Ⅰ Ⅴ', { seconds: 3, drumId: 0, backingId: 2, seeks: [{ at: 1.02, slot: 12 }] });
      t.eq('シーク（和音の位置へ）: その位置の和音が、すぐ鳴る（Ⅴ。slot 12 = 2ステップ目の 5マス目）', hitsAt(e.rec.piano, 1.02).map((x) => x.note).sort((a, b) => a - b), [...CHORD_V].sort((a, b) => a - b));
    }
    {
      // 分割したマス: 2ステップ目の後半（slot 14）へ動かすと、後半のコード（ⅣM7）が、つづきから鳴る
      const { e } = await make('Ⅰ Ⅴ', { seconds: 3, drumId: 0, split: '- ⅣM7', seeks: [{ at: 1.02, slot: 14 }] });
      const hit = hitsAt(e.rec.piano, 1.02), c = hit.map((x) => x.note).sort((a, b) => a - b);
      const fm7 = table.byName('ⅣM7');
      t.ok(`シーク（分割したマスの後半へ）: 後半のコード（ⅣM7 = ${c.join(' ')}）が、つづきから鳴る（前半の Ⅴ ではない）。残り 2マス`, c.length >= 4 && !CHORD_V.every((n) => c.includes(n)) && c.some((n) => n % 12 === fm7.rootPc) && Math.abs(hit[0].dur - 2 * 0.125 * 0.95) < 1e-6);
    }
    {
      // メロディ: のびている音（slot 0 から 32 マス）の途中へ動かすと、その音を、つづきから（残りの長さで）鳴らす
      const { e } = await make('Ⅰ Ⅴ ⅣM7 Ⅰ', { seconds: 4, drumId: 0, backingId: 0, melody: { notes: [[0, 32, 72], [40, 8, 76]] }, seeks: [{ at: 2.02, slot: 10 }] });
      const l = hitsAt(e.rec.lead, 2.02);
      t.ok(`シーク（メロディ）: のびている音（C5）を、残りの 22マスぶんで、つづきから鳴らす`, l.length === 1 && l[0].note === 72 && Math.abs(l[0].dur - 22 * 0.125 * 0.97) < 1e-6);
    }

    // ---- つかんで動かす（scrubBegin / scrubTo / scrubEnd）の、状態の動き ----
    {
      const ctx = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
      e.getBoard = () => board('Ⅰ Ⅴ ⅣM7 Ⅰ'); e.setPatterns({ drumId: 2, backingId: 1 });
      t.eq('つかむ: 演奏していないときは、つかめない（シークバーは、使えない）', [e.scrubBegin(), e.scrub], [false, null]);
      e.start();
      const idx0 = e.slotIndex;
      t.ok('つかむ: 演奏中なら、つかめる。つかんだ位置は、いまの演奏の位置', e.scrubBegin() === true && e.scrub !== null && e.scrub.len === 64 && e.scrub.pos >= 0);
      e._tick(); e._tick();
      t.eq('つかんでいる間: 演奏は進まない（予約するマスが、増えない）・もう一度つかめない', [e.slotIndex, e.scrubBegin()], [idx0, false]);
      e.scrubTo(40.4, 1000); e.scrubTo(44.9, 1016);
      t.ok('動かす: つかんでいる位置が動く（44.9）・向きは右（早送り）・速さがつく', Math.abs(e.scrub.pos - 44.9) < 1e-9 && e.scrub.v > 0);
      e.scrubTo(60, 1032); e.scrubTo(-5, 1048);
      t.ok('動かす: 範囲の外は、はしにおさまる（0 〜 64 の手前）', e.scrub.pos === 0 && e.scrub.v < 0);
      e.scrubTo(100, 1064);
      t.ok('動かす: 右はしをこえても、周回の中（64 未満）', e.scrub.pos < 64 && e.scrub.pos > 63.9);
      e.scrubTo(36.3, 1080);
      const slot = e.scrubEnd(36.3, { nowMs: 5000 });
      t.eq('はなす: ステップの頭（32）に 2マス以内ではないので、いちばん近いマス（36）から続ける。つかみが外れる', [slot, e.scrub], [36, null]);
      t.ok('はなす: 続きの位置が、36マス目になる（基準・予約の位置・周回の記録）', e.refSlot === 36 && e.slotIndex >= 36 && e.loopStart === 0 && Math.abs(e.loopPosAt(e.refTime).pos - 36) < 1e-9);
      t.ok('はなす: 続きが、すぐ予約される（0.05秒あとの 36マス目から）', e.slotIndex >= 37);
      t.eq('はなした直後（続きの演奏が始まる前）: 位置は、はなした位置（36）のまま。後ろにもどらない（0.01秒・0.049秒）。始まる時刻（0.05秒）からは、36 から進む', [e.loopPosAt(0.01).pos, e.loopPosAt(0.049).pos, e.loopPosAt(0.05).pos, Math.abs(e.loopPosAt(0.175).pos - 37) < 1e-9], [36, 36, 36, true]);
      e.scrubBegin(); e.scrubTo(31, 10);
      t.eq('はなす（頭に吸いつく）: 31 → 4ステップ目の頭（32）に近いので、32 から', e.scrubEnd(31, { nowMs: 20 }), 32);
      e.scrubBegin(); e.scrubTo(63, 10);
      t.eq('はなす（周回の終わり）: 63 → 次の周回の頭（64 = 0）に近いので、頭（0）から', e.scrubEnd(63, { nowMs: 20 }), 0);
      e.scrubBegin(); e.scrubTo(21, 10);
      t.eq('はなす: 吸いつかせない指定（snap: false）なら、そのまま（21）', e.scrubEnd(21, { snap: false, nowMs: 20 }), 21);
      e.scrubBegin();
      e.stop();
      t.eq('つかんでいる途中で、演奏を止めたら、つかみも外れる', [e.scrub, e.playing], [null, false]);
    }
    {
      // seekTo（キーボード・テスト用）: つかまずに、位置を動かす
      const ctx = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
      e.getBoard = () => board('Ⅰ Ⅴ'); e.setPatterns({ drumId: 0, backingId: 1 });
      t.eq('seekTo: 演奏していなければ、何もしない', e.seekTo(8), null);
      e.start();
      t.eq('seekTo: 演奏中は、その位置から続く（8 → 8）', [e.seekTo(8), e.refSlot, e.scrub], [8, 8, null]);
      t.eq('seekTo: 範囲の外は、はしにおさまる（500 → 63）', e.seekTo(500), 63);
      e.stop();
    }

    // ---- 巻き戻しの音を、書き出して調べる ----
    const scrubRender = async (script, seconds = 1.2) => {
      const ctx = new OfflineAudioContext(2, SR * seconds, SR);
      const snd = new ScrubSound(ctx, ctx.destination);
      snd.begin(0);
      for (const [when, speed, dir] of script) snd.update(speed, dir, when);
      snd.end(seconds - 0.2);
      return ctx.startRendering();
    };
    {
      const buf = await scrubRender([[0, 0, -1], [0.1, 6, -1], [0.5, 0, -1]]);
      const moving = rms(buf, 0.2, 0.45), still = rms(buf, 0.8, 1.0);
      t.ok(`巻き戻しの音: 動かしている間は鳴る（${moving.toFixed(4)}）・止めているあいだは、ほぼ無音（${still.toExponential(1)}）`, moving > 0.01 && still < moving * 0.01);
    }
    {
      const r = [];
      for (const v of [0.3, 1.5, 6, 24]) r.push(rms(await scrubRender([[0, v, -1]], 0.8), 0.2, 0.6));
      t.ok(`巻き戻しの音: 速く動かすほど、大きい（${r.map((x) => x.toFixed(3)).join(' < ')}）`, r.every((x, i) => i === 0 || x > r[i - 1]) && r[0] > 0.002);
      const back = await scrubRender([[0, 6, -1]], 0.8), fwd = await scrubRender([[0, 6, 1]], 0.8);
      t.ok('巻き戻しの音: 向きで、音色が変わる（早送りのほうが、高い音の成分が多い）', power(fwd, 0, 0.2, 0.6, 1500) !== power(back, 0, 0.2, 0.6, 1500));
    }
    {
      // エンジンを通した音: つかんで動かすと、全体の通り道（マスター）を通って、鳴る。止めると消える
      const ctx = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
      e.getBoard = () => board('Ⅰ Ⅴ'); e.setPatterns({ drumId: 0, backingId: 0 });
      e.start();
      e.scrubBegin(0); e.scrubTo(30, 0);
      const buf = await ctx.startRendering();
      t.ok(`シークバーを動かすと、巻き戻しの音が、エンジンの出口から鳴る（${rms(buf, 0.05, 0.3).toFixed(4)}）`, rms(buf, 0.05, 0.3) > 0.003);
      e.stop();
    }
    {
      const ctx = new OfflineAudioContext(2, SR, SR);
      const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
      e.master.gain.value = 0;
      e.getBoard = () => board('Ⅰ Ⅴ'); e.setPatterns({ drumId: 0, backingId: 0 });
      e.start(); e.scrubBegin(0); e.scrubTo(30, 0);
      const buf = await ctx.startRendering();
      t.ok('ミュート（全体の音量 0）のとき、巻き戻しの音も鳴らない', rms(buf, 0.05, 0.3) < 1e-6);
      e.stop();
    }
    {
      // 大きさの目安: 同じ全体の音量で、和音の試聴（Ⅰ）と比べる。巻き戻しの音は、演奏を邪魔しない（和音より、大きくない）が、聞こえる（和音の 1/10 以上）
      const lvl = async (kind, speed) => {
        const ctx = new OfflineAudioContext(2, SR, SR);
        const e = new AudioEngine(ctx, table, presets); await e.load('../audio/');
        e.master.gain.value = masterGainFor(DEFAULT_VOLUME);
        e.getBoard = () => board('Ⅰ Ⅴ'); e.setPatterns({ drumId: 0, backingId: 0 });
        if (kind === 'chord') e.audition(table.byName('Ⅰ').id, 0.05, 0.8);
        else { const snd = new ScrubSound(ctx, e.scrubBus); snd.begin(0); snd.update(speed, -1, 0); }
        return rms(await ctx.startRendering(), 0.1, 0.7);
      };
      const chord = await lvl('chord'), slow = await lvl('scrub', 0.5), mid = await lvl('scrub', 4), fast = await lvl('scrub', 20);
      t.log(`巻き戻しの音の大きさ（和音の試聴 ${chord.toFixed(4)} に対して）: ゆっくり ${slow.toFixed(4)} / ふつう ${mid.toFixed(4)} / 速い ${fast.toFixed(4)}`);
      t.ok(`巻き戻しの音の大きさ: 速くても、和音より大きくない（${(fast / chord).toFixed(2)}倍）・ゆっくりでも、聞こえる（${(slow / chord).toFixed(2)}倍。0.08 倍以上）`, fast < chord * 1.05 && slow > chord * 0.08);
    }
    t.ok('音の通り道: 巻き戻しの音は、専用のバス（試聴・バッキング・ドラムとは別）', (() => { const c = new OfflineAudioContext(2, 100, SR); const e = new AudioEngine(c, table, presets); return !!e.scrubBus && e.scrubBus !== e.sfxBus && e.scrubBus !== e.pianoBus && e.scrubBus !== e.auditionBus; })());
  }
}
