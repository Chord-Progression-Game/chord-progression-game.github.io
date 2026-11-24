// ジャッジ（講評）: 名前のついた技にならなくても、「耳に馴染む・進行感がある」並びには加点し、
// 「進行感がない・唐突」な並びには減点・指摘をする。決まりごとは、ここだけに書く（仕様は docs/judge_report.md）。
//   ・ルールで決める（学習したものではない）。条件も点数も、下の表のとおり。理由の文章も、条件から作る
//   ・すでに、名前のついた技が取ったつながり（claimed）では、重ねて加点しない（二重に数えない）
//   ・ヒント（hints.js）も、同じ「自然さ」の考え方（edgeInfo / flowReason）を使う
//   ・加点の規則: G1 階段 / G2 機能のながれ / G3 導音の解決 / G4 なめらかな声 / G5 サス（sus4）の解決（2026-11-17）/ G6 フレーズの終わりの「解決」（2026-11-17）/ G7 内声の半音の動き（2026-11-23。2026-11-24 に、どの声でも半音で動けば、に広げた）。
//     減点: B1 進行感なし / B2 唐突な借用和音。指摘（0点）: B4 役に立っていない駒（2026-11-24。盤の外から、analyze が足す。第10弾で、減点をやめた）。※ 同じ和音が続く = 「→」と同じ扱い（tricks.js の buildSegments が1つにまとめる）ので、減点はない（B3 は、2026-11-24 に削除）
//   ・G7（内声の半音の動き）だけは、技が取ったつながりにも付ける。技（強進行など）は、ルート（ベース）の動きを見ていて、G7 は、内側の声の動きを見ているため（別の観点）
// DOM に触れない。

import { chordRoles, pcName } from './chordbook.js';

export const SENSE = {
  goodCap: 320,        // 加点の合計の上限（1つの盤）。2026-11-23 に、内声の加点（G7）のぶん、240 → 320
  badCap: 160,         // 減点の合計の上限（2026-11-24 に、120 → 160。第10弾で、役に立っていない駒の減点をやめたので、いまは、進行感なし・唐突な借用和音の合計の上限）
  stairs: { 3: 60, 4: 90, 5: 120 },     // ベースラインの階段: 3つ・4つ・5つ以上の和音
  flowSDT: 50,         // サブドミナント → ドミナント → トニック
  flowTSD: 30,         // トニック → サブドミナント → ドミナント
  leading: 40,         // 導音（Ⅶ）の解決
  susResolve: 40,      // サス（sus4）の解決: Ⅴsus47 → Ⅴ7 のように、4度の音（内声）が、半音さがって、3度の音へ
  guideTone: 30,       // ガイドトーンの半音進行（G7）: 前の和音の7度の音が、半音動いて、次の和音の3度の音へ（Ⅱm7 → Ⅴ7 の「ド → シ」・Ⅴ7 → Ⅰ の「ファ → ミ」）。1つのつながりにつき
  semitone: 20,        // そのほかの、声の半音の動き（G7）: 前の和音にあって次の和音にない音が、半音で、次の和音にだけある音へ（ⅠM7 → Ⅰ7 の「シ → シ♭」・Ⅴ7 → Ⅰ の「シ → ド」）。1つのつながりにつき
  linkMore: 10,        // 同じつながりで、半音で動く声が2つ以上あるとき、1つふえるごとの上乗せ
  linkCap: 50,         // 1つのつながりの、内声の加点の上限
  chromatic: 40,       // 半音で動き続ける内声（G7）: ルートが動く線。内側の声が、3つ以上の和音で、同じ向きに、半音ずつ動く（Ⅳ → Ⅳm7 → Ⅰ の「ラ → ラ♭ → ソ」など）。盤に、最大2回
  innerCap: 120,       // 内声の加点（G7）の合計の上限（1つの盤）。2026-11-24 に、100 → 120
  resolve: 60,         // 解決: フレーズの終わり（4番・8番、またはその後に駒がない）を、安定したトニック（Ⅰ系・Ⅵm系）で終える。盤に、最大2回
  smooth: 40,          // なめらかな声の動き（3つ以上の和音で、どのつながりも共通音が2つ以上）
  incoherent: 40,      // 進行感なし（3つ以上の和音で、どのつながりも「理由」がない）
  abrupt: 30,          // 唐突な借用和音
};

const SCORE_COLORS = { good: '#86c79a', bad: '#e0674d', note: '#aaa393' };

