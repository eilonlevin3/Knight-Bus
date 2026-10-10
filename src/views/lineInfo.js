// The ⚠ pop-up: what is special about a line that does not always take the same route.
// Docs: docs/user-flows.md#routes-with-more-than-one-stop-pattern
// @req REQ-LINE-1 @req REQ-LINE-2

import { h } from '../lib/dom.js';
import { track } from '../analytics.js';
import { lineBadge, weekendTag } from './liveInfo.js';

export const patternName = (i) => (i === 0 ? 'Usual route' : `Variant${i > 1 ? ` ${i}` : ''}`);

// How a variant differs from the usual route, in stop names.
export function patternDifference(main, pattern, limit = 4) {
  const inMain = new Set(main.stops.map((s) => s.id));
  const inPattern = new Set(pattern.stops.map((s) => s.id));
  const names = (list) => {
    const unique = [...new Map(list.map((s) => [s.id, s.name])).values()];
    return unique.slice(0, limit).join(', ') + (unique.length > limit ? ` and ${unique.length - limit} more` : '');
  };
  const skipped = main.stops.filter((s) => !inPattern.has(s.id));
  const added = pattern.stops.filter((s) => !inMain.has(s.id));
  return [
    skipped.length ? `Skips: ${names(skipped)}` : null,
    added.length ? `Also stops at: ${names(added)}` : null,
  ].filter(Boolean);
}

export function showLineInfo(ctx, city, route, stopId) {
  const stop = stopId ? city.stops.get(stopId) : null;
  const through = stop ? city.patternsAt(route, stop.id) : route.patterns;
  const close = () => overlay.remove();
  track('line_info_opened', { patterns: route.patterns.length });

  const patternRows = route.patterns.map((p, i) => {
    const here = !stop || through.includes(p);
    return h('li', {},
      h('b', {}, `${patternName(i)}: ${p.share}% of trips`),
      ` · ${p.stops.length} stops`,
      stop ? h('span', { class: here ? 'live-next' : 'muted' }, here ? ' · stops here' : ' · does not stop here') : null,
      ...(i > 0 ? patternDifference(route.patterns[0], p).map((t) => h('small', { class: 'muted block' }, t)) : []));
  });

  const drawn = !stop ? null
    : through.length > 1
      ? 'More than one of these passes your stop. On the map the most common one is the solid line and the others are dotted.'
      : `Only the ${patternName(route.patterns.indexOf(through[0])).toLowerCase()} passes your stop, so only that one is drawn.`;

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `About line ${route.short}`,
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('div', { class: 'row' }, lineBadge(route), h('h2', { class: 'grow' }, `→ ${route.dest}`), weekendTag(route)),
      h('p', { class: 'muted small' }, route.agency),
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), ' This line does not always take the same route.',
        stop ? ` Check that your bus stops at ${stop.name}.` : ''),
      h('ul', { class: 'plain' }, ...patternRows),
      drawn ? h('p', { class: 'muted small' }, drawn) : null,
      h('button', {
        class: 'primary',
        onclick: () => { close(); ctx.go(`#/line/${city.id}/${route.id}${stop ? `/${stop.id}` : ''}`); },
      }, 'Show the full line on the map'),
      h('p', { class: 'muted small' }, 'There you see every route of this line. Tap any stop for its full schedule.'),
      h('button', { onclick: close }, 'Close')));
  document.body.append(overlay);
}
