// Draws the chosen routes as lines on a map, with their live buses, and keeps the buses fresh.
// Used by both the editor and the commute screen, so they behave the same (REQ-COMM-1).
// @req REQ-RT-10 @req REQ-RT-12 @req REQ-RT-13 @req REQ-RT-14 @req REQ-RT-15 @req REQ-LINE-1a @req REQ-LINE-1b @req REQ-LINE-1c @req REQ-RT-8 @req REQ-EDIT-4 @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-COMM-1

import { realtime, storagePrefix } from './config.js';
import { t, tn, arrow } from './i18n.js';
import { fetchLiveMany, fetchTrail, classifyBuses, ageLabel, dropFinishedRides } from './realtime.js';
import { LINE_COLORS, busIcon, lighten } from './map.js';
import { stopPositions, splitPath, samePath, projectOnPath, advanceOnPath, travelSeconds, pointAt, slicePath, metersBetween } from './lib/routeGeometry.js';
import { pickAutoGhosts, countdown, plusMinus, timerStop } from './lib/ghosts.js';
import { makeOffsetPolyline } from './lib/offsetLine.js';
import { showBusInfo } from './views/busInfo.js';
import { loadSpeeds, segmentSeconds, cellAt } from './lib/speeds.js';
import { sharedStretches, blend, liveWeight, confidence, expectedMeanError, WINDOW_MS } from './lib/liveStretches.js';

let OffsetPolyline = null; // created on first use, once Leaflet (global L) is loaded
const LEARN_OFF_PATH_METERS = 120; // a bus further from its route than this teaches nothing

// Live traffic (REQ-RT-15) is kept on this phone, so reopening the app does not start again.
// Only stop pairs and seconds, for 20 minutes.
const LEARNED_KEY = `${storagePrefix}liveStretches`;
let learnedLoaded = false;
function loadLearned() {
  if (learnedLoaded) return;
  learnedLoaded = true;
  try { const text = localStorage.getItem(LEARNED_KEY); if (text) sharedStretches.load(text); } catch { /* nothing kept */ }
}
function saveLearned() {
  try { localStorage.setItem(LEARNED_KEY, sharedStretches.save()); } catch { /* storage full or blocked */ }
}
const trailReadAt = new Map(); // route id -> when its last 20 minutes were read from Stride
const TRAIL_RETRY_MS = 30000; // a read that failed is tried again this soon
const STREET_MATES = 6; // other routes read for the stretches they share with the routes on screen
const STRETCH_BACK = 20; // stretches before a chosen stop whose live times matter

// Which routes drive each stretch between two stops: "from>to" -> [{ route, pattern }].
// Built once per city, on first use.
const stretchIndex = new WeakMap();
function routesByStretch(city) {
  if (stretchIndex.has(city)) return stretchIndex.get(city);
  const index = new Map();
  for (const route of city.routes.values()) {
    if (!route.live) continue;
    for (const pattern of route.patterns) {
      for (let i = 1; i < pattern.stops.length; i++) {
        const k = `${pattern.stops[i - 1].id}>${pattern.stops[i].id}`;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push({ route, pattern });
      }
    }
  }
  stretchIndex.set(city, index);
  return index;
}

// Meters along a path: at each corner, and at each stop of the pattern ([{ id, m }]).
const metersCache = new WeakMap();
function metersOf(pattern, path) {
  const hit = metersCache.get(pattern);
  if (hit && hit.path === path) return hit;
  const cum = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + metersBetween(path[i - 1], path[i]);
  const stops = stopPositions(pattern.stops, path).map((pos, i) => ({ id: pattern.stops[i].id, m: alongMeters(cum, pos) }));
  const out = { path, cum, stops };
  metersCache.set(pattern, out);
  return out;
}
function alongMeters(cum, pos) {
  const i = Math.min(cum.length - 1, Math.floor(pos));
  return i >= cum.length - 1 ? cum[cum.length - 1] : cum[i] + (cum[i + 1] - cum[i]) * (pos - i);
}