// ---------- 和音の仲間わけ ----------
export const isTonic = (c) => !c.isRepeat && c.rootPc === 0 && (c.type === 'maj' || c.type === 'maj7');       // Ⅰ・ⅠM7
export const isTonicFamily = (c) => isTonic(c) || (!c.isRepeat && c.rootPc === 0 && c.type === 'dom7');       // Ⅰ・ⅠM7・Ⅰ7
// 「解決」の着地点: 安定したトニック。Ⅰ・ⅠM7（Ⅰ系）と、Ⅵm・Ⅵm7（Ⅵm系）。Ⅰ7・Ⅵ7（次のコードを引っぱる、セカンダリードミナント）と、Ⅵ（長三和音。ピカルディ終止の着地点）は、含めない
export const isStableTonic = (c) => !c.isRepeat && ((c.rootPc === 0 && (c.type === 'maj' || c.type === 'maj7')) || (c.rootPc === 9 && (c.type === 'min' || c.type === 'min7')));
export const isDominantV = (c) => !c.isRepeat && c.rootPc === 7 && (c.type === 'maj' || c.type === 'dom7' || c.type === 'sus47');   // Ⅴ・Ⅴ7・Ⅴsus47
export const isIvPlain = (c) => !c.isRepeat && c.rootPc === 5 && (c.type === 'maj' || c.type === 'maj7');    // Ⅳ・ⅣM7
// 駒の「名前」ではなく、ルートと種類で決める（自作コード・編集したコードも、同じように判定するため。もとの駒では、名前で決めたときと、同じ結果）
export const isMinorIv = (c) => !c.isRepeat && c.rootPc === 5 && (c.type === 'min7' || c.type === 'min6' || c.type === 'min');          // サブドミナントマイナー（Ⅳm系: Ⅳm7・Ⅳm6。自作の Ⅳm も）
// サス（sus4）の和音と、その解決先（同じルートの、長三和音・属七の和音）。Xsus4（Xsus47）→ X（X7）で、4度の音が、半音さがって、3度の音へ動く
export const isSus = (c) => !c.isRepeat && (c.type === 'sus47' || c.type === 'sus4');
export const isSusResolution = (a, b) => isSus(a) && !b.isRepeat && b.rootPc === a.rootPc && (b.type === 'maj' || b.type === 'dom7');
// ---------- フレーズの終わり（終止・解決の位置の決まり）----------
//   seg[idx] が、フレーズの終わりか。次のどれか:
//     ① いちばん最後の駒（その後に続く駒がない）
//     ② 4番・8番に着く駒（分割したマスの前半は、そのマスの終わりではない。後半が続くため）
//     ③ 同じフレーズの中で、そのあとに「同じルートの和音」だけが続いて、①か②に着く（2026-11-24）
//   ③ は、終止のあとに、同じ和音の色ちがい（Ⅰ → ⅠM7 → Ⅰ7 など）を足して、トニックを引きのばしても、終止がなくならないようにするため。
//   終止（Ⅴ → Ⅰ）のあとに、同じルートの和音が続くのは、「終わりの和音を、色を変えながらのばしている」だけで、終わっていることは変わらない。
//   ルートの違う和音が続くときは、そこで、別の動きが始まっているので、終止ではない（フレーズの終わりに着いた駒だけが、終止になる）
export function endsPhrase(seg, idx, phrase = 4) {
  const atEnd = (k) => k === seg.length - 1 || (seg[k].last % phrase === phrase - 1 && seg[k].half !== 0);
  if (atEnd(idx)) return true;
  const root = seg[idx].chord.rootPc;
  const bar = Math.floor(seg[idx].last / phrase);
  for (let k = idx + 1; k < seg.length; k++) {
    const e = seg[k];
    if (e.blocked || e.chord.isRepeat || e.chord.rootPc !== root || Math.floor(e.first / phrase) !== bar) return false;
    if (atEnd(k)) return true;
  }
  return false;
}

// ---------- 内声の半音の動き（G7）----------
//   内声 = ルート（ベースの音）以外の、和音の構成音。ガイドトーン = 3度の音と 7度の音（和音の性格を決める音）
const pcOf = (c, roles) => { const r = chordRoles(c).find((t) => roles.includes(t.role)); return r ? r.pc : null; };
export const seventhPc = (c) => pcOf(c, ['bb7', 'b7', '7']);
export const thirdPc = (c) => pcOf(c, ['b3', '3']);
const isSemitone = (p, q) => { const d = (((p - q) % 12) + 12) % 12; return d === 1 || d === 11; };
const innerPcs = (c) => (c.isRepeat ? [] : c.pcs.filter((p) => p !== c.rootPc));
// ガイドトーンの半音進行: a の 7度の音が、b の 3度の音へ、半音で動く。あれば { from, to }（主音からの半音）
export function guideToneMove(a, b) {
  if (!a || !b || a.isRepeat || b.isRepeat) return null;
  const s = seventhPc(a), t = thirdPc(b);
  return s !== null && t !== null && isSemitone(s, t) ? { from: s, to: t } : null;
}
// 声の半音の動き（2026-11-24）: a にあって b にない音が、半音で、b にだけある音へ動く。声が1つ動くごとに、{ from, to, guide }（主音からの半音。guide = ガイドトーン: 7度 → 3度）
//   ルートどうし（ベースの半音の動き。強進行でない半音下・階段）は、技・ジャッジの階段が見ているので、数えない。1つの音は、1回だけ使う
export function semitoneLinks(a, b) {
  if (!a || !b || a.isRepeat || b.isRepeat) return [];
  const aOnly = a.pcs.filter((p) => !b.pcs.includes(p));
  const bOnly = b.pcs.filter((p) => !a.pcs.includes(p));
  const s7 = seventhPc(a), t3 = thirdPc(b);
  const used = new Set();
  const out = [];
  for (const x of aOnly) {
    const y = bOnly.find((q) => !used.has(q) && isSemitone(x, q) && !(x === a.rootPc && q === b.rootPc));
    if (y === undefined) continue;
    used.add(y);
    out.push({ from: x, to: y, guide: x === s7 && y === t3 });
  }
  return out.sort((p, q) => (q.guide ? 1 : 0) - (p.guide ? 1 : 0));
}
// 内声が、半音ずつ、同じ向きに動き続ける線（3つ以上の和音）。chords: 並びの和音。戻り値: [{ from: 最初の和音の番号, steps: 動いた数, pcs: 音の高さの並び }]（見つかった、いちばん長い線ごとに1つ。短い線は、長い線に含まれる）
export function chromaticLines(chords) {
  const out = [];
  for (let i = 0; i + 2 < chords.length; i++) {
    for (const x of innerPcs(chords[i])) {
      for (const d of [1, 11]) {
        const prevHas = i > 0 && !chords[i - 1].isRepeat && innerPcs(chords[i - 1]).includes((((x - d) % 12) + 12) % 12);
        if (prevHas) continue;                                                   // 1つ前の和音から続いている線の、途中: そちらで数える
        let k = 0, cur = x;
        const pcs = [x];
        while (i + k + 1 < chords.length) {
          const next = (cur + d) % 12;
          if (!innerPcs(chords[i + k + 1]).includes(next)) break;
          k++; cur = next; pcs.push(next);
        }
        if (k >= 2) out.push({ from: i, steps: k, pcs });
      }
    }
  }
  return out;
}

