// Bottom panel you can drag: down for more map, up for more list. Docs: docs/user-flows.md#4-using-a-favorite-commute
// @req REQ-COMM-8
//
// - Drag the handle bar at the top of the panel, or
// - swipe down on the list while it is scrolled to the top (shrinks the panel), or
// - swipe up while the panel is not at full size (grows it before the list scrolls).
// On release it settles at the nearest size: small, half or large.

import { h } from './dom.js';
import { t } from '../i18n.js';

export function draggableSheet(screen, sheet, { snaps = [0.2, 0.5, 0.82], start = 0.5, onResize = () => {}, onSnap = () => {} } = {}) {
  const handle = h('div', { class: 'sheet-handle', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': t('Drag to resize the panel') });
  screen.insertBefore(handle, sheet);

  let height = 0; // pixels
  let frame = 0;
  const total = () => screen.clientHeight;
  const minPx = () => snaps[0] * total();
  const maxPx = () => snaps.at(-1) * total();

  function set(px, animate = false) {
    height = Math.max(minPx(), Math.min(maxPx(), px));
    screen.classList.toggle('snapping', animate);
    screen.style.setProperty('--sheet-h', `${Math.round(height)}px`);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; onResize(); });
    if (animate) setTimeout(() => { screen.classList.remove('snapping'); onResize(); }, 220);
  }

  // Settle at the nearest size; a quick flick goes one size further in its direction.
  function snap(velocity = 0) {
    const sizes = snaps.map((s) => s * total());
    let target = sizes.reduce((a, b) => (Math.abs(b - height) < Math.abs(a - height) ? b : a));
    if (Math.abs(velocity) > 0.5) {
      const bigger = sizes.filter((s) => s > height + 1);
      const smaller = sizes.filter((s) => s < height - 1);
      if (velocity < 0 && bigger.length) target = bigger[0]; // finger moving up = grow
      if (velocity > 0 && smaller.length) target = smaller.at(-1); // finger moving down = shrink
    }
    set(target, true);
    onSnap(['small', 'half', 'large'][sizes.indexOf(target)] || 'other');
  }

  // Track finger speed (px/ms, positive = moving down).
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  const track = (y) => {
    const t = performance.now();
    if (lastT) velocity = (y - lastY) / Math.max(1, t - lastT);
    lastY = y;
    lastT = t;
  };

  // 1. The handle.
  let handleStart = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    handleStart = { y: e.clientY, h: height };
    lastT = 0;
    track(e.clientY);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handleStart) return;
    track(e.clientY);
    set(handleStart.h - (e.clientY - handleStart.y));
  });
  const endHandle = () => { if (handleStart) { handleStart = null; snap(velocity); } };
  handle.addEventListener('pointerup', endHandle);
  handle.addEventListener('pointercancel', endHandle);

  // 2. Swipes on the list itself.
  let touch = null; // { y, h, mode: null | 'drag' | 'scroll' }
  sheet.addEventListener('touchstart', (e) => {
    touch = { y: e.touches[0].clientY, h: height, mode: null };
    lastT = 0;
    track(touch.y);
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!touch) return;
    const y = e.touches[0].clientY;
    const dy = y - touch.y;
    if (!touch.mode) {
      if (Math.abs(dy) < 6) return;
      const pullDownAtTop = dy > 0 && sheet.scrollTop <= 0 && height > minPx() + 1;
      const pushUpNotFull = dy < 0 && height < maxPx() - 1;
      touch.mode = pullDownAtTop || pushUpNotFull ? 'drag' : 'scroll';
      touch.y = y;
      touch.h = height;
    }
    if (touch.mode !== 'drag') return;
    e.preventDefault(); // we move the panel, not the list
    track(y);
    set(touch.h - (y - touch.y));
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (touch?.mode === 'drag') snap(velocity);
    touch = null;
  });

  const onWindowResize = () => set(height || start * total());
  window.addEventListener('resize', onWindowResize);
  set(start * total());

  return {
    destroy() {
      window.removeEventListener('resize', onWindowResize);
      cancelAnimationFrame(frame);
      handle.remove();
    },
  };
}
