// Stops that share one stop number (the platforms of a terminal): how they are named, the ⚠
// next to them, and the pop-up that tells them apart. Docs: docs/user-flows.md#stops-that-share-a-number
// @req REQ-STOP-1 @req REQ-STOP-2

import { h } from '../lib/dom.js';
import { track } from '../analytics.js';

// "Platform 12, floor 6" | "Platform 3" | "Floor 6" | ''
export function platformText(stop) {
  if (!stop) return '';
  return [stop.platform ? `Platform ${stop.platform}` : '', stop.floor ? `${stop.platform ? 'floor' : 'Floor'} ${stop.floor}` : '']
    .filter(Boolean).join(', ');
}

// "· 20277 · Platform 2" for use after a stop's name.
export function stopSuffix(stop) {
  return [stop.code, platformText(stop)].filter(Boolean).map((t) => ` · ${t}`).join('');
}

// The ⚠ button for a stop whose number is shared, or null. onPick(stop) lets the pop-up
// switch to another of the stops; leave it out where switching makes no sense.
export function stopHazard(city, stop, onPick) {
  const group = city.sameCodeStops(stop);
  if (group.length < 2) return null;
  return h('button', {
    type: 'button', class: 'hazard', title: `${group.length} bus stops share the number ${stop.code}`,
    'aria-label': `${group.length} bus stops share the number ${stop.code}. Details`,
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
    const lines = [...new Set(city.routesAtStop(s.id).map((r) => r.short))];
    const current = s.id === stop.id;
    return h('li', { class: current ? 'current' : '' },
      h('div', { class: 'row between' },
        h('b', {}, labels[i] || `Stop ${i + 1}`, current ? h('span', { class: 'live-next' }, ' · the one shown') : null),
        !current && onPick ? h('button', { class: 'link small', onclick: () => { close(); onPick(s); } }, 'Show this one') : null),
      h('small', { class: 'muted block' }, lines.length ? `Lines: ${lines.join(', ')}` : 'No lines in this city\'s data'));
  });

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Stops numbered ${stop.code}`,
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('h2', { class: 'grow' }, stop.name),
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'),
        ` ${group.length} bus stops share the number ${stop.code}. Make sure you are at the right one.`),
      h('p', { class: 'muted small' }, distinct
        ? 'They are platforms of the same terminal. Check the platform number on the sign where you wait.'
        : 'The timetable data does not name all of them clearly. Compare the lines listed for each with the sign where you wait.'),
      h('ul', { class: 'plain same-code' }, ...rows),
      h('button', { onclick: close }, 'Close')));
  document.body.append(overlay);
}
