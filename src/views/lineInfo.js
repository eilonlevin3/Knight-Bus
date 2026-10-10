// The ⚠ pop-up: what is special about a line that does not always take the same route.
// Docs: docs/user-flows.md#routes-with-more-than-one-stop-pattern
// @req REQ-LINE-1d @req REQ-LINE-2

import { h } from '../lib/dom.js';
import { track } from '../analytics.js';
import { lineBadge, weekendTag } from './liveInfo.js';
import { patternSummary, patternDifference } from '../lib/patterns.js';
import { samePath } from '../lib/routeGeometry.js';

export const patternName = (i) => (i === 0 ? 'Usual route' : `Variant${i > 1 ? ` ${i}` : ''}`);

// "Skips: A, B" / "Also stops at: C" for one pattern compared with the most common one.
export function differenceLines(main, pattern, city, limit = 4) {
  const d = patternDifference(main, pattern, (p) => city.shapeOf(p));
  const names = (list) => {
    const unique = [...new Map(list.map((s) => [s.id, s.name])).values()];
    return unique.slice(0, limit).join(', ') + (unique.length > limit ? ` and ${unique.length - limit} more` : '');
  };
  return [
    d.skipped.length ? `Skips: ${names(d.skipped)}` : null,
    d.added.length ? `Also stops at: ${names(d.added)}` : null,
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
      ...(i > 0 ? differenceLines(route.patterns[0], p, city).map((t) => h('small', { class: 'muted block' }, t)) : []));
  });

  // What the map shows from this stop (REQ-LINE-1a, 1b, 1c).
  const mainPath = through[0] && city.shapeOf(through[0]);
  const differentPaths = through.slice(1).some((p) => !samePath(city.shapeOf(p), mainPath));
  const drawn = !stop ? null
    : through.length === 1
      ? `Only the ${patternName(route.patterns.indexOf(through[0])).toLowerCase()} passes your stop, so only that one is drawn.`
      : differentPaths
        ? 'More than one of these passes your stop. On the map the most common one is the solid line and the others are dotted.'
        : 'More than one of these passes your stop, along the same streets, so the map shows one solid line for them.';
  // In short: how the patterns differ, and what it means here (REQ-LINE-1d).
  const summary = patternSummary(route, stop, (p) => city.shapeOf(p));

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `About line ${route.short}`,
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('div', { class: 'row' }, lineBadge(route), h('h2', { class: 'grow' }, `→ ${route.dest}`), weekendTag(route)),
      h('p', { class: 'muted small' }, route.agency),
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), ' This line does not always take the same route.',
        stop ? ` Check that your bus stops at ${stop.name}.` : ''),
      h('div', { class: 'summary-box stack' },
        h('b', {}, 'In short'),
        ...summary.map((t) => h('span', {}, t))),
      h('b', { class: 'small' }, 'The patterns'),
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
