// The timetable of a train station or light rail stop, and trains from one station to
// another, from the routes' timetable files (data/schedules/<route id>.json).
// Docs: docs/user-flows.md#train-stations
// @req REQ-TRAIN-2 @req REQ-TRAIN-3
//
// No browser needed, so it is unit tested.

import { loadSchedule } from '../cityData.js';
import { israelNow } from './israelTime.js';

const schedules = new Map(); // route id -> Promise(timetable | null)
const scheduleOf = (route) => {
  if (!schedules.has(route.id)) schedules.set(route.id, route.live ? loadSchedule(route.id) : Promise.resolve(null));
  return schedules.get(route.id);
};

// Every departure of these routes from any of the stops `fromIds`, from `now` on, today.
// With `toIds`: only trains that then stop at one of those, with the time they get there.
// Returns [{ route, start, minute, arrive, dest }] sorted by time. `start` is the trip's
// first departure (it tells the live train apart); times are minutes since midnight.
export async function departures(city, routes, fromIds, toIds = null, now = israelNow(), timetableOf = scheduleOf) {
  const out = [];
  const yesterday = (now.day + 6) % 7;
  for (const route of routes) {
    const schedule = await timetableOf(route);
    if (!schedule) continue;
    schedule.patterns.forEach((pattern, pi) => {
      const at = pattern.stops.findIndex((id) => fromIds.has(id));
      if (at < 0 || at === pattern.stops.length - 1) return; // not here, or ends here
      const to = toIds ? pattern.stops.findIndex((id, k) => k > at && toIds.has(id)) : pattern.stops.length - 1;
      if (to < 0) return;
      const off = pattern.offsets || [];
      if (off[at] == null) return;
      for (const [mask, start, tpi] of schedule.trips) {
        if (tpi !== pi) continue;
        // Today's trips, and yesterday's that run past midnight (the timetable says 24:10).
        const shifts = [];
        if (mask & (1 << now.day)) shifts.push(0);
        if (mask & (1 << yesterday) && start + off[at] >= 1440) shifts.push(-1440);
        for (const shift of shifts) {
          const minute = start + off[at] + shift;
          if (minute < now.minutes - 1 || minute >= 1440 + 180) continue;
          const lastStop = city.stops.get(pattern.stops.at(-1));
          out.push({
            route, start: start + shift, minute, arrive: off[to] != null ? start + off[to] + shift : null,
            dest: lastStop ? lastStop.name : route.dest,
          });
        }
      }
    });
  }
  return out.sort((a, b) => a.minute - b.minute);
}