// 借り物の和音（短調から借りた和音・その代理）。Ⅱ♭7（裏コード）は、別の技（裏コード）なので、ここには入れない
//   borrowKey: ルートと種類から、借り物の呼び名を決める（Ⅱ♭M7・Ⅵ♭M7・Ⅶ♭7・Ⅲ♭M7・Ⅲ♭m6）。借り物でなければ null
export const SUB_NAMES = ['Ⅱ♭M7', 'Ⅵ♭M7', 'Ⅶ♭7', 'Ⅲ♭M7', 'Ⅲ♭m6'];
export function borrowKey(c) {
  if (!c || c.isRepeat) return null;
  if (c.rootPc === 1 && c.type === 'maj7') return 'Ⅱ♭M7';
  if (c.rootPc === 8 && c.type === 'maj7') return 'Ⅵ♭M7';
  if (c.rootPc === 10 && c.type === 'dom7') return 'Ⅶ♭7';
  if (c.rootPc === 3 && c.type === 'maj7') return 'Ⅲ♭M7';
  if (c.rootPc === 3 && c.type === 'min6') return 'Ⅲ♭m6';
  return null;
}
export const isSubstitute = (c) => !!borrowKey(c);
export const isBorrowed = (c) => isMinorIv(c) || isSubstitute(c);
const isIvAny = (c) => isIvPlain(c) || isMinorIv(c);

// 借り物の和音のあとに、「自然に続く」和音（これが来たら、技として加点する）
//   サブドミナントマイナー（Ⅳm系）→ Ⅰ系・Ⅴ系・Ⅵ♭M7・Ⅶ♭7・Ⅲ♭M7 / Ⅵ♭M7 → Ⅶ♭7・Ⅴ系・Ⅳm系・Ⅰ系・Ⅲ♭M7 / Ⅶ♭7 → Ⅰ系・Ⅵ♭M7・Ⅲ♭M7
//   Ⅲ♭M7 → Ⅳ系・Ⅵ♭M7・Ⅶ♭7・Ⅴ系・Ⅰ系 / Ⅲ♭m6 → Ⅱm7・Ⅱ♭M7・Ⅰ系・Ⅴ系 / Ⅱ♭M7（ネアポリタン）→ Ⅰ系・Ⅴ系
export function naturalAfterBorrowed(b, n) {
  if (!isBorrowed(b) || n.isRepeat) return false;
  const tonic = isTonicFamily(n), dom = isDominantV(n);
  const nk = borrowKey(n);
  if (isMinorIv(b)) return tonic || dom || ['Ⅵ♭M7', 'Ⅶ♭7', 'Ⅲ♭M7'].includes(nk);
  switch (borrowKey(b)) {
    case 'Ⅵ♭M7': return dom || tonic || isMinorIv(n) || ['Ⅶ♭7', 'Ⅲ♭M7'].includes(nk);
    case 'Ⅶ♭7': return tonic || ['Ⅵ♭M7', 'Ⅲ♭M7'].includes(nk);
    case 'Ⅲ♭M7': return isIvAny(n) || dom || tonic || ['Ⅵ♭M7', 'Ⅶ♭7'].includes(nk);
    case 'Ⅲ♭m6': return dom || tonic || (n.rootPc === 2 && n.type === 'min7') || nk === 'Ⅱ♭M7';
    case 'Ⅱ♭M7': return tonic || dom;
    default: return false;
  }
}

// 借り物の和音の呼び名（変種）
export const SUB_VARIANTS = { 'Ⅱ♭M7': 'ネアポリタン', 'Ⅵ♭M7': '♭Ⅵ', 'Ⅶ♭7': '♭Ⅶ', 'Ⅲ♭M7': '♭Ⅲ', 'Ⅲ♭m6': '♭Ⅲm6' };

