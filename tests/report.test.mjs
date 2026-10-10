// Unit tests for the commute report (REQ-ANL-2): counts only, and stops need 3+ people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/lib/report.js';

const stop = (id, lines) => ({ stopId: id, stopName: `Stop ${id}`, stopCode: `c${id}`, routeIds: lines });
const docs = [
  { uid: 'a', slot: 1, fav: { cityId: 'tel-aviv', stops: [stop('s1', ['5', '8'])], origin: { lat: 1, lon: 1 }, destination: null, updatedAt: '2026-10-10T07:00:00Z' } },
  { uid: 'a', slot: 2, fav: { cityId: 'tel-aviv', stops: [stop('s1', ['5']), stop('s2', ['5'])], origin: { lat: 1, lon: 1 }, destination: { lat: 2, lon: 2 }, updatedAt: '2026-10-11T07:00:00Z' } },
  { uid: 'b', slot: 1, fav: { cityId: 'tel-aviv', stops: [stop('s1', ['5'])], updatedAt: '2026-11-01T07:00:00Z' } },
  { uid: 'c', slot: 1, fav: { cityId: 'haifa', stops: [stop('s1', ['12']), stop('s9', ['12'])], updatedAt: '2026-11-02T07:00:00Z' } },
  { uid: 'd', slot: 1, fav: { cityId: 'tel-aviv', stops: [stop('s1', ['8'])] } },
  { uid: 'e', slot: 1, fav: null }, // cleared slot: ignored
];

test('counts people, commutes, cities and shapes', () => {
  const r = summarize(docs);
  assert.equal(r.people, 4);
  assert.equal(r.commutes, 5);
  assert.deepEqual(r.commutesPerPerson, { 1: 3, 2: 1, 3: 0 });
  assert.deepEqual(r.byCity, [{ cityId: 'tel-aviv', count: 4 }, { cityId: 'haifa', count: 1 }]);
  assert.deepEqual(r.stopsPerCommute, { 1: 3, 2: 2 });
  assert.deepEqual([r.withStart, r.withDestination, r.withBoth], [2, 1, 1]);
  assert.deepEqual(r.byMonth, [{ month: '2026-10', count: 2 }, { month: '2026-11', count: 2 }]);
});

test('lines are ranked by how many different people use them', () => {
  const r = summarize(docs);
  assert.deepEqual(r.topLines[0], { cityId: 'tel-aviv', routeId: '5', commutes: 3, people: 2 });
  // A line chosen at both stops of one commute counts once for that commute.
  assert.equal(r.topLines.find((l) => l.cityId === 'haifa').commutes, 1);
});

test('a stop appears only when 3 or more people saved it', () => {
  const r = summarize(docs);
  assert.deepEqual(r.topStops.map((s) => `${s.cityId}|${s.stopId}|${s.people}`), ['tel-aviv|s1|3']);
  assert.equal(r.stopsHidden, 3); // tel-aviv s2, haifa s1, haifa s9
});

test('nothing in the report identifies a person', () => {
  const text = JSON.stringify(summarize(docs));
  for (const uid of ['"a"', '"b"', '"c"', '"d"', 'uid']) assert.ok(!text.includes(uid), uid);
  assert.ok(!text.includes('"lat"'));
});

test('an empty database gives zeros, not errors', () => {
  const r = summarize([]);
  assert.deepEqual([r.people, r.commutes, r.averageLines, r.topLines.length], [0, 0, 0, 0]);
});
