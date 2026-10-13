// The live relay (relay/worker.js) and how the app reads its answers. Docs: docs/realtime.md#the-relay
// @req REQ-RT-11

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import worker, { sortByRoute, recordsOf } from '../relay/worker.js';
import { busFromRecord } from '../src/realtime.js';

// A small file in the exact layout the Open Bus project publishes.
const record = (line, vehicle, time, lat = 32.08) => ({
  RecordedAtTime: time,
  MonitoredVehicleJourney: {
    LineRef: line, FramedVehicleJourneyRef: { DataFrameRef: '2026-10-13', DatedVehicleJourneyRef: `7${vehicle}` },
    OperatorRef: '5', OriginAimedDepartureTime: '2026-10-13T18:20:00+03:00',
    VehicleLocation: { Longitude: '34.78', Latitude: String(lat) }, Bearing: '147', Velocity: '31', VehicleRef: vehicle,
    MonitoredCall: { StopPointRef: '25778', Order: '12', DistanceFromStop: '640' },
  },
});
const records = [
  record('23918', '111', '2026-10-13T18:56:10+03:00'),
  record('555', '222', '2026-10-13T18:56:20+03:00'),
  record('23918', '333', '2026-10-13T18:55:40+03:00', 32.09),
];
// Python's json.dumps spacing (", " and ": "), which the file uses.
const pythonJson = (v) => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/\},\{/g, '}, {');
const fileText = pythonJson({ Siri: { ServiceDelivery: { ResponseTimestamp: '2026-10-13T18:56:45+03:00', StopMonitoringDelivery: [{ '-version': '2.8', MonitoredStopVisit: records }] } } });

test('the relay finds each route\'s buses in the file, the last record included', () => {
  const snap = sortByRoute(fileText);
  assert.equal(snap.at, '2026-10-13T18:56:45+03:00');
  assert.deepEqual([...snap.index.keys()].sort(), ['23918', '555']);
  const mine = JSON.parse(recordsOf(snap, '23918'));
  assert.deepEqual(mine.map((r) => r.MonitoredVehicleJourney.VehicleRef), ['111', '333']);
  assert.deepEqual(JSON.parse(recordsOf(snap, '555')), [records[1]]);
  assert.equal(recordsOf(snap, '1'), '[]');
});

test('the relay answers the app, and only the app, with the routes asked for', async () => {
  const packed = zlib.brotliCompressSync(Buffer.from(fileText));
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  let asked = 0;
  globalThis.fetch = async () => { asked++; return asked === 1 ? new Response('not yet', { status: 404 }) : new Response(packed); };
  const store = new Map();
  globalThis.caches = { default: { match: async (k) => store.get(k)?.clone(), put: async (k, r) => { store.set(k, r); } } };
  const ask = (path, origin) => worker.fetch(new Request(`https://relay.example${path}`, { headers: origin ? { origin } : {} }), {}, { waitUntil: () => {} });
  try {
    const res = await ask('/live?routes=23918,1', 'https://eilonlevin3.github.io');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://eilonlevin3.github.io');
    const body = await res.json();
    assert.equal(body.routes['23918'].length, 2);
    assert.deepEqual(body.routes['1'], []);
    assert.equal(asked, 2, 'this minute had no file yet, the minute before did');

    const again = await ask('/live?routes=555', 'http://localhost:8080');
    assert.equal((await again.json()).routes['555'].length, 1);
    assert.equal(asked, 2, 'the file is kept: the file server is not asked again');

    assert.equal((await ask('/live?routes=555', 'https://someone-else.example')).headers.get('access-control-allow-origin'), null);
    assert.equal((await ask('/live?routes=abc')).status, 400);
    assert.equal((await ask('/live')).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
  }
});

test('the app reads a relay record as a bus, with the fields the bus pop-up shows', () => {
  const bus = busFromRecord(records[0], '2026/10/13/15/56');
  assert.equal(bus.lat, 32.08);
  assert.equal(bus.lon, 34.78);
  assert.equal(bus.vehicle, '111');
  assert.equal(bus.rideId, '7111|111');
  assert.equal(bus.recordedAt.toISOString(), '2026-10-13T15:56:10.000Z');
  assert.equal(bus.raw.velocity, 31);
  assert.equal(bus.raw.bearing, 147);
  assert.equal(bus.raw.siri_ride__journey_ref, '2026-10-13-7111');
  assert.equal(bus.raw.siri_ride__scheduled_start_time, '2026-10-13T18:20:00+03:00');
  assert.equal(bus.raw.siri_snapshot__snapshot_id, '2026/10/13/15/56');
  assert.equal(bus.raw.next_stop_code, '25778');
});

test('a record without a position is left out', () => {
  assert.equal(busFromRecord({ RecordedAtTime: '2026-10-13T18:56:10+03:00', MonitoredVehicleJourney: { LineRef: '1' } }, 'x'), null);
});