// なめらかな声の動きのつながり: 動く声が1つだけ（ほかの声は、そのまま）。共通音が、少ないほうの和音の音数より1つ少ない（3和音なら2つ・7th の和音なら3つ）以上、かつ2つ以上
export const isSmoothPair = (a, b) => {
  const common = a.pcs.filter((p) => b.pcs.includes(p)).length;
  return common >= 2 && common >= Math.min(a.pcs.length, b.pcs.length) - 1;
};

// ---------- つながり1本の性質 ----------
const sameGroup = (a, b) => (a.fn === 'T' && b.fn === 'T') || (a.fn === 'SD' && b.fn === 'SD');
export function edgeInfo(a, b) {
  const m = (((b.rootPc - a.rootPc) % 12) + 12) % 12;                        // ルートの動き（半音。上向き）
  const common = a.pcs.filter((p) => b.pcs.includes(p)).length;             // 共通音の数
  let natural = 0, why = '';
  if (m === 5 || m === 7) { natural = 2; why = m === 5 ? 'ルートが5度下がる（強く引っぱる動き）' : 'ルートが5度上がる（やさしくつながる動き）'; }
  else if (m === 1 || m === 2 || m === 10 || m === 11) { natural = 1; why = 'ルートが階段のようになめらかに動く'; }
  else if (m === 0) { natural = 1; why = '同じルートの響きの変化'; }
  else if (m === 3 || m === 4 || m === 8 || m === 9) {
    if (common >= 2) { natural = 1; why = `共通音が${common}つあってなめらか`; }
    else if (sameGroup(a, b)) { natural = 1; why = '同じ働きの和音どうしの入れ替え'; }
  } else if (m === 6 && a.type === 'dom7' && b.type === 'dom7') { natural = 2; why = '裏コードの関係（ドミナント7th が、増4度はなれて入れ替わる）'; }
  return { m, common, natural, why };
}

