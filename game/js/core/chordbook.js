// 自作コード・編集したコードの、決まりごと（2026-11-23）。DOM には触れない。
//   ・構成音（MIDI ノート）から、コードの名前の候補を作る（例: E G# C D G → Eaug7(♯9) / A C E G B → Am9）
//   ・構成音から、判定（tricks.js・sense.js・hints.js）が使う性質（ルート・種類 type）を決める
//       → 判定は「ルートの高さ」と「種類」だけで動くので、自作コードも、もとからあるコードと同じように、技・ジャッジ・ヒントの対象になる
//   ・保存する形（save.chordbook）の検査と、Chord（chords.js）に渡す「もとの形（raw）」の組み立て
//
// ■ 種類（type）: もとからある 'maj' 'min' 'maj7' 'dom7' 'min7' 'min7b5' 'sus47' 'sus4' 'min6' 'dim7' のほか、自作用に 'dim' 'aug' 'sus2' 'mM7' 'other'
//     ・9th・11th・13th・♭9・♯9・♯11・♭13 などのテンションは、種類を変えない（例: Am9 は min7・Eaug7(♯9) は dom7・G13 は dom7）
//     ・ドミナント7th（長3度 + 短7度）は、♯5・♭5 があっても dom7。次のコードを引っぱる力が、変わらないため
// ■ 構成音は、キー C のときの高さで書く（駒の「度数」が、キーに依存しないのと同じ。ルート = 主音からの半音数 rootPc）
//     ルートの標準の高さ = C3〜B3（MIDI 48 + rootPc）。構成音の semitones は、そこからの半音数（転回形のように、ルートより下の音は、マイナス）

export const HOME_C = 48;                  // ルートの標準の高さ（C3）。voicing.js の BASE_C_DEFAULT と同じ
export const NOTE_LO = 36;                 // 編集画面で使える、いちばん低い音（C2）
export const NOTE_HI = 84;                 // いちばん高い音（C6）
export const MAX_TONES = 8;                // 1つのコードの音の数の上限
export const MIN_TONES = 2;
export const CUSTOM_ID_BASE = 200;         // 自作コードの ID は、200 から（1〜31 はもとの駒・99 は「→」）
export const MAX_CUSTOM = 60;              // 自作コードの数の上限
export const MAX_SYMBOL = 14;              // 名前（コード名）の長さの上限（文字）
export const SHAPES = ['auto', 'sphere', 'cube', 'cone', 'octa', 'cylinder', 'star', 'ring'];
export const SHAPE_NAMES = { auto: '働きにまかせる', sphere: '球', cube: '立方体', cone: '三角錐', octa: 'ひし形', cylinder: '円柱', star: '星', ring: 'わ' };
export const COLORS = ['#e9b93f', '#e2573c', '#4d88dc', '#9b72d4', '#52bd95', '#e25c97', '#e29756', '#76c2dc', '#c3cf60', '#d8d2c4'];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];
const mod12 = (n) => ((n % 12) + 12) % 12;

// ---------- 名前の表記 ----------
// ルートの音名（コード名の頭）。長調系は ♭ を使う（F# だけ #）。短調系・減和音は、1 と 8 を # で（C#m・G#dim7）。もとの駒の表記（D♭7・A♭M7・E♭m6・G#dim7・F#m7-5）にそろえる
export function rootName(pc, minorish = false) {
  const major = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
  const minor = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B♭', 'B'];
  return (minorish ? minor : major)[mod12(pc)];
}
// ルートの度数の名前（ローマ数字 + 変化記号。「Ⅲ♭M7」のように、記号は数字のあとに付ける）。{ roman, acc: -1|0|1, text }
export function degreeOf(pc, minorish = false) {
  const table = [[1, 0], [2, -1], [2, 0], [3, -1], [3, 0], [4, 0], [4, 1], [5, 0], [6, -1], [6, 0], [7, -1], [7, 0]];
  let [d, acc] = table[mod12(pc)];
  if (minorish && mod12(pc) === 1) { d = 1; acc = 1; }            // C#m 系 = Ⅰ#
  if (minorish && mod12(pc) === 8) { d = 5; acc = 1; }            // G#m・G#dim7 系 = Ⅴ#
  return { roman: ROMAN[d], acc, text: `${ROMAN[d]}${acc < 0 ? '♭' : acc > 0 ? '#' : ''}` };
}

