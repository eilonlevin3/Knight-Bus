// Unit tests for logic that has no browser dependency. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode } from '../src/lib/polyline.js';
import { classifyBuses } from '../src/realtime.js';
import { cityForPosition } from '../src/location.js';

test('polyline round-trips at ~1 m precision', () => {
  const pts = [[32.08531, 34.78177], [32.0861, 34.7799], [31.7784, 35.2066]];
  const back = decode(encode(pts));
  back.forEach(([lat, lon], i) => {
    assert.ok(Math.abs(lat - pts[i][0]) < 1e-5);
    assert.ok(Math.abs(lon - pts[i][1]) < 1e-5);
  });
});

// A straight line of 10 stops, ~111 m apart, heading north.
const stops = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, lat: 32 + i * 0.001, lon: 34.8 }));
const busAt = (rideId, stopIdx) => ({ rideId, lat: stops[stopIdx].lat, lon: 34.8, recordedAt: new Date() });

test('next two approaching + one most recently passed (REQ-RT-1)', () => {
  const buses = [busAt('a', 0), busAt('b', 3), busAt('c', 5), busAt('d', 7), busAt('e', 9)];
  const { next, passed } = classifyBuses(buses, stops, 's6');
  assert.deepEqual(next.map((b) => b.rideId), ['c', 'b']); // 1 and 3 stops away
  assert.deepEqual(passed.map((b) => b.rideId), ['d']); // passed 1 stop ago
});

test('bus at the stop counts as next, 0 stops away', () => {
  const { next } = classifyBuses([busAt('a', 4)], stops, 's4');
  assert.equal(next[0].stopsAway, 0);
});

test('buses far from the route are ignored', () => {
  const far = { rideId: 'x', lat: 32.005, lon: 34.9, recordedAt: new Date() };
  const { next, passed } = classifyBuses([far], stops, 's5');
  assert.equal(next.length + passed.length, 0);
});

test('missing buses give empty lists, not errors', () => {
  assert.deepEqual(classifyBuses([], stops, 's2'), { next: [], passed: [] });
  assert.deepEqual(classifyBuses([busAt('a', 1)], stops, 'not-on-route'), { next: [], passed: [] });
});

test('city lookup picks the smallest containing box (REQ-LOC-2)', () => {
  const cities = [
    { id: 'big', bbox: [34, 31, 36, 33] },
    { id: 'small', bbox: [34.7, 32.0, 34.9, 32.2] },
  ];
  assert.equal(cityForPosition(cities, { lat: 32.1, lon: 34.8 }).id, 'small');
  assert.equal(cityForPosition(cities, { lat: 31.5, lon: 35.5 }).id, 'big');
  assert.equal(cityForPosition(cities, { lat: 29.5, lon: 34.9 }), null);
});
