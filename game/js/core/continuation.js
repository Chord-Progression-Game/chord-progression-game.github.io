// 「このあと、この和音が来るのは、自然か」の判定（ヒント用。2026-11-24）。
//   ヒントが、不自然な候補（たとえば、Ⅲ7 のあとの Ⅲ♭m6 や、3番目の Ⅵ（長三和音））を出さないための、ものさし。
//   技の判定・点数には、使わない（技の定義は tricks.js、加点・減点は sense.js。ここは、ヒントの順位と、足切りだけ）。
//
//   自然さ level:
//     3 = いつもの流れ（ふつうの進行の、いちばん自然な続き）
//     2 = よくある流れ（ときどき使われる続き・道具立てのある、自然な動き）
//     1 = ときどき使われる流れ（まれ・発見の候補）
//     0 = 不自然（ヒントには出さない。名前のついた進行の途中・技が決まる駒は、別に扱う）
//
//   ものさしの出どころ:
//     ・ふつうの（その調の音だけでできた）和音どうしは、Piston『Harmony』の「ふつうの根音進行の表」（Table of Usual Root Progressions）
//       「ⅠはⅣかⅤへ。ときにⅥ。まれにⅡかⅢ」「ⅡはⅤへ。ときにⅣかⅥ。まれにⅠかⅢ」…の表。Ⅰ・Ⅱの行は、その表を紹介したウェブの文章で確かめた。
//       Ⅲ〜Ⅶの行は、教科書の表を覚えているとおりに書いたもの（この作業では、確かめていない。docs/theory_audit.md の 10章）
//     ・色のついた和音（セカンダリードミナント・借用和音・裏コード・経過のディミニッシュなど）は、「どこへ向かう和音か」「どこから来るのが自然か」の
//       決まり（ジャズ・ポピュラーの和声の入門書で、ふつうに書かれていること）で決めた。数字（3・2・1）は、順位をつけるための仮の値
// DOM に触れない。

import { isBorrowed, isSus, isSusResolution, isIvPlain, isMinorIv, naturalAfterBorrowed, borrowKey } from './sense.js';
import { isLineCliche } from './tricks.js';

// 音階の音（主音からの半音）→ 度数の番号（Ⅰ = 0 … Ⅶ = 6）。音階の外のルートは、ない
export const DEGREE_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const DOM_TYPES = ['dom7'];

// Piston の「ふつうの根音進行の表」: USUAL[いまの度数][次の度数] = 3（ふつうは）/ 2（ときに）/ 1（まれに）。ないものは 0
export const USUAL = [
  /* Ⅰ */ { 3: 3, 4: 3, 5: 2, 1: 1, 2: 1 },
  /* Ⅱ */ { 4: 3, 3: 2, 5: 2, 0: 1, 2: 1 },
  /* Ⅲ */ { 5: 3, 3: 2, 1: 1, 4: 1 },
  /* Ⅳ */ { 4: 3, 0: 2, 1: 2, 2: 1, 5: 1 },
  /* Ⅴ */ { 0: 3, 3: 2, 5: 2, 1: 1, 2: 1 },
  /* Ⅵ */ { 1: 3, 4: 3, 2: 2, 3: 2, 0: 1 },
  /* Ⅶ */ { 2: 3, 0: 2 },
];

export const LEVEL_LABEL = ['', 'ときどきある流れ', 'よくある流れ', 'いつもの流れ'];

const isMin = (c) => c.type === 'min' || c.type === 'min7';
const isMajish = (c) => c.type === 'maj' || c.type === 'maj7';
const degOf = (c) => (c && !c.isRepeat ? DEGREE_INDEX[c.rootPc] : undefined);
const DEG_NAME = { 0: 'Ⅰ', 2: 'Ⅱ', 4: 'Ⅲ', 5: 'Ⅳ', 7: 'Ⅴ', 9: 'Ⅵ', 11: 'Ⅶ' };

// 和音の「種類わけ」（自然さの判定用）
//   dia = その調の音だけでできた和音（サスをのぞく）/ sus / secdom = セカンダリードミナント（ドミナント7th。Ⅰ7・Ⅱ7・Ⅲ7・Ⅵ7）
//   tritone = 裏コード（Ⅱ♭7）/ borrowed = 借用和音（Ⅳm7・Ⅳm6・Ⅶ♭7・Ⅵ♭M7・Ⅲ♭M7・Ⅱ♭M7・Ⅲ♭m6）/ dim = ディミニッシュ / other = そのほか
export function kindOf(c) {
  if (!c || c.isRepeat) return null;
  if (isSus(c)) return 'sus';
  if (c.type === 'dim7' || c.type === 'dim') return 'dim';
  if (c.colour === 0 && degOf(c) !== undefined) return 'dia';
  if (c.type === 'dom7' && c.rootPc === 1) return 'tritone';
  if (isBorrowed(c)) return 'borrowed';
  if (DOM_TYPES.includes(c.type) && [0, 2, 4, 9].includes(c.rootPc)) return 'secdom';
  return 'other';
}

