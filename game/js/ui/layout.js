// 画面の大きさ・向きの判定と、スマホ向けの配置の補助（2026-11-23）。game/css/mobile.css と、同じ条件で動く。
//   縦持ち = 幅 900px 以下で、高さ 521px 以上（iPhone・iPad の縦持ち）/ 横持ち = 高さ 520px 以下で、幅 1000px 以下（iPhone など）。PC の窓を細くしても、この配置になる
import { $ } from './dom.js';

export const PHONE_QUERY = '(max-width: 900px) and (min-height: 521px), (max-height: 520px) and (max-width: 1000px)';
export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
export const isPortraitPhone = () => window.matchMedia('(max-width: 900px) and (min-height: 521px)').matches;
export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0 && /iPhone|iPad|iPod|Android/.test(navigator.userAgent);

// 上のバーの、横になぞる入れ物（overflow-x: auto）の中に、ふきだし（音のメニュー・音量のメニュー）を置くと、iPhone（Safari）では、入れ物の外が切り取られて、見えなくなる。
// スマホの配置のときだけ、ふきだしを、画面全体（#ui）の直下に移す（PC では、もとの場所 = ボタンのすぐ下のまま）
export function mountPopup(root, home) {
  const ui = $('#ui');
  if (!ui || !home) return;
  if (isPhone()) { if (root.parentElement !== ui) ui.append(root); }
  else if (root.parentElement !== home) home.append(root);
}

const visibleRect = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 ? r : null;
};

// 盤（3D）が、見える範囲: スマホで、上のバー・得点・メロディの帯・手順の帯の下から、トレイの上まで（px）。HUD が出ていないときは null（既定の位置）
// PC（スマホの配置でないとき）: 盤が見える、左右の範囲 { left, right }。左右の説明の欄（ガイド・得点の列）のあいだ。HUD が出ていないときは null
export function boardRegionX() {
  const tb = visibleRect($('#topbar'));
  if (!tb) return null;
  let left = 0, right = window.innerWidth;
  const g = visibleRect($('#guide')), sd = visibleRect($('#side'));
  if (g && g.left < window.innerWidth / 2) left = Math.max(left, g.right + 8);
  if (sd && sd.left > window.innerWidth / 2) right = Math.min(right, sd.left - 8);
  return right - left > 100 ? { left, right } : null;
}

export function boardRegion(portrait = true) {
  const tb = visibleRect($('#topbar')), tw = visibleRect($('#tray-wrap'));
  if (!tb || !tw) return null;
  let top = tb.bottom;
  for (const sel of portrait ? ['#side .score-card', '#melody-roll', '#step-bar.show'] : ['#melody-roll', '#step-bar.show']) {      // 横持ちは、得点が、右の列にあるので、盤の上には、かぶらない
    const r = visibleRect($(sel));
    if (r) top = Math.max(top, r.bottom + 4);
  }
  let bottom = tw.top - 4;
  if (portrait && document.body.classList.contains('guide-open')) {            // ガイドのシート（画面の下から立ちあがる）が開いているあいだは、盤を、そのシートの上に、収める（盤が、シートの下にかくれないように）
    const gd = visibleRect($('#guide'));
    if (gd && gd.top > top + 60) bottom = Math.min(bottom, gd.top - 4);
  }
  const region = { top, bottom };
  if (!portrait && document.body.classList.contains('guide-open')) {           // 横持ち: ガイドは、左に立つ欄。盤を、その右（得点の列の左）のあいだへ寄せる
    const gd = visibleRect($('#guide')), sd = visibleRect($('#side'));
    if (gd && gd.left < window.innerWidth / 2) {
      const left = gd.right + 8, right = sd && sd.left > window.innerWidth / 2 ? sd.left - 8 : window.innerWidth - 8;
      if (right - left > 200) { region.left = left; region.right = right; }
    }
  }
  return region;
}

// 画面が変わったときに、onChange({ phone, portrait }) を呼ぶ。上のバー・トレイの高さ・得点の下の位置を CSS 変数（--topbar-h・--tray-h・--score-bottom）にも出す（パネルの位置の計算に使う）
export function watchLayout(onChange = () => {}) {
  const root = document.documentElement;
  const update = () => {
    const phone = isPhone(), portrait = isPortraitPhone();
    document.body.classList.toggle('is-phone', phone);
    document.body.classList.toggle('is-touch', isTouchDevice());
    const tb = $('#topbar'), tw = $('#tray-wrap');
    if (tb && tb.offsetHeight) root.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
    if (tw && tw.offsetHeight) root.style.setProperty('--tray-h', `${tw.offsetHeight}px`);
    const sc = visibleRect($('#side .score-card'));
    if (sc) root.style.setProperty('--score-bottom', `${Math.round(sc.bottom)}px`); else root.style.removeProperty('--score-bottom');
    let stack = sc ? sc.bottom : 0;                                        // 得点・メロディの帯・手順の帯のうち、いちばん下（技のスタンプは、この下に出す）
    for (const sel of ['#melody-roll', '#step-bar.show']) { const r = visibleRect($(sel)); if (r) stack = Math.max(stack, r.bottom); }
    if (stack) root.style.setProperty('--stack-bottom', `${Math.round(stack)}px`); else root.style.removeProperty('--stack-bottom');
    onChange({ phone, portrait, region: phone ? boardRegion(portrait) : boardRegionX() });
  };
  const mq = window.matchMedia(PHONE_QUERY);
  if (mq.addEventListener) mq.addEventListener('change', update); else if (mq.addListener) mq.addListener(update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(update);
    for (const sel of ['#topbar', '#tray-wrap', '#side', '#side .score-card', '#melody-roll', '#step-bar', '#guide']) { const el = $(sel); if (el) ro.observe(el); }
  }
  update();
  return update;
}
