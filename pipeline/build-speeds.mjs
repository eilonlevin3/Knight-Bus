// How long buses really take between stops: a month of history, per half hour of the day.
// Docs: docs/data-pipeline.md#travel-times-a-month-of-history
// @req REQ-DATA-12
//
// Used only by the "ghost" (the estimated position of a bus, REQ-RT-12): instead of
// timetable speed, the ghost moves at the speed buses really had on that stretch, at that
// time of day, over the last 30 days.
//
// Two steps:
//   1. One summary per day, kept in SPEED_DAYS_DIR. A day is read from the Open Bus project's
//      per-minute files (the same files the live relay uses): for every bus, where it was
//      along its route each minute, and from that when it passed each stop. Days already
//      summarized are not read again; days older than the window are deleted.
//   2. The average of the days in the window, written as one small file per route to
//      data/speeds/<route id>.json. The app loads a file only when a ghost is turned on.
//
// Run: node pipeline/build-speeds.mjs      (after build-city-data.mjs: it needs the city files)
// Env: SPEED_DAYS_DIR      where the daily summaries are kept (default .cache/speed-days)
//      SPEED_WINDOW_DAYS   how many days back (default 30)
//      SPEED_MAX_NEW_DAYS  at most this many missing days are read in one run (default 6)
//      SPEED_ONLY_DAY      YYYY-MM-DD: summarize just this day (for trying it out)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CityData } from '../src/cityData.js';
import { stopPositions } from '../src/lib/routeGeometry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CITY_DIR = path.join(ROOT, 'data/cities');
const OUT_DIR = path.join(ROOT, 'data/speeds');
const DAYS_DIR = path.resolve(process.env.SPEED_DAYS_DIR || path.join(ROOT, '.cache/speed-days'));
const WINDOW_DAYS = Number(process.env.SPEED_WINDOW_DAYS || 30);
const MAX_NEW_DAYS = Number(process.env.SPEED_MAX_NEW_DAYS || 6);
const SOURCE = 'https://openbus-stride-public.s3.eu-west-1.amazonaws.com/stride-siri-requester';
const PARALLEL = 16; // files downloaded at a time

// A day has 48 half-hour windows; weekdays (Sunday to Thursday) and the weekend (Friday and
// Saturday) are kept apart. A cell is: day type * 48 + window.
export const WINDOWS = 48;
export const CELLS = WINDOWS * 2;
const MIN_SAMPLES = 3; // fewer trips than this in a cell: no number, the app falls back
const MAX_GAP_SECONDS = 150; // two signals further apart than this are not joined
const MAX_OFF_PATH_METERS = 120; // a bus further than this from the route's path is not on it
const MAX_SPEED = 33; // meters a second (120 km/h): faster is a wrong match, not a bus
const MIN_SECONDS = 3; // per stretch between two stops
const MAX_SECONDS = 1500;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dayName = (date) => date.toISOString().slice(0, 10);

// ---------- Which cell a moment belongs to ----------

// time: milliseconds; offsetMinutes: Israel's offset from UTC at that moment (the bus files
// carry it, so summer and winter time need no table). Returns 0..95.
export function cellOf(time, offsetMinutes) {
  const local = new Date(time + offsetMinutes * 60000);
  const day = local.getUTCDay(); // 5 = Friday, 6 = Saturday
  const window = local.getUTCHours() * 2 + (local.getUTCMinutes() >= 30 ? 1 : 0);
  return (day === 5 || day === 6 ? WINDOWS : 0) + window;
}

// ---------- Geometry: where a bus is along its route, in meters ----------

function prepare(city, pattern) {
  const shape = city.shapeOf(pattern);
  const cum = new Float64Array(shape.length); // meters from the start to each corner
  for (let i = 1; i < shape.length; i++) {
    const k = Math.cos(shape[i][0] * (Math.PI / 180));
    cum[i] = cum[i - 1] + Math.hypot((shape[i][1] - shape[i - 1][1]) * k, shape[i][0] - shape[i - 1][0]) * 111320;
  }
  const metersAt = (pos) => {
    const i = Math.min(shape.length - 1, Math.floor(pos));
    return i >= shape.length - 1 ? cum[shape.length - 1] : cum[i] + (cum[i + 1] - cum[i]) * (pos - i);
  };
  return { shape, cum, stops: pattern.stops, stopMeters: stopPositions(pattern.stops, shape).map(metersAt), metersAt };
}

