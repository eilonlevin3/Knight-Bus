// Unit tests for lines with more than one route (REQ-DATA-8, REQ-LINE-1) and timetables (REQ-LINE-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityData } from '../src/cityData.js';
import { timesAtStop } from '../src/lib/schedule.js';
import { encode } from '../src/lib/polyline.js';

// Stops A B C D E in a row. Line 62: usual route A B C D E (60%), variant A B D E (40%, skips C).
const stops = ['A', 'B', 'C', 'D', 'E'].map((id, i) => [id, `c${id}`, `Stop ${id}`, 32 + i * 0.001, 34.8]);
const shape = (idx) => encode(idx.map((i) => [stops[i][3], stops[i][4]]));
const raw = {
  cityId: 't', agencies: ['Dan'], sources: {},
  stops,
  routes: [
    ['62', '62', 'East', 0, 3, [0, 1, 2, 3, 4], shape([0, 1, 2, 3, 4]), [0, 2, 4, 6, 8], null, [[[0, 1, 3, 4], shape([0, 1, 3, 4]), [0, 2, 5, 7], 40]]],
    ['5', '5', 'West', 0, 3, [4, 3, 2], shape([4, 3, 2]), [0, 2, 4]],
  ],
};
const city = new CityData(raw, { version: 'x' });

test('a line is listed at every stop any of its routes serves', () => {
  assert.deepEqual(city.routesAtStop('C').map((r) => r.id), ['5', '62']);
  assert.deepEqual(city.routesAtStop('A').map((r) => r.id), ['62']);
});

test('patterns: usual route first, with its share of trips', () => {
  const r = city.routes.get('62');
  assert.equal(r.multi, true);
  assert.deepEqual(r.patterns.map((p) => p.share), [60, 40]);
  assert.equal(city.routes.get('5').multi, false);
  assert.deepEqual(city.routes.get('5').patterns.map((p) => p.share), [100]);
});

test('from a stop only one route serves, only that route is offered (REQ-LINE-1a)', () => {
  const r = city.routes.get('62');
  const atC = city.patternsAt(r, 'C');
  assert.equal(atC.length, 1);
  assert.deepEqual(atC[0].stops.map((s) => s.id), ['A', 'B', 'C', 'D', 'E']);
});

test('from a stop several routes serve, the most common comes first (REQ-LINE-1b)', () => {
  const r = city.routes.get('62');
  const atB = city.patternsAt(r, 'B');
  assert.deepEqual(atB.map((p) => p.share), [60, 40]);
  assert.equal(city.shapeOf(atB[1]).length, 4);
});

// Timetable: two trips on Sunday+Monday (mask 3), one on Saturday only (mask 64).
const schedule = {
  patterns: [{ stops: ['A', 'B', 'C', 'D', 'E'], offsets: [0, 2, 4, 6, 8] }, { stops: ['A', 'B', 'D', 'E'], offsets: [0, 2, 5, 7] }],
  trips: [[3, 480, 0], [3, 500, 1], [64, 600, 0], [3, 1435, 0]],
};

test('times at a stop: start time plus the minutes to that stop', () => {
  assert.deepEqual(timesAtStop(schedule, 'D', 0), [{ minute: 486, pattern: 0 }, { minute: 505, pattern: 1 }, { minute: 1441, pattern: 0 }]);
});

test('a stop the variant skips gets only the usual route\'s trips', () => {
  assert.deepEqual(timesAtStop(schedule, 'C', 1).map((t) => t.minute), [484, 1439]);
});

test('weekday filter', () => {
  assert.deepEqual(timesAtStop(schedule, 'A', 6).map((t) => t.minute), [600]);
  assert.deepEqual(timesAtStop(schedule, 'A', 3), []);
});

// A terminal: three stops share the number 500, told apart by platform (REQ-STOP-1, REQ-STOP-2).
const terminal = new CityData({
  cityId: 't', agencies: ['Dan'], sources: {},
  stops: [['p3', '500', 'Terminal', 32, 34.8, '3'], ['p1', '500', 'Terminal', 32, 34.8, '1'], ['p10', '500', 'Terminal', 32, 34.8, '10/6'], ['x', '777', 'Street', 32.01, 34.8]],
  routes: [['1', '1', 'A', 0, 3, [0, 3], shape([0, 3]), [0, 5]], ['2', '2', 'B', 0, 3, [1, 3], shape([1, 3]), [0, 5]]],
}, { version: 'x' });

