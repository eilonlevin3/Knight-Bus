// Draws the chosen routes as lines on a map, with their live buses, and keeps the buses fresh.
// Used by both the editor and the commute screen, so they behave the same (REQ-COMM-1).
// @req REQ-RT-10 @req REQ-RT-12 @req REQ-LINE-1a @req REQ-LINE-1b @req REQ-LINE-1c @req REQ-RT-8 @req REQ-EDIT-4 @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-COMM-1

import { realtime } from './config.js';
import { t, tn, arrow } from './i18n.js';
import { fetchLiveMany, classifyBuses, ageLabel, dropFinishedRides } from './realtime.js';
import { LINE_COLORS, busIcon, lighten } from './map.js';
import { stopPositions, splitPath, samePath, projectOnPath, advanceOnPath, pointAt, slicePath } from './lib/routeGeometry.js';
import { makeOffsetPolyline } from './lib/offsetLine.js';
import { showBusInfo } from './views/busInfo.js';
import { loadSpeeds, segmentSeconds, cellAt } from './lib/speeds.js';

let OffsetPolyline = null; // created on first use, once Leaflet (global L) is loaded

export class LiveLines {
  // onUpdate(rows): rows = [{ stop, route, color, next: [bus], passed: [bus], error }]
  constructor(map, city, { onUpdate = () => {} } = {}) {
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
  fit() {
    const layers = [...this.lineLayers.values()].flat();
    if (layers.length) this.map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [30, 30] });
  }

  async refresh() {
    clearTimeout(this.timer);
    const gen = ++this.generation;
    if (this.destroyed) return;
    if (!this.entries.length) {
      this.busLayer.clearLayers();
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
    const rows = this.entries.map(({ stopId, routeId }) => {
      const route = this.city.routes.get(routeId);
      const stop = this.city.stops.get(stopId);
      const { buses, error, noLive = false } = byRoute.get(routeId);
      // Buses are shown where they really are, whichever stop pattern they drive (REQ-RT-8).
      // "Stops away" is counted along the most common pattern that passes this stop.
      const pattern = this.city.patternsAt(route, stopId)[0] || route.patterns[0];
      const otherPaths = route.patterns.filter((p) => p !== pattern).map((p) => this.city.shapeOf(p));
      const { next, passed } = error || noLive ? { next: [], passed: [] }
        : classifyBuses(buses, pattern.stops, stopId, this.city.shapeOf(pattern), otherPaths);
      return { stop, route, pattern, color: this.colorOf(routeId), next, passed, error, noLive };
    });
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
        const m = markers.get(bus.rideId) || { bus, row, kind, lines: [] };
        if (kind === 'next') m.kind = 'next';
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

  openBus(rideId) {
    const m = this.shown.get(rideId);
    if (!m) return;
    showBusInfo({
      bus: m.bus, route: m.row.route, where: m.lines,
      ghost: {
        on: this.ghosts.has(rideId),
        possible: !!this.ghostOf(m),
        toggle: () => {
          if (this.ghosts.has(rideId)) this.ghosts.delete(rideId); else this.ghosts.add(rideId);
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
  // null when the bus is not on that path (then nothing can be estimated).
  ghostOf({ bus, row }) {
    const pattern = row.pattern;
    const path = this.city.shapeOf(pattern);
    const { pos, meters } = projectOnPath(bus, path);
    if (meters > realtime.maxOffRouteMeters) return null;
    const seconds = Math.min(realtime.ghostMaxMinutes * 60, (Date.now() - bus.recordedAt.getTime()) / 1000);
    // Real travel times for this half hour where known; the timetable otherwise.
    const speeds = this.speeds.get(row.route.id);
    const cell = cellAt();
    const secondsOf = speeds ? (i) => segmentSeconds(speeds, pattern.stops[i - 1].id, pattern.stops[i].id, cell) : null;
    const to = advanceOnPath(pattern, path, pos, seconds, undefined, secondsOf);
    return { path, from: pos, to, point: pointAt(path, to) };
  }

  // Draws the estimates and keeps them moving while any is on.
  drawGhosts() {
    this.ghostLayer.clearLayers();
    clearTimeout(this.ghostTimer);
    let any = false;
    for (const rideId of this.ghosts) {
      const m = this.shown.get(rideId);
      const g = m && this.ghostOf(m);
      if (!g) continue;
      any = true;
      // A dotted trail from the last signal to the estimate, and the ghost itself.
      L.polyline(slicePath(g.path, g.from, g.to), { color: m.row.color, weight: 4, opacity: 0.9, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(this.ghostLayer);
      L.marker(g.point, {
        icon: busIcon(m.row.route.label, m.row.color, 'ghost'), zIndexOffset: 1500,
        title: t('Estimated position of route {n} now', { n: m.row.route.label }),
      })
        .on('click', () => this.openBus(rideId))
        .addTo(this.ghostLayer);
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
