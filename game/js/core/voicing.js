// 和音の高さの決め方。ファーム（src/voicing.cpp と groove.cpp の computeVoicing）と、まったく同じ規則。
//   ・本来の高さ（ルートが baseC〜baseC+11）と、その上下1オクターブのうち、前のルートに一番近いものを選ぶ（同じ近さなら本来の高さ）
//   ・ただし、強進行（ルートが完全4度上 = 完全5度下へ進む和音）は、完全5度下へ動かす（2026-11-24。下に行きすぎるときだけ、いちばん近い高さ）
//   ・位置1（ループの最初）に戻ったら、前のルートは忘れる
// ゲームの音が、実機の音と同じになるように、同じ計算を保つ。ファームと一致するかは、テストで確かめている。

export const BASE_C_DEFAULT = 48;       // 高さ 0 のときの C（C3）。ファームの PIANO_BASE_C
export const OCTAVE_DEFAULT = 0;        // ゲームの標準の高さ（ルートが C3〜B3）。2026-11-17 に、1つ下げた（それまでは 1 = C4〜B4。ファームの標準も、もとは 1 だったが、実機に保存されている値は 0）

export function chooseOctaveShift(nominalRoot, previousRoot, enabled = true) {
  if (!enabled || previousRoot < 0) return 0;
  const CANDIDATES = [0, -12, 12];      // 先に並べたものが、同じ近さのときに選ばれる
  // 強進行（前のルートから見て、ルートが完全4度上 = 完全5度下に進む和音: Ⅴ → Ⅰ・Ⅱm → Ⅴ など）は、完全5度「下」へ動かす。
  //   上へ4度跳ぶと、ベースがいったん浮き上がって、「終止した感じ」にならない（2026-11-24 のご指定）。
  //   5度下の高さが、候補（本来の高さの上下1オクターブ）の中にないとき（下に行きすぎるとき）だけ、いちばん近い高さにする
  if ((((nominalRoot - previousRoot) % 12) + 12) % 12 === 5) {
    for (const c of CANDIDATES) if (nominalRoot + c === previousRoot - 7) return c;
  }
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
  const rootNote = baseC + shift + chord.rootPc;
  return { root: nominal + shift, notes: chord.semitones.map((s) => rootNote + s), shift };
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
