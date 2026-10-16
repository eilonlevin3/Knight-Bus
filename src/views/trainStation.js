// The train station panel: what opens when a train station is tapped on the home map.
// Docs: docs/user-flows.md#train-stations
// @req REQ-TRAIN-1 @req REQ-TRAIN-2 @req REQ-TRAIN-3 @req REQ-TRAIN-4 @req REQ-TRAIN-5
//
// Unlike a bus stop, a station serves trains going both ways from one place, so it opens on
// a timetable rather than a list of routes:
//   - every train through the station, by time, from now on (REQ-TRAIN-2);
//   - a From / To search between stations, From filled in with this station (REQ-TRAIN-3);
//   - nothing on the map, until "See all trains through this station on the map" (REQ-TRAIN-4);
//   - tapping a train in the timetable shows that train: its route, and where it is now if
//     it is running, with its ghost (REQ-TRAIN-5).
//
// The light rail has its own panel (lightRailStation.js, REQ-LIGHT-1). For now it uses this
// one with its own settings; the RAIL argument says which kind of station it is.

import { h } from '../lib/dom.js';
import { t, tn, arrow, locale } from '../i18n.js';
import { track } from '../analytics.js';
import { israelNow, israelMinutesOf, clock } from '../lib/israelTime.js';
import { departures, searchTrips, israelToday } from '../lib/railTimetable.js';
import { liveSummary, routeBadge } from './liveInfo.js';
import { stopSuffix } from './stopInfo.js';

const FIRST_SHOWN = 30; // departures listed at first; "Show more" adds as many again

// The train station's settings. lightRailStation.js passes its own.
export const TRAIN = {
  kind: 'train',
  icon: '🚆',
  boardTitle: () => t('Trains from this station'),
  onMapButton: () => t('🗺 See all trains through this station on the map'),
  offMapButton: () => t('Hide the trains from the map'),
  searchTitle: () => t('Train from… to…'),
  toPlaceholder: () => t('Destination station'),
  noneToday: () => t('No more trains from this station today.'),
  noTrips: () => t('No direct train between these stations in the coming week.'),
  notRunning: () => t('No live signal from this train right now. It shows on the map while it runs.'),
};

// Is this live bus the train of that timetable trip? The live signal says when its trip was
// meant to leave its first station.
const isTrip = (dep) => (route, bus) => {
  if (route.id !== dep.route.id) return false;
  const start = israelMinutesOf(bus.raw?.siri_ride__scheduled_start_time);
  return Number.isFinite(start) && Math.abs(((start - dep.start) % 1440 + 1440 + 720) % 1440 - 720) <= 1;
};

