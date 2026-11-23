// ゲームの中心の部品（コードの表・和音の高さ・トリックの判定・ヒント）のテスト。
import { ChordTable } from '../js/core/chords.js';
import { voiceChord, chooseOctaveShift, resolveChordAtStep } from '../js/core/voicing.js';
import { analyze, buildSegments, TRICKS, PATTERNS, HEAD_V_PENALTY, setCustomProgressions } from '../js/core/tricks.js';
import { suggest, findCursor, isSeventh, sevenBonus, sameSevenFamily } from '../js/core/hints.js';
import { SENSE, senseTotals, edgeInfo, isBorrowed, naturalAfterBorrowed, borrowKey, flowReason as SENSE_FLOW } from '../js/core/sense.js';
import * as CB from '../js/core/chordbook.js';
import { sanitizeChordbook } from '../js/core/chordbook.js';
import { ChordStore } from '../js/game/chordstore.js';
import { songsFor, SONGS, SOURCES, NO_JAPANESE } from '../js/core/songs.js';
import { trickDetail } from '../js/core/trickinfo.js';
import { nextFreeSlot } from '../js/ui/input.js';
import * as MEL from '../js/core/melody.js';
import { MELODY_STAGES, melodyPar, applyMelody } from '../js/game/melodies.js';
import { makePreset, sanitizePresets, placementPlan, defaultName, trimChords, sameChords, sliceMelody, cutNotes, applyMelodyPlan, MAX_PRESETS, PresetStore } from '../js/game/presets.js';
import * as AM from '../js/core/automelody.js';
import * as SH from '../js/net/share.js';
import { loadSave, DEFAULT_VOLUME } from '../js/game/save.js';
import { MelodyDoc, sanitizeNotes, NOTE_LO, NOTE_HI, MAX_NOTES } from '../js/game/usermelody.js';