// セカンダリードミナントが向かう先のルート（4度上）。その調の音なら、度数の番号。そうでなければ undefined
const targetRoot = (c) => (c.rootPc + 5) % 12;

// ベースの階段（ルートが全音・半音ずつ、同じ向きに動く 3つの和音）か
function isStairs(a, b, c) {
  const d1 = (b.rootPc - a.rootPc + 12) % 12, d2 = (c.rootPc - b.rootPc + 12) % 12;
  const up = (d) => d === 1 || d === 2, down = (d) => d === 10 || d === 11;
  return (up(d1) && up(d2)) || (down(d1) && down(d2));
}

// ピカルディ終止（短調の主和音 Ⅵm で終えるところを、長三和音 Ⅵ で終える）の「直前」になれる和音（tricks.js の PICARDY_FROM と同じ）
// Ⅵsus4 → Ⅵ（サスつきのピカルディ終止）の入り口にしてよい和音: Ⅴ系・Ⅲ7（Ⅵm へのドミナント）。Ⅱm・Ⅵm は、Ⅵ（長三和音）への直前にはなれるが、サスの入り口には勧めない
const picardySusFrom = (c) => (c.rootPc === 4 && c.type === 'dom7') || (c.rootPc === 7 && ['maj', 'dom7', 'sus47'].includes(c.type));
const picardyFrom = (c) => (c.rootPc === 4 && c.type === 'dom7') || (c.rootPc === 7 && ['maj', 'dom7', 'sus47'].includes(c.type)) || (c.rootPc === 2 && isMin(c)) || (c.rootPc === 9 && (isMin(c) || c.type === 'sus4' || c.type === 'sus47'));

