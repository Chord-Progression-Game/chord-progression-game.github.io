// ヒント: 「次に置くと、何が起きるか」の候補を、判定の部品（tricks.js）から、そのまま作る。
//   ・おすすめ（primary）: 置くと名前のついた技が決まる駒 / 名前のついた進行の「途中」になる駒
//   ・発展（advanced）: ふつうのつながりが決まる駒 / 色の濃い駒で、次に名前のついた技へつながるもの
// 手で書いた対応表ではなく、判定の定義から計算するので、技の定義を変えれば、ヒントも変わる。

import { analyze, buildSegments, isHeadV, isDominantType, PATTERNS, PHRASE, TRICKS } from './tricks.js';
import { flowReason, isDominantV, isStableTonic, isSus } from './sense.js';
import { stepFit, stepSegments, fitSummary } from './melody.js';
import { MAJOR } from './chords.js';

const trickLabel = (kind, variant) => `${TRICKS[kind].sub || TRICKS[kind].name}${variant ? `（${variant}）` : ''}`;

// セブンスコード（7度の音をもつ和音）。6th の和音（Ⅳm6 など）は、3和音でもセブンスでもない扱い
export const SEVENTH_TYPES = ['maj7', 'min7', 'dom7', 'min7b5', 'sus47', 'dim7', 'mM7'];
export const isSeventh = (c) => !!c && !c.isRepeat && SEVENTH_TYPES.includes(c.type);

// 実際の曲では、Ⅰ系と、解決先の Ⅵm を除けば、3和音よりもセブンスコードのほうが、よく使われる（2026-11-23。ユーザーの指摘）。
//   ヒントで、同じルートに「3和音」と「そのセブンスの版」（Ⅴ と Ⅴ7・Ⅳ と ⅣM7・Ⅱm と Ⅱm7 など）が候補に並んだとき、セブンスのほうを選びやすくする点。
//   ・それまでの進行（左の駒）にセブンスコードがあるときは、強く（4）。3和音ばかりのときは、弱く（0.5。技ごとの「お手本」の順番で、3和音が先に書いてあれば、そちらが勝つ）
//   ・Ⅰ系（Ⅰ・ⅠM7・Ⅰ7）と、フレーズの終わり・Ⅴのあとの Ⅵm（トニックとして着地する）は、どちらでもよい（0）
//   ・点数が大きく違う（技が決まるかどうかの違い）ときは、点数のほうを優先する（SEVEN_TIE）。たとえば、Ⅵ（長三和音）の「ピカルディ終止」と、Ⅵ7 は、別の和音として扱う
export const SEVEN_BONUS = { withSevenths: 4, plain: 0.5 };
export const SEVEN_TIE = 120;
export function sevenBonus(chord, { ctxSeventh = false, resolving = false } = {}) {
  if (!chord || chord.isRepeat || chord.rootPc === 0) return 0;
  if (chord.rootPc === 9 && (chord.type === 'min' || chord.type === 'min7') && resolving) return 0;
  return isSeventh(chord) ? (ctxSeventh ? SEVEN_BONUS.withSevenths : SEVEN_BONUS.plain) : 0;
}
// 「3和音とそのセブンスの版」の組: 同じルートで、同じ系統（長三和音と M7・属七 / 短三和音と m7 / sus4 と sus47）。Ⅴ7 は、Ⅴ の版（Ⅵ7 は、Ⅵ（長三和音）とは別の働きなので、組にしない）
export function sevenFamily(c) {
  if (!c || c.isRepeat) return null;
  if (c.type === 'maj' || c.type === 'maj7') return 'maj';
  if (c.type === 'dom7' && c.rootPc === 7) return 'maj';
  if (c.type === 'min' || c.type === 'min7') return 'min';
  if (c.type === 'sus4' || c.type === 'sus47') return 'sus';
  return null;
}
export const sameSevenFamily = (a, b) => a.rootPc === b.rootPc && sevenFamily(a) !== null && sevenFamily(a) === sevenFamily(b);

