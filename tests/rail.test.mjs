// Train stations and light rail stops: the timetable and the From / To search.
// Docs: docs/user-flows.md#train-stations
// @req REQ-TRAIN-2 @req REQ-TRAIN-3

import test from 'node:test';
import assert from 'node:assert/strict';
import { departures } from '../src/lib/railTimetable.js';
import { clock } from '../src/lib/israelTime.js';

// Stations A, B, C, D in a row. Route "up" runs A-B-C-D, route "down" D-C-B-A.
const stop = (id) => ({ id, name: `Station ${id}` });
const city = { stops: new Map(['A', 'B', 'C', 'D'].map((id) => [id, stop(id)])) };
const up = { id: 'up', dest: 'D', stops: ['A', 'D'].map(stop) };
const down = { id: 'down', dest: 'A', stops: ['D', 'A'].map(stop) };
const MON = 1 << 1;
const SUN = 1 << 0;
const timetables = {
  // offsets: minutes from the first station to each station
  up: { patterns: [{ stops: ['A', 'B', 'C', 'D'], offsets: [0, 10, 25, 40] }], trips: [[MON, 7 * 60, 0], [MON, 8 * 60, 0], [MON | SUN, 23 * 60 + 50, 0]] },
  down: { patterns: [{ stops: ['D', 'C', 'B', 'A'], offsets: [0, 15, 30, 40] }], trips: [[MON, 7 * 60 + 30, 0]] },
};
const of = async (route) => timetables[route.id];
const ids = (...x) => new Set(x);

test('a station timetable: every train through it, both ways, from now on, by time', async () => {
  const now = { day: 1, minutes: 7 * 60 + 5 }; // Monday 07:05
  const list = await departures(city, [up, down], ids('B'), null, now, of);
  assert.deepEqual(list.map((d) => `${clock(d.minute)} ${d.route.id} to ${d.dest}`), [
    '07:10 up to Station D', // left A at 07:00, at B ten minutes later
    '08:00 down to Station A',
    '08:10 up to Station D',
    '00:00 up to Station D', // the 23:50 from A reaches B after midnight
  ]);
});

test('a train that ends at the station is not a departure', async () => {
  const list = await departures(city, [up], ids('D'), null, { day: 1, minutes: 0 }, of);
  assert.deepEqual(list, []);
});

test('yesterday\'s late trains count after midnight', async () => {
  // Monday 00:05: Sunday's 23:50 from A is at B at 00:00 (missed) and at C at 00:15.
  const list = await departures(city, [up], ids('C'), null, { day: 1, minutes: 5 }, of);
  assert.equal(clock(list[0].minute), '00:15');
  assert.equal(list[0].start, 23 * 60 + 50 - 1440);
});

test('From / To: only trains that go from one to the other, with the arrival time', async () => {
  const now = { day: 1, minutes: 6 * 60 };
  const trips = await departures(city, [up, down], ids('B'), ids('D'), now, of);
  assert.deepEqual(trips.map((d) => `${clock(d.minute)}-${clock(d.arrive)} ${d.route.id}`), ['07:10-07:40 up', '08:10-08:40 up', '00:00-00:30 up']);
  const back = await departures(city, [up, down], ids('C'), ids('A'), now, of);
  assert.deepEqual(back.map((d) => `${clock(d.minute)}-${clock(d.arrive)}`), ['07:45-08:10']);
  assert.deepEqual(await departures(city, [up, down], ids('D'), ids('D'), now, of), []);
});

import { searchTrips, addDays, weekdayOf } from '../src/lib/railTimetable.js';

test('dates: adding days and weekdays', () => {
  assert.equal(addDays('2026-10-16', 2), '2026-10-18');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-10-16'), 5); // a Friday
});