// 音名（構成音の表示用）: 和音の中の役割（度数の数字）に合わせて、綴りを決める（例: Eaug7(♯9) の G は「♯9」なので G、G# は 3度なので G#）。
//   B#・E#・C♭・F♭・ダブルシャープ・ダブルフラットのような、読みにくい綴りは、ふつうの鍵盤の呼び名にする（ユーザーの例: E G# C D G）
const SIMPLE_NAMES = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B♭', 'B'];
function spell(rootLetterIdx, rootPc, interval, degreeNumber) {
  const pc = mod12(rootPc + interval);
  const letter = LETTERS[(rootLetterIdx + degreeNumber - 1) % 7];
  const natural = NATURAL_PC[LETTERS.indexOf(letter)];
  let diff = mod12(pc - natural);
  if (diff > 6) diff -= 12;
  const name = letter + (diff === 0 ? '' : diff === 1 ? '#' : diff === -1 ? '♭' : '?');
  return diff < -1 || diff > 1 || ['B#', 'E#', 'C♭', 'F♭'].includes(name) ? SIMPLE_NAMES[pc] : name;
}
const DEG_NUMBER = { R: 1, '3': 3, b3: 3, '5': 5, b5: 5, '#5': 5, '7': 7, b7: 7, bb7: 7, '6': 6, '9': 9, b9: 9, '#9': 9, '11': 11, '#11': 11, '13': 13, b13: 13, sus4: 4, sus2: 2, '4': 4 };
const roleDegree = (role) => ((DEG_NUMBER[role] - 1) % 7) + 1;

// ---------- 構成音 → ルートごとの読み方 ----------
// I: ルートからの半音（0〜11）の集合（0 を含む）。戻り値: { third, sus, fifth, seventh, sixth, nat9, b9, s9, nat11, s11, nat13, b13, tones: [{ iv, role }], extra: [iv…] }
function parseTones(I) {
  const has = (x) => I.has(x);
  const tones = [];
  const used = new Set();
  const take = (iv, role) => { if (has(iv) && !used.has(iv)) { tones.push({ iv, role }); used.add(iv); return true; } return false; };
  take(0, 'R');
  let third = null;
  if (has(4)) { third = 'M'; take(4, '3'); } else if (has(3)) { third = 'm'; take(3, 'b3'); }
  let sus = null;
  if (!third) { if (has(5)) { sus = 'sus4'; take(5, 'sus4'); } else if (has(2)) { sus = 'sus2'; take(2, 'sus2'); } }
  let fifth = null;
  if (has(7)) { fifth = 'P'; take(7, '5'); }
  else if (third === 'm' && has(6)) { fifth = 'b5'; take(6, 'b5'); }
  else if (third === 'M' && has(8)) { fifth = '#5'; take(8, '#5'); }
  else if (third === 'M' && has(6)) { fifth = 'b5'; take(6, 'b5'); }
  let seventh = null;
  if (has(11)) { seventh = 'M7'; take(11, '7'); }
  else if (has(10)) { seventh = '7'; take(10, 'b7'); }
  else if (third === 'm' && fifth === 'b5' && has(9)) { seventh = 'dim7'; take(9, 'bb7'); }
  let sixth = false;
  const r = { third, sus, fifth, seventh, sixth, nat9: false, b9: false, s9: false, nat11: false, s11: false, nat13: false, b13: false };
  // テンション
  if (sus !== 'sus2' && take(2, '9')) r.nat9 = true;
  if (take(1, 'b9')) r.b9 = true;
  if (third === 'M' && take(3, '#9')) r.s9 = true;
  if (third && take(5, '11')) r.nat11 = true;
  if (fifth === 'P' && take(6, '#11')) r.s11 = true;
  if (seventh && seventh !== 'dim7' && take(9, '13')) r.nat13 = true;
  if (fifth === 'P' && take(8, 'b13')) r.b13 = true;
  if (!seventh && !r.nat13 && take(9, '6')) r.sixth = true;                // 7度がなく、9（長6度）がある: 6th の和音（C6・Cm6）
  const extra = [...I].filter((iv) => !used.has(iv));
  return { ...r, tones, extra };
}

