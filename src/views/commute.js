// Open a favorite commute: its stops, chosen lines and live buses. Docs: docs/user-flows.md#4-using-a-favorite
// @req REQ-COMM-1 @req REQ-COMM-2 @req REQ-COMM-3 @req REQ-COMM-6 @req REQ-COMM-7 @req REQ-COMM-8

import { h } from '../lib/dom.js';
import { createMap, stopLayer, userMarker, flagMarker, flagHtml, legendControl, lighten, escapeHtml } from '../map.js';
import { watchPosition } from '../location.js';
import { LiveLines } from '../liveLines.js';
import { approachPath } from '../lib/routeGeometry.js';
import { liveSummary, lineBadge } from './liveInfo.js';

const SHEET_MAX = 0.5; // panel height at the top of the list, share of the screen
const SHEET_MIN = 0.25; // ...after scrolling down

export async function render(root, ctx, { slot }) {
  const fav = ctx.favorites[slot];
  if (!fav) return ctx.go(`#/edit/${slot}`);
  const city = await ctx.getCity(fav.cityId);

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
  const lines = new LiveLines(map, city, {
    onUpdate: (r) => { rows = r; updatedAt = new Date(); paint(); },
  });
  all.forEach((e) => lines.colorOf(e.routeId)); // fixed colors, even while some are hidden

  function show() {
    lines.set(all.filter((e) => !hidden.has(key(e))));
    paintLegend();
    paint();
  }

  function paintLegend() {
    const items = lines.legendItems().map(({ route, color }) =>
      `<div class="legend-row"><span class="legend-swatch" style="--in:${lighten(color, 0.45)};--out:${color}"></span>` +
      `<b>${escapeHtml(route.short)}</b> <span class="legend-dest">${escapeHtml(route.dest)}</span></div>`);
    const placeRows = ['origin', 'destination'].filter((k) => fav[k]).map((k) =>
      `<div class="legend-row"><span class="legend-flag">${flagHtml(k)}</span>${k === 'origin' ? 'Start' : 'Destination'}</div>`);
    const help = items.length
      ? '<div class="legend-help"><span class="legend-swatch demo"></span> to stop → from stop</div>' +
        '<div class="legend-help"><span class="legend-bus"></span> next <span class="legend-bus passed"></span> passed</div>'
      : '';
    legend.update(items.join('') + placeRows.join('') + help);
  }

  // Start zoomed to: start point, destination, the chosen stops, and each chosen line's
  // last ~5 minutes before reaching its stop (where the bus you are waiting for is now).
  function fitCommute() {
    const pts = [];
    for (const f of ['origin', 'destination']) if (fav[f]) pts.push([fav[f].lat, fav[f].lon]);
    for (const e of all) {
      const route = city.routes.get(e.routeId);
      const idx = route ? route.stops.findIndex((s) => s.id === e.stopId) : -1;
      if (idx < 0) continue;
      pts.push(...approachPath(route, city.shapeOf(route), idx, 5));
    }
    for (const st of fav.stops) {
      const s = city.stops.get(st.stopId);
      if (s) pts.push([s.lat, s.lon]);
    }
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
        if (!route) return h('div', { class: 'line-row' }, h('small', { class: 'muted' }, `Line ${id} no longer runs.`));
        const k = key({ stopId: st.stopId, routeId: id });
        const on = !hidden.has(k);
        const live = on ? rows.find((r) => r.stop.id === st.stopId && r.route.id === id) : null;
        return h('label', { class: `line-row ${on ? 'on' : 'off'}` },
          h('input', {
            type: 'checkbox',
            checked: on,
            'aria-label': `Show line ${route.short} on the map`,
            onchange: (e) => { if (e.target.checked) hidden.delete(k); else hidden.add(k); show(); },
          }),
          lineBadge(route, on ? lines.colorOf(id) : null),
          h('span', { class: 'line-text' },
            h('span', {}, `→ ${route.dest}`),
            on ? liveSummary(live) : h('small', { class: 'muted' }, 'Hidden from the map')));
      });
      return h('div', { class: 'stop-section' },
        h('button', {
          class: 'stop-title',
          onclick: () => stop && map.setView([stop.lat, stop.lon], 17),
        }, `🚏 ${st.stopName}`, h('span', { class: 'muted' }, ` · ${st.stopCode}`)),
        ...stopRows);
    });

    const scroll = sheet.scrollTop;
    sheet.replaceChildren(
      h('div', { class: 'row between' },
        h('button', { class: 'link', onclick: () => ctx.go('#/menu') }, '← Menu'),
        h('h2', {}, fav.name),
        h('button', { class: 'link', onclick: () => ctx.go(`#/edit/${slot}`) }, '✎ Edit')),
      h('p', { class: 'muted small' }, 'Uncheck a line to hide it here. Your favorite stays the same.'),
      ...sections,
      h('div', { class: 'row between' },
        h('small', { class: 'muted' }, updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 30 s` : 'Loading…'),
        h('button', { class: 'link small', onclick: () => lines.refresh() }, '↻ Refresh')),
      h('div', { class: 'sheet-spacer' }),
    );
    sheet.scrollTop = scroll;
  }

  // Scrolling the list down gives the map more of the screen; scrolling back up returns it.
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const vh = screen.clientHeight;
      const height = Math.max(SHEET_MIN * vh, SHEET_MAX * vh - sheet.scrollTop);
      if (Math.abs(height - sheet.offsetHeight) < 2) return;
      screen.style.setProperty('--sheet-h', `${Math.round(height)}px`);
      map.invalidateSize({ pan: false });
    });
  };
  sheet.addEventListener('scroll', onScroll, { passive: true });

  show();
  setTimeout(() => { map.invalidateSize(); fitCommute(); }, 0);

  return () => {
    sheet.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
    stopWatch();
    lines.destroy();
    legend.remove();
    flags.forEach((m) => m.remove());
    stops.destroy();
    map.remove();
  };
}
