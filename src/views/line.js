// One route in full: its path on the map with every stop pattern, all its stops, a switch
// to the opposite direction, and the timetable at any stop.
// Docs: docs/user-flows.md#5-a-route-in-full
// @req REQ-LINE-3 @req REQ-LINE-4 @req REQ-LINE-1c @req REQ-ROUTE-2 @req REQ-ROUTE-3

import { h } from '../lib/dom.js';
import { t, tn, arrow, backArrow } from '../i18n.js';
import { createMap, userMarker } from '../map.js';
import { loadSchedule } from '../cityData.js';
import { draggableSheet } from '../lib/sheetDrag.js';
import { track, trackDetail } from '../analytics.js';
import { routeBadge, weekendTag } from './liveInfo.js';
import { patternName, differenceLines } from './lineInfo.js';
import { stopSuffix, stopHazard } from './stopInfo.js';
import { timesAtStop } from '../lib/schedule.js';
import { samePath } from '../lib/routeGeometry.js';

const PATTERN_COLORS = ['#7b2cbf', '#e85d04', '#0077b6', '#2a9d8f'];
const dayNames = () => [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')];
const hhmm = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export async function render(root, ctx, { cityId, routeId, stopId }) {
  const city = await ctx.getCity(cityId);
  const route = city.routes.get(routeId);
  if (!route) return ctx.go('#/home');
  const opposite = route.opposite ? city.routes.get(route.opposite) : null;

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
  const last = route.patterns[0].stops.at(-1);
  const map = createMap(mapEl, [first.lat, first.lon], 13);
  userMarker(map)(ctx.position);

  // Only this direction is drawn. Every stop pattern of it: the most common as a solid line,
  // the others dotted, each in its own color. A pattern that takes the same path as an
  // earlier one gets no line of its own (REQ-LINE-1c).
  const sameAsEarlier = route.patterns.map((p, i) =>
    route.patterns.slice(0, i).some((q) => samePath(city.shapeOf(p), city.shapeOf(q))));
  const lines = route.patterns.map((p, i) => (sameAsEarlier[i] ? null : L.polyline(city.shapeOf(p), {
    color: PATTERN_COLORS[i % PATTERN_COLORS.length], weight: i ? 4 : 6, opacity: 0.9,
    dashArray: i ? '1 9' : null, lineCap: 'round',
  }).bindTooltip(t('{name} ({share}% of trips)', { name: patternName(i), share: p.share }), { sticky: true }))).filter(Boolean);
  [...lines].reverse().forEach((l) => l.addTo(map)); // most common pattern on top

  // Every stop of every pattern. A stop only some patterns serve takes that pattern's color.
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

  const servedText = (s) => ((servedBy.get(s.id) || []).length === route.patterns.length
    ? null
    : t('Only some of the stop patterns stop here: {names}.', { names: servedBy.get(s.id).map(patternName).join(', ') }));

  // Pressing a stop: a small pop-up with a link to its full schedule.
  function selectStop(s, fromMap = false, popup = true) {
    state.stop = s;
    state.showSchedule = false;
    for (const [id, m] of markers) m.setStyle(stopStyle(city.stops.get(id)));
    markers.get(s.id)?.bringToFront();
    if (popup) {
      const content = h('div', { class: 'stop-popup' },
        h('b', {}, s.name), h('span', { class: 'muted' }, stopSuffix(s)),
        servedText(s) ? h('small', { class: 'block' }, servedText(s)) : null,
        h('button', { class: 'link', onclick: () => { map.closePopup(); openSchedule(); } }, `${t('Full schedule at this stop')} ${arrow()}`));
      L.popup({ offset: [0, -6] }).setLatLng([s.lat, s.lon]).setContent(content).openOn(map);
    }
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

  // The route's timetable: the times at its first stop, unless a stop is already chosen.
  function openTimetable() {
    if (!state.stop) selectStop(first, false, false);
    openSchedule();
  }

  // ---------- Panel ----------

  function patternList() {
    if (!route.multi) return null;
    return h('div', { class: 'stack' },
      h('p', {}, h('span', { class: 'hazard-mark' }, '⚠'), t(' This route does not always follow the same stop pattern:')),
      ...route.patterns.map((p, i) => h('div', { class: 'pattern-row' },
        h('span', { class: `pattern-swatch${i && !sameAsEarlier[i] ? ' dotted' : ''}`, style: `--c:${PATTERN_COLORS[(sameAsEarlier[i] ? 0 : i) % PATTERN_COLORS.length]}` }),
        h('span', { class: 'line-text' },
          h('span', {}, h('b', {}, patternName(i)), t(' · {share}% of trips', { share: p.share }), tn(p.stops.length, ' · 1 stop', ' · {n} stops')),
          ...(i > 0 ? differenceLines(route.patterns[0], p, city, 6).map((x) => h('small', { class: 'muted' }, x)) : []),
          sameAsEarlier[i] ? h('small', { class: 'muted' }, t('Same path as the most common pattern, so it has no line of its own.')) : null))));
  }

  function scheduleBlock() {
    const s = state.stop;
    if (state.schedule === undefined) return h('p', { class: 'muted schedule' }, t('Loading the timetable…'));
    if (!state.schedule) {
      return h('p', { class: 'muted schedule' }, route.live
        ? t('No timetable is published for this route this week.')
        : t('{agency} publishes no timetable we can read.', { agency: route.agency }) + (route.hours ? t(' It runs {hours}.', { hours: t(route.hours) }) : ''));
    }
    const times = timesAtStop(state.schedule, s.id, state.day);
    const byHour = new Map();
    for (const x of times) {
      const hour = Math.floor(x.minute / 60);
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour).push(x);
    }
    const anyOther = times.some((x) => x.pattern > 0);
    return h('div', { class: 'schedule stack' },
      h('div', { class: 'day-tabs', role: 'tablist' }, ...dayNames().map((d, i) => h('button', {
        class: i === state.day ? 'primary' : '', role: 'tab', 'aria-selected': String(i === state.day),
        onclick: () => { state.day = i; paint(); },
      }, d))),
      times.length
        ? h('div', { class: 'hours' }, ...[...byHour.entries()].map(([hour, list]) => h('div', { class: 'hour-row' },
          h('b', {}, `${String(hour % 24).padStart(2, '0')}${hour >= 24 ? '⁺' : ''}`),
          h('span', { class: 'minutes' }, ...list.map((x) => h('span', {
            class: x.pattern ? 'variant-time' : '', title: x.pattern ? patternName(x.pattern) : hhmm(x.minute),
          }, `:${String(x.minute % 60).padStart(2, '0')}`))))))
        : h('p', { class: 'muted' }, t('No trips at this stop on {day}.', { day: dayNames()[state.day] })),
      h('small', { class: 'muted' },
        tn(times.length, '1 scheduled trip. Timetable times, not live.', '{n} scheduled trips. Timetable times, not live.'),
        anyOther ? t(' Dotted underline = a less common stop pattern.') : '',
        [...byHour.keys()].some((x) => x >= 24) ? t(' ⁺ = after midnight.') : ''));
  }

  function stopCard() {
    const s = state.stop;
    if (!s) return h('p', { class: 'muted' }, t('Tap a stop on the map or in the list to see its full schedule.'));
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' },
        h('span', { class: 'stop-head' },
          h('button', { class: 'stop-title', onclick: () => map.setView([s.lat, s.lon], 17) },
            `🚏 ${s.name}`, h('span', { class: 'muted' }, stopSuffix(s))),
          stopHazard(city, s)),
        state.showSchedule ? null : h('button', { class: 'link', onclick: openSchedule }, `${t('Full schedule')} ${arrow()}`)),
      servedText(s) ? h('small', { class: 'muted' }, servedText(s)) : null,
      state.showSchedule ? scheduleBlock() : null);
  }

  // The stops of the most common pattern, in order. Tap one to choose it.
  function stopList() {
    return h('details', { class: 'stop-list' },
      h('summary', {}, tn(route.stops.length, 'Stops on this route (1)', 'Stops on this route ({n})')),
      h('ol', {}, ...route.stops.map((s) => h('li', {},
        h('button', {
          class: `link${state.stop?.id === s.id ? ' current' : ''}`,
          onclick: () => { map.setView([s.lat, s.lon], 16); selectStop(s, false); },
        }, s.name, h('span', { class: 'muted' }, stopSuffix(s)))))));
  }

  function paint() {
    const scroll = sheet.scrollTop;
    const listWasOpen = sheet.querySelector('.stop-list')?.open;
    sheet.replaceChildren(...[
      h('div', { class: 'row sticky-top' },
        h('button', { class: 'nav-button', onclick: () => (history.length > 1 ? history.back() : ctx.go('#/home')) }, `${backArrow()} ${t('Back')}`),
        routeBadge(route, PATTERN_COLORS[0]),
        h('h2', { class: 'grow' }, `${arrow()} ${route.dest}`)),
      h('p', { class: 'muted small' }, t('From {a} to {b}', { a: first.name, b: last.name }), ' · ', route.agency, ' ', weekendTag(route)),
      h('div', { class: 'row' },
        opposite
          ? h('button', {
              // Replaces this screen, so "Back" still leads to where you came from.
              onclick: () => { track('direction_switched'); location.replace(`#/line/${city.id}/${opposite.id}`); },
            }, t('⇄ Switch direction'))
          : null,
        h('button', { onclick: openTimetable }, t('🕒 Timetable'))),
      stopCard(),
      patternList(),
      stopList(),
    ].filter(Boolean));
    if (listWasOpen) sheet.querySelector('.stop-list').open = true;
    sheet.scrollTop = scroll;
  }

  const panel = draggableSheet(screen, sheet, { onResize: () => map.invalidateSize({ pan: false }) });
  let closed = false;
  paint();
  setTimeout(() => {
    if (closed) return; // left the screen already
    map.invalidateSize();
    map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [24, 24] });
    if (state.stop) markers.get(state.stop.id)?.bringToFront();
  }, 0);
  track('line_map_opened', { patterns: route.patterns.length, from_stop: state.stop ? 1 : 0 });
  trackDetail('line_map_opened', { line: route.id, stop: state.stop?.id || null });

  return () => {
    closed = true;
    panel.destroy();
    lines.forEach((l) => l.remove());
    markers.forEach((m) => m.remove());
    map.remove();
  };
}
