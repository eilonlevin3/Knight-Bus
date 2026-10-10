// Builds one transit bundle per city from the national GTFS feed.
// @req REQ-STOP-1 @req REQ-DATA-2 @req REQ-SCOPE-1 @req REQ-DATA-5 @req REQ-DATA-6 @req REQ-DATA-7 @req REQ-DATA-8 @req REQ-DATA-9
// Docs: docs/data-pipeline.md (how it works), docs/data-model.md (output format).
//
// Usage:  npm run build:data
// Env:    GTFS_ZIP=path/to/local.zip   use a zip you already downloaded
//         GTFS_URL=https://...          override the download URL
//         CITIES=tel-aviv,haifa         build only some cities

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { parse } from 'csv-parse';
import { encode } from '../src/lib/polyline.js';
import { loadBusofash, placeOnPath } from './sources/busofash.mjs';
import { loadNoatKml } from './sources/noat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/cities.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'data/cities');
const SCHEDULE_DIR = path.join(ROOT, 'data/schedules');
const CACHE_ZIP = path.join(ROOT, '.cache/gtfs.zip');
const SHAPE_TOLERANCE_DEG = 0.00004; // ~4 m. Larger = smaller files, rougher lines.

const onlyCities = process.env.CITIES ? process.env.CITIES.split(',') : null;
const cities = config.cities.filter((c) => !onlyCities || onlyCities.includes(c.id));
const routeTypes = new Set(config.routeTypes.map(String));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- 1. Get the GTFS zip ----------

async function getZip() {
  if (process.env.GTFS_ZIP) return { file: process.env.GTFS_ZIP, lastModified: null };
  const url = process.env.GTFS_URL || config.gtfsUrl;
  fs.mkdirSync(path.dirname(CACHE_ZIP), { recursive: true });
  const fresh = fs.existsSync(CACHE_ZIP) && Date.now() - fs.statSync(CACHE_ZIP).mtimeMs < 20 * 3600e3;
  if (fresh) {
    log('Using cached', CACHE_ZIP);
    return { file: CACHE_ZIP, lastModified: null };
  }
  log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GTFS download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(CACHE_ZIP));
  log('Downloaded', (fs.statSync(CACHE_ZIP).size / 1e6).toFixed(0), 'MB');
  return { file: CACHE_ZIP, lastModified: res.headers.get('last-modified') };
}

// ---------- 2. Stream CSV files out of the zip ----------

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      const entries = new Map();
      zip.on('entry', (e) => {
        entries.set(e.fileName, e);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Calls onRow(get) for every row; get('column_name') returns the value.
async function readCsv({ zip, entries }, name, onRow) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`${name} missing from GTFS zip`);
  const stream = await new Promise((res, rej) =>
    zip.openReadStream(entry, (err, s) => (err ? rej(err) : res(s))),
  );
  const parser = stream.pipe(parse({ bom: true, relax_quotes: true, relax_column_count: true }));
  let header = null;
  let count = 0;
  for await (const row of parser) {
    if (!header) {
      header = new Map(row.map((h, i) => [h.trim(), i]));
      continue;
    }
    onRow((col) => row[header.get(col)] ?? '');
    count++;
  }
  log(`  ${name}: ${count.toLocaleString()} rows`);
}

// ---------- 3. Geometry helpers ----------

