// How long buses really take between stops, by half hour of the day: a month of history.
// Docs: docs/realtime.md#the-ghost-an-estimate-of-where-the-bus-is-now
// @req REQ-DATA-12 @req REQ-RT-12
//
// Used only by the ghost. A route's file (data/speeds/<route id>.json, made by
// pipeline/build-speeds.mjs) is downloaded the first time a ghost is turned on for one of
// its buses, never before.

import { speedsBaseUrl } from '../config.js';

export const WINDOWS = 48; // half hours in a day
const loaded = new Map(); // route id -> Promise(file | null)

// The route's file, or null when there is none (a new or rare route) or no connection.
export function loadSpeeds(routeId) {
  if (!loaded.has(routeId)) {
    loaded.set(routeId, fetch(`${speedsBaseUrl}${encodeURIComponent(routeId)}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null));
  }
  return loaded.get(routeId);
}

// Which half hour it is in Israel, and whether it is the weekend there (Friday, Saturday).
// Returns 0..95: weekday half hours first, then the weekend's.
const israel = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : null;
export function cellAt(date = new Date()) {
  const parts = Object.fromEntries(israel.formatToParts(date).map((p) => [p.type, p.value]));
  const weekend = parts.weekday === 'Fri' || parts.weekday === 'Sat';
  return (weekend ? WINDOWS : 0) + Number(parts.hour) * 2 + (Number(parts.minute) >= 30 ? 1 : 0);
}

// Seconds buses usually take from one stop to the next at that time, or null when not known.
// A stretch with too few trips in that half hour uses its average over the whole day
// (of the same kind of day).
export function segmentSeconds(speeds, fromStopId, toStopId, cell) {
  const row = speeds?.segments?.[`${fromStopId}>${toStopId}`];
  if (!row) return null;
  return row[cell] ?? row[WINDOWS * 2 + (cell >= WINDOWS ? 1 : 0)] ?? null;
}
