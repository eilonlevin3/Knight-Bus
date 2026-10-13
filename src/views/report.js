// Admin-only report: what commutes people save, as counts. Docs: docs/privacy.md#the-favorite-commutes-report-admin-only
// @req REQ-ANL-2 @req REQ-ANL-5

import { h } from '../lib/dom.js';
import { t, tn, arrow, backArrow, cityName as localCityName } from '../i18n.js';
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
    tabs.replaceChildren(tab('favorites', t('Real users')), tab('favoritesDebug', t('Debug testers')));
    body.replaceChildren(h('p', { class: 'muted' }, t('Counting…')));
    let r;
    try {
      r = summarize(await loadAllCommutes(which));
    } catch (e) {
      body.replaceChildren(h('p', { class: 'error' }, t('Could not load the report: {error}', { error: e.message })),
        h('p', { class: 'muted small' }, t('The database rules may need publishing again (docs/setup.md).')));
      return;
    }
    if (!r.commutes) {
      body.replaceChildren(h('p', { class: 'muted' }, t('No Favorite Commutes here yet.')));
      return;
    }

    // Route and city names come from the city data; the report itself only has ids.
    const cityName = (id) => localCityName(ctx.cityIndex.cities.find((c) => c.id === id)) || id;
    const cities = new Map();
    for (const { cityId } of r.byCity) {
      try { cities.set(cityId, await ctx.getCity(cityId)); } catch { /* city no longer published */ }
    }
    // A saved id may since have been merged into another route (REQ-DATA-10).
    const routeOf = (l) => {
      const c = cities.get(l.cityId);
      return c?.routes.get(c.aliases.get(l.routeId) || l.routeId);
    };
    const lineLabel = (l) => {
      const route = routeOf(l);
      return route ? `${route.label} ${arrow()} ${route.dest}${route.source ? t(' · weekend route') : ''}` : t('Route {id} (no longer runs)', { id: l.routeId });
    };
    const weekend = r.topLines.filter((l) => routeOf(l)?.source).reduce((n, l) => n + l.commutes, 0);

    const topLines = r.topLines.slice(0, 20);
    body.replaceChildren(
      card(t('Overview'),
        h('div', { class: 'stat-grid' },
          h('div', {}, h('b', {}, String(r.people)), h('small', {}, t('people with a Favorite Commute'))),
          h('div', {}, h('b', {}, String(r.commutes)), h('small', {}, t('Favorite Commutes'))),
          h('div', {}, h('b', {}, String(r.averageLines)), h('small', {}, t('routes per Favorite Commute, average'))),
          h('div', {}, h('b', {}, String(weekend)), h('small', {}, t('uses of weekend-only routes'))))),
      card(t('Favorite Commutes per person'), ...[1, 2, 3].map((n) => bar(t('{n} saved', { n }), r.commutesPerPerson[n], r.people))),
      card(t('By city'), ...r.byCity.map((c) => bar(cityName(c.cityId), c.count, r.commutes))),
      card(t('Shape of a Favorite Commute'),
        bar(tn(1, '1 stop', '{n} stops'), r.stopsPerCommute[1], r.commutes, pct(r.stopsPerCommute[1], r.commutes)),
        bar(tn(2, '1 stop', '{n} stops'), r.stopsPerCommute[2], r.commutes, pct(r.stopsPerCommute[2], r.commutes)),
        bar(t('With a start point'), r.withStart, r.commutes, pct(r.withStart, r.commutes)),
        bar(t('With a destination'), r.withDestination, r.commutes, pct(r.withDestination, r.commutes)),
        bar(t('With both'), r.withBoth, r.commutes, pct(r.withBoth, r.commutes))),
      card(t('Most saved routes') + (r.topLines.length > 20 ? t(' (top 20)') : ''),
        h('p', { class: 'muted small' }, t('Bar = different people who saved the route. Number in brackets = Favorite Commutes.')),
        ...topLines.map((l) => bar(lineLabel(l), l.people, topLines[0].people, `(${l.commutes}) · ${cityName(l.cityId)}`))),
      card(t('Most saved stops'),
        h('p', { class: 'muted small' },
          t('Only stops saved by at least {min} different people are listed, so no stop can point to one person. Hidden: {hidden}.', { min: MIN_PEOPLE_PER_STOP, hidden: r.stopsHidden })),
        ...(r.topStops.length
          ? r.topStops.slice(0, 20).map((s) => bar(`${s.name} · ${s.code}`, s.people, r.topStops[0].people, cityName(s.cityId)))
          : [h('p', { class: 'muted' }, t('None yet.'))])),
      card(t('Last saved, by month'), ...r.byMonth.map((m) => bar(m.month, m.count, Math.max(...r.byMonth.map((x) => x.count))))),
    );
  }

  root.append(
    h('main', { class: 'screen report' },
      h('header', { class: 'topbar sticky-top' },
        h('button', { class: 'nav-button', onclick: () => ctx.go('#/home') }, `${backArrow()} ${t('Home')}`),
        h('h1', {}, t('Favorite Commutes report'))),
      h('p', { class: 'muted small' }, t('Counts only. No names, emails or locations of people. For how the app is used (screens, time, active users), see Analytics in the Firebase console.')),
      tabs,
      body),
  );
  await load();
}
