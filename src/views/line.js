// One line in full: every route it takes, all its stops, and the schedule at any stop.
// Docs: docs/user-flows.md#5-a-route-in-full
// @req REQ-LINE-3 @req REQ-LINE-4

import { h } from '../lib/dom.js';
import { createMap, userMarker } from '../map.js';
import { loadSchedule } from '../cityData.js';
import { draggableSheet } from '../lib/sheetDrag.js';
import { track, trackDetail } from '../analytics.js';
import { lineBadge, weekendTag } from './liveInfo.js';
import { patternName, patternDifference } from './lineInfo.js';
import { stopSuffix, stopHazard } from './stopInfo.js';
import { timesAtStop } from '../lib/schedule.js';

const PATTERN_COLORS = ['#7b2cbf', '#e85d04', '#0077b6', '#2a9d8f'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export async function render(root, ctx, { cityId, routeId, stopId }) {
  const city = await ctx.getCity(cityId);
  const route = city.routes.get(routeId);
  if (!route) return ctx.go('#/home');

  const mapEl = h('div', { class: 'map' });
  const sheet = h('section', { class: 'sheet' });
  const screen = h('main', { class: 'map-screen dynamic' }, mapEl, sheet);
  root.append(screen);

  const state = {
    stop: (stopId && city.stops.get(stopId)) || null,
    showSchedule: false,
    schedule: undefined, // undefined = not loaded, null = none exists
    day: new Date().getDay(),
  };

  const first = route.patterns[0].stops[0];
  const map = createMap(mapEl, [first.lat, first.lon], 13);
  userMarker(map)(ctx.position);

  // Every route of the line: the usual one solid, the others dotted, each in its own color.
  const lines = route.patterns.map((p, i) => L.polyline(city.shapeOf(p), {
    color: PATTERN_COLORS[i % PATTERN_COLORS.length], weight: i ? 4 : 6, opacity: 0.9,
    dashArray: i ? '1 9' : null, lineCap: 'round',
  }).bindTooltip(`${patternName(i)} (${p.share}% of trips)`, { sticky: true }));
  [...lines].reverse().forEach((l) => l.addTo(map)); // usual route on top

  // Every stop of every route. A stop only some routes serve takes that route's color.
  const servedBy = new Map(); // stop id -> [pattern index]
  route.patterns.forEach((p, i) => p.stops.forEach((s) => {
    if (!servedBy.has(s.id)) servedBy.set(s.id, []);
    if (!servedBy.get(s.id).includes(i)) servedBy.get(s.id).push(i);
  }));
  const markers = new Map();
  const stopStyle = (s) => {
    const by = servedBy.get(s.id);
    const all = by.length === route.patterns.length;
    const selected = state.stop?.id === s.id;
    return {
      radius: selected ? 10 : 6, weight: selected ? 4 : 2, fillOpacity: 1,
      color: selected ? '#ffd60a' : all ? '#3c096c' : PATTERN_COLORS[by[0] % PATTERN_COLORS.length],
      fillColor: selected ? '#3c096c' : '#ffffff',
    };
  };
  for (const id of servedBy.keys()) {
    const s = city.stops.get(id);
    const m = L.circleMarker([s.lat, s.lon], stopStyle(s)).addTo(map);
    m.on('click', () => selectStop(s, true));
    markers.set(id, m);
  }

  const servedText = (s) => {
    const by = servedBy.get(s.id) || [];
    return by.length === route.patterns.length ? null : `Only the ${by.map((i) => patternName(i).toLowerCase()).join(' and ')} stops here.`;
  };

  // Pressing a stop: a small pop-up with a link to its full schedule.
  function selectStop(s, fromMap = false) {
    state.stop = s;
    state.showSchedule = false;
    for (const [id, m] of markers) m.setStyle(stopStyle(city.stops.get(id)));
    markers.get(s.id)?.bringToFront();
    const content = h('div', { class: 'stop-popup' },
      h('b', {}, s.name), h('span', { class: 'muted' }, stopSuffix(s)),
      servedText(s) ? h('small', { class: 'block' }, servedText(s)) : null,
      h('button', { class: 'link', onclick: () => { map.closePopup(); openSchedule(); } }, 'Full schedule at this stop →'));
    L.popup({ offset: [0, -6] }).setLatLng([s.lat, s.lon]).setContent(content).openOn(map);
    if (fromMap) track('line_stop_tapped');
    paint();
  }

  async function openSchedule() {
    state.showSchedule = true;
    paint();
    if (state.schedule === undefined) {
      state.schedule = route.live ? await loadSchedule(route.id) : null;
      paint();
    }
    track('schedule_opened', { has_timetable: state.schedule ? 1 : 0 });
    trackDetail('schedule_opened', { line: route.id, stop: state.stop?.id });
    sheet.querySelector('.schedule')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- Panel ----------

  function patternList() {
    if (!route.multi) return h('p', { class: 'muted small' }, 'This line always takes the same route.');
    return h('div', { class: 'stack' },
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), ' This line does not always take the same route:'),
      ...route.patterns.map((p, i) => h('div', { class: 'pattern-row' },
        h('span', { class: `pattern-swatch${i ? ' dotted' : ''}`, style: `--c:${PATTERN_COLORS[i % PATTERN_COLORS.length]}` }),
        h('span', { class: 'line-text' },
          h('span', {}, h('b', {}, patternName(i)), ` · ${p.share}% of trips · ${p.stops.length} stops`),
          ...(i > 0 ? patternDifference(route.patterns[0], p, 6).map((t) => h('small', { class: 'muted' }, t)) : [])))));
  }

  function scheduleBlock() {
    const s = state.stop;
    if (state.schedule === undefined) return h('p', { class: 'muted schedule' }, 'Loading the timetable…');
    if (!state.schedule) {
      return h('p', { class: 'muted schedule' }, route.live
        ? 'No timetable is published for this line this week.'
        : `${route.agency} publishes no timetable we can read.${route.hours ? ` It runs ${route.hours}.` : ''}`);
    }
    const times = timesAtStop(state.schedule, s.id, state.day);
    const byHour = new Map();
    for (const t of times) {
      const hour = Math.floor(t.minute / 60);
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour).push(t);
    }
    const anyVariant = times.some((t) => t.pattern > 0);
    return h('div', { class: 'schedule stack' },
      h('div', { class: 'day-tabs', role: 'tablist' }, ...DAY_NAMES.map((d, i) => h('button', {
        class: i === state.day ? 'primary' : '', role: 'tab', 'aria-selected': String(i === state.day),
        onclick: () => { state.day = i; paint(); },
      }, d))),
      times.length
        ? h('div', { class: 'hours' }, ...[...byHour.entries()].map(([hour, list]) => h('div', { class: 'hour-row' },
          h('b', {}, `${String(hour % 24).padStart(2, '0')}${hour >= 24 ? '⁺' : ''}`),
          h('span', { class: 'minutes' }, ...list.map((t) => h('span', {
            class: t.pattern ? 'variant-time' : '', title: t.pattern ? patternName(t.pattern) : hhmm(t.minute),
          }, `:${String(t.minute % 60).padStart(2, '0')}`))))))
        : h('p', { class: 'muted' }, `No trips at this stop on ${DAY_NAMES[state.day]}.`),
      h('small', { class: 'muted' },
        `${times.length} scheduled trips. Timetable times, not live.`,
        anyVariant ? ' Dotted underline = a variant route.' : '',
        [...byHour.keys()].some((x) => x >= 24) ? ' ⁺ = after midnight.' : ''));
  }

  function stopCard() {
    const s = state.stop;
    if (!s) return h('p', { class: 'muted' }, 'Tap a stop on the map to see its full schedule.');
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' },
        h('span', { class: 'stop-head' },
          h('button', { class: 'stop-title', onclick: () => map.setView([s.lat, s.lon], 17) },
            `🚏 ${s.name}`, h('span', { class: 'muted' }, stopSuffix(s))),
          stopHazard(city, s)),
        state.showSchedule ? null : h('button', { class: 'link', onclick: openSchedule }, 'Full schedule →')),
      servedText(s) ? h('small', { class: 'muted' }, servedText(s)) : null,
      state.showSchedule ? scheduleBlock() : null);
  }

  function paint() {
    const scroll = sheet.scrollTop;
    sheet.replaceChildren(...[
      h('div', { class: 'row' },
        h('button', { class: 'link', onclick: () => (history.length > 1 ? history.back() : ctx.go('#/home')) }, '← Back'),
        lineBadge(route, PATTERN_COLORS[0]),
        h('h2', { class: 'grow' }, `→ ${route.dest}`)),
      h('p', { class: 'muted small' }, route.agency, ' ', weekendTag(route)),
      stopCard(),
      patternList(),
    ].filter(Boolean));
    sheet.scrollTop = scroll;
  }

  const panel = draggableSheet(screen, sheet, { onResize: () => map.invalidateSize({ pan: false }) });
  paint();
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [24, 24] });
    if (state.stop) markers.get(state.stop.id)?.bringToFront();
  }, 0);
  track('line_map_opened', { patterns: route.patterns.length, from_stop: state.stop ? 1 : 0 });
  trackDetail('line_map_opened', { line: route.id, stop: state.stop?.id || null });

  return () => {
    panel.destroy();
    lines.forEach((l) => l.remove());
    markers.forEach((m) => m.remove());
    map.remove();
  };
}
