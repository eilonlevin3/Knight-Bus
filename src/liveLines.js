// Draws the chosen lines and their live buses on a map, and keeps the buses fresh.
// Used by both the editor and the commute screen, so they behave the same (REQ-COMM-1).
// @req REQ-LINE-1 @req REQ-EDIT-4 @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-3 @req REQ-RT-5 @req REQ-RT-6 @req REQ-COMM-1

import { realtime } from './config.js';
import { fetchLiveBuses, classifyBuses, ageLabel } from './realtime.js';
import { LINE_COLORS, busIcon, escapeHtml, lighten } from './map.js';
import { stopPositions, splitPath } from './lib/routeGeometry.js';
import { makeOffsetPolyline } from './lib/offsetLine.js';

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
      // A line can take more than one route. Only the routes that pass the chosen stop are
      // drawn: the most common of them as the normal line, any others dotted (REQ-LINE-1).
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
      const tip = `Line ${route.short} → ${route.dest}${route.live ? '' : ` · ${route.agency} (weekend line, no live tracking)`}`;
      const variants = through.slice(1).map((p) => new OffsetPolyline(this.city.shapeOf(p), {
        color, weight: Math.max(3, weight - 1), opacity: 0.9, offset, dashArray: `1 ${weight * 1.8}`, lineCap: 'round',
      }).bindTooltip(`${tip} · less common route (${p.share}% of trips)`, { sticky: true }));
      const layers = [
        ...variants, // drawn first, so only where they leave the usual route do the dots show
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
      // Place buses on the route that passes this stop (the most common one, if several do).
      const pattern = this.city.patternsAt(route, stopId)[0] || route.patterns[0];
      const { next, passed } = error || noLive ? { next: [], passed: [] } : classifyBuses(buses, pattern.stops, stopId, this.city.shapeOf(pattern));
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
          ? (bus.stopsAway === 0 ? `Next stop: ${row.stop.name}` : `${bus.stopsAway} stops before ${row.stop.name}`)
          : `Passed ${row.stop.name} ${-bus.stopsAway} stops ago`;
        const m = markers.get(bus.rideId) || { bus, row, kind, lines: [] };
        if (kind === 'next') m.kind = 'next';
        m.lines.push(text);
        markers.set(bus.rideId, m);
      };
      row.next.forEach((b) => add(b, 'next'));
      row.passed.forEach((b) => add(b, 'passed'));
    }
    for (const { bus, row, kind, lines } of markers.values()) {
      L.marker([bus.lat, bus.lon], { icon: busIcon(row.route.short, row.color, kind), zIndexOffset: kind === 'next' ? 1000 : 0 })
        .bindPopup(
          `<b>Line ${escapeHtml(row.route.short)}</b> → ${escapeHtml(row.route.dest)}<br>` +
          `${lines.map(escapeHtml).join('<br>')}<br><small>Position ${ageLabel(bus.recordedAt)}</small>`,
        )
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
