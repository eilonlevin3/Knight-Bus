// Draws the chosen lines and their live buses on a map, and keeps the buses fresh.
// Used by both the editor and the commute screen, so they behave the same (REQ-COMM-1).
// @req REQ-EDIT-4 @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-3 @req REQ-COMM-1

import { realtime } from './config.js';
import { fetchLiveBuses, classifyBuses, ageLabel } from './realtime.js';
import { LINE_COLORS, busIcon, escapeHtml } from './map.js';

export class LiveLines {
  // onUpdate(rows): rows = [{ stop, route, color, next: [bus], passed: [bus], error }]
  constructor(map, city, { onUpdate = () => {} } = {}) {
    this.map = map;
    this.city = city;
    this.onUpdate = onUpdate;
    this.entries = []; // [{ stopId, routeId }]
    this.lineLayers = new Map(); // routeId -> polyline
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
    const wanted = new Set(this.entries.map((e) => e.routeId));
    for (const [id, layer] of this.lineLayers) {
      if (!wanted.has(id)) { layer.remove(); this.lineLayers.delete(id); }
    }
    for (const id of wanted) {
      if (this.lineLayers.has(id)) continue;
      const route = this.city.routes.get(id);
      const line = L.polyline(this.city.shapeOf(route), { color: this.colorOf(id), weight: 5, opacity: 0.8 })
        .bindTooltip(`Line ${route.short} → ${route.dest}`, { sticky: true })
        .addTo(this.map);
      this.lineLayers.set(id, line);
    }
    this.refresh();
  }

  // Fit the map around everything shown.
  fit() {
    const layers = [...this.lineLayers.values()];
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
    const results = await Promise.all(
      routeIds.map((id) => fetchLiveBuses(id).then((buses) => [id, { buses }], (error) => [id, { error }])),
    );
    if (gen !== this.generation || this.destroyed) return;
    const byRoute = new Map(results);
    const rows = this.entries.map(({ stopId, routeId }) => {
      const route = this.city.routes.get(routeId);
      const stop = this.city.stops.get(stopId);
      const { buses, error } = byRoute.get(routeId);
      const { next, passed } = error ? { next: [], passed: [] } : classifyBuses(buses, route.stops, stopId, this.city.shapeOf(route));
      return { stop, route, color: this.colorOf(routeId), next, passed, error };
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
    for (const layer of this.lineLayers.values()) layer.remove();
    this.busLayer.remove();
  }
}