// ---------- 講評（盤全体）----------
// segments: buildSegments の結果（各イベントは { chord, first, last, positions, blocked }）。claimed: 技が取ったつながりの集合（"セグメント番号:イベント番号"）
// 戻り値: [{ id, kind: 'good'|'bad'|'note', name, sub, points（±）, positions, chords, reason, color }]
export function judge(segments, claimed, opts = {}) {
  const phrase = opts.phrase || 4;                       // 1フレーズの長さ（位置の数）
  const claimedKinds = opts.kinds || new Map();          // 取られたつながり → 'generic'（ふつうの強進行・弱進行・半音下）か 'named'（名前のついた技）
  let resolved = 0;                                      // 「解決」の加点を出した数（盤に、最大2回）
  let inner = 0, lines = 0;                              // 内声の加点（G7）の合計・半音の線の数（どちらも、盤ぜんぶで数える。休みで分かれた並びをまたいで）
  const items = [];
  const push = (it) => {
    const ps = it.positions.slice().sort((a, b) => a - b);
    items.push({ color: SCORE_COLORS[it.kind], sub: null, variant: null, title: it.name, startPos: ps[0], endPos: ps[ps.length - 1], endFirst: ps[ps.length - 1], ...it });   // startPos 〜: 画面が、目印に使う（instanceKey）
  };
  segments.forEach((seg, si) => {
    const ev = seg.filter((e) => !e.blocked);
    // blocked を除いても、並びが切れないように、元の並びで見る（「？」の駒は、つながりを作らない）
    const edgeClaimed = (i) => claimed.has(`${si}:${i}`);
    const edgeBetween = (i) => !seg[i].blocked && !seg[i + 1].blocked;
    void ev;

    // ---- G1: ベースラインの階段（ルートが、半音・全音ずつ、同じ向きに動く）----
    {
      let i = 0;
      while (i + 1 < seg.length) {
        const dir = stepDir(seg, i);
        if (!dir) { i++; continue; }
        let j = i + 1;
        while (j + 1 < seg.length && stepDir(seg, j) === dir) j++;
        // i〜j が、1つの階段（和音の数 = j - i + 1）
        const n = j - i + 1;
        let anyFree = false;
        for (let k = i; k < j; k++) if (!edgeClaimed(k)) anyFree = true;
        if (n >= 3 && anyFree) {
          const pts = SENSE.stairs[Math.min(5, n)];
          const roots = seg.slice(i, j + 1).map((e) => e.chord.name);
          push({ id: `stairs|${si}|${i}`, kind: 'good', name: dir > 0 ? 'ベースラインの階段（のぼる）' : 'ベースラインの階段（おりる）', points: pts, positions: seg.slice(i, j + 1).flatMap((e) => e.positions), chords: roots,
            reason: `${roots.join(' → ')}。ルートが半音・全音ずつ、${dir > 0 ? '上へ' : '下へ'}動き続けます。ベースの音が階段のように並ぶので、進んでいく感じ（進行感）が生まれます。` });
        }
        i = j;
      }
    }

    // ---- G2: 機能のながれ（3つの和音）----
    for (let i = 0; i + 2 < seg.length; i++) {
      if (seg[i].blocked || seg[i + 1].blocked || seg[i + 2].blocked) continue;
      const [a, b, c] = [seg[i].chord, seg[i + 1].chord, seg[i + 2].chord];
      if (a.isRepeat || b.isRepeat || c.isRepeat) continue;
      if (edgeClaimed(i) && edgeClaimed(i + 1)) continue;
      const fnA = a.fn, fnB = b.fn, fnC = c.fn;
      if (fnA === 'SD' && fnB === 'D' && fnC === 'T') {
        push({ id: `flow_sdt|${si}|${i}`, kind: 'good', name: '機能のながれ（おしまいへ向かう）', points: SENSE.flowSDT, positions: [seg[i], seg[i + 1], seg[i + 2]].flatMap((e) => e.positions), chords: [a.name, b.name, c.name],
          reason: `${a.name}（広がり）→ ${b.name}（緊張）→ ${c.name}（安定）。広がって緊張して安定に戻る。コード進行のいちばん基本の流れで名前のついた技にならなくても、耳に馴染みます。` });
      } else if (fnA === 'T' && fnB === 'SD' && fnC === 'D') {
        push({ id: `flow_tsd|${si}|${i}`, kind: 'good', name: '機能のながれ（盛り上がる）', points: SENSE.flowTSD, positions: [seg[i], seg[i + 1], seg[i + 2]].flatMap((e) => e.positions), chords: [a.name, b.name, c.name],
          reason: `${a.name}（安定）→ ${b.name}（広がり）→ ${c.name}（緊張）。安定から、広がって緊張へ。次に安定へ戻りたくなる、盛り上がりの流れです。` });
      }
    }

    // ---- G3: 導音（Ⅶ）の解決 ----
    for (let i = 0; i + 1 < seg.length; i++) {
      if (!edgeBetween(i) || edgeClaimed(i)) continue;
      const a = seg[i].chord, b = seg[i + 1].chord;
      if (a.rootPc === 11 && isTonic(b)) {
        push({ id: `leading|${si}|${i}`, kind: 'good', name: '導音の解決', points: SENSE.leading, positions: [...seg[i].positions, ...seg[i + 1].positions], chords: [a.name, b.name],
          reason: `${a.name} → ${b.name}。Ⅶ（シ）は半音上のⅠ（ド）へ進みたがる音（導音）。その引力どおりに解決しました。` });
      }
    }

    // ---- G4: なめらかな声の動き（共通音が多い）----
    {
      let i = 0;
      while (i + 1 < seg.length) {
        const ok = (k) => edgeBetween(k) && !seg[k].chord.isRepeat && !seg[k + 1].chord.isRepeat && isSmoothPair(seg[k].chord, seg[k + 1].chord);
        if (!ok(i)) { i++; continue; }
        let j = i + 1;
        while (j + 1 < seg.length && ok(j)) j++;
        const n = j - i + 1;
        let anyFree = false;
        for (let k = i; k < j; k++) if (!edgeClaimed(k)) anyFree = true;
        if (n >= 3 && anyFree) {
          const names = seg.slice(i, j + 1).map((e) => e.chord.name);
          push({ id: `smooth|${si}|${i}`, kind: 'good', name: 'なめらかな声の動き', points: SENSE.smooth, positions: seg.slice(i, j + 1).flatMap((e) => e.positions), chords: names,
            reason: `${names.join(' → ')}。となりの和音どうしで、動く声が1つだけ（ほかの声は、そのまま）です。音の動きが小さくて、なめらかにつながるので耳に馴染みます。` });
        }
        i = j;
      }
    }

    // ---- G5: サス（sus4）の解決（内声の動き）。Ⅴsus47 → Ⅴ（Ⅴ7）など ----
    for (let i = 0; i + 1 < seg.length; i++) {
      if (!edgeBetween(i) || edgeClaimed(i)) continue;
      const a = seg[i].chord, b = seg[i + 1].chord;
      if (!isSusResolution(a, b)) continue;
      push({ id: `sus|${si}|${i}`, kind: 'good', name: 'サス（sus4）の解決', points: SENSE.susResolve, positions: [...seg[i].positions, ...seg[i + 1].positions], chords: [a.name, b.name],
        reason: `${a.name} → ${b.name}。sus4 の「4度の音」が半音さがって「3度の音」へ。ルートと5度の音は動かず、内側の声（内声）だけがすっと動いてほどけるように解決します。` });
    }

    // ---- G6: 解決（フレーズの終わりを、安定したトニックで終える）----
    //   フレーズの終わり = 4番・8番に着く駒、またはその後に続く駒がない駒。そのあとに、同じルートの和音（Ⅰ → ⅠM7 → Ⅰ7 など）だけが続いて着くときも、終わり（終止の技と同じ決まり。endsPhrase）。
    //   名前のついた技（終止・固有進行など）が、その駒へのつながりを取っているときは、重ねて加点しない。ふつうの強進行・弱進行が取っているだけなら、加点する
    for (let i = 1; i < seg.length && resolved < 2; i++) {
      const isEnd = endsPhrase(seg, i, phrase);
      if (!isEnd || !edgeBetween(i - 1)) continue;
      const a = seg[i - 1].chord, b = seg[i].chord;
      if (!isStableTonic(b) || a.rootPc === b.rootPc) continue;                      // 同じルートの、響きの変化は、解決ではない
      if (claimedKinds.get(`${si}:${i - 1}`) === 'named') continue;
      resolved++;
      const fam = b.rootPc === 0 ? 'Ⅰ（トニック）' : 'Ⅵm（トニックの仲間。トニックの代理）';
      push({ id: `resolve|${si}|${i}`, kind: 'good', name: '解決', points: SENSE.resolve, positions: [...seg[i - 1].positions, ...seg[i].positions], chords: [a.name, b.name],
        reason: `${a.name} → ${b.name}。フレーズの終わりを ${fam} で終えました。広がりや緊張から安定した和音へ着地して、ひと区切りついた感じ（解決）があります。${b.rootPc === 9 ? 'Ⅵm は Ⅰ の代わりに終われる少し切ない着地です。' : ''}` });
    }

    // ---- G7: 内声の半音の動き（2026-11-23。2026-11-24 に、同じルートの色の変化にも広げた）----
    //   ルート（ベース）の動きとは別に、内側の声が、半音でなめらかにつながる、効果的なつながり。どれも、技が取ったつながりにも付く（技は、ルートの動きを見ているため）
    //   ・ガイドトーンの半音進行 +30: 強進行（ルートが5度下がる）のつながりで、前の和音の7度の音が、半音動いて、次の和音の3度の音へ（Ⅱm7 → Ⅴ7 の ド → シ・Ⅴ7 → ⅠM7 の ファ → ミ）
    //   ・同じルートの色の変化 +20: ルートは動かず、内側の声が、半音で動く（ⅠM7 → Ⅰ7 の シ → シ♭・Ⅳ → Ⅳm の ラ → ラ♭）。ルートが動かない分、内声の動きがよく聞こえる（クリシェの1歩め）
    //   ・同じつながりで、半音で動く声が2つ以上なら、1つふえるごとに +10（1つのつながりで、上限 50）
    //   ・半音で動き続ける内声 +40: 3つ以上の和音で、同じ声が、同じ向きに、半音ずつ動く（Ⅳ → Ⅳm7 → Ⅰ の ラ → ラ♭ → ソ・丸サ進行 ⅣM7 → Ⅲ7 → Ⅵm7 の ラ → ソ♯ → ソ）。盤に最大2回。
    //     同じルートのままの線（クリシェ）は、技（クリシェ）が取るので、ここでは数えない
    //   ・内声の加点の合計は、盤で 120 まで
    //   ルートが動いていて、ガイドトーンでもない半音の動きは、数えない（ランダムに並べても、たまたま半音で動くことは多いので、「効果的」なものだけを数える）
    for (let i = 0; i + 1 < seg.length && inner < SENSE.innerCap; i++) {
      if (!edgeBetween(i)) continue;
      const a = seg[i].chord, b = seg[i + 1].chord;
      const links = semitoneLinks(a, b);
      const strong = (((b.rootPc - a.rootPc) % 12) + 12) % 12 === 5;                       // ガイドトーンの半音進行は、強進行（4度上 = 5度下）のつながりのときだけ（Ⅱm7 → Ⅴ7 → ⅠM7 の形）
      const guide = strong ? links.find((l) => l.guide) || null : null;
      const same = a.rootPc === b.rootPc;
      if (!links.length || (!guide && !same)) continue;
      const want = Math.min(SENSE.linkCap, (guide ? SENSE.guideTone : SENSE.semitone) + SENSE.linkMore * (links.length - 1));
      const pts = Math.min(want, SENSE.innerCap - inner);
      inner += pts;
      const moves = links.map((l) => `「${pcName(l.from)}」から「${pcName(l.to)}」`).join('・');
      push({ id: `link|${si}|${i}`, kind: 'good', name: guide ? 'ガイドトーンの半音進行' : '内声の半音の動き', points: pts, positions: [...seg[i].positions, ...seg[i + 1].positions], chords: [a.name, b.name],
        reason: guide
          ? `${a.name} → ${b.name}。${a.name} の7度の音（${pcName(guide.from)}）が、半音動いて、${b.name} の3度の音（${pcName(guide.to)}）へ。ベースの動きとは別に、内側の声（内声）が半音でなめらかにつながります。和音の性格を決める3度・7度の音（ガイドトーン）が半音で動くのは、ジャズでとても大切にされる、きれいなつながりです。${links.length > 1 ? `ほかにも、${links.filter((l) => !l.guide).map((l) => `「${pcName(l.from)}」から「${pcName(l.to)}」`).join('・')}と、半音で動く声があります。` : ''}`
          : `${a.name} → ${b.name}。ルートは動かないまま、内側の声が、${moves}と、半音で動きます。和音の色だけが変わるので、内声の動きがよく聞こえます。このまま同じ向きに半音で動き続けると、「クリシェ」になります。` });
    }
    {
      // 半音で動き続ける内声（ルートが動く線）。休み・「？」で切れない、続きの並び（切れ目をまたがない）
      let run = [];
      const flush = () => {
        const chords = run.map((e) => e.chord);
        for (const ln of chromaticLines(chords)) {
          if (lines >= 2 || inner >= SENSE.innerCap) break;
          const evs = run.slice(ln.from, ln.from + ln.steps + 1);
          if (evs.every((e) => e.chord.rootPc === evs[0].chord.rootPc)) continue;            // ルートが同じままの線は、クリシェの技が取る
          if (evs.some((e, k) => k > 0 && !e.chord.pcs.some((p) => evs[k - 1].chord.pcs.includes(p)))) continue;     // 動かない音（共通音）が1つもないつながりは、線として聞こえない
          const pts = Math.min(SENSE.chromatic, SENSE.innerCap - inner);
          lines++; inner += pts;
          const names = evs.map((e) => e.chord.name);
          push({ id: `chroma|${si}|${seg.indexOf(evs[0])}`, kind: 'good', name: '半音で動き続ける内声', points: pts, positions: evs.flatMap((e) => e.positions), chords: names,
            reason: `${names.join(' → ')}。内側の声が「${ln.pcs.map((p) => pcName(p)).join(' → ')}」と、半音ずつ同じ向きに動き続けます。ルートが動いていても、内声がなめらかな線を描くので、耳に残る、表情のある進行になります（クロマチックな内声）。` });
        }
        run = [];
      };
      for (const e of seg) { if (e.blocked || e.chord.isRepeat) flush(); else run.push(e); }
      flush();
    }

    // ---- B1: 進行感なし ----
    {
      let i = 0, runs = 0;
      while (i + 1 < seg.length) {
        const bad = (k) => edgeBetween(k) && !seg[k].chord.isRepeat && !seg[k + 1].chord.isRepeat && !edgeClaimed(k) && edgeInfo(seg[k].chord, seg[k + 1].chord).natural === 0;
        if (!bad(i)) { i++; continue; }
        let j = i + 1;
        while (j + 1 < seg.length && bad(j)) j++;
        const n = j - i + 1;
        if (n >= 3 && runs < 3) {
          runs++;
          const names = seg.slice(i, j + 1).map((e) => e.chord.name);
          push({ id: `incoherent|${si}|${i}`, kind: 'bad', name: '進行感がない', points: -SENSE.incoherent, positions: seg.slice(i, j + 1).flatMap((e) => e.positions), chords: names,
            reason: `${names.join(' → ')}。どのつながりも共通音が少なく、ルートの動きにも「つながる理由」（4度・5度・階段・入れ替え）が見つかりません。進んでいく感じ（進行感）がなく、唐突に聞こえます。間につなぎ役の和音を入れてみよう。` });
        }
        i = j;
      }
    }

    // ---- B2: 唐突な借用和音（借りてきた和音が、前後のどちらとも、つながらない）----
    {
      let cnt = 0;
      for (let i = 1; i + 1 < seg.length && cnt < 3; i++) {
        if (seg[i - 1].blocked || seg[i].blocked || seg[i + 1].blocked) continue;
        const p = seg[i - 1].chord, b = seg[i].chord, n = seg[i + 1].chord;
        if (!isBorrowed(b) || p.isRepeat || n.isRepeat) continue;
        const entryOk = edgeInfo(p, b).natural >= 1 || (isMinorIv(b) && isIvPlain(p));
        if (!entryOk && !naturalAfterBorrowed(b, n)) {
          cnt++;
          push({ id: `abrupt|${si}|${i}`, kind: 'bad', name: '唐突な借用和音', points: -SENSE.abrupt, positions: seg[i].positions.slice(), chords: [p.name, b.name, n.name],
            reason: `${p.name} → ${b.name} → ${n.name}。${b.name} は短調から借りてきた和音です。借りた和音は前の和音から自然につながるか、あとに自然な和音（Ⅰ・Ⅴなど）が続くと、効果的に聞こえます。ここはどちらともつながらず、唐突です。` });
        }
      }
    }
  });
  return items;
}