// 2026-10-19 is a Monday, 2026-10-18 a Sunday.
test('leave at: the next five trains, going on to the next days when today has fewer', async () => {
  const trips = await searchTrips(city, [up], ids('B'), ids('D'), { date: '2026-10-19', minutes: 8 * 60, mode: 'leave' }, 5, of);
  assert.deepEqual(trips.map((d) => `${d.date} ${clock(d.minute)}-${clock(d.arrive)}`), [
    '2026-10-19 08:10-08:40',
    '2026-10-20 00:00-00:30', // Monday's 23:50 from A is at B after midnight
    '2026-10-26 00:00-00:30', // Sunday's 23:50, the next week (trains repeat by weekday)
    '2026-10-26 07:10-07:40',
    '2026-10-26 08:10-08:40',
  ]);
  assert.equal(trips[1].serviceDate, '2026-10-19');
});

test('arrive by: the last trains that get there in time, earliest first', async () => {
  const trips = await searchTrips(city, [up], ids('B'), ids('D'), { date: '2026-10-19', minutes: 8 * 60 + 45, mode: 'arrive' }, 2, of);
  assert.deepEqual(trips.map((d) => `${d.date} ${clock(d.minute)}-${clock(d.arrive)}`), ['2026-10-19 07:10-07:40', '2026-10-19 08:10-08:40']);
});

// REQ-TRAIN-6: platforms from Israel Railways, put on the timetable's departures.
import { addPlatforms, byPlatform } from '../src/lib/railTimetable.js';

test('platforms are matched to departures by time and end station, then grouped', () => {
  const end = (code) => ({ code });
  const board = [
    { minute: 7 * 60 + 10, destStop: end('A1') },
    { minute: 7 * 60 + 10, destStop: end('B1') }, // two trains at the same minute, other ways
    { minute: 7 * 60 + 20, destStop: end('A1') },
    { minute: 7 * 60 + 30, destStop: end('A1') },
    { minute: 7 * 60 + 40, destStop: end('A1') },
    { minute: 7 * 60 + 50, destStop: end('A1') }, // no platform known
  ];
  const trains = [
    { train: 1, time: '07:10', platform: 1, to: 100 }, { train: 2, time: '07:10', platform: 2, to: 200 },
    { train: 3, time: '07:20', platform: 1, to: 100 }, { train: 4, time: '07:30', platform: 1, to: 100 },
    { train: 5, time: '07:40', platform: 1, to: 100 },
  ];
  addPlatforms(board, trains, (stop) => ({ A1: 100, B1: 200 })[stop.code]);
  assert.deepEqual(board.map((d) => d.platform ?? null), [1, 2, 1, 1, 1, null]);
  assert.equal(board[1].train, 2);
  const groups = byPlatform(board, 3);
  assert.deepEqual(groups.map((g) => [g.platform, g.departures.length]), [[1, 3], [2, 1], [null, 1]]);
  assert.equal(groups[0].departures[2].minute, 7 * 60 + 30); // only the next three
});

test('a train a few minutes off in the other timetable still gets its platform', () => {
  const board = [{ minute: 11 * 60 + 3, destStop: { code: 'B' } }, { minute: 11 * 60 + 15, destStop: { code: 'C' } }];
  const trains = [{ train: 9, time: '11:11', platform: 1, to: 2 }, { train: 8, time: '11:17', platform: 3, to: 3 }, { train: 7, time: '11:40', platform: 2, to: 2 }];
  addPlatforms(board, trains, (s) => ({ B: 2, C: 3 })[s.code]);
  assert.deepEqual(board.map((d) => [d.platform, d.railTime]), [[1, '11:11'], [3, '11:17']]);
});

// REQ-TRAIN-7: one train, station by station.
import { tripStations } from '../src/lib/railTimetable.js';

test('a trip station by station: before, where you get on, on the way, where you get off, after', async () => {
  const now = { day: 1, minutes: 6 * 60 };
  const [dep] = await searchTrips(city, [up], ids('B'), ids('C'), { date: '2026-10-19', minutes: 7 * 60, mode: 'leave' }, 1, of);
  const list = tripStations(city, dep);
  assert.deepEqual(list.map((x) => `${x.stop.id} ${clock(x.minute)} ${x.part}`), ['A 07:00 before', 'B 07:10 here', 'C 07:25 end', 'D 07:40 after']);
  const [board] = await departures(city, [up], ids('B'), null, now, of);
  assert.deepEqual(tripStations(city, board).map((x) => x.part), ['before', 'here', 'on', 'end']); // the end of the line
});