// 読み方 → { suffix, type, cost }（名前の後ろの部分・判定用の種類・「読みにくさ」の点。小さいほど自然な読み方）
function compose(p) {
  const { third, sus, fifth, seventh } = p;
  let type, family;           // family: 7th の和音のときの、数字を置きかえられる名前の型 { pre, post }（例: 'm' + '7' + ''）
  let cost = 0;
  let base = '';
  if (third === 'M') {
    if (fifth === '#5') { type = seventh === '7' ? 'dom7' : seventh === 'M7' ? 'maj7' : 'aug'; base = seventh === '7' ? 'aug' : seventh === 'M7' ? 'augM' : 'aug'; family = seventh ? { pre: base, post: '' } : null; cost += 0.4; }
    else if (fifth === 'b5') { type = seventh === '7' ? 'dom7' : seventh === 'M7' ? 'maj7' : 'maj'; base = seventh === '7' ? '' : seventh === 'M7' ? 'M' : ''; family = seventh ? { pre: base, post: '(♭5)' } : null; cost += 1.0; }
    else if (seventh === '7') { type = 'dom7'; family = { pre: '', post: '' }; }
    else if (seventh === 'M7') { type = 'maj7'; family = { pre: 'M', post: '' }; }
    else if (p.sixth) { type = 'maj'; base = '6'; }
    else { type = 'maj'; base = ''; }
  } else if (third === 'm') {
    if (fifth === 'b5') {
      if (seventh === 'dim7') { type = 'dim7'; base = 'dim7'; }
      else if (seventh === '7') { type = 'min7b5'; base = 'm7-5'; }
      else if (seventh === 'M7') { type = 'mM7'; base = 'mM7(♭5)'; cost += 1.0; }
      else { type = 'dim'; base = 'dim'; }
    } else if (seventh === '7') { type = 'min7'; family = { pre: 'm', post: '' }; }
    else if (seventh === 'M7') { type = 'mM7'; family = { pre: 'mM', post: '' }; cost += 0.3; }
    else if (p.sixth) { type = 'min6'; base = 'm6'; }
    else { type = 'min'; base = 'm'; }
  } else if (sus) {
    cost += 0.5;
    if (seventh === '7') { type = 'sus47'; base = sus === 'sus4' ? 'sus47' : '7sus2'; family = { raw: true }; }
    else if (seventh === 'M7') { type = 'other'; base = `M7${sus}`; }
    else { type = sus; base = sus; }                                   // 'sus4' / 'sus2'
  } else {
    // 3度も sus もない: パワーコード（ルート + 5度）か、読めない和音
    if (fifth === 'P' && !seventh) { type = 'other'; base = '5'; cost += 3; }
    else { type = 'other'; base = ''; cost += 6; }
  }
  if (!fifth && (third || sus)) cost += 1.3;                             // 5度がない（ジャズでは、よく省く）
  // テンションの数字（9・11・13）と、かっこの中の変化音
  let name = base;
  const paren = [];
  if (family && !family.raw) {
    let num = '7';
    if (p.nat13) num = p.nat9 ? '13' : '7';
    else if (p.nat11 && p.nat9) num = '11';
    else if (p.nat9) num = '9';
    name = `${family.pre}${num}`;
    if (family.post) paren.push(family.post.replace(/[()]/g, ''));
    if (p.nat13 && !p.nat9) paren.push('13');
    if (p.nat11 && !(p.nat9 && !p.nat13)) { if (num !== '11') paren.push('11'); }
    cost += (p.nat9 ? 0.6 : 0) + (p.nat11 ? 1.2 : 0) + (p.nat13 ? 1.0 : 0);
  } else if (family && family.raw) {
    name = base;
    if (p.nat9) paren.push('9'); if (p.nat11) paren.push('11'); if (p.nat13) paren.push('13');
    cost += (p.nat9 ? 0.6 : 0) + (p.nat11 ? 1.2 : 0) + (p.nat13 ? 1.0 : 0);
  } else {
    // 7度がない: add9・6/9・add11 など
    if (p.nat9 && p.sixth) { name = base === '6' ? '6/9' : 'm6/9'; cost += 0.6; }
    else if (p.nat9) { name = base === 'm' ? 'madd9' : (base === '' ? 'add9' : `${base}(add9)`); if (!base) name = 'add9'; cost += 0.6; }
    if (p.nat11) { paren.push('add11'); cost += 1.2; }
    if (p.nat13) { paren.push('13'); cost += 1.0; }
    if (p.sixth && !p.nat9) { /* base が '6' か 'm6' */ }
  }
  if (p.b9) { paren.push('♭9'); cost += 1.6; }
  if (p.s9) { paren.push('♯9'); cost += 1.6; }
  if (p.s11) { paren.push('♯11'); cost += 1.6; }
  if (p.b13) { paren.push('♭13'); cost += 1.6; }
  if (family && p.fifth === 'b5' && family.post) { /* (♭5) は、上で paren に入れた */ }
  cost += p.extra.length * 8;
  const suffix = `${name}${paren.length ? `(${paren.join(',')})` : ''}`;
  return { suffix, type, cost };
}

