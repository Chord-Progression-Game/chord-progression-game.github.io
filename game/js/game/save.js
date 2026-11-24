// 進み具合の保存（ブラウザの localStorage）。使えない環境（プライベートウィンドウなど）でも、ゲームは動く。
const KEY = 'chordlines.v1';
export const DEFAULT_VOLUME = 50;       // 全体の音量の、はじめの値（%）。バーを動かしたあとは、その値が保存される。2026-11-24 に、25 → 50（バーの目盛りを2倍の見かたにした。出音は、同じ。engine.js の VOLUME_TOP）
export const VOLUME_SCALE = 2;          // 保存した音量の、目盛りの版。1（なし）= 2026-11-24 より前（これまでの目盛り）→ 2倍にして、同じ出音にする

// sound: ユーザーが選んだ音色・ビート・バッキング（null = ステージの標準）
// melody: メロディのステージの記録 { ステージの id: { best: 最高得点, stars, match: 相性（0〜1）, at } }
// trial: チャレンジステージの記録 { ステージの id: { best: 最高得点, stars, at } }
// library: 公開ページに「取り込んだ」ドラム・バッキング・進行 { drums: [{ id, name, length, lanes }], backings: [{ id, name, length, cells }], progressions: [{ id, name, chords, points, startAt }], next }（net/share.js。ブリッジのある自分のパソコンでは、使わない）
// best.challenge: タイムアタック（もとの名前は「チャレンジ」。保存ずみの記録を、そのまま使うため、キーは変えない）
// presets: ユーザーが保存した、お気に入りの進行（プリセット）[{ id, name, chords: ['ⅣM7', null, ...], melody?: [[開始, 長さ, 高さ], ...], at }]
// volume: 全体の音量（0〜100）/ volumeSet: バーを動かして決めたか（false の間は、はじめの値 DEFAULT_VOLUME。以前の版が自動で書いた 100 を、ユーザーの選びと取りちがえないため）
// volumeScale: volume の目盛りの版（2 = 2026-11-24 から。なければ、これまでの目盛り。読み込むとき、2倍にして、同じ出音にする。100 をこえるぶんは、100 で止める）
// chordbook: 自作コード・編集したコード（フリープレイ）{ custom: [{ id, notes, rootPc, symbol, name, level, color, shape, at }], edits: { もとの駒の ID: 同じ形 }, nextId }。構成音（MIDI）・ルートだけを保存して、性質は読み込むたびに作る（core/chordbook.js）
// cloudRaw: 公開ライブラリ（net/cloud.js）の、最後に受け取った内容（もとの JSON）。次に開いたとき、つながらなくても使えるように
// userMelody: フリープレイの、自分でつくった（自動でつけた）メロディ { notes: [[開始, 長さ, 高さ], ...], at }（なければ null）/ userMelodyOn: そのメロディを鳴らすか
function blank() { return { cleared: {}, trial: {}, library: { drums: [], backings: [], progressions: [], next: 1 }, discovered: [], best: { free: 0, challenge: 0 }, unlockAll: false, sound: { instrument: null, drum: null, backing: null, voicing: 'off' }, howtoSeen: false, melody: {}, presets: [], chordbook: { custom: [], edits: {}, nextId: 200 }, userMelody: null, userMelodyOn: true, cloudRaw: null, volume: DEFAULT_VOLUME, volumeSet: false, volumeScale: VOLUME_SCALE }; }

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    return Object.assign(blank(), d, { best: Object.assign(blank().best, d.best || {}), sound: Object.assign(blank().sound, d.sound || {}), melody: (d.melody && typeof d.melody === 'object') ? d.melody : {}, trial: (d.trial && typeof d.trial === 'object') ? d.trial : {}, library: d.library && typeof d.library === 'object' ? d.library : blank().library, presets: Array.isArray(d.presets) ? d.presets : [], chordbook: d.chordbook && typeof d.chordbook === 'object' ? d.chordbook : blank().chordbook, userMelody: d.userMelody && Array.isArray(d.userMelody.notes) ? d.userMelody : null, userMelodyOn: d.userMelodyOn !== false, cloudRaw: d.cloudRaw && typeof d.cloudRaw === 'object' ? d.cloudRaw : null, volumeSet: d.volumeSet === true, volumeScale: VOLUME_SCALE, volume: d.volumeSet === true && Number.isFinite(d.volume) ? Math.max(0, Math.min(100, Math.round(d.volumeScale === VOLUME_SCALE ? d.volume : d.volume * VOLUME_SCALE))) : DEFAULT_VOLUME });
  } catch (e) {
    return blank();
  }
}

export function writeSave(data) {
  try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 保存できなくても、遊べる */ }
}

export function resetSave() {
  try { window.localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ }
  return blank();
}