// Nearest point of the path to a position, looking only at corners from..to.
// Returns [meters along the path, meters off the path].
function project(prep, lat, lon, from, to) {
  const { shape, cum } = prep;
  const k = Math.cos(lat * (Math.PI / 180));
  const px = lon * k;
  let bestOff = Infinity;
  let bestAlong = 0;
  for (let i = Math.max(0, from); i < Math.min(shape.length - 1, to); i++) {
    const ax = shape[i][1] * k;
    const ay = shape[i][0];
    const dx = shape[i + 1][1] * k - ax;
    const dy = shape[i + 1][0] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx - px, ay + t * dy - lat) * 111320;
    if (off < bestOff) { bestOff = off; bestAlong = cum[i] + (cum[i + 1] - cum[i]) * t; }
  }
  return [bestAlong, bestOff];
}

// ---------- Step 1: one day ----------

// Reads the day's signals in time order and turns them into times between stops.
// Exported for the tests: feed it records, read the result.
export class DayCounter {
  constructor(routeOfLineRef) {
    this.routeOfLineRef = routeOfLineRef; // (line ref) -> { city, route } or undefined
    this.prepared = new Map(); // pattern -> prepare()
    this.rides = new Map(); // ride key -> { prep, along, time, corner, cross: { stop, time } }
    this.totals = new Map(); // line ref -> Map("from stop id>to stop id" -> Float64Array(CELLS * 2): count, seconds)
    this.used = 0;
  }

  prep(city, pattern) {
    if (!this.prepared.has(pattern)) this.prepared.set(pattern, prepare(city, pattern));
    return this.prepared.get(pattern);
  }

  add(record) {
    const j = record.MonitoredVehicleJourney;
    const found = j && this.routeOfLineRef(j.LineRef);
    if (!found) return;
    const lat = Number(j.VehicleLocation?.Latitude);
    const lon = Number(j.VehicleLocation?.Longitude);
    const time = Date.parse(record.RecordedAtTime);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(time)) return;
    const key = `${j.LineRef}|${j.FramedVehicleJourneyRef?.DatedVehicleJourneyRef}|${j.VehicleRef}`;
    let ride = this.rides.get(key);
    if (ride && time <= ride.time) return; // the same signal again, or an older one

    // Where is it along the route? A ride we know is looked for near where it was; a new
    // ride is tried on each stop pattern of its route and put on the one it fits best.
    let along;
    let off;
    if (ride) {
      const corner = ride.corner;
      [along, off] = project(ride.prep, lat, lon, corner - 2, corner + 80);
    }
    if (!ride || off > MAX_OFF_PATH_METERS) {
      let best = null;
      for (const pattern of found.route.patterns) {
        const prep = this.prep(found.city, pattern);
        const [a, o] = project(prep, lat, lon, 0, Infinity);
        if (o <= MAX_OFF_PATH_METERS && (!best || o < best.off - 15)) best = { prep, along: a, off: o };
      }
      if (!best) { this.rides.delete(key); return; }
      ride = { prep: best.prep, along: best.along, time, corner: 0, cross: null };
      this.rides.set(key, ride);
      this.setCorner(ride);
      return;
    }

