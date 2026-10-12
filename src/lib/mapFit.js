// Which points a map should fit, so it opens on what matters.
// Shared by the home screen, the Favorite Commute view and the editor.
// @req REQ-COMM-2 @req REQ-HOME-2 @req REQ-LINE-1a

import { approachPath, pathBefore, stopPositions } from './routeGeometry.js';

// The pattern of a route that passes a stop, with the stop's place in it; or null.
function patternAt(city, { stopId, routeId }) {
  const route = city.routes.get(routeId);
  const pattern = route && city.patternsAt(route, stopId)[0];
  if (!pattern) return null;
  return { pattern, index: pattern.stops.findIndex((s) => s.id === stopId) };
}

// Home screen (REQ-HOME-2): for every (stop, route) pair, the stretch the route drives in the
// last minutes before that stop, by the timetable. "Where my bus is now."
// entries: [{ stopId, routeId }]  ->  [[lat, lon], ...]
export function approachPoints(city, entries, minutes = 5) {
  const pts = [];
  for (const e of entries) {
    const at = patternAt(city, e);
    if (at) pts.push(...approachPath(at.pattern, city.shapeOf(at.pattern), at.index, minutes));
  }
  return pts;
}

// For every (stop, route) pair, the last `meters` of the route's path before that stop.
export function incomingPoints(city, entries, meters = 1000) {
  const pts = [];
  for (const e of entries) {
    const at = patternAt(city, e);
    if (!at) continue;
    const path = city.shapeOf(at.pattern);
    pts.push(...pathBefore(path, stopPositions(at.pattern.stops, path)[at.index], meters));
  }
  return pts;
}

// What a Favorite Commute opens on when the person chose no view of their own (REQ-COMM-2):
// its stops, and about one kilometer of every chosen route coming to them.
export function commuteViewPoints(city, fav) {
  const entries = fav.stops.flatMap((s) => s.routeIds.map((routeId) => ({ stopId: s.stopId, routeId })));
  const stops = fav.stops.map((s) => city.stops.get(s.stopId)).filter(Boolean).map((s) => [s.lat, s.lon]);
  return [...stops, ...incomingPoints(city, entries)];
}
