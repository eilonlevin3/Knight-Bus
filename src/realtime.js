// Live bus positions and "next two + last passed" logic. Docs: docs/realtime.md
// @req REQ-RT-1 @req REQ-RT-2 @req REQ-RT-8 @req REQ-RT-9 @req REQ-RT-11

import { realtime } from './config.js';
import { t } from './i18n.js';
import { stopPositions, projectOnPath } from './lib/routeGeometry.js';

// Latest position of every bus currently running on a route (GTFS route_id == SIRI LineRef).
// Returns [{ rideId, vehicle, lat, lon, recordedAt: Date, raw }]; raw is the whole signal as
// it came, for the bus pop-up (REQ-RT-10).
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
  // Without a time limit a source that hangs would leave "Loading live buses…" forever.
  const res = await fetch(`${realtime.baseUrl}/siri_vehicle_locations/list?${params}`, { signal: AbortSignal.timeout(realtime.timeoutMs) });
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
      raw: r,
    });
  }
  return dropFinishedRides([...latestByRide.values()]);
}

// One bus record from the relay (the ministry's own wording) as the app's bus. `raw` uses
// the same field names as the Stride answers, so the bus pop-up reads both alike.
export function busFromRecord(record, snapshot) {
  const j = record.MonitoredVehicleJourney || {};
  const frame = j.FramedVehicleJourneyRef || {};
  const call = j.MonitoredCall || {};
  const lat = Number(j.VehicleLocation?.Latitude);
  const lon = Number(j.VehicleLocation?.Longitude);
  const recordedAt = new Date(record.RecordedAtTime);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Number.isNaN(recordedAt.getTime())) return null;
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  return {
    rideId: `${frame.DatedVehicleJourneyRef || ''}|${j.VehicleRef || ''}`,
    vehicle: j.VehicleRef || null,
    lat,
    lon,
    recordedAt,
    raw: {
      source: 'relay',
      recorded_at_time: record.RecordedAtTime,
      lon,
      lat,
      bearing: num(j.Bearing),
      velocity: num(j.Velocity),
      siri_snapshot__snapshot_id: snapshot,
      siri_route__line_ref: num(j.LineRef),
      siri_route__operator_ref: num(j.OperatorRef),
      siri_ride__journey_ref: frame.DataFrameRef && frame.DatedVehicleJourneyRef ? `${frame.DataFrameRef}-${frame.DatedVehicleJourneyRef}` : null,
      siri_ride__scheduled_start_time: j.OriginAimedDepartureTime || null,
      siri_ride__vehicle_ref: j.VehicleRef || null,
      next_stop_code: call.StopPointRef || null,
      next_stop_order: num(call.Order),
      distance_from_stop: num(call.DistanceFromStop),
    },
  };
}

// How the last live answer came, for the line under each list (REQ-RT-11):
// { source: 'relay' | 'stride', reason: why the relay was not used, or null }
export const liveStatus = { source: null, reason: null };

// Live buses of several route ids in one go: Map(route id -> { buses } or { error }).
// Asks our relay when it is set up (positions about a minute old); if it is not, or it
// does not answer, asks Open Bus Stride for each id as before (REQ-RT-11).
// Every position of a route's buses in the last `minutes`, oldest first, from Open Bus
// Stride: [{ rideId, lat, lon, recordedAt: Date }]. Only for learning live traffic at once
// (REQ-RT-15); the newest positions still come from fetchLiveMany.
export async function fetchTrail(liveId, minutes = 20, now = Date.now()) {
  const params = new URLSearchParams({
    siri_routes__line_ref: liveId,
    recorded_at_time_from: new Date(now - minutes * 60000).toISOString(),
    recorded_at_time_to: new Date(now + 2 * 60000).toISOString(),
    order_by: 'recorded_at_time desc',
    limit: '1000',
  });
  const res = await fetch(`${realtime.baseUrl}/siri_vehicle_locations/list?${params}`, { signal: AbortSignal.timeout(realtime.timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())
    .map((r) => ({ rideId: `trail|${r.siri_ride__id ?? r.siri_ride__vehicle_ref}`, lat: r.lat, lon: r.lon, recordedAt: new Date(r.recorded_at_time) }))
    .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.recordedAt.getTime()))
    .reverse();
}

export async function fetchLiveMany(routeIds, now = Date.now()) {
  const ids = [...new Set(routeIds.map(String))];
  if (realtime.relayUrl && ids.length) {
    try {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 80) {
        const res = await fetch(`${realtime.relayUrl}/live?routes=${ids.slice(i, i + 80).join(',')}`, { signal: AbortSignal.timeout(realtime.relayTimeoutMs) });
        if (!res.ok) throw new Error(`relay HTTP ${res.status}`);
        const answer = await res.json();
        // The file also holds buses last heard long ago: a bus that stopped sending (its trip
        // ended, its radio went quiet) stays in it for half an hour. When the file itself is
        // up to date, a bus that has said nothing for 7 minutes is not running: leave it out.
        // Only when the whole feed is late are older positions shown, marked late (REQ-RT-9).
        const fileTime = Date.parse(answer.at);
        const feedFresh = Number.isFinite(fileTime) && now - fileTime <= realtime.freshFeedMinutes * 60000;
        const maxAge = (feedFresh ? realtime.rideGapMinutes : realtime.windowMinutes) * 60000;
        for (const [id, records] of Object.entries(answer.routes)) {
          const buses = records.map((r) => busFromRecord(r, answer.snapshot)).filter((b) => b &&
            now - b.recordedAt.getTime() <= maxAge && b.recordedAt.getTime() <= now + 2 * 60000); // a few have a wrong future time
          out.set(id, { buses: dropFinishedRides(latestPerRide(buses)) });
        }
      }
      liveStatus.source = 'relay';
      liveStatus.reason = null;
      return out;
    } catch (e) {
      console.warn('Live relay did not answer; asking Open Bus Stride instead', e);
      liveStatus.reason = e.name === 'TimeoutError' ? 'timeout' : e.message || e.name;
    }
  } else {
    liveStatus.reason = realtime.relayUrl ? null : 'not set up';
  }
  liveStatus.source = 'stride';
  const settled = await Promise.all(ids.map((id) => fetchLiveBuses(id).then((buses) => [id, { buses }], (error) => [id, { error }])));
  return new Map(settled);
}

// One position per ride: the newest.
function latestPerRide(buses) {
  const byRide = new Map();
  for (const b of buses) if (!byRide.has(b.rideId) || byRide.get(b.rideId).recordedAt < b.recordedAt) byRide.set(b.rideId, b);
  return [...byRide.values()];
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