// ヒントを出す位置（次に置く場所）。左から見て、最初の「空き」で、1つ左に駒があるもの（なければ、先頭が空きなら 0）
export function findCursor(board) {
  for (let e = 0; e < board.length; e++) {
    if (board[e] === null || board[e] === undefined) {
      if (e === 0 || (board[e - 1] !== null && board[e - 1] !== undefined)) return e;
    }
  }
  return null;
}

function withChord(board, pos, id) { const b = board.slice(); b[pos] = id; return b; }

// 進行の頭（冒頭 = 1番。2026-11-18 から 5番は含めない）に勧めてよい駒（2026-11-17）: その調の音だけでできた、トニック系・サブドミナント系の和音（Ⅰ系・Ⅱm系・Ⅲm系・Ⅳ系・Ⅵm系）。
//   Ⅰ7・Ⅲ7 などのセカンダリードミナント・Ⅳm7 などの借用和音（サブドミナントマイナー）・サス・Ⅶm7♭5 は、進行の頭に置くと不自然なので、勧めない（Ⅴ は、そもそも「？」）
const openerOk = (c) => !!c && !c.isRepeat && c.colour === 0 && (c.fn === 'T' || c.fn === 'SD') && !isSus(c);

// 並びの末尾が、パターンの最初の L 個に当てはまるか（途中まで進んでいるか）
//   固有進行は、1番か5番から始まっていなければ、途中とは数えない。冒頭（1番）のドミナント系の駒（？）も、数えない
function prefixLength(pattern, evs, ctx = { phrase: PHRASE }) {
  const len = pattern.steps.length;
  for (let L = Math.min(len - 1, evs.length); L >= 2; L--) {
    const tail = evs.slice(-L);
    if (tail.some((e) => e.blocked)) continue;
    if (pattern.startAt && !pattern.startAt.includes(tail[0].first)) continue;
    if (!tail.every((e, k) => pattern.steps[k](e.chord))) continue;
    if (pattern.check && !pattern.check(tail, ctx)) continue;          // ルートの動きなどの条件も、途中まで確かめる
    return L;
  }
  return 0;
}

// 次に置く場所 pos に、駒 chord を置いたと仮定した、並びの最後のイベント
const virtualEvent = (chord, pos) => { const ev = { chord, first: pos, last: pos, positions: [pos] }; ev.blocked = isHeadV(ev); return ev; };