// ---- B4: 役に立っていない駒（2026-11-24。第10弾で、減点をやめた。表示だけ残す）----
//   技にも、耳に馴染むつながり（階段・機能のながれ・内声の半音の動きなど）にも、使われていない駒。盤に3つ以上の駒があるときだけ（始めの1〜2つは、まだ、つながりを作っている途中）。
//   以前は、駒をふやすだけで点がふえる「載せ得」を防ぐために、1つにつき −15 の減点だった。ご指示（2026-11-24）で、減点はなし（0点の指摘として、右の「技」の欄に出す）。
//   「載せ得」は、コードの難しさの加点が、技に使われた駒だけ・同じ和音は「→」と同じ（1つにまとまる）、で、もう起きない。analyze が、使われ方を調べたあとで呼ぶ。idle: 使われていないイベントの並び
export function idleCritique(idle) {
  const positions = idle.flatMap((e) => e.positions).sort((a, b) => a - b);
  const names = idle.map((e) => e.chord.name);
  return { id: 'idle', kind: 'note', quiet: true, name: '役に立っていない駒', points: 0, positions, chords: names, color: SCORE_COLORS.note, sub: null, variant: null, title: '役に立っていない駒',
    startPos: positions[0], endPos: positions[positions.length - 1], endFirst: positions[positions.length - 1],
    reason: `${names.join('・')}（${[...new Set(positions)].map((p) => `${p + 1}番`).join('・')}）は、技にも、耳に馴染むつながり（階段・機能のながれ・内声の半音の動きなど）にも、使われていません（減点はありません）。前後の駒と、ルートが4度・5度で動いたり、内側の声が半音で動いたりする、つながりのある駒に、かえてみよう（つながりがないと、点にはなりません）。` };
}

