// 3D の画面（three.js）: 盤・駒・再生位置・技の囲み・演出。
//   ・盤は 4×2 の8スロット（位置1〜4 が奥の段、5〜8 が手前の段。実機と同じ並び）
//   ・駒は、土台のタイル（働きの色）+ 天面の文字 + 働きを表す形（トニック=球 / サブドミナント=立方体 / ドミナント=三角錐 / 色づけ=八面体）
//     ※ 形と色の割り当ては、画面のための仮のもの（実物の駒のデザインは、あなたが決める）
//   ・ゲームの状態（盤の中身・判定）は、ここでは持たない。呼ばれた通りに、描くだけ
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { pieceLabelTexture, numberTexture, labelTexture, glowTexture, floorTexture } from './textures.js';
import { instanceKey } from '../core/tricks.js';

export const PITCH = 1.78;                        // スロットの間隔
export const FN_COLORS = { T: '#e9b93f', SD: '#4d88dc', D: '#e2573c', X: '#9b72d4', R: '#8e8a80' };
export const FN_NAMES = { T: 'トニック系（安定）', SD: 'サブドミナント系（広がり）', D: 'ドミナント系（緊張）', X: '色づけ・借用', R: 'くり返し' };

// スロット番号（0〜7）→ 盤の上の位置。0〜3 が奥の段（左から右）、4〜7 が手前の段（左から右）
export function slotPosition(i) {
  const row = i < 4 ? 0 : 1, col = i % 4;
  return new THREE.Vector3((col - 1.5) * PITCH, 0, (row - 0.5) * PITCH);
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function ringGeometry(w, h, r, t) {
  const outer = roundedRectShape(w, h, r);
  const inner = roundedRectShape(w - 2 * t, h - 2 * t, Math.max(0.01, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(8)));
  const g = new THREE.ShapeGeometry(outer, 8);
  g.rotateX(-Math.PI / 2);
  return g;
}
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// 仕上げの、ごく軽い画づくり（ふち暗く・フィルム粒子・ほんの少し色ずれ）
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.28 }, uGrain: { value: 0.016 }, uFlash: { value: new THREE.Vector3(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; uniform vec3 uFlash; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * d * 0.0;                                      // 色ずれはなし（素直な色）
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - uVignette * smoothstep(0.12, 0.62, d * 1.9);
      col += (rnd(vUv * 1400.0 + uTime) - 0.5) * uGrain;
      col += uFlash * (0.25 + d * 1.2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.timeScale = 1;
    this.parallax = new THREE.Vector2(0, 0);
    this.pieces = new Array(8).fill(null);          // スロットごとの { chord, group, state }
    this.enclosures = new Map();                    // 技の囲み（キー → Enclosure）
    this.ghosts = [];
    this.preview = null;
    this.guide = null;
    this.hover = -1;
    this.playStep = -1;
    this.bloomKick = 0;
    this.punch = 0;
    this.shake = 0;
    this.flash = new THREE.Vector3(0, 0, 0);
    this.beat = 0;
    this._labelCache = new Map();
    this._initRenderer();
    this._initScene();
    this._initBoard();
    this._initEffects();
    this.onResize();
  }

  // ---------------------------------------------------------------- 初期化
  _initRenderer() {
    // 指で遊ぶ端末（スマホ・タブレット）は、描く細かさを少し下げて、軽くする（解像度の上限 1.5倍・影の細かさ半分・ブルームなし）
    this.light = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /iPhone|iPad|iPod|Android/.test(navigator.userAgent || '');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.light, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.light ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = this.light ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;        // 色を、素直に（フィルム調に、くすませない）
    r.setClearColor(0x131210, 1);
  }

  _initScene() {
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x131210, 20, 40);
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 80);
    this.camTarget = new THREE.Vector3(0, 0.1, 0.0);
    this.shiftX = 0; this.shiftTarget = 0;                  // 画面の中の、盤の左右の位置（タイトルでは、メニューをよけて右へ）
    this.viewZoom = 1; this.viewDown = 0;                   // 盤の大きさ（1 = ふだん。大きいほど、小さく見える）と、画面の高さに対する、下へずらす割合（メロディの帯の場所を、あけるため）
    this.phoneZoom = 1; this.phoneDown = 0;                 // スマホ: 上のバー・下のトレイにはさまれた場所の、まん中に盤を置くための補正（setPhoneMode）
    this.baseFov = 36;

    // 駒のつやに、部屋の光がうつる（ごく弱い反射）。外の光は、この部屋の環境マップだけ
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;
    scene.add(new THREE.HemisphereLight(0xfff1de, 0x1b1813, 0.7));
    const key = this.keyLight = new THREE.DirectionalLight(0xfff3e2, 2.2);
    key.position.set(-5, 10, 6.5);
    key.castShadow = true; key.shadow.mapSize.set(this.light ? 1024 : 2048, this.light ? 1024 : 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 1, far: 30 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe9d0, 0.35); rim.position.set(6, 5, -7); scene.add(rim);
    this.playLight = new THREE.PointLight(0xffe2b8, 0, 7, 1.6);
    this.playLight.position.set(0, 1.4, 0);
    scene.add(this.playLight);

    // 漂う光の粒（奥行きの演出）
    const N = 140; const mp = new Float32Array(N * 3); this.motes = { pos: mp, seed: new Float32Array(N) };
    for (let i = 0; i < N; i++) { mp[i * 3] = (Math.random() - 0.5) * 26; mp[i * 3 + 1] = Math.random() * 7 + 0.3; mp[i * 3 + 2] = (Math.random() - 0.5) * 22; this.motes.seed[i] = Math.random() * 100; }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.moteMesh = new THREE.Points(mg, new THREE.PointsMaterial({ map: glowTexture(), color: 0x9fb8ff, size: 0.22, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.moteMesh.frustumCulled = false; this.moteMesh.visible = false; scene.add(this.moteMesh);       // 漂う光の粒は、やめた（飾りになるので）

    // 床
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.42; floor.receiveShadow = true;
    scene.add(floor);
  }

  _initBoard() {
    const board = this.board = new THREE.Group();
    this.scene.add(board);
    const W = 4 * PITCH + 0.9, D = 2 * PITCH + 0.9;
    const slab = new THREE.Mesh(new RoundedBoxGeometry(W, 0.4, D, 5, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x2b2823, roughness: 0.72, metalness: 0 }));
    slab.position.y = -0.22; slab.receiveShadow = true; slab.castShadow = true;
    board.add(slab);
    // 盤のふちの、細い光
    const edge = new THREE.Mesh(ringGeometry(W - 0.14, D - 0.14, 0.2, 0.025), new THREE.MeshBasicMaterial({ color: 0x7a7362, transparent: true, opacity: 0.6 }));
    edge.position.y = -0.015; board.add(edge);

    this.slotFrames = [];
    this.slotWells = [];
    for (let i = 0; i < 8; i++) {
      const p = slotPosition(i);
      const well = new THREE.Mesh(new RoundedBoxGeometry(1.52, 0.04, 1.52, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.9, metalness: 0 }));
      well.position.set(p.x, -0.012, p.z); well.receiveShadow = true; board.add(well);
      const frame = new THREE.Mesh(ringGeometry(1.52, 1.52, 0.12, 0.022), new THREE.MeshBasicMaterial({ color: 0x857e6c, transparent: true, opacity: 0.5 }));
      frame.position.set(p.x, 0.012, p.z); board.add(frame);
      this.slotFrames.push(frame); this.slotWells.push(well);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: numberTexture(String(i + 1)), transparent: true, opacity: 0.9 }));
      num.rotation.x = -Math.PI / 2; num.position.set(p.x - 0.52, 0.02, p.z - 0.86); board.add(num);
    }
    // 小節（2つの位置で1小節）の、ごく薄い囲み
    for (let b = 0; b < 4; b++) {
      const a = slotPosition(b * 2), c = slotPosition(b * 2 + 1);
      const bar = new THREE.Mesh(ringGeometry(PITCH * 2 - 0.04, PITCH - 0.02, 0.2, 0.012), new THREE.MeshBasicMaterial({ color: 0x7a7362, transparent: true, opacity: 0.22 }));
      bar.position.set((a.x + c.x) / 2, 0.006, a.z); board.add(bar);
    }
    // 読む順番の矢印（同じ段のなか）と、段をまたぐ点線
    const chevron = new THREE.Shape(); chevron.moveTo(-0.07, -0.1); chevron.lineTo(0.09, 0); chevron.lineTo(-0.07, 0.1); chevron.lineTo(-0.02, 0);
    const chevGeo = new THREE.ShapeGeometry(chevron); chevGeo.rotateX(-Math.PI / 2);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]]) {
      const pa = slotPosition(a), pb = slotPosition(b);
      const m = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0x968f7d, transparent: true, opacity: 0.55 }));
      m.position.set((pa.x + pb.x) / 2, 0.02, pa.z); board.add(m);
    }
    const zPts = [slotPosition(3).add(new THREE.Vector3(0.95, 0.02, 0)), slotPosition(3).add(new THREE.Vector3(1.25, 0.02, 0.55)),
                  new THREE.Vector3(0.9, 0.02, 0.0), new THREE.Vector3(-1.2, 0.02, 0.02),
                  slotPosition(4).add(new THREE.Vector3(-1.25, 0.02, -0.55)), slotPosition(4).add(new THREE.Vector3(-0.95, 0.02, 0))];
    const zCurve = new THREE.CatmullRomCurve3(zPts, false, 'catmullrom', 0.4);
    const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(zCurve.getPoints(46)), new THREE.PointsMaterial({ color: 0x968f7d, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
    board.add(dots);

    // 再生位置
    const ring = this.playRing = new THREE.Mesh(ringGeometry(1.72, 1.72, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xf1ebdd, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.y = 0.03; board.add(ring);
    const glow = this.playGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffd08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.025; glow.visible = false; board.add(glow);       // 光のたまりは、やめた（輪だけで、いまの位置を示す）
    // ホバー（ドラッグ中に、置ける場所を示す）
    this.hoverRing = new THREE.Mesh(ringGeometry(1.64, 1.64, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0xf1ebdd, transparent: true, opacity: 0, depthWrite: false }));
    this.hoverRing.position.y = 0.035; board.add(this.hoverRing);
    // チュートリアルの案内（置く場所）
    this.guideRing = new THREE.Mesh(ringGeometry(1.7, 1.7, 0.15, 0.07), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0, depthWrite: false }));
    this.guideRing.position.y = 0.04; board.add(this.guideRing);
    this.guideArrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0, depthWrite: false }));
    this.guideArrow.rotation.x = Math.PI; board.add(this.guideArrow);
  }

  _initEffects() {
    const w = this.canvas.clientWidth || 1280, h = this.canvas.clientHeight || 720;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.06, 0.4, 0.95);
    this.bloom.enabled = !this.light;                                  // ブルーム（ほんのり光る）は、ごくわずかなので、軽くするために、スマホでは切る
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);

    // パーティクル（光の粒）
    const N = 900;
    this.pN = N; this.pCursor = 0;
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N);
    this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.pAlpha = geo.getAttribute('aLife');
    this.pGeo = geo;
    this.particles = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute vec3 aColor; attribute float aSize; attribute float aLife; varying vec3 vC; varying float vA; uniform float uScale; void main(){ vC = aColor; vA = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(vC * (1.0 + a), a); }',
    }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.rings = [];                                // 広がる輪（衝撃波）
  }

  // ---------------------------------------------------------------- 大きさ
  onResize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 画面が細いときは、盤が入るように、カメラを引く
    const need = 8.9 / (2 * Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2)) * this.camera.aspect);
    this.camDist = Math.max(12.6, need * 1.05) * this.viewZoom * this.phoneZoom;
    const down = this.viewDown + this.phoneDown;
    if (down) this.camera.setViewOffset(w, h, 0, -Math.round(h * down), w, h); else this.camera.clearViewOffset();      // 画像全体を、下へずらす（遠近は、変えない）
    this.camera.updateProjectionMatrix();
    this.particles.material.uniforms.uScale.value = h * 0.9;
  }

  // スマホの配置（縦持ち・横持ち）: 上のバー・下のトレイにはさまれた、見える場所の、まん中に盤が来るように、少し上へ・（横持ちは）少し小さく。phone = false でもとにもどす
  setPhoneMode(phone, portrait = true) {
    this.phoneZoom = phone && !portrait ? 1.22 : 1;
    this.phoneDown = phone ? (portrait ? -0.045 : -0.075) : 0;
    this.onResize();
  }

  // 盤の見え方（メロディのステージでは、画面の上に、メロディの帯が出るので、盤を、少し小さく・下へ）。zoom: 大きいほど小さい / down: 下へずらす割合
  setView({ zoom = 1, down = 0 } = {}) {
    this.viewZoom = zoom; this.viewDown = down;
    this.onResize();
  }

  // ---------------------------------------------------------------- 駒
  _makePiece(chord) {
    const g = new THREE.Group();
    const col = new THREE.Color(chord.color || FN_COLORS[chord.fn] || FN_COLORS.X);        // 自作コード・編集したコードは、選んだ色
    const tileCol = col.clone().multiplyScalar(0.8);
    const tile = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.22, 1.34, 4, 0.09),
      new THREE.MeshStandardMaterial({ color: tileCol, roughness: 0.6, metalness: 0, emissive: col, emissiveIntensity: 0.0 }));
    tile.position.y = 0.11; tile.castShadow = true; tile.receiveShadow = true;
    g.add(tile);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: pieceLabelTexture(chord.name, chord.isRepeat ? '' : chord.symbol), transparent: true, toneMapped: false }));
    label.rotation.x = -Math.PI / 2; label.position.set(0, 0.225, 0.3);
    g.add(label);
    const shapeMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0, emissive: col, emissiveIntensity: 0 });
    const key = chord.shape || ({ T: 'sphere', SD: 'cube', D: 'cone', R: 'arrow' }[chord.fn] || 'octa');       // 形: 自分で選んだ形があれば、それ。なければ、働きの形
    let shape, h, spin = 1;
    switch (key) {
      case 'sphere': shape = new THREE.Mesh(new THREE.SphereGeometry(0.34, 36, 24), shapeMat); h = 0.34; spin = 0.2; break;
      case 'cube': shape = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.56, 0.56, 4, 0.09), shapeMat); shape.rotation.y = Math.PI / 4; h = 0.28; break;
      case 'cone': shape = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.8, 4), shapeMat); shape.rotation.y = Math.PI / 4; h = 0.4; break;
      case 'cylinder': shape = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 36), shapeMat); h = 0.31; break;
      case 'ring': shape = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 18, 44), shapeMat); h = 0.42; break;
      case 'star': {                                                  // 星: 立てた、厚みのある星
        const st = new THREE.Shape();
        for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? 0.44 : 0.19, a = Math.PI / 2 + (i * Math.PI) / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) st.moveTo(x, y); else st.lineTo(x, y); }
        st.closePath();
        const geo = new THREE.ExtrudeGeometry(st, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
        geo.translate(0, 0, -0.08);
        shape = new THREE.Mesh(geo, shapeMat); h = 0.44; spin = 0.6; break;
      }
      case 'arrow': {                                                 // 「→」: 板の上に寝かせた、平たい矢印
        const a = new THREE.Shape();
        a.moveTo(-0.42, -0.09); a.lineTo(0.12, -0.09); a.lineTo(0.12, -0.24); a.lineTo(0.44, 0); a.lineTo(0.12, 0.24); a.lineTo(0.12, 0.09); a.lineTo(-0.42, 0.09); a.closePath();
        const geo = new THREE.ExtrudeGeometry(a, { depth: 0.14, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        shape = new THREE.Mesh(geo, shapeMat); h = 0; spin = 0; break;
      }
      default: shape = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), shapeMat); shape.scale.y = 1.25; h = 0.46;
    }
    shape.position.set(0, 0.22 + h, -0.27); shape.castShadow = true;
    g.add(shape);
    g.userData = { tile, shape, shapeBaseY: shape.position.y, label, spin };
    return g;
  }

  setPiece(slot, chord, { animate = true } = {}) {
    const old = this.pieces[slot];
    if (old) { this.board.remove(old.group); this._disposeGroup(old.group); this.pieces[slot] = null; }
    if (!chord) return;
    const group = this._makePiece(chord);
    const p = slotPosition(slot);
    group.position.set(p.x, animate ? 2.6 : 0, p.z);
    group.scale.setScalar(animate ? 0.9 : 1);
    this.board.add(group);
    this.pieces[slot] = { chord, group, y: animate ? 2.6 : 0, vy: 0, t: animate ? 0 : 1, glow: 0, landed: !animate, seed: Math.random() * 6 };
  }

  _disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }

  chordAt(slot) { return this.pieces[slot] ? this.pieces[slot].chord : null; }

  // ---------------------------------------------------------------- 再生位置
  setPlayhead(step) {
    this.playStep = step;
    if (step < 0) { this.playRing.material.opacity = 0; this.playGlow.material.opacity = 0; this.playLight.intensity = 0; return; }
    const p = slotPosition(step);
    this.playRing.position.x = p.x; this.playRing.position.z = p.z;
    this.playGlow.position.x = p.x; this.playGlow.position.z = p.z;
    this.playTarget = p;
    const pc = this.pieces[step];
    if (pc) pc.glow = 1;
  }

  beatPulse(strength = 1) { this.beat = Math.max(this.beat, strength); }
  // 盤を、画面の右へ寄せる量（世界の単位。マイナス = 盤が右へ動く）
  setShift(x) { this.shiftTarget = x; }

  // ---------------------------------------------------------------- 技の囲み
  static instanceKey(ins) { return instanceKey(ins); }

  // 技の一覧が変わったとき。すでにあるものは、そのまま残す。新しく決まったものには、演出を付ける
  setAnalysis(instances, { onNew = null } = {}) {
    const want = new Map(instances.map((i) => [SceneManager.instanceKey(i), i]));
    let removed = false;
    for (const [key, enc] of this.enclosures) {
      if (!want.has(key) && !enc.dying) { enc.dying = 0.0001; removed = true; }
    }
    for (const [key, ins] of want) {
      const ex = this.enclosures.get(key);
      if (ex && !ex.dying) { ex.instance = ins; this._updateLabel(ex); continue; }
      if (ex && ex.dying) { ex.dying = 0; }
      if (!ex) {
        const enc = this._buildEnclosure(ins);
        this.enclosures.set(key, enc);
        if (onNew) onNew(ins, enc);
      }
    }
    this._layoutLabels();
  }

  _buildEnclosure(ins) {
    const color = new THREE.Color(ins.color);
    const group = new THREE.Group();
    const centers = ins.positions.map((p) => slotPosition(p));
    // 輪っか（駒のまわり）
    const frames = [];
    for (const c of centers) {
      const m = new THREE.Mesh(ringGeometry(1.64, 1.64, 0.15, 0.06), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
      m.position.set(c.x, 0.05, c.z); group.add(m); frames.push(m);
    }
    // つなぐ線（流れる光）
    let ribbon = null;
    if (centers.length > 1) {
      const pts = centers.map((c) => new THREE.Vector3(c.x, 0.075, c.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
      ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(20, pts.length * 22), 0.055, 8, false), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uColor: { value: color }, uTime: { value: 0 }, uGlow: { value: 0 }, uLen: { value: curve.getLength() } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uTime; uniform float uGlow; uniform float uLen; varying vec2 vUv; void main(){ float f = 0.5 + 0.5 * sin(vUv.x * uLen * 5.0 - uTime * 5.0); gl_FragColor = vec4(uColor * (0.8 + 0.25 * f + uGlow * 0.35), 0.95); }',
      }));
      group.add(ribbon);
    }
    // ラベル
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    label.renderOrder = 20;
    const mid = centers.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / centers.length);
    label.position.set(mid.x, 1.95, mid.z - 0.1);
    group.add(label);                                   // 位置は _layoutLabels が決める
    this.board.add(group);
    const enc = { key: SceneManager.instanceKey(ins), instance: ins, group, frames, ribbon, label, age: 0, dying: 0, glow: 0, color, mid };
    this._updateLabel(enc);
    group.scale.setScalar(0.92);
    return enc;
  }

  _updateLabel(enc) {
    const ins = enc.instance;
    const sig = `${ins.name}|${ins.sub || ''}|${ins.variant || ''}|${ins.total}|${ins.color}|${ins.chain}|${ins.comboMult}`;
    if (enc.sig === sig) return;
    enc.sig = sig;
    let lines;
    if (ins.warn) {                                                    // 「？」: 小節の頭の Ⅴ（技ではない。減点）
      lines = [{ text: '？', size: 74, color: '#f1ebdd', weight: 900 }, { text: ins.title, size: 32, color: '#aaa393', weight: 700 },
        { text: `−${-ins.total}`, size: 40, color: '#e0674d', weight: 800 }];
    } else {
      const title = ins.sub && !ins.variant ? ins.sub : ins.name;
      const sub = ins.variant || (ins.sub && ins.variant ? ins.sub : '');
      lines = [{ text: title, size: 58, color: '#f1ebdd', weight: 800 }];
      if (sub) lines.push({ text: sub, size: 36, color: ins.color, weight: 700 });
      lines.push({ text: `+${ins.total}${ins.comboMult > 1 ? `  ×${ins.comboMult}` : ''}`, size: 40, color: '#f2c14e', weight: 800 });
    }
    const { texture, aspect } = labelTexture(lines, { border: ins.color, pad: 30, bg: '#1c1a17', radius: 10, corner: 'ⓘ' });
    if (enc.label.material.map) enc.label.material.map.dispose();
    enc.label.material.map = texture; enc.label.material.needsUpdate = true;
    const h = lines.length === 3 ? 0.78 : 0.62;
    enc.label.scale.set(h * aspect, h, 1);
    enc.labelWidth = h * aspect;
    this._layoutLabels();
  }

  // ラベルは、盤の外（奥の段の上・手前の段の下）に、重ならないように並べる
  _layoutLabels() {
    const encs = [...this.enclosures.values()].filter((e) => !e.dying && e.labelWidth).sort((a, b) => a.instance.startPos - b.instance.startPos);
    const lanes = { top: [], bottom: [] };
    for (const e of encs) {
      const ps = e.instance.positions;
      const topPs = ps.filter((p) => p < 4), botPs = ps.filter((p) => p >= 4);
      const top = topPs.length >= botPs.length;
      const xs = (top ? topPs : botPs).map((p) => slotPosition(p).x);
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const w = e.labelWidth, h = e.label.scale.y;
      const group = top ? lanes.top : lanes.bottom;
      let level = 0;
      while (group.some((l) => l.level === level && Math.abs(l.x - midX) < (l.w + w) / 2 + 0.12)) level++;
      group.push({ x: midX, w, level });
      e.target = top ? new THREE.Vector3(midX, 0.7 + level * (h + 0.12), -2.4 - level * 0.3) : new THREE.Vector3(midX, 0.3 - level * (h + 0.12), 1.95 + level * 0.35);
      e.label.visible = level < 2;
      if (!e.placed) { e.label.position.copy(e.target); e.placed = true; }
    }
  }

  // 再生位置が、その技を通っているあいだ、光を強める
  highlightInstance(ins, amount = 1) {
    const enc = this.enclosures.get(SceneManager.instanceKey(ins));
    if (enc) enc.glow = Math.max(enc.glow, amount);
  }

  // ---------------------------------------------------------------- ヒント・案内・プレビュー
  setGhosts(slot, items) {
    for (const g of this.ghosts) { this.board.remove(g.sprite); g.sprite.material.map.dispose(); g.sprite.material.dispose(); }
    this.ghosts = []; this.ghostSlot = slot;
    if (slot === null || slot === undefined || !items.length) return;
    const p = slotPosition(slot);
    // おすすめ（上の段・少し大きく）と、発展（下の段・小さく）。ラベルどうしが重ならないように、幅に合わせて横に並べる
    const rows = [items.filter((it) => it.tier === 1), items.filter((it) => it.tier !== 1)];
    rows.forEach((row, r) => {
      const sprites = row.map((it) => {
        const { texture, aspect } = labelTexture([{ text: it.name, size: 62, color: it.tier === 1 ? '#ffffff' : '#cdd6ea', weight: 800 }, { text: it.symbol, size: 36, color: it.tier === 1 ? '#9fffd8' : '#9aa7c4', weight: 600 }],
          { border: it.tier === 1 ? '#66ffcc' : '#7d8db0', bg: 'rgba(10,14,22,0.55)', pad: 26 });
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: it.tier === 1 ? 0.7 : 0.4, depthTest: false, depthWrite: false, toneMapped: false }));
        const h = r === 0 ? 0.62 : 0.5;
        sprite.scale.set(h * aspect, h, 1);
        sprite.renderOrder = 15;
        return sprite;
      });
      const gap = 0.1;
      const total = sprites.reduce((s, sp) => s + sp.scale.x, 0) + gap * Math.max(0, sprites.length - 1);
      let x = Math.max(-3.2 + total / 2, Math.min(3.2 - total / 2, p.x)) - total / 2;
      sprites.forEach((sp, i) => {
        // 奥の段（1〜4番）の候補は、上に。手前の段（5〜8番）の候補は、空いている（置く）場所の上に重ねる（下は、操作の欄に隠れるため）
        if (slot >= 4) sp.position.set(x + sp.scale.x / 2, (r === 0 ? 0.62 : 0.28), p.z + (r === 0 ? -0.1 : 0.5));
        else sp.position.set(x + sp.scale.x / 2, (r === 0 ? 2.0 : 1.36), p.z + 0.2);          // 候補が増えて、横に広がる（4+5）ので、置いてある駒の頭より上に出す
        x += sp.scale.x + gap;
        this.board.add(sp);
        this.ghosts.push({ sprite: sp, base: sp.position.clone(), phase: i * 1.3 + r, tier: row[i].tier, id: row[i].id });
      });
    });
  }

  setGuide(slot) { this.guide = slot === null || slot === undefined ? null : slot; }
  // ring: 置ける場所の枠も出すか（ドラッグ中・駒を選んでいるとき）。出さないときは、駒が少し光るだけ
  setHover(slot, ring = true) { this.hover = slot; this.hoverRingOn = ring; }
  // 持ち上げた駒を、盤の上で隠す（手に持っている間）
  setPieceVisible(slot, visible) { const p = this.pieces[slot]; if (p) p.group.visible = visible; }

  // ドラッグ中、置こうとしている駒の透けたプレビュー（slot = -1 で消す）
  setPreview(slot, chord) {
    if (this.preview) { this.board.remove(this.preview.group); this._disposeGroup(this.preview.group); this.preview = null; }
    if (slot < 0 || !chord) return;
    const group = this._makePiece(chord);
    group.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.5; o.material.depthWrite = false; } });
    const p = slotPosition(slot);
    group.position.set(p.x, 0.5, p.z);
    this.board.add(group);
    this.preview = { group, slot };
  }

  // ---------------------------------------------------------------- 当たり判定
  // 画面の位置 → スロット番号（盤の外は -1）
  // ヒントの候補（盤の上の、透けた札）の上にいるか。いれば { id, slot, index }（クリックで、その駒を置く）。なければ null
  pickGhost(clientX, clientY) {
    if (!this.ghosts.length || this.ghostSlot === null || this.ghostSlot === undefined) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    this.board.updateMatrixWorld(true);
    const hits = ray.intersectObjects(this.ghosts.map((g) => g.sprite), false);
    if (!hits.length) return null;
    const index = this.ghosts.findIndex((g) => g.sprite === hits[0].object);
    return index < 0 ? null : { id: this.ghosts[index].id, slot: this.ghostSlot, index };
  }
  // 技の名前の枠（3D のラベル）の上にいるか。いれば、その技（判定の instance。「？」を含む）。なければ null（クリックで、詳細を出す）
  //   枠の画面の上の大きさに、指で押せるだけの余白（pad px）を足して、当たりにする。スマホの小さな枠でも、押しやすいように
  pickLabel(clientX, clientY, pad = 10) {
    let best = null, bd = 1e9;
    for (const e of this.enclosures.values()) {
      if (e.dying || !e.label.visible || e.label.material.opacity <= 0.35) continue;
      const r = this.labelScreenRect(e.instance);
      if (!r) continue;
      const dx = Math.abs(clientX - r.x) - r.w / 2, dy = Math.abs(clientY - r.y) - r.h / 2;
      if (dx <= pad && dy <= pad) { const d = Math.max(dx, dy); if (d < bd) { bd = d; best = e.instance; } }
    }
    return best;
  }
  // 技の枠の、画面の上の位置と大きさ（テスト・案内用）。見えない枠は null
  labelScreenRect(ins) {
    const enc = this.enclosures.get(SceneManager.instanceKey(ins));
    if (!enc || enc.dying || !enc.label.visible) return null;
    this.board.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const rect = this.canvas.getBoundingClientRect();
    const pos = enc.label.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const toScreen = (v) => { const q = v.clone().project(this.camera); return { x: rect.left + (q.x * 0.5 + 0.5) * rect.width, y: rect.top + (-q.y * 0.5 + 0.5) * rect.height }; };
    const c = toScreen(pos);
    const r = toScreen(pos.clone().addScaledVector(right, enc.label.scale.x / 2));
    const t = toScreen(pos.clone().addScaledVector(up, enc.label.scale.y / 2));
    return { x: c.x, y: c.y, w: Math.abs(r.x - c.x) * 2, h: Math.abs(t.y - c.y) * 2 };
  }
  // 指している候補を、はっきり見せる（index = -1 で、もとにもどす）
  setGhostHover(index) { this.ghosts.forEach((g, i) => { g.sprite.material.opacity = i === index ? 1 : (g.tier === 1 ? 0.7 : 0.4); }); }

  pickSlot(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return -1;
    let best = -1, bd = 1e9;
    for (let i = 0; i < 8; i++) {
      const p = slotPosition(i);
      const d = Math.max(Math.abs(hit.x - p.x), Math.abs(hit.z - p.z));
      if (d < PITCH * 0.52 && d < bd) { best = i; bd = d; }
    }
    return best;
  }

  // スロットの、画面の上の位置（ラベルや案内を、DOM で重ねるとき用）
  slotToScreen(slot, y = 0.4) {
    const p = slotPosition(slot); p.y = y;
    p.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
  }

  // ---------------------------------------------------------------- 演出
  burstAtSlot(slot, color, count = 70, power = 1) {
    const p = slotPosition(slot); const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.pCursor = (this.pCursor + 1) % this.pN;
      const a = Math.random() * Math.PI * 2, up = 1.2 + Math.random() * 3.2 * power, sp = (0.4 + Math.random() * 2.4) * power;
      this.pPos[k * 3] = p.x + (Math.random() - 0.5) * 0.5; this.pPos[k * 3 + 1] = 0.5 + Math.random() * 0.4; this.pPos[k * 3 + 2] = p.z + (Math.random() - 0.5) * 0.5;
      this.pVel[k * 3] = Math.cos(a) * sp; this.pVel[k * 3 + 1] = up; this.pVel[k * 3 + 2] = Math.sin(a) * sp;
      const hot = Math.random() < 0.3;
      this.pCol[k * 3] = hot ? 1 : c.r; this.pCol[k * 3 + 1] = hot ? 0.95 : c.g; this.pCol[k * 3 + 2] = hot ? 0.8 : c.b;
      this.pSize[k] = (0.06 + Math.random() * 0.12) * (hot ? 1.2 : 1);
      this.pMax[k] = this.pLife[k] = 0.8 + Math.random() * 0.9;
    }
    this.pGeo.getAttribute('aColor').needsUpdate = true; this.pGeo.getAttribute('aSize').needsUpdate = true;
  }

  shockwave(slot, color, size = 3.2) {
    const p = slotPosition(slot);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.66, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.08, p.z);
    this.board.add(m);
    this.rings.push({ mesh: m, t: 0, size });
  }

  kickBloom(x = 1) { this.bloomKick = Math.max(this.bloomKick, x); }
  punchCamera(x = 1) { this.punch = Math.max(this.punch, x); this.shake = Math.max(this.shake, x); }
  flashScreen(color, amount = 1) { const c = new THREE.Color(color); this.flash.set(c.r * amount, c.g * amount, c.b * amount); }

  // 駒が、鳴っているあいだ光る（再生位置が通る）
  glowPiece(slot, amount = 1) { const p = this.pieces[slot]; if (p) p.glow = Math.max(p.glow, amount); }

  // ---------------------------------------------------------------- 毎フレーム
  render(dtReal) {
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    this.time += dt;
    const t = this.time;
    this.timeScale += (1 - this.timeScale) * Math.min(1, dtReal * 6);                     // スローから、もとの速さへ

    // 駒（落ちてくる・光る・ゆれる）
    for (let i = 0; i < 8; i++) {
      const pc = this.pieces[i]; if (!pc) continue;
      const g = pc.group, ud = g.userData;
      if (!pc.landed) {
        pc.t = Math.min(1, pc.t + dt / 0.5);
        const e = easeOutBack(Math.min(1, pc.t));
        g.position.y = lerp(2.6, 0, e);
        g.scale.set(lerp(0.9, 1, pc.t), lerp(1.08, 1, pc.t), lerp(0.9, 1, pc.t));
        if (pc.t >= 1) {
          pc.landed = true; g.position.y = 0; g.scale.setScalar(1);
          const p = slotPosition(i); this.shockwave(i, 0xf1ebdd, 1.6); this.burstAtSlot(i, pc.chord.color || FN_COLORS[pc.chord.fn] || '#fff', 14, 0.5); void p;
        }
      }
      pc.glow = Math.max(0, pc.glow - dt * 2.2);
      const mat = ud.tile.material; mat.emissiveIntensity = pc.glow * 0.32 + (this.hover === i ? 0.1 : 0);
      ud.shape.material.emissiveIntensity = pc.glow * 0.4;
      ud.shape.position.y = ud.shapeBaseY + Math.sin(t * 1.6 + pc.seed) * 0.025 + pc.glow * 0.1;
      ud.shape.rotation.y += dt * (0.25 + pc.glow * 1.2) * ud.spin;
      if (pc.landed) g.scale.setScalar(1 + pc.glow * 0.045);
    }
    if (this.preview) { this.preview.group.position.y = 0.5 + Math.sin(t * 3) * 0.06; this.preview.group.rotation.y = Math.sin(t) * 0.1; }

    // 再生位置
    this.beat = Math.max(0, this.beat - dtReal * 3.2);
    if (this.playStep >= 0) {
      this.playRing.material.opacity = 0.55 + this.beat * 0.4;
      this.playGlow.material.opacity = 0;
      const p = this.playTarget || slotPosition(this.playStep);
      this.playLight.position.set(p.x, 1.5, p.z + 0.4); this.playLight.intensity = 5 + this.beat * 9;
    }
    // ホバー・案内
    const hp = this.hoverRing.material;
    if (this.hover >= 0 && this.hoverRingOn !== false) { const p = slotPosition(this.hover); this.hoverRing.position.x = p.x; this.hoverRing.position.z = p.z; hp.opacity += (0.85 - hp.opacity) * Math.min(1, dtReal * 14); } else hp.opacity += (0 - hp.opacity) * Math.min(1, dtReal * 10);
    const gm = this.guideRing.material, ga = this.guideArrow.material;
    if (this.guide !== null) {
      const p = slotPosition(this.guide);
      this.guideRing.position.x = p.x; this.guideRing.position.z = p.z;
      const pulse = 0.55 + 0.45 * Math.sin(t * 5);
      gm.opacity = 0.35 + pulse * 0.55; ga.opacity = 0.4 + pulse * 0.5;
      this.guideRing.scale.setScalar(1 + pulse * 0.03);
      this.guideArrow.position.set(p.x, 1.15 + Math.sin(t * 5) * 0.18, p.z);
    } else { gm.opacity += (0 - gm.opacity) * Math.min(1, dtReal * 10); ga.opacity += (0 - ga.opacity) * Math.min(1, dtReal * 10); }
    // スロットの枠: 駒があるところは、少し明るく
    for (let i = 0; i < 8; i++) this.slotFrames[i].material.opacity = this.pieces[i] ? 0.18 : 0.5 + 0.1 * Math.sin(t * 1.4 + i);

    // 技の囲み
    for (const [key, enc] of this.enclosures) {
      enc.age += dt;
      if (enc.dying) {
        enc.dying += dt;
        const k = Math.max(0, 1 - enc.dying / 0.3);
        enc.group.scale.setScalar(0.92 + 0.08 * k); enc.frames.forEach((f) => { f.material.opacity = 0.95 * k; });
        if (enc.ribbon) enc.ribbon.material.uniforms.uGlow.value = -1;
        enc.label.material.opacity = k;
        if (k <= 0) { this.board.remove(enc.group); this._disposeGroup(enc.group); this.enclosures.delete(key); }
        continue;
      }
      const born = Math.min(1, enc.age / 0.35);
      const s = 0.92 + 0.08 * easeOutBack(born);
      enc.group.scale.setScalar(s);
      enc.glow = Math.max(0, enc.glow - dt * 1.6);
      const base = 0.62 + 0.18 * Math.sin(t * 3 + enc.age);
      enc.frames.forEach((f) => { f.material.opacity = (base + enc.glow * 0.5) * born; });
      if (enc.ribbon) { enc.ribbon.material.uniforms.uTime.value = t; enc.ribbon.material.uniforms.uGlow.value = enc.glow; }
      enc.label.material.opacity = born;
      if (enc.target) {
        const k = Math.min(1, dtReal * 9);
        enc.label.position.x += (enc.target.x - enc.label.position.x) * k;
        enc.label.position.y += (enc.target.y + Math.sin(t * 1.5 + enc.age) * 0.03 - enc.label.position.y) * k;
        enc.label.position.z += (enc.target.z - enc.label.position.z) * k;
      }
    }
    const lift = this.guide !== null && this.ghostSlot === this.guide && this.ghostSlot < 4 ? 0.6 : 0;           // 案内の矢印と同じ場所なら、候補を上へ
    for (const g of this.ghosts) { g.sprite.position.y = g.base.y + lift + Math.sin(t * 1.8 + g.phase) * 0.06; }

    // 漂う光の粒（やめたので、動かさない）
    if (this.moteMesh.visible) { const mp = this.motes.pos, sd = this.motes.seed;
      for (let i = 0; i < sd.length; i++) { mp[i * 3 + 1] += dt * (0.08 + 0.06 * Math.sin(sd[i] + t * 0.3)); mp[i * 3] += Math.sin(t * 0.2 + sd[i]) * dt * 0.12; if (mp[i * 3 + 1] > 7.5) mp[i * 3 + 1] = 0.3; }
      this.moteMesh.geometry.getAttribute('position').needsUpdate = true; }
    // パーティクル
    const pos = this.pPos, vel = this.pVel;
    const aL = this.pAlpha.array;
    for (let k = 0; k < this.pN; k++) {
      if (this.pLife[k] <= 0) { aL[k] = 0; continue; }
      this.pLife[k] -= dt;
      vel[k * 3 + 1] -= 5.5 * dt;
      pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      if (pos[k * 3 + 1] < 0.04) { pos[k * 3 + 1] = 0.04; vel[k * 3 + 1] *= -0.3; vel[k * 3] *= 0.7; vel[k * 3 + 2] *= 0.7; }
      aL[k] = Math.max(0, this.pLife[k] / this.pMax[k]);
    }
    this.pGeo.getAttribute('position').needsUpdate = true; this.pAlpha.needsUpdate = true;
    // 広がる輪
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt / 0.7;
      const e = easeOutCubic(Math.min(1, r.t));
      r.mesh.scale.setScalar(1 + e * r.size); r.mesh.material.opacity = 0.9 * (1 - e);
      if (r.t >= 1) { this.board.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }

    // ブルーム・カメラ・仕上げ
    this.bloomKick = Math.max(0, this.bloomKick - dtReal * 2.4); this.punch = Math.max(0, this.punch - dtReal * 3); this.shake = Math.max(0, this.shake - dtReal * 4.5);
    this.bloom.strength = 0.06 + this.bloomKick * 0.22 + this.beat * 0.02;
    this.camera.fov = this.baseFov - this.punch * 2.2;
    this.camera.updateProjectionMatrix();
    const sx = (Math.random() - 0.5) * this.shake * 0.08, sy = (Math.random() - 0.5) * this.shake * 0.08;
    this.shiftX += (this.shiftTarget - this.shiftX) * Math.min(1, dtReal * 3.2);
    this.camTarget.x = this.shiftX;
    const sway = Math.sin(t * 0.23) * 0.07;
    this.camera.position.set(this.camTarget.x + this.parallax.x * 0.55 + sway + sx, this.camTarget.y + this.camDist * 0.74 + this.parallax.y * 0.3 + sy, this.camTarget.z + this.camDist * 0.62);
    this.camera.lookAt(this.camTarget);
    this.flash.multiplyScalar(Math.max(0, 1 - dtReal * 5));
    const fu = this.finish.uniforms; fu.uTime.value = t; fu.uFlash.value.copy(this.flash);
    this.composer.render();
  }
}