// The ghost's timer (REQ-RT-14) and, when live traffic is on for it, its state (REQ-RT-15):
// ⏳ while live times are still being gathered, ⚡ and a colored ring when the ghost uses
// them. Changed in place, twice a second.
function showGhostState(marker, timer, live) {
  const el = marker.getElement();
  if (!el) return;
  const time = el.querySelector('.ghost-timer');
  if (time && time.textContent !== timer) { time.textContent = timer; time.hidden = !timer; }
  const badge = el.querySelector('.ghost-live');
  const icon = live?.enabled ? (live.active ? '⚡' : '⏳') : '';
  if (badge && badge.textContent !== icon) { badge.textContent = icon; badge.hidden = !icon; }
  const box = el.querySelector('.bus-marker');
  if (box) for (const q of ['good', 'fair', 'poor']) box.classList.toggle(`ring-${q}`, live?.quality === q);
}

export class LiveLines {
  // onUpdate(rows): rows = [{ stop, route, color, next: [bus], passed: [bus], error }]
  // autoGhosts: show by itself the ghost of the bus coming next to each stop (the Favorite
  // Commute view, REQ-RT-13).
  // Every view learns how long buses take between stops right now, from the buses it
  // fetches (REQ-RT-15). liveTraffic: its ghosts use that unless the person turns it off
  // (the Favorite Commute view); elsewhere a ghost uses it once turned on in its pop-up.
  constructor(map, city, { onUpdate = () => {}, autoGhosts = false, liveTraffic = false } = {}) {
    this.autoGhosts = autoGhosts;
    this.liveDefault = liveTraffic;
    this.learn = sharedStretches;
    loadLearned();
    this.learnAt = new Map(); // ride id -> its last position on the path (where to look next)
    this.liveChoice = new Map(); // ride id -> live traffic on (true) or off (false), as the person set it
    this.ghostsOff = new Set(); // ride ids whose automatic ghost the person removed
    this.busFilter = null; // (route, bus) -> keep? null shows every bus
    this.hideLines = false;
    this.rows = [];
    this.map = map;
    this.city = city;
    this.onUpdate = onUpdate;
    this.entries = []; // [{ stopId, routeId }]
    this.lineLayers = new Map(); // routeId -> [incoming polyline, outbound polyline]
    this.colors = new Map(); // routeId -> color
    this.busLayer = L.layerGroup().addTo(map);
    // "Ghosts": for buses the person asked for, an estimate of where the bus is now,
    // moved forward from its last signal along its route (REQ-RT-12).
    this.ghostLayer = L.layerGroup().addTo(map);
    this.ghosts = new Set(); // ride ids
    this.speeds = new Map(); // route id -> a month of real travel times (loaded for ghosts only)
    this.shown = new Map(); // ride id -> { bus, row, kind, lines }: the buses on the map now
    this.ghostTimer = null;
    this.timer = null;
    this.generation = 0; // ignores slow responses that a newer refresh replaced
    this.destroyed = false;
    this.onVisibility = () => (document.hidden ? this.pause() : this.refresh());
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  colorOf(routeId) {
    if (!this.colors.has(routeId)) this.colors.set(routeId, LINE_COLORS[this.colors.size % LINE_COLORS.length]);
    return this.colors.get(routeId);
  }

  // Replace what is shown. Each entry is a (stop, line) pair.
  set(entries) {
    this.entries = entries.filter((e) => this.city.routes.has(e.routeId) && this.city.stops.has(e.stopId));
    this.drawLines();
    // A route or stop that was closed takes its buses and their ghosts with it at once,
    // without waiting for the next live answer (REQ-RT-12).
    const kept = new Set(this.entries.map((e) => `${e.stopId}|${e.routeId}`));
    this.rows = this.rows.filter((row) => kept.has(`${row.stop.id}|${row.route.id}`));
    this.drawBuses(this.rows);
    for (const rideId of this.ghosts) if (!this.shown.has(rideId)) this.ghosts.delete(rideId);
    // Where ghosts use live traffic from the start, read the last 20 minutes now, together
    // with the first live answer rather than after it (REQ-RT-15).
    if (this.liveDefault) this.readTrails(this.entries.map((e) => e.routeId), true);
    this.refresh();
  }

  // Each line is split at its chosen stop: the part where the bus is still coming to you
  // ("incoming") is solid; the part after the stop ("outbound") is lighter and see-through.
  // Lines sit side by side, each shifted sideways by its own amount, so where several share a
  // street you can see all of them.
  // @req REQ-COMM-4 @req REQ-COMM-5
  drawLines() {
    for (const layers of this.lineLayers.values()) layers.forEach((l) => l.remove());
    this.lineLayers.clear();
    // hideLines: live buses only, the line is drawn by someone else (one train, REQ-TRAIN-7).
    if (this.hideLines) return;
    OffsetPolyline ||= makeOffsetPolyline(L);
    const routeIds = [...new Set(this.entries.map((e) => e.routeId))];
    const n = routeIds.length;
    // A commute has a few lines; a busy stop on the home map can have dozens.
    const weight = n > 6 ? 3 : n > 4 ? 4 : 5;
    const gap = n > 12 ? 1.5 : n > 6 ? 3 : weight + 1;
    routeIds.forEach((id, i) => {
      const route = this.city.routes.get(id);
      const stopIds = this.entries.filter((e) => e.routeId === id).map((e) => e.stopId);
      // A route can have more than one stop pattern. Only the patterns that pass the chosen
      // stop are drawn: one -> just that one (REQ-LINE-1a); several -> the most common as the
      // normal line and the others dotted (REQ-LINE-1b).
      const through = this.city.patternsAt(route, stopIds[0]);
      const main = through[0] || route.patterns[0];
      const path = this.city.shapeOf(main);
      const pos = stopPositions(main.stops, path);
      // Split at the first chosen stop along the line (a line may be chosen at both stops).
      const idx = stopIds.map((sid) => main.stops.findIndex((s) => s.id === sid)).filter((k) => k >= 0);
      // (If the stop is somehow not on the line, draw it all as outbound.)
      const [incoming, outbound] = idx.length ? splitPath(path, pos[Math.min(...idx)]) : [[], path];
      const color = this.colorOf(id);
      const offset = (i - (n - 1) / 2) * gap; // pixels (src/lib/offsetLine.js)
      // Lines without live buses (weekend service) are dashed, so they are never mistaken
      // for a line that simply has no bus on the way.
      const dashArray = route.live ? null : `${weight * 2} ${weight * 1.6}`;
      const tip = `${t('Route {n}', { n: route.label })} ${arrow()} ${route.dest}${route.live ? '' : ` · ${route.agency} ${t('(weekend route, no live tracking)')}`}`;
      // A pattern that takes the same path as one already drawn gets no line of its own:
      // only the full line shows (REQ-LINE-1c).
      const drawn = [path];
      const dotted = through.slice(1).filter((p) => {
        const shape = this.city.shapeOf(p);
        if (drawn.some((d) => samePath(shape, d))) return false;
        drawn.push(shape);
        return true;
      });
      const variants = dotted.map((p) => new OffsetPolyline(this.city.shapeOf(p), {
        color, weight: Math.max(3, weight - 1), opacity: 0.9, offset, dashArray: `1 ${weight * 1.8}`, lineCap: 'round',
      }).bindTooltip(`${tip} · ${t('less common stop pattern ({share}% of trips)', { share: p.share })}`, { sticky: true }));
      const layers = [
        ...variants, // drawn first, so only where they leave the most common pattern do the dots show
        new OffsetPolyline(outbound, { color: lighten(color, 0.3), weight, opacity: 0.6, offset, lineCap: 'butt', dashArray }).bindTooltip(tip, { sticky: true }),
        new OffsetPolyline(incoming, { color, weight, opacity: 0.95, offset, lineCap: 'butt', dashArray }).bindTooltip(tip, { sticky: true }),
      ];
      layers.filter((l) => l.getLatLngs().length > 1).forEach((l) => l.addTo(this.map));
      this.lineLayers.set(id, layers);
    });
  }

  // What the map key shows: one row per line on the map.
  legendItems() {
    return [...this.lineLayers.keys()].map((id) => ({ route: this.city.routes.get(id), color: this.colorOf(id) }));
  }

  // Fit the map around everything shown.
  // Turn a ghost on or off from outside the bus pop-up (the station's train card).
  setGhost(rideId, on) {
    if (on) { this.ghosts.add(rideId); this.ghostsOff.delete(rideId); } else { this.ghosts.delete(rideId); this.ghostsOff.add(rideId); }
    const m = this.shown.get(rideId);
    const routeId = m?.row.route.id;
    if (on && routeId && !this.speeds.has(routeId)) {
      loadSpeeds(routeId).then((speeds) => { this.speeds.set(routeId, speeds); if (!this.destroyed) this.drawGhosts(); });
    }
    this.drawGhosts();
  }

  fit() {
    const layers = [...this.lineLayers.values()].flat();
    if (layers.length) this.map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [30, 30] });
  }

  async refresh() {
    clearTimeout(this.timer);
    const gen = ++this.generation;
    if (this.destroyed) return;
    if (!this.entries.length) {
      this.rows = [];
      this.drawBuses([]);
      this.onUpdate([]);
      return;
    }
    const routeIds = [...new Set(this.entries.map((e) => e.routeId))];
    // Lines outside the government feed have no live positions: don't ask for them.
    // A route can report under several ids (REQ-DATA-10): all ids of all routes are asked for
    // in one go (REQ-RT-11), then each route's answers are put together.
    const liveRoutes = routeIds.map((id) => this.city.routes.get(id)).filter((r) => r.live);
    const byLiveId = liveRoutes.length ? await fetchLiveMany(liveRoutes.flatMap((r) => r.liveIds)) : new Map();
    const results = routeIds.map((id) => {
      const route = this.city.routes.get(id);
      if (!route.live) return [id, { buses: [], noLive: true }];
      const answers = route.liveIds.map((liveId) => byLiveId.get(String(liveId)) || { buses: [] });
      const error = answers.find((a) => a.error)?.error;
      return [id, error ? { error } : { buses: dropFinishedRides(answers.flatMap((a) => a.buses)) }];
    });
    if (gen !== this.generation || this.destroyed) return;
    const byRoute = new Map(results);
    this.learnFrom(byRoute);

    const rows = this.entries.map(({ stopId, routeId }) => {
      const route = this.city.routes.get(routeId);
      const stop = this.city.stops.get(stopId);
      const { buses: allBuses, error, noLive = false } = byRoute.get(routeId);
      // busFilter: show only some buses, e.g. one train chosen in a station's timetable
      // (REQ-TRAIN-5). (route, bus) -> true to keep.
      const buses = this.busFilter && allBuses ? allBuses.filter((b) => this.busFilter(route, b)) : allBuses;
      // Buses are shown where they really are, whichever stop pattern they drive (REQ-RT-8).
      // "Stops away" is counted along the most common pattern that passes this stop.
      const pattern = this.city.patternsAt(route, stopId)[0] || route.patterns[0];
      const otherPaths = route.patterns.filter((p) => p !== pattern).map((p) => this.city.shapeOf(p));
      const { next, passed } = error || noLive ? { next: [], passed: [] }
        : classifyBuses(buses, pattern.stops, stopId, this.city.shapeOf(pattern), otherPaths);
      return { stop, route, pattern, color: this.colorOf(routeId), next, passed, error, noLive };
    });
    this.rows = rows;
    if (this.autoGhosts) {
      // A ghost needs the route's real travel times: fetch them for every route on screen.
      for (const row of rows) {
        const id = row.route.id;
        if (row.route.live && !this.speeds.has(id)) {
          this.speeds.set(id, null);
          loadSpeeds(id).then((speeds) => { this.speeds.set(id, speeds); });
        }
      }
    }
    this.drawBuses(rows);
    this.onUpdate(rows);
    if (!document.hidden) this.timer = setTimeout(() => this.refresh(), realtime.refreshMs);
  }

  drawBuses(rows) {
    this.busLayer.clearLayers();
    // The same bus can matter for two stops (approaching stop 2 after passing stop 1): one marker.
    const markers = new Map();
    for (const row of rows) {
      const add = (bus, kind) => {
        const text = kind === 'next'
          ? (bus.stopsAway === 0
            ? t('Next stop: {stop}', { stop: row.stop.name })
            : tn(bus.stopsAway, '1 stop before {stop}', '{n} stops before {stop}', { stop: row.stop.name }))
          : tn(-bus.stopsAway, 'Passed {stop} 1 stop ago', 'Passed {stop} {n} stops ago', { stop: row.stop.name });
        const m = markers.get(bus.rideId) || { bus, row, kind, lines: [], rows: [] };
        if (kind === 'next') m.kind = 'next';
        m.rows.push(row); // every stop on screen this bus matters for: its timer picks one
        // The stop this bus reaches first: its ghost counts down to it (REQ-RT-14).
        if (kind === 'next' && !(m.nextRow && m.nextAway <= bus.stopsAway)) { m.nextRow = row; m.nextAway = bus.stopsAway; }
        m.lines.push(text);
        markers.set(bus.rideId, m);
      };
      row.next.forEach((b) => add(b, 'next'));
      row.passed.forEach((b) => add(b, 'passed'));
    }
    this.shown = markers;
    this.drawGhosts();
    for (const { bus, row, kind, lines } of markers.values()) {
      // Tap a bus: everything we know about it (REQ-RT-10).
      L.marker([bus.lat, bus.lon], {
        icon: busIcon(row.route.label, row.color, kind), zIndexOffset: kind === 'next' ? 1000 : 0,
        title: `${t('Route {n}', { n: row.route.label })} ${arrow()} ${row.route.dest} · ${ageLabel(bus.recordedAt)}`,
      })
        .on('click', () => this.openBus(bus.rideId))
        .addTo(this.busLayer);
    }
  }

  // Every bus of every route on screen, all along its route: where it is now. A bus seen
  // passing two stops in a row gives that stretch a live time (REQ-RT-15).
  learnFrom(byRoute) {
    for (const [routeId, { buses }] of byRoute) if (buses?.length) this.observeBuses(routeId, buses);
    saveLearned(); // also forgets what is older than 20 minutes
  }

  // buses: positions of one route's buses, oldest first. pattern: the stop pattern to place
  // them on (by default the one through the chosen stop).
  observeBuses(routeId, buses, pattern = null) {
    const route = this.city.routes.get(routeId);
    if (!route) return;
    const entry = this.entries.find((e) => e.routeId === routeId);
    pattern ||= (entry && this.city.patternsAt(route, entry.stopId)[0]) || route.patterns[0];
    const path = this.city.shapeOf(pattern);
    const { cum, stops } = metersOf(pattern, path);
    for (const bus of buses) {
      const before = this.learnAt.get(bus.rideId);
      const { pos, meters } = projectOnPath(bus, path, before ? Math.max(0, Math.floor(before) - 2) : 0);
      if (meters > LEARN_OFF_PATH_METERS) continue;
      this.learnAt.set(bus.rideId, pos);
      this.learn.observe(bus.rideId, bus.recordedAt.getTime(), alongMeters(cum, pos), stops);
    }
  }

  // The last 20 minutes of these routes, read at once from Open Bus Stride (its answer has
  // every position, not only the newest), so live traffic is ready without minutes of
  // watching. At most once every 10 minutes per route; a read that failed is tried again
  // after 30 s. withMates: also the routes that share the most stretches before the chosen
  // stops, so a route with a bus every 20 minutes learns from the others on its street.
  readTrails(routeIds, withMates = false) {
    const now = Date.now();
    const jobs = routeIds.map((id) => [id, null]);
    if (withMates) jobs.push(...this.streetMates(routeIds));
    for (const [id, pattern] of jobs) {
      const route = this.city.routes.get(id);
      if (!route?.live || now - (trailReadAt.get(id) || 0) < WINDOW_MS / 2) continue;
      trailReadAt.set(id, now);
      Promise.all(route.liveIds.map((liveId) => fetchTrail(String(liveId), WINDOW_MS / 60000).catch(() => null)))
        .then((lists) => {
          if (lists.every((x) => x === null)) trailReadAt.set(id, Date.now() - WINDOW_MS / 2 + TRAIL_RETRY_MS);
          if (this.destroyed) return;
          this.observeBuses(id, lists.filter(Boolean).flat().sort((a, b) => a.recordedAt - b.recordedAt), pattern);
          saveLearned();
          this.drawGhosts();
        });
    }
  }

  // Other routes on the same street: for the stretches before each chosen stop, the routes
  // (not on screen) that drive the most of them, with the stop pattern that does.
  // Returns [[route id, pattern], ...], at most STREET_MATES.
  streetMates(routeIds) {
    const index = routesByStretch(this.city);
    const mine = new Set(routeIds);
    const shared = new Map(); // route id -> { pattern, n }
    for (const { stopId, routeId } of this.entries) {
      if (!mine.has(routeId)) continue;
      const route = this.city.routes.get(routeId);
      const pattern = this.city.patternsAt(route, stopId)[0] || route.patterns[0];
      const at = pattern.stops.findIndex((s) => s.id === stopId);
      for (let i = Math.max(1, at - STRETCH_BACK); i <= at; i++) {
        for (const other of index.get(`${pattern.stops[i - 1].id}>${pattern.stops[i].id}`) || []) {
          if (mine.has(other.route.id)) continue;
          const key = `${other.route.id}`;
          const x = shared.get(key) || { n: 0, byPattern: new Map() };
          x.byPattern.set(other.pattern, (x.byPattern.get(other.pattern) || 0) + 1);
          x.n++;
          shared.set(key, x);
        }
      }
    }
    return [...shared.entries()]
      .filter(([, x]) => x.n >= 2)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, STREET_MATES)
      .map(([id, x]) => [id, [...x.byPattern.entries()].sort((a, b) => b[1] - a[1])[0][0]]);
  }

  // Live traffic for one bus's ghost, on the way from its last signal to the row's stop (or,
  // past every stop on screen, the next five stretches): how much of the way has live times
  // and how much they count. active: the ghost uses them (on, and any live time on the way;
  // where none is known the history is used, and the ring says how much is known).
  // quality: the ring around the ghost.
  liveOf({ bus, row }, pos) {
    const enabled = this.liveChoice.get(bus.rideId) ?? this.liveDefault;
    const pattern = row.pattern;
    const stops = pattern.stops;
    const stopPos = stopPositions(stops, this.city.shapeOf(pattern));
    const start = Math.max(1, stopPos.findIndex((p) => p > pos));
    if (stopPos.findIndex((p) => p > pos) < 0) return { enabled, active: false, stretches: 0, known: 0, buses: 0, weight: 0 };
    let end = stops.findIndex((s) => s.id === row.stop.id);
    if (end < start) end = Math.min(stops.length - 1, start + 4);
    const hist = this.historyOf(row);
    const now = Date.now();
    let total = 0, covered = 0, weighted = 0, known = 0, buses = 0;
    for (let i = start; i <= end; i++) {
      const times = pattern.times;
      const h = hist?.(i) ?? (times && Number.isFinite(times[i] - times[i - 1]) ? (times[i] - times[i - 1]) * 60 : 60);
      const n = this.learn.samples(stops[i - 1].id, stops[i].id, now).length;
      total += h;
      if (n) { covered += h; known++; buses += n; }
      weighted += h * liveWeight(n);
    }
    const share = total ? covered / total : 0;
    const weight = total ? weighted / total : 0;
    const active = enabled && share > 0;
    const age = (now - bus.recordedAt.getTime()) / 1000;
    return { enabled, active, stretches: end - start + 1, known, buses, weight, quality: active ? confidence(age, weight) : null };
  }

  openBus(rideId) {
    const m = this.shown.get(rideId);
    if (!m) return;
    const auto = this.autoGhostIds().has(rideId);
    const g = this.ghostOf({ bus: m.bus, row: m.nextRow || m.row });
    showBusInfo({
      bus: m.bus, route: m.row.route, where: m.lines,
      ghost: {
        on: this.ghosts.has(rideId) || auto,
        auto,
        possible: !!g,
        // Live traffic (REQ-RT-15): its state, and on / off for this ghost.
        live: g?.live ? {
          ...g.live,
          stop: (m.nextRow || m.row).stop.name,
          toggle: () => {
            const on = !g.live.enabled;
            this.liveChoice.set(rideId, on);
            if (on) this.readTrails([m.row.route.id]);
            this.drawGhosts();
          },
        } : null,
        toggle: () => {
          if (this.ghosts.has(rideId) || auto) {
            this.ghosts.delete(rideId);
            if (auto) this.ghostsOff.add(rideId); // removed by hand: not shown again by itself
          } else {
            this.ghosts.add(rideId);
            this.ghostsOff.delete(rideId);
          }
          this.drawGhosts();
          // Now, and only now, fetch how fast this route's buses really go (REQ-DATA-12).
          const routeId = m.row.route.id;
          if (this.ghosts.has(rideId) && !this.speeds.has(routeId)) {
            loadSpeeds(routeId).then((speeds) => { this.speeds.set(routeId, speeds); if (!this.destroyed) this.drawGhosts(); });
          }
        },
      },
    });
  }

  // Where the bus would be now: { from, to, point } as positions on its route's path, or
  // null when the bus is not on that path (then nothing can be estimated). live: its live
  // traffic state in a Favorite Commute (REQ-RT-15); secondsOf: the stretch times it used.
  ghostOf({ bus, row }) {
    const pattern = row.pattern;
    const path = this.city.shapeOf(pattern);
    const { pos, meters } = projectOnPath(bus, path);
    if (meters > realtime.maxOffRouteMeters) return null;
    const seconds = Math.min(realtime.ghostMaxMinutes * 60, (Date.now() - bus.recordedAt.getTime()) / 1000);
    const live = this.liveOf({ bus, row }, pos);
    // Real travel times for this half hour where known, with today's where the live ghost is
    // on; the timetable otherwise.
    const secondsOf = this.secondsOfFor(row, !!live?.active);
    const to = advanceOnPath(pattern, path, pos, seconds, undefined, secondsOf);
    return { path, from: pos, to, point: pointAt(path, to), live, secondsOf };
  }

  // The ghosts a Favorite Commute shows by itself (REQ-RT-13): for every route at every
  // stop on screen, the bus whose ghost is next to reach the stop; one minute after its
  // ghost passes the stop it goes; one minute before, the bus behind it comes on too.
  autoGhostIds() {
    const ids = new Set();
    if (!this.autoGhosts) return ids;
    for (const row of this.rows) {
      if (row.noLive || row.error) continue;
      const buses = [...row.passed, ...row.next].map((bus) => {
        const g = this.ghostOf({ bus, row });
        return { id: bus.rideId, seconds: g ? this.ghostSecondsTo(row, bus, g) : NaN };
      });
      for (const id of pickAutoGhosts(buses)) if (!this.ghostsOff.has(id)) ids.add(id);
    }
    return ids;
  }

  // When a bus's ghost g reaches the row's stop: in that many seconds, from where the ghost
  // is now; or, past the stop, that many seconds ago (negative), counted from the bus's last
  // signal. NaN when the stop is not on the row's path.
  ghostSecondsTo(row, bus, g) {
    const pattern = row.pattern;
    const path = g.path;
    const stopPos = stopPositions(pattern.stops, path);
    const at = stopPos[pattern.stops.findIndex((s) => s.id === row.stop.id)];
    if (at === undefined) return NaN;
    const secondsOf = g.secondsOf;
    return g.to < at
      ? travelSeconds(pattern, path, g.to, at, stopPos, secondsOf)
      : (bus.recordedAt.getTime() + travelSeconds(pattern, path, g.from, at, stopPos, secondsOf) * 1000 - Date.now()) / 1000;
  }

  // Real travel times of a row's route for this half hour, or null (then the timetable).
  historyOf(row) {
    const speeds = this.speeds.get(row.route.id);
    if (!speeds) return null;
    const cell = cellAt();
    const stops = row.pattern.stops;
    return (i) => segmentSeconds(speeds, stops[i - 1].id, stops[i].id, cell);
  }

  // The stretch times a ghost moves by: the history, blended with the last 20 minutes'
  // live times when live is true (REQ-RT-15). null: the timetable.
  secondsOfFor(row, live = false) {
    const hist = this.historyOf(row);
    if (!live) return hist;
    const stops = row.pattern.stops;
    const now = Date.now();
    return (i) => blend(hist?.(i) ?? null, this.learn.samples(stops[i - 1].id, stops[i].id, now));
  }

  // Draws the estimates and keeps them moving while any is on.
  // Each ghost keeps its marker and trail, and only moves them, so moving twice a second
  // does not flicker. ghostMarks: ride id -> { trail, marker }
  drawGhosts() {
    clearTimeout(this.ghostTimer);
    this.ghostMarks ||= new Map();
    let any = this.autoGhosts && this.rows.length > 0; // keep checking which ghosts to show
    const on = new Set();
    for (const rideId of new Set([...this.ghosts, ...this.autoGhostIds()])) {
      const m = this.shown.get(rideId);
      // The ghost runs along the route as seen from the stop it is coming to.
      const g = m && this.ghostOf({ bus: m.bus, row: m.nextRow || m.row });
      if (!g) continue;
      any = true;
      on.add(rideId);
      const trail = slicePath(g.path, g.from, g.to);
      // Under the ghost, the time until it reaches the stop it is coming to, or, for two
      // minutes after it passed a stop, the time since, below zero (REQ-RT-14). Beside it,
      // ± the mean error of such an estimate, from the recorded-bus test: it shrinks as the
      // bus gets near and its signal is fresh.
      const pick = timerStop(m.rows.map((row) => ({ row, seconds: this.ghostSecondsTo(row, m.bus, g) })));
      let timer = '';
      if (pick) {
        const ahead = (Date.now() - m.bus.recordedAt.getTime()) / 1000 + Math.max(0, pick.seconds);
        timer = `${countdown(pick.seconds)} ${plusMinus(expectedMeanError(ahead, !!g.live?.active))}`;
      }
      let mark = this.ghostMarks.get(rideId);
      if (mark) {
        mark.trail.setLatLngs(trail);
        mark.marker.setLatLng(g.point);
      } else {
        // A dotted trail from the last signal to the estimate, and the ghost itself.
        mark = {
          trail: L.polyline(trail, { color: m.row.color, weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(this.ghostLayer),
          marker: L.marker(g.point, {
            icon: busIcon(m.row.route.label, m.row.color, 'ghost', timer), zIndexOffset: 1500,
            title: m.nextRow
              ? t('Estimated position of route {n} now. The timer counts down to its arrival at {stop}.', { n: m.row.route.label, stop: m.nextRow.stop.name })
              : t('Estimated position of route {n} now', { n: m.row.route.label }),
          }).on('click', () => this.openBus(rideId)).addTo(this.ghostLayer),
        };
        this.ghostMarks.set(rideId, mark);
      }
      showGhostState(mark.marker, timer, g.live);
    }
    for (const [rideId, mark] of this.ghostMarks) {
      if (on.has(rideId)) continue;
      mark.trail.remove();
      mark.marker.remove();
      this.ghostMarks.delete(rideId);
    }
    if (any && !this.destroyed && !document.hidden) this.ghostTimer = setTimeout(() => this.drawGhosts(), realtime.ghostStepMs);
  }

  pause() {
    clearTimeout(this.timer);
    clearTimeout(this.ghostTimer);
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const layers of this.lineLayers.values()) layers.forEach((l) => l.remove());
    this.busLayer.remove();
    this.ghostLayer.remove();
  }
}
