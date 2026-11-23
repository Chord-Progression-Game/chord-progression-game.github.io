// 見た目の確認用（開発の道具）。盤に、駒と技の囲みを出して、3D の画面を確かめる。
import { SceneManager } from './render/scene.js';
import { ChordTable } from './core/chords.js';
import { analyze } from './core/tricks.js';

const table = new ChordTable(await (await fetch('./data/chords.json')).json());
const scene = new SceneManager(document.getElementById('gl'));
const spec = new URLSearchParams(location.search).get('board') || 'ⅣM7 Ⅴ7 Ⅲm7 Ⅵm7 Ⅱm7 Ⅴ7 ⅠM7 -';
const board = spec.split(/\s+/).map((n) => (n === '-' ? null : table.byName(n).id));
board.forEach((id, i) => scene.setPiece(i, id ? table.byId(id) : null, { animate: false }));
const res = analyze(board, table);
scene.setAnalysis(res.instances);
scene.setPlayhead(Number(new URLSearchParams(location.search).get('step') || 2));
if (new URLSearchParams(location.search).get('burst')) { scene.burstAtSlot(3, '#ff4fa3', 90, 1); scene.shockwave(3, 0xff4fa3); scene.kickBloom(1); }
let last = performance.now();
function frame(now) { scene.render((now - last) / 1000); last = now; window.__frames = (window.__frames || 0) + 1; requestAnimationFrame(frame); }
requestAnimationFrame(frame);
window.__scene = scene; window.__ready = true;
addEventListener('resize', () => scene.onResize());
