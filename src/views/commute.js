// Open a favorite commute: its stops, chosen lines and live buses. Docs: docs/user-flows.md#4-using-a-favorite
// @req REQ-COMM-1

import { h } from '../lib/dom.js';
import { createMap, stopLayer, userMarker } from '../map.js';
import { watchPosition } from '../location.js';
import { LiveLines } from '../liveLines.js';
import { liveSummary, lineBadge } from './liveInfo.js';

export async function render(root, ctx, { slot }) {
  const fav = ctx.favorites[slot];
  if (!fav) return ctx.go(`#/edit/${slot}`);
  const city = await ctx.getCity(fav.cityId);

  const mapEl = h('div', { class: 'map' });
  const sheet = h('section', { class: 'sheet' });
  root.append(h('main', { class: 'map-screen' }, mapEl, sheet));

  const first = city.stops.get(fav.stops[0]?.stopId);
  const map = createMap(mapEl, first ? [first.lat, first.lon] : city.meta.center, 15);
  const showMe = userMarker(map);
  showMe(ctx.position);
  const stopWatch = watchPosition((p) => { ctx.position = p; showMe(p); });
  const stops = stopLayer(map, city, { selectedIds: () => fav.stops.map((s) => s.stopId) });

  let rows = [];
  let updatedAt = null;
  const lines = new LiveLines(map, city, {
    onUpdate: (r) => { rows = r; updatedAt = new Date(); paint(); },
  });
  lines.set(fav.stops.flatMap((s) => s.routeIds.map((routeId) => ({ stopId: s.stopId, routeId }))));
  lines.fit();

  function paint() {
    const sections = fav.stops.map((st) => {
      const stop = city.stops.get(st.stopId);
      const stopRows = st.routeIds.map((id) => {
        const route = city.routes.get(id);
        if (!route) return h('div', { class: 'line-row' }, h('small', { class: 'muted' }, `Line ${id} no longer runs.`));
        const live = rows.find((r) => r.stop.id === st.stopId && r.route.id === id);
        return h('div', { class: 'line-row on' },
          lineBadge(route, lines.colorOf(id)),
          h('span', { class: 'line-text' }, h('span', {}, `→ ${route.dest}`), liveSummary(live)));
      });
      return h('div', { class: 'stop-section' },
        h('button', {
          class: 'stop-title',
          onclick: () => stop && map.setView([stop.lat, stop.lon], 17),
        }, `🚏 ${st.stopName}`, h('span', { class: 'muted' }, ` · ${st.stopCode}`)),
        ...stopRows);
    });

    sheet.replaceChildren(
      h('div', { class: 'row between' },
        h('button', { class: 'link', onclick: () => ctx.go('#/menu') }, '← Menu'),
        h('h2', {}, fav.name),
        h('button', { class: 'link', onclick: () => ctx.go(`#/edit/${slot}`) }, '✎ Edit')),
      ...sections,
      h('div', { class: 'row between' },
        h('small', { class: 'muted' }, updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 30 s` : 'Loading…'),
        h('button', { class: 'link small', onclick: () => lines.refresh() }, '↻ Refresh')),
    );
  }

  paint();
  setTimeout(() => map.invalidateSize(), 0);

  return () => {
    stopWatch();
    lines.destroy();
    stops.destroy();
    map.remove();
  };
}