test('stops sharing a number are grouped, in platform order', () => {
  const group = terminal.sameCodeStops(terminal.stops.get('p3'));
  assert.deepEqual(group.map((s) => s.platform), ['1', '3', '10']);
  assert.equal(terminal.stops.get('p10').floor, '6');
});

test('an ordinary stop is alone in its group and has no platform', () => {
  const x = terminal.stops.get('x');
  assert.deepEqual(terminal.sameCodeStops(x).map((s) => s.id), ['x']);
  assert.equal(x.platform, '');
});

test('each platform keeps only its own lines', () => {
  assert.deepEqual(terminal.routesAtStop('p3').map((r) => r.short), ['1']);
  assert.deepEqual(terminal.routesAtStop('p1').map((r) => r.short), ['2']);
});

// ---- Live buses are not tied to a stop pattern (REQ-RT-8) ----
import { classifyBuses } from '../src/realtime.js';
import { samePath } from '../src/lib/routeGeometry.js';
import { patternSummary, patternDifference } from '../src/lib/patterns.js';

// Usual path: straight north along lon 34.8. Detour path: leaves it 600 m to the east in the middle.
const usualStops = Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, name: `U${i}`, lat: 32 + i * 0.002, lon: 34.8 }));
const usualPath = usualStops.map((s) => [s.lat, s.lon]);
const detourPath = [[32, 34.8], [32.004, 34.8], [32.004, 34.8065], [32.012, 34.8065], [32.012, 34.8], [32.016, 34.8]];
const busOnDetour = { rideId: 'd', lat: 32.008, lon: 34.8065, recordedAt: new Date() }; // ~610 m off the usual path

test('a bus driving another stop pattern of the route is kept, not dropped (REQ-RT-8)', () => {
  const alone = classifyBuses([busOnDetour], usualStops, 'u8', usualPath);
  assert.equal(alone.next.length + alone.passed.length, 0, 'without the other path it looks off-route');
  const withOther = classifyBuses([busOnDetour], usualStops, 'u8', usualPath, [detourPath]);
  assert.deepEqual(withOther.next.map((b) => b.rideId), ['d']);
  assert.deepEqual([withOther.next[0].lat, withOther.next[0].lon], [32.008, 34.8065], 'its real position is untouched');
});

test('a bus on none of the route\'s paths is still left out', () => {
  const lost = { rideId: 'x', lat: 32.008, lon: 34.83, recordedAt: new Date() };
  const r = classifyBuses([lost], usualStops, 'u8', usualPath, [detourPath]);
  assert.equal(r.next.length + r.passed.length, 0);
});

// ---- Identical paths (REQ-LINE-1c) ----
test('two patterns along the same streets count as the same path, however their points are spaced', () => {
  const sparse = [[32, 34.8], [32.016, 34.8]];
  assert.equal(samePath(usualPath, sparse), true);
  assert.equal(samePath(sparse, usualPath), true);
});

test('a detour or a shorter trip is not the same path', () => {
  assert.equal(samePath(usualPath, detourPath), false);
  assert.equal(samePath(usualPath, usualPath.slice(0, 5)), false);
});

// ---- The summary in the hazard pop-up (REQ-LINE-1d) ----
const mk = (ids, share, path) => ({ stops: ids.map((id) => ({ id, name: `Stop ${id}` })), share, path });
const shapeOf = (p) => p.path;

test('summary: skipped stops on the same streets, and what it means at a skipped stop', () => {
  const route = { patterns: [mk(['A', 'B', 'C', 'D'], 60, usualPath), mk(['A', 'B', 'D'], 40, usualPath)] };
  const text = patternSummary(route, { id: 'C', name: 'Stop C' }, shapeOf);
  assert.equal(text[0], 'Most trips (60%) follow the usual pattern: 4 stops.');
  assert.equal(text[1], '40% of trips skip 1 stop (Stop C). They drive along the same streets.');
  assert.equal(text[2], 'At Stop C: only about 60% of trips stop here. The others pass without stopping or take another way.');
});

test('summary: a detour that adds stops, at a stop every trip serves', () => {
  const route = { patterns: [mk(['A', 'B', 'D'], 70, usualPath), mk(['A', 'X', 'Y', 'D'], 30, detourPath)] };
  const text = patternSummary(route, { id: 'A', name: 'Stop A' }, shapeOf);
  assert.equal(text[1], '30% of trips skip 1 stop (Stop B) and stop at 2 other stops (Stop X, Stop Y). They leave the usual path for part of the way.');
  assert.equal(text[2], 'At Stop A: every trip stops here.');
  assert.deepEqual(patternDifference(route.patterns[0], route.patterns[1], shapeOf).samePath, false);
});