    const seconds = (time - ride.time) / 1000;
    const moved = along - ride.along;
    if (seconds > MAX_GAP_SECONDS || moved < -30 || moved > seconds * MAX_SPEED) {
      // Lost for too long, or a jump that is not driving: start again from here.
      ride.cross = null;
    } else if (moved > 0) {
      // Every stop between the two signals was passed at a time found by sharing the
      // time between them evenly over the distance.
      const { stopMeters, stops } = ride.prep;
      const offsetMinutes = offsetOf(record.RecordedAtTime);
      for (let i = 0; i < stopMeters.length; i++) {
        if (stopMeters[i] <= ride.along || stopMeters[i] > along) continue;
        const passed = ride.time + (time - ride.time) * ((stopMeters[i] - ride.along) / moved);
        if (ride.cross && ride.cross.stop === i - 1) {
          const took = (passed - ride.cross.time) / 1000;
          if (took >= MIN_SECONDS && took <= MAX_SECONDS) this.count(j.LineRef, stops[i - 1].id, stops[i].id, cellOf(ride.cross.time, offsetMinutes), took);
        }
        ride.cross = { stop: i, time: passed };
      }
    }
    ride.along = Math.max(ride.along, along);
    ride.time = time;
    this.setCorner(ride);
  }

  // The corner of the path just before the bus: where the next search starts.
  setCorner(ride) {
    const { cum } = ride.prep;
    let i = ride.corner;
    while (i < cum.length - 2 && cum[i + 1] <= ride.along) i++;
    ride.corner = i;
  }

  count(lineRef, from, to, cell, seconds) {
    if (!this.totals.has(lineRef)) this.totals.set(lineRef, new Map());
    const segments = this.totals.get(lineRef);
    const k = `${from}>${to}`;
    if (!segments.has(k)) segments.set(k, new Float64Array(CELLS * 2));
    const cells = segments.get(k);
    cells[cell * 2] += 1;
    cells[cell * 2 + 1] += seconds;
    this.used++;
  }

  // Rides not heard from for a while are forgotten, so a day does not fill the memory.
  forget(before) {
    for (const [key, ride] of this.rides) if (ride.time < before) this.rides.delete(key);
  }

  // { "<line ref>": { "<from>><to>": [cell, count, seconds, cell, count, seconds, ...] } }
  summary() {
    const out = {};
    for (const [lineRef, segments] of this.totals) {
      out[lineRef] = {};
      for (const [k, cells] of segments) {
        const list = [];
        for (let c = 0; c < CELLS; c++) if (cells[c * 2]) list.push(c, cells[c * 2], Math.round(cells[c * 2 + 1]));
        out[lineRef][k] = list;
      }
    }
    return out;
  }
}

// "+03:00" at the end of a time -> 180
function offsetOf(isoTime) {
  const m = /([+-])(\d\d):(\d\d)$/.exec(isoTime);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.status === 404 || res.status === 403) return null; // no file for that minute
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) { log(`  gave up on ${url}: ${e.message}`); return null; }
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

async function summarizeDay(day, routeOfLineRef) {
  const counter = new DayCounter(routeOfLineRef);
  const minutes = [];
  for (let m = 0; m < 1440; m++) minutes.push(`${day.replaceAll('-', '/')}/${String(Math.floor(m / 60)).padStart(2, '0')}/${String(m % 60).padStart(2, '0')}`);
  let files = 0;
  let signals = 0;
  for (let i = 0; i < minutes.length; i += PARALLEL) {
    const packed = await Promise.all(minutes.slice(i, i + PARALLEL).map((id) => download(`${SOURCE}/${id}.br`)));
    for (const buffer of packed) {
      if (!buffer) continue;
      let records;
      try {
        records = JSON.parse(zlib.brotliDecompressSync(buffer)).Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit || [];
      } catch {
        continue; // a damaged file
      }
      files++;
      signals += records.length;
      // Within a file the signals are in no order; a ride has one signal per file.
      for (const r of records) counter.add(r);
    }
    if (i % (PARALLEL * 15) === 0) {
      counter.forget(Date.parse(`${day}T00:00:00Z`) + (i - 20) * 60000);
      log(`  ${day} ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} UTC, ${files} files, ${counter.used} times between stops so far`);
    }
  }
  return { v: 1, day, files, signals, times: counter.used, routes: counter.summary() };
}

// ---------- Step 2: the average of the window ----------

// days: the daily summaries. routes: [{ id, liveIds }]. Returns Map(route id -> file content).
export function averageDays(days, routes) {
  const byLineRef = new Map(); // line ref -> Map(segment -> Float64Array(CELLS * 2))
  for (const day of days) {
    for (const [lineRef, segments] of Object.entries(day.routes)) {
      if (!byLineRef.has(lineRef)) byLineRef.set(lineRef, new Map());
      const mine = byLineRef.get(lineRef);
      for (const [k, list] of Object.entries(segments)) {
        if (!mine.has(k)) mine.set(k, new Float64Array(CELLS * 2));
        const cells = mine.get(k);
        for (let i = 0; i < list.length; i += 3) { cells[list[i] * 2] += list[i + 1]; cells[list[i] * 2 + 1] += list[i + 2]; }
      }
    }
  }
  const out = new Map();
  for (const route of routes) {
    // A route's buses report under its own id and those of the alternatives merged into it.
    const segments = new Map();
    for (const id of route.liveIds) {
      for (const [k, cells] of byLineRef.get(String(id)) || []) {
        if (!segments.has(k)) segments.set(k, new Float64Array(CELLS * 2));
        const sum = segments.get(k);
        for (let i = 0; i < cells.length; i++) sum[i] += cells[i];
      }
    }
    const file = {};
    for (const [k, cells] of segments) {
      // 48 half hours of a weekday, 48 of the weekend, then the whole-day average of each:
      // seconds, or null where too few trips were seen.
      const row = [];
      for (let c = 0; c < CELLS; c++) row.push(cells[c * 2] >= MIN_SAMPLES ? Math.round(cells[c * 2 + 1] / cells[c * 2]) : null);
      for (const type of [0, 1]) {
        let n = 0;
        let seconds = 0;
        for (let c = type * WINDOWS; c < (type + 1) * WINDOWS; c++) { n += cells[c * 2]; seconds += cells[c * 2 + 1]; }
        row.push(n >= MIN_SAMPLES ? Math.round(seconds / n) : null);
      }
      if (row.some((x) => x !== null)) file[k] = row;
    }
    if (Object.keys(file).length) out.set(route.id, file);
  }
  return out;
}

