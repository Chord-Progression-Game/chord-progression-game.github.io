// 和音の高さの決め方。ファーム（src/voicing.cpp と groove.cpp）と、まったく同じ規則。
//   ① 計画（2026-11-24。ご指定）: ループ全体を見て、各コードのルートの高さを、まとめて決める（planVoicing / planOctaves）。
//      ・本来の高さ（ルートが baseC〜baseC+11）と、その上下1オクターブの、3つの高さから選ぶ。最初のコードは、いつも本来の高さ
//      ・つながりの跳躍が小さく、進行全体で「低すぎる・高すぎる」ことがないように、動的計画法で、全体の費用がいちばん小さい組み合わせを選ぶ
//      ・強進行（ルートが完全4度上 = 完全5度下へ進む）は、完全4度上か、完全5度下の、どちらかだけ。どちらにするかは、全体の音域で決まる
//      ・終止（強進行で、フレーズの終わりの主和音 Ⅰ へ着く）は、完全5度下へ動くことを、優先する（4度上へ跳ぶ罰を、大きくする）。途中の主和音・Ⅵm 系への強進行（解決）は、やや優先する
//      ・ループのつなぎ目（最後 → 最初）も、費用に入れる。最後のコードが、最初のコードと同じルートなら、同じ高さになる
//   ② 1つ前だけを見る簡易版（chooseOctaveShift）: 本来の高さと、その上下1オクターブのうち、前のルートに一番近いものを選ぶ（同じ近さなら本来の高さ）。試聴・ファームとの照合に使う
// ゲームの音が、実機の音と同じになるように、同じ計算（整数だけ）を保つ。ファームと一致するかは、テストで確かめている。

export const BASE_C_DEFAULT = 48;       // 高さ 0 のときの C（C3）。ファームの PIANO_BASE_C
export const OCTAVE_DEFAULT = 0;        // ゲームの標準の高さ（ルートが C3〜B3）。2026-11-17 に、1つ下げた（それまでは 1 = C4〜B4。ファームの標準も、もとは 1 だったが、実機に保存されている値は 0）

// ---------- ② 1つ前だけを見る簡易版 ----------
export function chooseOctaveShift(nominalRoot, previousRoot, enabled = true) {
  if (!enabled || previousRoot < 0) return 0;
  const CANDIDATES = [0, -12, 12];      // 先に並べたものが、同じ近さのときに選ばれる
  let best = CANDIDATES[0];
  let bestDistance = Math.abs(nominalRoot + best - previousRoot);
  for (let i = 1; i < 3; i++) {
    const d = Math.abs(nominalRoot + CANDIDATES[i] - previousRoot);
    if (d < bestDistance) { best = CANDIDATES[i]; bestDistance = d; }
  }
  return best;
}

// chord: Chord（chords.js）。baseC: ルートを置く音域の C（MIDI ノート番号）。previousRoot: 前のルート（なければ -1）
// 戻り値: { root, notes: [MIDIノート 4つ（低→高）], shift }
export function voiceChord(chord, baseC, previousRoot = -1, leading = true) {
  const nominal = baseC + chord.rootPc;
  const shift = chooseOctaveShift(nominal, previousRoot, leading);
  return voiceChordAt(chord, nominal + shift, baseC);
}

// ルートの高さ（MIDI）が決まっているときの、和音。baseC は、shift を出すためだけに使う（省いてもよい）
export function voiceChordAt(chord, root, baseC = BASE_C_DEFAULT) {
  return { root, notes: chord.semitones.map((s) => root + s), shift: root - (baseC + chord.rootPc) };
}

// ---------- ① 計画 ----------
// 費用（整数）。ファームの voicing.cpp の VOICE_PLAN_* と同じ値
export const PLAN = {
  CAD1: 20,     // 終止（強進行で、フレーズの終わり・ループのつなぎ目の、主和音 Ⅰ へ着く）が、4度上へ跳ぶときの罰。大きいので、完全5度下を優先する
  CAD2: 8,      // 強進行で、フレーズの途中の主和音へ着く（解決）・Ⅵm 系へ着くときが、4度上へ跳ぶときの罰。やや大きい
  PEN: 4,       // 音域の帯（下は baseC - LOW、上は baseC + HIGH）の外に出る、1半音ごとの罰
  BIG: 1000,    // 強進行なのに、完全4度上でも完全5度下でもない（ここでは、選ばれない）ときの罰
  OCT: 1,       // 本来の高さから、1オクターブずれるときの罰（同じ費用なら、本来の高さを選ぶ）
  LOW: 7,       // 帯の下: baseC - 7（C3 の標準なら F2）
  HIGH: 11,     // 帯の上: baseC + 11（B3）
};

