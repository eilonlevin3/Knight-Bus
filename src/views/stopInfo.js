// Stops that share one stop number (the platforms of a terminal): how they are named, the ⚠
// next to them, and the pop-up that tells them apart. Docs: docs/user-flows.md#stops-that-share-a-number
// @req REQ-STOP-1 @req REQ-STOP-2

import { h } from '../lib/dom.js';
import { t, tn } from '../i18n.js';
import { track } from '../analytics.js';

// "Platform 12, floor 6" | "Platform 3" | "Floor 6" | ''
export function platformText(stop) {
  if (!stop) return '';
  return [
    stop.platform ? t('Platform {p}', { p: stop.platform }) : '',
    stop.floor ? (stop.platform ? t('floor {f}', { f: stop.floor }) : t('Floor {f}', { f: stop.floor })) : '',
  ].filter(Boolean).join(', ');
}

// "· 20277 · Platform 2" for use after a stop's name.
export function stopSuffix(stop) {
  return [stop.code, platformText(stop)].filter(Boolean).map((x) => ` · ${x}`).join('');
}

// The ⚠ button for a stop whose number is shared, or null. onPick(stop) lets the pop-up
// switch to another of the stops; leave it out where switching makes no sense.
export function stopHazard(city, stop, onPick) {
  const group = city.sameCodeStops(stop);
  if (group.length < 2) return null;
  const label = t('{n} bus stops share the number {code}', { n: group.length, code: stop.code });
  return h('button', {
    type: 'button', class: 'hazard', title: label, 'aria-label': `${label}. ${t('Details')}`,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); showStopInfo(city, stop, onPick); },
  }, '⚠');
}

export function showStopInfo(city, stop, onPick) {
  const group = city.sameCodeStops(stop);
  const labels = group.map(platformText);
  const distinct = labels.every(Boolean) && new Set(labels).size === labels.length;
  const close = () => overlay.remove();
  track('stop_info_opened', { stops: group.length, told_apart: distinct ? 1 : 0 });

  const rows = group.map((s, i) => {
    const numbers = [...new Set(city.routesAtStop(s.id).map((r) => r.label))];
    const current = s.id === stop.id;
    return h('li', { class: current ? 'current' : '' },
      h('div', { class: 'row between' },
        h('b', {}, labels[i] || t('Stop {n}', { n: i + 1 }), current ? h('span', { class: 'live-next' }, t(' · the one shown')) : null),
        !current && onPick ? h('button', { class: 'link small', onclick: () => { close(); onPick(s); } }, t('Show this one')) : null),
      h('small', { class: 'muted block' }, numbers.length ? t('Routes: {list}', { list: numbers.join(', ') }) : t("No routes in this city's data")));
  });

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Stops numbered {code}', { code: stop.code }),
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('h2', { class: 'grow' }, stop.name),
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), ' ',
        tn(group.length, '1 bus stop has the number {code}.', '{n} bus stops share the number {code}. Make sure you are at the right one.', { code: stop.code })),
      h('p', { class: 'muted small' }, distinct
        ? t('They are platforms of the same terminal. Check the platform number on the sign where you wait.')
        : t('The timetable data does not name all of them clearly. Compare the routes listed for each with the sign where you wait.')),
      h('ul', { class: 'plain same-code' }, ...rows),
      h('button', { onclick: close }, t('Close'))));
  document.body.append(overlay);
}