// ---------- Main ----------

async function main() {
  if (!fs.existsSync(path.join(CITY_DIR, 'index.json'))) throw new Error('Run build-city-data.mjs first: data/cities is missing.');
  const index = JSON.parse(fs.readFileSync(path.join(CITY_DIR, 'index.json'), 'utf8'));
  const lineRefs = new Map(); // line ref -> { city, route }
  const routes = new Map(); // route id -> route (a route can be in several city files)
  for (const meta of index.cities) {
    const city = new CityData(JSON.parse(fs.readFileSync(path.join(CITY_DIR, meta.file), 'utf8')), meta);
    for (const route of city.routes.values()) {
      if (!route.live || routes.has(route.id)) continue;
      routes.set(route.id, route);
      for (const id of route.liveIds) lineRefs.set(String(id), { city, route });
    }
  }
  log(`${routes.size} routes with live buses, under ${lineRefs.size} ids`);

  fs.mkdirSync(DAYS_DIR, { recursive: true });
  const dayFile = (day) => path.join(DAYS_DIR, `${day}.json.gz`);
  // The window: the last WINDOW_DAYS whole days (UTC), newest first. Today is not over yet.
  const wanted = [];
  for (let back = 1; back <= WINDOW_DAYS; back++) wanted.push(dayName(new Date(Date.now() - back * 86400e3)));
  const only = process.env.SPEED_ONLY_DAY;
  const missing = (only ? [only] : wanted).filter((day) => !fs.existsSync(dayFile(day)));
  for (const day of missing.slice(0, MAX_NEW_DAYS)) {
    log(`Reading ${day}`);
    const summary = await summarizeDay(day, (ref) => lineRefs.get(String(ref)));
    if (!summary.files) { log(`  no files for ${day}: left for another run`); continue; }
    fs.writeFileSync(dayFile(day), zlib.gzipSync(JSON.stringify(summary)));
    log(`  ${day}: ${summary.files} files, ${summary.signals} signals, ${summary.times} times between stops, ${(fs.statSync(dayFile(day)).size / 1e6).toFixed(1)} MB`);
  }
  if (missing.length > MAX_NEW_DAYS) log(`${missing.length - MAX_NEW_DAYS} more days are missing; they will be read in the next runs`);
  // Days that left the window are deleted.
  for (const name of fs.readdirSync(DAYS_DIR)) {
    const day = name.replace('.json.gz', '');
    if (/^\d{4}-\d\d-\d\d$/.test(day) && !wanted.includes(day) && day !== only) fs.rmSync(path.join(DAYS_DIR, name));
  }

  const have = (only ? [only] : wanted).filter((day) => fs.existsSync(dayFile(day)));
  const days = have.map((day) => JSON.parse(zlib.gunzipSync(fs.readFileSync(dayFile(day)))));
  const files = averageDays(days, [...routes.values()]);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  for (const [id, segments] of files) {
    const json = JSON.stringify({ v: 1, days: have.length, from: have.at(-1), to: have[0], segments });
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), json);
    bytes += json.length;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), days: have, windowDays: WINDOW_DAYS, routes: files.size }));
  log(`Wrote travel times of ${files.size} routes from ${have.length} days to ${OUT_DIR} (${(bytes / 1e6).toFixed(1)} MB in total)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
