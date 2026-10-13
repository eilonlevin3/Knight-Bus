// Open a Favorite Commute: its stops, chosen routes and live buses. Docs: docs/user-flows.md#4-using-a-favorite-commute
// @req REQ-COMM-1 @req REQ-COMM-2 @req REQ-COMM-3 @req REQ-COMM-6 @req REQ-COMM-7 @req REQ-COMM-8

import { h } from '../lib/dom.js';
import { t, backArrow, locale } from '../i18n.js';
import { createMap, stopLayer, userMarker, flagMarker, legendControl, legendHtml } from '../map.js';
import { watchPosition } from '../location.js';
import { LiveLines } from '../liveLines.js';
import { commuteViewPoints } from '../lib/mapFit.js';
import { readView } from '../lib/savedView.js';
import { draggableSheet, PANEL_SIZES } from '../lib/sheetDrag.js';
import { commuteName } from '../lib/names.js';
import { track, trackDetail, bucket, hourOfDay, weekday } from '../analytics.js';
import { liveSummary, routeBadge, routeTitle, selectAllRow } from './liveInfo.js';
import { showRouteInfo } from './lineInfo.js';
import { platformText, stopHazard } from './stopInfo.js';

export async function render(root, ctx, { slot }) {
  const fav = ctx.favorites[slot];
  if (!fav) return ctx.go(`#/edit/${slot}`);
  const city = await ctx.getCity(fav.cityId);
  // Route ids saved before the data merged a route's alternatives still work (REQ-DATA-10).
  for (const st of fav.stops) st.routeIds = city.currentRouteIds(st.routeIds);

  const mapEl = h('div', { class: 'map' });
  const sheet = h('section', { class: 'sheet' });
  const screen = h('main', { class: 'map-screen dynamic' }, mapEl, sheet);
  root.append(screen);

  const first = city.stops.get(fav.stops[0]?.stopId);
  const map = createMap(mapEl, first ? [first.lat, first.lon] : city.meta.center, 15);
  const showMe = userMarker(map);
  showMe(ctx.position);
  const stopWatch = watchPosition((p) => { ctx.position = p; showMe(p); });
  const stops = stopLayer(map, city, { selectedIds: () => fav.stops.map((s) => s.stopId) });
  const flags = ['origin', 'destination'].filter((k) => fav[k]).map((k) => flagMarker(map, k, fav[k]));
  const legend = legendControl(map);

  // Every (stop, line) pair in the favorite. Unchecking one hides it here only; the favorite is unchanged.
  const all = fav.stops.flatMap((s) => s.routeIds.map((routeId) => ({ stopId: s.stopId, routeId })));
  const key = (e) => `${e.stopId}|${e.routeId}`;
  const hidden = new Set();

  let rows = [];
  let updatedAt = null;
  let reportedLive = false;
  const lines = new LiveLines(map, city, {
    onUpdate: (r) => {
      rows = r;
      updatedAt = new Date();
      paint();
      // Once per visit: did the live data have an answer?
      if (!reportedLive && r.length) {
        reportedLive = true;
        const withLive = r.filter((x) => !x.noLive);
        track('live_seen', {
          city: city.id, lines: bucket(r.length),
          next_buses: bucket(withLive.reduce((n, x) => n + x.next.length, 0)),
          lines_with_bus: bucket(withLive.filter((x) => x.next.length).length),
          errors: withLive.some((x) => x.error) ? 1 : 0,
        });
        trackDetail('live_seen', { slot, rows: r.map((x) => ({ stop: x.stop.id, line: x.route.id, next: x.next.map((b) => b.stopsAway), passed: x.passed.map((b) => b.stopsAway), noLive: x.noLive })) });
      }
    },
  });
  all.forEach((e) => lines.colorOf(e.routeId)); // fixed colors, even while some are hidden

  function show() {
    lines.set(all.filter((e) => !hidden.has(key(e))));
    paintLegend();
    paint();
  }

  function paintLegend() {
    legend.update(legendHtml(lines.legendItems(), fav));
  }

  // Where the map opens. The view the person chose in the editor, if any (REQ-FAV-6).
  // Otherwise: the chosen stops and about one kilometer of each chosen route coming to
  // them (REQ-COMM-2). The start point and destination are drawn, but may be out of view.
  // A chosen view also says how high the panel is and whether the map key is open.
  const ownView = readView(ctx.user, slot);
  if (ownView && ownView.keyOpen === false) legend.setOpen(false);
  function fitCommute() {
    if (ownView) return map.setView([ownView.lat, ownView.lon], ownView.zoom);
    const pts = commuteViewPoints(city, fav);
    if (!pts.length) return;
    const keyWidth = legend.width() || 0;
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [Math.min(keyWidth + 12, mapEl.offsetWidth / 2), 24],
      paddingBottomRight: [24, 24],
      maxZoom: 17,
    });
  }

  function paint() {
    const sections = fav.stops.map((st) => {
      const stop = city.stops.get(st.stopId);
      const stopRows = st.routeIds.map((id) => {
        const route = city.routes.get(id);
        if (!route) return h('div', { class: 'line-row' }, h('small', { class: 'muted' }, t('Route {id} no longer runs.', { id })));
        const k = key({ stopId: st.stopId, routeId: id });
        const on = !hidden.has(k);
        const live = on ? rows.find((r) => r.stop.id === st.stopId && r.route.id === id) : null;
        return h('label', { class: `line-row ${on ? 'on' : 'off'}` },
          h('input', {
            type: 'checkbox',
            checked: on,
            'aria-label': t('Show route {n} on the map', { n: route.short }),
            onchange: (e) => {
              if (e.target.checked) hidden.delete(k); else hidden.add(k);
              track('line_toggled', { on: e.target.checked ? 1 : 0 });
              trackDetail('line_toggled', { slot, stop: st.stopId, line: id, on: e.target.checked });
              show();
            },
          }),
          routeBadge(route, on ? lines.colorOf(id) : null),
          h('span', { class: 'line-text' },
            routeTitle(route, () => showRouteInfo(ctx, city, route, st.stopId)),
            on ? liveSummary(live) : h('small', { class: 'muted' }, t('Hidden from the map'))));
      });
      return h('div', { class: 'stop-section' },
        h('span', { class: 'stop-head' },
          h('button', {
            class: 'stop-title',
            onclick: () => stop && map.setView([stop.lat, stop.lon], 17),
          }, `🚏 ${st.stopName}`, h('span', { class: 'muted' }, ` · ${st.stopCode}${platformText(stop) ? ` · ${platformText(stop)}` : ''}`)),
          stop ? stopHazard(city, stop) : null),
        ...stopRows);
    });

    const scroll = sheet.scrollTop;
    sheet.replaceChildren(
      h('div', { class: 'row between sticky-top' },
        h('button', { class: 'nav-button', onclick: () => ctx.go('#/home') }, `${backArrow()} ${t('Home')}`),
        h('h2', {}, commuteName(fav, slot)),
        h('button', { class: 'link', onclick: () => ctx.go(`#/edit/${slot}`) }, t('✎ Edit'))),
      h('p', { class: 'muted small' }, t('Uncheck a route to hide it here. Your Favorite Commute stays the same.')),
      selectAllRow(
        () => { hidden.clear(); track('routes_select_all', { where: 'commute' }); show(); },
        () => { all.forEach((e) => hidden.add(key(e))); track('routes_clear_all', { where: 'commute' }); show(); }),
      ...sections,
      h('div', { class: 'row between' },
        h('small', { class: 'muted' }, updatedAt ? t('Updated {time} · refreshes every 30 s', { time: updatedAt.toLocaleTimeString(locale()) }) : t('Loading…')),
        h('button', { class: 'link small', onclick: () => lines.refresh() }, t('↻ Refresh'))),
    );
    sheet.scrollTop = scroll;
  }

  // Drag the panel down for more map, up for more list.
  const panel = draggableSheet(screen, sheet, {
    start: PANEL_SIZES[ownView?.panel] || PANEL_SIZES.half,
    onResize: () => map.invalidateSize({ pan: false }),
    onSnap: (size) => track('panel_dragged', { size }),
  });

  show();
  setTimeout(() => { map.invalidateSize(); fitCommute(); }, 0);
  track('commute_opened', {
    slot, city: city.id, hour: hourOfDay(), weekday: weekday(), stops: fav.stops.length, lines: bucket(all.length),
    has_start: fav.origin ? 1 : 0, has_destination: fav.destination ? 1 : 0, own_view: ownView ? 1 : 0,
  });
  trackDetail('commute_opened', { slot, commute: fav, position: ctx.position });

  return () => {
    panel.destroy();
    stopWatch();
    lines.destroy();
    legend.remove();
    flags.forEach((m) => m.remove());
    stops.destroy();
    map.remove();
  };
}