const mod12 = (v) => ((v % 12) + 12) % 12;
const GOAL_TYPES = ['min', 'min7', 'maj'];
// 着地先の和音の強さ: 2 = 主和音（Ⅰ。どの種類でも）/ 1 = Ⅵm 系（Ⅵm・Ⅵm7・Ⅵ。短調の主和音）/ 0 = 着地先ではない
export const goalLevel = (c) => (!c || c.isRepeat ? 0 : c.rootPc === 0 ? 2 : (c.rootPc === 9 && GOAL_TYPES.includes(c.type) ? 1 : 0));
export const isGoalChord = (c) => goalLevel(c) > 0;

// nodes: ループの順に並べた和音（休みは入れない）。{ pc: ルートの音名の番号（0〜11）, goal: 着地先の強さ（goalLevel。0・1・2）, final: フレーズの終わりか }
// 戻り値: 各ノードの、本来の高さからのずれ（-12 / 0 / 12）。最初のノードは、いつも 0
export function planOctaves(nodes, baseC) {
  const n = nodes.length;
  const shifts = new Array(n).fill(0);
  if (n < 2) return shifts;
  const lo = baseC - PLAN.LOW, hi = baseC + PLAN.HIGH;
  const reg = (h) => PLAN.PEN * (h < lo ? lo - h : h > hi ? h - hi : 0);
  // a → b のつながりの種類。0 = ふつう / 1 = 終止（強進行で、フレーズの終わり・ループのつなぎ目の、主和音 Ⅰ へ）/ 2 = 解決（強進行で、途中の主和音へ・Ⅵm 系へ）
  const kind = (a, b, seam) => (mod12(b.pc - a.pc) !== 5 || !b.goal ? 0 : (b.goal === 2 && (seam || b.final) ? 1 : 2));
  const trans = (a, b, ha, hb, kd) => {
    const d = hb - ha;
    if (mod12(b.pc - a.pc) === 5) {                            // 強進行: 完全4度上（+5）か、完全5度下（-7）
      if (d === 5) return 5 + (kd === 1 ? PLAN.CAD1 : kd === 2 ? PLAN.CAD2 : 0);
      if (d === -7) return 7;
      return PLAN.BIG + Math.abs(d);
    }
    return Math.abs(d);                                        // ほかは、近いほどよい
  };
  const SH = [0, -12, 12];                                     // 先に並べたものが、同じ費用のときに選ばれる（本来の高さが先）
  const INF = 1e9;
  const cost = [], back = [];
  for (let i = 0; i < n; i++) { cost.push([INF, INF, INF]); back.push([-1, -1, -1]); }
  cost[0][0] = reg(baseC + nodes[0].pc);                       // 最初のノードは、本来の高さに固定
  for (let i = 1; i < n; i++) {
    const kd = kind(nodes[i - 1], nodes[i], false);
    for (let k = 0; k < 3; k++) {
      const h = baseC + nodes[i].pc + SH[k];
      const own = reg(h) + (k === 0 ? 0 : PLAN.OCT);
      for (let j = 0; j < 3; j++) {
        if (cost[i - 1][j] >= INF) continue;
        const c = cost[i - 1][j] + trans(nodes[i - 1], nodes[i], baseC + nodes[i - 1].pc + SH[j], h, kd) + own;
        if (c < cost[i][k]) { cost[i][k] = c; back[i][k] = j; }
      }
    }
  }
  const seam = kind(nodes[n - 1], nodes[0], true);              // ループのつなぎ目: 最後 → 最初（最初は、本来の高さ）
  let bestK = 0, bestC = INF;
  for (let k = 0; k < 3; k++) {
    if (cost[n - 1][k] >= INF) continue;
    const c = cost[n - 1][k] + trans(nodes[n - 1], nodes[0], baseC + nodes[n - 1].pc + SH[k], baseC + nodes[0].pc, seam);
    if (c < bestC) { bestC = c; bestK = k; }
  }
  let k = bestK;
  for (let i = n - 1; i >= 1; i--) { shifts[i] = SH[k]; k = back[i][k]; }
  return shifts;
}