// ctx, city: as everywhere. stop: the station tapped. lines: the home map's LiveLines.
// map: the home map. onClose: close the panel. rail: TRAIN, or the light rail's settings.
// Returns { root, update(), destroy() }: root is placed in the home panel once; update()
// redraws what changed (it keeps the search boxes, so typing is never interrupted).
export function openRailStation({ ctx, city, stop, lines, map, onClose, rail = TRAIN }) {
  const routes = () => city.routesAtStop(stop.id).filter((r) => r.kind === rail.kind);
  // A station can be several stops with one name (the platforms of a light rail stop).
  const sameName = (s) => new Set(city.stopList.filter((x) => x.name === s.name && x.kind !== 'bus').map((x) => x.id));
  const state = {
    from: stop, // the From station of the search; starts as this station
    to: null,
    board: null, // departures from this station (null while loading)
    shown: FIRST_SHOWN,
    trips: null, // search results (null: no search yet)
    trip: null, // the departure shown on the map
    onMap: false, // "see all trains" is on
    picking: null, // 'from' | 'to' while choosing a station
    // When to travel: today, leaving now, until changed (REQ-TRAIN-3).
    mode: 'leave', // 'leave' at the time, or 'arrive' by it
  };
  track('rail_station_opened', { kind: rail.kind });

  // ----- The parts of the panel -----

  const root = h('div', { class: 'rail-station stack' });
  const header = h('div', { class: 'row between sticky-top' },
    h('span', { class: 'stop-head' }, h('b', { class: 'stop-title' }, `${rail.icon} ${stop.name}`, h('span', { class: 'muted' }, stopSuffix(stop)))),
    h('button', { class: 'nav-button', 'aria-label': t('Close this stop'), onclick: () => onClose() }, t('✕ Close')));
  const mapButton = h('button', { class: 'small-button', onclick: () => toggleMap() });
  const tripBox = h('div', { class: 'stack' });
  const searchBox = h('div', { class: 'card stack rail-search' });
  const boardBox = h('div', { class: 'stack' });

  // The search: two station boxes. The boxes are made once and never redrawn.
  const fromInput = h('input', { type: 'search', value: stop.name, 'aria-label': t('From'), oninput: () => suggest('from') });
  const toInput = h('input', { type: 'search', placeholder: rail.toPlaceholder(), 'aria-label': t('To'), oninput: () => suggest('to') });
  const suggestions = h('div', { class: 'results' });
  const tripsBox = h('div', { class: 'stack' });
  // The date and time, and whether that is when to leave or when to arrive.
  const nowHHMM = () => clock(israelNow().minutes);
  const dateInput = h('input', { type: 'date', value: israelToday(), 'aria-label': t('Date'), onchange: () => search() });
  const timeInput = h('input', { type: 'time', value: nowHHMM(), 'aria-label': t('Time'), onchange: () => search() });
  const modeButton = (mode, label) => h('button', { type: 'button', class: 'small-button', onclick: () => { state.mode = mode; search(); } }, label);
  const leaveButton = modeButton('leave', t('Leave at'));
  const arriveButton = modeButton('arrive', t('Arrive by'));
  const nowButton = h('button', { type: 'button', class: 'link small', onclick: () => { dateInput.value = israelToday(); timeInput.value = nowHHMM(); state.mode = 'leave'; search(); } }, t('Now'));
  searchBox.append(
    h('b', {}, rail.searchTitle()),
    h('label', { class: 'field' }, t('From'), fromInput),
    h('label', { class: 'field' }, t('To'), toInput),
    suggestions,
    h('div', { class: 'row when-row' }, leaveButton, arriveButton, nowButton),
    h('div', { class: 'row when-row' }, h('label', { class: 'field grow' }, t('Date'), dateInput), h('label', { class: 'field grow' }, t('Time'), timeInput)),
    tripsBox);
  root.append(header, h('div', { class: 'row' }, mapButton), tripBox, searchBox, boardBox);

  // Station names the search knows: where routes of this kind stop (trains for a train
  // station, light rail for a light rail stop), each name once.
  const served = new Set();
  for (const r of city.routes.values()) if (r.kind === rail.kind) for (const p of r.patterns) for (const s of p.stops) served.add(s);
  const stations = [...new Map([...served].map((s) => [s.name, s])).values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));

  function suggest(which) {
    state.picking = which;
    const q = (which === 'from' ? fromInput : toInput).value.trim();
    const found = q ? stations.filter((s) => s.name.includes(q)).slice(0, 8) : [];
    suggestions.replaceChildren(...found.map((s) => h('button', {
      class: 'result', onclick: () => choose(which, s),
    }, `${rail.icon} ${s.name}`)));
  }

  async function choose(which, s) {
    state[which] = s;
    (which === 'from' ? fromInput : toInput).value = s.name;
    suggestions.replaceChildren();
    state.picking = null;
    await search();
  }

  async function search() {
    if (!state.from || !state.to) { state.trips = null; update(); return; }
    state.trips = 'loading';
    update();
    const fromRoutes = city.routesAtStop(state.from.id).filter((r) => r.kind === rail.kind);
    const [hh, mm] = (timeInput.value || nowHHMM()).split(':').map(Number);
    const when = { date: dateInput.value || israelToday(), minutes: hh * 60 + mm, mode: state.mode };
    // The next five trains (or the last five that arrive in time), even if not on that day.
    state.trips = await searchTrips(city, fromRoutes, sameName(state.from), sameName(state.to), when, 5);
    track('rail_search', { kind: rail.kind, found: state.trips.length ? 1 : 0, mode: state.mode, today: when.date === israelToday() ? 1 : 0 });
    update();
  }

  // ----- The map -----

  function toggleMap() {
    state.onMap = !state.onMap;
    state.trip = null;
    lines.busFilter = null;
    lines.set(state.onMap ? routes().map((r) => ({ stopId: stop.id, routeId: r.id })) : []);
    if (state.onMap) setTimeout(() => lines.fit(), 0);
    track('rail_all_on_map', { kind: rail.kind, on: state.onMap ? 1 : 0 });
    update();
  }

  // One train: its route on the map, and the train itself if it is running.
  // A train can be live only if it runs today (or started yesterday and runs past midnight).
  const runsToday = (dep) => !dep.date || dep.date === israelToday() || dep.serviceDate === israelToday();

  function showTrip(dep) {
    state.trip = dep;
    state.onMap = false;
    lines.busFilter = runsToday(dep) ? isTrip(dep) : () => false;
    lines.set([{ stopId: stop.id, routeId: dep.route.id }]);
    setTimeout(() => lines.fit(), 0);
    track('rail_trip_shown', { kind: rail.kind });
    update();
    root.scrollIntoView({ block: 'start' });
  }

  function hideTrip() {
    state.trip = null;
    lines.busFilter = null;
    lines.set([]);
    update();
  }

  // ----- Drawing -----

  // "Sat 17/10" for a train that is not today.
  const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const departureRow = (dep, withArrival = false) => h('button', { class: 'result departure', onclick: () => showTrip(dep) },
    h('span', { class: 'dep-when' },
      dep.date && dep.date !== israelToday() ? h('small', { class: 'muted block' }, dayLabel(dep.date)) : null,
      h('b', { class: 'dep-time' }, clock(dep.minute))),
    routeBadge(dep.route),
    h('span', { class: 'line-text' },
      h('span', {}, `${arrow()} ${dep.dest}`),
      withArrival && dep.arrive != null
        ? h('small', { class: 'muted' }, t('Arrives {time} · {n} min', { time: clock(dep.arrive), n: dep.arrive - dep.minute }))
        : h('small', { class: 'muted' }, t('From {a} to {b}', { a: dep.route.stops[0].name, b: dep.route.stops.at(-1).name }))));

  function drawTrip() {
    const dep = state.trip;
    if (!dep) return [];
    const row = lines.rows.find((r) => r.route.id === dep.route.id);
    const bus = row && [...row.next, ...row.passed][0];
    const ghostOn = bus && lines.ghosts.has(bus.rideId);
    return [h('div', { class: 'card stack trip-card' },
      h('div', { class: 'row' }, routeBadge(dep.route), h('b', { class: 'grow' }, `${clock(dep.minute)} ${arrow()} ${dep.dest}`)),
      h('small', { class: 'muted' }, dep.date && dep.date !== israelToday()
        ? t('Leaves on {date} at {time}', { date: dayLabel(dep.date), time: clock(dep.minute) })
        : t('Leaves {station} at {time}', { station: stop.name, time: clock(dep.minute) })),
      bus ? liveSummary(row) : h('small', { class: 'muted' }, runsToday(dep) ? rail.notRunning() : t('Not today: its live position shows on the day it runs.')),
      bus ? h('button', {
        onclick: () => { lines.setGhost(bus.rideId, !ghostOn); update(); },
      }, ghostOn ? t('Remove the ghost') : t('👻 Show its ghost')) : null,
      h('button', { class: 'link small', onclick: hideTrip }, t('Back to the timetable')))];
  }

  function drawTrips() {
    if (state.trips === null) return [];
    if (state.trips === 'loading') return [h('p', { class: 'muted small' }, t('Looking for trains…'))];
    if (!state.trips.length) return [h('p', { class: 'muted small' }, rail.noTrips())];
    return [h('small', { class: 'muted' }, state.mode === 'leave'
      ? t('{from} to {to}: the next trains', { from: state.from.name, to: state.to.name })
      : t('{from} to {to}: the last trains that arrive in time', { from: state.from.name, to: state.to.name })),
    ...state.trips.map((dep) => departureRow(dep, true))];
  }

  function drawBoard() {
    if (state.board === null) return [h('p', { class: 'muted small' }, t('Loading the timetable…'))];
    if (!state.board.length) return [h('b', {}, rail.boardTitle()), h('p', { class: 'muted small' }, rail.noneToday())];
    return [
      h('b', {}, rail.boardTitle()),
      h('small', { class: 'muted' }, t('Timetable times, from now on. Tap a train to see it on the map.')),
      ...state.board.slice(0, state.shown).map((dep) => departureRow(dep)),
      state.board.length > state.shown
        ? h('button', { class: 'link small', onclick: () => { state.shown += FIRST_SHOWN; update(); } }, t('Show more'))
        : null,
    ];
  }

  function update() {
    mapButton.textContent = state.onMap ? rail.offMapButton() : rail.onMapButton();
    leaveButton.classList.toggle('primary', state.mode === 'leave');
    arriveButton.classList.toggle('primary', state.mode === 'arrive');
    tripBox.replaceChildren(...drawTrip().filter(Boolean));
    tripsBox.replaceChildren(...drawTrips().filter(Boolean));
    boardBox.replaceChildren(...drawBoard().filter(Boolean));
  }

  // Nothing on the map at first; the timetable loads.
  lines.busFilter = null;
  lines.set([]);
  map.setView([stop.lat, stop.lon], Math.max(map.getZoom(), 15));
  update();
  departures(city, routes(), sameName(stop)).then((list) => { state.board = list; update(); });

  return {
    root,
    update,
    destroy() {
      lines.busFilter = null;
      lines.set([]);
    },
  };
}

export const openTrainStation = (args) => openRailStation({ ...args, rail: TRAIN });
