// REQ-RT-15: live traffic for the ghosts of a Favorite Commute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveStretches, blend, liveWeight, confidence, expectedError, expectedMeanError, isRushHour, WINDOW_MS } from '../src/lib/liveStretches.js';

const stops = [{ id: 'a', m: 0 }, { id: 'b', m: 400 }, { id: 'c', m: 1000 }, { id: 'd', m: 1500 }];
const T0 = Date.parse('2026-10-19T07:00:00Z');

test('a bus seen passing two stops gives that stretch a live time', () => {
  const s = new LiveStretches();
  s.observe('r1', T0, 300, stops); // before b
  s.observe('r1', T0 + 60000, 600, stops); // passed b at T0 + 20 s
  s.observe('r1', T0 + 120000, 1200, stops); // passed c at T0 + 60 + 40 = T0 + 100 s
  assert.deepEqual(s.samples('b', 'c', T0 + 120000), [80]);
  assert.deepEqual(s.samples('a', 'b', T0 + 120000), []); // a was not seen being passed
});

test('signals too far apart, or jumps, teach nothing', () => {
  const s = new LiveStretches();
  s.observe('r1', T0, 300, stops);
  s.observe('r1', T0 + 200000, 600, stops); // 200 s gap
  s.observe('r1', T0 + 260000, 1200, stops);
  assert.deepEqual(s.samples('b', 'c', T0 + 260000), []);
  const j = new LiveStretches();
  j.observe('r2', T0, 300, stops);
  j.observe('r2', T0 + 10000, 1400, stops); // 1100 m in 10 s
  assert.deepEqual(j.samples('b', 'c', T0 + 10000), []);
});

test('live times older than 20 minutes are forgotten', () => {
  const s = new LiveStretches();
  s.add('b', 'c', T0, 80);
  assert.equal(s.samples('b', 'c', T0 + WINDOW_MS - 1000).length, 1);
  assert.equal(s.samples('b', 'c', T0 + WINDOW_MS + 1000).length, 0);
  s.prune(T0 + WINDOW_MS + 1000);
  assert.equal(s.times.size, 0);
});

test('live times are blended with the history: the more buses, the more they count', () => {
  assert.equal(liveWeight(4), 0.5);
  assert.equal(blend(100, []), 100);
  assert.equal(blend(100, [200]), 120); // one bus counts a fifth
  assert.equal(blend(100, [200, 200, 200, 200]), 150);
  assert.equal(blend(null, [90]), null); // one bus alone is not enough
  assert.equal(blend(null, [90, 110]), 100);
});

test('the ring: green for a fresh signal and enough live times, red for an old one', () => {
  assert.equal(expectedError(60), 56);
  assert.equal(expectedError(150), 105);
  assert.equal(confidence(90, 0.5), 'good');
  assert.equal(confidence(90, 0.2), 'fair'); // fresh, but too few buses
  assert.equal(confidence(240, 0.8), 'fair');
  assert.equal(confidence(400, 0.8), 'poor');
});

test('live times kept on the phone come back, without the old ones', () => {
  const s = new LiveStretches();
  s.add('b', 'c', T0, 80);
  s.add('c', 'd', T0 - WINDOW_MS - 60000, 50); // too old
  const text = s.save(T0 + 1000);
  const back = new LiveStretches();
  back.load(text, T0 + 2000);
  assert.deepEqual(back.samples('b', 'c', T0 + 2000), [80]);
  assert.deepEqual(back.samples('c', 'd', T0 + 2000), []);
  back.load('not json', T0); // a damaged copy is ignored
});

test('the ± beside the timer grows with how far ahead the estimate reaches', () => {
  assert.equal(expectedMeanError(30, false, true), 31); // a fresh signal, the bus about to arrive
  assert.equal(expectedMeanError(300, false, true), 78);
  assert.equal(expectedMeanError(300, true, true), 73); // live traffic: a little smaller
  assert.equal(expectedMeanError(390, false, false), 74); // between 5 and 8 minutes, midday
  assert.ok(expectedMeanError(2400, false, true) > 332); // beyond the table: it keeps growing
});

test('rush hour is weekday mornings and afternoons, Israel time', () => {
  assert.equal(isRushHour(new Date('2026-10-25T06:00:00Z')), true); // Sunday 08:00 in Israel
  assert.equal(isRushHour(new Date('2026-10-25T10:00:00Z')), false); // Sunday 12:00
  assert.equal(isRushHour(new Date('2026-10-23T06:00:00Z')), false); // Friday
});
