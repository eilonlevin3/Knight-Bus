// Live bus positions and "next two + last passed" logic. Docs: docs/realtime.md
// @req REQ-RT-1 @req REQ-RT-2

import { realtime } from './config.js';

// Latest position of every bus currently running on a line (GTFS route_id == SIRI LineRef).
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
  if (!res.ok) throw new Error(`Live data HTTP ${res.status}`);
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
  return [...latestByRide.values()];
}

// Puts each bus on the line and picks, relative to the chosen stop:
//   next   = the two closest buses that have not reached the chosen stop yet
//   passed = the one bus that passed the chosen stop most recently
// routeStops: ordered stops of the line; shape: the line's path as [[lat, lon], ...].
// stopsAway: 0 = the chosen stop is the bus's next stop; -1 = it passed it at its last stop.
export function classifyBuses(buses, routeStops, stopId, shape) {
  const target = routeStops.findIndex((s) => s.id === stopId);
  if (target < 0) return { next: [], passed: [] };
  const path = shape && shape.length > 1 ? shape : routeStops.map((s) => [s.lat, s.lon]);
  const stopPos = stopPositions(routeStops, path);

  const placed = [];
  for (const bus of buses) {
    const { pos, meters } = projectOnPath(bus, path);
    if (meters > realtime.maxOffRouteMeters) continue; // not on this line (depot, detour, bad GPS)
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

// Position of each stop along the path, in "segment units" (segment index + fraction).
// Walks forward so stops stay in order even where a line comes back along the same street.
const stopPosCache = new WeakMap();
function stopPositions(routeStops, path) {
  const cached = stopPosCache.get(routeStops);
  if (cached && cached.path === path) return cached.pos;
  const pos = [];
  let from = 0;
  for (const s of routeStops) {
    const { pos: p } = projectOnPath(s, path, Math.floor(from), true);
    pos.push(p);
    from = p;
  }
  stopPosCache.set(routeStops, { path, pos });
  return pos;
}

// Nearest point on the path to a {lat, lon}. Returns { pos, meters }.
// With preferEarliest, takes the first segment within 30 m of the best match, so a stop
// on the way out does not jump to the same street on the way back.
function projectOnPath(pt, path, startSeg = 0, preferEarliest = false) {
  const k = Math.cos(pt.lat * (Math.PI / 180));
  const candidates = [];
  let best = Infinity;
  for (let i = Math.max(0, startSeg); i < path.length - 1; i++) {
    const ax = path[i][1] * k, ay = path[i][0];
    const bx = path[i + 1][1] * k, by = path[i + 1][0];
    const px = pt.lon * k, py = pt.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const meters = Math.hypot(ax + t * dx - px, ay + t * dy - py) * 111320;
    candidates.push([i + t, meters]);
    if (meters < best) best = meters;
  }
  if (!candidates.length) return { pos: 0, meters: Infinity };
  const [pos, meters] = preferEarliest
    ? candidates.find(([, m]) => m <= best + 30)
    : candidates.find(([, m]) => m === best);
  return { pos, meters };
}

export function ageLabel(date) {
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  return sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`;
}
