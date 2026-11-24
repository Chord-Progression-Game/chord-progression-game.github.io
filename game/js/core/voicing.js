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

// 位置ごとの駒（board）から、各ステップ（と、分割したマスの後半）のルートの高さを、まとめて決める。
//   board: コードIDか null の配列。split: 分割したマスの後半のコードID（なければ null）の配列（省いてもよい）
//   steps: 周回するステップの数（省くと board の長さ。チュートリアルの4ステップのループでは 4）。「→」は、board 全体を使って解決する（ステップを決めるときと同じ）
//   enabled: false のときは、いつも本来の高さ
// 戻り値: { first: [ステップごとの、最初に鳴るコードのルート（MIDI）。休みは null], second: [分割したマスの後半のルート。なければ null], nodes: 計画に使ったノードの数 }
//   同じ和音が続く（「→」も同じ）ときは、1つのノードにまとめる（同じ高さになる）
export function planVoicing(board, table, { baseC = BASE_C_DEFAULT, split = null, steps = board.length, enabled = true } = {}) {
  const first = new Array(steps).fill(null), second = new Array(steps).fill(null);
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
