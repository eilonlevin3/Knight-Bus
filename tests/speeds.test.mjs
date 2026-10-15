// A month of real travel times between stops, for the ghost.
// Docs: docs/data-pipeline.md#travel-times-a-month-of-history
// @req REQ-DATA-12

import test from 'node:test';
import assert from 'node:assert/strict';
import { DayCounter, averageDays, cellOf, CELLS, WINDOWS } from '../pipeline/build-speeds.mjs';
import { cellAt, segmentSeconds } from '../src/lib/speeds.js';
import { advanceOnPath } from '../src/lib/routeGeometry.js';

// A straight route heading north: 11 stops about 111 m apart.
const stops = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, lat: 32 + i * 0.001, lon: 34.8 }));
const shape = stops.map((s) => [s.lat, s.lon]);
const pattern = { stops, times: stops.map((_, i) => i) };
const route = { id: '100', liveIds: ['100', '101'], patterns: [pattern] };
const city = { shapeOf: () => shape };
const found = (ref) => (ref === '100' || ref === '101' ? { city, route } : undefined);

// A signal: the bus `meters` north of the first stop, at a time of day in Israel (+03:00).
const signal = (lineRef, vehicle, clock, meters, date = '2026-10-13') => ({
  RecordedAtTime: `${date}T${clock}+03:00`,
  MonitoredVehicleJourney: {
    LineRef: lineRef, FramedVehicleJourneyRef: { DatedVehicleJourneyRef: `trip-${vehicle}` }, VehicleRef: vehicle,
    VehicleLocation: { Latitude: String(32 + meters / 111320), Longitude: '34.8' },
  },
});

test('half hours of the day, with the weekend apart', () => {
  const at = (iso) => cellOf(Date.parse(iso), 180);
  assert.equal(at('2026-10-13T00:10:00+03:00'), 0); // Tuesday, just after midnight
  assert.equal(at('2026-10-13T17:05:00+03:00'), 34);
  assert.equal(at('2026-10-13T17:45:00+03:00'), 35);
  assert.equal(at('2026-10-16T17:05:00+03:00'), WINDOWS + 34); // Friday
  assert.equal(at('2026-10-17T23:59:00+03:00'), WINDOWS + 47); // Saturday
  assert.equal(at('2026-10-18T08:00:00+03:00'), 16); // Sunday is a weekday in Israel
  assert.equal(CELLS, 96);
});

test('one signal a minute becomes times between stops', () => {
  // 3.7 m a second: a stop every 30 seconds; a signal every 60 seconds.
  const counter = new DayCounter(found);
  for (let minute = 0; minute <= 4; minute++) counter.add(signal('100', 'bus1', `17:0${minute}:00`, 20 + minute * 60 * 3.7));
  const segments = counter.summary()['100'];
  // The bus is known from stop 1 on (it was first seen after stop 0), up to stop 8.
  assert.deepEqual(Object.keys(segments), ['s1>s2', 's2>s3', 's3>s4', 's4>s5', 's5>s6', 's6>s7', 's7>s8']);
  for (const [cell, count, seconds] of Object.values(segments).map((x) => x)) {
    assert.equal(cell, 34); // 17:00-17:30 on a weekday
    assert.equal(count, 1);
    assert.ok(Math.abs(seconds - 30) <= 1, `seconds ${seconds}`);
  }
});

test('signals too far apart, or a jump no bus can drive, are not joined', () => {
  const counter = new DayCounter(found);
  counter.add(signal('100', 'bus2', '09:00:00', 20));
  counter.add(signal('100', 'bus2', '09:10:00', 400)); // ten minutes of silence
  counter.add(signal('100', 'bus2', '09:10:30', 1000)); // 600 m in 30 s is fine (72 km/h)...
  assert.deepEqual(Object.keys(counter.summary()['100'] || {}), ['s4>s5', 's5>s6', 's6>s7', 's7>s8']);
  const jump = new DayCounter(found);
  jump.add(signal('100', 'bus3', '09:00:00', 20));
  jump.add(signal('100', 'bus3', '09:00:10', 1000)); // ...but 980 m in 10 s is not
  assert.equal(jump.summary()['100'], undefined);
  const other = new DayCounter(found);
  other.add(signal('555', 'bus4', '09:00:00', 20)); // a route we do not have
  assert.deepEqual(other.summary(), {});
});