// 盤から、鳴る順の「ノード」（同じ和音が続くものは、1つに）を作る。planVoicing と、スムーズボイスリーディング（planSmoothVoicing）が、同じものを使う
//   ノード: { chord, t0, t1（半ステップ単位の時刻）, members: [{ chord, k（ステップ）, half（前半 0・後半 1）}] }
function buildNodes(board, table, split, steps) {
  // 鳴る順の出来事。t0・t1: 半ステップ単位の時刻（1つのマス = 2つ。分割したマスは、前半 = [2k, 2k]・後半 = [2k+1, 2k+1]）
  const evs = [];
  for (let k = 0; k < steps; k++) {
    const id = resolveChordAtStep(board, k, table, split);
    const c1 = id === null ? null : table.byId(id);
    const sid = split ? split[k] : null;
    const c2 = sid === null || sid === undefined ? null : table.byId(sid);
    const has2 = !!c2 && !c2.isRepeat;
    if (c1 && !c1.isRepeat) evs.push({ chord: c1, t0: 2 * k, t1: has2 ? 2 * k : 2 * k + 1, k, half: 0 });
    if (has2) evs.push({ chord: c2, t0: 2 * k + 1, t1: 2 * k + 1, k, half: 1 });
  }
  // 同じ和音が、すぐ続くものは、1つのノードに（「→」も、前と同じ和音として、ここでまとまる）
  const nodes = [];
  for (const e of evs) {
    const last = nodes[nodes.length - 1];
    if (last && last.chord === e.chord && e.t0 === last.t1 + 1) { last.t1 = e.t1; last.members.push(e); }
    else nodes.push({ chord: e.chord, t0: e.t0, t1: e.t1, members: [e] });
  }
  return nodes;
}

// 位置ごとの駒（board）から、各ステップ（と、分割したマスの後半）のルートの高さを、まとめて決める。
//   board: コードIDか null の配列。split: 分割したマスの後半のコードID（なければ null）の配列（省いてもよい）
//   steps: 周回するステップの数（省くと board の長さ。チュートリアルの4ステップのループでは 4）。「→」は、board 全体を使って解決する（ステップを決めるときと同じ）
//   enabled: false のときは、いつも本来の高さ
// 戻り値: { first: [ステップごとの、最初に鳴るコードのルート（MIDI）。休みは null], second: [分割したマスの後半のルート。なければ null], nodes: 計画に使ったノードの数 }
//   同じ和音が続く（「→」も同じ）ときは、1つのノードにまとめる（同じ高さになる）
export function planVoicing(board, table, { baseC = BASE_C_DEFAULT, split = null, steps = board.length, enabled = true } = {}) {
  const first = new Array(steps).fill(null), second = new Array(steps).fill(null);
  const nodes = buildNodes(board, table, split, steps);
  const nominal = (c) => baseC + c.rootPc;
  const put = (e, root) => { (e.half === 0 ? first : second)[e.k] = root; };
  if (!enabled || nodes.length < 2) {
    for (const nd of nodes) for (const e of nd.members) put(e, nominal(nd.chord));
    return { first, second, nodes: nodes.length };
  }
  // フレーズの終わりか（sense.js の endsPhrase と同じ決まり: 休みで切れた並びの最後 / 4番・8番に着く（分割した前半は除く）/ そのあとに、同じルートの和音だけが続いて、そこへ着く）
  const adjacent = (i) => i + 1 < nodes.length && nodes[i + 1].t0 === nodes[i].t1 + 1;
  const atEnd = (i) => !adjacent(i) || (nodes[i].t1 % 2 === 1 && Math.floor(nodes[i].t1 / 2) % 4 === 3);
  const endsPhrase = (i) => {
    if (atEnd(i)) return true;
    const root = nodes[i].chord.rootPc, bar = Math.floor(nodes[i].t1 / 8);
    for (let k = i + 1; k < nodes.length && adjacent(k - 1); k++) {
      if (nodes[k].chord.rootPc !== root || Math.floor(nodes[k].t0 / 8) !== bar) return false;
      if (atEnd(k)) return true;
    }
    return false;
  };
  const plan = planOctaves(nodes.map((nd, i) => ({ pc: nd.chord.rootPc, goal: goalLevel(nd.chord), final: endsPhrase(i) })), baseC);
  nodes.forEach((nd, i) => { for (const e of nd.members) put(e, nominal(nd.chord) + plan[i]); });
  return { first, second, nodes: nodes.length };
}