// Ramer–Douglas–Peucker line simplification (iterative).
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segDist2([py, px], [ay, ax], [by, bx]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

const inBbox = ([minLon, minLat, maxLon, maxLat], lat, lon) =>
  lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;

// GTFS times are "HH:MM:SS" and may pass 24:00 for trips after midnight.
function toSeconds(hms) {
  const [h, m, sec] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + (sec || 0);
}

// Israeli route_long_name looks like "Origin-City<->Destination-City-1#".
function destinationFromLongName(longName) {
  const to = longName.split('<->')[1] || longName;
  return to.replace(/-\d+#?$/, '').replace(/#$/, '').replace(/-/g, ', ').trim();
}

// ---------- 4. Build ----------

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MAX_PATTERNS = 4; // per line: the usual route plus up to 3 variants
const ymd = (d) => Number(d.toISOString().slice(0, 10).replaceAll('-', ''));

async function main() {
  const { file, lastModified } = await getZip();
  const z = await openZip(file);

  log('Reading agencies and routes');
  const agencies = new Map();
  await readCsv(z, 'agency.txt', (g) => agencies.set(g('agency_id'), g('agency_name')));

  const routes = new Map(); // route_id -> route info
  await readCsv(z, 'routes.txt', (g) => {
    if (!routeTypes.has(g('route_type'))) return;
    routes.set(g('route_id'), {
      id: g('route_id'),
      short: g('route_short_name'),
      longName: g('route_long_name'),
      agency: g('agency_id'),
      type: Number(g('route_type')),
      patternsByKey: new Map(), // "stop,stop,..." -> pattern
      patterns: [], // filled below: most common first
      trips: [], // [dayMask, startMinute, pattern] for the schedule files
      source: null,
    });
  });

  // Which services run in the coming week (the feed also lists future timetables).
  const weekStart = ymd(new Date());
  const weekEnd = ymd(new Date(Date.now() + 6 * 86400e3));
  const services = new Map(); // service_id -> { mask, active }
  await readCsv(z, 'calendar.txt', (g) => {
    let mask = 0;
    DAYS.forEach((d, i) => { if (g(d) === '1') mask |= 1 << i; });
    services.set(g('service_id'), { mask, active: Number(g('start_date')) <= weekEnd && Number(g('end_date')) >= weekStart });
  });

  // Every bus line in the feed is kept, whatever days it runs (weekdays, Friday, Saturday,
  // Saturday night): there is deliberately no filter by day here (REQ-DATA-5).
  log('Reading trips');
  const trips = new Map(); // trip_id -> { route, service, shapeId, headsign }
  await readCsv(z, 'trips.txt', (g) => {
    const route = routes.get(g('route_id'));
    if (route) trips.set(g('trip_id'), { route, service: g('service_id'), shapeId: g('shape_id') || null, headsign: g('trip_headsign') });
  });

  // A line's trips do NOT all serve the same stops: about 2% of lines have two or more
  // "stop patterns" (a detour, a skipped street, a longer evening route). Keep every
  // pattern, counted, so a line is listed at every stop it really serves (REQ-DATA-8).
  // The file keeps each trip's rows together, so trips are handled one at a time.
  log('Reading stop patterns of every trip (stop_times.txt is large, this takes a few minutes)');
  let currentTrip = null;
  let rows = [];
  const finishTrip = () => {
    const t = currentTrip && trips.get(currentTrip);
    if (t && rows.length > 1) {
      rows.sort((a, b) => a[0] - b[0]);
      const stopIds = rows.map((r) => r[1]);
      const key = stopIds.join(',');
      const t0 = rows[0][2];
      let p = t.route.patternsByKey.get(key);
      if (!p) {
        // Scheduled minutes from the first stop, used for "5 minutes before your stop" (REQ-DATA-6).
        const times = rows.map((r) => (Number.isFinite(r[2]) && Number.isFinite(t0) ? Math.round((r[2] - t0) / 60) : null));
        p = { stops: stopIds, times, shapeId: t.shapeId, headsign: t.headsign, count: 0, weekCount: 0 };
        t.route.patternsByKey.set(key, p);
      }
      p.count++;
      const svc = services.get(t.service);
      if (svc?.active && Number.isFinite(t0)) {
        p.weekCount++;
        t.route.trips.push([svc.mask, Math.round(t0 / 60), p]);
      }
    }
    rows = [];
  };
  await readCsv(z, 'stop_times.txt', (g) => {
    const id = g('trip_id');
    if (id !== currentTrip) { finishTrip(); currentTrip = id; }
    if (trips.has(id)) rows.push([Number(g('stop_sequence')), g('stop_id'), toSeconds(g('arrival_time'))]);
  });
  finishTrip();
  trips.clear();

  let multi = 0;
  for (const r of routes.values()) {
    const useWeek = [...r.patternsByKey.values()].some((p) => p.weekCount);
    r.patterns = [...r.patternsByKey.values()]
      .map((p) => ({ ...p, weight: useWeek ? p.weekCount : p.count, ref: p }))
      .filter((p) => p.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_PATTERNS);
    r.patternsByKey = null;
    if (r.patterns.length > 1) multi++;
  }
  for (const [id, r] of routes) if (!r.patterns.length) routes.delete(id);
  log(`  ${routes.size} bus lines, ${multi} with more than one stop pattern`);

  log('Reading stops');
  const stops = new Map();
  await readCsv(z, 'stops.txt', (g) => {
    // stop_desc looks like "רחוב: ... עיר: ... רציף: 12 קומה: 6" (street, city, platform, floor).
    // Platform and floor tell apart the stops of a terminal that share one stop code (REQ-STOP-1).
    const desc = g('stop_desc');
    const platform = ((desc.match(/רציף:\s*([^\s]+)/) || [])[1] || '').replace(/^.*:$/, ''); // empty platform: the next label is not a value
    const floor = (desc.match(/קומה:\s*([^\s]+)/) || [])[1] || '';
    stops.set(g('stop_id'), {
      id: g('stop_id'),
      code: g('stop_code'),
      name: g('stop_name'),
      lat: Number(g('stop_lat')),
      lon: Number(g('stop_lon')),
      station: g('location_type') === '1', // a whole terminal, not a place where buses stop
      platform: platform === '0' ? '' : platform,
      floor: floor === '0' ? '' : floor,
    });
  });
  // How many real stops use each stop code (terminals: one code, many platforms).
  const stopsPerCode = new Map();
  for (const s of stops.values()) if (s.code && !s.station) stopsPerCode.set(s.code, (stopsPerCode.get(s.code) || 0) + 1);

  log('Reading shapes');
  const neededShapes = new Map();
  for (const r of routes.values()) for (const p of r.patterns) if (p.shapeId) neededShapes.set(p.shapeId, []);
  await readCsv(z, 'shapes.txt', (g) => {
    const pts = neededShapes.get(g('shape_id'));
    if (pts) pts.push([Number(g('shape_pt_sequence')), Number(g('shape_pt_lat')), Number(g('shape_pt_lon'))]);
  });
  const encodedShapes = new Map();
  for (const [id, pts] of neededShapes) {
    pts.sort((a, b) => a[0] - b[0]);
    encodedShapes.set(id, encode(simplify(pts.map((p) => [p[1], p[2]]), SHAPE_TOLERANCE_DEG)));
  }
  z.zip.close();

  // Lines that are not in the government feed (REQ-DATA-7), e.g. municipal weekend buses.
  // They reuse the national stops (by stop code, or by position when the source has no
  // codes) so they show up at the same stops. If a source is down, the build carries on.
  const sourceInfo = {};
  const stopIdByCode = new Map();
  const grid = new Map(); // ~200 m cells -> national stops, for matching by position
  const cell = (lat, lon) => `${Math.floor(lat * 500)},${Math.floor(lon * 500)}`;
  for (const s of stops.values()) {
    if (s.station) continue; // match to places where buses actually stop
    if (s.code && !stopIdByCode.has(s.code)) stopIdByCode.set(s.code, s.id);
    const k = cell(s.lat, s.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  // "דיזנגוף/שד' נורדאו" and "שדרות נורדאו/דיזנגוף" are the same stop: compare the street names
  // on both sides of the slash, in any order, with common spellings evened out.
  const nameKey = (name) => String(name).replace(/["'׳״.]/g, '').replace(/שדרות|שד(?=\s)/g, 'שד').replace(/דרך זאב/g, 'דרך')
    .replace(/דיזינגוף/g, 'דיזנגוף').split('/').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join('/');
  // A stop without a code: the national stop within 25 m, or one with the same name within 100 m.
  const nearestStop = (lat, lon, name) => {
    let close = null;
    let closeD = 25;
    let named = null;
    let namedD = 100;
    const key = nameKey(name);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const s of grid.get(`${Math.floor(lat * 500) + dy},${Math.floor(lon * 500) + dx}`) || []) {
        const d = Math.hypot((s.lon - lon) * Math.cos(lat * Math.PI / 180), s.lat - lat) * 111320;
        if (d < closeD) { closeD = d; close = s; }
        if (d < namedD && nameKey(s.name) === key) { namedD = d; named = s; }
      }
    }
    return close || named;
  };
  // A stop the source places where no national stop is: use the nearest real bus stop that
  // lies on the line's own path, on the side buses stop on. This is how other apps (Moovit)
  // show these lines, and the owner's rule is to follow them when sources disagree.
  const snapToPath = (lat, lon, linePath, maxMeters) => {
    let best = null;
    let bestD = maxMeters;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const s of grid.get(`${Math.floor(lat * 500) + dy},${Math.floor(lon * 500) + dx}`) || []) {
        const d = Math.hypot((s.lon - lon) * Math.cos(lat * Math.PI / 180), s.lat - lat) * 111320;
        if (d >= bestD) continue;
        const fit = placeOnPath(s.lat, s.lon, linePath);
        if (fit.meters <= 20 && (fit.side === 'right' || fit.meters <= 6)) { bestD = d; best = s; }
      }
    }
    return best;
  };
  const loaders = { 'busofash-arcgis': loadBusofash, 'noat-kml': loadNoatKml };
  for (const src of config.extraSources || []) {
    try {
      log(`Reading extra lines: ${src.name}`);
      const extra = await loaders[src.type](src, log);
      agencies.set(`src:${src.id}`, src.name);
      let matched = 0;
      let added = 0;
      for (const x of extra) {
        const ids = x.stops.map((s) => {
          const known = (s.code && stopIdByCode.get(s.code)) || (!s.code && nearestStop(s.lat, s.lon, s.name)?.id) ||
            (!s.code && src.snapMeters && snapToPath(s.lat, s.lon, x.path, src.snapMeters)?.id);
          if (known) { matched++; return known; }
          const id = `${src.id}-${s.code || `${Math.round(s.lat * 1e5)}_${Math.round(s.lon * 1e5)}`}`;
          if (!stops.has(id)) { stops.set(id, { id, code: s.code || '', name: s.name, lat: s.lat, lon: s.lon }); added++; }
          return id;
        });
        const stopIds = ids.filter((id, i) => i === 0 || id !== ids[i - 1]);
        routes.set(x.id, {
          id: x.id, short: x.short, longName: '', agency: `src:${src.id}`, type: 3, source: src.id, trips: [],
          patterns: [{ stops: stopIds, times: stopIds.map(() => null), encoded: encode(simplify(x.path, SHAPE_TOLERANCE_DEG)), headsign: x.dest, weight: 1 }],
        });
      }
      log(`  ${src.id}: ${extra.length} line directions; stops matched to national stops: ${matched}, added: ${added}`);
      sourceInfo[src.id] = { name: src.name, hours: src.hours, info: src.info };
    } catch (e) {
      log(`WARNING: skipped ${src.id}: ${e.message}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const index = { v: 1, country: config.country, generatedAt, gtfsLastModified: lastModified, cities: [] };
  const published = new Set(); // lines that appear in at least one city

  for (const city of cities) {
    // A line belongs to a city if any stop of any of its patterns is inside the city box.
    // The whole line is kept (all its stops), so lines that leave the city still draw fully.
    const cityRoutes = [...routes.values()].filter((r) => r.patterns.some((p) => p.stops.some((sid) => {
      const s = stops.get(sid);
      return s && inBbox(city.bbox, s.lat, s.lon);
    })));

    const stopIdx = new Map();
    const stopRows = [];
    const agencyIdx = new Map();
    const agencyRows = [];
    const idxOf = (map, rows, key, row) => {
      if (!map.has(key)) { map.set(key, rows.length); rows.push(row); }
      return map.get(key);
    };

    // One pattern -> [stopIndexes, shape, minutes]
    const patternRow = (p) => {
      const kept = p.stops.map((sid, i) => [sid, p.times[i]]).filter(([sid]) => stops.has(sid));
      const times = kept.every(([, t]) => t != null) ? kept.map(([, t]) => t) : null;
      const seq = kept.map(([sid]) => {
        const s = stops.get(sid);
        const row = [s.id, s.code, s.name, +s.lat.toFixed(6), +s.lon.toFixed(6)];
        // Optional 6th entry "platform/floor", only for stops that share their code with others.
        if (stopsPerCode.get(s.code) > 1 && (s.platform || s.floor)) row.push(`${s.platform}${s.floor ? `/${s.floor}` : ''}`);
        return idxOf(stopIdx, stopRows, sid, row);
      });
      const shape = p.encoded || (p.shapeId && encodedShapes.get(p.shapeId)) ||
        encode(seq.map((i) => [stopRows[i][3], stopRows[i][4]]));
      return [seq, shape, times];
    };

    const routeRows = cityRoutes.map((r) => {
      published.add(r.id);
      const [main, ...others] = r.patterns;
      const total = r.patterns.reduce((n, p) => n + p.weight, 0);
      const [seq, shape, times] = patternRow(main);
      // Less common patterns: [stopIndexes, shape, minutes, share of trips in %]
      const alts = others.map((p) => [...patternRow(p), Math.max(1, Math.round((100 * p.weight) / total))]);
      const row = [
        r.id,
        r.short,
        main.headsign || destinationFromLongName(r.longName),
        idxOf(agencyIdx, agencyRows, r.agency, agencies.get(r.agency) || r.agency),
        r.type,
        seq,
        shape,
        times,
      ];
      // Optional tail: [8] source (not from the government feed: no live buses), [9] other patterns.
      if (r.source || alts.length) row.push(r.source || null);
      if (alts.length) row.push(alts);
      return row;
    });
    const usedSources = Object.fromEntries([...new Set(cityRoutes.map((r) => r.source).filter(Boolean))].map((id) => [id, sourceInfo[id]]));

    const bundle = { v: 1, cityId: city.id, generatedAt, agencies: agencyRows, stops: stopRows, routes: routeRows, sources: usedSources };
    const json = JSON.stringify(bundle);
    const version = crypto.createHash('sha1').update(json).digest('hex').slice(0, 12);
    const fileName = `${city.id}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fileName), json);
    index.cities.push({ ...city, file: fileName, version, bytes: json.length, stops: stopRows.length, routes: routeRows.length });
    log(`${city.id}: ${routeRows.length} lines (${cityRoutes.filter((r) => r.patterns.length > 1).length} with variants), ${stopRows.length} stops, ${(json.length / 1e6).toFixed(1)} MB`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  log('Wrote', path.join(OUT_DIR, 'index.json'));

  // One small timetable file per line, loaded only when someone opens a stop's schedule
  // (REQ-DATA-9). trips: [day mask (bit 0 = Sunday), start minute of day, pattern index].
  fs.rmSync(SCHEDULE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
  let bytes = 0;
  let files = 0;
  for (const id of published) {
    const r = routes.get(id);
    if (r.source || !r.trips.length) continue;
    const indexOfPattern = new Map(r.patterns.map((p, i) => [p.ref, i]));
    const seen = new Set();
    const tripRows = [];
    for (const [mask, start, p] of r.trips) {
      const pi = indexOfPattern.get(p);
      const k = `${mask},${start},${pi}`;
      if (pi === undefined || seen.has(k)) continue;
      seen.add(k);
      tripRows.push([mask, start, pi]);
    }
    tripRows.sort((a, b) => a[1] - b[1]);
    const json = JSON.stringify({ v: 1, routeId: id, generatedAt, patterns: r.patterns.map((p) => ({ stops: p.stops, offsets: p.times })), trips: tripRows });
    fs.writeFileSync(path.join(SCHEDULE_DIR, `${id}.json`), json);
    bytes += json.length;
    files++;
  }
  log(`Wrote ${files} line timetables to ${SCHEDULE_DIR} (${(bytes / 1e6).toFixed(1)} MB in total)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
