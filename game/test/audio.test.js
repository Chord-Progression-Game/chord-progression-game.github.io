// ゲームの音（時計・ピアノ・ドラム）のテスト。音を出さずに（OfflineAudioContext）書き出して、中身を調べる。
import { ChordTable } from '../js/core/chords.js';
import { AudioEngine, parseCell, holdSlots, SLOTS_PER_STEP, masterGainFor, MASTER_GAIN } from '../js/audio/engine.js';
import { Sfx } from '../js/audio/sfx.js';
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
  const make = async (spec, { seconds = 6, drumId = 2, backingId = 1, bpm = 120 } = {}) => {
    const ctx = new OfflineAudioContext(2, SR * seconds, SR);
    const e = new AudioEngine(ctx, table, presets);
    await e.load('../audio/');
    e.getBoard = () => board(spec);
    e.setPatterns({ drumId, backingId }); e.setBpm(bpm);
    // 鳴らす指示を記録する（音は、そのまま鳴らす）
    e.rec = { piano: [], drum: [] };
    const pp = e.playPianoNote.bind(e), pd = e.playDrum.bind(e);
    e.playPianoNote = (n, w, d, v, dest) => { e.rec.piano.push({ note: n, when: w, dur: d, vel: v }); return pp(n, w, d, v, dest); };
    e.playDrum = (l, w, lv, dest) => { e.rec.drum.push({ lane: l, when: w, level: lv }); return pd(l, w, lv, dest); };
    const buf = await e.renderOffline(seconds);
    return { e, buf };
  };

  // ============ パターンの文字 ============
  t.eq('マスの文字: C = 和音', parseCell('C'), { hit: true, shape: 'chord', soft: false });
  t.eq('マスの文字: d = ベース＋和音（弱く）', parseCell('d'), { hit: true, shape: 'bassChord', soft: true });
  t.eq('マスの文字: 3 = 3番目の音', parseCell('3').shape, 'tone3');
  t.eq('マスの文字: - は音ではない', parseCell('-').hit, false);
  t.eq('のばす長さ（C------- = 8マス）', holdSlots('C-------C-------', 0, 8), 8);
  t.eq('のばす長さは、ステップの終わりを超えない', holdSlots('C-------C-------', 0, 3), 3);

  // ============ 時計と和音 ============
  {
    const { e, buf } = await make('Ⅰ Ⅴ', { seconds: 4 });
    const steps = e.events.filter((x) => x.type === 'step');
    t.eq('ステップの合図は、1秒ごと（BPM120・1ステップ=2拍）', steps.slice(0, 4).map((s) => Math.round(s.time * 1000) / 1000), [0.02, 1.02, 2.02, 3.02]);
    t.eq('ステップ1・2のコード', steps.slice(0, 3).map((s) => s.chordId), [table.byName('Ⅰ').id, table.byName('Ⅴ').id, null]);
    t.eq('標準の高さは、ルートが C3〜B3（以前より 1オクターブ下）', [BASE_C_DEFAULT + 12 * OCTAVE_DEFAULT, OCTAVE_DEFAULT], [48, 0]);
    t.eq('Ⅰ の音（C3 E3 G3 C4）', steps[0].notes, [48, 52, 55, 60]);
    t.eq('Ⅴ は、前のⅠに近い高さ（G2 B2 D3 G3）', steps[1].notes, [43, 47, 50, 55]);
    const beats = e.events.filter((x) => x.type === 'beat');
    t.eq('拍の合図（0.5秒ごと）', beats.slice(0, 4).map((b) => Math.round(b.time * 1000) / 1000), [0.02, 0.52, 1.02, 1.52]);
    t.ok('音が出ている（無音ではない）', rms(buf, 0, 2) > 0.01);
    // 周波数: Ⅰ（0.12〜0.95秒）に C3 E3 G3 が強く、半音ずれた音は弱い
    const strong = [48, 52, 55].map((m) => power(buf, 0, 0.12, 0.95, hz(m)));
    const weak = [49, 51, 54].map((m) => power(buf, 0, 0.12, 0.95, hz(m)));
    t.ok(`Ⅰ の構成音（C3 E3 G3）が、半音ずれた音より強い（強 ${strong.map((x) => x.toExponential(1))} / 弱 ${weak.map((x) => x.toExponential(1))}）`, Math.min(...strong) > 3 * Math.max(...weak));
    // Ⅴ（1.12〜1.95秒。低い音は、半音の間隔がせまい（G2 と G#2 は 6Hz）ので、長めに測って、見分ける）に G2 B2 D3 が強い
    const strong2 = [43, 47, 50].map((m) => power(buf, 0, 1.12, 1.95, hz(m)));
    const weak2 = [44, 46, 51].map((m) => power(buf, 0, 1.12, 1.95, hz(m)));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    t.ok(`Ⅴ の構成音（G2 B2 D3）が強い（強 ${strong2.map((x) => x.toExponential(1))} / 弱 ${weak2.map((x) => x.toExponential(1))}）`, sum(strong2) > 8 * sum(weak2) && Math.min(...strong2) > 1.5 * Math.max(...weak2));
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
    t.eq('音量: 100% = これまでの大きさ（MASTER_GAIN）', masterGainFor(100, false), MASTER_GAIN);
    t.eq('音量: ミュートは 0（音量のバーの位置にかかわらず）', [masterGainFor(100, true), masterGainFor(40, true)], [0, 0]);
    t.eq('音量: 0% は 0', masterGainFor(0, false), 0);
    t.ok('音量: 50% は、およそ −12dB（2乗の曲線）', Math.abs(20 * Math.log10(masterGainFor(50, false) / MASTER_GAIN) + 12.04) < 0.05);
    t.ok('音量: バーを上げるほど、大きくなる（単調）', [0, 10, 25, 50, 75, 100].map((p) => masterGainFor(p, false)).every((g, i, a) => i === 0 || g > a[i - 1]));
    t.eq('音量: 範囲の外・変な値は、おさまる（-20 → 0・300 → 100%・NaN → 100%）', [masterGainFor(-20), masterGainFor(300), masterGainFor(NaN)], [0, MASTER_GAIN, MASTER_GAIN]);
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
}
