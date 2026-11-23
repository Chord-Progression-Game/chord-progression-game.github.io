// 文字やぼかしの絵を、canvas で作って、3D の中の板（テクスチャ）にする部品。
import * as THREE from 'three';

export const FONT_STACK = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Helvetica Neue", Arial, sans-serif';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, maxAniso = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

// 駒の天面の、文字（度数の名前を大きく、コード名を小さく）
export function pieceLabelTexture(name, symbol, tint = '#ffffff') {
  const c = makeCanvas(512, 256);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = tint;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // 度数の名前は、長さに合わせて、文字の大きさを変える
  const len = [...name].length;
  const size = len <= 2 ? 150 : len <= 4 ? 116 : len <= 6 ? 88 : 72;
  g.font = `700 ${size}px ${FONT_STACK}`;
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
  g.fillText(name, 256, 150);
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.globalAlpha = 0.82;
  g.font = `600 56px ${FONT_STACK}`;
  g.fillText(symbol, 256, 224);
  return toTexture(c);
}

// 小さな番号（1〜8）
export function numberTexture(text, color = '#948d7d') {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 78px ${FONT_STACK}`;
  g.fillText(text, 64, 70);
  return toTexture(c);
}

// 3D の空間に浮かぶラベル（技の名前など）。lines: [{ text, size, color, weight }]。戻り値は、{ texture, aspect }
export function labelTexture(lines, { pad = 36, bg = 'rgba(8,10,16,0.78)', border = null, radius = 28, width = 1024, corner = null } = {}) {
  const measure = makeCanvas(8, 8).getContext('2d');
  let h = pad * 2;
  const metrics = lines.map((ln) => {
    measure.font = `${ln.weight || 700} ${ln.size}px ${FONT_STACK}`;
    const lh = Math.round(ln.size * 1.22);
    h += lh;
    return { lh, w: measure.measureText(ln.text).width };
  });
  const maxW = Math.max(...metrics.map((m) => m.w)) + pad * 2.4;
  const w = Math.min(width, Math.max(260, Math.ceil(maxW)));
  const c = makeCanvas(w, Math.ceil(h));
  const g = c.getContext('2d');
  g.beginPath();
  g.roundRect(2, 2, w - 4, c.height - 4, radius);
  g.fillStyle = bg; g.fill();
  if (border) { g.lineWidth = 5; g.strokeStyle = border; g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let y = pad;
  lines.forEach((ln, i) => {
    g.font = `${ln.weight || 700} ${ln.size}px ${FONT_STACK}`;
    g.fillStyle = ln.color || '#fff';
    g.fillText(ln.text, w / 2, y + metrics[i].lh / 2 + 2);
    y += metrics[i].lh;
  });
  if (corner) {                                                  // 右上の小さな印（「ⓘ」: 押すと詳しく読める）
    g.font = `700 34px ${FONT_STACK}`;
    g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillStyle = border || '#aaa393';
    g.fillText(corner, w - 16, 12);
  }
  return { texture: toTexture(c), aspect: c.width / c.height, width: c.width, height: c.height };
}

// やわらかい光の玉（パーティクル・光のたまり用）
export function glowTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 床: 中心が少し明るい、暗いグラデーション + ごく薄い格子
export function floorTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#221f1a'); grad.addColorStop(0.6, '#171510'); grad.addColorStop(1, '#131210');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(241,235,221,0.07)';                       // 細かい点の格子（方眼紙のように）
  const step = size / 48;
  for (let i = 0; i <= 48; i++) for (let j = 0; j <= 48; j++) g.fillRect(i * step - 1, j * step - 1, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
