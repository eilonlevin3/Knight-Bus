// Unit tests for route geometry: the "5 minutes before your stop" zoom area and the line split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approachPath, splitPath, slicePath, stopPositions, metersBetween } from '../src/lib/routeGeometry.js';

// 11 stops in a straight line heading north, ~111 m apart, 1 scheduled minute apart.
const stops = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, lat: 32 + i * 0.001, lon: 34.8 }));
const path = stops.map((s) => [s.lat, s.lon]);
const route = { stops, times: stops.map((_, i) => i) };

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('approach path covers the scheduled 5 minutes before the stop (REQ-COMM-2)', () => {
  const p = approachPath(route, path, 8, 5);
  assert.ok(near(p[0][0], stops[3].lat), 'starts 5 minutes (5 stops) before');
  assert.ok(near(p.at(-1)[0], stops[8].lat), 'ends at the chosen stop');
});

test('approach path stops at the first stop when the line starts less than 5 minutes earlier', () => {
  const p = approachPath(route, path, 2, 5);
  assert.ok(near(p[0][0], stops[0].lat));
});

test('approach path goes part of the way back when 5 minutes end between stops', () => {
  const slow = { stops, times: [0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 15] }; // 6-minute gap s4→s5
  const p = approachPath(slow, path, 7, 5); // s7 at minute 12; s5 (minute 10) is 2 min earlier
  // 5 min before s7 = minute 7, inside the 6-minute gap s4 (4) → s5 (10): 3/6 of the way back from s5.
  const expected = stops[5].lat - (3 / 6) * (stops[5].lat - stops[4].lat);
  assert.ok(Math.abs(p[0][0] - expected) < 1e-7, `${p[0][0]} vs ${expected}`);
});

test('approach path without timetable uses ~1.5 km of road', () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, lat: 32 + i * 0.001, lon: 34.8 }));
  const p = approachPath({ stops: long, times: null }, long.map((s) => [s.lat, s.lon]), 29, 5);
  let meters = 0;
  for (let i = 1; i < p.length; i++) meters += metersBetween(p[i - 1], p[i]);
  assert.ok(meters >= 1400 && meters <= 1700, `${Math.round(meters)} m`);
});

test('split at a stop gives incoming + outbound that meet at the stop (REQ-COMM-4)', () => {
  const pos = stopPositions(stops, path);
  const [incoming, outbound] = splitPath(path, pos[4]);
  assert.deepEqual(incoming.at(-1), outbound[0]);
  assert.ok(near(incoming[0][0], stops[0].lat));
  assert.ok(near(outbound.at(-1)[0], stops[10].lat));
});

test('slicePath works between segment fractions', () => {
  const p = slicePath(path, 1.5, 3.25);
  assert.ok(near(p[0][0], 32.0015));
  assert.ok(Math.abs(p.at(-1)[0] - 32.00325) < 1e-9);
  assert.equal(p.length, 4); // start, vertices 2 and 3, end
});
