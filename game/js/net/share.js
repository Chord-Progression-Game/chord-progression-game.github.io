// リズム・コード編集の画面で作った内容（ドラム・バッキング・進行）を、ゲームに「持ち込む」ための、リンク・コード・ファイルの読み書き（2026-11-23）。DOM には触れない。
//   公開ページ（https）のゲームには、ブリッジがない。そこで、編集の画面から、リンク（…/#lib=コード）かファイル（JSON）にして、公開ページへ渡す。
//   ゲームは、受け取った内容を、ブリッジの検査（tools/rhythm_server.py の Library._clean）と同じ厳しさで検査してから、ブラウザ（localStorage の save.library）に保存する。
//   ・コード: 'j1.' + base64url(UTF-8 の JSON)。リンクの # のうしろに付けるので、サーバーには送られない（URL の # 以降は、通信に含まれない）
//   ・ファイル / 貼り付け: JSON そのもの（{"app":"chord-lines-library","v":1,"drums":[…],"backings":[…],"progressions":[…]}）
export const SHARE_APP = 'chord-lines-library';
export const SHARE_VERSION = 1;
export const LIMITS = { drum: 40, backing: 40, progression: 60 };
const LANES = 'KSPHOCRX';
const LENGTHS = [8, 16, 32];
const NAME_MAX = 20;
export const MAX_SHARE_CHARS = 400000;                  // これより長い貼り付けは、ことわる（重くなるため）
const PREFIX = { drum: 'd', backing: 'b', progression: 'p' };
const LISTS = { drum: 'drums', backing: 'backings', progression: 'progressions' };
export const KIND_LABEL = { drum: 'ドラム', backing: 'バッキング', progression: '進行' };

export const blankLibrary = () => ({ drums: [], backings: [], progressions: [], next: 1 });

