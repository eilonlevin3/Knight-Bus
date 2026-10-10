// Which points a map should fit to show "where my bus is now": for every (stop, line) pair,
// the stretch the line drives in the last minutes before that stop.
// Shared by the home screen and the commute view. @req REQ-COMM-2 @req REQ-HOME-2 @req REQ-LINE-1a

import { approachPath } from './routeGeometry.js';

// entries: [{ stopId, routeId }]  ->  [[lat, lon], ...]
export function approachPoints(city, entries, minutes = 5) {
  const pts = [];
  for (const e of entries) {
    const route = city.routes.get(e.routeId);
    const pattern = route && city.patternsAt(route, e.stopId)[0];
    if (!pattern) continue;
    const idx = pattern.stops.findIndex((s) => s.id === e.stopId);
    pts.push(...approachPath(pattern, city.shapeOf(pattern), idx, minutes));
  }
  return pts;
}
