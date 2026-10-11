// Draws the chosen routes as lines on a map, with their live buses, and keeps the buses fresh.
// Used by both the editor and the commute screen, so they behave the same (REQ-COMM-1).
// @req REQ-RT-10 @req REQ-LINE-1a @req REQ-LINE-1b @req REQ-LINE-1c @req REQ-RT-8 @req REQ-EDIT-4 @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-COMM-1

import { realtime } from './config.js';
import { t, tn, arrow } from './i18n.js';
import { fetchLiveBuses, classifyBuses, ageLabel } from './realtime.js';
import { LINE_COLORS, busIcon, lighten } from './map.js';
import { stopPositions, splitPath, samePath } from './lib/routeGeometry.js';
import { makeOffsetPolyline } from './lib/offsetLine.js';
import { showBusInfo } from './views/busInfo.js';

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
      const tip = `${t('Route {n}', { n: route.short })} ${arrow()} ${route.dest}${route.live ? '' : ` · ${route.agency} ${t('(weekend route, no live tracking)')}`}`;
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
    const results = await Promise.all(routeIds.map((id) => (this.city.routes.get(id).live
      ? fetchLiveBuses(id).then((buses) => [id, { buses }], (error) => [id, { error }])
      : [id, { buses: [], noLive: true }])));
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
      return { stop, route, color: this.colorOf(routeId), next, passed, error, noLive };
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
    for (const { bus, row, kind, lines } of markers.values()) {
      // Tap a bus: everything we know about it (REQ-RT-10).
      L.marker([bus.lat, bus.lon], {
        icon: busIcon(row.route.short, row.color, kind), zIndexOffset: kind === 'next' ? 1000 : 0,
        title: `${t('Route {n}', { n: row.route.short })} ${arrow()} ${row.route.dest} · ${ageLabel(bus.recordedAt)}`,
      })
        .on('click', () => showBusInfo({ bus, route: row.route, where: lines }))
        .addTo(this.busLayer);
    }
  }

  pause() {
    clearTimeout(this.timer);
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const layers of this.lineLayers.values()) layers.forEach((l) => l.remove());
    this.busLayer.remove();
  }
}