// 位置ごとの駒（board）から、各ステップで鳴らすコードを決める。ファームの grooveResolveChordId と同じ規則:
//   ・ふつうの駒はそのコード / 空きは休み
//   ・「→」は、前へたどって、最初に見つかった「→」でない駒のコード（先頭の「前」は最後の位置。全部「→」なら休み）
// board: 長さ numSteps の配列。各要素は null か、コードID。戻り値: コードIDか null（休み）
//   split: 分割したマスの、後半のコードの ID（なければ null）の配列（省いてもよい）。「→」が前へたどるとき、分割したマスは、後半のコード（そのマスの、最後に鳴るコード）を繰り返す
//   戻り値は、そのステップの、最初に鳴るコード（分割したマスは、前半のコード）
export function resolveChordAtStep(board, step, table, split = null) {
  const n = board.length;
  const raw = board[step];
  if (raw === null || raw === undefined) return null;
  if (raw !== table.repeatId) return raw;
  for (let j = 1; j < n; j++) {
    const p = (((step - j) % n) + n) % n;
    const r = board[p];
    if (r === null || r === undefined) return null;       // 前のコマが空なら、休みを繰り返す
    if (r !== table.repeatId) return split && split[p] !== null && split[p] !== undefined ? split[p] : r;
  }
  return null;
}

// ---------- ③ スムーズボイスリーディング（中・大。2026-11-24。ご依頼）----------
//   前の和音の、実際に鳴っている音から、次の和音の音を、できるだけ動かさずに（内声の動きが、最も少なくなるように）つなぐ。
//   ・中（'mid'）: ルートが、完全4度・完全5度で動くときだけ（Dm7 → G7 → CM7 = DFAC → DFGB → CEGB。ルートの G は、別にベースとして置く）
//   ・大（'high'）: ぜんぶの和音の動きで
//   ・和音の音は、閉じた配置（転回形）。ルートは、いちばん下の音がルートでなければ、そのすぐ下に、別のベースとして置く（構成音が、5つになってよい）
//   ・最初の和音（ループのはじめ）は、ふだんの高さ（ルート位置の配置）。そこから、つなぐ。ループのつなぎ目（最後 → 最初）も、動きが少なくなるように選ぶ
//   ・ファーム（実機）には、まだ入れていない（ゲームの音だけ）
export const SMOOTH_MODES = ['off', 'mid', 'high'];
export const SMOOTH = {
  lo: -9, hi: 21,         // 上の音を置く範囲（baseC からの半音）。ふだんの和音の高さ（baseC〜baseC+23）の、まわり
  span: 14,               // 上の音の、いちばん低い音〜いちばん高い音（半音）の上限
  spanFree: 12,           // これをこえたぶんは、1半音ごとに罰
  adjacent: 2,            // となりあう音が半音（短2度）で、低い（MIDI 60 より下）とき、1組ごとの罰
  fifthDouble: 0.5,       // 3和音の、重ねる音を 5度にしたときの罰（ルートが、いちばん自然）
  thirdDouble: 3,         // 3和音の、重ねる音を 3度にしたときの罰
  center: 0.15,           // 全体の高さが、ふだんの中心からはなれるとき、1半音ごとの罰（長い進行で、だんだん高く・低くなっていかないように）
  noRoot: 0.3,            // いちばん下の音がルートでないとき（別にベースを足すとき）の罰
  skip: 2,                // 前後で、音の数がちがうとき、対応しない音1つごとの罰
  keep: 150,              // 1つの和音につき、残す候補の数（音の多い自作コードで、遅くならないように）
};
const mod12v = (v) => ((v % 12) + 12) % 12;
const isFourFiveMove = (a, b) => { const d = mod12v(b.rootPc - a.rootPc); return d === 5 || d === 7; };

