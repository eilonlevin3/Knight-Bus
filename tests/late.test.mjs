// When the live feed runs late. Docs: docs/realtime.md
// @req REQ-RT-9

import test from 'node:test';
import assert from 'node:assert/strict';
import { dropFinishedRides, isLate } from '../src/realtime.js';

const bus = (rideId, minutesAgo) => ({ rideId, recordedAt: new Date(Date.now() - minutesAgo * 60000) });

test('a late feed still gives its newest buses; finished rides are dropped', () => {
  // The feed is 17 minutes behind: two buses are running, one finished 12 minutes earlier.
  const kept = dropFinishedRides([bus('a', 17), bus('b', 19), bus('c', 29)]);
  assert.deepEqual(kept.map((b) => b.rideId), ['a', 'b']);
});

test('no buses in, no buses out', () => {
  assert.deepEqual(dropFinishedRides([]), []);
});

test('a position older than 5 minutes is called late', () => {
  assert.equal(isLate(bus('a', 2).recordedAt), false);
  assert.equal(isLate(bus('a', 17).recordedAt), true);
});