// ---------- 候補の組み立て ----------
// notes: MIDI ノート（キー C のときの高さ）。戻り値: 名前の候補（読みやすい順）[{ rootPc, bassPc, slash, suffix, type, symbol, name, degree, cost, tones: [{ midi, pc, role, spelled }], notesText }]
export function detectChord(notes, { max = 5 } = {}) {
  const list = [...new Set((notes || []).map((n) => Math.round(n)))].sort((a, b) => a - b);
  if (list.length < MIN_TONES) return [];
  const bassPc = mod12(list[0]);
  const pcs = [...new Set(list.map(mod12))];
  const out = [];
  for (const rootPc of pcs) {
    const I = new Set(pcs.map((pc) => mod12(pc - rootPc)));
    const p = parseTones(I);
    const c = compose(p);
    const slash = rootPc !== bassPc;
    const minorish = p.third === 'm' || c.type === 'dim' || c.type === 'dim7' || c.type === 'min7b5';
    const degree = degreeOf(rootPc, minorish);
    const rn = rootName(rootPc, minorish);
    const rootIdx = LETTERS.indexOf(rn[0]);
    const spelled = (iv) => {
      const t = p.tones.find((x) => x.iv === iv);
      return t ? spell(rootIdx, rootPc, iv, roleDegree(t.role)) : rootName(mod12(rootPc + iv));
    };
    const bassName = spell(rootIdx, rootPc, mod12(bassPc - rootPc), (() => { const t = p.tones.find((x) => x.iv === mod12(bassPc - rootPc)); return t ? roleDegree(t.role) : 1; })());
    const slashText = slash ? `/${bassName}` : '';
    const tones = list.map((midi) => {
      const iv = mod12(midi - rootPc);
      const t = p.tones.find((x) => x.iv === iv);
      return { midi, pc: mod12(midi), role: t ? t.role : '?', spelled: spelled(iv) };
    });
    const bassDeg = slash ? degreeOf(bassPc, false) : null;
    out.push({
      rootPc, bassPc, slash, suffix: c.suffix, type: c.type,
      symbol: `${rn}${c.suffix}${slashText}`,
      name: `${degree.text}${c.suffix}${slash ? `/${bassDeg.text}` : ''}`,
      degree, cost: c.cost + (slash ? 2.2 : -0.5),
      tones, notesText: tones.map((t) => t.spelled).join(' '),
    });
  }
  out.sort((a, b) => a.cost - b.cost || (a.slash ? 1 : 0) - (b.slash ? 1 : 0) || a.rootPc - b.rootPc);
  return out.slice(0, max);
}

// 候補 + 構成音 → 判定に使う性質。semitones = ルートの標準の高さ（C3 + rootPc）からの半音数
export function semitonesOf(notes, rootPc) {
  return [...new Set(notes.map((n) => Math.round(n)))].sort((a, b) => a - b).map((m) => m - (HOME_C + rootPc));
}

