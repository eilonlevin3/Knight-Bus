// Search all routes of the city. Docs: docs/user-flows.md#6-search-routes
// @req REQ-ROUTE-1 @req REQ-ROUTE-2
//
// A bus line runs in two directions, which are two routes in the data. The list shows each
// line once ("A ⇄ B"); the route screen has the "Switch direction" button.

import { h } from '../lib/dom.js';
import { t, tn, arrow, backArrow, cityName } from '../i18n.js';
import { track } from '../analytics.js';
import { routeBadge, weekendTag } from './liveInfo.js';

const MAX_RESULTS = 60;

export function render(root, ctx) {
  const city = ctx.city;
  const all = city.routePairs(); // one entry per bus line: { route, opposite }
  const results = h('div', { class: 'results route-results' });
  const status = h('p', { class: 'muted small', role: 'status' });

  const row = ({ route, opposite }) => h('button', {
    class: 'result route-result',
    onclick: () => { track('route_search_opened'); ctx.go(`#/line/${city.id}/${route.id}`); },
  },
    routeBadge(route),
    h('span', { class: 'line-text' },
      // Both ends when the two directions are named differently; otherwise where it goes.
      h('span', {}, opposite && opposite.dest !== route.dest ? `${opposite.dest} ⇄ ${route.dest}` : `${arrow()} ${route.dest}`),
      // The first and last stop tell apart routes that share a number and a destination.
      h('small', { class: 'muted' }, t('From {a} to {b}', { a: route.stops[0].name, b: route.stops.at(-1).name })),
      h('small', { class: 'muted' }, route.agency, ' ', weekendTag(route))));

  function search(text) {
    const found = city.searchRoutes(text, all);
    results.replaceChildren(...found.slice(0, MAX_RESULTS).map(row));
    status.textContent = !text.trim()
      ? t('{n} routes in {city}. Type a number, a destination or an operator.', { n: all.length, city: cityName(city.meta) })
      : !found.length
        ? t('No routes match.')
        : found.length > MAX_RESULTS
          ? t('{n} routes match. Showing the first {max}.', { n: found.length, max: MAX_RESULTS })
          : tn(found.length, '1 route matches.', '{n} routes match.');
  }

  const input = h('input', {
    type: 'search', placeholder: t('Route number, destination or operator'), autofocus: true,
    oninput: () => search(input.value),
  });

  root.append(
    h('main', { class: 'screen' },
      h('header', { class: 'topbar' },
        h('button', { class: 'link', onclick: () => ctx.go('#/home') }, `${backArrow()} ${t('Home')}`),
        h('h1', {}, t('Search routes'))),
      input,
      status,
      results),
  );
  search('');
  setTimeout(() => input.focus(), 0);
}