export function suggest(board, table, allowedIds, opts = {}) {
  const maxPrimary = opts.maxPrimary ?? 4;
  const maxAdvanced = opts.maxAdvanced ?? 5;
  const cursor = findCursor(board);
  if (cursor === null) return { cursor: null, context: [], primary: [], advanced: [] };
  const allowed = allowedIds.map((id) => table.byId(id)).filter((c) => c && !c.isRepeat);
  const before = analyze(board, table, opts);

  // 左の駒（文脈）
  const segs = buildSegments(board, table, opts.split);
  const seg = segs.find((s) => s.length && s[s.length - 1].last === cursor - 1) || [];
  const context = seg.map((e) => e.chord.name);

  let cands = [];
  const phraseEnd = cursor % PHRASE === PHRASE - 1;
  const atHead = cursor === 0;                              // 進行の頭（冒頭 = 1番）。5番は、ふつうの位置（2026-11-18）
  const phraseHead = cursor % PHRASE === 0;                 // フレーズの頭（1番・5番）
  const prevChord = seg.length ? seg[seg.length - 1].chord : null;
  const ctxSeventh = board.slice(0, cursor).concat(opts.split ? opts.split.slice(0, cursor) : []).some((id) => isSeventh(id === null || id === undefined ? null : table.byId(id)));       // それまでの進行に、セブンスコードがある（分割したマスの後半も）
  const resolving = phraseEnd || (!!prevChord && isDominantV(prevChord));                                                           // 着地する場所（フレーズの終わり・Ⅴのあと）
  const gainOf = (r) => r.score.total - r.score.levelBonus;          // 「コードの難しさ」の加点は、ヒントの順位に使わない（高いレベルの駒ばかり勧めないように）
  for (const y of allowed) {
    const b2 = withChord(board, cursor, y.id);
    const after = analyze(b2, table, opts);
    const touching = after.instances.filter((i) => i.positions.includes(cursor));
    // どのコードのあとでも成立する技（soft。偽終止の「前は何でもよい」の形）は、フレーズの終わり（4番・8番）でだけ、ヒントにする。ほかの場所では、毎回 Ⅵm が出てしまう
    const named = touching.filter((i) => !i.generic && !(i.soft && !phraseEnd));
    const generic = touching.filter((i) => i.generic);
    const virtual = seg.concat([virtualEvent(y, cursor)]);
    let best = null;                                           // 一番進んでいる、名前のついた進行
    for (const p of PATTERNS) {
      if (p.steps.length < 3) continue;
      const L = prefixLength(p, virtual);
      if (L >= 2 && (!best || L > best.L || (L === best.L && p.points > best.p.points))) best = { p, L };
    }
    let tier = 0, score = 0, reason = '';
    const progressText = best ? `${[...new Set(PATTERNS.filter((p) => p.steps.length >= 3 && prefixLength(p, virtual) === best.L).map((p) => `「${trickLabel(p.kind, p.variant)}」`))].join('')}の途中` : '';
    if (named.length) {
      const special = named.every((i) => (PATTERNS.find((p) => p.id === i.id) || {}).hintAdvanced);     // ピカルディ終止など、特別な終わり方だけのときは、「発展」に出す
      tier = special ? 2 : 1; score = (special ? 400 : 1000) + (gainOf(after) - gainOf(before));
      reason = named.map((i) => `「${trickLabel(i.kind, i.variant)}」が決まる`).join('、') + (progressText ? `。${progressText}` : '');
    } else if (best) {
      tier = best.p.advancedHint ? 2 : 1; score = (best.p.advancedHint ? 300 : 500) + best.p.points + best.L * 10;       // 借用和音の途中は、おすすめではなく、発展
      reason = progressText;
    } else if (generic.length) {
      tier = 2; score = 200 + generic.reduce((s, i) => s + i.points, 0);
      reason = generic.map((i) => `「${trickLabel(i.kind, i.variant)}」が決まる`).join('、');
    }
    if (tier) cands.push({ chord: y, tier, score, reason, pattern: best ? best.p : null, gain: gainOf(after) - gainOf(before) });
  }

  // 文脈がないとき（盤が空）や、小節の頭（1番・5番）: 名前のついた進行の「最初の駒」を出す（固有進行は、1番か5番からしか始まらない）
  if (!seg.length || cursor % PHRASE === 0) {
    for (const y of allowed) {
      if (virtualEvent(y, cursor).blocked) continue;                    // 冒頭のドミナント系の駒は、技にならない
      // 最初の駒は、パターンが「おすすめ」としている駒だけ（例: ツーファイブワンの最初は Ⅱm7。どの m7 でもよいわけではない）
      let starts = PATTERNS.filter((p) => !p.advancedHint && !p.noStartHint && p.steps.length >= 3 && p.steps[0](y) && (!p.prefer || p.prefer[0].includes(y.name)) && (!p.startAt || p.startAt.includes(cursor)));
      if (!starts.length) continue;
      const short = starts.filter((p) => p.steps.length <= 5);          // 盤を使い切る長い進行（ブルース8つ）は、最初のヒントには出さない
      if (short.length) starts = short;
      const bestP = starts.sort((a, b) => b.points - a.points)[0];
      cands.push({ chord: y, tier: 1, score: 500 + bestP.points, reason: `${[...new Set(starts.map((p) => `「${trickLabel(p.kind, p.variant)}」`))].join('')}の最初`, pattern: bestP, gain: 0, start: true });
    }
  }

  // ---- 流れのヒント（2026-11-16）: 左の駒から、自然につながる候補（フレーズの頭でも）。名前のついた技にならなくても、「耳に馴染む」つながり ----
  // すでに同じ駒の候補があれば、まとめる（理由をつなげて、強いほうの順位にする）
  const addFlow = (c) => {
    const exs = cands.filter((x) => x.chord.id === c.chord.id);
    if (!exs.length) { cands.push(c); return; }
    for (const ex of exs) {                            // 同じ駒の候補は、ぜんぶ、まとめる（あとで、1つに絞られても、流れの理由が残るように）
      if (!ex.flow) ex.reason = `${c.reason}。${ex.reason}`;
      ex.tier = Math.min(ex.tier, c.tier);
      ex.score = Math.max(ex.score, c.score);
    }
  };
  if (seg.length) {
    const prev = seg[seg.length - 1].chord, prevPrev = seg.length >= 2 ? seg[seg.length - 2].chord : null;
    for (const y of allowed) {
      if (virtualEvent(y, cursor).blocked) continue;
      const fr = flowReason(prev, y, { prevPrev });
      if (!fr) continue;
      // 強い流れ（解決・循環・ツーファイブ・偽終止・導音）は、おすすめ。フレーズの頭（5番目など）では、名前のついた進行の「最初」より、前の駒からの流れを先に出す
      if (fr.weight >= 5) addFlow({ chord: y, tier: 1, score: 800 + fr.weight * 10 + (cursor % PHRASE === 0 ? 400 : 0), reason: fr.reason, pattern: null, gain: 0, flow: true });
      else addFlow({ chord: y, tier: 2, score: 100 + fr.weight * 10, reason: fr.reason, pattern: null, gain: 0, flow: true });
    }
    // フレーズの終わりに向けて（3番目・7番目）: ドミナントを置くと、次の駒を Ⅰ にして、終止にできる
    if (cursor % PHRASE === PHRASE - 2 && !isDominantV(prev)) {
      for (const y of allowed) {
        if (!isDominantV(y)) continue;
        addFlow({ chord: y, tier: 2, score: 150, reason: `フレーズの終わりに向けて: ${y.name} を置いて次の駒（${cursor % PHRASE === 2 ? '4番' : '8番'}）を Ⅰ にすると『Ⅴ-Ⅰ終止』になる`, pattern: null, gain: 0 });
      }
    }
  }
  // フレーズの終わり（4番・8番）: Ⅰ系・Ⅵm系で終えると、「解決」の加点。名前のついた技（終止など）が、すでに決まる駒は、その理由を出すので、足さない
  if (phraseEnd && seg.length) {
    const prev = seg[seg.length - 1].chord;
    for (const y of allowed) {
      if (!isStableTonic(y) || y.rootPc === prev.rootPc || virtualEvent(y, cursor).blocked) continue;
      if (cands.some((x) => x.chord.id === y.id && x.tier === 1)) continue;
      addFlow({ chord: y, tier: 2, score: 130, reason: `フレーズの終わりを ${y.name} で終えると安定した和音へ着地して「解決」の加点`, pattern: null, gain: 0 });
    }
  }
  // ループのつなぎ目（8番目を置くとき）: 1番の駒へ、自然につながる駒
  if (cursor === board.length - 1 && board[0] !== null && board[0] !== undefined) {
    const head = table.byId(board[0]);
    if (head && !head.isRepeat) {
      for (const y of allowed) {
        const fr = flowReason(y, head);
        if (fr) addFlow({ chord: y, tier: 2, score: 90 + fr.weight * 10, reason: `ループして 1番の ${head.name} へ: ${fr.reason}`, pattern: null, gain: 0 });
      }
    }
  }

  // ---- よく使われる和音 Ⅱm7（2026-11-23。ユーザーの指摘）: フレーズの頭（1番・5番）では「おすすめ」に。ほかの場所でも、前がトニック系・サブドミナント系なら「発展」に出す ----
  //   Ⅱm7 → Ⅴ7 → ⅠM7（ツーファイブワン）の入り口で、頭にも、途中にも、よく使われる
  const ii7 = allowed.find((c) => c.rootPc === 2 && c.type === 'min7');
  let ii7Head = false;
  if (ii7 && !(prevChord && prevChord.rootPc === 2)) {
    const has = cands.find((x) => x.chord.id === ii7.id);
    const afterDom = !!prevChord && isDominantType(prevChord);
    if (phraseHead) {
      ii7Head = !afterDom;                                                  // 前がドミナントのときは、「発展」に
      if (afterDom) for (const x of cands) if (x.chord.rootPc === ii7.rootPc && ['min', 'min7'].includes(x.chord.type) && x.start && x.tier === 1) x.tier = 2;       // 名前のついた進行の「最初」としても出ているが、ドミナントのあとの頭では、おすすめにしない（Ⅴ-Ⅰ・偽終止などの流れを先に）
      if (!has || has.tier > 1) {
        addFlow({ chord: ii7, tier: afterDom ? 2 : 1, score: afterDom ? 150 : 900, pattern: null, gain: 0, flow: true,
          reason: `${ii7.name} は、進行の頭によく使われる和音。このあと Ⅴ7 → ⅠM7 とつなげると『ツーファイブワン』になる` });
      }
    } else if (!has && cursor <= PHRASE * 2 - 2 && (!prevChord || prevChord.fn === 'T' || prevChord.fn === 'SD')) {
      addFlow({ chord: ii7, tier: 2, score: 170, pattern: null, gain: 0, flow: true,
        reason: `${ii7.name} は、よく使われる和音（サブドミナントの代表）。このあと Ⅴ7 → Ⅰ とつなげると『ツーファイブワン』になる` });
    }
  }

  // ---- メロディのステージ: 次に置く場所のメロディの音に、合う和音を勧める ----
  //   ・メロディとぶつかる（相性 0.5 未満）候補は、外す / よく合う（0.8 以上）候補は、順位を上げて、理由に「メロディ: …」を足す
  //   ・進行の理由がなくても、メロディにとてもよく合う（0.85 以上）、その調の音だけでできた和音は、発展として足す
  const meloFit = opts.melody && stepSegments(opts.melody)[cursor].length ? (chord) => stepFit(opts.melody, cursor, chord) : null;     // 次に置く場所に、メロディの音があるとき: 和音との相性（-1〜1）
  if (meloFit) {
    const fit = meloFit;
    for (let i = cands.length - 1; i >= 0; i--) {
      const f = fit(cands[i].chord);
      if (f === null) continue;
      if (f < 0.5) { cands.splice(i, 1); continue; }
      if (f >= 0.8) {
        cands[i].score += 200;
        const sum = fitSummary(opts.melody, cursor, cands[i].chord);
        if (sum) cands[i].reason = `${cands[i].reason ? `${cands[i].reason} ／ ` : ''}メロディ: ${sum}`;
      }
    }
    for (const y of allowed) {
      if (cands.some((c) => c.chord.id === y.id)) continue;
      const f = fit(y);
      if (f === null || f < 0.85 || !y.pcs.every((p) => MAJOR.includes(p))) continue;
      cands.push({ chord: y, tier: 2, score: 100 + Math.round(f * 50) - y.level * 5, reason: `メロディに合う: ${fitSummary(opts.melody, cursor, y) || 'ぶつかる音がない'}`, pattern: null, gain: 0, melody: true });
    }
  }

  if (atHead) cands = cands.filter((c) => openerOk(c.chord));            // 進行の頭: セカンダリードミナントや、借用和音（サブドミナントマイナー）は、勧めない
  if (opts.debug) opts.debug(cands);                       // テスト用: まとめる前の、候補の一覧
  // ルート（高さ）ごとに、1つにまとめる。パターンの prefer にある駒を優先
  const byRoot = new Map();
  for (const c of cands) {
    const key = c.chord.rootPc;
    const cur = byRoot.get(key);
    const pref = (cc) => {
      if (!cc.pattern || !cc.pattern.prefer) return 0;
      const L = prefixLength(cc.pattern, seg.concat([virtualEvent(cc.chord, cursor)]));
      const step = Math.max(0, Math.min(cc.pattern.prefer.length - 1, (L || 1) - 1));
      const idx = cc.pattern.prefer[step].indexOf(cc.chord.name);
      return idx < 0 ? 0 : cc.pattern.prefer[step].length - idx;      // 先頭にある駒ほど、大きい
    };
    // セブンスコードを選びやすくする（sevenBonus）。同じルートの「3和音とそのセブンスの版」が、同じくらいの点数で並んだときだけ、セブンスを。ほかは、これまでどおり（お手本の順番 → 点数）
    const near = cur && sameSevenFamily(c.chord, cur.chord) && Math.abs(c.score - cur.score) <= SEVEN_TIE;
    const rank = (cc) => pref(cc) + (near ? sevenBonus(cc.chord, { ctxSeventh, resolving }) : 0);
    if (!cur || c.tier < cur.tier || (c.tier === cur.tier && (rank(c) > rank(cur) || (rank(c) === rank(cur) && c.score > cur.score)))) byRoot.set(key, c);
  }
  const picked = [...byRoot.values()].sort((a, b) => a.tier - b.tier || b.score - a.score || a.chord.level - b.chord.level);
  const primary = picked.filter((c) => c.tier === 1).slice(0, maxPrimary);
  let advanced = picked.filter((c) => c.tier === 2).slice(0, maxAdvanced);
  // フレーズの頭（1番・5番）では、Ⅱm7 を「おすすめ」に必ず入れる（4つの枠が、ほかの候補でうまっていても、いちばん弱いものと入れかえる）
  if (ii7Head && !primary.some((c) => c.chord.id === ii7.id)) {
    const mine = cands.find((x) => x.chord.id === ii7.id && x.tier === 1);
    if (mine) {
      if (primary.length < maxPrimary) primary.push(mine);
      else primary[primary.length - 1] = mine;                                  // いちばん弱いものと入れかえる
      advanced = advanced.filter((c) => c.chord.id !== ii7.id);
    }
  }

  // 発展: 色の濃い駒で、「次の1つ」で名前のついた技になるもの（例: Ⅴ7 の次に Ⅵsus4 → その次に Ⅵ でピカルディ終止）
  if (advanced.length < maxAdvanced && cursor + 1 < board.length) {
    const have = new Set([...primary, ...advanced].map((c) => c.chord.id));
    const prevRoot = seg.length ? seg[seg.length - 1].chord.rootPc : 0;
    const look = [];
    for (const y of allowed) {
      if (have.has(y.id) || !(y.minorFlavor || y.colour >= 1 || y.level >= 4)) continue;
      if (atHead && !openerOk(y)) continue;                          // 進行の頭には、勧めない
      if (meloFit && meloFit(y) < 0.5) continue;                       // メロディとぶつかる駒は、出さない
      const b2 = withChord(board, cursor, y.id);
      for (const z of allowed) {
        const after = analyze(withChord(b2, cursor + 1, z.id), table, opts);
        const hit = after.instances.find((i) => !i.generic && i.positions.includes(cursor + 1) && i.positions.includes(cursor));
        if (hit) {
          const dist = Math.min(((y.rootPc - prevRoot) + 12) % 12, ((prevRoot - y.rootPc) + 12) % 12);
          look.push({ chord: y, tier: 3, score: 100 - dist * 5 - y.level, reason: `次に ${z.name} を置くと「${trickLabel(hit.kind, hit.variant)}」`, gain: 0 });
          break;
        }
      }
    }
    look.sort((a, b) => b.score - a.score || a.chord.level - b.chord.level);
    const roots = new Set(advanced.map((c) => c.chord.rootPc));
    for (const c of look) {
      if (advanced.length >= maxAdvanced) break;
      if (roots.has(c.chord.rootPc) && advanced.length) continue;
      advanced.push(c); roots.add(c.chord.rootPc);
    }
  }
  const out = (c) => ({ id: c.chord.id, name: c.chord.name, symbol: c.chord.symbol, tier: c.tier, reason: c.reason, gain: c.gain });
  return { cursor, context, primary: primary.map(out), advanced: advanced.map(out) };
}