// ---------- 並べ順（トレイ・コード一覧）----------
// 同じ段（Lv.）の中の、駒の並べ順（2026-11-23。ユーザーの指定）。プリセットのコードが増えても、自作コードを足しても、この決まりで並ぶ:
//   ① ルート音（C → B。主音からの半音数 0 → 11）
//   ② 実質的な構成音の数が、少ない順（3和音 → 4和音 → 5和音…。オクターブちがいの重なりは、数えない）
//   ③ 4和音以上は、7th（6th・dim7 の 6 を含む）の音の、ルートからの近さ（6th / dim7 → ♭7 → M7）
//   ④ そのあと、2音目・3音目・4音目…の、ルートからの近さ（同じなら、次の音で決める）
//   例: Csus2 < Cm < C < Caug < Csus4（3和音）/ Em7♭5 < Em7 < E7 < Eaug7 < EM7 < Em9 < E7(♭9) < E11（4和音以上）
//   音の高さは、和音の「積み方」（ルート・3度・5度・7度・9度・11度・13度）に直して比べる（転回形・ちらばりに、左右されない。9th は、14 のように、ルートの上のオクターブ）
const ROLE_STACK = { R: 0, sus2: 2, b3: 3, '3': 4, sus4: 5, b5: 6, '5': 7, '#5': 8, '6': 9, bb7: 9, b7: 10, '7': 11, b9: 13, '9': 14, '#9': 15, '11': 17, '#11': 18, b13: 20, '13': 21 };
const SEVENTH_ROLES = ['6', 'bb7', 'b7', '7'];
// pcs: 構成音の高さ（主音からの半音。0〜11）。戻り値: [ルートからの積み方の半音数（小さい順）, 7th の位置（なければ 0）]
export function chordStack(rootPc, pcs) {
  const I = new Set((pcs || []).map((p) => mod12(p - rootPc)));
  I.add(0);
  const parsed = parseTones(I);
  const stack = parsed.tones.map((t) => (ROLE_STACK[t.role] !== undefined ? ROLE_STACK[t.role] : t.iv + 12));
  for (const iv of parsed.extra) stack.push(iv + 12);
  const sev = parsed.tones.find((t) => SEVENTH_ROLES.includes(t.role));
  return { stack: stack.sort((a, b) => a - b), seventh: sev ? ROLE_STACK[sev.role] : 0 };
}
// 構成音の役割（ルート・3度・5度・7度・テンション）。ジャッジの「内声の半音の動き」が、3度・7度の音を探すのに使う。戻り値: [{ pc（主音からの半音。0〜11）, iv（ルートからの半音）, role }]
//   role: R / sus2 / b3 / 3 / sus4 / b5 / 5 / #5 / 6 / bb7 / b7 / 7 / b9 / 9 / #9 / 11 / #11 / b13 / 13（parseTones の読み方）。同じ和音（同じオブジェクト）では、一度だけ作る
export function chordRoles(c) {
  if (!c || c.isRepeat) return [];
  if (c._roles) return c._roles;
  const I = new Set((c.pcs || []).map((p) => mod12(p - c.rootPc)));
  I.add(0);
  const out = parseTones(I).tones.map((t) => ({ pc: mod12(c.rootPc + t.iv), iv: t.iv, role: t.role }));
  Object.defineProperty(c, '_roles', { value: out, enumerable: false });
  return out;
}
export { rootName as pcName };

// 並べ順の鍵（数の並び。小さい順に並べる）: [ルート, 構成音の数, 7th の位置, 2音目, 3音目, …]
export function chordOrderKey(c) {
  if (!c || c.isRepeat) return [99];
  const { stack, seventh } = chordStack(c.rootPc, c.pcs);
  return [mod12(c.rootPc), stack.length, seventh, ...stack.slice(1)];
}
export function compareOrderKeys(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] === undefined ? -1 : a[i], y = b[i] === undefined ? -1 : b[i];       // 同じところまで同じなら、短いほうが先
    if (x !== y) return x - y;
  }
  return 0;
}

// ---------- 保存の形 ----------
// 保存する1つのコード（record）: { id?, notes, rootPc, symbol, name, level（null = 未設定）, color（null = 働きの色）, shape, at }
//   type・semitones・pcs などの性質は、保存せず、構成音とルートから、読み込むたびに作り直す（判定の決まりが変わっても、古いデータが、ずれない）
export function normalizeNotes(notes) {
  const out = [...new Set((Array.isArray(notes) ? notes : []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= NOTE_LO && n <= NOTE_HI))].sort((a, b) => a - b);
  return out.slice(0, MAX_TONES);
}
const clampSymbol = (s) => [...String(s || '').trim()].slice(0, MAX_SYMBOL).join('');
const validColor = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null);

