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
