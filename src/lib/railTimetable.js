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


// ---------- The From / To search with a date and a time (REQ-TRAIN-3) ----------

// Today's date in Israel, "YYYY-MM-DD".
const ymd = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
export const israelToday = (date = new Date()) => ymd.format(date);

// "2026-10-16" + 2 days -> "2026-10-18"; and the weekday (0 = Sunday) of a date.
export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

// Trains from one station to another, around a date and time.
//   when: { date: "YYYY-MM-DD", minutes: minutes since midnight, mode: 'leave' | 'arrive' }
//   leave:  the first `count` trains leaving at that time or later, on that day or the next;
//   arrive: the last `count` trains arriving at that time or earlier.
// Returns [{ route, start, minute, arrive, dest, date, serviceDate }]: `minute` and `arrive`
// count from midnight of `date` (the day the train leaves); `serviceDate` is the day of the
// timetable it runs on (a train after midnight belongs to the day before).
// The timetable files cover a week, by weekday; further ahead the weekday is used again.
export async function searchTrips(city, routes, fromIds, toIds, { date, minutes, mode = 'leave' }, count = 5, timetableOf = scheduleOf) {
  const found = [];
  const days = mode === 'leave' ? [-1, 0, 1, 2, 3, 4, 5, 6, 7] : [-8, -7, -6, -5, -4, -3, -2, -1, 0];
  for (const route of routes) {
    const schedule = await timetableOf(route);
    if (!schedule) continue;
    schedule.patterns.forEach((pattern, pi) => {
      const at = pattern.stops.findIndex((id) => fromIds.has(id));
      if (at < 0) return;
      const to = pattern.stops.findIndex((id, k) => k > at && toIds.has(id));
      const off = pattern.offsets || [];
      if (to < 0 || off[at] == null || off[to] == null) return;
      const lastStop = city.stops.get(pattern.stops.at(-1));
      for (const k of days) {
        const serviceDate = addDays(date, k);
        const bit = 1 << weekdayOf(serviceDate);
        for (const [mask, start, tpi] of schedule.trips) {
          if (tpi !== pi || !(mask & bit)) continue;
          const leave = k * 1440 + start + off[at]; // minutes from midnight of `date`
          const arrive = k * 1440 + start + off[to];
          if (mode === 'leave' ? leave < minutes : arrive > minutes) continue;
          found.push({ route, start, leave, arrive, dest: lastStop ? lastStop.name : route.dest, serviceDate });
        }
      }
    });
  }
  found.sort((a, b) => (mode === 'leave' ? a.leave - b.leave : b.arrive - a.arrive));
  const chosen = found.slice(0, count);
  if (mode === 'arrive') chosen.reverse();
  return chosen.map((x) => {
    const day = Math.floor(x.leave / 1440);
    return { route: x.route, start: x.start, minute: x.leave - day * 1440, arrive: x.arrive - day * 1440, dest: x.dest, date: addDays(date, day), serviceDate: x.serviceDate };
  });
}