// 階段の向き: seg[i] → seg[i+1] のルートが、半音・全音で、上（+1）・下（-1）に動くか。そうでなければ 0
function stepDir(seg, i) {
  if (i + 1 >= seg.length || seg[i].blocked || seg[i + 1].blocked) return 0;
  const a = seg[i].chord, b = seg[i + 1].chord;
  if (a.isRepeat || b.isRepeat) return 0;
  const m = (((b.rootPc - a.rootPc) % 12) + 12) % 12;
  if (m === 1 || m === 2) return 1;
  if (m === 10 || m === 11) return -1;
  return 0;
}

// 加点・減点の合計（上限をかける）
export function senseTotals(items) {
  const good = Math.min(SENSE.goodCap, items.filter((x) => x.points > 0).reduce((s, x) => s + x.points, 0));
  const bad = Math.min(SENSE.badCap, -items.filter((x) => x.points < 0).reduce((s, x) => s + x.points, 0));
  return { good, bad };
}

// ---------- ヒント用: prev の次に y を置くと、どんな流れになるか ----------
// 戻り値: { weight, reason } または null。weight が大きいほど、おすすめ
export function flowReason(prev, y, ctx = {}) {
  if (!prev || !y || prev.isRepeat || y.isRepeat) return null;
  const e = edgeInfo(prev, y);
  const out = (weight, reason) => ({ weight, reason });
  if (isSusResolution(prev, y)) return out(6, `${prev.name} → ${y.name}: サス（4度の音）が半音さがって3度の音へ。内声がすっと解決する`);
  if (isDominantV(prev) && isTonic(y)) return out(6, `${prev.name} → ${y.name}: ほっと解決する（Ⅴ-Ⅰ）`);
  if (isDominantV(prev) && y.rootPc === 9 && (y.type === 'min' || y.type === 'min7')) return out(5, `${prev.name} → ${y.name}: Ⅰに行くと見せかけて、はぐらかす（偽終止）`);
  if (prev.rootPc === 9 && (prev.type === 'min' || prev.type === 'min7') && y.rootPc === 2 && (y.type === 'min' || y.type === 'min7')) return out(5, `${prev.name} → ${y.name}: Ⅵm → Ⅱm と、4度ずつ上がる『循環コード』（Ⅰ-Ⅵm-Ⅱm-Ⅴ）の流れ`);
  if (prev.rootPc === 2 && (prev.type === 'min' || prev.type === 'min7') && isDominantV(y)) return out(6, `${prev.name} → ${y.name}: Ⅱm → Ⅴ。ツーファイブの流れ（このあと Ⅰ へ）`);
  if (isIvPlain(prev) && isMinorIv(y)) return out(4, `${prev.name} → ${y.name}: 同じ Ⅳ を短調の響きに変えて、せつなくする（サブドミナントマイナー）`);
  if (prev.rootPc === 11 && isTonic(y)) return out(5, `${prev.name} → ${y.name}: 導音（シ）がドへ解決する`);
  if (isBorrowed(prev) && naturalAfterBorrowed(prev, y)) return out(4, `${prev.name} → ${y.name}: 借りてきた和音から、自然に着地する`);
  if (guideToneMove(prev, y)) return out(4, `${prev.name} → ${y.name}: 7度の音が半音動いて、3度の音へ（ガイドトーンの半音進行）。内声がなめらかにつながる`);
  if (prev.rootPc === y.rootPc && semitoneLinks(prev, y).length) return out(4, `${prev.name} → ${y.name}: ルートはそのまま、内側の声が半音で動く（クリシェの形）`);
  if (isTonic(prev) && y.rootPc === 9 && (y.type === 'min' || y.type === 'min7')) return out(3, `${prev.name} → ${y.name}: Ⅰ と Ⅵm は、よく似た響き（平行調）。ふんわり切り替わる`);
  if (prev.rootPc === 9 && (prev.type === 'min' || prev.type === 'min7') && isTonic(y)) return out(3, `${prev.name} → ${y.name}: Ⅵm から Ⅰ へ。せつなさから、明るさへ`);
  if (ctx.prevPrev && stepDir([{ chord: ctx.prevPrev }, { chord: prev }], 0) !== 0 && stepDir([{ chord: prev }, { chord: y }], 0) === stepDir([{ chord: ctx.prevPrev }, { chord: prev }], 0)) return out(4, `${ctx.prevPrev.name} → ${prev.name} → ${y.name}: ベースが階段のように同じ向きに動き続ける`);
  if (e.m === 5) return out(4, `${prev.name} → ${y.name}: ルートが5度下がる（強進行）。引っぱる力がある`);
  if (e.m === 7) return out(3, `${prev.name} → ${y.name}: ルートが5度上がる（弱進行）。やさしくつながる`);
  if (e.natural >= 1 && e.common >= 3) return out(2, `${prev.name} → ${y.name}: 共通音が${e.common}つ。なめらかにつながる`);
  return null;
}
