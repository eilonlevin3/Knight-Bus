// Which points a map should fit to show "where my bus is now": for every (stop, line) pair,
// the stretch the line drives in the last minutes before that stop.
// Shared by the home screen and the commute view. @req REQ-COMM-2 @req REQ-HOME-2

import { approachPath } from './routeGeometry.js';

// entries: [{ stopId, routeId }]  ->  [[lat, lon], ...]
export function approachPoints(city, entries, minutes = 5) {
  const pts = [];
  for (const e of entries) {
    const route = city.routes.get(e.routeId);
    const idx = route ? route.stops.findIndex((s) => s.id === e.stopId) : -1;
    if (idx < 0) continue;
    pts.push(...approachPath(route, city.shapeOf(route), idx, minutes));
  }
  return pts;
}