// 前後の、動きの量: 低い音から順に、1対1で対応づけた、半音の差の合計。音の数がちがうときは、順序を保って、いちばん近くなる対応（あまった音は SMOOTH.skip）
export function voiceMotion(a, b) {
  if (a.length === b.length) { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t; }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  const n = s.length, m = l.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  for (let j = 0; j <= m; j++) dp[0][j] = j * SMOOTH.skip;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j - 1] + Math.abs(s[i - 1] - l[j - 1]), dp[i][j - 1] + SMOOTH.skip);
  return dp[n][m];
}

// 1つの和音の、上の音の候補（閉じた配置）。範囲は、[lo, hi]（MIDI）。戻り値: [{ up: [低→高], cost }]（cost = その配置だけの罰）
function smoothCandidates(chord, lo, hi, center) {
  const base = chord.semitones.map((st) => mod12v(chord.rootPc + st));          // 和音の音（3和音は、ルートが2つ）
  const uniq = [...new Set(base)];
  const variants = [{ pcs: base, pen: 0 }];
  if (uniq.length === 3 && base.length === 4) {                                    // 3和音: 重ねる音を、5度・3度にした形も
    const dup = base.find((p, i) => base.indexOf(p) !== i);
    const fifth = uniq.find((p) => mod12v(p - chord.rootPc) === 7), third = uniq.find((p) => [3, 4].includes(mod12v(p - chord.rootPc)));
    const three = uniq.filter((p) => p !== undefined);
    if (dup !== undefined) {
      if (fifth !== undefined && fifth !== dup) variants.push({ pcs: [...three, fifth], pen: SMOOTH.fifthDouble });
      if (third !== undefined && third !== dup) variants.push({ pcs: [...three, third], pen: SMOOTH.thirdDouble });
    }
  }
  const out = new Map();
  for (const v of variants) {
    const choices = v.pcs.map((pc) => { const xs = []; for (let m = lo; m <= hi; m++) if (mod12v(m) === pc) xs.push(m); return xs; });
    const pick = new Array(v.pcs.length);
    const rec = (i) => {
      if (i === pick.length) {
        const up = pick.slice().sort((x, y) => x - y);
        for (let k = 1; k < up.length; k++) if (up[k] === up[k - 1]) return;                // 同じ高さの音は、重ねない
        const span = up[up.length - 1] - up[0];
        if (span > SMOOTH.span) return;
        const key = up.join(',');
        let cost = v.pen + Math.max(0, span - SMOOTH.spanFree);
        for (let k = 1; k < up.length; k++) if (up[k] - up[k - 1] === 1 && up[k - 1] < 60) cost += SMOOTH.adjacent;
        const mean = up.reduce((x, y) => x + y, 0) / up.length;
        cost += SMOOTH.center * Math.abs(mean - center);
        if (mod12v(up[0]) !== chord.rootPc) cost += SMOOTH.noRoot;
        const cur = out.get(key);
        if (!cur || cost < cur.cost) out.set(key, { up, cost });
        return;
      }
      for (const m of choices[i]) { pick[i] = m; rec(i + 1); }
    };
    rec(0);
  }
  const list = [...out.values()].sort((x, y) => x.cost - y.cost);
  return list.slice(0, SMOOTH.keep);
}

// 上の音（低→高）から、実際に鳴らす音を作る。いちばん下の音がルートでなければ、そのすぐ下に、ルートを別のベースとして足す
function smoothVoice(chord, up, baseC) {
  let notes = up.slice(), root = up[0];
  if (mod12v(up[0]) !== chord.rootPc) {
    let b = up[0] - 1;
    while (mod12v(b) !== chord.rootPc) b--;
    notes = [b, ...up]; root = b;
  }
  return { root, notes, shift: root - (baseC + chord.rootPc), up };          // up: 上の音（別のベースをのぞく）
}