// prev のあとに y が来るのは、どのくらい自然か。{ level, kind, why }（前の和音がないときは null）
//   ctx: { prevPrev: その前の和音, phraseEnd: y が、フレーズの終わり（4番・8番）に置かれるか, phraseThird: y が、フレーズの終わりの1つ前（3番・7番）に置かれるか }
export function continuationGrade(prev, y, ctx = {}) {
  if (!prev || !y || prev.isRepeat || y.isRepeat) return null;
  const R = (level, kind, why) => ({ level, kind, why });
  const kp = kindOf(prev), ky = kindOf(y);
  const dp = degOf(prev), dy = degOf(y);
  const usual = dp !== undefined && dy !== undefined ? (USUAL[dp][dy] || 0) : 0;
  const pp = ctx.prevPrev || null;
  const stairs = !!pp && !pp.isRepeat && isStairs(pp, prev, y) && dy !== undefined && degOf(pp) !== undefined && dp !== undefined;
  const bump = (g) => (stairs && g.level < 1 ? R(1, 'stairs', 'ルートが階段のように動き続ける') : g);

  // ---- 1. 前の和音が、特別な和音のとき: その解決を見る ----
  if (isSusResolution(prev, y)) return R(3, 'sus', 'サス（4度の音）が、3度の音へ解決する');
  if (kp === 'dim') {
    // 経過のディミニッシュ（Ⅴ#dim7）: Ⅴ → Ⅴ#dim7 → Ⅵm（のぼる）・Ⅵm → Ⅴ#dim7 → Ⅴ（くだる）。来た方向の、反対がわへ進む
    const from = pp && !pp.isRepeat ? pp.rootPc : null;
    const up = (prev.rootPc + 1) % 12, down = (prev.rootPc + 11) % 12;
    if (from === down && y.rootPc === up) return R(2, 'passing', '半音ずつ上へ動く経過のディミニッシュの、行き先');
    if (from === up && y.rootPc === down) return R(2, 'passing', '半音ずつ下へ動く経過のディミニッシュの、行き先');
    if (from === null && (y.rootPc === up || y.rootPc === down) && y.colour === 0) return R(1, 'passing', '経過のディミニッシュの、行き先');
    return R(0, 'none', '');
  }
  if (kp === 'tritone') return isMajish(y) && y.rootPc === 0 ? R(3, 'tritone', '裏コード（♭Ⅱ7）が、半音下の Ⅰ へ解決する') : R(0, 'none', '');
  if (kp === 'borrowed') {
    if (y.rootPc === prev.rootPc) return isLineCliche([{ chord: prev }, { chord: y }]) ? R(1, 'cliche', '同じルートのまま、内側の声が半音で動く') : R(0, 'none', '');
    if (!naturalAfterBorrowed(prev, y)) return R(0, 'none', '');
    const classic = isMinorIv(prev) && (y.rootPc === 0 || y.rootPc === 7) && y.colour === 0;
    return classic ? R(3, 'sdm', 'サブドミナントマイナー（Ⅳm）から、Ⅰ・Ⅴ へ、せつなく着地する') : R(2, 'borrowed', '借りてきた和音から、自然に着地する');
  }
  if (kp === 'other') {
    if (prev.rootPc === 9 && prev.type === 'maj') return y.rootPc === 2 && isMin(y) ? R(3, 'secdom', 'Ⅵ（長三和音）は、Ⅱm へ向かうドミナント') : R(0, 'none', '');
    if (prev.rootPc === 6) return y.rootPc === 7 && y.colour === 0 ? R(2, 'passing', 'Ⅳ#m7♭5 は、半音上の Ⅴ へ進む（経過の和音）') : R(0, 'none', '');
    if (prev.rootPc === 7 && prev.type === 'min7') return y.rootPc === 0 && y.type === 'dom7' ? R(3, 'two_five', 'Ⅴm7 → Ⅰ7 は、Ⅳ へのツーファイブ') : (y.rootPc === 0 && isMajish(y) ? R(1, 'modal', 'Ⅴm7 → Ⅰ は、ミクソリディアンの響き') : R(0, 'none', ''));
    return R(0, 'none', '');
  }

  // ---- 2. 同じルート（色のちがい）----
  if (y.rootPc === prev.rootPc) {
    if (isIvPlain(prev) && isMinorIv(y)) return R(2, 'sdm', '同じ Ⅳ を、短調の響きに変えて、せつなくする（サブドミナントマイナー）');
    if (y.rootPc === 9 && y.type === 'maj' && (isMin(prev) || prev.type === 'sus4') && ctx.phraseEnd) return R(2, 'picardy', 'フレーズの終わりを、長三和音の Ⅵ で明るく終える（ピカルディ終止）');
    if (isLineCliche([{ chord: prev }, { chord: y }])) return R(1, 'cliche', '同じルートのまま、内側の声が半音で動く（クリシェ）');
    return R(0, 'none', '');
  }

  // ---- 3. y が、その調の音だけでできた和音 / サス ----
  if (ky === 'dia' || ky === 'sus') {
    if (kp === 'secdom') {                                                                  // セカンダリードミナントのあと: 向かう先（4度上）だけ。ほかへは、進まない
      if (ky === 'sus' && y.rootPc === 9 && !ctx.phraseThird) return bump(R(0, 'none', ''));         // Ⅵsus4 は、ピカルディ終止の1つ前（3番・7番）だけ
      if (y.rootPc === targetRoot(prev)) return R(ky === 'sus' ? 2 : 3, 'secdom', `${prev.name} の解決先（4度上）`);
      return bump(R(0, 'none', ''));
    }
    if (ky === 'sus') {
      if (y.rootPc === 7) return bump(R(Math.min(prev.rootPc === 2 || prev.rootPc === 5 ? 2 : 1, usual), 'usual', 'Ⅴ のサス（先のばし）'));       // サスの Ⅴ は、Ⅱm・Ⅳ のあと（サブドミナントから）が、いちばん自然
      // Ⅵsus4: ピカルディ終止の、1つ前（3番・7番）だけ
      if (y.rootPc === 9 && ctx.phraseThird && picardySusFrom(prev)) return R(2, 'picardy', 'Ⅵsus4 のあと Ⅵ へ解決して、ピカルディ終止へ');
      return R(0, 'none', '');
    }
    // ふつうの和音から、ふつうの和音へ: Piston の表
    if (dp !== undefined && dy !== undefined) return bump(R(usual, 'usual', usual ? `${LEVEL_LABEL[usual]}（ルートの動き）` : ''));
    return R(0, 'none', '');
  }

  // ---- 4. y が、セカンダリードミナント（ドミナント7th）----
  if (ky === 'secdom') {
    const tgt = targetRoot(y);
    if (prev.rootPc === tgt) return R(0, 'none', '');                                     // 向かう先の和音から、もどってくる（Ⅳ → Ⅰ7 など）: 不自然
    if (isMin(prev) || prev.type === 'min7b5') {
      if (prev.rootPc === (y.rootPc + 7) % 12) {                                          // prev が、y の「ツー」（ツーファイブ）
        return R(prev.type === 'min7b5' ? 3 : 2, 'two_five', `${prev.name} → ${y.name} は、ツーファイブの形`);
      }
    }
    if ((kp === 'secdom' || kp === 'dia') && prev.type === 'dom7' && (prev.rootPc + 5) % 12 === y.rootPc) return R(kp === 'secdom' ? 2 : 1, 'chain', 'ドミナントが4度ずつ連なる（連鎖するドミナント）');       // Ⅲ7 → Ⅵ7 → Ⅱ7 → Ⅴ7 の連鎖は、よくある流れ。Ⅴ7 → Ⅰ7 は、まれ
    if ((prev.fn === 'T' || prev.fn === 'SD') && usual >= 1 && DEGREE_INDEX[tgt] !== undefined) return bump(R(usual >= 2 ? 2 : 1, 'secdom', `${y.name} は、次の ${DEG_NAME[tgt]} 系の和音へ向かうセカンダリードミナント`));
    return R(0, 'none', '');
  }

  // ---- 5. y が、裏コード（Ⅱ♭7）----
  if (ky === 'tritone') return isMin(prev) && prev.rootPc === 2 ? R(2, 'tritone', 'ツーファイブの Ⅴ7 を、半音上の Ⅱ♭7 に置きかえる（裏コード）') : R(0, 'none', '');

  // ---- 6. y が、借用和音 ----
  if (ky === 'borrowed') {
    const key = borrowKey(y);
    if (isMinorIv(y)) return prev.rootPc === 0 ? R(1, 'borrowed', 'Ⅰ のあと、短調の響きの Ⅳm へ') : R(0, 'none', '');
    //   Ⅰ・Ⅳ のあとの ♭Ⅶ・♭Ⅵ・♭Ⅱ は、フレーズの終わりの1つ前（3番・7番）だけ（そのあと Ⅰ か Ⅴ へ着地する形。どこでも出すと、発展の枠が、いつも借用和音でうまってしまう）
    if (key === 'Ⅶ♭7') return (isIvPlain(prev) || prev.rootPc === 0) && ctx.phraseThird ? R(1, 'borrowed', '♭Ⅶ（ミクソリディアンの響き）。このあと Ⅰ へ') : R(0, 'none', '');
    if (key === 'Ⅵ♭M7') return (prev.rootPc === 7 && ['maj', 'dom7', 'sus47'].includes(prev.type)) ? R(2, 'deceptive', 'Ⅴ → ♭Ⅵ（借用の偽終止）') : (prev.rootPc === 0 && ctx.phraseThird ? R(1, 'borrowed', 'Ⅰ のあと、♭Ⅵ へ。このあと ♭Ⅶ → Ⅰ') : R(0, 'none', ''));
    if (key === 'Ⅱ♭M7') return [0, 2, 5, 9].includes(prev.rootPc) && prev.colour === 0 && ctx.phraseThird ? R(1, 'neapolitan', 'ネアポリタン（♭Ⅱ）。このあと Ⅴ → Ⅰ') : R(0, 'none', '');
    return R(0, 'none', '');
  }

  // ---- 7. y が、そのほかの色のついた和音 ----
  if (y.rootPc === 9 && y.type === 'maj') return ctx.phraseEnd && picardyFrom(prev) ? R(2, 'picardy', 'フレーズの終わりを、長三和音の Ⅵ で明るく終える（ピカルディ終止）') : R(0, 'none', '');       // Ⅵ（長三和音）: フレーズの終わりだけ
  if (ky === 'dim') return (prev.rootPc === 7 || prev.rootPc === 9) ? R(1, 'passing', 'Ⅴ と Ⅵ のあいだの、経過のディミニッシュ') : R(0, 'none', '');
  if (y.rootPc === 6 && y.type === 'min7b5') return isIvPlain(prev) ? R(1, 'passing', 'Ⅳ から Ⅴ へ、半音ずつ動く経過の和音') : R(0, 'none', '');
  if (y.rootPc === 7 && y.type === 'min7') return prev.rootPc === 9 && isMin(prev) ? R(1, 'passing', 'Ⅵm7 → Ⅴm7 → Ⅰ7（ルートが2度ずつ下がる）') : R(0, 'none', '');
  return R(0, 'none', '');
}