// 候補（detectChord の1つ）などから、保存する record を作る。symbol を省くと、候補の名前
export function makeRecord({ id, notes, candidate, symbol, level = null, color = null, shape = 'auto', at = Date.now(), name = null }) {
  const ns = normalizeNotes(notes);
  const cand = candidate || detectChord(ns)[0];
  if (!cand || ns.length < MIN_TONES) return null;
  const rec = {
    notes: ns, rootPc: cand.rootPc, symbol: clampSymbol(symbol) || cand.symbol, name: name || cand.name,
    level: Number.isInteger(level) && level >= 1 && level <= 5 ? level : null, color: validColor(color), shape: SHAPES.includes(shape) ? shape : 'auto', at,
  };
  if (id !== undefined && id !== null) rec.id = id;
  return rec;
}

// 構成音と record から、Chord に渡す「もとの形（raw）」を作る。base: 編集するもとの駒（なければ自作）
export function recordToRaw(rec, { id, base = null } = {}) {
  const ns = normalizeNotes(rec.notes);
  const cand = detectChord(ns, { max: 12 }).find((c) => c.rootPc === rec.rootPc) || detectChord(ns)[0];
  if (!cand) return null;
  return {
    id: id !== undefined ? id : rec.id, menu: base ? base.menu : 0, level: rec.level !== undefined && rec.level !== null ? rec.level : (base ? base.level : null),
    name: rec.name, degree: 0, accidental: cand.degree.acc, type: cand.type, rootPc: cand.rootPc, semitones: semitonesOf(ns, cand.rootPc), symbol: rec.symbol, notes: cand.notesText,
    custom: !base, edited: !!base, baseId: base ? base.id : null, color: rec.color || null, shape: rec.shape && rec.shape !== 'auto' ? rec.shape : null, midi: ns,
  };
}

// 保存してあった内容を、検査して、きれいにする（壊れていても、ゲームが動くように）
//   data: { custom: [record…], edits: { もとの駒の ID: record }, nextId }。baseIds: もとの駒の ID の集合。戻り値: 同じ形
export function sanitizeChordbook(data, baseIds = new Set()) {
  const d = data && typeof data === 'object' ? data : {};
  const custom = [], edits = {};
  const takenIds = new Set();
  for (const r of Array.isArray(d.custom) ? d.custom : []) {
    if (!r || typeof r !== 'object' || custom.length >= MAX_CUSTOM) continue;
    const id = Number.isInteger(r.id) && r.id >= CUSTOM_ID_BASE && !takenIds.has(r.id) ? r.id : null;
    const rec = fromStored(r);
    if (!rec || id === null) continue;
    rec.id = id; takenIds.add(id);
    custom.push(rec);
  }
  for (const [k, r] of Object.entries(d.edits && typeof d.edits === 'object' ? d.edits : {})) {
    const id = Number(k);
    if (!baseIds.has(id)) continue;
    const rec = fromStored(r);
    if (rec) edits[id] = rec;
  }
  const maxId = custom.reduce((m, c) => Math.max(m, c.id), CUSTOM_ID_BASE - 1);
  return { custom, edits, nextId: Math.max(maxId + 1, Number.isInteger(d.nextId) ? d.nextId : 0, CUSTOM_ID_BASE) };
}
function fromStored(r) {
  if (!r || typeof r !== 'object') return null;
  const notes = normalizeNotes(r.notes);
  if (notes.length < MIN_TONES || !Number.isInteger(r.rootPc) || r.rootPc < 0 || r.rootPc > 11) return null;
  const cands = detectChord(notes, { max: 12 });
  const cand = cands.find((c) => c.rootPc === r.rootPc);
  if (!cand) return null;
  return {
    notes, rootPc: r.rootPc, symbol: clampSymbol(r.symbol) || cand.symbol, name: typeof r.name === 'string' && r.name.trim() ? [...r.name.trim()].slice(0, 24).join('') : cand.name,
    level: Number.isInteger(r.level) && r.level >= 1 && r.level <= 5 ? r.level : null, color: validColor(r.color), shape: SHAPES.includes(r.shape) ? r.shape : 'auto', at: Number.isFinite(r.at) ? r.at : 0,
  };
}

// 名前（度数の名前）が、ほかの駒と重ならないようにする。重なったら、「②」「③」…を付ける
export function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  const circled = '②③④⑤⑥⑦⑧⑨';
  for (let i = 0; i < circled.length; i++) { const n = `${base}${circled[i]}`; if (!taken.has(n)) return n; }
  for (let i = 10; i < 1000; i++) { const n = `${base}(${i})`; if (!taken.has(n)) return n; }
  return base;
}
