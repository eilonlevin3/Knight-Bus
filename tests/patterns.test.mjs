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