// ---------------------------------------------------------------- コードの読み書き
const toB64Url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (code) => {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

// 渡す内容（{ drums, backings, progressions }。id は、入れても入れなくてもよい）→ コード
export function encodeShare(payload) {
  return `j1.${toB64Url(JSON.stringify({ app: SHARE_APP, v: SHARE_VERSION, drums: payload.drums || [], backings: payload.backings || [], progressions: payload.progressions || [] }))}`;
}

// リンク・コード・JSON の文字 → { ok: true, data } か { ok: false, error }。data は、まだ検査していない（sanitizeShared にかける）
export function decodeShare(text) {
  let t = String(text || '').trim();
  if (!t) return { ok: false, error: 'リンクかコードを、貼り付けてください' };
  if (t.length > MAX_SHARE_CHARS) return { ok: false, error: '内容が大きすぎます' };
  const at = t.indexOf('#lib=');
  if (at >= 0) t = t.slice(at + 5).trim();
  else if (/^https?:\/\//i.test(t)) return { ok: false, error: 'このリンクには、取り込む内容（#lib=…）が付いていません' };
  let json = t;
  try {
    if (t.startsWith('j1.')) json = fromB64Url(t.slice(3).replace(/\s+/g, ''));
    else if (!t.startsWith('{')) return { ok: false, error: 'コードの形が正しくありません（j1. で始まる文字か、JSON です）' };
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || data.app !== SHARE_APP) return { ok: false, error: 'リズム・コード編集の画面で作った内容ではありません' };
    if (data.v !== SHARE_VERSION) return { ok: false, error: `この内容の版（${data.v}）は、このゲームでは読めません` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'コードを読めませんでした（途中で切れていないか、確かめてください）' };
  }
}

// ---------------------------------------------------------------- 検査（tools/rhythm_server.py の Library._clean と同じ決まり）
const cleanName = (s) => {
  if (typeof s !== 'string') return null;
  if ([...s].some((c) => c.codePointAt(0) < 0x20 || c.codePointAt(0) === 0x7f)) return null;     // 改行などの制御文字は、ことわる
  const name = s.split(/\s+/).filter(Boolean).join(' ');
  if (!name || [...name].length > NAME_MAX) return null;
  return name;
};
const isLength = (n) => Number.isInteger(n) && LENGTHS.includes(n);

export function cleanDrum(it) {
  if (!it || typeof it !== 'object') return null;
  const name = cleanName(it.name);
  if (!name || !isLength(it.length) || !it.lanes || typeof it.lanes !== 'object' || Array.isArray(it.lanes)) return null;
  const lanes = {};
  for (const [k, v] of Object.entries(it.lanes)) {
    if (k.length !== 1 || !LANES.includes(k) || typeof v !== 'string' || v.length !== it.length || !/^[.oxX]+$/.test(v)) return null;
    if (/[^.]/.test(v)) lanes[k] = v;
  }
  return Object.keys(lanes).length ? { name, length: it.length, lanes } : null;
}

export function cleanBacking(it) {
  if (!it || typeof it !== 'object') return null;
  const name = cleanName(it.name);
  const cells = it.cells;
  if (!name || !isLength(it.length) || typeof cells !== 'string' || cells.length !== it.length || !/^[.\-CcBbDd1234]+$/.test(cells)) return null;
  let afterHit = false;
  for (const c of cells) {
    if (c === '-') { if (!afterHit) return null; }            // 「-」（のばす）は、音か、別の「-」の直後だけ
    else afterHit = /[CcBbDd1234]/.test(c);
  }
  return /[CcBbDd1234]/.test(cells) ? { name, length: it.length, cells } : null;
}

export function cleanProgression(it, chordNames) {
  if (!it || typeof it !== 'object') return null;
  const name = cleanName(it.name);
  const chords = it.chords;
  if (!name || !Array.isArray(chords) || chords.length < 2 || chords.length > 8 || chords.some((c) => typeof c !== 'string')) return null;
  if (chordNames && chordNames.length && chords.some((c) => !chordNames.includes(c))) return null;
  const points = it.points === undefined ? 150 * chords.length : it.points;
  if (!Number.isInteger(points) || points < 50 || points > 3000) return null;
  const startAt = it.startAt === undefined ? 'head' : it.startAt;
  if (startAt !== 'head' && startAt !== 'any') return null;
  return { name, chords: chords.slice(), points, startAt };
}

// 受け取った内容 → 検査ずみの { drums, backings, progressions, skipped }（正しくないものは、とばして、数だけ返す）
export function sanitizeShared(data, chordNames) {
  const d = data && typeof data === 'object' ? data : {};
  const out = { drums: [], backings: [], progressions: [], skipped: 0 };
  const run = (list, clean, key, limit) => {
    for (const it of Array.isArray(list) ? list : []) {
      if (out[key].length >= limit) { out.skipped++; continue; }
      const c = clean(it);
      if (c) out[key].push(c); else out.skipped++;
    }
  };
  run(d.drums, cleanDrum, 'drums', LIMITS.drum);
  run(d.backings, cleanBacking, 'backings', LIMITS.backing);
  run(d.progressions, (it) => cleanProgression(it, chordNames), 'progressions', LIMITS.progression);
  return out;
}

// ---------------------------------------------------------------- ブラウザの中の保存（save.library）
// local: { drums: [{ id, name, … }], backings, progressions, next }。保存してあった内容を、検査して、きれいにする（壊れていても動くように）
export function sanitizeLocal(local, chordNames) {
  const l = local && typeof local === 'object' ? local : {};
  const out = blankLibrary();
  let maxNo = 0;
  const run = (list, clean, key, kind) => {
    const seen = new Set();
    for (const it of Array.isArray(list) ? list : []) {
      if (out[key].length >= LIMITS[kind]) break;
      const c = clean(it);
      const m = c && typeof it.id === 'string' ? new RegExp(`^${PREFIX[kind]}(\\d+)$`).exec(it.id) : null;
      if (!c || !m || seen.has(it.id) || seen.has(`n:${c.name}`)) continue;
      seen.add(it.id); seen.add(`n:${c.name}`);
      out[key].push({ id: it.id, ...c });
      maxNo = Math.max(maxNo, Number(m[1]));
    }
  };
  run(l.drums, cleanDrum, 'drums', 'drum');
  run(l.backings, cleanBacking, 'backings', 'backing');
  run(l.progressions, (it) => cleanProgression(it, chordNames), 'progressions', 'progression');
  out.next = Math.max(maxNo + 1, Number.isInteger(l.next) ? l.next : 1);
  return out;
}

// 検査ずみの受け取った内容を、いまの保存に混ぜる。同じ名前は、上書き（id はそのまま）。上限をこえるものは、とばす。戻り値: { lib, added, updated, full }
export function mergeIntoLibrary(local, incoming) {
  const lib = JSON.parse(JSON.stringify(local && local.drums ? local : blankLibrary()));
  const added = [], updated = [], full = [];
  for (const kind of ['drum', 'backing', 'progression']) {
    const list = lib[LISTS[kind]];
    for (const it of incoming[LISTS[kind]] || []) {
      const found = list.find((x) => x.name === it.name);
      if (found) { list[list.indexOf(found)] = { id: found.id, ...it }; updated.push({ kind, name: it.name }); continue; }
      if (list.length >= LIMITS[kind]) { full.push({ kind, name: it.name }); continue; }
      list.push({ id: `${PREFIX[kind]}${lib.next++}`, ...it });
      added.push({ kind, name: it.name });
    }
  }
  return { lib, added, updated, full };
}

export function removeFromLibrary(local, kind, id) {
  const lib = JSON.parse(JSON.stringify(local && local.drums ? local : blankLibrary()));
  const key = LISTS[kind];
  if (!key) return lib;
  lib[key] = lib[key].filter((x) => x.id !== id);
  return lib;
}

export const libraryCount = (lib) => (lib ? (lib.drums || []).length + (lib.backings || []).length + (lib.progressions || []).length : 0);
