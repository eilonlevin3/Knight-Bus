// Live bus positions and "next two + last passed" logic. Docs: docs/realtime.md
// @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-8 @req REQ-RT-9

import { realtime } from './config.js';
import { t } from './i18n.js';
import { stopPositions, projectOnPath } from './lib/routeGeometry.js';

// Latest position of every bus currently running on a route (GTFS route_id == SIRI LineRef).
// Returns [{ rideId, vehicle, lat, lon, recordedAt: Date }]
export async function fetchLiveBuses(routeId) {
  const now = Date.now();
  const params = new URLSearchParams({
    siri_routes__line_ref: routeId,
    recorded_at_time_from: new Date(now - realtime.windowMinutes * 60000).toISOString(),
    // An upper bound filters out bad future timestamps (some rows say 2038).
    recorded_at_time_to: new Date(now + 2 * 60000).toISOString(),
    order_by: 'recorded_at_time desc',
    limit: '300',
  });
  const res = await fetch(`${realtime.baseUrl}/siri_vehicle_locations/list?${params}`);
  if (!res.ok) throw new Error(t('Live data error (HTTP {status})', { status: res.status }));
  const rows = await res.json();

  const latestByRide = new Map();
  for (const r of rows) {
    const key = r.siri_ride__id ?? r.siri_ride__vehicle_ref;
    if (latestByRide.has(key)) continue; // rows are newest first
    latestByRide.set(key, {
      rideId: String(key),
      vehicle: r.siri_ride__vehicle_ref,
      lat: r.lat,
      lon: r.lon,
      recordedAt: new Date(r.recorded_at_time),
    });
  }
  return dropFinishedRides([...latestByRide.values()]);
}

// The feed can run late, so "old" is judged against the newest position the feed has for
// this route, not against the clock: a bus whose last position is far behind the newest
// one has finished its trip (REQ-RT-9).
export function dropFinishedRides(buses, gapMinutes = realtime.rideGapMinutes) {
  if (!buses.length) return buses;
  const newest = Math.max(...buses.map((b) => b.recordedAt.getTime()));
  return buses.filter((b) => newest - b.recordedAt.getTime() <= gapMinutes * 60000);
}

// True when a position is too old to be called live.
export const isLate = (date) => Date.now() - date.getTime() > realtime.lateMinutes * 60000;

// Puts each bus on the line and picks, relative to the chosen stop:
//   next   = the two closest buses that have not reached the chosen stop yet
//   passed = the one bus that passed the chosen stop most recently
// routeStops: ordered stops of the line; shape: the line's path as [[lat, lon], ...].
// otherPaths: the paths of the route's other stop patterns.
// stopsAway: 0 = the chosen stop is the bus's next stop; -1 = it passed it at its last stop.
export function classifyBuses(buses, routeStops, stopId, shape, otherPaths = []) {
  const target = routeStops.findIndex((s) => s.id === stopId);
  if (target < 0) return { next: [], passed: [] };
  const path = shape && shape.length > 1 ? shape : routeStops.map((s) => [s.lat, s.lon]);
  const stopPos = stopPositions(routeStops, path);

  const placed = [];
  for (const bus of buses) {
    const { pos, meters } = projectOnPath(bus, path);
    // A bus is dropped only when it is on none of the route's paths (depot, bad GPS). A bus
    // driving another stop pattern of the same route stays: it is shown where it really is,
    // and counted from the nearest point of this path (REQ-RT-8).
    if (meters > realtime.maxOffRouteMeters &&
        !otherPaths.some((p) => projectOnPath(bus, p).meters <= realtime.maxOffRouteMeters)) continue;
    // The next stop the bus will reach: the first stop at or after its position.
    let nextStop = stopPos.findIndex((p) => p >= pos - 1e-6);
    if (nextStop < 0) nextStop = routeStops.length; // past the last stop
    const stopsAway = target - nextStop;
    placed.push({ ...bus, nextStop, stopsAway, offRouteMeters: Math.round(meters) });
  }

  const next = placed
    .filter((b) => b.stopsAway >= 0)
    .sort((a, b) => a.stopsAway - b.stopsAway)
    .slice(0, 2);
  const passed = placed
    .filter((b) => b.stopsAway < 0)
    .sort((a, b) => b.stopsAway - a.stopsAway)
    .slice(0, 1);
  return { next, passed };
}

export function ageLabel(date) {
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return sec < 60 ? t('{n}s ago', { n: sec }) : t('{n} min ago', { n: Math.round(sec / 60) });
}
