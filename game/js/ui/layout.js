// 画面の大きさ・向きの判定と、スマホ向けの配置の補助（2026-11-23）。game/css/mobile.css と、同じ条件で動く。
//   縦持ち = 幅 700px 以下 / 横持ち = 高さ 520px 以下で、幅 1000px 以下（iPhone など）。PC の窓を細くしても、この配置になる
import { $ } from './dom.js';

export const PHONE_QUERY = '(max-width: 700px), (max-height: 520px) and (max-width: 1000px)';
export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
export const isPortraitPhone = () => window.matchMedia('(max-width: 700px)').matches;
export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0 && /iPhone|iPad|iPod|Android/.test(navigator.userAgent);

// 画面が変わったときに、onChange({ phone, portrait }) を呼ぶ。上のバー・トレイの高さを CSS 変数（--topbar-h・--tray-h）にも出す（パネルの位置の計算に使う）
export function watchLayout(onChange = () => {}) {
  const root = document.documentElement;
  const update = () => {
    const phone = isPhone(), portrait = isPortraitPhone();
    document.body.classList.toggle('is-phone', phone);
    document.body.classList.toggle('is-touch', isTouchDevice());
    const tb = $('#topbar'), tw = $('#tray-wrap');
    if (tb && tb.offsetHeight) root.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
    if (tw && tw.offsetHeight) root.style.setProperty('--tray-h', `${tw.offsetHeight}px`);
    onChange({ phone, portrait });
  };
  const mq = window.matchMedia(PHONE_QUERY);
  if (mq.addEventListener) mq.addEventListener('change', update); else if (mq.addListener) mq.addListener(update);
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  if (window.ResizeObserver) { const ro = new ResizeObserver(update); const tb = $('#topbar'), tw = $('#tray-wrap'); if (tb) ro.observe(tb); if (tw) ro.observe(tw); }
  update();
  return update;
}
