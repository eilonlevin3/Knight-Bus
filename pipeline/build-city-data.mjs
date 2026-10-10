// Builds one transit bundle per city from the national GTFS feed.
// @req REQ-DATA-2 @req REQ-SCOPE-1 @req REQ-DATA-5 @req REQ-DATA-6
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/cities.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'data/cities');
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
      trip: null,
      shapeId: null,
      headsign: '',
      stops: [],
    });
  });

  // Every bus line in the feed is kept, whatever days it runs (weekdays, Friday, Saturday,
  // Saturday night): there is deliberately no calendar filter here (REQ-DATA-5).
  // One representative trip per route. In the Israeli feed every route_id is already one
  // direction + one variant of a line, so all of its trips share the same stop pattern.
  log('Picking one trip per route');
  const repTrips = new Map(); // trip_id -> route
  await readCsv(z, 'trips.txt', (g) => {
    const r = routes.get(g('route_id'));
    if (!r || r.trip) return;
    r.trip = g('trip_id');
    r.shapeId = g('shape_id') || null;
    r.headsign = g('trip_headsign');
    repTrips.set(r.trip, r);
  });

  log('Reading stop order (stop_times.txt is large, this takes a few minutes)');
  await readCsv(z, 'stop_times.txt', (g) => {
    const r = repTrips.get(g('trip_id'));
    if (r) r.stops.push([Number(g('stop_sequence')), g('stop_id'), toSeconds(g('arrival_time'))]);
  });
  for (const r of routes.values()) {
    r.stops.sort((a, b) => a[0] - b[0]);
    // Scheduled minutes from the first stop, used to find "5 minutes before your stop" (REQ-DATA-6).
    const t0 = r.stops[0]?.[2];
    r.times = r.stops.map((s) => (Number.isFinite(s[2]) && Number.isFinite(t0) ? Math.round((s[2] - t0) / 60) : null));
    r.stops = r.stops.map((s) => s[1]);
  }

  log('Reading stops');
  const stops = new Map();
  await readCsv(z, 'stops.txt', (g) => {
    stops.set(g('stop_id'), {
      id: g('stop_id'),
      code: g('stop_code'),
      name: g('stop_name'),
      lat: Number(g('stop_lat')),
      lon: Number(g('stop_lon')),
    });
  });

  log('Reading shapes');
  const neededShapes = new Map();
  for (const r of routes.values()) if (r.shapeId) neededShapes.set(r.shapeId, []);
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

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const index = { v: 1, country: config.country, generatedAt, gtfsLastModified: lastModified, cities: [] };

  for (const city of cities) {
    // A line belongs to a city if any of its stops is inside the city box.
    // The whole line is kept (all its stops), so lines that leave the city still draw fully.
    const cityRoutes = [...routes.values()].filter(
      (r) => r.stops.length > 1 && r.stops.some((sid) => {
        const s = stops.get(sid);
        return s && inBbox(city.bbox, s.lat, s.lon);
      }),
    );

    const stopIdx = new Map();
    const stopRows = [];
    const agencyIdx = new Map();
    const agencyRows = [];
    const idxOf = (map, rows, key, row) => {
      if (!map.has(key)) { map.set(key, rows.length); rows.push(row); }
      return map.get(key);
    };

    const routeRows = cityRoutes.map((r) => {
      const kept = r.stops.map((sid, i) => [sid, r.times[i]]).filter(([sid]) => stops.has(sid));
      const times = kept.every(([, t]) => t != null) ? kept.map(([, t]) => t) : null;
      const seq = kept
        .map(([sid]) => sid)
        .map((sid) => {
          const s = stops.get(sid);
          return idxOf(stopIdx, stopRows, sid, [s.id, s.code, s.name, +s.lat.toFixed(6), +s.lon.toFixed(6)]);
        });
      const shape = (r.shapeId && encodedShapes.get(r.shapeId)) ||
        encode(seq.map((i) => [stopRows[i][3], stopRows[i][4]]));
      return [
        r.id,
        r.short,
        r.headsign || destinationFromLongName(r.longName),
        idxOf(agencyIdx, agencyRows, r.agency, agencies.get(r.agency) || r.agency),
        r.type,
        seq,
        shape,
        times,
      ];
    });

    const bundle = { v: 1, cityId: city.id, generatedAt, agencies: agencyRows, stops: stopRows, routes: routeRows };
    const json = JSON.stringify(bundle);
    const version = crypto.createHash('sha1').update(json).digest('hex').slice(0, 12);
    const fileName = `${city.id}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fileName), json);
    index.cities.push({ ...city, file: fileName, version, bytes: json.length, stops: stopRows.length, routes: routeRows.length });
    log(`${city.id}: ${routeRows.length} lines, ${stopRows.length} stops, ${(json.length / 1e6).toFixed(1)} MB`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  log('Wrote', path.join(OUT_DIR, 'index.json'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