test('the month average: per half hour, weekend apart, alternatives of a route together', () => {
  const day = (lineRef, list) => ({ routes: { [lineRef]: { 's1>s2': list } } });
  const days = [
    day('100', [34, 2, 80, 44, 1, 20]), // two trips at 17:00 took 80 s together; one at 22:00 took 20 s
    day('101', [34, 2, 100]), // a merged alternative of the same route: two more trips, 100 s
    day('100', [WINDOWS + 34, 3, 60]), // a Friday
  ];
  const file = averageDays(days, [route]).get('100');
  const row = file['s1>s2'];
  assert.equal(row.length, CELLS + 2);
  assert.equal(row[34], 45); // (80 + 100) / 4
  assert.equal(row[44], null); // one trip is too few to trust
  assert.equal(row[WINDOWS + 34], 20);
  assert.equal(row[CELLS], 40); // every weekday trip: 200 s / 5
  assert.equal(row[CELLS + 1], 20);
  assert.equal(averageDays(days, [{ id: '9', liveIds: ['9'] }]).size, 0);
});

test('the app reads a stretch: this half hour, else the day average, else nothing', () => {
  const speeds = { segments: { 's1>s2': [...Array(CELLS).fill(null), 40, 20] } };
  speeds.segments['s1>s2'][34] = 45;
  assert.equal(segmentSeconds(speeds, 's1', 's2', 34), 45);
  assert.equal(segmentSeconds(speeds, 's1', 's2', 10), 40);
  assert.equal(segmentSeconds(speeds, 's1', 's2', WINDOWS + 10), 20);
  assert.equal(segmentSeconds(speeds, 's2', 's3', 34), null);
  assert.equal(segmentSeconds(null, 's1', 's2', 34), null);
  // 17:05 on a Tuesday in Israel is 14:05 UTC in summer.
  assert.equal(cellAt(new Date('2026-07-14T14:05:00Z')), 34);
  assert.equal(cellAt(new Date('2026-07-17T14:05:00Z')), WINDOWS + 34); // a Friday
});

test('a ghost uses the real travel time of a stretch where it is known', () => {
  // The timetable says one minute per stop. Really, the stretch to stop 3 takes two minutes.
  const secondsOf = (i) => (i === 3 ? 120 : null);
  assert.ok(Math.abs(advanceOnPath(pattern, shape, 2, 60, undefined, secondsOf) - 2.5) < 1e-6);
  assert.ok(Math.abs(advanceOnPath(pattern, shape, 2, 180, undefined, secondsOf) - 4) < 1e-6);
  // A route with no timetable at all still gets its known stretches.
  const noTimes = { stops, times: null };
  assert.ok(Math.abs(advanceOnPath(noTimes, shape, 2, 60, undefined, secondsOf) - 2.5) < 1e-6);
});

// REQ-RT-13: the ghosts a Favorite Commute shows by itself.
import { pickAutoGhosts } from '../src/lib/ghosts.js';
import { travelSeconds } from '../src/lib/routeGeometry.js';

test('the ghost closest to the stop is shown; the one behind it from a minute before it arrives', () => {
  assert.deepEqual(pickAutoGhosts([{ id: 'far', seconds: 400 }, { id: 'near', seconds: 120 }]), ['near']);
  assert.deepEqual(pickAutoGhosts([{ id: 'far', seconds: 400 }, { id: 'near', seconds: 60 }]), ['near', 'far']);
  // It passed the stop 30 seconds ago: still shown, with the next one.
  assert.deepEqual(pickAutoGhosts([{ id: 'far', seconds: 400 }, { id: 'near', seconds: -30 }]), ['near', 'far']);
  // It passed more than a minute ago: gone; the next one is now the closest.
  assert.deepEqual(pickAutoGhosts([{ id: 'far', seconds: 400 }, { id: 'near', seconds: -61 }]), ['far']);
  assert.deepEqual(pickAutoGhosts([{ id: 'x', seconds: NaN }]), []);
  assert.deepEqual(pickAutoGhosts([]), []);
});

test('travel time between two points of a route', () => {
  assert.equal(travelSeconds(pattern, shape, 2, 4), 120); // the timetable: a minute per stop
  assert.equal(travelSeconds(pattern, shape, 2.5, 3), 30);
  assert.equal(travelSeconds(pattern, shape, 4, 2), 0);
  assert.equal(travelSeconds(pattern, shape, 2, 4, undefined, (i) => (i === 3 ? 30 : null)), 90); // a known stretch
});