// 盤から、スムーズボイスリーディング（中・大）の、各ステップ（分割したマスの後半）の和音（{ root, notes, shift }）を、まとめて決める。
//   roots: planVoicing の結果（ふつうの高さの和音に使う）。mode: 'mid' | 'high'（'off' は、何も決めない）
//   戻り値: { first: [ステップごと。決めなかったもの（ふつうの高さのまま）は null], second: [...] }
export function planSmoothVoicing(board, table, { baseC = BASE_C_DEFAULT, split = null, steps = board.length, mode = 'off', roots = null } = {}) {
  const first = new Array(steps).fill(null), second = new Array(steps).fill(null);
  if (mode !== 'mid' && mode !== 'high') return { first, second, nodes: 0 };
  const nodes = buildNodes(board, table, split, steps);
  if (nodes.length < 2) return { first, second, nodes: nodes.length };
  const plan = roots || planVoicing(board, table, { baseC, split, steps, enabled: true });
  const nominal = (nd) => { const e = nd.members[0]; const r = (e.half === 0 ? plan.first : plan.second)[e.k]; return r === null || r === undefined ? baseC + nd.chord.rootPc : r; };
  const std = nodes.map((nd) => voiceChordAt(nd.chord, nominal(nd), baseC));            // ふだんの高さの和音
  const smooth = nodes.map((nd, i) => i > 0 && (mode === 'high' || isFourFiveMove(nodes[i - 1].chord, nd.chord)));
  const lo = baseC + SMOOTH.lo, hi = baseC + SMOOTH.hi;
  const center = baseC + 6;
  const cands = nodes.map((nd, i) => (smooth[i] ? smoothCandidates(nd.chord, lo, hi, center) : [{ up: std[i].notes.slice().sort((x, y) => x - y), cost: 0 }]));
  if (cands.some((c) => c.length === 0)) return { first, second, nodes: nodes.length };         // 範囲に収まる配置がない（ふつうの高さのまま）
  // 動的計画法（ビタビ）: 前の音からの動きの合計が、いちばん小さくなる配置の列
  const n = nodes.length;
  const cost = [cands[0].map((c) => c.cost)];
  const back = [cands[0].map(() => -1)];
  for (let i = 1; i < n; i++) {
    const row = [], bk = [];
    for (let k = 0; k < cands[i].length; k++) {
      let best = Infinity, arg = 0;
      for (let j = 0; j < cands[i - 1].length; j++) {
        const v = cost[i - 1][j] + (smooth[i] ? voiceMotion(cands[i - 1][j].up, cands[i][k].up) : 0);
        if (v < best) { best = v; arg = j; }
      }
      row.push(best + cands[i][k].cost); bk.push(arg);
    }
    cost.push(row); back.push(bk);
  }
  // ループのつなぎ目（最後 → 最初）: 最初の和音は、ふだんの高さに決まっている。最後の和音を、そこへ、動きが少なくなるように選ぶ
  const seam = mode === 'high' || isFourFiveMove(nodes[n - 1].chord, nodes[0].chord);
  let bestK = 0, bestV = Infinity;
  for (let k = 0; k < cands[n - 1].length; k++) {
    const v = cost[n - 1][k] + (seam && smooth[n - 1] ? voiceMotion(cands[n - 1][k].up, cands[0][0].up) : 0);
    if (v < bestV) { bestV = v; bestK = k; }
  }
  const pick = new Array(n);
  pick[n - 1] = bestK;
  for (let i = n - 1; i >= 1; i--) pick[i - 1] = back[i][pick[i]];
  nodes.forEach((nd, i) => {
    if (!smooth[i]) return;
    const voice = smoothVoice(nd.chord, cands[i][pick[i]].up, baseC);
    for (const e of nd.members) (e.half === 0 ? first : second)[e.k] = voice;
  });
  return { first, second, nodes: n };
}

// ---------- ④ 低すぎる進行を、1オクターブ上げる（2026-11-24。ご依頼: 進行の中に C1 が含まれる場合は、進行全体を1オクターブ上げる。この基準は、あとで変えるかもしれない）----------
//   LOW_LIMIT: この高さ（MIDI ノート番号）以下の音が、進行の中にあれば、進行ぜんぶを LOW_LIFT 上げる。36 = C1（GarageBand・Logic の呼び名。C3 = 60 の数え方。このゲームの画面の C3 = 48 の数え方では C2）
//   数えるのは、和音の音（別のベースを足したものを含む）。バッキングのパターンの、ベースの音（ルートの1オクターブ下）は、数えない
export const LOW_LIMIT = 36;
export const LOW_LIFT = 12;
export function liftFor(voices) {
  let low = Infinity;
  for (const v of voices) if (v) for (const m of v.notes) if (m < low) low = m;
  return low <= LOW_LIMIT ? LOW_LIFT : 0;
}
