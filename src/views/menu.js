// Main menu with the three favorite commutes. Docs: docs/user-flows.md#2-main-menu
// @req REQ-FAV-1 @req REQ-FAV-2 @req REQ-AUTH-3

import { h } from '../lib/dom.js';
import { FAVORITE_SLOTS } from '../config.js';
import { signOut } from '../auth.js';
import { commuteName } from '../lib/names.js';
import { consent, setConsent, detailed } from '../analytics.js';
import { SAFE_SUMMARY, DEBUG_SUMMARY } from './privacy.js';

export function render(root, ctx) {
  const slots = FAVORITE_SLOTS.map((slot) => {
    const fav = ctx.favorites[slot];
    const summary = fav
      ? fav.stops.map((s) => `${s.stopName} · ${s.routeIds.length} line${s.routeIds.length === 1 ? '' : 's'}`).join('  →  ')
      : 'Tap to set up';
    return h('div', { class: `fav ${fav ? '' : 'empty'}` },
      h('button', {
        class: 'fav-main',
        onclick: () => ctx.go(fav ? `#/commute/${slot}` : `#/edit/${slot}`),
      },
        h('span', { class: 'fav-num' }, slot),
        h('span', { class: 'fav-text' },
          h('b', {}, commuteName(fav, slot)),
          h('small', {}, summary))),
      h('button', { class: 'fav-edit', 'aria-label': `Edit commute ${slot}`, onclick: () => ctx.go(`#/edit/${slot}`) }, '✎'));
  });

  // Asked once, on the menu. No answer = nothing recorded. @req REQ-ANL-3
  const ask = consent() === null
    ? h('div', { class: 'card stack consent' },
        h('b', {}, 'Help improve Knight Bus?'),
        h('small', {}, SAFE_SUMMARY),
        detailed ? h('small', { class: 'notice' }, DEBUG_SUMMARY) : null,
        h('div', { class: 'row' },
          h('button', { onclick: async () => { await setConsent(false); ask.remove(); } }, 'No thanks'),
          h('button', { class: 'primary', onclick: async () => { await setConsent(true); ask.remove(); } }, 'Share usage')),
        h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, 'Details'))
    : null;

  root.append(
    h('main', { class: 'screen' },
      h('header', { class: 'topbar' },
        h('img', { src: 'icons/icon-192.png', alt: '', width: 36, height: 36 }),
        h('h1', {}, 'Knight Bus'),
        h('button', { class: 'link small', onclick: () => ctx.go('#/city') }, `📍 ${ctx.city.meta.name}`)),
      h('section', { class: 'stack' }, h('h2', {}, 'My commutes'), ...slots),
      ask,
      h('footer', { class: 'footer' },
        h('span', { class: 'muted small' }, ctx.user.email || ctx.user.displayName),
        h('button', { class: 'link small', onclick: async () => { await signOut(); ctx.setUser(null); } }, 'Sign out'),
        h('button', { class: 'link small', onclick: () => ctx.go('#/privacy') }, 'Privacy & usage data'),
        h('span', { class: 'muted small' },
          `Bus data ${new Date(ctx.cityIndex.generatedAt).toLocaleDateString()} · Live: Ministry of Transport SIRI via Open Bus`))),
  );
}