export async function run(t) {
  const table = new ChordTable(await (await fetch('../data/chords.json')).json());
  const ALL = table.pieces().map((c) => c.id);

  // 盤を、文字で作る。例: board('Ⅴ7 Ⅰ - →')。"-" は空き、"→" は繰り返しの駒。足りない分は空き（8つ）
  const board = (spec) => {
    const out = spec.trim().split(/\s+/).filter(Boolean).map((tok) => {
      if (tok === '-') return null;
      if (tok === '→') return table.repeatId;
      const c = table.byName(tok);
      if (!c) throw new Error('知らない駒: ' + tok);
      return c.id;
    });
    while (out.length < 8) out.push(null);
    return out;
  };
  const kinds = (r) => r.instances.map((i) => `${i.kind}${i.variant ? '|' + i.variant : ''}`);

  // ============ 1. コードの表 ============
  t.eq('コードの数（31種+→。2026-11-17 に Ⅵ・Ⅵsus4 を追加）', table.list.length, 32);
  t.ok('Ⅵ（長三和音。ピカルディ終止の着地点）= ID 30・Ⅵsus4 = ID 31', (() => { const a = table.byName('Ⅵ'), b = table.byName('Ⅵsus4'); return a.id === 30 && a.type === 'maj' && a.rootPc === 9 && a.symbol === 'A' && b.id === 31 && b.type === 'sus4' && b.rootPc === 9 && b.symbol === 'Asus4' && b.notes === 'A D E A'; })());
  t.eq('「→」の ID', table.repeatId, 99);
  const ura = table.byName('Ⅱ♭7');
  t.ok('Ⅱ♭7（裏コード）がある', !!ura && ura.id === 29 && ura.rootPc === 1 && ura.type === 'dom7' && ura.symbol === 'D♭7');
  t.eq('Ⅴ7 の構成音（Key=C）', table.byName('Ⅴ7').notes, 'G B D F');
  t.eq('短調の響きの駒（Ⅳm7・Ⅳm6・Ⅴm7・Ⅵ♭M7・Ⅶ♭7・Ⅲ♭M7）', table.list.filter((c) => c.minorFlavor).map((c) => c.name).sort(),
    ['Ⅳm6', 'Ⅳm7', 'Ⅴm7', 'Ⅵ♭M7', 'Ⅶ♭7', 'Ⅲ♭M7'].sort());
  t.eq('色の濃さ（Ⅲ♭m6=3、Ⅰ=0、Ⅲ7=1）', [table.byName('Ⅲ♭m6').colour, table.byName('Ⅰ').colour, table.byName('Ⅲ7').colour], [3, 0, 1]);
  t.eq('働き（Ⅰ=T / ⅣM7=SD / Ⅴ7=D / Ⅳm7=SD / Ⅵ♭M7=X / Ⅱ♭7=D）',
    ['Ⅰ', 'ⅣM7', 'Ⅴ7', 'Ⅳm7', 'Ⅵ♭M7', 'Ⅱ♭7'].map((n) => table.byName(n).fn), ['T', 'SD', 'D', 'SD', 'X', 'D']);

  // ============ 2. 和音の高さ: ファームと同じか ============
  const lines = (await (await fetch('./_generated/voicing.txt')).text()).trim().split('\n');
  let bad = 0;
  for (const ln of lines) {
    const [baseC, p, c, root, ...notes] = ln.split(' ').map(Number);
    const prevRoot = p ? baseC + table.byId(p).rootPc : -1;
    const v = voiceChord(table.byId(c), baseC, prevRoot, true);
    if (v.root !== root || JSON.stringify(v.notes) !== JSON.stringify(notes)) { bad++; if (bad <= 5) t.log(`不一致 baseC=${baseC} 前=${p} 今=${c}: JS ${v.root} ${v.notes} / C++ ${root} ${notes}`); }
  }
  t.eq(`和音の高さ: ファームとの照合 ${lines.length} 通り（不一致の数）`, bad, 0);
  t.ok('照合した組み合わせが十分ある', lines.length > 4000);
  t.eq('強進行（前 G=55、今 C: 本来 60/48/72）は、上へ4度ではなく、5度下（48）へ', chooseOctaveShift(60, 55), -12);
  t.eq('近い高さ（前 A=57、今 C: 強進行でないときは、いちばん近い高さ=60）', chooseOctaveShift(60, 57), 0);
  t.eq('強進行でも、5度下が低すぎる（前 C=36、今 F）ときは、いちばん近い高さ（F2=41）', chooseOctaveShift(53, 36), -12);
  t.eq('強進行: 前 D=50 → 今 G: 5度下（G2=43）。前 G=43 → 今 C: 5度下（C2=36）', [chooseOctaveShift(55, 50), chooseOctaveShift(48, 43)], [-12, -12]);
  t.eq('近い高さ（前 A=69、今 C=60 → 72）', chooseOctaveShift(60, 69), 12);
  t.eq('ボイスリーディング OFF なら、いつも本来の高さ', chooseOctaveShift(60, 69, false), 0);
  // 「→」と空きの解決（ファームの grooveResolveChordId と同じ）
  const R = table.repeatId, a = table.byName('Ⅴ7').id;
  t.eq('「→」は、前のコード', resolveChordAtStep([a, R, null, null, null, null, null, null], 1, table), a);
  t.eq('「→」の前が空き → 休み', resolveChordAtStep([a, null, R, null, null, null, null, null], 2, table), null);
  t.eq('先頭の「→」は、最後の駒（ループ）', resolveChordAtStep([R, null, null, null, null, null, null, a], 0, table), a);
  t.eq('全部「→」なら休み', resolveChordAtStep([R, R, R, R, R, R, R, R], 3, table), null);

  // ============ 3. トリックの判定: つながり（どこにあっても成立する）============
  let r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7'), table);
  t.eq('ツーファイブワン（1つの技にまとまる。Ⅴ-Ⅰ終止は別に数えない）', kinds(r), ['dominant_motion|ツーファイブワン']);
  t.eq('ツーファイブワンの点数 400、3つの駒', [r.instances[0].points, r.instances[0].chords.length], [400, 3]);
  t.eq('短調のツーファイブワン（Ⅶm7-5→Ⅲ7→Ⅵm7）', kinds(analyze(board('Ⅶm7-5 Ⅲ7 Ⅵm7'), table)), ['dominant_motion|ツーファイブワン']);
  t.eq('ツーファイブワンは、どこにあっても成立する（3〜5番）', kinds(analyze(board('- - Ⅱm7 Ⅴ7 ⅠM7'), table)), ['dominant_motion|ツーファイブワン']);
  r = analyze(board('- Ⅲ7 Ⅵm7 Ⅳ'), table);
  t.eq('Ⅲ7→Ⅵm7（フレーズの途中）= セカンダリードミナント（ドミナントモーション）', kinds(r).slice(0, 1), ['dominant_motion|セカンダリードミナント']);
  t.eq('セカンダリードミナントの点数 150', r.instances[0].points, 150);
  t.eq('Ⅲ7→Ⅵm7 が、フレーズの終わり（後ろに駒がない）なら、Ⅵm7 で終わる = 偽終止になる', kinds(analyze(board('- Ⅲ7 Ⅵm7'), table)), ['deceptive_cadence']);
  t.eq('Ⅱ7→Ⅴ7 = セカンダリードミナント', kinds(analyze(board('- Ⅱ7 Ⅴ7'), table)), ['dominant_motion|セカンダリードミナント']);
  t.eq('Ⅰ7→Ⅳ = セカンダリードミナント（Ⅳ へのドミナント）', kinds(analyze(board('- Ⅰ7 Ⅳ'), table)), ['dominant_motion|セカンダリードミナント']);
  r = analyze(board('Ⅰ ⅣM7'), table);
  t.eq('Ⅰ→ⅣM7 = 強進行（ドミナントモーション）', kinds(r), ['dominant_motion|強進行']);
  t.eq('強進行の点数 100', r.instances[0].points, 100);
  t.eq('Ⅴ7→Ⅰ が、フレーズの途中なら、終止ではなく強進行（セカンダリーではない）', kinds(analyze(board('- Ⅴ7 Ⅰ Ⅳ'), table)), ['dominant_motion|強進行', 'dominant_motion|強進行']);

  t.eq('弱進行（ふつう）: Ⅵm→Ⅲm（ルートが5度上がる）', kinds(analyze(board('Ⅵm Ⅲm'), table)), ['weak_motion']);
  t.eq('弱進行の点数 60', analyze(board('Ⅵm Ⅲm'), table).instances[0].points, 60);
  t.eq('Ⅳ→Ⅰ は、フレーズの終わり（後ろに駒がない）なら、プラガル終止（160）。終わりでなければ、ふつうの弱進行（60）', [kinds(analyze(board('Ⅳ Ⅰ'), table)), analyze(board('Ⅳ Ⅰ'), table).instances[0].points, kinds(analyze(board('Ⅳ Ⅰ Ⅱm'), table)), analyze(board('Ⅳ Ⅰ Ⅱm'), table).instances[0].points], [['plagal_cadence'], 160, ['weak_motion'], 60]);
  t.eq('プラガル終止: ⅣM7 → ⅠM7 でも成立 / Ⅳ → Ⅵm・Ⅳ → Ⅴ は、プラガル終止ではない', [kinds(analyze(board('ⅣM7 ⅠM7'), table)), kinds(analyze(board('Ⅳ Ⅵm'), table)).includes('plagal_cadence'), kinds(analyze(board('Ⅳ Ⅴ'), table)).includes('plagal_cadence')], [['plagal_cadence'], false, false]);
  t.eq('プラガル終止: 4番のⅠ（フレーズの終わり）で成立する（3番 Ⅳ → 4番 Ⅰ）/ 3番が終わりでない（2番 Ⅳ → 3番 Ⅰ → 4番 Ⅱm）なら、成立しない', [kinds(analyze(board('Ⅱm7 Ⅴ7 Ⅳ Ⅰ'), table)).includes('plagal_cadence'), kinds(analyze(board('Ⅱm7 Ⅳ Ⅰ Ⅱm'), table)).includes('plagal_cadence')], [true, false]);
  t.eq('Ⅰ→Ⅴ のあとに駒が続く（フレーズの途中）= 弱進行（ドミナント終止ではない）', kinds(analyze(board('Ⅰ Ⅴ Ⅳ'), table)), ['weak_motion']);

  r = analyze(board('- Ⅱ♭7 Ⅰ'), table);
  t.eq('Ⅱ♭7→Ⅰ = 半音下への進行（裏コード）。Ⅱ♭7 は冒頭（1番）に置くと「？」なので、2番から', kinds(r), ['half_step_down|裏コード']);
  t.eq('裏コードの点数 250', r.instances[0].points, 250);
  t.eq('ⅣM7→Ⅲm7 = 半音下への進行', kinds(analyze(board('ⅣM7 Ⅲm7'), table)), ['half_step_down']);
  t.eq('Ⅴ7→Ⅳ#m7-5 = 半音下への進行（Ⅴ7 は 2番）', kinds(analyze(board('- Ⅴ7 Ⅳ#m7-5'), table)), ['half_step_down']);

  // ============ 3b. 終止（フレーズの終わりでだけ成立する）============
  r = analyze(board('- - Ⅴ7 Ⅰ'), table);
  t.eq('Ⅴ7→Ⅰ（3→4番 = フレーズの終わり）= Ⅴ-Ⅰ終止', kinds(r), ['authentic_cadence']);
  t.eq('Ⅴ-Ⅰ終止の点数', r.instances[0].points, 200);
  t.eq('Ⅴ7→Ⅰ（2→3番。その後に続く駒がない）= Ⅴ-Ⅰ終止', kinds(analyze(board('- Ⅴ7 Ⅰ'), table)), ['authentic_cadence']);
  t.eq('Ⅴ7→Ⅰ（7→8番）= Ⅴ-Ⅰ終止', kinds(analyze(board('- - - - - - Ⅴ7 Ⅰ'), table)), ['authentic_cadence']);
  t.eq('Ⅴ→ⅠM7 = Ⅴ-Ⅰ終止', kinds(analyze(board('- Ⅴ ⅠM7'), table)), ['authentic_cadence']);
  t.eq('Ⅴsus47→Ⅰ = Ⅴ-Ⅰ終止', kinds(analyze(board('- Ⅴsus47 Ⅰ'), table)), ['authentic_cadence']);
  t.eq('Ⅰ7→Ⅰ は、技ではない（同じルート）', kinds(analyze(board('- Ⅰ7 Ⅰ'), table)), []);
  t.eq('Ⅴm7→Ⅰ は、Ⅴ-Ⅰ終止ではない（短調のⅤは別）', kinds(analyze(board('- Ⅴm7 Ⅰ'), table)).includes('authentic_cadence'), false);
  t.eq('Ⅴ-Ⅰ終止: 4番で終わるなら、そのあとに駒が続いてもよい', kinds(analyze(board('- - Ⅴ7 Ⅰ Ⅳ'), table)).includes('authentic_cadence'), true);
  t.eq('Ⅴ-Ⅰ終止: フレーズの途中（後ろに駒が続く）では、成立しない', kinds(analyze(board('- Ⅴ7 Ⅰ Ⅳ'), table)).includes('authentic_cadence'), false);

  t.eq('Ⅰ→Ⅴ（後ろに駒がない）= ドミナント終止', kinds(analyze(board('Ⅰ Ⅴ'), table)), ['dominant_ending']);
  t.eq('Ⅳ→Ⅴ = ドミナント終止', kinds(analyze(board('Ⅳ Ⅴ'), table)), ['dominant_ending']);
  t.eq('Ⅵm→Ⅴ7 = ドミナント終止', kinds(analyze(board('Ⅵm Ⅴ7'), table)), ['dominant_ending']);
  t.eq('Ⅰ→Ⅴ が 2→3番でも、後ろに駒がなければ、ドミナント終止', kinds(analyze(board('- Ⅰ Ⅴ'), table)), ['dominant_ending']);
  t.eq('Ⅳ→Ⅴ が 3→4番（フレーズの終わり）= ドミナント終止（そのあとに駒が続いてもよい）', kinds(analyze(board('Ⅱm Ⅰ Ⅳ Ⅴ Ⅳ'), table)).includes('dominant_ending'), true);
  t.eq('Ⅱm7→Ⅴ7 は、Ⅰ・Ⅵm・Ⅳ系ではない → 強進行', kinds(analyze(board('Ⅱm7 Ⅴ7'), table)), ['dominant_motion|強進行']);
  t.eq('「→」でのばしても、Ⅴ が最後なら、ドミナント終止', kinds(analyze(board('Ⅰ → Ⅴ'), table)), ['dominant_ending']);

  // ピカルディ終止（2026-11-17 に、定義を直した）: Ⅵm（短調の主和音）で終わるところを、長三和音の Ⅵ で終える
  t.eq('Ⅳm7→Ⅰ は、ピカルディ終止ではない（サブドミナントマイナーから、Ⅰ へ着地する技）', kinds(analyze(board('Ⅳm7 Ⅰ'), table)), ['sdm']);
  t.eq('Ⅶ♭7→ⅠM7 も、ピカルディ終止ではない（♭Ⅶ の借用和音から、Ⅰ へ着地する技）', kinds(analyze(board('- Ⅶ♭7 ⅠM7'), table)), ['sdm_sub|♭Ⅶ']);
  t.eq('Ⅳ→Ⅰ（長調のⅣ）は、ピカルディ終止ではない（プラガル終止）', kinds(analyze(board('Ⅳ Ⅰ'), table)), ['plagal_cadence']);
  t.eq('Ⅲ7→Ⅵ = ピカルディ終止（イ短調の Ⅴ7 → 主和音を、長三和音に）', kinds(analyze(board('- Ⅲ7 Ⅵ'), table)), ['picardy']);
  t.eq('Ⅵm7→Ⅵ = ピカルディ終止（主和音が、短三和音から長三和音へ）', kinds(analyze(board('Ⅵm7 Ⅵ'), table)), ['picardy']);
  t.eq('Ⅴ7→Ⅵ・Ⅱm7→Ⅵ・Ⅵsus4→Ⅵ も、ピカルディ終止（Ⅴ は 1番だと「？」なので、2番から）', ['- Ⅴ7 Ⅵ', 'Ⅱm7 Ⅵ', 'Ⅵsus4 Ⅵ'].map((b) => kinds(analyze(board(b), table))[0]), ['picardy', 'picardy', 'picardy|サスつき']);
  t.eq('例: ⅣM7 → Ⅴ7 → Ⅵsus4 → Ⅵ（ユーザーの例）は、1つのピカルディ終止（サスつき 250）', (() => { const r = analyze(board('ⅣM7 Ⅴ7 Ⅵsus4 Ⅵ'), table); return [kinds(r), r.instances[0].points, r.instances[0].startPos, r.instances[0].endPos]; })(), [['picardy|サスつき'], 250, 2, 3]);
  t.eq('Ⅰ→Ⅵ・Ⅳ→Ⅵ・Ⅵ7→Ⅵ（イ短調の終止に向かう和音ではない）は、ピカルディ終止ではない', ['Ⅰ Ⅵ', 'Ⅳ Ⅵ', 'Ⅵ7 Ⅵ'].map((b) => kinds(analyze(board(b), table)).includes('picardy')), [false, false, false]);
  t.eq('ピカルディ終止: フレーズの途中では、成立しない', kinds(analyze(board('- Ⅲ7 Ⅵ Ⅳ'), table)).includes('picardy'), false);
  t.eq('ピカルディ終止: Ⅵ（長三和音）が最後でも、4番（フレーズの終わり）に着けば成立する', kinds(analyze(board('Ⅱm7 Ⅳ Ⅲ7 Ⅵ Ⅳ'), table)).includes('picardy'), true);

  r = analyze(board('- - Ⅴ7 Ⅵm7'), table);
  t.eq('Ⅴ7→Ⅵm7（3→4番）= 偽終止', kinds(r), ['deceptive_cadence']);
  t.eq('偽終止の点数 200（Ⅴ → Ⅵm。本来の形は、150 + 50）', r.instances[0].points, 200);
  t.eq('Ⅴ→Ⅵm（後ろに駒がない）= 偽終止', kinds(analyze(board('- Ⅴ Ⅵm'), table)), ['deceptive_cadence']);
  t.eq('Ⅴ7→Ⅵ♭M7（借用のⅥ）= 偽終止', kinds(analyze(board('- Ⅴ7 Ⅵ♭M7'), table)), ['deceptive_cadence']);
  t.eq('偽終止: フレーズの途中では、成立しない', kinds(analyze(board('- Ⅴ7 Ⅵm7 Ⅳ'), table)).includes('deceptive_cadence'), false);
  t.eq('Ⅴ7→Ⅵ7（ドミナント）は、偽終止ではない', kinds(analyze(board('- Ⅴ7 Ⅵ7'), table)).includes('deceptive_cadence'), false);
  t.eq('偽終止: 8番で終わる（7→8番）', kinds(analyze(board('- - - - - - Ⅴ Ⅵm'), table)), ['deceptive_cadence']);

  // ============ 3c. 冒頭（1番）のドミナント系の駒 = 「？」（技にならない・コンボなし・100点の減点）。2026-11-18 から: 5番は対象外・Ⅲ7 や Ⅰ7 も対象 ============
  r = analyze(board('Ⅴ7 Ⅰ'), table);
  t.eq('1番の Ⅴ7 は「？」（Ⅴ7→Ⅰ は、終止にも強進行にもならない）', [kinds(r), r.oddities.length, r.oddities[0].startPos, r.oddities[0].chords], [[], 1, 0, ['Ⅴ7']]);
  t.eq('「？」は、100点の減点（0点より下にはならない）', [r.score.base, r.score.penalty, r.score.total, r.oddities[0].total], [0, 100, 0, -100]);
  t.eq('減点の大きさは、定数 HEAD_V_PENALTY（100）', HEAD_V_PENALTY, 100);
  r = analyze(board('- - - - Ⅴ7 Ⅰ'), table);
  t.eq('5番の Ⅴ7 は「？」ではない（減点は、冒頭の1番だけ）。Ⅴ7→Ⅰ は、終止になる', [kinds(r), r.oddities.length], [['authentic_cadence'], 0]);
  r = analyze(board('Ⅴ7 Ⅰ Ⅳ'), table);
  t.eq('1番の Ⅴ7 は、つながりに使われない（ドミナントモーションの得点を、狙えない）。Ⅰ→Ⅳ だけ決まる', [kinds(r), r.score.total], [['dominant_motion|強進行'], 0]);
  r = analyze(board('Ⅱm Ⅴ7 Ⅰ - Ⅴ Ⅰ'), table);
  t.eq('5番の Ⅴ は「？」ではない。ツーファイブワンと、Ⅴ-Ⅰ終止（5→6番）が決まる', [kinds(r), r.oddities.length], [['dominant_motion|ツーファイブワン', 'authentic_cadence'], 0]);
  r = analyze(board('Ⅴ Ⅱm7 Ⅴ7 ⅠM7'), table);
  t.eq('技の点から、減点する（ツーファイブワン 400 + 駒のレベル 20 + ジャッジ（ガイドトーンの半音進行 30 × 2）- 100 = 380）。「？」の Ⅴ は、つながりにならない', [kinds(r), r.score.base, r.score.levelBonus, r.score.penalty, r.score.total], [['dominant_motion|ツーファイブワン'], 400, 20, 100, 380]);
  r = analyze(board('Ⅴ Ⅰ - - Ⅴ7 Ⅰ'), table);
  t.eq('「？」は、1番の Ⅴ だけ（5番の Ⅴ7 は「？」ではない）。100点の減点', [r.oddities.length, r.score.penalty], [1, 100]);
  t.eq('2番以降の Ⅴ は、「？」ではない（5番も）', [analyze(board('Ⅰ Ⅴ'), table).oddities.length, analyze(board('Ⅰ Ⅱm Ⅲm Ⅴ'), table).oddities.length, analyze(board('- - - - Ⅰ Ⅴ'), table).oddities.length, analyze(board('- - - - Ⅴ7'), table).oddities.length], [0, 0, 0, 0]);
  t.eq('Ⅴm7・Ⅴsus47 も、Ⅴ系（1番なら「？」）', [analyze(board('Ⅴm7'), table).oddities.length, analyze(board('Ⅴsus47'), table).oddities.length], [1, 1]);
  t.eq('Ⅲ7・Ⅰ7・Ⅱ7・Ⅵ7（セカンダリードミナント）も、1番に置くと「？」（2026-11-18。Ⅴ と同じ −100）', ['Ⅲ7', 'Ⅰ7', 'Ⅱ7', 'Ⅵ7'].map((n) => analyze(board(`${n} Ⅵm`), table).oddities.map((o) => o.total)).flat(), [-100, -100, -100, -100]);
  t.eq('Ⅵ（長三和音）・Ⅶ♭7・Ⅱ♭7・Ⅴ#dim7 も、ドミナント系なので、1番に置くと「？」', ['Ⅵ', 'Ⅶ♭7', 'Ⅱ♭7', 'Ⅴ#dim7'].map((n) => analyze(board(`${n} Ⅰ`), table).oddities.length), [1, 1, 1, 1]);
  t.eq('ドミナントでない駒（Ⅰ・Ⅳ・Ⅵm・Ⅱm7・Ⅶm7-5・Ⅳm7・ⅠM7・Ⅵsus4）は、1番に置いても「？」ではない', ['Ⅰ', 'Ⅳ', 'Ⅵm', 'Ⅱm7', 'Ⅶm7-5', 'Ⅳm7', 'ⅠM7', 'Ⅵsus4'].map((n) => analyze(board(n), table).oddities.length), [0, 0, 0, 0, 0, 0, 0, 0]);
  t.eq('Ⅴ を「→」でのばしただけ（5番が「→」）は、「？」ではない', analyze(board('Ⅲm Ⅵm Ⅱm Ⅴ →'), table).oddities.length, 0);
  t.eq('「？」には、理由の文章がある（冒頭・ドミナント）', [analyze(board('Ⅲ7'), table).oddities[0].reason.includes('冒頭'), analyze(board('Ⅲ7'), table).oddities[0].title], [true, '冒頭のドミナント']);
  // 冒頭のドミナントを認める形（2026-11-18）: ラグタイム進行（Ⅲ7→Ⅵ7→Ⅱ7→Ⅴ7 のあと Ⅰ が2つぶん以上）・8小節ブルース
  r = analyze(board('Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7 Ⅰ Ⅰ'), table);
  t.eq('ラグタイム進行: Ⅲ7→Ⅵ7→Ⅱ7→Ⅴ7→Ⅰ→Ⅰ（Ⅰ が2つぶん）= 1つの技（800）。冒頭の Ⅲ7 は、「？」にならない', [kinds(r), r.instances[0].points, r.instances[0].chords.length, r.oddities.length], [['ragtime'], 800, 6, 0]);
  t.eq('ラグタイム進行: 最後の Ⅰ を「→」でのばしてもよい（Ⅰ →）', (() => { const x = analyze(board('Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7 Ⅰ →'), table); return [kinds(x), x.oddities.length]; })(), [['ragtime'], 0]);
  t.eq('ラグタイム進行: Ⅰ が1つだけでは、成立しない。冒頭の Ⅲ7 は「？」（−100）', (() => { const x = analyze(board('Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7 Ⅰ'), table); return [kinds(x).includes('ragtime'), x.oddities.length]; })(), [false, 1]);
  t.eq('ラグタイム進行: Ⅴ7 で終わって Ⅰ がない（Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7）も、成立しない', (() => { const x = analyze(board('Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7'), table); return [kinds(x).includes('ragtime'), x.oddities.length]; })(), [false, 1]);
  t.eq('ラグタイム進行: 5番からは、成立しない（Ⅰ を2つぶん続ける場所が、盤にない）。5番の Ⅲ7 は、「？」ではない', (() => { const x = analyze(board('- - - - Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7'), table); return [kinds(x).includes('ragtime'), x.oddities.length]; })(), [false, 0]);
  t.eq('冒頭が Ⅴ7 で、そのあとに Ⅰ が2つぶん（Ⅴ7 Ⅰ Ⅰ）なら、「？」にならない。Ⅴ7 → Ⅰ は、あとに同じルートの Ⅰ が続いて終わるので、Ⅴ-Ⅰ終止', (() => { const x = analyze(board('Ⅴ7 Ⅰ Ⅰ'), table); return [x.oddities.length, kinds(x)]; })(), [0, ['authentic_cadence']]);
  t.eq('冒頭が Ⅱ7→Ⅴ7→Ⅰ→「→」 や Ⅵ7→Ⅱ7→Ⅴ7→Ⅰ→Ⅰ も、「？」にならない', [analyze(board('Ⅱ7 Ⅴ7 Ⅰ →'), table).oddities.length, analyze(board('Ⅵ7 Ⅱ7 Ⅴ7 Ⅰ Ⅰ'), table).oddities.length], [0, 0]);
  t.eq('冒頭が Ⅴ7 でも、Ⅰ が1つだけ（Ⅴ7 Ⅰ）なら、「？」。Ⅲ7→Ⅰ→Ⅰ（4度ずつ上がらない）も「？」', [analyze(board('Ⅴ7 Ⅰ'), table).oddities.length, analyze(board('Ⅲ7 Ⅰ Ⅰ'), table).oddities.length], [1, 1]);
  t.eq('8小節ブルース（Ⅰ7 から）は、冒頭の Ⅰ7 を認める。Ⅰ7 で始まる別の並び（Ⅰ7 Ⅳ）は「？」', [analyze(board('Ⅰ7 Ⅴ7 Ⅳ Ⅳ Ⅰ7 Ⅴ7 Ⅰ7 Ⅴ7'), table).oddities.length, analyze(board('Ⅰ7 Ⅳ'), table).oddities.length], [0, 1]);
  t.eq('技の一覧にも「？」が出る（describeScore を使う画面用）', typeof analyze(board('Ⅴ7'), table).oddities[0].title, 'string');

  // ============ 3d. 固有進行（名前のついた決まった並び。1番か5番から始まっていないと成立しない）============
  r = analyze(board('Ⅳ Ⅴ Ⅲm Ⅵm'), table);
  t.eq('王道進行（Ⅳ-Ⅴ-Ⅲ-Ⅵ）: 1番から', [kinds(r), r.instances[0].points, r.instances[0].chords.length], [['oudou'], 380, 4]);
  t.eq('王道進行: 5番からでも成立', kinds(analyze(board('- - - - Ⅳ Ⅴ Ⅲm Ⅵm'), table)), ['oudou']);
  t.eq('王道進行: 2番からは成立しない', kinds(analyze(board('- Ⅳ Ⅴ Ⅲm Ⅵm'), table)).includes('oudou'), false);
  t.eq('王道進行: Ⅲ は Ⅲ7 でもよい', kinds(analyze(board('ⅣM7 Ⅴ7 Ⅲ7 Ⅵm7'), table)), ['oudou']);
  t.eq('Ⅳ→Ⅴ→Ⅱm→Ⅵm は王道進行ではない（Ⅲ でなければ）', kinds(analyze(board('Ⅳ Ⅴ Ⅱm Ⅵm'), table)).includes('oudou'), false);
  r = analyze(board('Ⅵm Ⅳ Ⅴ'), table);
  t.eq('小室進行（Ⅵm→Ⅳ→Ⅴ）: 1番から。名前は「小室進行」', [kinds(r), r.instances[0].name, r.instances[0].points], [['komuro'], '小室進行', 240]);
  t.eq('小室進行: 2〜4番に Ⅵm・Ⅳ・Ⅴ が並んでも、成立しない', kinds(analyze(board('- Ⅵm Ⅳ Ⅴ'), table)).includes('komuro'), false);
  t.eq('小室進行: 5〜7番からは成立する', kinds(analyze(board('- - - - Ⅵm Ⅳ Ⅴ'), table)), ['komuro']);
  t.eq('小室進行: 3〜5番は成立しない', kinds(analyze(board('- - Ⅵm Ⅳ Ⅴ'), table)).includes('komuro'), false);
  r = analyze(board('Ⅳ Ⅴ Ⅵm'), table);
  t.eq('Ⅳ→Ⅴ→Ⅵm = Ⅳ-Ⅴ-Ⅵ進行（1番から）', [kinds(r), r.instances[0].points], [['iv_v_vi'], 380]);
  t.eq('Ⅳ-Ⅴ-Ⅵ進行: 2番からは成立しない（Ⅴ→Ⅵm は、後ろに駒がないので、偽終止になる）', kinds(analyze(board('- Ⅳ Ⅴ Ⅵm'), table)), ['deceptive_cadence']);
  r = analyze(board('Ⅳ Ⅲm Ⅵm'), table);
  t.eq('Ⅳ→Ⅲm→Ⅵm = Ⅳ-Ⅲ-Ⅵ進行（丸サ進行ではない）', [kinds(r), r.instances[0].points], [['iv_iii_vi'], 240]);
  t.eq('Ⅳ-Ⅲ-Ⅵ進行: 2番からは成立しない', kinds(analyze(board('- Ⅳ Ⅲm Ⅵm'), table)).includes('iv_iii_vi'), false);
  r = analyze(board('ⅣM7 Ⅲ7 Ⅵm7'), table);
  t.eq('ⅣM7→Ⅲ7→Ⅵm7 = 丸サ進行（1番から）', [kinds(r), r.instances[0].points, r.instances[0].name], [['maru_sa'], 300, '丸サ進行']);
  t.eq('丸サ進行 + Ⅰ7（4つ）', [kinds(analyze(board('ⅣM7 Ⅲ7 Ⅵm7 Ⅰ7'), table)), analyze(board('ⅣM7 Ⅲ7 Ⅵm7 Ⅰ7'), table).instances[0].points], [['maru_sa|Ⅰ7まで'], 420]);
  r = analyze(board('ⅣM7 Ⅲ7 Ⅵm7 Ⅴm7 Ⅰ7'), table);
  t.eq('丸サ進行（完全な形: Ⅴm7→Ⅰ7 まで、5つ）', [kinds(r), r.instances[0].points, r.instances[0].chords.length], [['maru_sa|完全な形'], 600, 5]);
  t.eq('丸サ進行: 2番からは、丸サ進行にも Ⅳ-Ⅲ-Ⅵ進行にもならない', kinds(analyze(board('- ⅣM7 Ⅲ7 Ⅵm7'), table)).some((k) => k.startsWith('maru_sa') || k.startsWith('iv_iii_vi')), false);
  t.eq('丸サ進行: 5番から', kinds(analyze(board('- - - - ⅣM7 Ⅲ7 Ⅵm7'), table)), ['maru_sa']);

  r = analyze(board('Ⅰ Ⅴ Ⅵm Ⅲm Ⅳ'), table);
  t.eq('Ⅰ→Ⅴ→Ⅵm→Ⅲm→Ⅳ = 弱進行（カノン進行）', kinds(r), ['weak_motion|カノン進行']);
  t.eq('カノン進行（5つ）の点数 300', r.instances[0].points, 300);
  r = analyze(board('Ⅰ Ⅴ Ⅵm Ⅲm Ⅳ Ⅰ Ⅳ Ⅴ'), table);
  t.eq('カノン進行（8つ・完全な形）+ ループのつなぎ目（8番 Ⅴ → 1番 Ⅰ）の強進行', kinds(r), ['weak_motion|カノン進行（完全な形）', 'dominant_motion|強進行']);
  t.eq('カノン進行（完全な形）の点数 600、8つの駒', [r.instances[0].points, r.instances[0].chords.length], [600, 8]);
  t.eq('カノン進行: 2番からは成立しない（Ⅰ→Ⅴ などの弱進行は、ふつうに決まる）', kinds(analyze(board('- Ⅰ Ⅴ Ⅵm Ⅲm Ⅳ'), table)).some((k) => k.includes('カノン')), false);

  // 名前のついた進行（新しい固有進行）: 1番から成立 / 2番からは成立しない / 5番から成立
  const named = [
    ['50年代進行（Ⅰ→Ⅵm→Ⅳ→Ⅴ）', 'Ⅰ Ⅵm Ⅳ Ⅴ', 'fifties', 300],
    ['ポップパンク進行（Ⅰ→Ⅴ→Ⅵm→Ⅳ）', 'Ⅰ Ⅴ Ⅵm Ⅳ', 'pop_punk', 300],
    ['循環コード（Ⅰ→Ⅵm→Ⅱm→Ⅴ）', 'Ⅰ Ⅵm Ⅱm Ⅴ', 'junkan', 300],
    ['循環コード（7th・Ⅵ7）', 'ⅠM7 Ⅵ7 Ⅱm7 Ⅴ7', 'junkan', 300],
    ['アンダルシア進行（Ⅵm→Ⅴ→Ⅳ→Ⅲ7）', 'Ⅵm Ⅴ Ⅳ Ⅲ7', 'andalusian', 330],
    ['Ⅰ-Ⅳ-Ⅴ-Ⅰ進行（カデンツ）', 'Ⅰ Ⅳ Ⅴ Ⅰ', 'full_cadence', 400],
  ];
  for (const [label, spec, kind, pts] of named) {
    r = analyze(board(spec), table);
    t.eq(`${label}: 1番から = 1つの技`, [kinds(r), r.instances[0].points], [[kind], pts]);
    t.eq(`${label}: 5番から = 成立する`, kinds(analyze(board('- - - - ' + spec), table)), [kind]);
    t.eq(`${label}: 2番からは成立しない`, kinds(analyze(board('- ' + spec), table)).includes(kind), false);
    t.eq(`${label}: 3番からは成立しない`, kinds(analyze(board('- - ' + spec), table)).includes(kind), false);
  }
  // バックドア進行（Ⅳm7→Ⅶ♭7→Ⅰ）は、終止の仲間（2026-11-18）: フレーズの終わり（4番・8番、または、その後に続く駒がない）で成立する。1番か5番から、ではない
  r = analyze(board('Ⅳm7 Ⅶ♭7 ⅠM7'), table);
  t.eq('バックドア進行（終止）: 1〜3番（最後の駒）= 成立。280', [kinds(r), r.instances[0].points, TRICKS.backdoor.group], [['backdoor'], 280, 'cadence']);
  t.eq('バックドア進行: どこからでも成立する（2番から・3番から・5番から）', ['- Ⅳm7 Ⅶ♭7 ⅠM7', '- - Ⅳm7 Ⅶ♭7 ⅠM7', '- - - - Ⅳm7 Ⅶ♭7 ⅠM7'].map((b) => kinds(analyze(board(b), table))), [['backdoor'], ['backdoor'], ['backdoor']]);
  t.eq('バックドア進行: Ⅰ が4番（フレーズの終わり）なら、前に駒があってもよい（Ⅱm Ⅳm7 Ⅶ♭7 Ⅰ）', kinds(analyze(board('Ⅱm Ⅳm7 Ⅶ♭7 Ⅰ'), table)).includes('backdoor'), true);
  t.eq('バックドア進行: Ⅰ のあとに駒が続く（フレーズの終わりでない）なら、成立しない', kinds(analyze(board('Ⅳm7 Ⅶ♭7 ⅠM7 Ⅳ'), table)).includes('backdoor'), false);
  t.eq('バックドア進行: 途中（Ⅳm7 Ⅶ♭7 まで）では成立しない', kinds(analyze(board('Ⅳm7 Ⅶ♭7'), table)).includes('backdoor'), false);
  // コンファーメーション: ⅠM7→Ⅶm7♭5→Ⅲ7→Ⅵm7（「→」を含んでもよい）。続けて Ⅴm7→Ⅰ7 で完全な形
  r = analyze(board('ⅠM7 Ⅶm7-5 Ⅲ7 Ⅵm7'), table);
  t.eq('コンファーメーション（4つ）: 1番から', [kinds(r), r.instances[0].points], [['confirmation'], 400]);
  r = analyze(board('ⅠM7 → Ⅶm7-5 Ⅲ7 Ⅵm7 → Ⅴm7 Ⅰ7'), table);
  t.eq('コンファーメーション（「→」を含む8つの場所。完全な形）', [kinds(r), r.instances[0].points, r.instances[0].positions.length], [['confirmation|完全な形'], 680, 8]);
  t.eq('コンファーメーション: 5番からも成立', kinds(analyze(board('- - - - ⅠM7 Ⅶm7-5 Ⅲ7 Ⅵm7'), table)), ['confirmation']);
  t.eq('コンファーメーション: 2番からは成立しない（ツーファイブワンなどになる）', kinds(analyze(board('- ⅠM7 Ⅶm7-5 Ⅲ7 Ⅵm7'), table)).includes('confirmation'), false);
  t.eq('コンファーメーション: Ⅲ が Ⅲm7 では成立しない', kinds(analyze(board('ⅠM7 Ⅶm7-5 Ⅲm7 Ⅵm7'), table)).includes('confirmation'), false);
  t.eq('コンファーメーション: ツーファイブワン（Ⅶm7♭5→Ⅲ7→Ⅵm7）より優先される', kinds(analyze(board('ⅠM7 Ⅶm7-5 Ⅲ7 Ⅵm7'), table)).some((k) => k.startsWith('dominant_motion')), false);

  // 偽終止: Ⅵm（Ⅵm7）で終わる。前のコードに限らない（フレーズの終わりでだけ）
  t.eq('偽終止: Ⅳ→Ⅵm（前のコードは Ⅴ でなくてよい）', kinds(analyze(board('- - Ⅳ Ⅵm'), table)), ['deceptive_cadence']);
  t.eq('偽終止: Ⅰ→Ⅵm7（4番で終わる）', kinds(analyze(board('Ⅱm Ⅳ Ⅰ Ⅵm7'), table)).includes('deceptive_cadence'), true);
  t.eq('偽終止: Ⅱm7→Ⅵm7（後ろに駒がない）', kinds(analyze(board('- Ⅱm7 Ⅵm7'), table)), ['deceptive_cadence']);
  t.eq('偽終止: Ⅵm が、フレーズの途中（後ろに駒が続く）なら、成立しない', kinds(analyze(board('- Ⅳ Ⅵm Ⅰ'), table)).includes('deceptive_cadence'), false);
  t.eq('偽終止: 同じルートへの繰り返し（Ⅵm7→Ⅵm）は、ならない', kinds(analyze(board('- Ⅵm7 Ⅵm'), table)), []);
  t.eq('偽終止: 本来の形（Ⅴ→Ⅵm）は、200点。ほかは 150点', [analyze(board('- Ⅴ Ⅵm'), table).instances[0].points, analyze(board('- Ⅳ Ⅵm'), table).instances[0].points], [200, 150]);

  // コードの難しさ（駒のレベル）のボーナス: 技に使われた、ちがう駒ごとに 1回。Lv1 は 0、Lv2 は +5、Lv3 は +10、Lv4 は +20、Lv5 は +30（2026-11-24 に、配分を見直した。技に使われていない駒は、数えない）
  r = analyze(board('Ⅰ Ⅳ'), table);
  t.eq('レベルボーナス: Lv1 の駒（Ⅰ・Ⅳ）だけなら、0', [r.score.levelBonus, r.levelPieces.length], [0, 0]);
  r = analyze(board('ⅠM7 Ⅲ7 Ⅱ♭M7'), table);
  t.eq('レベルボーナス: 技に使われていない駒は、数えない（ⅠM7 Ⅲ7 Ⅱ♭M7 は、どれも技にならない）', [r.instances.length, r.score.levelBonus, r.levelPieces.length], [0, 0, 0]);
  r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7 - Ⅲ♭M7'), table);
  t.eq('レベルボーナス: 技に使われた駒だけ。Ⅱm7(Lv3)+Ⅴ7(Lv2)+ⅠM7(Lv2) = 10+5+5（技に使われていない Ⅲ♭M7(Lv5) は、数えない）', [r.score.levelBonus, r.levelPieces.map((p) => p.name)], [20, ['Ⅱm7', 'Ⅴ7', 'ⅠM7']]);
  r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7 Ⅱm7 Ⅴ7 ⅠM7'), table);
  t.eq('レベルボーナス: 同じ駒を何枚置いても、1回だけ（Ⅱm7・Ⅴ7・ⅠM7 = 20）', r.score.levelBonus, 20);
  t.eq('レベルボーナス: 「→」と、冒頭の Ⅴ（？）の駒は、数えない', [analyze(board('ⅠM7 → →'), table).score.levelBonus, analyze(board('Ⅴ7'), table).score.levelBonus], [0, 0]);
  t.eq('レベルボーナス: 技の倍率（コンボ・種類）には、含めない（400 + 20 + ガイドトーンの半音進行 +60 = 480）', analyze(board('Ⅱm7 Ⅴ7 ⅠM7'), table).score.total, 480);

  r = analyze(board('Ⅰ Ⅴ Ⅳ Ⅳ Ⅰ Ⅴ Ⅰ Ⅴ'), table);
  t.eq('ブルース進行（8小節）: 8つぜんぶ（+ ループのつなぎ目 Ⅴ → Ⅰ の強進行）', [kinds(r), r.instances[0].points, r.instances[0].chords.length], [['blues8|8小節ブルース', 'dominant_motion|強進行'], 550, 8]);
  t.eq('ブルース進行: Ⅳ を「→」でのばしてもよい', kinds(analyze(board('Ⅰ Ⅴ Ⅳ → Ⅰ Ⅴ Ⅰ Ⅴ'), table)).filter((k) => k.startsWith('blues8')), ['blues8|8小節ブルース']);
  t.eq('ブルース進行: Ⅰ7・Ⅴ7 でもよい（冒頭の Ⅰ7 は、「？」にならない）', kinds(analyze(board('Ⅰ7 Ⅴ7 Ⅳ Ⅳ Ⅰ7 Ⅴ7 Ⅰ7 Ⅴ7'), table)).filter((k) => k.startsWith('blues8')), ['blues8|8小節ブルース']);
  t.eq('ブルース進行: 1つでも違えば、成立しない', kinds(analyze(board('Ⅰ Ⅴ Ⅳ Ⅳ Ⅰ Ⅴ Ⅰ Ⅳ'), table)).some((k) => k.startsWith('blues8')), false);
  t.eq('バックドア（Ⅳm7→Ⅶ♭7→ⅠM7。終止）が、借用和音の技（サブドミナントマイナー・その代理）より優先される', kinds(analyze(board('Ⅳm7 Ⅶ♭7 ⅠM7'), table)), ['backdoor']);

  // ============ 4. つながり・休み・「→」 ============
  t.eq('休みをはさむと、つながらない', kinds(analyze(board('- Ⅴ7 - Ⅰ'), table)), []);
  r = analyze(board('- Ⅴ7 → Ⅰ'), table);
  t.eq('「→」は、前の駒をのばす（Ⅴ7→Ⅰ が成立）', kinds(r), ['authentic_cadence']);
  t.eq('「→」を含む位置', r.instances[0].positions, [1, 2, 3]);
  t.eq('先頭の「→」は休み', kinds(analyze(board('→ Ⅴ7 Ⅰ'), table)), ['authentic_cadence']);
  t.eq('「→」でのばしても、固有進行は成立する（Ⅵm → Ⅳ Ⅴ）', kinds(analyze(board('Ⅵm → Ⅳ Ⅴ'), table)), ['komuro']);
  t.eq('空の盤は、技なし・0点', [analyze(board(''), table).instances.length, analyze(board(''), table).score.total, analyze(board(''), table).oddities.length], [0, 0, 0]);
  t.eq('セグメントの数（休みで区切る）', buildSegments(board('Ⅴ7 Ⅰ - Ⅳ'), table).map((s) => s.length), [2, 1]);

  // ============ 5. 優先度（つながりは1つの技だけが取る）============
  r = analyze(board('Ⅳ Ⅴ Ⅲm Ⅵm Ⅳ Ⅴ Ⅵm'), table);
  t.eq('王道進行（1〜4番）と、Ⅳ-Ⅴ-Ⅵ進行（5〜7番）。Ⅵm→Ⅳ の間は、技にならない', [kinds(r), r.instances[0].chain === r.instances[1].chain], [['oudou', 'iv_v_vi'], false]);
  r = analyze(board('Ⅳ Ⅴ Ⅵm Ⅳ Ⅴ Ⅲm Ⅵm'), table);
  t.eq('1番の Ⅳ-Ⅴ-Ⅵ進行 のあと、4番からの王道進行は、成立しない（4番は、小節の頭ではない）', kinds(r).includes('oudou'), false);

  // ============ 6. 点数: コンボ・同じ技の繰り返し・種類の多さ ============
  r = analyze(board('Ⅵm Ⅳ Ⅴ Ⅰ'), table);
  t.eq('小室（Ⅵm→Ⅳ→Ⅴ）+ Ⅴ→Ⅰ終止 = 2つの技が、つながる', kinds(r), ['komuro', 'authentic_cadence']);
  t.eq('コンボ ×1.15 → 240 × 1.15 = 276・200 × 1.15 = 230（合わせて 506）、種類2つで ×1.05 → 531', [r.instances.map((i) => i.total), r.score.base, Math.round(r.score.base * r.score.variety)], [[276, 230], 506, 531]);
  r = analyze(board('- Ⅴ7 Ⅰ - Ⅳ Ⅴ7 Ⅰ'), table);
  t.eq('同じ技の繰り返し（2回目は 0.6 倍）。Ⅴ-Ⅰ終止は、7→8番の最後でも決まる（Ⅴ7 は Lv2 で +10）', [kinds(r), r.instances.map((i) => i.total), r.score.total], [['authentic_cadence', 'authentic_cadence'], [200, 120], 455]);       // 330 + ジャッジ（Ⅳ→Ⅴ7→Ⅰ の「おしまいへ向かう流れ」+50）+ ガイドトーンの半音進行（Ⅴ7 → Ⅰ の ファ → ミ）+30 × 2
  r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7 - ⅣM7 Ⅲ7 Ⅵm7'), table);
  t.eq('種類の違う技を2つ（連鎖なし）= 400 + 300、種類2つで ×1.05 = 735、駒のレベルで +40（Ⅱm7 Lv3・Ⅴ7 Lv2・ⅠM7 Lv2・ⅣM7 Lv2・Ⅲ7 Lv3・Ⅵm7 Lv2）', [r.score.base, r.score.levelBonus, r.score.total], [700, 40, 875]);       // 990 + 80 + ジャッジ（内声 +100: ガイドトーン 30 × 2・丸サの半音の線 +40）

  // 技にならなかったつながりの描写
  r = analyze(board('Ⅰ Ⅱm7'), table);
  t.eq('技にならない → 描写（Ⅰ→Ⅱm7: 全音上）', [r.instances.length, r.unclaimed.length, r.unclaimed[0].tags[0]], [0, 1, '全音上']);

  // ============ 7. 技の種類が、データにそろっている ============
  t.eq('技の種類は26個（つながり4・終止6・固有進行13・借用和音2・内声1。バックドア進行は、2026-11-18 から終止。2026-11-24 に、プラガル終止・クリシェ・パッシング・ディミニッシュを追加）', [Object.keys(TRICKS).length, ['motion', 'cadence', 'named', 'borrowed', 'inner'].map((g) => Object.values(TRICKS).filter((k) => k.group === g).length)], [26, [4, 6, 13, 2, 1]]);
  t.eq('技の番号は 1〜26', Object.values(TRICKS).map((k) => k.no).sort((x, y) => x - y), Array.from({ length: 26 }, (_, i) => i + 1));
  t.ok('どのパターンも、技の種類に結びついている', PATTERNS.every((p) => TRICKS[p.kind]));
  t.ok('名前のついた進行（固有進行）のパターンは、すべて「1番か5番から」の条件を持つ', PATTERNS.filter((p) => TRICKS[p.kind].group === 'named').every((p) => Array.isArray(p.startAt) && p.startAt.every((x) => x === 0 || x === 4)));
  t.ok('終止のパターンは、すべて「フレーズの終わり」の条件を持つ', PATTERNS.filter((p) => TRICKS[p.kind].group === 'cadence').every((p) => p.end === 'phrase'));
  t.ok('つながり（ドミナントモーション・弱進行・半音下）は、どこでも成立する（カノン進行だけ、1番から）', PATTERNS.filter((p) => TRICKS[p.kind].group === 'motion' && p.id !== 'canon').every((p) => !p.startAt && !p.end));
  t.ok('どの技にも、説明の文章と色がある', Object.values(TRICKS).every((k) => k.explain.length > 10 && /^#[0-9a-f]{6}$/i.test(k.color)));
  t.ok('「前半」「途中まで」のような、存在しない名前を使っていない', Object.values(TRICKS).every((k) => ![k.name, k.sub || '', ...Object.keys(k.variants)].some((n) => /前半|途中まで/.test(n))));

  // ============ 7b. ユーザーが作った固有進行（リズム・コード編集の画面から、名前をつけて、ゲームに届く）============
  {
    const kindsBefore = Object.keys(TRICKS).length, patsBefore = PATTERNS.length;
    const added = setCustomProgressions([{ id: 'p1', name: 'ぼくの進行', chords: ['ⅡM7'.replace('ⅡM7', 'Ⅱm7'), 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'], points: 700, startAt: 'head' },
      { id: 'p2', name: 'どこでも進行', chords: ['Ⅳm7', 'Ⅲ♭M7'], points: 300, startAt: 'any' }]);
    t.eq('ユーザーの進行が、技の一覧に入る（kind は custom_ + id）', added, ['custom_p1', 'custom_p2']);
    t.eq('技の種類・パターンが、増える', [Object.keys(TRICKS).length - kindsBefore, PATTERNS.length - patsBefore], [2, 2]);
    r = analyze(board('Ⅱm7 Ⅴ7 Ⅲm7 Ⅵm7'), table);
    t.eq('ユーザーの進行: 1番から並べると決まる（名前・点・仲間）', [kinds(r), r.instances[0].name, r.instances[0].points, r.instances[0].group], [['custom_p1'], 'ぼくの進行', 700, 'named']);
    t.eq('ユーザーの進行: 2番からでは決まらない（固有進行のルール）', kinds(analyze(board('- Ⅱm7 Ⅴ7 Ⅲm7 Ⅵm7'), table)).includes('custom_p1'), false);
    t.eq('ユーザーの進行: 5番からは決まる', kinds(analyze(board('- - - - Ⅱm7 Ⅴ7 Ⅲm7 Ⅵm7'), table)), ['custom_p1']);
    t.eq('ユーザーの進行: 「どこからでも」を選ぶと、2番からでも決まる', kinds(analyze(board('- Ⅳm7 Ⅲ♭M7'), table)), ['custom_p2']);
    t.eq('ユーザーの進行: 「→」は、つなぎ目として無視する', kinds(analyze(board('Ⅱm7 → Ⅴ7 Ⅲm7 Ⅵm7'), table)), ['custom_p1']);
    t.eq('ユーザーの進行は、もとからある進行（王道進行）と、同じ並びなら、先に取る', (() => { setCustomProgressions([{ id: 'p9', name: 'マイ王道', chords: ['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'], points: 650, startAt: 'head' }]); return kinds(analyze(board('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7'), table)); })(), ['custom_p9']);
    t.eq('ヒント: ユーザーの進行の途中も、おすすめに出る（Ⅳm7 のあと）', (() => { setCustomProgressions([{ id: 'p3', name: 'ぼくの', chords: ['Ⅱm7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'], points: 700, startAt: 'head' }]); const h = suggest(board('Ⅱm7'), table, ALL); return h.primary.some((c) => c.reason.includes('ぼくの')); })(), true);
    setCustomProgressions([]);
    t.eq('空にすると、ユーザーの進行は、すべて消える（もとの20+1種類に戻る）', [Object.keys(TRICKS).length, PATTERNS.length, kinds(analyze(board('Ⅱm7 Ⅴ7 Ⅲm7 Ⅵm7'), table)).includes('custom_p1')], [kindsBefore, patsBefore, false]);
    t.eq('名前が壊れた内容（駒が足りない）は、無視する', setCustomProgressions([{ id: 'x', name: 'x', chords: ['Ⅰ'] }, null]), []);
  }

  // ============ 8. ヒント ============
  t.eq('ヒントの位置（空の盤 → 0）', findCursor(board('')), 0);
  t.eq('ヒントの位置（ⅣM7 のあと → 1）', findCursor(board('ⅣM7')), 1);
  t.eq('ヒントの位置（盤がいっぱい → なし）', findCursor(Array(8).fill(1)), null);
  let h = suggest(board('ⅣM7'), table, ALL);
  t.eq('ヒント: ⅣM7 のあと（文脈）', h.context, ['ⅣM7']);
  t.ok('ヒント: おすすめに Ⅴ7', h.primary.some((c) => c.name === 'Ⅴ7'));
  t.ok('ヒント: おすすめに Ⅲ7（丸サ進行）', h.primary.some((c) => c.name === 'Ⅲ7'));
  t.ok('ヒント: 発展に Ⅳm7（借用和音。ⅣM7 → Ⅳm7 → Ⅰ の「サブドミナントマイナー」）', h.advanced.some((c) => c.name === 'Ⅳm7' && /サブドミナントマイナー/.test(c.reason)));
  t.ok('ヒント: おすすめは理由つき', h.primary.every((c) => c.reason.length > 0));
  t.ok('ヒント: おすすめは4つまで・発展は5つまで', h.primary.length <= 4 && h.advanced.length <= 5);
  h = suggest(board(''), table, ALL);
  t.ok('ヒント: 空の盤でも、はじめの一手が出る', h.primary.length > 0 && h.primary.every((c) => c.tier === 1));
  t.ok('ヒント: 1番の最初の駒に、Ⅴ は出ない（「？」になるため）', ![...h.primary, ...h.advanced].some((c) => c.name.startsWith('Ⅴ')));
  h = suggest(board('Ⅱm Ⅲm Ⅴ7'), table, ALL);
  t.ok('ヒント: Ⅴ7 のあとは Ⅰ 系（Ⅴ-Ⅰ終止）', h.primary.some((c) => c.name === 'Ⅰ' || c.name === 'ⅠM7') && h.primary.find((c) => c.name === 'Ⅰ' || c.name === 'ⅠM7').reason.includes('Ⅴ-Ⅰ終止'));
  t.ok('ヒント: Ⅴ7 のあとは Ⅵm 系も（偽終止）', h.primary.some((c) => c.reason.includes('偽終止')));
  h = suggest(board('Ⅵm Ⅳ'), table, ALL);
  t.ok('ヒント: Ⅵm→Ⅳ のあと、Ⅴ（Ⅴ7）で 小室進行', h.primary.some((c) => c.reason.includes('小室進行') && !c.reason.includes('前半')));
  h = suggest(board('Ⅱm Ⅵm Ⅳ'), table, ALL);
  t.ok('ヒント: 2番の Ⅵm から始めても、小室進行のヒントは出ない（固有進行は、1番か5番から）', ![...h.primary, ...h.advanced].some((c) => c.reason.includes('小室進行')));
  h = suggest(board('Ⅱm Ⅰ Ⅱm Ⅲm'), table, ALL);
  t.eq('ヒント: 5番（小節の頭）のカーソル', h.cursor, 4);
  t.ok('ヒント: 5番に、Ⅴ は出ない', ![...h.primary, ...h.advanced].some((c) => c.name.startsWith('Ⅴ')));
  t.ok('ヒント: 5番から始める固有進行の、最初の駒が出る', h.primary.length > 0);
  for (const spec of ['', 'ⅣM7', 'Ⅱm Ⅲm Ⅴ7', 'Ⅵm Ⅳ', 'Ⅱm7', 'Ⅰ Ⅴ Ⅵm', 'Ⅰ Ⅵm', 'Ⅲ7 Ⅵ7']) {
    const x = suggest(board(spec), table, ALL);
    t.log(`ヒント[${spec || '空'}] カーソル=${x.cursor} おすすめ: ` + x.primary.map((c) => `${c.name}（${c.reason}）`).join(' / ') + ' ／ 発展: ' + x.advanced.map((c) => `${c.name}（${c.reason}）`).join(' / '));
  }
  // 使える駒が限られているときは、その駒だけから出す
  h = suggest(board('ⅣM7'), table, [table.byName('Ⅰ').id, table.byName('Ⅴ').id]);
  t.ok('ヒント: 使える駒に限る', [...h.primary, ...h.advanced].every((c) => c.name === 'Ⅰ' || c.name === 'Ⅴ'));

  // ============ 9. 借用和音（サブドミナントマイナーと、その代理）============
  r = analyze(board('Ⅳ Ⅳm7 Ⅰ'), table);
  t.eq('サブドミナントマイナー（Ⅳ→Ⅳm7→Ⅰ）が技になる（220点・借用和音の仲間）', [kinds(r), r.instances[0].points, r.instances[0].group], [['sdm|Ⅳ→Ⅳm→Ⅰ'], 220, 'borrowed']);
  t.eq('ⅣM7 → Ⅳm7 → Ⅰ も同じ（Ⅳ は ⅣM7 でもよい）', kinds(analyze(board('ⅣM7 Ⅳm7 Ⅰ'), table)), ['sdm|Ⅳ→Ⅳm→Ⅰ']);
  t.eq('着地が Ⅴ7 でも技になる（着地は、Ⅰ系かⅤ系）', kinds(analyze(board('Ⅳ Ⅳm7 Ⅴ7'), table)), ['sdm|Ⅳ→Ⅳm→Ⅰ']);
  t.eq('Ⅳm6 でもよい（Ⅳm系）', kinds(analyze(board('Ⅳ Ⅳm6 Ⅰ'), table)), ['sdm|Ⅳ→Ⅳm→Ⅰ']);
  t.eq('Ⅰ → Ⅳm7 → Ⅰ は、サブドミナントマイナーの技（Ⅳm → Ⅰ の自然な着地。ピカルディ終止ではない）', kinds(analyze(board('Ⅰ Ⅳm7 Ⅰ'), table)), ['dominant_motion|強進行', 'sdm']);
  r = analyze(board('Ⅱ♭M7 Ⅴ Ⅰ'), table);
  t.eq('Ⅱ♭M7（ネアポリタン）→ Ⅴ → Ⅰ: ネアポリタン進行（300）1つの技。Ⅴ-Ⅰ終止より先に取る（名前のついた進行は、ふつうの終止に分けたときより、いつも高い）', [kinds(r), r.instances.map((i) => i.total)], [['sdm_sub|ネアポリタン進行'], [300]]);
  r = analyze(board('Ⅱ♭M7 Ⅴ Ⅰ Ⅳ'), table);
  t.eq('Ⅱ♭M7 → Ⅴ → Ⅰ のあとに駒が続く（Ⅴ-Ⅰ が終止にならない位置）: ネアポリタン進行（300）が、1つの技として決まる', [kinds(r), r.instances[0].points], [['sdm_sub|ネアポリタン進行', 'dominant_motion|強進行'], 300]);
  t.eq('Ⅵ♭M7 → Ⅶ♭7 → Ⅰ: ♭Ⅵ の借用和音 + ♭Ⅶ の借用和音（Ⅰ へ着地）', kinds(analyze(board('Ⅵ♭M7 Ⅶ♭7 Ⅰ'), table)), ['sdm_sub|♭Ⅵ', 'sdm_sub|♭Ⅶ']);
  t.eq('Ⅰ → Ⅲ♭M7 → Ⅳ（♭Ⅲ）', kinds(analyze(board('Ⅰ Ⅲ♭M7 Ⅳ'), table)), ['sdm_sub|♭Ⅲ']);
  t.eq('Ⅰ → Ⅲ♭m6 → Ⅱm7（♭Ⅲm6）', kinds(analyze(board('Ⅰ Ⅲ♭m6 Ⅱm7'), table)), ['sdm_sub|♭Ⅲm6']);
  r = analyze(board('Ⅰ Ⅵ♭M7 Ⅲ7'), table);
  t.eq('借用和音のあとが、不自然（Ⅵ♭M7 → Ⅲ7）なら、技にしない。ただし、前の和音とはつながる（共通音が2つ）ので、減点もしない（半音で動き続ける内声の加点は付く: ソ → ソ♯・ミ → ミ♭ → レ）', [kinds(r), r.critiques.filter((c) => c.points < 0).length, r.critiques.map((c) => c.id.split('|')[0])], [[], 0, ['chroma']]);
  t.eq('借用和音の、前後どちらともつながらない（Ⅱm7 → Ⅵ♭M7 → Ⅲ7）→ 技にならず、「唐突な借用和音」の減点', [kinds(analyze(board('Ⅱm7 Ⅵ♭M7 Ⅲ7'), table)), analyze(board('Ⅱm7 Ⅵ♭M7 Ⅲ7'), table).critiques.map((c) => c.id.split('|')[0])], [[], ['incoherent', 'abrupt', 'idle']]);
  t.ok('借用和音の仲間わけ（Ⅳm7・Ⅱ♭M7・Ⅵ♭M7・Ⅶ♭7・Ⅲ♭M7・Ⅲ♭m6 = 借用。Ⅱ♭7 は、裏コードなので、含めない）', ['Ⅳm7', 'Ⅳm6', 'Ⅱ♭M7', 'Ⅵ♭M7', 'Ⅶ♭7', 'Ⅲ♭M7', 'Ⅲ♭m6'].every((n) => isBorrowed(table.byName(n))) && !isBorrowed(table.byName('Ⅱ♭7')) && !isBorrowed(table.byName('Ⅰ')));
  t.ok('着地の表: Ⅳm7 → Ⅰ・Ⅴ は自然 / Ⅳm7 → Ⅲ7 は不自然、Ⅱ♭M7 → Ⅰ は自然 / Ⅱ♭M7 → Ⅳ は不自然', naturalAfterBorrowed(table.byName('Ⅳm7'), table.byName('Ⅰ')) && naturalAfterBorrowed(table.byName('Ⅳm7'), table.byName('Ⅴ')) && !naturalAfterBorrowed(table.byName('Ⅳm7'), table.byName('Ⅲ7')) && naturalAfterBorrowed(table.byName('Ⅱ♭M7'), table.byName('Ⅰ')) && !naturalAfterBorrowed(table.byName('Ⅱ♭M7'), table.byName('Ⅳ')));

  // ============ 10. ジャッジ（名前のついた技にならない並びへの、加点・減点・指摘）============
  // 「種類:点」の一覧にして比べる（id の先頭が、ルールの種類）
  const crit = (rr) => rr.critiques.map((c) => `${c.id.split('|')[0]}:${c.points}`);
  r = analyze(board('Ⅰ Ⅱm Ⅲm Ⅳ'), table);
  t.eq('階段（のぼる）: 4つの和音 → +90。技にはならない', [kinds(r), crit(r), r.score.senseGood, r.score.total], [[], ['stairs:90'], 90, 90]);
  t.eq('階段: 3つなら +60', crit(analyze(board('Ⅰ Ⅱm Ⅲm'), table)), ['stairs:60']);
  r = analyze(board('Ⅳ Ⅲm Ⅱm Ⅰ Ⅶm7-5'), table);
  t.eq('階段（おりる）: 5つ → +120（技の「半音下への進行」とは別に、数える）。4番の Ⅰ で終わるので、「解決」+60 も付く', [crit(r), kinds(r)], [['stairs:120', 'resolve:60'], ['half_step_down', 'half_step_down']]);
  t.eq('5番の Ⅴ は「？」ではない（2026-11-18）ので、階段は5つ（+120）につづく: Ⅰ Ⅱm Ⅲm Ⅳ Ⅴ', (() => { const x = analyze(board('Ⅰ Ⅱm Ⅲm Ⅳ Ⅴ'), table); return [crit(x), x.score.penalty]; })(), [['stairs:120', 'flow_tsd:30'], 0]);
  t.eq('1番の Ⅴ（？）は、階段につながらない（Ⅴ Ⅰ Ⅱm Ⅲm → Ⅰ Ⅱm Ⅲm の3つ。+60）', (() => { const x = analyze(board('Ⅴ Ⅰ Ⅱm Ⅲm'), table); return [crit(x).filter((c) => c.startsWith('stairs')), x.score.penalty]; })(), [['stairs:60'], 100]);
  r = analyze(board('Ⅶm7-5 Ⅰ'), table);
  t.eq('導音の解決（Ⅶ → Ⅰ）: +40（最後が Ⅰ なので、「解決」+60 も付く）', [kinds(r), crit(r)], [[], ['leading:40', 'resolve:60']]);
  t.eq('Ⅶ → Ⅰ でも、小節をまたぐ・Ⅰ系でない着地（Ⅶm7-5 → Ⅵm）は、導音の解決ではない', crit(analyze(board('Ⅶm7-5 Ⅵm'), table)).includes('leading:40'), false);
  t.eq('なめらかな声の動き（3つの和音で、どのつながりも共通音が2つ以上: Ⅰ → Ⅵm → Ⅳ）: +40', [kinds(analyze(board('Ⅰ Ⅵm Ⅳ'), table)), crit(analyze(board('Ⅰ Ⅵm Ⅳ'), table))], [[], ['smooth:40']]);
  r = analyze(board('Ⅳ Ⅴ7 Ⅰ'), table);
  t.eq('機能のながれ（サブドミナント → ドミナント → トニック）: +50。Ⅴ-Ⅰ終止（200点）とは別に数える', [kinds(r), crit(r), r.score.senseGood], [['authentic_cadence'], ['flow_sdt:50', 'link:40'], 90]);       // 機能のながれ +50 と、内声の半音の動き（Ⅴ7 → Ⅰ の ファ → ミ = ガイドトーン +30。シ → ド で、もう1つの声が動くので +10）
  r = analyze(board('Ⅰ Ⅱm Ⅴ'), table);
  t.eq('機能のながれ（トニック → サブドミナント → ドミナント）: +30', [kinds(r), crit(r)], [['dominant_motion|強進行'], ['flow_tsd:30']]);
  r = analyze(board('Ⅰ Ⅳ Ⅴ'), table);
  t.eq('技が、2つのつながりを両方とも取っているときは、ジャッジは重ねて加点しない（二重に数えない）', [kinds(r), crit(r)], [['dominant_motion|強進行', 'dominant_ending'], []]);
  r = analyze(board('Ⅰ Ⅲ7 Ⅵ♭M7'), table);
  t.eq('進行感なし（3つの和音で、どのつながりにも「つながる理由」がない）: −40', [kinds(r), crit(r), r.score.senseBad], [[], ['incoherent:-40', 'idle:-45'], 85]);       // 進行感なし −40 と、役に立っていない駒（3つ × −15）
  r = analyze(board('- Ⅲ7 Ⅵ♭M7 Ⅱ♭7'), table);
  t.eq('唐突な借用和音（借りてきた和音が、前後のどちらとも、つながらない）: −30（と、役に立っていない駒 −15）', crit(r), ['abrupt:-30', 'idle:-15']);
  r = analyze(board('Ⅰ Ⅰ'), table);
  t.eq('同じ和音が続く → 小さな減点（−20。「→」を使うと、1つぶんのばせる）。合計は 0 より下にならない', [crit(r), r.score.total], [['same:-20'], 0]);
  t.ok('どの講評にも、名前・理由・位置・色がある（唐突な借用和音は、借りた和音の1か所を指す）', ['Ⅰ Ⅱm Ⅲm Ⅳ', 'Ⅳ Ⅴ7 Ⅰ', 'Ⅰ Ⅲ7 Ⅵ♭M7', '- Ⅲ7 Ⅵ♭M7 Ⅱ♭7', 'Ⅰ Ⅰ', 'Ⅶm7-5 Ⅰ', 'Ⅰ Ⅵm Ⅳ'].every((spec) => analyze(board(spec), table).critiques.every((c) => c.name && c.reason.length > 20 && c.positions.length >= 1 && /^#[0-9a-f]{6}$/i.test(c.color) && ['good', 'bad', 'note'].includes(c.kind))));
  t.eq('点数のしくみ: 同じ盤を、何度判定しても、同じ結果（ルールで決める。乱数なし）', (() => { const a = JSON.stringify(analyze(board('Ⅰ Ⅲm Ⅵ♭M7 Ⅲ7'), table).critiques); return a === JSON.stringify(analyze(board('Ⅰ Ⅲm Ⅵ♭M7 Ⅲ7'), table).critiques); })(), true);
  t.eq('加点の上限（%d）・減点の上限（%d）'.replace('%d', SENSE.goodCap).replace('%d', SENSE.badCap), [senseTotals([{ points: 120 }, { points: 120 }, { points: 100 }]), senseTotals([{ points: -70 }, { points: -70 }, { points: -70 }])], [{ good: SENSE.goodCap, bad: 0 }, { good: 0, bad: SENSE.badCap }]);
  t.eq('点の表（階段 3/4/5 = 60/90/120・流れ 50/30・導音 40・声 40・サスの解決 40・解決 60・進行感なし −40・唐突 −30）', [SENSE.stairs[3], SENSE.stairs[4], SENSE.stairs[5], SENSE.flowSDT, SENSE.flowTSD, SENSE.leading, SENSE.smooth, SENSE.susResolve, SENSE.resolve, SENSE.incoherent, SENSE.abrupt], [60, 90, 120, 50, 30, 40, 40, 40, 60, 40, 30]);
  t.eq('合計は 0 より下にならない（講評の減点だけで、マイナスにならない）', analyze(board('Ⅱm7 Ⅵ♭M7 Ⅲ7'), table).score.total >= 0, true);
  t.eq('つながりの性質（Ⅰ→Ⅳ: 4度上=自然2・Ⅰ→Ⅱm: 全音=1・Ⅰ→Ⅲ7: 長3度で共通音1 = 0）', [edgeInfo(table.byName('Ⅰ'), table.byName('Ⅳ')).natural, edgeInfo(table.byName('Ⅰ'), table.byName('Ⅱm')).natural, edgeInfo(table.byName('Ⅰ'), table.byName('Ⅲ7')).natural], [2, 1, 0]);

  // ============ 11. ヒントの幅（流れのヒント・フレーズの終わり・ループのつなぎ目・借用和音）============
  h = suggest(board('Ⅰ Ⅳ Ⅴ Ⅵm7'), table, ALL);
  t.eq('ヒントの幅: 4番が Ⅵm 系のとき、5番には Ⅱm7（循環コードの流れ）が、おすすめに出る（5番は、2026-11-18 から、Ⅴ も勧められる）', [h.cursor, h.primary.some((c) => c.name === 'Ⅱm7' && /循環コード/.test(c.reason))], [4, true]);
  h = suggest(board('Ⅰ Ⅵm'), table, ALL);
  t.ok('ヒントの幅: 3番で、「フレーズの終わりに向けて」（Ⅴ を置いて、4番を Ⅰ にすると Ⅴ-Ⅰ終止）が出る', h.primary.some((c) => c.name.startsWith('Ⅴ') && /フレーズの終わりに向けて/.test(c.reason)));
  t.ok('ヒントの幅: Ⅵm のあとの Ⅱm7（循環コードの流れ）も出る', h.primary.some((c) => c.name === 'Ⅱm7' && /循環コード/.test(c.reason)));
  h = suggest(board('Ⅱm7 Ⅴ7'), table, ALL);
  t.ok('ヒントの幅: Ⅱm7 → Ⅴ7 のあとは、Ⅰ（Ⅴ-Ⅰ）と Ⅵm（偽終止）', h.primary.some((c) => /^Ⅰ/.test(c.name) && /ほっと解決/.test(c.reason)) && h.primary.some((c) => c.name === 'Ⅵm' && /偽終止/.test(c.reason)));
  h = suggest(board('Ⅰ Ⅳ Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7 Ⅳ'), table, ALL);
  t.ok('ヒントの幅: 8番を置くとき、1番の Ⅰ へ「ループして」つながる駒（Ⅴ。セブンスの進行なので Ⅴ7）が出る', h.cursor === 7 && [...h.primary, ...h.advanced].some((c) => /^Ⅴ7?$/.test(c.name) && /ループして 1番の Ⅰ へ/.test(c.reason)));
  h = suggest(board('ⅣM7 Ⅳm7'), table, ALL);
  t.ok('ヒントの幅: Ⅳm7 のあとは、借りてきた和音から自然に着地する駒（Ⅰ・Ⅶ♭7 と、Ⅲ♭M7・Ⅵ♭M7 のどちらか。おすすめは4つまでなので、全部は入りきらない）', ['Ⅰ', 'Ⅶ♭7'].every((n) => h.primary.some((c) => c.name === n && /借りてきた和音から、自然に着地/.test(c.reason))) && h.primary.filter((c) => /借りてきた和音から、自然に着地/.test(c.reason)).length >= 3);
  h = suggest(board('Ⅳ Ⅴ Ⅵm'), table, ALL);
  t.ok('ヒントの幅: Ⅳ → Ⅴ → Ⅵm のあと、Ⅴ（セブンスを好むので Ⅴ7）で「ドミナント終止」が決まる（ドミナント終止のチュートリアルの形）', h.primary.some((c) => /^Ⅴ7?$/.test(c.name) && /ドミナント終止/.test(c.reason)));
  for (const spec of ['', 'ⅣM7', 'Ⅰ Ⅵm', 'Ⅱm7 Ⅴ7', 'Ⅰ Ⅳ Ⅴ Ⅵm7', 'Ⅰ Ⅳ Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7 Ⅳ', 'ⅣM7 Ⅳm7', 'Ⅳ Ⅴ Ⅵm', 'Ⅱm Ⅰ Ⅱm Ⅲm']) {
    const x = suggest(board(spec), table, ALL);
    t.ok(`ヒントの数: [${spec || '空'}] おすすめ ≤4・発展 ≤5・同じ駒は重ならない・理由つき`, x.primary.length <= 4 && x.advanced.length <= 5 && new Set([...x.primary, ...x.advanced].map((c) => c.id)).size === x.primary.length + x.advanced.length && [...x.primary, ...x.advanced].every((c) => c.reason.length > 0));
  }

  // ============ 12. サス（sus4）の解決（内声の動き）: Ⅴsus47 → Ⅴ（Ⅴ7）============
  r = analyze(board('Ⅰ Ⅴsus47 Ⅴ7 Ⅰ'), table);
  t.eq('サスの解決: Ⅰ → Ⅴsus47 → Ⅴ7 → Ⅰ で、「サス（sus4）の解決」が +40（弱進行・Ⅴ-Ⅰ終止とは別に数える）', [crit(r).includes('sus:40'), kinds(r)], [true, ['weak_motion', 'authentic_cadence']]);
  r = analyze(board('Ⅱm Ⅴsus47 Ⅴ'), table);
  t.eq('Ⅴsus47 → Ⅴ（3和音）でも、サスの解決（+40）', crit(r).includes('sus:40'), true);
  t.eq('サスの解決の講評: 名前・理由（4度の音が、半音さがって、3度の音へ）・位置（2つの駒）', (() => { const c = analyze(board('Ⅰ Ⅴsus47 Ⅴ7'), table).critiques.find((x) => x.id.startsWith('sus|')); return [c.name, /半音さがって/.test(c.reason) && /内声/.test(c.reason), c.positions, c.kind]; })(), ['サス（sus4）の解決', true, [1, 2], 'good']);
  t.eq('小節の頭（1番）の Ⅴsus47 は「？」なので、サスの解決にならない', crit(analyze(board('Ⅴsus47 Ⅴ7 Ⅰ'), table)).includes('sus:40'), false);
  t.eq('sus → Ⅰ（Ⅴsus47 → Ⅰ）は、サスの解決ではない（ルートが同じ駒への解決だけ）', crit(analyze(board('Ⅰ Ⅴsus47 Ⅰ'), table)).includes('sus:40'), false);
  t.eq('Ⅴ7 → Ⅴsus47（逆向き）も、サスの解決ではない', crit(analyze(board('Ⅱm Ⅴ7 Ⅴsus47'), table)).includes('sus:40'), false);
  h = suggest(board('Ⅰ Ⅳ Ⅴsus47'), table, ALL);
  t.ok('ヒント: Ⅴsus47 のあとは、Ⅴ（Ⅴ7）で「サスの解決」', h.primary.some((c) => (c.name === 'Ⅴ7' || c.name === 'Ⅴ') && /サス/.test(c.reason)));

  // ============ 13. メロディとの相性: 音の分類（コードの音・テンション・アヴォイド・どれでもない）============
  {
    const PC = { 'ド': 0, 'ド♯': 1, 'レ': 2, 'レ♯': 3, 'ミ': 4, 'ファ': 5, 'ファ♯': 6, 'ソ': 7, 'ソ♯': 8, 'ラ': 9, 'ラ♯': 10, 'シ': 11 };
    const cls = (chord, note) => MEL.classifyNote(table.byName(chord), PC[note]).cat;
    const table13 = {
      'ⅠM7': { 'ド': 'chord', 'ミ': 'chord', 'ソ': 'chord', 'シ': 'chord', 'レ': 'tension', 'ラ': 'tension', 'ファ♯': 'tension', 'ファ': 'avoid', 'ド♯': 'avoid', 'ソ♯': 'avoid', 'ラ♯': 'passing', 'レ♯': 'passing' },
      'Ⅰ': { 'シ': 'tension', 'ファ': 'avoid', 'ミ': 'chord', 'ラ': 'tension', 'レ': 'tension' },
      'Ⅴ7': { 'ソ': 'chord', 'シ': 'chord', 'レ': 'chord', 'ファ': 'chord', 'ラ': 'tension', 'ミ': 'tension', 'ド': 'avoid', 'ファ♯': 'avoid', 'ソ♯': 'tension', 'ラ♯': 'tension', 'ド♯': 'tension', 'レ♯': 'tension' },
      'Ⅴ': { 'ファ': 'tension', 'ド': 'avoid', 'ラ': 'tension', 'ミ': 'tension' },
      'Ⅱm7': { 'ミ': 'tension', 'ソ': 'tension', 'シ': 'tension', 'ラ♯': 'avoid', 'レ♯': 'avoid', 'ファ♯': 'avoid', 'ド': 'chord' },
      'Ⅲm7': { 'ファ': 'avoid', 'ド': 'avoid', 'ラ': 'tension', 'レ': 'chord', 'ファ♯': 'tension' },
      'Ⅵm7': { 'シ': 'tension', 'レ': 'tension', 'ファ': 'avoid', 'ファ♯': 'tension', 'ソ': 'chord' },
      'ⅣM7': { 'シ': 'tension', 'ソ': 'tension', 'レ': 'tension', 'ラ♯': 'avoid', 'ミ': 'chord' },
      'Ⅶm7-5': { 'ド': 'avoid', 'ミ': 'tension', 'ソ': 'tension', 'ド♯': 'tension', 'ラ': 'chord' },
      'Ⅴsus47': { 'ド': 'chord', 'ファ': 'chord', 'シ': 'avoid', 'ラ': 'tension', 'ミ': 'tension' },
      'Ⅳm7': { 'ソ♯': 'chord', 'ラ': 'avoid', 'ミ': 'avoid', 'ソ': 'tension', 'ラ♯': 'tension', 'レ': 'tension', 'ファ': 'chord' },
      'Ⅲ7': { 'ソ♯': 'chord', 'ソ': 'tension', 'ファ': 'tension', 'ド': 'tension', 'ラ': 'avoid', 'ファ♯': 'tension' },
    };
    let n13 = 0, bad13 = [];
    for (const [chord, expect] of Object.entries(table13)) for (const [note, want] of Object.entries(expect)) { n13++; const got = cls(chord, note); if (got !== want) bad13.push(`${chord}×${note}: ${got}（期待 ${want}）`); }
    t.eq(`メロディの音の分類: ${n13}通り（コードの音・テンション・アヴォイド・どれでもない）が、期待どおり`, bad13, []);
    t.eq('アヴォイドの理由: Ⅰ の上の「ファ」は、コードの音「ミ」の半音上', MEL.classifyNote(table.byName('Ⅰ'), PC['ファ']).because, 'ミ');
    t.eq('テンションの呼び名: ⅠM7 の「レ」= 9th、「ラ」= 13th。Ⅱm7 の「ソ」= 11th。Ⅴ7 の「ド♯」= ♯11th', [MEL.classifyNote(table.byName('ⅠM7'), 2).label, MEL.classifyNote(table.byName('ⅠM7'), 9).label, MEL.classifyNote(table.byName('Ⅱm7'), 7).label, MEL.classifyNote(table.byName('Ⅴ7'), 1).label], ['9th', '13th', '11th', '♯11th']);
    t.eq('コードの音の呼び名（Ⅰ の ド・ミ・ソ = ルート・3度・5度）', [0, 4, 7].map((pc) => MEL.classifyNote(table.byName('Ⅰ'), pc).label), ['ルート', '3度', '5度']);
    t.eq('音名（ド レ♭ ミ ... シ）・MIDI（E5 = 76、C4 = 60）', [MEL.noteName(0), MEL.noteName(1, true), MEL.noteName(11), MEL.midiOf('E5'), MEL.midiOf('C4'), MEL.midiOf('Bb4'), MEL.midiOf('F#5')], ['ド', 'レ♭', 'シ', 76, 60, 70, 78]);
    const pm = MEL.parseMelody('E5:4 r:2 Ab5:2 | C6:8');
    t.eq('メロディの文字: 音名:長さ（r = 休み。| は区切り）→ [開始, 長さ, MIDI, 呼び名]', [pm.notes, pm.slots], [[[0, 4, 76, 'ミ'], [6, 2, 80, 'ラ♭'], [8, 8, 84, 'ド']], 16]);

    // ---- ステップごとの切り分け: 拍の強さと重み・のびている音 ----
    const mel = { notes: MEL.parseMelody('E5:4 G5:12').notes };                    // E（0〜3）G（4〜15: 次のステップへのびる）
    const sg = MEL.stepSegments(mel);
    t.eq('切り分け: ステップ1 に E（頭・長さ4）と G（2拍目・長さ4）、ステップ2 に のびた G（長さ8）', [sg[0].map((x) => [x.name, x.from, x.len, x.attack]), sg[1].map((x) => [x.name, x.from, x.len, x.attack])], [[['ミ', 0, 4, true], ['ソ', 4, 4, true]], [['ソ', 0, 8, false]]]);
    t.eq('重み: ステップの頭 ×1.6、2拍目 ×1.3、のびている音 ×1.0（長さをかける）', [sg[0][0].weight, sg[0][1].weight, sg[1][0].weight], [4 * 1.6, 4 * 1.3, 8]);
    const orn = MEL.stepSegments({ notes: [[0, 4, 76], [6, 2, 77], [4, 2, 77], [3, 1, 79]] })[0];
    t.eq('経過音（8分音符より短く、拍の頭でない音）= 6マス目の2マス・3マス目の1マス。頭の4マスと、2拍目の頭（4マス目）の2マスは、経過音ではない', orn.map((x) => x.ornament), [false, true, false, true]);
    const I = table.byName('Ⅰ');
    const segs = (text) => MEL.stepSegments({ notes: MEL.parseMelody(text).notes })[0];
    t.eq('ファ（アヴォイド）が、強く・長いと avoid、短く弱いと passing（通りすぎる）', [MEL.judgeSegment(I, segs('F5:4 r:4')[0]).kind, MEL.judgeSegment(I, segs('r:6 F5:2')[0]).kind], ['avoid', 'passing']);
    t.eq('どれでもない音（シ♭）: 強く・長いと unstable（−0.25）、短く弱いと passing（0）', [MEL.judgeSegment(I, segs('Bb5:4 r:4')[0]), MEL.judgeSegment(I, segs('r:6 Bb5:2')[0])].map((j) => [j.kind, j.value]), [['unstable', -0.25], ['passing', 0]]);
    t.eq('点の表: コードの音 1・テンション 1・経過音 0・不安定 −0.25・アヴォイド −1。1ステップの満点 150', [MEL.MELODY_SCORE.value, MEL.MELODY_SCORE.stepMax], [{ chord: 1, tension: 1, passing: 0, unstable: -0.25, avoid: -1 }, 150]);
  }

  // ============ 14. メロディとの相性: 採点 ============
  {
    const m1 = MELODY_STAGES[0].melody;
    const ans1 = board('Ⅰ Ⅵm Ⅳ Ⅴ Ⅰ Ⅳ Ⅴ Ⅰ');
    let jm = MEL.judgeMelody(ans1, m1, table);
    t.eq('お手本（Ⅰ Ⅵm Ⅳ Ⅴ Ⅰ Ⅳ Ⅴ Ⅰ）: 8ステップとも満点（150）・相性 100%・アヴォイドなし', [jm.steps.map((x) => x.points), jm.match, jm.counts.avoid, jm.counts.unstable], [Array(8).fill(150), 1, 0, 0]);
    t.eq('強い拍がテンションのステップには、ボーナス +40（お手本では、1つのステップ）。合計 = 1200 + 40', [jm.sumPoints, jm.bonus, jm.total], [1200, 40, 1240]);
    jm = MEL.judgeMelody(board('Ⅰ Ⅰ Ⅰ Ⅰ Ⅰ Ⅰ Ⅰ Ⅰ'), m1, table);
    t.ok(`ぜんぶ Ⅰ だと、「ファ」の強い拍で、ぶつかる（3番・4番・6番が、満点より低い。相性 ${Math.round(jm.match * 100)}%）`, jm.steps[2].points < 50 && jm.steps[3].points < 150 && jm.steps[5].points < 50 && jm.match < 0.75);
    t.eq('お手本の相性 > ぜんぶ Ⅰ の相性', MEL.judgeMelody(ans1, m1, table).match > jm.match, true);
    // 空き・休み・「→」
    jm = MEL.judgeMelody(board('Ⅰ - Ⅳ'), m1, table);
    t.eq('和音のないステップ（メロディはある）: 0点・「和音が、まだない」（missing）。満点の分には、数える', [jm.steps[1].verdict, jm.steps[1].points, jm.steps[1].chord, jm.maxPoints, jm.scored], ['missing', 0, null, 1200, 2]);
    jm = MEL.judgeMelody(board('Ⅰ → Ⅳ'), m1, table);
    t.eq('「→」は、前の和音をのばすので、2番は Ⅰ として採点される（ラ・ドは、Ⅰ の上で、テンション・コードの音）', [jm.steps[1].chord, jm.steps[1].points], ['Ⅰ', 150]);
    const rest = { notes: MEL.parseMelody('E5:4 G5:4 | r:8 | C6:8').notes };
    jm = MEL.judgeMelody(board('Ⅰ Ⅰ Ⅰ'), rest, table);
    t.eq('メロディのお休みのステップ: 採点しない・満点にも数えない（rest）', [jm.steps[1].verdict, jm.steps[1].hasNotes, jm.maxPoints], ['rest', false, 300]);
    // のびている音（和音が変わっても、鳴り続ける音）は、次の和音で、あらためて採点される
    const held = { notes: MEL.parseMelody('C6:16').notes };
    jm = MEL.judgeMelody(board('Ⅳ Ⅴ'), held, table);
    t.eq('ド（C6）を 2ステップのばす: Ⅳ の上では、コードの音（5度）。Ⅴ に変わると、アヴォイド（のびている音は、強い拍扱いではないが、重みはそのまま）', [jm.steps[0].items[0].kind, jm.steps[1].items[0].kind, jm.steps[1].items[0].attack, jm.steps[1].points < 0], ['chord', 'avoid', false, true]);
    // ボーナスの条件と上限
    const tens = { notes: MEL.parseMelody('D5:8 | D5:8 | D5:8 | D5:8 | D5:8').notes };       // レ（9th）を、強い拍で、5ステップ
    jm = MEL.judgeMelody(board('Ⅰ Ⅰ Ⅰ Ⅰ Ⅰ'), tens, table);
    t.eq('テンションのボーナスは、3ステップまで（+40 × 3 = +120）', [jm.steps.map((x) => x.bonus), jm.bonus], [[40, 40, 40, 0, 0, 0, 0, 0], 120]);
    jm = MEL.judgeMelody(board('Ⅰ'), { notes: MEL.parseMelody('D5:4 F5:4').notes }, table);
    t.eq('テンションがあっても、ぶつかる音（ファ）が強い拍にあると、ボーナスなし', [jm.steps[0].bonus, jm.steps[0].verdict === 'color'], [0, false]);
    t.eq('相性（match）= 点の合計 ÷ 満点。マイナスのときは 0', (() => { const j = MEL.judgeMelody(board('Ⅴ Ⅴ'), { notes: MEL.parseMelody('C6:8 | C6:8').notes }, table); return [j.sumPoints < 0, j.match]; })(), [true, 0]);
    // 採点は、ふだんの採点に足される
    const res = analyze(ans1, table);
    applyMelody(res, ans1, m1, table);
    t.eq('applyMelody: 合計 = コード進行の点（0点で切る前）+ メロディの点（0点で切る）', [res.score.total, res.score.total === Math.max(0, res.score.raw + res.score.melody), res.score.melodyMatch], [Math.max(0, res.score.raw + res.score.melody), true, 1]);
    const res0 = analyze(board('Ⅱm7 Ⅵ♭M7 Ⅲ7'), table); applyMelody(res0, board('Ⅱm7 Ⅵ♭M7 Ⅲ7'), m1, table);
    t.ok('合計は、メロディが大きくぶつかっても、0 より下にならない', res0.score.total >= 0);
  }

  // ============ 15. メロディのデータ（5つ）============
  {
    t.eq('メロディのステージは5つ（id と番号は重ならない）', [MELODY_STAGES.length, new Set(MELODY_STAGES.map((m) => m.id)).size, MELODY_STAGES.map((m) => m.no)], [5, 5, [1, 2, 3, 4, 5]]);
    for (const st of MELODY_STAGES) {
      const m = st.melody;
      t.eq(`${st.id}「${st.title}」: 1周は 64マス（8ステップ）`, m.slots, 64);
      const sorted = m.notes.every((n, i) => i === 0 || n[0] >= m.notes[i - 1][0] + m.notes[i - 1][1]);
      t.ok(`${st.id}: 音は、時間の順で、重ならない・周回の外に、はみ出さない`, sorted && m.notes.every(([s0, len]) => s0 >= 0 && s0 + len <= 64 && len >= 1));
      t.ok(`${st.id}: 音の高さは、C5〜E6（72〜88）。ひとつながりのメロディ`, m.notes.every(([, , n]) => n >= 72 && n <= 88) && m.notes.length >= 12);
      t.ok(`${st.id}: 説明（intro・outro・tips）がある。名前・サブタイトル・色もある`, st.intro.length >= 2 && st.outro.length >= 1 && st.tips.length >= 1 && st.title && st.sub && /^#[0-9a-f]{6}$/i.test(st.color));
      t.ok(`${st.id}: 使える駒は、すべて表にある`, !st.pieces || st.pieces.every((n) => !!table.byName(n)));
      const ans = board(st.answer.join(' '));
      t.ok(`${st.id}: お手本は 8つで、使える駒の中にある`, st.answer.length === 8 && (!st.pieces || st.answer.every((n) => st.pieces.includes(n))));
      const par = melodyPar(st, table);
      const j = MEL.judgeMelody(ans, m, table);
      t.ok(`${st.id}: お手本の相性は 95% 以上（${Math.round(j.match * 100)}%）、得点は 1000 点以上（${par.total}）`, j.match >= 0.95 && par.total >= 1000);
      // 1つの和音（先頭の駒）だけで、ぜんぶ埋めても、お手本より、相性が、ずっと低い（ハーモナイズが、必要なメロディ）
      const flat = MEL.judgeMelody(board(Array(8).fill(st.answer[0]).join(' ')), m, table);
      t.ok(`${st.id}: ${st.answer[0]} ばかり並べると、相性が下がる（${Math.round(flat.match * 100)}%）`, flat.match < (st.id === 'm01' ? 0.75 : 0.65));
      t.log(`${st.id} ${st.title}: お手本の合計 ${par.total}（メロディ ${par.melody}・コード進行 ${par.progression}）／ ${st.answer[0]} ばかり: 相性 ${Math.round(flat.match * 100)}%`);
    }
    // 特別な罠: 3番の「ド」を長くのばす → Ⅴ（Ⅴ7）はぶつかる。Ⅴsus47 なら、コードの音
    const m3 = MELODY_STAGES[2];
    const mid = (name) => MEL.judgeMelody(board(m3.answer.map((n, i) => (i === 2 ? name : n)).join(' ')), m3.melody, table).steps[2];
    t.eq('3番（ド を長くのばす）: Ⅴsus47 は満点・Ⅴ7 はぶつかる（アヴォイド）', [mid('Ⅴsus47').points, mid('Ⅴ7').items[0].kind, mid('Ⅴ7').points < 0], [150, 'avoid', true]);
    const m5 = MELODY_STAGES[4];
    const s4 = (name) => MEL.judgeMelody(board(m5.answer.map((n, i) => (i === 3 ? name : n)).join(' ')), m5.melody, table).steps[3];
    t.ok('5つめのメロディ（ラ♭）: 4番に Ⅳm7 は満点。Ⅳ は不安定（減点）、Ⅰ はアヴォイド', s4('Ⅳm7').points === 150 && s4('Ⅳ').points < 150 && s4('Ⅰ').items[0].kind === 'avoid');
    const m4 = MELODY_STAGES[3];
    const s2 = (name) => MEL.judgeMelody(board(m4.answer.map((n, i) => (i === 1 ? name : n)).join(' ')), m4.melody, table).steps[1];
    t.ok('4つめのメロディ（ソ♯）: 2番に Ⅲ7 は満点。Ⅲm7・Ⅰ は、ぶつかる', s2('Ⅲ7').points === 150 && s2('Ⅲm7').points < 100 && s2('Ⅰ').items[0].kind === 'avoid');
  }

  // ============ 16. メロディのステージのヒント ============
  {
    const st = MELODY_STAGES[0], mel = st.melody;
    const allowed = st.pieces.map((n) => table.byName(n).id);
    // 3番（ファ・ラ・ド）: Ⅳ が合う。Ⅰ・Ⅵm は、ぶつかる（ヒントに出さない）
    let hm = suggest(board('Ⅰ Ⅵm'), table, allowed, { melody: mel });
    const all = [...hm.primary, ...hm.advanced];
    t.eq('メロディのヒント: 次の場所（3番）の位置', hm.cursor, 2);
    t.ok('メロディのヒント: 3番に、Ⅳ（ファ・ラ・ド が全部コードの音）が出る。理由に「メロディ:」がつく', all.some((c) => c.name === 'Ⅳ' && /メロディ: .*コードの音/.test(c.reason)));
    t.ok('メロディのヒント: メロディとぶつかる駒（Ⅰ・Ⅵm・Ⅲm）は、出ない', !all.some((c) => ['Ⅰ', 'Ⅵm', 'Ⅲm'].includes(c.name)));
    t.ok('メロディのヒント: 出た駒は、ぜんぶ、メロディとの相性が 0.5 以上', all.every((c) => MEL.stepFit(mel, 2, table.byId(c.id)) >= 0.5));
    hm = suggest(board(''), table, allowed, { melody: mel });
    t.ok('メロディのヒント: 1番（ミ・ソ）には、Ⅰ・Ⅵm など、ぶつからない駒だけ', [...hm.primary, ...hm.advanced].length > 0 && [...hm.primary, ...hm.advanced].every((c) => MEL.stepFit(mel, 0, table.byId(c.id)) >= 0.5));
    const plain = suggest(board('Ⅰ Ⅵm'), table, allowed);
    t.ok('メロディなしのヒントは、これまでどおり（Ⅰ なども出うる）で、メロディの理由は、つかない', ![...plain.primary, ...plain.advanced].some((c) => /メロディ:/.test(c.reason)));
    // 全ステップで: 出たヒントは、ぶつからない
    let okAll = true;
    for (const stg of MELODY_STAGES) {
      const al = stg.pieces ? stg.pieces.map((n) => table.byName(n).id) : ALL;
      for (let k = 0; k <= 7; k++) {
        const b = board(stg.answer.slice(0, k).join(' ') || '-');
        const x = suggest(k === 0 ? board('') : b, table, al, { melody: stg.melody });
        if (x.cursor !== k) continue;
        for (const c of [...x.primary, ...x.advanced]) { const f = MEL.stepFit(stg.melody, k, table.byId(c.id)); if (f !== null && f < 0.5) okAll = false; }
      }
    }
    t.eq('メロディのヒント: 5つのメロディ × 8か所で、出た駒は、いつも、ぶつからない（相性 0.5 以上）', okAll, true);
  }

  // ============ 17. プリセット（お気に入りの進行）============
  {
    const b = board('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 - Ⅱm7 Ⅴ7 ⅠM7');
    let r = makePreset({ name: '  王道  ', board: b, from: 0, to: 3, table });
    t.eq('保存: 範囲を切り出す（名前は、前後の空白をとる）', [r.ok, r.preset.name, r.preset.chords, r.from, r.to], [true, '王道', ['ⅣM7', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'], 0, 3]);
    r = makePreset({ board: b, from: 3, to: 6, table });
    t.eq('保存: 途中の空きは、お休み（null）として、残る。「プリセット 1」の名前', [r.preset.chords, r.preset.name], [['Ⅵm7', null, 'Ⅱm7', 'Ⅴ7'], 'プリセット 1']);
    r = makePreset({ board: b, from: 4, to: 7, table });
    t.eq('保存: 前後の空きは、切り落とす（5番〜8番の選択 → 6番〜8番）。from/to も、切り落とした範囲', [r.preset.chords, r.from, r.to], [['Ⅱm7', 'Ⅴ7', 'ⅠM7'], 5, 7]);
    t.eq('保存: 駒が2つ未満（1つだけ・空きだけ）は、few', [makePreset({ board: b, from: 0, to: 0, table }).reason, makePreset({ board: b, from: 4, to: 4, table }).reason, makePreset({ board: b, from: 3, to: 4, table }).reason], ['few', 'few', 'few']);
    t.eq('保存: 範囲が正しくない（逆・はみ出し・数でない）は、range', [makePreset({ board: b, from: 3, to: 1, table }).reason, makePreset({ board: b, from: 0, to: 8, table }).reason, makePreset({ board: b, from: -1, to: 2, table }).reason, makePreset({ board: b, from: 'a', to: 2, table }).reason], ['range', 'range', 'range', 'range']);
    const first = makePreset({ name: '王道', board: b, from: 0, to: 3, table }).preset;
    r = makePreset({ name: 'べつの名前', board: b, from: 0, to: 3, table, existing: [first] });
    t.eq('保存: 同じ進行は、名前がちがっても、duplicate（すでにある名前を返す）', [r.ok, r.reason, r.existing], [false, 'duplicate', '王道']);
    t.eq('保存: 同じ名前でも、ちがう進行は、保存できる', makePreset({ name: '王道', board: b, from: 5, to: 7, table, existing: [first] }).ok, true);
    t.eq('保存: 30個まで（いっぱいなら full）', makePreset({ board: b, from: 5, to: 7, table, existing: Array.from({ length: MAX_PRESETS }, (_, i) => ({ id: `x${i}`, name: `n${i}`, chords: ['Ⅰ', `${i}`] })) }).reason, 'full');
    t.eq('保存: 名前は 20文字まで', [...makePreset({ name: 'あ'.repeat(50), board: b, from: 0, to: 3, table }).preset.name].length, 20);
    t.eq('保存: 「→」も駒として、残る', makePreset({ board: board('Ⅰ → Ⅳ'), from: 0, to: 2, table }).preset.chords, ['Ⅰ', '→', 'Ⅳ']);
    t.eq('名前を省いたときの名前: すでにある名前と重ならない（プリセット 1 があれば 2。「プリセット 2」が1つだけあれば 3）', [defaultName([]), defaultName([{ name: 'プリセット 1' }]), defaultName([{ name: 'プリセット 2' }])], ['プリセット 1', 'プリセット 2', 'プリセット 3']);
    t.eq('trimChords / sameChords', [trimChords([null, 'Ⅰ', null, 'Ⅳ', null]), sameChords(['Ⅰ', null], ['Ⅰ', null]), sameChords(['Ⅰ'], ['Ⅰ', null])], [{ chords: ['Ⅰ', null, 'Ⅳ'], offset: 1 }, true, false]);
    // 置き方
    const p3 = { chords: ['Ⅱm7', 'Ⅴ7', 'ⅠM7'] };
    let plan = placementPlan(p3, 1, table);
    t.eq('置き方: 2番（1）から3つ', [plan.start, plan.end, plan.count, plan.entries.map((e) => [e.slot, e.name, e.id])], [1, 3, 3, [[1, 'Ⅱm7', table.byName('Ⅱm7').id], [2, 'Ⅴ7', table.byName('Ⅴ7').id], [3, 'ⅠM7', table.byName('ⅠM7').id]]]);
    plan = placementPlan(p3, 7, table);
    t.eq('置き方: 8つの場所に収まらないときは、左へずらす（8番から → 6番から）', [plan.start, plan.end], [5, 7]);
    t.eq('置き方: お休み（null）は、空きにする指定（id = null）。数えない', (() => { const x = placementPlan({ chords: ['Ⅰ', null, 'Ⅳ'] }, 0, table); return [x.entries.map((e) => e.id === null ? null : e.name), x.count]; })(), [['Ⅰ', null, 'Ⅳ'], 2]);
    t.eq('置き方: 始まりが変な値（NaN・負）でも、0 以上におさまる', [placementPlan(p3, NaN, table).start, placementPlan(p3, -3, table).start], [0, 0]);
    // 検査（保存してあった内容が壊れていても、ゲームが動く）
    const dirty = [null, 5, { chords: 'x' }, { chords: ['Ⅰ'] }, { chords: ['Ⅰ', 'まぼろしの和音'] }, { chords: [null, 'Ⅰ', 'Ⅳ', null], name: '  たし ', id: 'keep', at: 12 }, { chords: Array(9).fill('Ⅰ') }, { chords: ['Ⅰ', 'Ⅳ'], name: '', at: 'x' }];
    const clean = sanitizePresets(dirty, table);
    t.eq('検査: 壊れたものは捨てる。前後の空きは切る・名前は整える・名前なしは自動の名前・id は残す', [clean.length, clean[0].chords, clean[0].name, clean[0].id, clean[0].at, clean[1].name, clean[1].at], [2, ['Ⅰ', 'Ⅳ'], 'たし', 'keep', 12, 'プリセット 2', 0]);
    t.eq('検査: 配列でなければ、空', [sanitizePresets(undefined, table), sanitizePresets('x', table)], [[], []]);
    t.eq('検査: 30個を超えない', sanitizePresets(Array.from({ length: 40 }, (_, i) => ({ chords: ['Ⅰ', 'Ⅳ'], name: `n${i}` })), table).length, 30);
    // 出し入れ
    const sv = { presets: [{ id: 'old', name: '古い', chords: ['Ⅰ', 'Ⅳ'], at: 1 }, { chords: ['bad'] }] };
    const store = new PresetStore(sv, table);
    t.eq('出し入れ: 読み込むとき、検査する（壊れたものは消える）', store.list().map((p) => p.id), ['old']);
    const added = store.add({ name: '新しい', board: b, from: 0, to: 3 });
    t.eq('出し入れ: 追加は、先頭（新しいものが上）。保存先（save.presets）に入る', [added.ok, store.list().map((p) => p.name), sv.presets === store.list()], [true, ['新しい', '古い'], true]);
    t.eq('出し入れ: 同じ進行は追加できない', store.add({ name: 'ふたつめ', board: b, from: 0, to: 3 }).reason, 'duplicate');
    t.eq('出し入れ: 名前を変える（空の名前は、変えない）', [store.rename(added.preset.id, '改名'), store.rename(added.preset.id, '  '), store.get(added.preset.id).name, store.rename('nothing', 'x')], [true, false, '改名', false]);
    t.eq('出し入れ: 削除（ないものは false）', [store.remove(added.preset.id), store.remove(added.preset.id), store.list().map((p) => p.name)], [true, false, ['古い']]);
  }
  // ============ 18. 解決（フレーズの終わりの、安定したトニック）・ピカルディ終止・ヒントの開始（2026-11-17）============
  {
    const cr = (rr) => rr.critiques.filter((c) => c.points !== 0).map((c) => `${c.id.split('|')[0]}:${c.points}`);
    const resolves = (spec) => cr(analyze(board(spec), table)).filter((x) => x.startsWith('resolve'));
    t.eq('解決: Ⅱm7 → ⅠM7（2つ目 = いちばん最後の駒）= +60（技にはならない。ルートが全音下がるだけ。点は、解決 60 だけ。技に使われていない駒は、コードの難しさの加点がつかない）', [kinds(analyze(board('Ⅱm7 ⅠM7'), table)), cr(analyze(board('Ⅱm7 ⅠM7'), table)), analyze(board('Ⅱm7 ⅠM7'), table).score.senseGood, analyze(board('Ⅱm7 ⅠM7'), table).score.total], [[], ['resolve:60'], 60, 60]);
    t.eq('解決: Ⅵm 系で終える形は、偽終止（200）が、その着地を評価する（Ⅲm7 → Ⅵm7）。重ねて加点しない', [kinds(analyze(board('Ⅲm7 Ⅵm7'), table)), resolves('Ⅲm7 Ⅵm7')], [['deceptive_cadence'], []]);
    t.eq('解決: Ⅱm7 → Ⅰ・Ⅲm7 → Ⅰ・Ⅶm7-5 → Ⅰ も、解決（Ⅰ系で終える）', ['Ⅱm7 Ⅰ', 'Ⅲm7 Ⅰ', 'Ⅶm7-5 ⅠM7'].map((b) => resolves(b).length), [1, 1, 1]);
    t.eq('解決: Ⅳ → Ⅰ（変格終止の形）= プラガル終止（160）が、その着地を評価する。重ねて加点しない', [kinds(analyze(board('Ⅳ Ⅰ'), table)), resolves('Ⅳ Ⅰ')], [['plagal_cadence'], []]);
    t.eq('解決: 名前のついた技（終止・固有進行）が、その駒へのつながりを取っているときは、重ねて加点しない（Ⅴ7 → Ⅰ・Ⅴ7 → Ⅵm7・王道）', ['- - Ⅴ7 Ⅰ', '- - Ⅴ7 Ⅵm7', 'ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7'].map((b) => resolves(b).length), [0, 0, 0]);
    t.eq('解決: Ⅰ7・Ⅵ7（セカンダリードミナント）・Ⅵ（長三和音）・Ⅳ で終わっても、解決ではない', ['Ⅳ Ⅰ7', 'Ⅱm7 Ⅵ7', 'Ⅱm7 Ⅵ', 'Ⅰ Ⅳ'].map((b) => resolves(b).length), [0, 0, 0, 0]);
    t.eq('解決: 同じルートの、響きの変化（Ⅵm → Ⅵm7・Ⅰ → ⅠM7）そのものは、解決ではない。Ⅰ のあとに ⅠM7 が続いて終わるときは、Ⅰ への着地が、1回だけ解決（2026-11-24。トニックの引きのばし）', ['Ⅱm7 Ⅵm Ⅵm7', 'Ⅱm7 Ⅰ ⅠM7'].map((b) => resolves(b).length), [0, 1]);
    t.eq('解決: フレーズの終わり = 4番・8番。途中（2番）の Ⅰ は、解決ではない。4番の Ⅰ は、駒が続いていても、解決', [resolves('Ⅳ Ⅰ Ⅵm Ⅱm').length, resolves('Ⅱm7 Ⅳ Ⅲm7 Ⅰ Ⅳ').length, resolves('Ⅱm7 Ⅳ Ⅲm7 Ⅳ Ⅱm7 Ⅳ Ⅲm7 Ⅰ').length], [0, 1, 1]);
    t.eq('解決: そのあとに駒がなければ（休みが続く）、4番でなくても、解決', [resolves('Ⅱm7 Ⅰ - Ⅳ').length, resolves('Ⅱm7 Ⅳ Ⅱm7 - Ⅱm7 Ⅰ').length], [1, 1]);
    t.eq('解決: 「→」でのばしても、同じ（Ⅱm7 → Ⅰ → →）', resolves('Ⅱm7 Ⅰ →').length, 1);
    t.eq('解決: 盤に、最大2回（休みで区切った3つの進行が、どれも Ⅰ で終わっても、+60 は2回まで）', resolves('Ⅱm7 Ⅰ - Ⅱm7 Ⅰ - Ⅱm7 Ⅰ').length, 2);
    t.eq('解決: 1番の Ⅴ（？）からのつながりは、数えない', resolves('Ⅴ Ⅰ').length, 0);
    t.eq('解決の講評: 名前・理由（フレーズの終わり・解決）・位置（2つの駒）・加点', (() => { const c = analyze(board('Ⅱm7 ⅠM7'), table).critiques.find((x) => x.id.startsWith('resolve|')); return [c.name, c.kind, c.points, c.positions, /フレーズの終わり/.test(c.reason) && /解決/.test(c.reason)]; })(), ['解決', 'good', 60, [0, 1], true]);
    t.eq('解決は、小節頭の Ⅴ・ひとつだけの駒（つながりなし）には付かない', [resolves('Ⅰ').length, resolves('- - - Ⅰ').length], [0, 0]);

    // ---- ピカルディ終止 ----
    t.eq('ピカルディ終止の説明: Ⅵm で終わるところを Ⅵ（長三和音）で終える。Ⅳm7 → Ⅰ ではない', [/Ⅵm/.test(TRICKS.picardy.explain), /長三和音/.test(TRICKS.picardy.explain), /Ⅳm7/.test(TRICKS.picardy.explain)], [true, true, false]);
    t.eq('Ⅵ（長三和音）→ Ⅱm は、セカンダリードミナント（A → Dm。Ⅵ は Ⅱm のドミナント）', kinds(analyze(board('- Ⅵ Ⅱm'), table)), ['dominant_motion|セカンダリードミナント']);

    // ---- ヒント: 進行の頭（1番・5番）には、セカンダリードミナント・借用和音（サブドミナントマイナー）を勧めない ----
    const names = (hh) => [...hh.primary, ...hh.advanced].map((c) => c.name);
    const BAD_HEAD = ['Ⅰ7', 'Ⅲ7', 'Ⅱ7', 'Ⅵ7', 'Ⅱ♭7', 'Ⅶ♭7', 'Ⅳm7', 'Ⅳm6', 'Ⅴm7', 'Ⅱ♭M7', 'Ⅵ♭M7', 'Ⅲ♭M7', 'Ⅲ♭m6', 'Ⅳ#m7-5', 'Ⅴ#dim7', 'Ⅵ', 'Ⅵsus4', 'Ⅴ', 'Ⅴ7', 'Ⅴsus47'];
    h = suggest(board(''), table, ALL);
    t.ok(`ヒント: 盤が空のとき、おすすめ・発展に、セカンダリードミナント・借用和音・Ⅴ は、出ない（出た駒: ${names(h).join(' ')}）`, h.cursor === 0 && names(h).length >= 3 && names(h).every((n) => !BAD_HEAD.includes(n)));
    t.ok('ヒント: 盤が空のとき、1番のおすすめは、Ⅰ系・Ⅳ系・Ⅵm系・Ⅱm7 のどれか', h.primary.length >= 3 && h.primary.every((c) => ['Ⅰ', 'ⅠM7', 'Ⅳ', 'ⅣM7', 'Ⅵm', 'Ⅵm7', 'Ⅱm', 'Ⅱm7', 'Ⅲm', 'Ⅲm7'].includes(c.name)));
    t.ok('ヒント: ラグタイム（Ⅲ7 から）・バックドア（Ⅳm7 から）・ブルース（Ⅰ7 から）の「最初の駒」は、勧めない', !names(h).some((n) => ['Ⅲ7', 'Ⅳm7', 'Ⅰ7'].includes(n)));
    // 5番は、進行の頭ではない（2026-11-18）: Ⅴ・セカンダリードミナントも、ふつうに勧められる（例: 4番が Ⅱm7 なら、5番に Ⅴ7 = ツーファイブ）
    h = suggest(board('Ⅰ Ⅳ Ⅴ Ⅱm7'), table, ALL);
    t.ok(`ヒント: 4番が Ⅱm7 のとき、5番に Ⅴ7（ツーファイブ）が出る（出た駒: ${names(h).join(' ')}）`, h.cursor === 4 && [...h.primary, ...h.advanced].some((c) => c.name === 'Ⅴ7' || c.name === 'Ⅴ'));
    h = suggest(board('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7'), table, ALL);
    t.ok(`ヒント: 王道のあとの 5番にも、冒頭の決まり（ドミナント・借用和音を勧めない）は、かからない（Ⅴ も出てよい）。出た駒: ${names(h).join(' ')}`, h.cursor === 4 && names(h).length >= 3);
    h = suggest(board('Ⅰ Ⅳ'), table, ALL);
    t.ok('ヒント: 頭でない場所（3番）では、これまでどおり、Ⅴ・セカンダリードミナントも出る', names(h).some((n) => ['Ⅴ', 'Ⅴ7'].includes(n)));
    h = suggest(board('Ⅰ Ⅳ Ⅴ7 Ⅰ Ⅵm'), table, ALL);
    t.ok('ヒント: 6番（頭でない）は、Ⅲ7・Ⅰ7 なども出てよい（セカンダリードミナントを勧めない決まりは、1番だけ）', h.cursor === 5);

    // ---- ヒント: フレーズの終わりを Ⅰ系・Ⅵm系で終える「解決」----
    h = suggest(board('Ⅰ Ⅳ Ⅱm7'), table, ALL);
    t.ok('ヒント: 4番（フレーズの終わり）で、Ⅰ系を置くと「解決」の加点（理由に出る）', h.cursor === 3 && [...h.primary, ...h.advanced].some((c) => /^Ⅰ/.test(c.name) && /解決/.test(c.reason)));
    h = suggest(board('Ⅰ Ⅳ'), table, ALL);
    t.ok('ヒント: 3番（フレーズの終わりではない）には、「解決」の理由は出ない', ![...h.primary, ...h.advanced].some((c) => /「解決」/.test(c.reason)));
    h = suggest(board('Ⅳ Ⅴ7 Ⅲm7'), table, ALL);
    t.ok('ヒント: 王道（Ⅳ・Ⅴ7・Ⅲm7）の4番は、Ⅵm 系が、おすすめ（王道進行が決まる。そのあとの Ⅰ は勧めない）', h.primary.some((c) => /^Ⅵm/.test(c.name) && /王道/.test(c.reason)));

    // ---- ヒント: ピカルディ終止（Ⅵsus4 → Ⅵ）----
    h = suggest(board('ⅣM7 Ⅴ7 Ⅵsus4'), table, ALL);
    t.ok('ヒント: ⅣM7 → Ⅴ7 → Ⅵsus4 のあと、Ⅵ で「ピカルディ終止」が決まる', h.cursor === 3 && h.primary.some((c) => c.name === 'Ⅵ' && /ピカルディ終止/.test(c.reason)));
    h = suggest(board('ⅣM7 Ⅴ7'), table, ALL);
    t.ok('ヒント: ⅣM7 → Ⅴ7 の3番では、ピカルディ終止（Ⅴ7 → Ⅵ）を、おすすめにしない（4番・8番でだけ出す）', h.cursor === 2 && !h.primary.some((c) => c.name === 'Ⅵ' && /ピカルディ/.test(c.reason)));
    h = suggest(board('Ⅰ Ⅳ Ⅵm7'), table, ALL);
    t.ok('ヒント: 4番（フレーズの終わり）で、Ⅵm7 → Ⅵ のピカルディ終止も出る。ただし、「おすすめ」ではなく「発展」', h.cursor === 3 && h.advanced.some((c) => c.name === 'Ⅵ' && /ピカルディ/.test(c.reason)) && !h.primary.some((c) => c.name === 'Ⅵ'));
    h = suggest(board('Ⅰ Ⅲ7'), table, ALL);
    t.ok('ヒント: Ⅲ7 のあとの Ⅵ（長三和音。イ短調の Ⅴ7 → 主和音）は、3番でも、ピカルディ終止として（発展に）出る', h.cursor === 2 && h.advanced.some((c) => c.name === 'Ⅵ' && /ピカルディ/.test(c.reason)));
  }
  // ============ 19. ループのつなぎ目（8番 → 1番）の、進行系の技（2026-11-18）============
  {
    const seam = (spec) => { const x = analyze(board(spec), table); return { x, k: kinds(x), seamIns: x.instances.filter((i) => i.seam) }; };
    let q = seam('Ⅳ - - - - - - Ⅰ');
    t.eq('つなぎ目: 8番 Ⅰ → 1番 Ⅳ は、強進行（C → F）。100点。囲みは 8番と 1番', [q.k, q.seamIns[0].points, q.seamIns[0].positions, q.seamIns[0].chords], [['dominant_motion|強進行'], 100, [7, 0], ['Ⅰ', 'Ⅳ']]);
    q = seam('Ⅰ - - - - - - Ⅳ');
    t.eq('つなぎ目: 8番 Ⅳ → 1番 Ⅰ は、弱進行（F → C）。60点', [q.k, q.seamIns[0].points], [['weak_motion'], 60]);
    q = seam('Ⅲm7 - - - - - - ⅣM7');
    t.eq('つなぎ目: 8番 ⅣM7 → 1番 Ⅲm7 は、半音下への進行。80点', [q.k, q.seamIns[0].points], [['half_step_down'], 80]);
    q = seam('Ⅰ - - - - - - Ⅱ♭7');
    t.eq('つなぎ目: 8番 Ⅱ♭7 → 1番 Ⅰ は、裏コード。250点', [q.k, q.seamIns[0].points], [['half_step_down|裏コード'], 250]);
    q = seam('Ⅵm - - - - - - Ⅲ7');
    t.eq('つなぎ目: 8番 Ⅲ7 → 1番 Ⅵm は、セカンダリードミナント。150点', [q.k, q.seamIns[0].points], [['dominant_motion|セカンダリードミナント'], 150]);
    q = seam('ⅠM7 - - - - - Ⅱm7 Ⅴ7');
    t.eq('つなぎ目: 7番 Ⅱm7 → 8番 Ⅴ7 → 1番 ⅠM7 は、ツーファイブワン（400）。つなぎ目をまたぐ。1本の強進行（Ⅱm7 → Ⅴ7）は、置きかわる', [q.k, q.seamIns[0].points, q.seamIns[0].positions], [['dominant_motion|ツーファイブワン'], 400, [6, 7, 0]]);
    q = seam('ⅠM7 Ⅵm7 Ⅳ Ⅰ Ⅱm7 Ⅳ Ⅱ♭7 ⅠM7');
    t.eq('つなぎ目: 8番 ⅠM7 → 1番 ⅠM7（同じルート）は、技にならない', q.seamIns.length, 0);
    t.eq('つなぎ目: 1番か8番が空きなら、つながらない', ['Ⅳ - - - - - - -', '- - - - - - - Ⅰ', 'Ⅳ Ⅱm - - - - Ⅰ -', '- Ⅳ - - - - - Ⅰ'].map((b) => seam(b).seamIns.length), [0, 0, 0, 0]);
    t.eq('つなぎ目をまたぐのは、進行系の技だけ（終止・固有進行は、またがない）: 7番 Ⅴ7・8番 Ⅰ・1番 Ⅵm でも、Ⅰ → Ⅵm（偽終止）は決まらない', (() => { const x = analyze(board('Ⅵm - - - - - Ⅴ7 Ⅰ'), table); return [x.instances.filter((i) => i.seam).length, kinds(x).includes('deceptive_cadence')]; })(), [0, false]);
    q = seam('Ⅳ - - - - - - Ⅰ');
    t.eq('つなぎ目の技: 理由に「ループ」。単独の技（コンボなし）で、点数に入る', [/ループ/.test(q.seamIns[0].reason), q.seamIns[0].comboMult, q.seamIns[0].endFirst, q.x.score.base], [true, 1, 0, 100]);
    t.eq('つなぎ目の技は、囲みの目印（instanceKey）が、ふつうの技と重ならない', new Set(analyze(board('Ⅳ Ⅱm - - - - Ⅱm7 Ⅴ7'), table).instances.map((i) => `${i.id}|${i.startPos}|${i.endPos}|${i.variant || ''}`)).size, analyze(board('Ⅳ Ⅱm - - - - Ⅱm7 Ⅴ7'), table).instances.length);
    t.eq('つなぎ目: 1番の駒が「？」（冒頭のドミナント）のときは、つなげない', seam('Ⅲ7 - - - - - - Ⅱm7').seamIns.length, 0);
    t.eq('つなぎ目: 休みで区切られた8番の駒と1番の駒でも、つながる（Ⅳ Ⅱm - - - - Ⅱm7 Ⅴ7 なら、Ⅴ7 → Ⅳ は技にならないが、Ⅱm7 → Ⅴ7 は強進行として残る）', kinds(analyze(board('Ⅳ Ⅱm - - - - Ⅱm7 Ⅴ7'), table)), ['dominant_motion|強進行']);
    h = suggest(board('Ⅰ Ⅳ Ⅴ Ⅵm Ⅱm Ⅳ Ⅱm7'), table, ALL);
    t.ok('ヒント: 8番に Ⅴ7 を置くと、つなぎ目をまたぐ「ツーファイブワン」が決まる（理由に出る）', h.cursor === 7 && [...h.primary, ...h.advanced].some((c) => c.name === 'Ⅴ7' && /ツーファイブワン/.test(c.reason)));
  }
  // ============ 20. 自動でメロディをつける（core/automelody.js。2026-11-18）============
  {
    const stageBoards = MELODY_STAGES.map((m) => m.answer.map((n) => table.byName(n).id));
    const rnd = AM.mulberry32(777);
    const randBoards = Array.from({ length: 40 }, () => Array.from({ length: 8 }, () => { const r = rnd(); return r < 0.08 ? null : r < 0.16 ? table.repeatId : ALL[Math.floor(rnd() * ALL.length)]; }));
    const boards = [...stageBoards, board('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 ⅣM7 Ⅴ7 Ⅰ →'), board('Ⅵm Ⅳ Ⅴ Ⅰ Ⅵm Ⅳ Ⅴ Ⅰ'), board('Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7 →'), board('Ⅰ Ⅱ♭7 Ⅰ Ⅶ♭7 Ⅳm7 Ⅰ Ⅴ#dim7 Ⅵm'), board('Ⅰ Ⅴsus47 Ⅴ7 Ⅰ Ⅵsus4 Ⅵ Ⅱ♭M7 Ⅰ'), ...randBoards];
    let violations = [], lowMatch = 0, runs = 0, matchSum = 0, outOfRange = 0, bad9 = 0, noEnd = 0, fails = 0;
    for (const b of boards) {
      if (!b.some((x) => x !== null && x !== table.repeatId)) continue;
      for (const style of AM.STYLE_IDS) for (const tension of [true, false]) {
        const r = AM.generateMelody(b, table, { seed: 500 + runs, style, tension });
        runs++;
        if (!r.ok) { fails++; continue; }
        const v = AM.checkRules(r.notes, b, table, { tension });
        if (v.length) violations.push(`${style}: ${v[0]}`);
        if (r.report.match < 0.85) lowMatch++;
        matchSum += r.report.match;
        if (r.notes.some((n) => n[2] < AM.AUTO.lo - 1 || n[2] > AM.AUTO.hi + 1)) outOfRange++;
        if (!tension && r.report.nines) bad9++;
        if (!r.report.endsWell && AM.stepInfo(b, table)[7].chord) noEnd++;
      }
    }
    t.ok(`自動メロディ: ${runs} 通り（盤 × 作風 × 9th の有無）が、すべて作れる（失敗 ${fails}）`, runs >= 250 && fails === 0);
    t.eq('自動メロディ: 決まりを守っている（強い拍・長い音は、コードの音か 9th だけ・和音のない所に音なし・音が重ならない・跳躍が大きすぎない）。違反の数', violations.slice(0, 3), []);
    t.eq('自動メロディ: 音域（G4〜F6）の外に出ない', outOfRange, 0);
    t.eq('自動メロディ: 9th を使わない設定のとき、9th は 0', bad9, 0);
    t.ok(`自動メロディ: 和音との相性は、すべて 85% 以上・平均は 95% 以上（低いもの ${lowMatch} 個・平均 ${(matchSum / runs).toFixed(3)}）`, lowMatch === 0 && matchSum / runs >= 0.95);
    t.ok(`自動メロディ: 8番に和音があるとき、最後の音は、コードの音で、4マス（4分音符）以上のばす（そうでないもの ${noEnd} 個）`, noEnd <= Math.ceil(runs * 0.02));
    // 決定性・多様性
    const b0 = board('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 ⅣM7 Ⅴ7 Ⅰ →');
    const g1 = AM.generateMelody(b0, table, { seed: 42, style: 'lyrical' }), g2 = AM.generateMelody(b0, table, { seed: 42, style: 'lyrical' });
    t.eq('自動メロディ: 同じ種（seed）・同じ作風なら、いつも同じメロディ', JSON.stringify(g1.notes), JSON.stringify(g2.notes));
    const distinct = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(AM.generateMelody(b0, table, { seed: 100 + i }).notes.map((n) => n.slice(0, 3))))).size;
    t.ok(`自動メロディ: 種がちがえば、ちがうメロディ（12 通りのうち ${distinct} 通りが別のもの）`, distinct >= 10);
    // ---- 分割したマス（前半・後半の2つの和音）。メロディ関係の画面でも、後半を見る（2026-11-24）----
    {
      const b2 = board('Ⅱm7 Ⅴ7 ⅠM7 Ⅵm7');
      const sp = Array(8).fill(null); sp[1] = table.byName('Ⅲ7').id;               // 2番: 前半 Ⅴ7・後半 Ⅲ7
      const mel = { notes: [[8, 4, 67, 'ソ'], [12, 4, 68, 'ソ♯']] };                  // 2番の前半に ソ（Ⅴ7 のルート）・後半に ソ♯（Ⅲ7 の3度）
      const withSplit = MEL.judgeMelody(b2, mel, table, sp), without = MEL.judgeMelody(b2, mel, table);
      t.eq('分割 × メロディ: 前半の ソ は Ⅴ7 のコードの音・後半の ソ♯ は Ⅲ7 のコードの音（どちらも ○ 以上）。分割していなければ、ソ♯ は Ⅴ7 の ♭9th（テンション）にしか聞こえない', [withSplit.steps[1].items.map((x) => x.kind), without.steps[1].items.map((x) => x.kind)], [['chord', 'chord'], ['chord', 'tension']]);
      t.eq('分割 × メロディ: 分割したマスの結果に、後半の和音の名前・前半と後半の記号（halves）が付く', [withSplit.steps[1].chord, withSplit.steps[1].chord2, withSplit.steps[1].halves.map((h) => h.chord), withSplit.steps[1].halves.map((h) => h.verdict)], ['Ⅴ7', 'Ⅲ7', ['Ⅴ7', 'Ⅲ7'], ['perfect', 'perfect']]);
      t.eq('分割 × メロディ: 分割していないマスの結果には、chord2・halves がない', [withSplit.steps[0].chord2 === undefined, without.steps[1].halves === undefined], [true, true]);
      const cross = MEL.judgeMelody(b2, { notes: [[10, 6, 64, 'ミ']] }, table, sp);                   // 2拍目の頭（12マス目）をまたぐ長い音: 前半・後半に分けて、それぞれの和音で聞く
      t.eq('分割 × メロディ: 2拍目の頭をまたぐ音は、前半（Ⅴ7 に対して ミ = 13th 〔テンション〕）・後半（Ⅲ7 のルート ミ = コードの音）の2つに分かれる', [cross.steps[1].items.length, cross.steps[1].items.map((x) => x.half), cross.steps[1].items.map((x) => x.kind)], [2, [0, 1], ['tension', 'chord']]);
      t.eq('分割 × メロディ: 音の呼び名（ド・レ・ミ）は、後半の音には、後半の和音の書き方で（ソ♯ = Ⅲ7 の G#）', AM.spellNotes([[8, 4, 67], [12, 4, 68]], b2, table, sp).map((x) => x[3]), ['ソ', 'ソ♯']);
      // 自動でつけたメロディ: 分割したマスがあっても、決まりを守る（前半の強い拍・長い音は前半の和音の音、後半は後半の和音の音）
      let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      let bad = 0, runs = 0, splitsMade = 0;
      for (let n = 0; n < 150; n++) {
        const bd = Array(8).fill(null), spl = Array(8).fill(null);
        for (let i = 0; i < 8; i++) { if (rnd() < 0.15) continue; bd[i] = ALL[Math.floor(rnd() * ALL.length)]; if (rnd() < 0.4) { const c2 = ALL[Math.floor(rnd() * ALL.length)]; if (c2 !== bd[i]) { spl[i] = c2; splitsMade++; } } }
        if (!bd.some((x) => x !== null)) continue;
        for (const style of ['lyrical', 'groove', 'simple']) {
          const tension = rnd() < 0.5;
          const r = AM.generateMelody(bd, table, { seed: 700 + n, style, tension, split: spl });
          runs++;
          if (!r.ok || AM.checkRules(r.notes, bd, table, { tension, split: spl }).length) bad++;
        }
      }
      t.eq(`自動メロディ（分割したマスあり）: 無作為な盤 ${runs} 通り（分割 ${splitsMade} か所）で、決まりの違反が 0（前半・後半のそれぞれの和音で、強い拍・長い音は、コードの音か 9th）`, bad, 0);
      t.ok('自動メロディ（分割したマスあり）: 後半の和音の音が、後半に使われる（分割した盤では、ふつうの盤と、音がちがう）', JSON.stringify(AM.generateMelody(b2, table, { seed: 5, split: sp }).notes) !== JSON.stringify(AM.generateMelody(b2, table, { seed: 5 }).notes));
    }
    t.eq('自動メロディ: 和音が1つもない盤は、nochord（音なし）', (() => { const r = AM.generateMelody(board('- - - - - - - -'), table, { seed: 1 }); return [r.ok, r.reason, r.notes.length]; })(), [false, 'nochord', 0]);
    t.eq('自動メロディ: 「→」だけの盤（前の和音がない）も、nochord', AM.generateMelody(board('→ → - - - - - -'), table, { seed: 1 }).reason, 'nochord');
    t.ok('自動メロディ: 和音が1つだけでも作れる（その和音のステップにだけ、音がつく）', (() => { const b = board('- - Ⅳ - - - - -'); const r = AM.generateMelody(b, table, { seed: 3 }); return r.ok && r.notes.every((n) => n[0] >= 16 && n[0] + n[1] <= 24); })());
    t.ok('自動メロディ: 空きのステップには、音を置かない（空き → 休み）', (() => { const b = board('Ⅰ - Ⅳ - Ⅴ - Ⅰ -'); const r = AM.generateMelody(b, table, { seed: 8 }); return r.ok && r.notes.every((n) => [0, 2, 4, 6].includes(Math.floor(n[0] / 8))); })());
    // 作風の差
    const avgNotes = (style) => boards.slice(0, 30).reduce((a, b) => a + AM.generateMelody(b, table, { seed: 9, style }).notes.length, 0) / 30;
    const aSimple = avgNotes('simple'), aLyr = avgNotes('lyrical'), aGroove = avgNotes('groove');
    t.ok(`自動メロディ: 作風 — やさしい（${aSimple.toFixed(1)}音）< リズミカル（${aGroove.toFixed(1)}音）。なめらか（${aLyr.toFixed(1)}音）は、その間か同じくらい`, aSimple < aGroove && aLyr >= aSimple - 0.5);
    // 9th の判定
    t.eq('9th が使える和音: 音階の中の 9th（Ⅰ・ⅣM7・Ⅱm7・Ⅵm7・Ⅳm7・Ⅴsus47）・ドミナント7th（Ⅲ7・Ⅴ7・Ⅶ♭7）', ['Ⅰ', 'ⅣM7', 'Ⅱm7', 'Ⅵm7', 'Ⅳm7', 'Ⅴsus47', 'Ⅲ7', 'Ⅴ7', 'Ⅶ♭7'].map((n) => AM.nineOk(table.byName(n))), Array(9).fill(true));
    t.eq('9th が使えない和音: 音階の外の 9th（Ⅲm7 の ファ♯・Ⅶm7-5 の ド♯）・ルートが外の和音（Ⅱ♭M7・Ⅱ♭7・Ⅵ♭M7）・dim7', ['Ⅲm7', 'Ⅶm7-5', 'Ⅱ♭M7', 'Ⅱ♭7', 'Ⅵ♭M7', 'Ⅴ#dim7', 'Ⅳ#m7-5'].map((n) => AM.nineOk(table.byName(n))), Array(7).fill(false));
    // 決まりの検査が、ちゃんと違反を見つける
    t.ok('検査: 強い拍のアヴォイド（Ⅰ の上の ファ）・13th（Ⅰ の上の ラ）は、違反', AM.checkRules([[0, 4, 77, 'ファ']], board('Ⅰ'), table).length === 1 && AM.checkRules([[0, 4, 81, 'ラ']], board('Ⅰ'), table).length === 1);
    t.eq('検査: 短くて弱い拍の ファ（経過音）は、違反ではない・コードの音・9th も違反ではない', [AM.checkRules([[2, 2, 77, 'ファ']], board('Ⅰ'), table), AM.checkRules([[0, 4, 76, 'ミ'], [4, 4, 74, 'レ']], board('Ⅰ'), table)], [[], []]);
    t.ok('検査: 短くて弱い拍の音でも、9th より上のテンション（Ⅰ の上の ラ = 13th）は違反。9th は、違反ではない', AM.checkRules([[2, 2, 81, 'ラ']], board('Ⅰ'), table).length === 1 && AM.checkRules([[2, 2, 74, 'レ']], board('Ⅰ'), table).length === 0);
    t.ok('検査: 9th なしの設定のとき、9th は違反', AM.checkRules([[0, 4, 74, 'レ']], board('Ⅰ'), table, { tension: false }).length === 1);
    t.ok('検査: 和音のないステップの音・音域の外・重なりは、違反', AM.checkRules([[8, 4, 76, 'ミ']], board('Ⅰ'), table).length >= 1 && AM.checkRules([[0, 4, 100, 'x']], board('Ⅰ'), table).length >= 1 && AM.checkRules([[0, 4, 76, 'ミ'], [2, 4, 79, 'ソ']], board('Ⅰ'), table).length >= 1);
    // 音の呼び名（和音の書き方にそろえる）
    const sp = (midi, name) => AM.spellNotes([[0, 8, midi]], board(name), table)[0][3];
    t.eq('音の呼び名: Ⅰ7 の 7th は シ♭・Ⅲ7 の 3度は ソ♯・Ⅳm7 の 3度は ラ♭・Ⅱ7 の 3度は ファ♯・Ⅴ#dim7 のルートは ソ♯・Ⅱ♭7 のルートは レ♭', [sp(70, 'Ⅰ7'), sp(68, 'Ⅲ7'), sp(68, 'Ⅳm7'), sp(78, 'Ⅱ7'), sp(68, 'Ⅴ#dim7'), sp(73, 'Ⅱ♭7')], ['シ♭', 'ソ♯', 'ラ♭', 'ファ♯', 'ソ♯', 'レ♭']);
    t.eq('音の呼び名: ふつうの音（ミ・ソ・ド）はそのまま。和音のない所は、♯ で書く', [sp(76, 'Ⅰ'), sp(79, 'Ⅰ'), sp(72, 'Ⅰ'), AM.spellNotes([[0, 8, 70]], board('- - -'), table)[0][3]], ['ミ', 'ソ', 'ド', 'ラ♯']);
    t.ok('自動メロディの音には、呼び名がついている（4つ目）', g1.notes.every((n) => typeof n[3] === 'string' && n[3].length >= 1));
    // judgeMelody（既存の採点）と、そのまま組み合わせられる
    const jm = MEL.judgeMelody(b0, { notes: g1.notes }, table);
    t.ok('採点との組み合わせ: 自動メロディを、既存の judgeMelody で採点できる（ぶつかる・不安定の音は 0）', jm.counts.avoid === 0 && jm.counts.unstable === 0 && jm.match > 0.9);
  }
  // ============ 21. ユーザーのメロディ（編集の道具・元に戻す。game/usermelody.js）============
  {
    t.eq('音域の定数: C3（48）〜C7（96）', [NOTE_LO, NOTE_HI, MAX_NOTES], [48, 96, 160]);
    const dirty = [null, 'x', [1], [0, 2], [0.5, 2, 70], [0, 0, 70], [-1, 2, 70], [64, 2, 70], [0, 2, 47], [0, 2, 97], [4, 4, 70], [0, 100, 72], [4, 2, 70]];
    t.eq('検査（sanitizeNotes）: 壊れた音は捨てる。長さは、1周（64マス）の中に収める。同じ高さで重なる音は、前の音を短くする', sanitizeNotes(dirty), [[0, 64, 72], [4, 2, 70]]);
    t.eq('検査: 配列でなければ、空・上限（160音）をこえない', [sanitizeNotes(undefined), sanitizeNotes('x'), sanitizeNotes(Array.from({ length: 300 }, (_, i) => [i % 64, 1, 48 + (i % 40)])).length <= 160], [[], [], true]);
    t.eq('検査: 開始・高さの順に並ぶ。同じ開始・同じ高さの重なりは、1つになる', sanitizeNotes([[8, 2, 72], [0, 2, 76], [0, 2, 70], [8, 2, 72]]), [[0, 2, 70], [0, 2, 76], [8, 2, 72]]);
    const d = new MelodyDoc();
    let events = 0; d.subscribe(() => events++);
    const id1 = d.add(0, 4, 72), id2 = d.add(8, 2, 76);
    t.eq('追加: 開始・高さの順の一覧（id は、編集しても変わらない目印）', [d.notes(), d.count, id1 !== id2, events], [[[0, 4, 72], [8, 2, 76]], 2, true, 2]);
    t.eq('追加: はみ出しは、おさまるように直す（開始 62・長さ 9・高さ 200 → 62・2・96）。範囲の外の開始（-5）は 0', (() => { const x = new MelodyDoc(); x.add(62, 9, 200); x.add(-5, 1, 10); return x.notes(); })(), [[0, 1, 48], [62, 2, 96]]);
    t.eq('変える（set）: 開始・長さ・高さ。変わらなければ false（記録しない）', [d.set(id2, { s: 10, l: 3, m: 77 }), d.item(id2), d.set(id2, { s: 10 }), d.canUndo], [true, { id: id2, s: 10, l: 3, m: 77 }, false, true]);
    t.eq('動かす（move）: 相対で。はみ出しは、おさまる', [d.move(id1, 2, -1), d.item(id1).s, d.item(id1).m, d.move(id1, -100, 0), d.item(id1).s], [true, 2, 71, true, 0]);
    d.clear(); d.add(0, 8, 72);
    d.add(4, 8, 72);
    t.eq('同じ高さで重なる音: あとから置いた音を優先（前の音が短くなる）', d.notes(), [[0, 4, 72], [4, 8, 72]]);
    d.add(2, 12, 72);
    t.eq('同じ高さで重なる音: 新しい音が前の2つをおおうなら、おおわれた音は消える・またがる音は削れる', d.notes(), [[0, 2, 72], [2, 12, 72]]);
    d.clear();
    t.eq('違う高さなら、重ねられる（和音のように）', (() => { d.add(0, 8, 72); d.add(0, 8, 76); d.add(0, 8, 79); return d.count; })(), 3);
    // 元に戻す・やり直す
    const e = new MelodyDoc();
    e.add(0, 2, 72); e.add(4, 2, 74); e.add(8, 2, 76);
    t.eq('元に戻す: 操作ごとに1回ずつ戻る', (() => { const r = []; e.undo(); r.push(e.count); e.undo(); r.push(e.count); e.undo(); r.push(e.count); r.push(e.undo()); return r; })(), [2, 1, 0, false]);
    t.eq('やり直す: 戻した順に進む・新しい操作をすると、やり直しは消える', (() => { const r = []; e.redo(); r.push(e.count); e.redo(); r.push(e.count); e.add(20, 2, 70); r.push(e.canRedo); return r; })(), [1, 2, false]);
    const f = new MelodyDoc([[0, 4, 72]]);
    const fid = f.items[0].id;
    f.beginEdit(); f.set(fid, { s: 2 }); f.set(fid, { s: 4 }); f.set(fid, { s: 6, m: 74 }); f.commitEdit();
    t.eq('ドラッグのような連続した操作は、まとめて1回の「元に戻す」（beginEdit → commitEdit）', [f.notes(), f.undo(), f.notes(), f.canUndo], [[[6, 4, 74]], true, [[0, 4, 72]], false]);
    const g = new MelodyDoc([[0, 4, 72]]);
    g.beginEdit(); g.commitEdit();
    t.eq('何も変えなかった操作は、記録しない', g.canUndo, false);
    const h2 = new MelodyDoc();
    h2.replaceAll([[0, 4, 72], [8, 4, 74]]); h2.replaceAll([[0, 8, 70]]);
    t.eq('入れかえ（自動でつけたメロディ・プリセット）: 1回で戻せる', [h2.notes(), h2.undo(), h2.notes()], [[[0, 8, 70]], true, [[0, 4, 72], [8, 4, 74]]]);
    t.eq('消す（remove）・全部消す（clear）: 戻せる。ない id は false', (() => { const x = new MelodyDoc([[0, 2, 72], [4, 2, 74]]); const i = x.items[1].id; const r = [x.remove(i), x.remove(9999), x.count, x.clear(), x.count, x.clear()]; x.undo(); r.push(x.count); return r; })(), [true, false, 1, true, 0, false, 1]);
    t.eq('保存の形: 音の一覧は [開始, 長さ, 高さ] の配列。読み込み直すと、同じ', (() => { const x = new MelodyDoc([[8, 2, 76], [0, 4, 72]]); const y = new MelodyDoc(JSON.parse(JSON.stringify(x.notes()))); return [x.notes(), JSON.stringify(x.notes()) === JSON.stringify(y.notes())]; })(), [[[0, 4, 72], [8, 2, 76]], true]);
  }
  // ============ 22. メロディつきのプリセット（コードと、メロディを、いっしょに保存・呼び出し）============
  {
    const b = board('Ⅳ Ⅴ7 Ⅲm7 Ⅵm7 - Ⅱm7 Ⅴ7 ⅠM7');
    const mel = [[0, 4, 76], [8, 8, 79], [30, 4, 72], [32, 4, 74], [40, 8, 77], [48, 8, 79], [56, 8, 76]];
    t.eq('メロディを切り出す（sliceMelody）: 範囲の左端からの位置に直す・範囲をまたぐ音は、切る', sliceMelody(mel, 0, 3), [[0, 4, 76], [8, 8, 79], [30, 2, 72]]);
    t.eq('メロディを切り出す: 5番〜7番（4〜6）。前の範囲から続く音（30〜34）は、後ろだけ（2マス）・範囲の外（56〜）は入らない', sliceMelody(mel, 4, 6), [[0, 2, 72], [0, 4, 74], [8, 8, 77], [16, 8, 79]]);
    t.eq('メロディを空ける（cutNotes）: またぐ音は切る', cutNotes([[0, 8, 70], [6, 8, 72], [20, 4, 74]], 4, 10), [[0, 4, 70], [10, 4, 72], [20, 4, 74]]);
    // 保存
    let r = makePreset({ name: 'メロつき', board: b, from: 0, to: 3, table, melody: mel });
    t.eq('保存: メロディが、プリセットに入る（範囲の左端からの位置）', [r.ok, r.preset.melody], [true, [[0, 4, 76], [8, 8, 79], [30, 2, 72]]]);
    r = makePreset({ board: b, from: 4, to: 7, table, melody: mel });
    t.eq('保存: 前の空き（5番）を切り落とすと、メロディの位置も、切り落とした先頭（6番）からになる', [r.from, r.preset.chords, r.preset.melody], [5, ['Ⅱm7', 'Ⅴ7', 'ⅠM7'], [[0, 8, 77], [8, 8, 79], [16, 8, 76]]]);
    t.eq('保存: 範囲にメロディがなければ、melody のキー自体を持たない', 'melody' in makePreset({ board: b, from: 0, to: 3, table, melody: [[40, 4, 70]] }).preset, false);
    t.eq('保存: メロディを渡さなければ、これまでどおり（コードだけ）', 'melody' in makePreset({ board: b, from: 0, to: 3, table }).preset, false);
    const withMel = makePreset({ name: 'A', board: b, from: 0, to: 3, table, melody: mel }).preset;
    t.eq('保存: 同じコードでも、メロディがちがえば、別のプリセット（duplicate ではない）', makePreset({ name: 'B', board: b, from: 0, to: 3, table, melody: [[0, 4, 74]], existing: [withMel] }).ok, true);
    t.eq('保存: 同じコード・同じメロディは、duplicate', makePreset({ name: 'B', board: b, from: 0, to: 3, table, melody: mel, existing: [withMel] }).reason, 'duplicate');
    t.eq('保存: コードだけのプリセットがあるとき、メロディつきは、別のもの（保存できる）・メロディなしは、duplicate', [makePreset({ board: b, from: 0, to: 3, table, melody: mel, existing: [{ id: 'x', name: 'コードだけ', chords: ['Ⅳ', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'] }] }).ok, makePreset({ board: b, from: 0, to: 3, table, existing: [{ id: 'x', name: 'コードだけ', chords: ['Ⅳ', 'Ⅴ7', 'Ⅲm7', 'Ⅵm7'] }] }).reason], [true, 'duplicate']);
    // 置き方
    let plan = placementPlan(withMel, 2, table);
    t.eq('置き方: メロディは、置く場所のぶん（2番から = 16マス）ずれる・置きかわる範囲（16〜48マス）', [plan.start, plan.melody, plan.melodyFrom, plan.melodyTo], [2, [[16, 4, 76], [24, 8, 79], [46, 2, 72]], 16, 48]);
    plan = placementPlan({ chords: ['Ⅰ', 'Ⅳ'] }, 0, table);
    t.eq('置き方: メロディのないプリセットは、plan.melody が null（メロディをさわらない）', [plan.melody, applyMelodyPlan([[0, 4, 70]], plan)], [null, [[0, 4, 70]]]);
    plan = placementPlan(withMel, 7, table);
    t.eq('置き方: 8つの場所に収まらないときは、左へずれる（8番から → 5番から）。メロディも、いっしょにずれる（先頭の音は 32マス）', [plan.start, plan.melody[0][0]], [4, 32]);
    t.eq('呼び出し: その範囲（2番〜3番 = 8〜24マス）のメロディが置きかわる。範囲の外の音は、そのまま・範囲をまたぐ音は、範囲の中だけ消える',
      applyMelodyPlan([[0, 4, 72], [6, 6, 74], [20, 8, 70], [60, 4, 70]], placementPlan({ chords: ['Ⅰ', 'Ⅳ'], melody: [[0, 4, 76]] }, 1, table)),
      [[0, 4, 72], [6, 2, 74], [8, 4, 76], [24, 4, 70], [60, 4, 70]]);
    // 検査
    const dirty = [
      { chords: ['Ⅰ', 'Ⅳ'], name: 'ok', melody: [[0, 4, 72], [8, 4, 74]] },
      { chords: ['Ⅰ', 'Ⅳ'], name: 'はみ出し', melody: [[0, 4, 72], [12, 8, 74], [40, 4, 70]] },
      { chords: ['Ⅰ', 'Ⅳ'], name: '壊れ', melody: 'x' },
      { chords: [null, 'Ⅰ', 'Ⅳ'], name: '空き', melody: [[0, 4, 72], [8, 4, 74], [16, 4, 76]] },
      { chords: ['Ⅰ', 'Ⅳ'], name: '全部だめ', melody: [[0, 0, 72], 'x', [-1, 2, 70]] },
    ];
    const clean = sanitizePresets(dirty, table);
    t.eq('検査: メロディは、範囲（コードの数 × 8マス）に切る。壊れたもの・全部だめなものは、メロディなし（プリセットは残る）', clean.map((p) => [p.name, p.melody || null]), [['ok', [[0, 4, 72], [8, 4, 74]]], ['はみ出し', [[0, 4, 72], [12, 4, 74]]], ['壊れ', null], ['空き', [[0, 4, 74], [8, 4, 76]]], ['全部だめ', null]]);
    // 出し入れ
    const sv = { presets: [] };
    const store = new PresetStore(sv, table);
    const a1 = store.add({ name: 'うた', board: b, from: 0, to: 3, melody: mel });
    t.eq('出し入れ: メロディつきを追加 → 保存先にも入る・読み込み直しても、同じ', [a1.ok, sv.presets[0].melody.length, JSON.stringify(new PresetStore({ presets: JSON.parse(JSON.stringify(sv.presets)) }, table).list()[0].melody) === JSON.stringify(a1.preset.melody)], [true, 3, true]);
  }
  // ============ 23. 音量の保存（はじめは 25%）============
  {
    const KEY = 'chordlines.v1', keep = localStorage.getItem(KEY);
    const load = (obj) => { if (obj === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(obj)); return loadSave(); };
    t.eq('音量: はじめの値は 25%', DEFAULT_VOLUME, 25);
    t.eq('音量: 保存がまっさら → 25%・まだ「決めていない」', (() => { const x = load(null); return [x.volume, x.volumeSet]; })(), [25, false]);
    t.eq('音量: 以前の版が自動で書いた 100（volumeSet なし）は、はじめの値 25% にもどす', (() => { const x = load({ volume: 100 }); return [x.volume, x.volumeSet]; })(), [25, false]);
    t.eq('音量: バーで決めた値（volumeSet あり）は、そのまま（100 でも 0 でも 60 でも）', [100, 0, 60].map((v) => load({ volume: v, volumeSet: true }).volume), [100, 0, 60]);
    t.eq('音量: 範囲の外・変な値は、おさまる（150 → 100・-5 → 0・"x" → 25）', [load({ volume: 150, volumeSet: true }).volume, load({ volume: -5, volumeSet: true }).volume, load({ volume: 'x', volumeSet: true }).volume], [100, 0, 25]);
    if (keep === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, keep);
  }
  // ============ 24. ヒント: Ⅱm7 とセブンスコード（2026-11-23。ユーザーの指摘）============
  {
    const hint = (spec, opts) => suggest(board(spec), table, ALL, opts);
    const names = (h) => [...h.primary, ...h.advanced].map((c) => c.name);
    t.eq('セブンス優先: sevenBonus（Ⅰ系は 0 / Ⅳ♭M7 は 左にセブンスがあれば 4・なければ 0.5 / 解決先の Ⅵm7 は 0）', [
      sevenBonus(table.byName('Ⅰ'), { ctxSeventh: true }), sevenBonus(table.byName('ⅣM7'), { ctxSeventh: true }), sevenBonus(table.byName('Ⅱm7')),
      sevenBonus(table.byName('Ⅵm7'), { resolving: true, ctxSeventh: true }), sevenBonus(table.byName('Ⅵm7'), { ctxSeventh: true }), sevenBonus(table.byName('Ⅳ'), { ctxSeventh: true }),
    ], [0, 4, 0.5, 0, 4, 0]);
    t.eq('セブンス優先: 3和音とセブンスの組（Ⅴ-Ⅴ7・Ⅳ-ⅣM7・Ⅱm-Ⅱm7 は組。Ⅵ-Ⅵ7・Ⅱm-Ⅱ7 は、別の働きなので組にしない）', [['Ⅴ', 'Ⅴ7'], ['Ⅳ', 'ⅣM7'], ['Ⅱm', 'Ⅱm7'], ['Ⅵ', 'Ⅵ7'], ['Ⅱm', 'Ⅱ7']].map(([a, b]) => sameSevenFamily(table.byName(a), table.byName(b))), [true, true, true, false, false]);
    // Ⅱm7: フレーズの頭（1番・5番）では「おすすめ」に必ず入る（前がドミナントのときは、おすすめにしない）
    for (const spec of ['', 'ⅠM7 Ⅵm7 Ⅳ Ⅰ', 'ⅣM7 Ⅲm7 Ⅵm7 ⅠM7', 'Ⅳ Ⅴ Ⅲm Ⅵm', 'Ⅰ Ⅵm Ⅳ Ⅰ', 'ⅠM7 Ⅲm7 Ⅵm7 ⅣM7']) {
      const h = hint(spec);
      t.ok(`Ⅱm7 は、フレーズの頭（${h.cursor + 1}番。前: ${spec || 'なし'}）で、おすすめ`, [0, 4].includes(h.cursor) && h.primary.some((c) => c.name === 'Ⅱm7'));
    }
    t.ok('Ⅱm7: 前が Ⅴ7 のときの頭（5番）は、おすすめにしない（Ⅴ-Ⅰ・偽終止などの流れを先に）', !hint('ⅠM7 Ⅵm7 Ⅱm7 Ⅴ7').primary.some((c) => c.name === 'Ⅱm7'));
    t.ok('Ⅱm7: 頭でなくても、前がトニック系・サブドミナント系なら、候補に出る（ⅠM7 のあと・Ⅰ Ⅳ のあと）', names(hint('ⅠM7')).includes('Ⅱm7') && names(hint('Ⅰ Ⅳ')).includes('Ⅱm7'));
    // セブンス: 左にセブンスがあるとき、Ⅱ・Ⅲ・Ⅳ・Ⅴ の3和音（Ⅱm・Ⅲm・Ⅳ・Ⅴ）は、出さない（セブンスの版を出す）
    const plainTriadRoots = new Set([2, 4, 5, 7]);
    const triadsIn = (h) => [...h.primary, ...h.advanced].filter((c) => { const ch = table.byId(c.id); return (ch.type === 'maj' || ch.type === 'min') && plainTriadRoots.has(ch.rootPc); }).map((c) => c.name);
    for (const spec of ['ⅠM7 Ⅲm7 Ⅵm7', 'ⅣM7 Ⅲm7', 'Ⅱm7 Ⅴ7', 'ⅠM7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7', 'ⅣM7 Ⅴ7', 'Ⅰ Ⅵm7']) t.eq(`セブンス優先: 左にセブンスがあれば、3和音は出ない（${spec}）`, triadsIn(hint(spec)), []);
    t.ok('セブンス優先: 3和音ばかりの進行（Ⅰ Ⅵm Ⅳ）でも、Ⅴ は Ⅴ7 が出る（弱い優先）。4番の Ⅵm は、3和音のまま（トニックとして着地）', (() => { const h = hint('Ⅰ Ⅵm Ⅳ'); return h.primary.some((c) => c.name === 'Ⅴ7') && h.primary.some((c) => c.name === 'Ⅵm'); })());
    t.ok('セブンス優先: ピカルディ終止の Ⅵ（長三和音）は、Ⅵ7 に置きかえない（別の和音）', hint('ⅣM7 Ⅴ7 Ⅵsus4').primary.some((c) => c.name === 'Ⅵ'));
    // 数で確かめる（種つきの乱数。左の駒は、よく使う和音から）
    {
      let s = 4242; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const common = ['Ⅰ', 'ⅠM7', 'Ⅱm7', 'Ⅱm', 'Ⅲm7', 'Ⅲm', 'ⅣM7', 'Ⅳ', 'Ⅴ7', 'Ⅴ', 'Ⅵm7', 'Ⅵm'].map((n) => table.byName(n).id);
      let n5 = 0, ii5 = 0, withSev = 0, triadsWithSev = 0, items = 0;
      for (let k = 0; k < 600; k++) {
        const bd = Array(8).fill(null); const len = 4 + (k % 2) * 0;
        for (let i = 0; i < len; i++) bd[i] = common[Math.floor(rnd() * common.length)];
        const h = suggest(bd, table, ALL);
        n5++; if (h.primary.some((c) => c.name === 'Ⅱm7')) ii5++;
        if (bd.slice(0, len).some((id) => isSeventh(table.byId(id)))) { for (const c of [...h.primary, ...h.advanced]) { items++; if (triadsIn({ primary: [c], advanced: [] }).length) triadsWithSev++; } withSev++; }
      }
      t.ok(`Ⅱm7: 5番（フレーズの頭）で、おすすめに出る割合が 6割以上（${ii5}/${n5}）。以前は 3割ほど`, ii5 / n5 >= 0.6);
      t.ok(`セブンス優先: 左にセブンスがある 5番のヒントで、3和音（Ⅱm・Ⅲm・Ⅳ・Ⅴ）が出る割合は 3% 未満（${triadsWithSev}/${items}）`, items > 0 && triadsWithSev / items < 0.03);
    }
  }
  // ============ 25. ダブルクリックで置く場所（いま盤にある駒の次。ui/input.js の nextFreeSlot）============
  t.eq('ダブルクリックの場所: 空の盤は 1番（0）/ 1番だけ → 2番 / 3番まで → 4番 / 離れて 6番 → 7番 / 8番まで埋まる → いちばん最初の空き / ぜんぶ埋まる → -1', [
    nextFreeSlot(Array(8).fill(null)), nextFreeSlot([1, null, null, null, null, null, null, null]), nextFreeSlot([1, 2, 3, null, null, null, null, null]),
    nextFreeSlot([null, null, 1, null, null, 2, null, null]), nextFreeSlot([1, null, 3, 4, 5, 6, 7, 8]), nextFreeSlot([1, 2, 3, 4, 5, 6, 7, 8]),
  ], [0, 1, 3, 6, 1, -1]);

  // ============ 26. 自作コード・コードの編集（core/chordbook.js・chords.js の重ね・game/chordstore.js）============
  {
    const C = 48;
    const sym = (ivs, max = 4) => CB.detectChord(ivs.map((i) => C + i), { max }).map((c) => c.symbol);
    const top = (ivs) => CB.detectChord(ivs.map((i) => C + i))[0];
    const want = [
      ['C', [0, 4, 7], 'maj'], ['Cm', [0, 3, 7], 'min'], ['Cdim', [0, 3, 6], 'dim'], ['Caug', [0, 4, 8], 'aug'], ['Csus4', [0, 5, 7], 'sus4'], ['Csus2', [0, 2, 7], 'sus2'],
      ['CM7', [0, 4, 7, 11], 'maj7'], ['C7', [0, 4, 7, 10], 'dom7'], ['Cm7', [0, 3, 7, 10], 'min7'], ['CmM7', [0, 3, 7, 11], 'mM7'], ['Cm7-5', [0, 3, 6, 10], 'min7b5'], ['Cdim7', [0, 3, 6, 9], 'dim7'],
      ['C6', [0, 4, 7, 9], 'maj'], ['Cm6', [0, 3, 7, 9], 'min6'], ['Cadd9', [0, 4, 7, 14], 'maj'], ['C9', [0, 4, 7, 10, 14], 'dom7'], ['CM9', [0, 4, 7, 11, 14], 'maj7'], ['Cm9', [0, 3, 7, 10, 14], 'min7'],
      ['C11', [0, 4, 7, 10, 14, 17], 'dom7'], ['C13', [0, 4, 7, 10, 14, 21], 'dom7'], ['C7(♭9)', [0, 4, 7, 10, 13], 'dom7'], ['C7(♯9)', [0, 4, 7, 10, 15], 'dom7'], ['C7(♯11)', [0, 4, 7, 10, 18], 'dom7'],
      ['C7(♭13)', [0, 4, 7, 10, 20], 'dom7'], ['Caug7', [0, 4, 8, 10], 'dom7'], ['C7(♭5)', [0, 4, 6, 10], 'dom7'], ['Csus47', [0, 5, 7, 10], 'sus47'], ['CM7(♯11)', [0, 4, 7, 11, 18], 'maj7'],
      ['Cmadd9', [0, 3, 7, 14], 'min'], ['C6/9', [0, 4, 7, 9, 14], 'maj'], ['C7(♭9,♯11)', [0, 4, 7, 10, 13, 18], 'dom7'], ['Cm11', [0, 3, 7, 10, 14, 17], 'min7'], ['C7(13)', [0, 4, 7, 10, 21], 'dom7'],
    ];
    t.eq(`名前の自動判定: ${want.length} 種類の和音を、構成音から読む（名前・種類）。不一致の数`, want.filter(([name, ivs, type]) => { const c = top(ivs); return !(c && c.symbol === name && c.type === type); }).map((x) => x[0]), []);
    t.eq('名前の自動判定（ユーザーの例）: E G# C D G → Eaug7(♯9)（度数の名前 Ⅲaug7(♯9)・種類 dom7）/ A C E G B → Am9（Ⅵm9・min7）', (() => { const a = CB.detectChord([52, 56, 60, 62, 67])[0], b = CB.detectChord([57, 60, 64, 67, 71])[0]; return [a.symbol, a.name, a.type, a.notesText, b.symbol, b.name, b.type]; })(), ['Eaug7(♯9)', 'Ⅲaug7(♯9)', 'dom7', 'E G# C D G', 'Am9', 'Ⅵm9', 'min7']);
    t.eq('名前の自動判定: 転回形は、スラッシュ（E G C → C/E）・ルートが低い音のときは、その読みが先（C A C E G → C6）', [CB.detectChord([52, 55, 60])[0].symbol, CB.detectChord([48, 57, 60, 64, 67])[0].symbol], ['C/E', 'C6']);
    t.eq('名前の自動判定: 候補は、読みやすい順に（ふつう 5つまで・画面は 4つ）。音が1つ以下なら、なし', [CB.detectChord([52, 56, 60, 62, 67]).length, CB.detectChord([52, 56, 60, 62, 67], { max: 4 }).length, CB.detectChord([60]).length, CB.detectChord([]).length], [5, 4, 0, 0]);
    t.eq('名前の自動判定: もとの31の駒を、構成音から読み直すと、名前・コード名・種類・ルートが、すべてもとと同じ', table.pieces().filter((c) => { const notes = [...new Set(c.semitones.map((s) => CB.HOME_C + c.rootPc + s))].sort((a, b) => a - b); const d = CB.detectChord(notes)[0]; return !(d && d.name === c.name && d.symbol === c.symbol && d.type === c.type && d.rootPc === c.rootPc); }).map((c) => c.name), []);
    t.eq('音名: 読みにくい綴り（B#・E#・C♭・ダブルシャープ）は、ふつうの鍵盤の名前に（Eaug の ♯5 は C）', CB.detectChord([52, 56, 60])[0].notesText, 'E G# C');
    t.eq('度数の名前: ルートの高さ → Ⅰ・Ⅱ♭・Ⅲ♭・Ⅳ#・Ⅵ♭・Ⅶ♭（短調系の 1・8 は Ⅰ#・Ⅴ#）', [0, 1, 3, 6, 8, 10].map((pc) => CB.degreeOf(pc).text).concat([CB.degreeOf(1, true).text, CB.degreeOf(8, true).text]), ['Ⅰ', 'Ⅱ♭', 'Ⅲ♭', 'Ⅳ#', 'Ⅵ♭', 'Ⅶ♭', 'Ⅰ#', 'Ⅴ#']);
    // コード表の重ね（base / user）
    const T = new ChordTable(await (await fetch('../data/chords.json')).json());
    const save = { chordbook: { custom: [], edits: {}, nextId: 200 } };
    const store = new ChordStore(save, T);
    t.eq('コード表: ふだん（base）は、もとの駒だけ（31 + 「→」）。自作を足しても、base では見えない', (() => { store.addCustom({ notes: [52, 56, 60, 62, 67] }); return [T.mode, T.list.length, T.customChords().length]; })(), ['base', 32, 0]);
    T.setMode('user');
    t.eq('コード表: user にすると、自作コードが見える（33）。ID は 200 から・custom の印', (() => { const c = T.customChords()[0]; return [T.list.length, c.id, c.custom, c.name, c.symbol]; })(), [33, 200, true, 'Ⅲaug7(♯9)', 'Eaug7(♯9)']);
    t.eq('コード表: 自作の性質（ルート 4・種類 dom7・半音の並び 0 4 8 10 15・働き D・レベル未設定・色形はなし）', (() => { const c = T.byId(200); return [c.rootPc, c.type, c.semitones, c.fn, c.level, c.color, c.shape]; })(), [4, 'dom7', [0, 4, 8, 10, 15], 'D', null, null, null]);
    t.eq('コード表: レベル未設定の自作は、Lv.5 の駒のあと・「→」の前に並ぶ', (() => { const names = T.list.map((c) => c.name); const i = names.indexOf('Ⅲaug7(♯9)'); return [i > names.indexOf('Ⅱ♭7') || i > T.list.findIndex((c) => c.level === 5), T.list[i + 1].isRepeat]; })(), [true, true]);
    t.eq('コード表: レベルを決めた自作は、その段（Lv.2）の中に、ルート音（C → B）の順で入る（2026-11-23。以前は、その段のおわり）', (() => { const r = store.addCustom({ notes: [50, 53, 57, 64], level: 2 }); const seg = T.list.filter((c) => c.level === 2); const roots = seg.map((c) => c.rootPc); const i = seg.findIndex((c) => c.id === r.id); return [r.ok, roots.every((x, k) => k === 0 || x >= roots[k - 1]), i > 0 && i < seg.length - 1, seg[i].rootPc]; })(), [true, true, true, 2]);
    t.eq('重複: 同じ構成音（ルートも同じ）は、ことわる / ほかの数が少なすぎる・多すぎる音の数', [store.addCustom({ notes: [52, 56, 60, 62, 67] }).reason, store.addCustom({ notes: [60] }).reason, store.addCustom({ notes: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57] }).ok], ['duplicate', 'few', true]);
    t.eq('重複: もとの駒と同じ構成音（G B D F = Ⅴ7）も、ことわる（どの駒と同じかを返す）', (() => { const r = store.addCustom({ notes: [55, 59, 62, 65] }); return [r.reason, r.same && r.same.name]; })(), ['duplicate', 'Ⅴ7']);
    // 編集: もとの駒は、書きかえない。「編集」して保存したものは、新しい自作コードとして足される（2026-11-24 のご指定）
    const v7 = T.byName('Ⅴ7');
    t.eq('編集: Ⅴ7（G B D F）に A を足して保存 → 新しい自作コード Ⅴ9（G9・Lv.2）として足される。もとの Ⅴ7 は、そのまま', (() => { const n0 = T.list.length; const r = store.addCustom({ notes: [...store.notesOf(v7.id), 69], level: 2 }); const c = T.byId(r.id); const b = T.byId(v7.id); return [r.ok, r.id >= 200, c.name, c.symbol, c.type, c.custom, c.level, T.list.length - n0, b.name, b.symbol, !!b.edited, T.byName('Ⅴ7').id === v7.id]; })(), [true, true, 'Ⅴ9', 'G9', 'dom7', true, 2, 1, 'Ⅴ7', 'G7', false, true]);
    t.eq('編集: 構成音をそのままにして、色・形・レベルだけ変えても、追加できない（同じ駒を増やさない。どの駒と同じかを返す）', (() => { const r = store.addCustom({ notes: store.notesOf(v7.id), color: '#52bd95', shape: 'star', level: 5 }); return [r.ok, r.reason, r.same && r.same.name]; })(), [false, 'duplicate', 'Ⅴ7']);
    t.eq('編集: ストアに、もとの駒を書きかえる道（editBase・resetBase）は、もうない', [typeof store.editBase, typeof store.resetBase], ['undefined', 'undefined']);
    // 引っ越し: 以前の版の「上書き」（edits）は、新しい自作コードにして、もとの駒は、もとの姿にもどす
    {
      const T3 = new ChordTable(await (await fetch('../data/chords.json')).json());
      const v = T3.byName('Ⅴ7').id, one = T3.byName('Ⅰ').id;
      const old = { custom: [], edits: { [v]: { notes: [55, 59, 62, 65, 69], rootPc: 7, symbol: 'G9', name: 'Ⅴ9', level: 2, color: null, shape: 'auto', at: 1 }, [one]: { notes: [48, 52, 55, 60], rootPc: 0, symbol: 'C', name: 'Ⅰ', level: 5, color: '#52bd95', shape: 'star', at: 2 } }, nextId: 200 };
      const st = new ChordStore({ chordbook: old }, T3); T3.setMode('user');
      t.eq('引っ越し: 以前の上書き（Ⅴ7 → Ⅴ9）は、新しい自作コード Ⅴ9 になる。もとの駒と同じ内容の上書き（色・形だけ）は、足さない', [st.migrated, T3.customChords().map((c) => `${c.id}:${c.name}:${c.symbol}`), Object.keys(T3.layer.edits).length], [1, ['200:Ⅴ9:G9'], 0]);
      t.eq('引っ越し: Ⅴ7 は、もとの姿（G7）にもどる。Ⅴ9 でも Ⅴ7 でも、それぞれの駒を指す', [T3.byName('Ⅴ7').symbol, !!T3.byName('Ⅴ7').edited, T3.byName('Ⅴ9').custom, T3.byName('Ⅴ7').id === v], ['G7', false, true, true]);
    }
    // 保存の形・読み直し・壊れた保存
    const json = JSON.parse(JSON.stringify(save.chordbook));
    const T2 = new ChordTable(await (await fetch('../data/chords.json')).json());
    new ChordStore({ chordbook: json }, T2); T2.setMode('user');
    t.eq('保存: JSON にして、読み直しても、同じ（自作の名前・コード名・種類・半音の並び）', [T2.customChords().map((c) => [c.name, c.symbol, c.type, c.semitones.join(',')]).join('|') === T.customChords().map((c) => [c.name, c.symbol, c.type, c.semitones.join(',')]).join('|'), T2.customChords().length], [true, T.customChords().length]);
    t.eq('保存: 構成音とルートだけ保存する（性質は、読み込むたびに作る）', Object.keys(save.chordbook.custom[0]).sort(), ['at', 'color', 'id', 'level', 'name', 'notes', 'rootPc', 'shape', 'symbol']);
    const dirty = { custom: [null, 5, { id: 200, notes: [10, 20], rootPc: 0 }, { id: 3, notes: [52, 56], rootPc: 4 }, { id: 300, notes: [52, 56, 60, 62, 67], rootPc: 4, symbol: 'ok', name: 'ok', level: 9, color: 'red', shape: 'cube?' }, { id: 300, notes: [52, 55, 59], rootPc: 4 }, { id: 301, notes: [52, 55, 59], rootPc: 2 }], edits: { 9999: { notes: [55, 59, 62], rootPc: 7 }, 9: 'x' }, nextId: 'x' };
    t.eq('保存: 壊れた内容（音が範囲の外・ID が小さい・ID の重複・ルートが合わない・もとの駒にない編集）は、捨てる。色・形・レベルが変なものは、そろえる', (() => { const x = sanitizeChordbook(dirty, new Set([9])); return [x.custom.map((c) => c.id), x.custom[0].level, x.custom[0].color, x.custom[0].shape, Object.keys(x.edits).length, x.nextId]; })(), [[300], null, null, 'auto', 0, 301]);
    t.eq('名前の重なり: 同じ名前は、「②」をつける（uniqueName）', [CB.uniqueName('Ⅴ7', new Set(['Ⅴ7'])), CB.uniqueName('Ⅴ7', new Set(['Ⅴ7', 'Ⅴ7②'])), CB.uniqueName('X', new Set())], ['Ⅴ7②', 'Ⅴ7③', 'X']);
    // 判定: 自作・編集した駒も、同じように判定される
    const mk = (notes, o = {}) => { const r = store.addCustom({ notes, ...o }); return r.ok ? r.id : null; };
    const bd = (...ids) => { const out = ids.map((x) => (typeof x === 'string' ? T.byName(x).id : x)); while (out.length < 8) out.push(null); return out; };
    const eaug = T.customChords().find((c) => c.symbol === 'Eaug7(♯9)').id;
    let r = analyze(bd('ⅠM7', eaug, 'Ⅵm7', 'Ⅱm7'), T);
    t.ok('判定: 自作の Eaug7(♯9)（Ⅲ・dom7）→ Ⅵm7 は、セカンダリードミナント（強進行）。技の和音の名前に、自作の名前が出る', r.instances.some((i) => i.kind === 'dominant_motion' && i.variant === 'セカンダリードミナント' && i.chords[0] === 'Ⅲaug7(♯9)'));
    const fm9 = mk([53, 56, 60, 63, 67]);                     // F A♭ C E♭ G = Fm9（ルート F・min7）
    r = analyze(bd('Ⅳ', fm9, 'Ⅰ'), T);
    t.ok('判定: 自作の Fm9（Ⅳm9 = Ⅳ・min7）は、サブドミナントマイナー（Ⅳ → Ⅳm → Ⅰ の技）として扱われる', T.byId(fm9).name === 'Ⅳm9' && r.instances.some((i) => i.kind === 'sdm' && i.variant === 'Ⅳ→Ⅳm→Ⅰ'));
    const ab9 = mk([56, 60, 63, 67, 70]);                     // A♭ C E♭ G B♭ = A♭M9 ではなく A♭7... （B♭ = 9度）→ A♭M9
    t.eq('判定: 借用和音の呼び名は、ルートと種類で決まる（A♭M9 = Ⅵ♭・maj7 → Ⅵ♭M7 の仲間）', [T.byId(ab9).type, T.byId(ab9).rootPc, borrowKey(T.byId(ab9))], ['maj7', 8, 'Ⅵ♭M7']);
    t.eq('働き（fn）: 自作の新しい種類も、ルートと種類から決まる（Ⅴaug = D / Ⅶdim = D / Ⅰsus2 = T / Ⅳ7 = D / Ⅱm = SD）', (() => {
      const f = (n) => { const r = store.addCustom({ notes: n }); return r.ok ? T.byId(r.id).fn : null; };
      return [f([55, 59, 63]), f([59, 62, 65]), f([48, 50, 55, 57]), f([53, 57, 60, 63]), T.byName('Ⅱm').fn];
    })(), ['D', 'D', 'T', 'D', 'SD']);
    t.eq('判定: 難しさの加点は、決めたレベルのとおり（技に使われた Lv.5 の自作 = +30）。未設定は、つかない', (() => { const a = mk([50, 53, 57, 60, 64], { level: 5 }); const b = mk([55, 59, 62, 65, 68]); const res = analyze(bd(a, b, 'ⅠM7'), T); return [res.instances.some((i) => i.variant === 'ツーファイブワン'), res.levelPieces.find((p) => p.level === 5 && p.bonus === 30) !== undefined, res.levelPieces.some((p) => p.name === T.byId(b).name)]; })(), [true, true, false]);
    // ヒント・プリセット
    t.ok('ヒント: 自作コードも、候補になる（置くと技が決まる駒として）', (() => { const h = suggest(bd('ⅠM7', 'Ⅵm7'), T, T.list.map((c) => c.id)); return [...h.primary, ...h.advanced].length > 0; })());
    t.eq('プリセット: 自作コードの名前で保存できる / 消したあとの呼び出しは、その駒だけ空きになる（missing）', (() => {
      const sv = { presets: [] }; const st = new PresetStore(sv, T);
      const b2 = bd('ⅠM7', eaug, 'Ⅵm7');
      const add = st.add({ name: 'x', board: b2, from: 0, to: 2 });
      store.removeCustom(eaug);
      const plan = placementPlan(st.list()[0], 0, T);
      const kept = new PresetStore({ presets: JSON.parse(JSON.stringify(sv.presets)) }, T).list().length;
      return [add.ok, plan.entries.map((e) => e.id), plan.missing, plan.count, kept];
    })(), [true, [T.byName('ⅠM7').id, null, T.byName('Ⅵm7').id], ['Ⅲaug7(♯9)'], 2, 1]);
    t.eq('プリセット: 知らない名前の駒を含むプリセットは、ふつうの検査では捨てるが、ゲームの保存（keepUnknown）では残す', [sanitizePresets([{ chords: ['Ⅰ', 'まぼろし'] }], T).length, sanitizePresets([{ chords: ['Ⅰ', 'まぼろし'] }], T, { keepUnknown: true }).length], [0, 1]);
  }

  // ============ 27. 技の詳細・曲の例（core/trickinfo.js・songs.js。2026-11-23）============
  {
    const inst = (spec, kind, variant = null) => analyze(board(spec), table).instances.find((i) => i.kind === kind && (variant === null || i.variant === variant));
    const named = Object.keys(TRICKS).filter((k) => TRICKS[k].group === 'named' && !TRICKS[k].custom);
    t.ok('曲の例: 固有進行（13）・バックドア・カノンは、すべて、曲の一覧がある', named.every((k) => (SONGS[k] || []).length > 0) && SONGS.backdoor.length > 0 && SONGS['weak_motion|カノン進行'].length > 0 && named.length === 13);
    t.ok('曲の例: どの曲にも、曲名・アーティスト・資料（SOURCES にある）がある。洋楽・クラシックは en の印', Object.values(SONGS).every((list) => list.every((s) => s.t && s.a && SOURCES[s.src])));
    t.ok('曲の例: Pretender は、王道進行ではなく、カノン進行（変形）に入れた（資料で、そう紹介されていた）', !SONGS.oudou.some((s) => s.t === 'Pretender') && SONGS['weak_motion|カノン進行'].some((s) => s.t === 'Pretender'));
    t.eq('曲の例: 日本の曲が確認できなかった進行は、画面に「確認できていません」（noJapanese）。ほかは、日本の曲がある', (() => { const keys = [...named, 'backdoor', 'cliche']; return keys.filter((k) => songsFor({ kind: k, variant: null }).noJapanese).sort(); })(), [...NO_JAPANESE].sort());
    t.ok('曲の例: Ⅳ-Ⅲ-Ⅵ進行は、丸サ進行の曲（ⅣM7→Ⅲ7→Ⅵm7 の形）を出す（viaMaruSa）', (() => { const s = songsFor({ kind: 'iv_iii_vi', variant: null }); return s.viaMaruSa && s.list.some((x) => x.t === '丸の内サディスティック'); })());
    t.ok('曲の例: ふつうのつながり・終止・借用和音には、曲の一覧はない（null）', ['dominant_motion', 'weak_motion', 'half_step_down', 'authentic_cadence', 'picardy', 'sdm'].every((k) => songsFor({ kind: k, variant: null }) === null));
    t.ok('曲の例: カノン進行の変種（完全な形）も、カノン進行の曲', songsFor({ kind: 'weak_motion', variant: 'カノン進行（完全な形）' }).list.some((s) => s.t === '負けないで'));
    let ins = inst('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7', 'oudou');
    let d = trickDetail(ins);
    t.eq('詳細: 王道進行 = 固有進行・1番か5番から・基本 380・曲 8つ', [d.name, d.groupLabel, d.condition, d.points.base, d.points.total, d.songs.list.length], ['王道進行', '固有進行', '1番か5番から並べると決まります。', 380, 380, 8]);
    ins = inst('Ⅱm7 Ⅴ7 ⅠM7', 'dominant_motion', 'ツーファイブワン');
    d = trickDetail(ins);
    t.eq('詳細: ツーファイブワン = つながり・どの位置でも・曲はなし・形のちがいの一覧に3つ', [d.groupLabel, d.condition, d.songs, d.variants.length, d.variants.filter((v) => v.here).map((v) => v.name)], ['つながり', '盤の、どの位置でも決まります。', null, 3, ['ツーファイブワン']]);
    d = trickDetail(inst('Ⅳ Ⅴ7 Ⅰ', 'authentic_cadence'));
    t.eq('詳細: Ⅴ-Ⅰ終止 = 終止・フレーズの終わり', [d.groupLabel, /フレーズの終わり/.test(d.condition)], ['終止', true]);
    d = trickDetail(inst('Ⅲ7 Ⅵ7 Ⅱ7 Ⅴ7 Ⅰ Ⅰ - -', 'ragtime'));
    t.ok('詳細: ラグタイム進行の条件は、冒頭（1番）から・Ⅰ を2つぶん以上', /冒頭（1番）から/.test(d.condition) && /2つぶん/.test(d.condition));
    d = trickDetail(inst('Ⅰ Ⅴ Ⅳ Ⅳ Ⅰ Ⅴ Ⅰ Ⅴ', 'blues8'));
    t.ok('詳細: 8小節ブルースの条件は、1番から8番までぜんぶ', /1番から8番まで/.test(d.condition));
    d = trickDetail(analyze(board('Ⅳ - - - - - - Ⅰ'), table).instances.find((i) => i.seam));
    t.ok('詳細: ループのつなぎ目の技は、条件に「8番 → 1番」・コンボには数えない', /ループのつなぎ目（8番 → 1番）/.test(d.condition) && d.seam === true);
    d = trickDetail(analyze(board('Ⅴ7 Ⅰ'), table).oddities[0]);
    t.eq('詳細: 「？」（冒頭のドミナント）= 減点 −100・条件の説明', [d.warn, d.groupLabel, d.total, /冒頭（1番）/.test(d.condition)], [true, '減点', -100, true]);
    t.ok('詳細: 自作の進行（ユーザーが送った進行）には、曲を出さない', (() => { setCustomProgressions([{ id: 'zz', name: 'テスト進行', chords: ['Ⅰ', 'Ⅳ'], points: 100 }]); const r = analyze(board('Ⅰ Ⅳ'), table); const i = r.instances.find((x) => x.kind === 'custom_zz'); const dd = i ? trickDetail(i) : null; setCustomProgressions([]); return !!dd && dd.songs === null && dd.custom === true; })());
  }

  // ============ 28. 判定の取りこぼしの確認（2026-11-23。「Ⅴ7 が 8番にあるのに、ドミナントモーションが加点されない」の調査）============
  {
    // 無作為な盤: となり合う駒の、ルートの動きが 4度上・5度上・半音下なら、どれかの技（つなぎ目の技を含む）が、その2つの駒を覆っている
    let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pick = () => { const x = rnd(); if (x < 0.06) return null; if (x < 0.14) return table.repeatId; return ALL[Math.floor(rnd() * ALL.length)]; };
    const mot = (a, b) => (((b.rootPc - a.rootPc) % 12) + 12) % 12;
    const missed = [];
    for (let n = 0; n < 6000 && missed.length < 5; n++) {
      const bd2 = Array.from({ length: 8 }, pick);
      const r = analyze(bd2, table);
      for (const seg of r.segments) for (let i = 0; i + 1 < seg.length; i++) {
        const a = seg[i], b = seg[i + 1];
        if (a.blocked || b.blocked || ![5, 7, 11].includes(mot(a.chord, b.chord))) continue;
        if (!r.instances.some((ins) => ins.positions.includes(a.first) && ins.positions.includes(b.first))) missed.push(bd2.join(','));
      }
      const first = r.segments.find((sg) => sg[0].first === 0), last = r.segments.find((sg) => sg[sg.length - 1].last === 7);
      if (first && last) { const B = first[0], A = last[last.length - 1]; if (A !== B && !A.blocked && !B.blocked && [5, 7, 11].includes(mot(A.chord, B.chord)) && !r.instances.some((ins) => ins.seam)) missed.push('seam:' + bd2.join(',')); }
    }
    t.eq('取りこぼし: 無作為な盤 6000 通りで、4度上・5度上・半音下の動き（8番 → 1番のつなぎ目も）が、技に取られていない例は 0', missed, []);
    // 全部の技を、置ける位置ぜんぶに置く（空きに囲まれた形。冒頭のドミナントが「？」になるもの・ネアポリタン（終止に取られる）は、設計どおり別）
    let total = 0, hit = 0; const lost = [];
    let s2 = 777; const r2 = () => { s2 = (s2 * 1664525 + 1013904223) >>> 0; return s2 / 4294967296; };
    const pieces = table.pieces();
    for (const pat of PATTERNS) {
      if (pat.custom || pat.id === 'neapolitan') continue;
      const cand = pat.steps.map((m) => pieces.filter((c) => m(c)));
      if (cand.some((c) => !c.length)) { lost.push(`${pat.id}: 合う駒がない`); continue; }
      for (let n = 0; n < 8; n++) {
        const evs = cand.map((c) => c[Math.floor(r2() * c.length)]);
        if (pat.check && !pat.check(evs.map((c, i) => ({ chord: c, first: i, last: i })), { phrase: 4 })) continue;
        for (let start = 0; start + evs.length <= 8; start++) {
          if (pat.startAt && !pat.startAt.includes(start)) continue;
          const bd3 = Array(8).fill(null); evs.forEach((c, i) => { bd3[start + i] = c.id; });
          const r = analyze(bd3, table);
          if (r.oddities.length) continue;                                       // 冒頭（1番）のドミナント系の駒: 「？」（設計どおり）
          total++;
          if (r.instances.some((i) => i.id === pat.id && i.startPos === start)) hit++;
          else {
            // 同じ駒を、もっと優先度の高い（または同じ）技が取っているのは、設計どおり（例: 丸サ進行が Ⅳ-Ⅲ-Ⅵ進行より先・ドミナント終止が、サブドミナントマイナーより先）
            const overshadowed = r.instances.some((i) => { const q = PATTERNS.find((x) => x.id === i.id); return !i.seam && q && q.tier >= pat.tier && i.positions.includes(start) && i.positions.includes(start + 1); });
            if (!overshadowed && lost.length < 20) lost.push(`${pat.id}@${start + 1}: ${evs.map((c) => c.name).join(' ')} → ${r.instances.map((i) => i.id).join(',') || 'なし'}`);
          }
        }
      }
    }
    t.eq(`取りこぼし: 全部の技を、置ける位置すべてに置く（${total} 通り）。技が決まらなかった例のうち、優先度の高い（または同じ）別の技が、その駒を取っていないもの（本当の取りこぼし）は 0`, lost, []);
    t.ok(`取りこぼし: 置いた形の 9割 以上で、その技が決まる（${hit}/${total}）`, total > 500 && hit / total > 0.9);
    // ループの指摘（8番の駒がドミナントで、つなぎ目が技にならないとき、理由を 0点で出す）
    const note = (spec) => analyze(board(spec), table).critiques.filter((c) => c.id.startsWith('loopnote'));
    t.eq('ループの指摘: 8番 Ⅴ7・1番が空き → 「1番が空き」（0点）。1番 Ⅵm7 → 「全音上」。1番 Ⅰ7（？）→ 「？」。1番 ⅠM7 → 指摘なし（技になる）', [
      note('- Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅱm7 Ⅴ7').map((c) => [c.points, /1番が空き/.test(c.reason)]), note('Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅰ Ⅱm7 Ⅴ7').map((c) => /全音上/.test(c.reason)),
      note('Ⅰ7 Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅱm7 Ⅴ7').map((c) => /「？」/.test(c.reason)), note('ⅠM7 Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅱm7 Ⅴ7').length,
    ], [[[0, true]], [true], [true], 0]);
    t.eq('ループの指摘: 8番がドミナントでない（Ⅱm7）・8番が空き・盤が8つでない（4つの盤）ときは、出ない', [note('Ⅰ Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅴ7 Ⅱm7').length, note('Ⅰ Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅴ7 -').length, analyze([table.byName('Ⅰ').id, null, null, table.byName('Ⅴ7').id], table).critiques.filter((c) => c.id.startsWith('loopnote')).length], [0, 0, 0]);
    t.ok('ループの指摘: 点数に入らない（0点。得点は、指摘がないときと同じ）', (() => { const r = analyze(board('- Ⅵm7 Ⅳ Ⅰ Ⅵm7 Ⅳ Ⅱm7 Ⅴ7'), table); return r.score.senseGood === r.critiques.filter((c) => c.points > 0).reduce((a, c) => a + c.points, 0) && r.critiques.some((c) => c.id.startsWith('loopnote') && c.points === 0); })());
  }
  // ============ 内声の半音の動き（ジャッジ G7。2026-11-23）============
  {
    const crit = (spec) => analyze(board(spec), table).critiques.map((c) => `${c.id.split('|')[0]}:${c.points}`);
    const G = (spec) => crit(spec).filter((c) => c.startsWith('link') || c.startsWith('chroma'));
    t.eq('ガイドトーンの半音進行: Ⅱm7 → Ⅴ7（ド → シ）・Ⅴ7 → ⅠM7（ファ → ミ）= +30 が 2つ。技（ツーファイブワン）が取っているつながりにも付く', G('Ⅱm7 Ⅴ7 ⅠM7'), ['link:30', 'link:30']);
    t.eq('ガイドトーン: 王道進行（ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7）は、どのつながりも、7度 → 3度が半音ではないので、付かない', G('ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7'), []);
    t.eq('ガイドトーン: 3和音（7度がない）には、付かない（Ⅴ → Ⅰ・Ⅱm → Ⅴ）', G('Ⅱm Ⅴ Ⅰ'), []);
    t.eq('ガイドトーン: Ⅴm7 → Ⅰ7（ファ → ミ）にも付く（丸サ進行の最後。1番の Ⅴ 系は「？」なので、2番から）', G('- Ⅴm7 Ⅰ7'), ['link:30']);
    t.eq('ガイドトーン: 7度 → 3度が、全音のとき（Ⅲ7 → Ⅵm7: レ → ド）は、付かない', G('Ⅲ7 Ⅵm7'), []);
    t.eq('ガイドトーン: 強進行（ルートが5度下がる）のつながりだけ。ルートが5度上がる（弱進行）Ⅳm7 → Ⅰ（ミ♭ → ミ）には、付かない', G('Ⅳm7 Ⅰ'), []);
    t.eq('同じルートの色の変化: ⅠM7 → Ⅰ7（シ → シ♭）= +20。ユーザーの例: Ⅴ-Ⅰ終止のあとに Ⅰ7 を足すと、内声の加点が付く', G('ⅣM7 Ⅴ7 ⅠM7 Ⅰ7'), ['link:30', 'link:20']);
    t.eq('同じルートの色の変化: Ⅳ → Ⅳm7（ラ → ラ♭）= +20。Ⅰ → ⅠM7（ルートも 5度も動かず、シが足されるだけ）には、付かない', [G('Ⅳ Ⅳm7'), G('Ⅰ ⅠM7')], [['link:20'], []]);
    t.eq('ルートが動いていて、ガイドトーンでもない半音の動き（Ⅰ → Ⅴ7 の ド → シ・ミ → ファ）は、数えない（無作為に並べても、たまたま起きるので）', G('Ⅰ Ⅴ7'), []);
    t.eq('半音で動き続ける内声: 丸サ進行 ⅣM7 → Ⅲ7 → Ⅵm7（ラ → ソ♯ → ソ）= +40', G('ⅣM7 Ⅲ7 Ⅵm7'), ['chroma:40']);
    t.eq('半音で動き続ける内声: サブドミナントマイナー Ⅳ → Ⅳm7 → Ⅰ（ラ → ラ♭ → ソ）= +40。技が取っていても付く。Ⅳ → Ⅳm7 の（ラ → ラ♭）は、同じルートの色の変化 +20', G('Ⅳ Ⅳm7 Ⅰ'), ['link:20', 'chroma:40']);
    t.eq('半音で動き続ける内声: 2つの和音だけでは、付かない（3つ以上）', G('Ⅳ Ⅳm7').filter((x) => x.startsWith('chroma')), []);
    t.eq('内声の加点の合計は、120 まで（ツーファイブワン 60 + 丸サ 40 + ⅠM7 → Ⅰ7 の 20 = 120。もう1つ足しても、ふえない）', (() => { const r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7 - ⅣM7 Ⅲ7 Ⅵm7 - Ⅰ'), table); return r.critiques.filter((c) => /^(link|chroma)\|/.test(c.id)).reduce((a, c) => a + c.points, 0); })(), 100);
    t.eq('内声の加点: 上限（120）に届いたら、それ以上は付かない', (() => { const r = analyze(board('Ⅱm7 Ⅴ7 ⅠM7 Ⅰ7 - ⅣM7 Ⅲ7 Ⅵm7'), table); return [r.critiques.filter((c) => /^(link|chroma)\|/.test(c.id)).reduce((a, c) => a + c.points, 0) <= SENSE.innerCap, SENSE.innerCap]; })(), [true, 120]);
    t.ok('内声の加点: 内声の合計は、SENSE.innerCap をこえない（無作為な盤 3000 通り）', (() => { let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; for (let n = 0; n < 3000; n++) { const bd = Array.from({ length: 8 }, () => (rnd() < 0.2 ? null : ALL[Math.floor(rnd() * ALL.length)])); const r = analyze(bd, table); const inner = r.critiques.filter((c) => /^(link|chroma)\|/.test(c.id)).reduce((a, c) => a + c.points, 0); if (inner > SENSE.innerCap) return false; } return true; })());
    t.ok('内声の講評: 名前・理由・位置・色がある', ['Ⅱm7 Ⅴ7', 'ⅣM7 Ⅲ7 Ⅵm7', 'ⅠM7 Ⅰ7'].every((spec) => analyze(board(spec), table).critiques.filter((c) => /^(link|chroma)\|/.test(c.id)).every((c) => c.name && c.reason.length > 30 && c.positions.length >= 2 && c.color && c.kind === 'good')));
    t.eq('内声の加点: ブロック（冒頭のドミナント「？」）をまたがない（1番 Ⅴ7 は「？」。Ⅴ7 → ⅠM7 のガイドトーンは付かない）', G('Ⅴ7 ⅠM7'), []);
    t.ok('ヒント: ガイドトーンの半音進行は、流れの理由に出る（Ⅱm7 → Ⅴ7 以外では、Ⅲm7 → Ⅵ7 など）', (() => { const a = table.byName('Ⅲm7'), b = table.byName('Ⅵ7'); const f = SENSE_FLOW(a, b); return !!f && /ガイドトーン/.test(f.reason); })());
  }

  // ============ コードの並べ順（トレイ。2026-11-23）============
  {
    const mk = (root, iv) => ({ rootPc: root, pcs: iv.map((i) => (root + i) % 12), isRepeat: false });
    const order = (root, defs) => Object.entries(defs).map(([n, iv]) => [n, CB.chordOrderKey(mk(root, iv))]).sort((a, b) => CB.compareOrderKeys(a[1], b[1])).map((x) => x[0]);
    t.eq('並べ順（3和音。ユーザーの例）: Csus2, Cm, C, Caug, Csus4', order(0, { Csus4: [0, 5, 7], Caug: [0, 4, 8], C: [0, 4, 7], Cm: [0, 3, 7], Csus2: [0, 2, 7] }), ['Csus2', 'Cm', 'C', 'Caug', 'Csus4']);
    t.eq('並べ順（4和音以上。ユーザーの例）: Em7-5, Em7, E7, Eaug7, EM7, Em9, E7(♭9), E11', order(4, { E11: [0, 4, 7, 10, 2, 5], 'E7(b9)': [0, 4, 7, 10, 1], Em9: [0, 3, 7, 10, 2], EM7: [0, 4, 7, 11], Eaug7: [0, 4, 8, 10], E7: [0, 4, 7, 10], Em7: [0, 3, 7, 10], 'Em7-5': [0, 3, 6, 10] }),
      ['Em7-5', 'Em7', 'E7', 'Eaug7', 'EM7', 'Em9', 'E7(b9)', 'E11']);
    t.eq('並べ順: 6th・dim7 は、♭7 より前（C6 < C7 < CM7）。add9 は、4和音のなかで、いちばん前', order(0, { CM7: [0, 4, 7, 11], C7: [0, 4, 7, 10], C6: [0, 4, 7, 9], Cdim7: [0, 3, 6, 9], Cadd9: [0, 4, 7, 2] }), ['Cadd9', 'Cdim7', 'C6', 'C7', 'CM7']);
    t.eq('並べ順: 転回形・ちらばりに左右されない（同じ構成音なら、同じ鍵）', JSON.stringify(CB.chordOrderKey(mk(4, [0, 4, 7, 10, 14]))) === JSON.stringify(CB.chordOrderKey(mk(4, [0, 4, 7, 10, 2]))), true);
    const lvOrder = (lv) => table.list.filter((c) => c.level === lv).map((c) => c.name);
    t.eq('トレイの並び: Lv.5 は、Ⅱ♭7 が Ⅱ♭M7 の左（ユーザーの指定）。Ⅱ♭7・Ⅱ♭M7・Ⅲ♭m6・Ⅲ♭M7・Ⅳm6', lvOrder(5), ['Ⅱ♭7', 'Ⅱ♭M7', 'Ⅲ♭m6', 'Ⅲ♭M7', 'Ⅳm6']);
    t.ok('トレイの並び: どの段（Lv.）も、ルート音（C → B）の順', [1, 2, 3, 4, 5].every((lv) => { const r = table.list.filter((c) => c.level === lv).map((c) => c.rootPc); return r.every((x, k) => k === 0 || x >= r[k - 1]); }));
    t.eq('トレイの並び: Lv.1 は Ⅰ・Ⅳ・Ⅴ・Ⅵm（以前は Ⅰ・Ⅵm・Ⅳ・Ⅴ）', lvOrder(1), ['Ⅰ', 'Ⅳ', 'Ⅴ', 'Ⅵm']);
    t.eq('トレイの並び: 「→」は、いちばん最後', table.list[table.list.length - 1].isRepeat, true);
    t.eq('sortByRoot: 段を分けないトレイ（チュートリアル）は、ルート音の順だけ。Ⅵm7・Ⅴ7・ⅣM7・Ⅰ → Ⅰ・ⅣM7・Ⅴ7・Ⅵm7', table.sortByRoot(['Ⅵm7', 'Ⅴ7', 'ⅣM7', 'Ⅰ'].map((n) => table.byName(n).id)).map((id) => table.byId(id).name), ['Ⅰ', 'ⅣM7', 'Ⅴ7', 'Ⅵm7']);
  }

  // ============ 取り込み（公開ページ用。net/share.js。2026-11-23）============
  {
    const names = table.pieces().map((c) => c.name);
    const PAY = { drums: [{ name: '夕焼けビート', length: 16, lanes: { K: 'x...x...x...x...', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' } }], backings: [{ name: 'ゆったり', length: 16, cells: 'C---....C---....' }], progressions: [{ name: 'テスト進行', chords: ['Ⅰ', 'Ⅴ', 'Ⅵm'], points: 500, startAt: 'head' }] };
    const code = SH.encodeShare(PAY);
    t.ok('取り込み: コードは j1. で始まる・日本語の名前も、こわれずに戻る', code.startsWith('j1.') && /^[A-Za-z0-9_.-]+$/.test(code) && SH.decodeShare(code).data.drums[0].name === '夕焼けビート');
    t.eq('取り込み: リンク（…#lib=コード）・コードだけ・JSON そのもの、どれでも読める', [SH.decodeShare(`https://x.github.io/#lib=${code}`).ok, SH.decodeShare(code).ok, SH.decodeShare(JSON.stringify({ app: SH.SHARE_APP, v: 1, ...PAY })).ok], [true, true, true]);
    t.eq('取り込み: ことわる（空・# の付いていないリンク・別の JSON・こわれたコード・版ちがい）', [SH.decodeShare('').ok, SH.decodeShare('https://x.github.io/').ok, SH.decodeShare('{"app":"other"}').ok, SH.decodeShare('j1.@@@').ok, SH.decodeShare('{"app":"chord-lines-library","v":9}').ok], [false, false, false, false, false]);
    const san = SH.sanitizeShared(SH.decodeShare(code).data, names);
    t.eq('取り込み: 検査（ドラム 1・バッキング 1・進行 1・とばしたもの 0）', [san.drums.length, san.backings.length, san.progressions.length, san.skipped], [1, 1, 1, 0]);
    const bad = SH.sanitizeShared({ drums: [{ name: 'x', length: 16, lanes: { K: 'x...' } }, { name: 'y', length: 16, lanes: { Z: 'x...............' } }, { name: 'z', length: 16, lanes: { K: '................' } }, { name: 'a\nb', length: 16, lanes: { K: 'x...............' } }, { name: 'あ'.repeat(21), length: 16, lanes: { K: 'x...............' } }],
      backings: [{ name: 'b1', length: 16, cells: '-...............' }, { name: 'b2', length: 16, cells: '................' }, { name: 'b3', length: 16, cells: 'Cxxx............' }, { name: 'b4', length: 12, cells: 'C...........' }],
      progressions: [{ name: 'p1', chords: ['Ⅰ'] }, { name: 'p2', chords: ['Ⅰ', 'ないコード'] }, { name: 'p3', chords: ['Ⅰ', 'Ⅴ'], points: 5 }, { name: 'p4', chords: ['Ⅰ', 'Ⅴ'], startAt: 'x' }, { name: 'p5', chords: Array(9).fill('Ⅰ') }] }, names);
    t.eq('取り込み: 不正な内容は、全部ことわる（長さちがい・知らないレーン・空・改行・長すぎる名前・「-」の位置・空・知らない文字・知らない長さ・駒の数・知らない駒・点数・始まり）', [bad.drums.length, bad.backings.length, bad.progressions.length, bad.skipped], [0, 0, 0, 14]);
    t.eq('取り込み: 上限（ドラム 40・バッキング 40・進行 60）をこえると、とばす', (() => { const many = { drums: Array.from({ length: 45 }, (_, i) => ({ name: `d${i}`, length: 8, lanes: { K: 'x.......' } })) }; const r = SH.sanitizeShared(many, names); return [r.drums.length, r.skipped]; })(), [40, 5]);
    const m1 = SH.mergeIntoLibrary(null, san), m2 = SH.mergeIntoLibrary(m1.lib, san);
    t.eq('取り込み: 保存に混ぜる（id は d1・b2・p3 のように増える）。同じ名前は、上書き（増えない・id はそのまま）', [m1.added.length, m1.lib.drums[0].id, m1.lib.backings[0].id, m1.lib.progressions[0].id, m2.added.length, m2.updated.length, m2.lib.drums[0].id], [3, 'd1', 'b2', 'p3', 0, 3, 'd1']);
    t.eq('取り込み: 削除', (() => { const l = SH.removeFromLibrary(m1.lib, 'drum', 'd1'); return [l.drums.length, l.backings.length, SH.libraryCount(l)]; })(), [0, 1, 2]);
    t.eq('取り込み: 保存してあった内容の、検査（こわれていても動く・id は残る・重なった名前は捨てる）', (() => { const l = SH.sanitizeLocal({ drums: [{ id: 'd7', name: 'a', length: 8, lanes: { K: 'x.......' } }, { id: 'd8', name: 'a', length: 8, lanes: { K: 'x.......' } }, { id: 'x1', name: 'b', length: 8, lanes: { K: 'x.......' } }, null], backings: 5, progressions: 'x', next: 2 }, names); return [l.drums.map((x) => x.id), l.backings.length, l.next]; })(), [['d7'], 0, 8]);
    t.eq('取り込み: 取り込み先の入れ物は、ブリッジの内容（library.js の mergeUserPatterns）と同じ形で使える', (() => { const lib = { ...m1.lib }; const pr = { drums: [], backings: [] }; return [lib.drums[0].lanes.K.length, lib.backings[0].cells.length, typeof lib.progressions[0].points]; })(), [16, 16, 'number']);
  }

  // ============ プリセットの、分割したマス（2026-11-23）============
  {
    const bdl = (spec) => spec.split(' ').map((n) => (n === '-' ? null : table.byName(n).id));
    const sp = (spec) => spec.split(' ').map((n) => (n === '-' ? null : table.byName(n).id));
    const r = makePreset({ name: '分割', board: bdl('Ⅱm7 ⅠM7 - - - - - -'), split: sp('Ⅴ7 - - - - - - -'), from: 0, to: 1, table });
    t.eq('プリセット: 分割したマスも保存する（half に、後半の駒の名前）', [r.ok, r.preset.chords, r.preset.half], [true, ['Ⅱm7', 'ⅠM7'], ['Ⅴ7', null]]);
    t.eq('プリセット: 分割がなければ、half は付かない・分割だけが違えば、別のプリセット（重複ではない）', (() => { const a = makePreset({ name: 'a', board: bdl('Ⅱm7 ⅠM7 - - - - - -'), from: 0, to: 1, table }); const b = makePreset({ name: 'b', board: bdl('Ⅱm7 ⅠM7 - - - - - -'), split: sp('Ⅴ7 - - - - - - -'), from: 0, to: 1, table, existing: [a.preset] }); const c = makePreset({ name: 'c', board: bdl('Ⅱm7 ⅠM7 - - - - - -'), split: sp('Ⅴ7 - - - - - - -'), from: 0, to: 1, table, existing: [b.preset] }); return [a.preset.half, b.ok, c.reason]; })(), [undefined, true, 'duplicate']);
    t.eq('プリセット: 駒が1つでも、分割していれば、保存できる（2つの駒）', makePreset({ name: 'x', board: bdl('Ⅱm7 - - - - - - -'), split: sp('Ⅴ7 - - - - - - -'), from: 0, to: 0, table }).ok, true);
    const plan = placementPlan(r.preset, 2, table);
    t.eq('プリセットの置き方: 後半の駒（second）も入る・駒の数は、後半も数える', [plan.entries.map((e) => [e.slot, e.name, e.secondName]), plan.entries[0].second === table.byName('Ⅴ7').id, plan.count], [[[2, 'Ⅱm7', 'Ⅴ7'], [3, 'ⅠM7', null]], true, 3]);
    t.eq('プリセット: 保存の検査（half の形が合わなければ、分割を捨てる・合えば残る・前後の空きを切ると、一緒に切る）', (() => { const ok = sanitizePresets([{ id: 'p1', name: 'a', chords: [null, 'Ⅱm7', 'ⅠM7'], half: [null, 'Ⅴ7', null], at: 1 }], table); const ng = sanitizePresets([{ id: 'p2', name: 'b', chords: ['Ⅱm7', 'ⅠM7'], half: ['Ⅴ7'], at: 1 }], table); const ng2 = sanitizePresets([{ id: 'p3', name: 'c', chords: ['Ⅱm7', 'ⅠM7'], half: ['ないコード', null], at: 1 }], table); return [ok[0].chords, ok[0].half, ng[0].half, ng2.length]; })(), [['Ⅱm7', 'ⅠM7'], ['Ⅴ7', null], undefined, 1]);
  }


  // ============ 29. 終止のあとに、同じルートの和音を足しても、終止が消えない（2026-11-24。ユーザーの指摘: ⅣM7 Ⅴ7 ⅠM7 に Ⅰ7 を足すと、Ⅴ-Ⅰ終止が消えて、大きな減点になる）============
  {
    const has = (spec, kind) => analyze(board(spec), table).instances.some((i) => i.kind === kind);
    const total = (spec) => analyze(board(spec), table).score.total;
    t.ok('ご指摘の例: ⅣM7 Ⅴ7 ⅠM7 Ⅰ7 でも、Ⅴ-Ⅰ終止が決まる（ⅠM7 のあとに、同じルートの Ⅰ7 が続いても、フレーズの終わりに着いている）', has('ⅣM7 Ⅴ7 ⅠM7 Ⅰ7', 'authentic_cadence') && has('ⅣM7 Ⅴ7 ⅠM7', 'authentic_cadence'));
    t.ok('ご指摘の例: Ⅰ7 を足したら、点は、下がらない（Ⅰ7 は、ⅠM7 からの内声の動き・ⅣM7 へのセカンダリードミナントでもある）', total('ⅣM7 Ⅴ7 ⅠM7 Ⅰ7') >= total('ⅣM7 Ⅴ7 ⅠM7'));
    t.ok('ご指摘の例: 足したあとの「理由」に、内声の動き（ⅠM7 → Ⅰ7）の加点が出る', analyze(board('ⅣM7 Ⅴ7 ⅠM7 Ⅰ7'), table).critiques.some((c) => /^link\|/.test(c.id) && c.points > 0));
    // 終止のかたち × 足す和音（最後の和音と同じルートで、駒の名前がちがうもの）。足しても、元の技が1つも消えない・点が、20 より下がらない
    const bases = ['ⅣM7 Ⅴ7 ⅠM7', 'Ⅳ Ⅴ Ⅰ', 'Ⅱm7 Ⅴ7 ⅠM7', 'Ⅴ7 Ⅰ', 'Ⅴ Ⅵm', 'Ⅴ7 Ⅵm7', 'Ⅳ Ⅰ', 'Ⅳm7 Ⅶ♭7 ⅠM7', 'Ⅱm7 Ⅴ7 Ⅵ', 'Ⅲ7 Ⅵ', 'Ⅵsus4 Ⅵ', 'Ⅵm Ⅳ Ⅴ'];
    const key = (i) => `${i.id}${i.variant ? '(' + i.variant + ')' : ''}@${i.startPos}-${i.endPos}`;
    const lost = [], dropped = []; let checked = 0;
    for (const base of bases) {
      const names = base.split(' '), last = table.byName(names[names.length - 1]);
      const r0 = analyze(board(base), table), k0 = new Set(r0.instances.map(key));
      for (const p of table.pieces()) {
        if (p.rootPc !== last.rootPc || p.name === last.name) continue;
        const r1 = analyze(board(`${base} ${p.name}`), table), k1 = new Set(r1.instances.map(key));
        checked++;
        const gone = [...k0].filter((k) => !k1.has(k));
        if (gone.length) lost.push(`${base} + ${p.name}: ${gone.join(', ')}`);
        if (r1.score.total < r0.score.total - 20) dropped.push(`${base} + ${p.name}: ${r1.score.total - r0.score.total}`);
      }
    }
    t.ok(`終止・進行のあとに、同じルートの別の和音を足しても（${checked} 通り）、元の技は、1つも消えない`, checked > 30 && lost.length === 0, lost.slice(0, 3).join(' / '));
    t.ok('同じルートの別の和音を足しても、点は 20 より下がらない（同じ和音をそのまま続けると、「同じ和音が続く」の減点が付く。それは別）', dropped.length === 0, dropped.slice(0, 3).join(' / '));
    // 同じ和音をそのまま続けたときだけ、減点（−20 と、役に立っていない駒 −15）が付く。技は消えない
    t.ok('同じ和音をそのまま続ける（ⅠM7 ⅠM7）と、「同じ和音が続く」の指摘（−20）が付く。終止は、消えない', has('ⅣM7 Ⅴ7 ⅠM7 ⅠM7', 'authentic_cadence') && analyze(board('ⅣM7 Ⅴ7 ⅠM7 ⅠM7'), table).critiques.some((c) => /^same\|/.test(c.id) && c.points === -SENSE.dup));
    // フレーズの終わりに着かない（ちがうルートの和音が、同じフレーズのうちに続く）終止は、いままでどおり、終止ではない
    t.ok('ちがうルートの和音（Ⅱm7）が続くと、フレーズの終わりに着かないので、終止ではない（設計どおり）', !has('ⅣM7 Ⅴ7 ⅠM7 Ⅱm7', 'authentic_cadence'));
    t.ok('4番に着く終止は、5番に何があっても、そのまま決まる（フレーズが、ちがう）', has('Ⅳ Ⅴ7 Ⅰ Ⅰ7 Ⅱm7', 'authentic_cadence') && has('ⅣM7 Ⅴ7 Ⅰ - Ⅱm7', 'authentic_cadence'));
  }
}
