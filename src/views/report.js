// Admin-only report: what commutes people save, as counts. Docs: docs/privacy.md#the-favorite-commutes-report-admin-only
// @req REQ-ANL-2 @req REQ-ANL-5

import { h } from '../lib/dom.js';
import { favoritesCollection } from '../config.js';
import { loadAllCommutes } from '../store.js';
import { summarize, MIN_PEOPLE_PER_STOP } from '../lib/report.js';

export async function render(root, ctx) {
  const body = h('div', { class: 'stack' });
  let which = favoritesCollection; // 'favorites' (real users) or 'favoritesDebug' (testers)

  const tab = (value, label) => h('button', {
    class: which === value ? 'primary' : '',
    onclick: () => { which = value; load(); },
  }, label);
  const tabs = h('div', { class: 'row' });

  const bar = (label, count, max, note = '') => h('div', { class: 'bar-row' },
    h('span', { class: 'bar-label' }, label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${max && count ? Math.max(2, (100 * count) / max) : 0}%` })),
    h('b', { class: 'bar-count' }, String(count)),
    note ? h('small', { class: 'muted' }, note) : null);
  const card = (title, ...children) => h('div', { class: 'card stack' }, h('h2', {}, title), ...children);
  const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '0%');

  async function load() {
    tabs.replaceChildren(tab('favorites', 'Real users'), tab('favoritesDebug', 'Debug testers'));
    body.replaceChildren(h('p', { class: 'muted' }, 'Counting…'));
    let r;
    try {
      r = summarize(await loadAllCommutes(which));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'error' }, `Could not load the report: ${e.message}`),
        h('p', { class: 'muted small' }, 'The database rules may need publishing again (docs/setup.md).'));
      return;
    }
    if (!r.commutes) {
      body.replaceChildren(h('p', { class: 'muted' }, 'No Favorite Commutes here yet.'));
      return;
    }

    // Line and city names come from the city data; the report itself only has ids.
    const cityName = (id) => ctx.cityIndex.cities.find((c) => c.id === id)?.name || id;
    const cities = new Map();
    for (const { cityId } of r.byCity) {
      try { cities.set(cityId, await ctx.getCity(cityId)); } catch { /* city no longer published */ }
    }
    const lineLabel = (l) => {
      const route = cities.get(l.cityId)?.routes.get(l.routeId);
      return route ? `${route.short} → ${route.dest}${route.source ? ' · weekend line' : ''}` : `Line ${l.routeId} (no longer runs)`;
    };
    const weekend = r.topLines.filter((l) => cities.get(l.cityId)?.routes.get(l.routeId)?.source).reduce((n, l) => n + l.commutes, 0);

    const topLines = r.topLines.slice(0, 20);
    body.replaceChildren(
      card('Overview',
        h('div', { class: 'stat-grid' },
          h('div', {}, h('b', {}, String(r.people)), h('small', {}, 'people with a Favorite Commute')),
          h('div', {}, h('b', {}, String(r.commutes)), h('small', {}, 'Favorite Commutes')),
          h('div', {}, h('b', {}, String(r.averageLines)), h('small', {}, 'lines per Favorite Commute, average')),
          h('div', {}, h('b', {}, String(weekend)), h('small', {}, 'uses of weekend-only lines')))),
      card('Favorite Commutes per person', ...[1, 2, 3].map((n) => bar(`${n} saved`, r.commutesPerPerson[n], r.people))),
      card('By city', ...r.byCity.map((c) => bar(cityName(c.cityId), c.count, r.commutes))),
      card('Shape of a Favorite Commute',
        bar('1 stop', r.stopsPerCommute[1], r.commutes, pct(r.stopsPerCommute[1], r.commutes)),
        bar('2 stops', r.stopsPerCommute[2], r.commutes, pct(r.stopsPerCommute[2], r.commutes)),
        bar('With a start point', r.withStart, r.commutes, pct(r.withStart, r.commutes)),
        bar('With a destination', r.withDestination, r.commutes, pct(r.withDestination, r.commutes)),
        bar('With both', r.withBoth, r.commutes, pct(r.withBoth, r.commutes))),
      card(`Most saved lines${r.topLines.length > 20 ? ' (top 20)' : ''}`,
        h('p', { class: 'muted small' }, 'Bar = different people who saved the line. Number in brackets = Favorite Commutes.'),
        ...topLines.map((l) => bar(lineLabel(l), l.people, topLines[0].people, `(${l.commutes}) · ${cityName(l.cityId)}`))),
      card('Most saved stops',
        h('p', { class: 'muted small' },
          `Only stops saved by at least ${MIN_PEOPLE_PER_STOP} different people are listed, so no stop can point to one person. Hidden: ${r.stopsHidden}.`),
        ...(r.topStops.length
          ? r.topStops.slice(0, 20).map((s) => bar(`${s.name} · ${s.code}`, s.people, r.topStops[0].people, cityName(s.cityId)))
          : [h('p', { class: 'muted' }, 'None yet.')])),
      card('Last saved, by month', ...r.byMonth.map((m) => bar(m.month, m.count, Math.max(...r.byMonth.map((x) => x.count))))),
    );
  }

  root.append(
    h('main', { class: 'screen report' },
      h('header', { class: 'topbar' },
        h('button', { class: 'link', onclick: () => ctx.go('#/home') }, '← Home'),
        h('h1', {}, 'Favorite Commutes report')),
      h('p', { class: 'muted small' }, 'Counts only. No names, emails or locations of people. For how the app is used (screens, time, active users), see Analytics in the Firebase console.'),
      tabs,
      body),
  );
  await load();
}
