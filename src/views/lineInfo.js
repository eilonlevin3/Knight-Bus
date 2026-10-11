// The ⚠ pop-up: what is special about a route that has more than one stop pattern.
// Docs: docs/user-flows.md#routes-with-more-than-one-stop-pattern
// @req REQ-LINE-1d @req REQ-LINE-2 @req REQ-HOME-3

import { h } from '../lib/dom.js';
import { t, tn, arrow } from '../i18n.js';
import { track } from '../analytics.js';
import { routeBadge, weekendTag, liveSummary } from './liveInfo.js';
import { patternSummary, patternDifference, stopNames } from '../lib/patterns.js';
import { samePath } from '../lib/routeGeometry.js';

export const patternName = (i) => (i === 0 ? t('Most common pattern') : i === 1 ? t('Other pattern') : t('Other pattern {n}', { n: i }));

// "Skips: A, B" / "Also stops at: C" for one pattern compared with the most common one.
export function differenceLines(main, pattern, city, limit = 4) {
  const d = patternDifference(main, pattern, (p) => city.shapeOf(p));
  return [
    d.skipped.length ? t('Skips: {names}', { names: stopNames(d.skipped, limit) }) : null,
    d.added.length ? t('Also stops at: {names}', { names: stopNames(d.added, limit) }) : null,
  ].filter(Boolean);
}

// The small pop-up behind a route number in the home screen's stop list: where the route
// goes, who runs it, its live buses at this stop, and a link to the full-route screen.
// live: the route's row from LiveLines (null while loading); shown: is it on the map?
// confirmLeave: a question to ask before leaving for the full-route screen (the editor).
export function showRouteCard(ctx, city, route, stop, { live = null, shown = true, confirmLeave = null } = {}) {
  const close = () => overlay.remove();
  track('route_card_opened', { multi: route.multi ? 1 : 0 });
  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('About route {n}', { n: route.short }),
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('div', { class: 'row' }, routeBadge(route), h('h2', { class: 'grow' }, `${arrow()} ${route.dest}`), weekendTag(route)),
      h('p', { class: 'muted small' }, route.agency, route.hours ? ` · ${t(route.hours)}` : ''),
      h('p', { class: 'small' }, t('From {a} to {b}', { a: route.stops[0].name, b: route.stops.at(-1).name }),
        tn(route.stops.length, ' · 1 stop', ' · {n} stops')),
      h('div', { class: 'summary-box stack' },
        h('b', {}, t('At {stop}', { stop: stop.name })),
        shown ? liveSummary(live) : h('small', { class: 'muted' }, t('Hidden from the map. Check its box to see its live buses.'))),
      route.multi
        ? h('p', { class: 'small' }, h('span', { class: 'hazard-mark' }, '⚠'), t(' This route does not always follow the same stop pattern.'), ' ',
          h('button', { class: 'link small', onclick: () => { close(); showRouteInfo(ctx, city, route, stop.id); } }, t('What is different?')))
        : null,
      h('button', {
        class: 'primary',
        onclick: () => {
          if (confirmLeave && !window.confirm(confirmLeave)) return;
          close();
          ctx.go(`#/line/${city.id}/${route.id}/${stop.id}`);
        },
      }, t('Full route: map, stops and timetable')),
      h('button', { onclick: close }, t('Close'))));
  document.body.append(overlay);
}

export function showRouteInfo(ctx, city, route, stopId) {
  const stop = stopId ? city.stops.get(stopId) : null;
  const through = stop ? city.patternsAt(route, stop.id) : route.patterns;
  const close = () => overlay.remove();
  track('line_info_opened', { patterns: route.patterns.length });

  const patternRows = route.patterns.map((p, i) => {
    const here = !stop || through.includes(p);
    return h('li', {},
      h('b', {}, `${patternName(i)}: ${t('{share}% of trips', { share: p.share })}`),
      tn(p.stops.length, ' · 1 stop', ' · {n} stops'),
      stop ? h('span', { class: here ? 'live-next' : 'muted' }, here ? t(' · stops here') : t(' · does not stop here')) : null,
      ...(i > 0 ? differenceLines(route.patterns[0], p, city).map((x) => h('small', { class: 'muted block' }, x)) : []));
  });

  // What the map shows from this stop (REQ-LINE-1a, 1b, 1c).
  const mainPath = through[0] && city.shapeOf(through[0]);
  const differentPaths = through.slice(1).some((p) => !samePath(city.shapeOf(p), mainPath));
  const drawn = !stop ? null
    : through.length === 1
      ? t('Only one stop pattern passes your stop ({name}), so only that one is drawn.', { name: patternName(route.patterns.indexOf(through[0])) })
      : differentPaths
        ? t('More than one stop pattern passes your stop. On the map the most common one is the solid line and the others are dotted.')
        : t('More than one stop pattern passes your stop, along the same streets, so the map shows one solid line for them.');
  // In short: how the patterns differ, and what it means here (REQ-LINE-1d).
  const summary = patternSummary(route, stop, (p) => city.shapeOf(p));

  const overlay = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('About route {n}', { n: route.short }),
    onclick: (e) => { if (e.target === overlay) close(); },
  },
    h('div', { class: 'card stack modal-card' },
      h('div', { class: 'row' }, routeBadge(route), h('h2', { class: 'grow' }, `${arrow()} ${route.dest}`), weekendTag(route)),
      h('p', { class: 'muted small' }, route.agency),
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), t(' This route does not always follow the same stop pattern.'),
        stop ? t(' Check that your bus stops at {stop}.', { stop: stop.name }) : ''),
      h('div', { class: 'summary-box stack' },
        h('b', {}, t('In short')),
        ...summary.map((x) => h('span', {}, x))),
      h('b', { class: 'small' }, t('The stop patterns')),
      h('ul', { class: 'plain' }, ...patternRows),
      drawn ? h('p', { class: 'muted small' }, drawn) : null,
      h('button', {
        class: 'primary',
        onclick: () => { close(); ctx.go(`#/line/${city.id}/${route.id}${stop ? `/${stop.id}` : ''}`); },
      }, t('Show the full route on the map')),
      h('p', { class: 'muted small' }, t('There you see every stop pattern of this route. Tap any stop for its full schedule.')),
      h('button', { onclick: close }, t('Close'))));
  document.body.append(overlay);
}
